const OpenAI = require('openai');
const crypto = require('crypto');
const BotConversation = require('../models/BotConversation');
const BotUsageLog = require('../models/BotUsageLog');
const BotAuditLog = require('../models/BotAuditLog');
const User = require('../models/User');
const coeService = require('./coeService');
const { formatDateRange } = require('../utils/dateParser');
const { getOpenAIFunctions, getTool, hasPermission } = require('./botTools');
const { toolHandlers } = require('./botToolHandlers');
const {
  generateCorrelationId,
  calculateOpenAICost,
  sanitizeParamsForLogging,
  ErrorCodes,
  ErrorCategories,
  createError,
  getErrorCategory,
  isRetryableError
} = require('../utils/botUtils');
const {
  extractPreferencesFromMessage,
  extractPreferencesFromFormSubmission,
  extractPreferenceKeywords,
  checkSufficientData,
  getNextQuestion,
  updateConversationPreferences,
  getPreferences
} = require('./botPreferenceService');
const { formatCOEPreferencesFormResponse, formatProfileResponse } = require('./botResponseFormatter');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MAX_MESSAGES = 20; // Limit context size to keep requests lightweight

/**
 * Ensure a conversation document exists for the given user
 * @param {string} userId
 * @returns {Promise<BotConversation>}
 */
async function getOrCreateConversation(userId) {
  let conversation = await BotConversation.findOne({ user_id: userId });
  if (!conversation) {
    conversation = await BotConversation.create({
      user_id: userId,
      messages: [
        {
          role: 'system',
          content: 'You are THE1 assistant helping users plan their experiences. You MUST use the available tools to interact with the system - do not just respond with text when tools are available.\n\nWhen users ask about locations, venues, restaurants, hotels, or clubs (e.g., "show me all locations", "list venues", "show me restaurants", "show me hotels", "show me clubs"), you MUST use the get_locations tool.\n\nWhen users ask about events, upcoming events, future events, or events in a date range (e.g., "next 10 days", "next week", "upcoming events", "show me all future events"), you MUST use the get_events_by_date tool. Convert natural language dates to ISO 8601 format (e.g., "next 10 days" means start_date = today, end_date = today + 10 days in ISO format like "2025-11-12T00:00:00Z").\n\nWhen users ask to search for events in a city, at a venue/club, or with a specific performer (e.g., "What are the events in Las Vegas?", "Show me events at XS Nightclub in December", "What are the events with Drake anywhere?"), you MUST use the search_events tool. This tool intelligently extracts search parameters from natural language queries.\n\nWhen users ask to create or manage COEs (Curated One Experiences), use the create_coe_draft, update_coe, get_my_coes, get_coe_details, or delete_coe tools as appropriate.\n\nWhen users ask to view a profile, show account details, or see user information (e.g., "show me my profile", "view profile of user X", "show John\'s profile"), use the get_user_profile tool. For clients, only return their own profile. For admins and runners, you can return any user\'s profile by providing the user_id parameter.\n\nWhen admins or runners ask to search for clients, find a client, show client list, or look for a client by name or email (e.g., "show me client john", "im looking for a client profile", "find client with email john@example.com", "show me clients"), use the get_clients tool. This tool supports search by name or email and pagination. Only admins and runners can use this tool.\n\nAlways use tools when they are available rather than just responding with text. Only provide text responses for general questions that don\'t require system data.'
        },
        {
          role: 'assistant',
          content: 'Ready to plan your experience?'
        }
      ]
    });
  }
  return conversation;
}

/**
 * Fetch conversation history for a user
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getConversationHistory(userId) {
  const conversation = await getOrCreateConversation(userId);
  return conversation.messages;
}

/**
 * Generate assistant reply via OpenAI with function calling support
 * @param {Array} messages - Conversation messages
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<{ role: string, content: string, tool_calls?: Array, usage?: Object }>}
 */
async function generateAssistantReply(messages, user, correlationId, allowForceTool = true) {
  if (!openaiClient) {
    return {
      role: 'assistant',
      content: 'OpenAI API key is not configured on the server. Please supply it to enable live responses.'
    };
  }

  const startTime = Date.now();

  try {
    // Extract system message (should be first) and keep it separate
    const systemMessage = messages.find(msg => msg.role === 'system');
    const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
    
    // Get recent non-system messages (but keep system message)
    const recentNonSystemMessages = nonSystemMessages.slice(-MAX_MESSAGES);
    
    // Always include system message at the beginning
    const recentMessages = systemMessage 
      ? [systemMessage, ...recentNonSystemMessages]
      : recentNonSystemMessages;
    
    // Get available tools for this user
    const availableTools = getOpenAIFunctions().filter(func => {
      const tool = getTool(func.function.name);
      return tool && hasPermission(func.function.name, user.role);
    });

    // Log available tools for debugging
    console.log('[BOT] Available tools for user:', {
      userId: user._id.toString(),
      role: user.role,
      toolCount: availableTools.length,
      toolNames: availableTools.map(t => t.function.name)
    });

    // Format messages for OpenAI (include tool_calls and tool_call_id when present)
    // IMPORTANT: OpenAI requires that tool messages must immediately follow an assistant message with tool_calls
    // We need to validate and fix the message sequence to ensure this requirement is met
    const formattedMessages = [];
    for (let i = 0; i < recentMessages.length; i++) {
      const msg = recentMessages[i];
      
      // Skip orphaned tool messages (tool messages that don't IMMEDIATELY follow an assistant message with tool_calls)
      // OpenAI requires tool messages to immediately follow the assistant message (only system messages can be in between)
      if (msg.role === 'tool') {
        // Look backwards through the messages to find the IMMEDIATELY preceding assistant message
        // (skipping only system messages, which are allowed between assistant and tool)
        let foundImmediatePrecedingAssistantWithToolCalls = false;
        for (let j = i - 1; j >= 0; j--) {
          const prevMsg = recentMessages[j];
          // Skip system messages when looking backwards (they're allowed between assistant and tool)
          if (prevMsg.role === 'system') {
            continue;
          }
          // Check if this is an assistant message with tool_calls
          // If it is, and we only skipped system messages, this tool message is valid
          if (prevMsg.role === 'assistant' && prevMsg.tool_calls && prevMsg.tool_calls.length > 0) {
            foundImmediatePrecedingAssistantWithToolCalls = true;
            break;
          }
          // If we hit ANY non-system message that's not an assistant with tool_calls, 
          // this tool message is orphaned (doesn't immediately follow the assistant)
          if (prevMsg.role === 'user' || prevMsg.role === 'tool' || 
              (prevMsg.role === 'assistant' && (!prevMsg.tool_calls || prevMsg.tool_calls.length === 0))) {
            break; // Stop looking, this tool message is orphaned
          }
        }
        
        if (!foundImmediatePrecedingAssistantWithToolCalls) {
          console.warn('[BOT] Skipping orphaned tool message at index', i, 'tool_call_id:', msg.tool_call_id || msg.id, 'name:', msg.name);
          continue; // Skip this orphaned tool message
        }
      }
      
      const formatted = {
        role: msg.role,
        content: msg.content || null
      };
      
      // Add tool_calls for assistant messages
      if (msg.role === 'assistant' && msg.tool_calls) {
        formatted.tool_calls = msg.tool_calls.map(tc => ({
          id: tc.id || tc.tool_call_id,
          type: tc.type || 'function',
          function: {
            name: tc.function?.name || tc.name,
            arguments: tc.function?.arguments || tc.arguments || '{}'
          }
        }));
      }
      
      // Add tool_call_id and name for tool messages
      if (msg.role === 'tool') {
        formatted.tool_call_id = msg.tool_call_id || msg.id;
        formatted.name = msg.name;
      }
      
      formattedMessages.push(formatted);
    }

    // Log what we're sending to OpenAI
    console.log('[BOT] Sending to OpenAI:', {
      model: MODEL,
      messageCount: formattedMessages.length,
      lastUserMessage: formattedMessages.filter(m => m.role === 'user').slice(-1)[0]?.content?.substring(0, 100),
      toolsAvailable: availableTools.length > 0,
      toolNames: availableTools.map(t => t.function.name),
      toolChoice: availableTools.length > 0 ? 'auto' : undefined,
      systemMessage: formattedMessages.find(m => m.role === 'system')?.content?.substring(0, 300),
      messageRoles: formattedMessages.map(m => m.role)
    });
    
    // Log full conversation for debugging (truncated)
    console.log('[BOT] Full conversation context (last 3 messages):', 
      formattedMessages.slice(-3).map(m => ({
        role: m.role,
        content: m.content?.substring(0, 200),
        hasToolCalls: !!m.tool_calls
      }))
    );

    // Determine if we should force tool usage based on the last user message
    // Only force tool usage if allowForceTool is true (not for final replies after tool execution)
    let toolChoice = availableTools.length > 0 ? 'auto' : undefined;
    
    if (allowForceTool) {
      // Check ALL messages, not just formattedMessages (which might be sliced)
      const allUserMessages = formattedMessages.filter(m => m.role === 'user');
      const lastUserMessage = allUserMessages.length > 0 
        ? allUserMessages[allUserMessages.length - 1]?.content?.toLowerCase() || ''
        : '';
      
      // Also check the original messages array passed to this function (before slicing)
      // This ensures we catch the current user message even if it was sliced out
      const originalMessages = messages; // messages parameter passed to this function
      const originalUserMessages = originalMessages.filter(m => m.role === 'user');
      const originalLastUserMessage = originalUserMessages.length > 0
        ? originalUserMessages[originalUserMessages.length - 1]?.content?.toLowerCase() || ''
        : '';
      
      // Use the most recent user message (either from formatted or original)
      const mostRecentUserMessage = lastUserMessage || originalLastUserMessage;
      
      console.log('[BOT] Checking for event query:', {
        lastUserMessageFromFormatted: lastUserMessage.substring(0, 100),
        lastUserMessageFromOriginal: originalLastUserMessage.substring(0, 100),
        mostRecentUserMessage: mostRecentUserMessage.substring(0, 100),
        allUserMessagesCount: allUserMessages.length,
        originalUserMessagesCount: originalUserMessages.length
      });
      
      const isEventQuery = mostRecentUserMessage && (
        mostRecentUserMessage.includes('event') || 
        mostRecentUserMessage.includes('upcoming') || 
        mostRecentUserMessage.includes('future') ||
        (mostRecentUserMessage.includes('show me') && mostRecentUserMessage.includes('event')) ||
        (mostRecentUserMessage.includes('what are') && (mostRecentUserMessage.includes('event') || mostRecentUserMessage.includes('upcoming')))
      );
      
      // For event queries, force tool usage by requiring get_events_by_date
      if (isEventQuery && availableTools.length > 0) {
        // Force the get_events_by_date tool for event queries
        const eventTool = availableTools.find(t => t.function.name === 'get_events_by_date');
        if (eventTool) {
          toolChoice = { type: 'function', function: { name: 'get_events_by_date' } };
          console.log('[BOT] ✅ Forcing tool usage for event query - requiring get_events_by_date');
          console.log('[BOT] Event query detected:', mostRecentUserMessage.substring(0, 100));
        }
      } else {
        console.log('[BOT] ❌ Not forcing tool - isEventQuery:', isEventQuery, 'mostRecentUserMessage:', mostRecentUserMessage.substring(0, 50));
      }
    } else {
      console.log('[BOT] Not forcing tool usage - this is a final reply after tool execution');
    }

    const completion = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: formattedMessages,
      tools: availableTools.length > 0 ? availableTools : undefined,
      tool_choice: toolChoice,
      temperature: 0.7
    });

    const assistantMessage = completion.choices?.[0]?.message;
    const usage = completion.usage;

    // Log what OpenAI returned
    console.log('[BOT] OpenAI response:', {
      hasContent: !!assistantMessage?.content,
      contentPreview: assistantMessage?.content?.substring(0, 150),
      hasToolCalls: !!(assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0),
      toolCallsCount: assistantMessage?.tool_calls?.length || 0,
      toolCalls: assistantMessage?.tool_calls?.map(tc => ({
        name: tc.function?.name,
        arguments: tc.function?.arguments?.substring(0, 200)
      })) || [],
      usage: usage ? {
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens
      } : null
    });

    // Track OpenAI usage and cost
    if (usage && user._id) {
      const tokensInput = usage.prompt_tokens || 0;
      const tokensOutput = usage.completion_tokens || 0;
      const tokensTotal = usage.total_tokens || 0;
      const cost = calculateOpenAICost(MODEL, tokensInput, tokensOutput);

      try {
        await BotUsageLog.create({
          user_id: user._id,
          timestamp: new Date(),
          model: MODEL,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          tokens_total: tokensTotal,
          cost_usd: cost,
          correlation_id: correlationId,
          request_type: 'function_calling'
        });
      } catch (error) {
        console.error('Error tracking OpenAI usage:', error);
        // Don't fail the request if usage tracking fails
      }
    }

    // Handle tool calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      return {
        role: assistantMessage.role || 'assistant',
        content: assistantMessage.content || '', // Use empty string instead of null for assistant messages with tool_calls
        tool_calls: assistantMessage.tool_calls,
        usage: usage
      };
    }

    // Regular text response
    if (!assistantMessage?.content) {
      throw new Error('Empty response from OpenAI');
    }

    return {
      role: assistantMessage.role || 'assistant',
      content: assistantMessage.content || '', // Ensure content is never null
      usage: usage
    };
  } catch (error) {
    console.error('OpenAI chat completion error:', error);
    return {
      role: 'assistant',
      content: 'I encountered an error while generating a response. Please try again later.'
    };
  }
}

/**
 * Execute a tool call with audit logging
 * @param {string} toolName - Tool name
 * @param {Object} toolParams - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function executeTool(toolName, toolParams, user, correlationId) {
  const startTime = Date.now();
  let result = null;
  let success = false;
  let errorCode = null;
  let errorCategory = null;

  try {
    const tool = getTool(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // Check permissions
    if (!hasPermission(toolName, user.role)) {
      const error = createError(
        ErrorCodes.PERMISSION_DENIED,
        `You do not have permission to use tool: ${toolName}`,
        ErrorCategories.PERMISSION,
        false
      );
      throw error;
    }

    // Get handler
    const handler = toolHandlers[tool.handler];
    if (!handler) {
      throw new Error(`Handler not found for tool: ${toolName}`);
    }

    // Execute handler
    result = await handler(toolParams, user, correlationId);
    success = result.success !== false;
    
    if (!success && result.error) {
      errorCode = result.error.code || ErrorCodes.TOOL_EXECUTION_FAILED;
      errorCategory = result.error.category || getErrorCategory(errorCode);
    }
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    success = false;
    errorCode = error.code || ErrorCodes.TOOL_EXECUTION_FAILED;
    errorCategory = error.category || getErrorCategory(errorCode);
    
    result = {
      success: false,
      error: error.code ? error : createError(
        errorCode,
        error.message || `Failed to execute tool: ${toolName}`,
        errorCategory,
        isRetryableError(errorCode)
      )
    };
  } finally {
    // Audit log the tool execution
    const executionTime = Date.now() - startTime;
    try {
      const paramsHash = crypto.createHash('sha256')
        .update(JSON.stringify(sanitizeParamsForLogging(toolParams)))
        .digest('hex');
      const resultHash = result ? crypto.createHash('sha256')
        .update(JSON.stringify(result))
        .digest('hex') : null;

      await BotAuditLog.create({
        user_id: user._id,
        tool_name: toolName,
        parameters_hash: paramsHash,
        result_hash: resultHash,
        correlation_id: correlationId,
        timestamp: new Date(),
        success: success,
        error_code: errorCode,
        error_category: errorCategory,
        execution_time_ms: executionTime,
        user_role: user.role
      });
    } catch (auditError) {
      console.error('Error creating audit log:', auditError);
      // Don't fail the request if audit logging fails
    }
  }

  return result;
}

/**
 * Process a user prompt and return updated conversation
 * @param {string} userId
 * @param {string} prompt
 * @param {Object} user - Current user object (required for tool execution)
 * @param {string} correlationId - Correlation ID for tracing (optional, will be generated if not provided)
 * @returns {Promise<Array>} - Updated message history
 */
async function sendBotMessage(userId, prompt, user, correlationId = null) {
  if (!user) {
    throw new Error('User object is required for bot message processing');
  }

  // Generate correlation ID if not provided
  if (!correlationId) {
    correlationId = generateCorrelationId();
  }

  let conversation = await getOrCreateConversation(userId);
  const timestampMessage = {
    role: 'system',
    content: `Today's date is ${new Date().toISOString()}.`
  };

  // Rule 1: Who are you?
  // Check this rule BEFORE adding message and BEFORE any other processing
  // This MUST be the absolute first check to ensure it always takes precedence
  const normalizedPrompt = prompt.toLowerCase().trim();
  const whoAreYouPatterns = [
    'who are you',
    'who are you?',
    'who r u',
    'what are you',
    'what are you?'
  ];
  
  console.log('[BOT] Rule 1 check - prompt:', prompt, 'normalized:', normalizedPrompt);
  
  const matchesWhoAreYou = whoAreYouPatterns.some(pattern => {
    const exactMatch = normalizedPrompt === pattern;
    const includesMatch = normalizedPrompt.includes(pattern);
    const result = exactMatch || includesMatch;
    if (result) {
      console.log('[BOT] Rule 1 pattern matched:', pattern, 'exact:', exactMatch, 'includes:', includesMatch);
    }
    return result;
  });
  
  if (matchesWhoAreYou) {
    console.log('[BOT] ✅ Rule 1 matched for prompt:', prompt, '- RETURNING IMMEDIATELY');
    // Add user message
    conversation.messages.push({
      role: 'user',
      content: prompt
    });
    // Add rule reply
    const ruleReply = {
      role: 'assistant',
      content: "I'm the one who will create your MDF experience!"
    };
    conversation.messages.push(ruleReply);
    await conversation.save();
    console.log('[BOT] Rule 1 returning early with rule reply - EXITING FUNCTION');
    return conversation.messages;
  } else {
    console.log('[BOT] ❌ Rule 1 did NOT match for prompt:', prompt);
  }

  // Rule 2: Build my experience - Show preferences form
  // BUT: Skip this rule if:
  // 1. It's a form submission (has structured format)
  // 2. It's a request to open the create form for a specific client (admin flow)
  const isFormSubmission = prompt.includes('City:') && prompt.includes('Start date:') && prompt.includes('Budget:');
  const normalizedLower = prompt.toLowerCase();
  const isOpenCreateFormRequest = normalizedLower.includes('open the create experience form') || 
                                  normalizedLower.includes('open the create coe form') ||
                                  normalizedLower.includes('open_create_coe_for_client') ||
                                  (normalizedLower.includes('open') && normalizedLower.includes('create') && normalizedLower.includes('form') && normalizedLower.includes('client'));
  
  if (isOpenCreateFormRequest) {
    console.log('[BOT] Skipping Rule 2 - this is a request to open create form for client');
  }
  
  if (!isFormSubmission && !isOpenCreateFormRequest) {
    // Expanded patterns for flexible language matching
    const buildExperiencePatterns = [
      'build my experience',
      'build me an experience',
      'build me experience',
      'build me a experience',
      'lets build my experience',
      'lets build me experience',
      "let's build my experience",
      "let's build me experience",
      'create my experience',
      'create experience',
      'create me experience',
      'create me an experience',
      'lets create my experience',
      'lets create me experience',
      "let's create my experience",
      "let's create me experience",
      'plan my experience',
      'plan experience',
      'plan me experience',
      'build experience',
      'make my experience',
      'make me experience',
      'lets make my experience',
      "let's make my experience"
    ];
    
    // First check exact pattern matches
    let matchesBuildExperience = buildExperiencePatterns.some(pattern => {
      const exactMatch = normalizedPrompt === pattern;
      const includesMatch = normalizedPrompt.includes(pattern);
      return exactMatch || includesMatch;
    });
    
    // If no exact match, check for flexible keyword combinations
    // Normalize prompt: remove punctuation and handle contractions
    const normalizedForBuild = normalizedPrompt.replace(/[.,!?'"]/g, ' ').replace(/\s+/g, ' ').trim();
    
    if (!matchesBuildExperience) {
      // Check for key action words + "experience"
      const actionWords = ['build', 'create', 'plan', 'make', 'design', 'organize'];
      const hasActionWord = actionWords.some(word => normalizedForBuild.includes(word));
      const hasExperience = normalizedForBuild.includes('experience');
      
      // Match if contains action word + experience (flexible word order)
      if (hasActionWord && hasExperience) {
        matchesBuildExperience = true;
        console.log('[BOT] Rule 2 flexible match - action word + experience detected');
      }
    }
    
    if (matchesBuildExperience) {
    console.log('[BOT] ✅ Rule 2 (Build Experience) matched for prompt:', prompt);
    // Add user message
    conversation.messages.push({
      role: 'user',
      content: prompt
    });
    // Return preferences form as structured response - use "request" language for clients
    const isClient = user && user.role === 'client';
    const formMessage = isClient 
      ? 'Let\'s request your perfect experience! Please fill in your preferences below.'
      : 'Let\'s build your perfect experience! Please fill in your preferences below.';
    const preferencesForm = formatCOEPreferencesFormResponse(formMessage);
    const ruleReply = {
      role: 'assistant',
      content: JSON.stringify(preferencesForm),
      structured_data: preferencesForm
    };
      conversation.messages.push(ruleReply);
      await conversation.save();
      console.log('[BOT] Rule 2 returning preferences form - EXITING FUNCTION');
      return conversation.messages;
    }
  } else {
    console.log('[BOT] Form submission detected, skipping Rule 2 to process preferences');
  }

  // Rule 3: Show my profile (pattern-based detection for own profile)
  // Note: For other users' profiles (admins/runners), let OpenAI handle it via get_user_profile tool
  const profilePatterns = [
    'show me my profile',
    'my profile',
    'view my profile',
    'display my profile',
    'profile information',
    'my account',
    'account details',
    'user profile',
    'show profile'
  ];
  
  // Check if it's a request for own profile (not other user's profile)
  const matchesOwnProfile = profilePatterns.some(pattern => {
    const exactMatch = normalizedPrompt === pattern;
    const includesMatch = normalizedPrompt.includes(pattern) && 
                         !normalizedPrompt.includes('user') && // Avoid matching "show user X profile"
                         !normalizedPrompt.match(/\b(user|profile)\s+(of|for)\s+/i); // Avoid "profile of X"
    return exactMatch || includesMatch;
  });
  
  if (matchesOwnProfile) {
    console.log('[BOT] ✅ Rule 3 (Show Own Profile) matched for prompt:', prompt);
    // Add user message
    conversation.messages.push({
      role: 'user',
      content: prompt
    });
    
    // Fetch user profile - use req.user which should have profile data
    // For own profile, we use the current user from the request
    const profileData = user.getProfile ? user.getProfile() : {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      avatarUrl: user.avatarUrl,
      dateOfBirth: user.dateOfBirth,
      industry: user.industry,
      userTier: user.userTier,
      entity_status: user.entity_status,
      visibilityStatus: user.visibilityStatus,
      socialMedia: user.socialMedia,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLogin: user.lastLogin
    };
    
    // Return profile as structured response
    const profileResponse = formatProfileResponse(profileData, 'Here is your profile information.');
    const ruleReply = {
      role: 'assistant',
      content: JSON.stringify(profileResponse),
      structured_data: profileResponse
    };
    conversation.messages.push(ruleReply);
    await conversation.save();
    console.log('[BOT] Rule 3 returning own profile response - EXITING FUNCTION');
    return conversation.messages;
  }
  
  // Note: Requests for other users' profiles will be handled by OpenAI via get_user_profile tool
  // This allows flexible language like "show me John's profile" or "view profile of user X"

  // Add user message (only if rules didn't match)
  conversation.messages.push({
    role: 'user',
    content: prompt
  });

  // Preference collection: Extract preferences from user message
  // BUT FIRST: Check rule again before preference extraction (defensive check)
  const recheckBeforePrefs = whoAreYouPatterns.some(pattern => 
    normalizedPrompt === pattern || normalizedPrompt.includes(pattern)
  );
  
  if (recheckBeforePrefs) {
    console.log('[BOT] ✅ Rule 1 matched in pre-preference check - RETURNING IMMEDIATELY');
    const ruleReply = {
      role: 'assistant',
      content: "I'm the one who will create your MDF experience!"
    };
    conversation.messages.push(ruleReply);
    await conversation.save();
    console.log('[BOT] Rule 1 returning early - EXITING FUNCTION');
    return conversation.messages;
  }
  
  try {
    const existingPreferences = conversation.preference_data || {};
    
    // Phase 2.1: Detect if this is a structured form submission
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Checking for form submission:', {
      promptLength: prompt.length,
      promptFirst200Chars: prompt.substring(0, 200),
      hasBuildMyExperience: prompt.includes('Build my experience with the following preferences:') || prompt.includes('Request my experience with the following preferences:'),
      hasStartDate: prompt.includes('Start date:'),
      hasEndDate: prompt.includes('End date:'),
      hasBudget: prompt.includes('Budget:'),
      hasCity: prompt.includes('City:')
    });
    
    // Accept both "Build" (admin) and "Request" (client) form submissions
    const isFormSubmission = prompt.includes('Build my experience with the following preferences:') ||
                             prompt.includes('Request my experience with the following preferences:') ||
                             (
                               prompt.includes('Start date:') &&
                               prompt.includes('End date:') &&
                               prompt.includes('Budget:')
                             ); // Allow admin flow without City:
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Form submission detection result:', {
      isFormSubmission: isFormSubmission
    });
    
    let extractedPreferences = {};
    let extractionResult = null;
    
    if (isFormSubmission) {
      // Use structured form extraction (Phase 2.1)
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] ✅ Phase 2.1: Detected form submission, using extractPreferencesFromFormSubmission');
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Full prompt for extraction:', {
        prompt: prompt,
        promptLength: prompt.length
      });
      
      try {
        extractionResult = extractPreferencesFromFormSubmission(prompt);
        
        if (!extractionResult) {
          console.error('[BOT] Phase 2.1: extractPreferencesFromFormSubmission returned undefined/null');
          extractionResult = { valid: false, errors: ['Failed to extract preferences'], raw: {}, formatted: {} };
        }
        
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Extraction result complete:', {
          valid: extractionResult.valid,
          errors: extractionResult.errors,
          rawKeys: extractionResult.raw ? Object.keys(extractionResult.raw) : [],
          formattedKeys: extractionResult.formatted ? Object.keys(extractionResult.formatted) : []
        });
        
        console.log('[BOT] Phase 2.1: Extraction result:', {
          valid: extractionResult.valid,
          errors: extractionResult.errors,
          raw: extractionResult.raw,
          formatted: extractionResult.formatted
        });
        
        if (!extractionResult.valid) {
          console.error('[BOT] Phase 2.1: Form submission validation failed:', extractionResult.errors);
          // Still continue, but log the errors
        }
        
        // Use formatted preferences for storage
        extractedPreferences = extractionResult.formatted || {};
        console.log('[BOT] Phase 2.1: Extracted preferences (formatted for storage):', JSON.stringify(extractedPreferences, null, 2));
      } catch (extractionError) {
        console.error('[BOT] Phase 2.1: Error during preference extraction:', extractionError);
        console.error('[BOT] Phase 2.1: Error stack:', extractionError.stack);
        // Set default values to allow the flow to continue
        extractionResult = { 
          valid: false, 
          errors: [`Extraction error: ${extractionError.message}`], 
          raw: {}, 
          formatted: {} 
        };
        extractedPreferences = {};
      }
    } else {
      // Use natural language extraction (existing behavior)
      extractedPreferences = extractPreferencesFromMessage(prompt, existingPreferences);
      console.log('[BOT] Using natural language extraction, extracted preferences:', JSON.stringify(extractedPreferences, null, 2));
    }
    
    // Only update preferences if NEW preferences were extracted (not just existing ones)
    const existingKeys = Object.keys(existingPreferences);
    const extractedKeys = Object.keys(extractedPreferences);
    const hasNewPreferences = extractedKeys.some(key => !existingKeys.includes(key)) || 
                              extractedKeys.length > existingKeys.length;
    
    console.log('[BOT] Phase 2.1: Preference update check:', {
      existingKeys: existingKeys,
      extractedKeys: extractedKeys,
      hasNewPreferences: hasNewPreferences,
      existingPreferences: JSON.stringify(existingPreferences, null, 2)
    });
    
    if (hasNewPreferences) {
      console.log('[BOT] Phase 2.1: Storing new preferences in conversation context...');
      await updateConversationPreferences(userId, extractedPreferences, 'preference_collected');
      // Refresh conversation to get updated preferences
      await conversation.populate('active_coe_id');
      conversation = await BotConversation.findById(conversation._id);
      
      console.log('[BOT] Phase 2.1: ✅ Preferences stored in conversation context:', {
        conversationId: conversation._id.toString(),
        preferenceData: JSON.stringify(conversation.preference_data, null, 2),
        collectingPreferences: conversation.collecting_preferences,
        eventLogCount: conversation.event_log?.length || 0,
        lastEventLog: conversation.event_log?.[conversation.event_log.length - 1] || null
      });
    }
    
    // Phase 2.4: Auto-trigger COE creation if this is a form submission
    // This must run even if preferences didn't change, so users can rebuild drafts
    // CRITICAL FIX: Check for admin without client_id even when extractionResult.valid is false
    // The client_id extraction can succeed even if other fields have validation errors
    if (isFormSubmission && extractionResult) {
      // If this is a CLIENT request with NO manually selected events, create a request-only COE
      // (no auto-selected events) and skip the create_coe_draft tool.
      const clientNoManualEvents =
        user.role === 'client' &&
        !(
          extractionResult.raw &&
          extractionResult.raw.selected_events &&
          Array.isArray(extractionResult.raw.selected_events) &&
          extractionResult.raw.selected_events.length > 0
        );

      if (clientNoManualEvents) {
        try {
          console.log('[BOT] Phase 2.4: Creating request-only COE (no manual events, client flow)');

          const raw = extractionResult.raw || {};

          // Build original_request_data from extracted preferences
          const requestStartDate = raw.start_date ? new Date(raw.start_date) : null;
          const requestEndDate = raw.end_date ? new Date(raw.end_date) : requestStartDate;

          // Normalize budget into { max, currency } shape used by COEOriginalRequestCard and admin flows
          let normalizedBudget = null;
          if (raw.budget) {
            const amount =
              typeof raw.budget === 'number'
                ? raw.budget
                : raw.budget.max ??
                  raw.budget.amount ??
                  null;
            if (amount != null && !Number.isNaN(Number(amount))) {
              normalizedBudget = {
                max: Number(amount),
                min:
                  raw.budget.min != null
                    ? Number(raw.budget.min)
                    : Number(amount),
                currency: raw.budget.currency || 'USD',
              };
            }
          }

          const originalRequestData = {
            original_request_text: prompt,
            budget: normalizedBudget,
            requested_dates: {
              start_date: requestStartDate,
              end_date: requestEndDate,
            },
            party_size: raw.party_size || null,
            seat_preferences: raw.seat_preferences || '',
            general_preferences: raw.specific_preferences || '',
            city: raw.city || null,
            requested_at: new Date(),
          };

          // Determine admin for this request (first active admin, fallback to any admin)
          let admin = await User.findOne({ role: 'admin', isActive: true });
          if (!admin) {
            admin = await User.findOne({ role: 'admin' });
          }
          if (!admin) {
            throw new Error('No active admin found to assign to COE request.');
          }

          const client = user;
          const start = requestStartDate || new Date();
          const end = requestEndDate || start;
          const dateStr = formatDateRange(start, end || start);

          const clientFullName =
            (client.firstName && client.lastName
              ? `${client.firstName} ${client.lastName}`
              : client.firstName) ||
            client.email ||
            'Client';

          const coeName = `${clientFullName} experience, ${dateStr}`;

          const requestCoeData = {
            name: coeName,
            description: coeName,
            status: 'request',
            client_id: client._id,
            admin_id: admin._id,
            currency: normalizedBudget?.currency || 'USD',
            subtotal: 0,
            taxes: 0,
            fees: 0,
            total: 0,
            events: [],
            selected_seats: [],
            start_date: start,
            end_date: end,
            original_request_data: originalRequestData,
          };

          const coe = await coeService.createCOE(requestCoeData, user._id);

          console.log('[BOT] Phase 2.4: Request-only COE created:', {
            coeId: coe._id?.toString(),
            status: coe.status,
          });

          // Link this COE to the conversation so later flows can find it
          conversation.active_coe_id = coe._id.toString();

          const confirmationMessage = {
            role: 'assistant',
            content:
              'Your experience request has been submitted. Our team will now build the best experience for you and send you a draft to review.',
            timestamp: new Date().toISOString(),
          };

          conversation.messages.push(confirmationMessage);
          await conversation.save();

          return conversation.messages;
        } catch (err) {
          console.error('[BOT] Phase 2.4: Error creating request-only COE:', err);
          // Let the normal error handling continue (will surface a generic error to the user)
          throw err;
        }
      }
      // CRITICAL: Check for admin without client_id BEFORE preparing tool params
      // This check must happen even if extractionResult.valid is false
      if (user.role === 'admin' && !extractionResult?.raw?.client_id) {
        console.warn('[BOT] Phase 2.4: Admin attempting COE creation without client_id - intercepting BEFORE tool preparation');
        console.log('[BOT] Phase 2.4: Extraction result:', JSON.stringify(extractionResult, null, 2));
        
        // Store preferences for later use after client is selected
        try {
          await updateConversationPreferences(userId, extractedPreferences, 'preference_collected');
        } catch (err) {
          console.error('[BOT] Error storing preferences:', err);
        }
        
        // Return a response asking admin to select a client
        const responseMessage = {
          role: 'assistant',
          content: 'I need to know which client this experience is for. Please select a client from the list below, or type "show me clients" to see all available clients.',
          structured_data: {
            type: 'text',
            message: 'I need to know which client this experience is for. Please select a client from the list below, or type "show me clients" to see all available clients.'
          },
          timestamp: new Date().toISOString()
        };
        
        // Add assistant response (user message was already added earlier)
        conversation.messages.push(responseMessage);
        await conversation.save();
        
        // Trigger get_clients tool automatically to show client list
        try {
          const clientsResult = await executeTool('get_clients', {}, user, correlationId);
          if (clientsResult.success && clientsResult.data) {
            const clientsResponse = {
              role: 'assistant',
              content: 'Here are the available clients:',
              structured_data: clientsResult.data,
              timestamp: new Date().toISOString()
            };
            conversation.messages.push(clientsResponse);
            await conversation.save();
          }
        } catch (err) {
          console.error('[BOT] Error fetching clients list:', err);
        }
        
        // Return updated conversation - THIS MUST EXIT THE FUNCTION
        console.log('[BOT] Phase 2.4: Returning early - admin needs to select client first');
        return conversation.messages;
      }
      
      // Proceed with COE creation (client_id check passed above for admin)
      // Note: Even if extractionResult.valid is false, we can proceed if client_id is present for admin
      // Date validation will happen in handleCreateCOEDraft
      try {
        console.log('[BOT] Phase 2.4: Auto-triggering COE creation from form submission...');
        
        // Safety check: ensure extractionResult has raw data
        if (!extractionResult || !extractionResult.raw) {
          console.error('[BOT] Phase 2.4: extractionResult or extractionResult.raw is missing, cannot proceed with COE creation');
          throw new Error('Failed to extract preferences from form submission');
        }
        
        // Prepare tool parameters for create_coe_draft
        const extractedBudget = extractionResult.raw.budget?.amount || 0;
        console.log('[BOT] [COE_CREATION_DEBUG] Budget extraction from form:', {
          hasBudget: !!extractionResult.raw.budget,
          budgetAmount: extractedBudget,
          budgetObject: extractionResult.raw.budget,
          rawBudget: extractionResult.raw.budget,
          extractionResultRaw: JSON.stringify(extractionResult.raw, null, 2)
        });
        
        const toolParams = {
          start_date: extractionResult.raw.start_date,
          end_date: extractionResult.raw.end_date,
          preferences: {
            city: extractionResult.raw.city || null, // Add city directly for handleCreateCOEDraft
            budget_range: {
              max: extractedBudget
            },
            location_preferences: extractionResult.raw.city ? [extractionResult.raw.city] : [],
            party_size: extractionResult.raw.party_size,
            preferences: extractPreferenceKeywords(
              extractionResult.raw.seat_preferences || '',
              extractionResult.raw.specific_preferences || ''
            ),
            notes: `${extractionResult.raw.seat_preferences || ''}\n${extractionResult.raw.specific_preferences || ''}`.trim(),
            // Include full preference data for Phase 2.3 sentiment matching
            seat_preferences: extractionResult.raw.seat_preferences || '',
            specific_preferences: extractionResult.raw.specific_preferences || ''
          }
        };
        
        // If user selected specific events on the client, pass them through to create_coe_draft
        if (
          extractionResult.raw.selected_events &&
          Array.isArray(extractionResult.raw.selected_events) &&
          extractionResult.raw.selected_events.length > 0
        ) {
          const categoryByEventId = {};
          if (
            extractionResult.raw.selected_seat_categories &&
            Array.isArray(extractionResult.raw.selected_seat_categories)
          ) {
            for (const { event_id, seat_category } of extractionResult.raw.selected_seat_categories) {
              const id = (event_id && event_id.toString && event_id.toString()) || event_id;
              if (id) categoryByEventId[id] = seat_category;
            }
          }
          toolParams.events = extractionResult.raw.selected_events.map(eventId => {
            const id = (eventId && eventId.toString && eventId.toString()) || eventId;
            return {
              event_id: eventId,
              selected_seats: [],
              preferred_seat_category: categoryByEventId[id] || null,
            };
          });
          // Treat manual event selection differently for clients vs admins:
          // - Clients: manual_event_selection=true → if no seats are available, surface a clear error.
          // - Admins: manual_event_selection=false → allow fallback/alternative search logic to run.
          toolParams.manual_event_selection = user.role === 'client';
        }

        console.log('[BOT] [COE_CREATION_DEBUG] Tool params prepared:', {
          start_date: toolParams.start_date,
          end_date: toolParams.end_date,
          city: toolParams.preferences.city,
          budget_max: toolParams.preferences.budget_range.max,
          party_size: toolParams.preferences.party_size,
          fullPreferences: JSON.stringify(toolParams.preferences, null, 2),
          providedEventsCount: toolParams.events?.length || 0
        });
        
        // Add client_id if user is admin (required for admin)
        if (user.role === 'admin') {
          // Extract client_id from form submission (admin COE creation flow)
          const clientId = extractionResult?.raw?.client_id;
          console.log('[BOT] Phase 2.4: Checking client_id for admin:', { 
            hasExtractionResult: !!extractionResult,
            hasRaw: !!extractionResult?.raw,
            clientId: clientId,
            clientIdType: typeof clientId
          });
          
          if (clientId && clientId.trim && clientId.trim().length > 0) {
            toolParams.client_id = clientId.trim();
            console.log('[BOT] Phase 2.4: Extracted client_id from form submission:', toolParams.client_id);
          } else {
            console.warn('[BOT] Phase 2.4: Admin COE creation but client_id not found in form submission - BLOCKING tool execution');
            // For admin users, if client_id is missing, don't call the tool
            // Instead, ask them to select a client first
            console.log('[BOT] Phase 2.4: Admin attempting to create COE without client_id - prompting for client selection and RETURNING EARLY');
            
            // Store preferences for later use after client is selected
            await updateConversationPreferences(userId, extractedPreferences, 'preference_collected');
            
            // Return a response asking admin to select a client
            const responseMessage = {
              role: 'assistant',
              content: 'I need to know which client this experience is for. Please select a client from the list below, or type "show me clients" to see all available clients.',
              structured_data: {
                type: 'text',
                message: 'I need to know which client this experience is for. Please select a client from the list below, or type "show me clients" to see all available clients.'
              },
              timestamp: new Date().toISOString()
            };
            
            // Add assistant response (user message was already added earlier)
            conversation.messages.push(responseMessage);
            await conversation.save();
            
            // Trigger get_clients tool automatically to show client list
            try {
              const clientsResult = await executeTool('get_clients', {}, user, correlationId);
              if (clientsResult.success && clientsResult.data) {
                const clientsResponse = {
                  role: 'assistant',
                  content: 'Here are the available clients:',
                  structured_data: clientsResult.data,
                  timestamp: new Date().toISOString()
                };
                conversation.messages.push(clientsResponse);
                await conversation.save();
              }
            } catch (err) {
              console.error('[BOT] Error fetching clients list:', err);
            }
            
            // Return updated conversation - THIS MUST EXIT THE FUNCTION
            console.log('[BOT] Phase 2.4: Returning early from form submission path to prevent COE creation');
            return conversation.messages;
          }
        } else if (user.role === 'client') {
          // Client creates COE for themselves
          toolParams.client_id = user._id.toString();
        }
        
        // ADDITIONAL SAFETY CHECK: Don't proceed if admin and no client_id
        if (user.role === 'admin' && !toolParams.client_id) {
          console.error('[BOT] Phase 2.4: SAFETY CHECK FAILED - Admin has no client_id but we reached tool execution. This should not happen!');
          throw new Error('Admin must provide client_id when creating a COE. This error should have been caught earlier.');
        }
        
        console.log('[BOT] Phase 2.4: Calling create_coe_draft tool with params:', {
          client_id: toolParams.client_id,
          start_date: toolParams.start_date,
          end_date: toolParams.end_date,
          city: extractionResult.raw.city,
          budget: extractionResult.raw.budget?.amount,
          party_size: toolParams.preferences.party_size
        });
        
        // Execute create_coe_draft tool
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] ========== EXECUTING create_coe_draft TOOL ==========');
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Tool execution start:', {
          toolName: 'create_coe_draft',
          correlationId: correlationId,
          userId: user._id?.toString(),
          userRole: user.role,
          toolParamsFull: JSON.stringify(toolParams, null, 2)
        });
        
        const toolResult = await executeTool('create_coe_draft', toolParams, user, correlationId);
        
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Tool execution complete:', {
          success: toolResult.success,
          hasData: !!toolResult.data,
          message: toolResult.message,
          error: toolResult.error,
          dataType: toolResult.data?.type
        });
        
        if (toolResult.success && toolResult.data) {
          console.log('[BOT] [COE_CREATION_FULL_DEBUG] ✅ COE draft created successfully');
          console.log('[BOT] Phase 2.4: ✅ COE draft created successfully');
          
          // toolResult.data is already a formatted structured response from handleCreateCOEDraft
          const coeResponse = toolResult.data;
          
          // Extract COE ID from the response (could be in coe.coe_id or coe.id)
          const coeId = coeResponse.coe_id || coeResponse.coe?.id || coeResponse.coe?._id;
          console.log('[BOT] [COE_CREATION_FULL_DEBUG] Extracting COE ID from response:', {
            coeResponseKeys: Object.keys(coeResponse),
            coeIdFromCoeId: coeResponse.coe_id,
            coeIdFromCoeIdField: coeResponse.coe?.id,
            coeIdFromCoe_idField: coeResponse.coe?._id,
            finalCoeId: coeId,
            coeIdType: typeof coeId
          });
          
          if (coeId) {
            conversation.active_coe_id = typeof coeId === 'string' ? coeId : coeId.toString();
            await conversation.save();
            console.log('[BOT] [COE_CREATION_FULL_DEBUG] COE ID saved to conversation:', {
              conversationId: conversation._id.toString(),
              activeCoeId: conversation.active_coe_id
            });
          } else {
            console.warn('[BOT] [COE_CREATION_FULL_DEBUG] WARNING: No COE ID found in response');
          }
          
          // Add assistant message with structured COE response
          const assistantMessage = {
            role: 'assistant',
            content: coeResponse.message || toolResult.message || 'Your experience draft has been created!',
            structured_data: coeResponse
          };
          conversation.messages.push(assistantMessage);
          await conversation.save();
          
          console.log('[BOT] Phase 2.4: ✅ Returning draft COE response');
          return conversation.messages;
        } else {
          console.error('[BOT] Phase 2.4: COE creation failed:', toolResult.error);
          
          // If error response has structured data (NO_SEATS_AVAILABLE), use it
          if (toolResult.data && toolResult.data.type === 'error') {
            const errorResponse = toolResult.data;
            
            // Add assistant message with error response
            const assistantMessage = {
              role: 'assistant',
              content: errorResponse.message || 'We couldn\'t find any available seats/tables matching your preferences.',
              structured_data: errorResponse
            };
            conversation.messages.push(assistantMessage);
            await conversation.save();
            
            console.log('[BOT] Phase 2.4: Returning error response to user');
            return conversation.messages;
          }
          // Continue to normal flow - let OpenAI handle the error or provide feedback
          const errorMessage = {
            role: 'assistant',
            content: `I encountered an issue creating your experience: ${toolResult.error?.message || 'Unknown error'}. Please try again or contact support.`
          };
          conversation.messages.push(errorMessage);
          await conversation.save();
          return conversation.messages;
        }
      } catch (error) {
        console.error('[BOT] Phase 2.4: Error in auto-trigger COE creation:', error);
        // Continue to normal flow - don't block the conversation
        // The error will be handled by the normal OpenAI flow
      }
    }
    
    // CRITICAL: Re-check rule AFTER conversation refresh (always check)
    const recheckNormalizedPrompt = prompt.toLowerCase().trim();
    const recheckMatches = whoAreYouPatterns.some(pattern => 
      recheckNormalizedPrompt === pattern || recheckNormalizedPrompt.includes(pattern)
    );
    
    if (recheckMatches) {
      console.log('[BOT] ✅ Rule 1 matched after conversation refresh - RETURNING IMMEDIATELY');
      const ruleReply = {
        role: 'assistant',
        content: "I'm the one who will create your MDF experience!"
      };
      conversation.messages.push(ruleReply);
      await conversation.save();
      console.log('[BOT] Rule 1 returning after refresh - EXITING FUNCTION');
      return conversation.messages;
    }
    
    // CRITICAL: Re-add the user message after refresh, as it might have been lost
    const hasCurrentMessage = conversation.messages.some(
      msg => msg.role === 'user' && msg.content === prompt
    );
    if (!hasCurrentMessage) {
      console.log('[BOT] Re-adding user message after conversation refresh');
      conversation.messages.push({
        role: 'user',
        content: prompt
      });
    }
  } catch (error) {
    console.error('Error extracting preferences:', error);
    // Continue even if preference extraction fails
  }
  
  // FINAL defensive check before proceeding to OpenAI
  const finalRuleCheck = whoAreYouPatterns.some(pattern => 
    normalizedPrompt === pattern || normalizedPrompt.includes(pattern)
  );
  
  if (finalRuleCheck) {
    console.log('[BOT] ✅ Rule 1 matched in FINAL check before OpenAI - RETURNING IMMEDIATELY');
    const ruleReply = {
      role: 'assistant',
      content: "I'm the one who will create your MDF experience!"
    };
    conversation.messages.push(ruleReply);
    await conversation.save();
    console.log('[BOT] Rule 1 returning in final check - EXITING FUNCTION');
    return conversation.messages;
  }

  // Generate assistant reply with function calling
  console.log('[BOT] Processing user message:', {
    userId: user._id.toString(),
    role: user.role,
    prompt: prompt.substring(0, 200),
    correlationId: correlationId,
    conversationMessageCount: conversation.messages.length
  });

  // Always use the latest system message from code, not from stored conversation
  // This ensures we always have the most up-to-date instructions
  const latestSystemMessage = {
    role: 'system',
    content: 'You are THE1 assistant helping users plan their experiences. You MUST use the available tools to interact with the system - do not just respond with text when tools are available.\n\nWhen users ask about locations, venues, restaurants, hotels, or clubs (e.g., "show me all locations", "list venues", "show me restaurants", "show me hotels", "show me clubs"), you MUST use the get_locations tool.\n\nWhen users ask about events, upcoming events, future events, or events in a date range (e.g., "next 10 days", "next week", "upcoming events", "show me all future events"), you MUST use the get_events_by_date tool. Convert natural language dates to ISO 8601 format (e.g., "next 10 days" means start_date = today, end_date = today + 10 days in ISO format like "2025-11-12T00:00:00Z").\n\nWhen users ask to create or manage COEs (Curated One Experiences), use the create_coe_draft, update_coe, get_my_coes, get_coe_details, or delete_coe tools as appropriate.\n\nWhen users ask to view a profile, show account details, or see user information (e.g., "show me my profile", "view profile of user X", "show John\'s profile"), use the get_user_profile tool. For clients, only return their own profile. For admins and runners, you can return any user\'s profile by providing the user_id parameter.\n\nWhen admins or runners ask to search for clients, find a client, show client list, or look for a client by name or email (e.g., "show me client john", "im looking for a client profile", "find client with email john@example.com", "show me clients"), use the get_clients tool. This tool supports search by name or email and pagination. Only admins and runners can use this tool.\n\nAlways use tools when they are available rather than just responding with text. Only provide text responses for general questions that don\'t require system data.'
  };

  // Filter out old system messages and inject the latest one
  // IMPORTANT: conversation.messages already includes the new user message we just added above
  const messagesWithoutOldSystem = conversation.messages.filter(msg => msg.role !== 'system');
  const messagesWithDate = [latestSystemMessage, ...messagesWithoutOldSystem, timestampMessage];
  
  // Verify the current user message is in the array
  const currentUserMsg = messagesWithDate.find(m => m.role === 'user' && m.content === prompt);
  console.log('[BOT] Using latest system message (not from DB):', latestSystemMessage.content.substring(0, 200));
  console.log('[BOT] Message array being sent (first and last 2):', {
    first: messagesWithDate[0]?.role,
    lastTwo: messagesWithDate.slice(-2).map(m => ({ role: m.role, content: m.content?.substring(0, 50) })),
    currentUserMessageFound: !!currentUserMsg,
    totalMessages: messagesWithDate.length,
    userMessages: messagesWithDate.filter(m => m.role === 'user').map(m => m.content?.substring(0, 50))
  });
  
  let assistantReply = await generateAssistantReply(messagesWithDate, user, correlationId);
  
  console.log('[BOT] Generated assistant reply:', {
    hasContent: !!assistantReply.content,
    contentPreview: assistantReply.content?.substring(0, 150),
    hasToolCalls: !!(assistantReply.tool_calls && assistantReply.tool_calls.length > 0),
    toolCallsCount: assistantReply.tool_calls?.length || 0
  });

  // Handle tool calls
  if (assistantReply.tool_calls && assistantReply.tool_calls.length > 0) {
    // Add assistant message with tool calls
    // For assistant messages with tool_calls, content can be empty string but not null
    conversation.messages.push({
      role: 'assistant',
      content: assistantReply.content || '', // Ensure content is never null
      tool_calls: assistantReply.tool_calls
    });

    // Execute all tool calls
    const toolResults = [];
    for (const toolCall of assistantReply.tool_calls) {
      const toolName = toolCall.function.name;
      let toolParams;
      
      try {
        toolParams = JSON.parse(toolCall.function.arguments);
      } catch (error) {
        console.error('Error parsing tool arguments:', error);
        toolResults.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolName,
          content: JSON.stringify({
            success: false,
            error: createError(
              ErrorCodes.INVALID_PARAMETERS,
              'Failed to parse tool arguments',
              ErrorCategories.VALIDATION,
              false
            )
          })
        });
        continue;
      }

      // Execute tool with correlation ID
      console.log('[BOT] Executing tool:', {
        toolName: toolName,
        paramsPreview: JSON.stringify(toolParams).substring(0, 200),
        correlationId: correlationId
      });

      // CRITICAL FIX: Check if admin is trying to create COE without client_id
      if (toolName === 'create_coe_draft' && user.role === 'admin' && !toolParams.client_id) {
        console.warn('[BOT] Admin attempting to create COE via OpenAI tool call without client_id - intercepting');
        
        // Store any preferences that might be in the tool params
        if (toolParams.preferences || toolParams.start_date || toolParams.end_date) {
          const preferencesToStore = {
            ...(toolParams.preferences || {}),
            ...(toolParams.start_date ? { start_date: toolParams.start_date } : {}),
            ...(toolParams.end_date ? { end_date: toolParams.end_date } : {})
          };
          if (Object.keys(preferencesToStore).length > 0) {
            await updateConversationPreferences(userId, preferencesToStore, 'preference_collected');
          }
        }
        
        // Return error result that will trigger client list display
        toolResults.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolName,
          content: JSON.stringify({
            success: false,
            error: createError(
              ErrorCodes.MISSING_REQUIRED_FIELD,
              'Admin must select a client before creating an experience. Please select a client from the list below, or type "show me clients" to see all available clients.',
              ErrorCategories.VALIDATION,
              false,
              { client_id: 'Required for admin users' }
            ),
            // Include structured response to trigger client list
            data: {
              type: 'text',
              message: 'Admin must select a client before creating an experience. Please select a client from the list below, or type "show me clients" to see all available clients.',
              shouldShowClients: true
            }
          })
        });
        
        // Trigger get_clients tool automatically
        try {
          const clientsResult = await executeTool('get_clients', {}, user, correlationId);
          if (clientsResult.success && clientsResult.data) {
            toolResults.push({
              tool_call_id: 'auto-clients-' + Date.now(),
              role: 'tool',
              name: 'get_clients',
              content: JSON.stringify({
                success: true,
                data: clientsResult.data
              })
            });
          }
        } catch (err) {
          console.error('[BOT] Error fetching clients list:', err);
        }
        
        continue; // Skip executing create_coe_draft tool
      }

      const toolResult = await executeTool(toolName, toolParams, user, correlationId);
      
      console.log('[BOT] Tool execution result:', {
        toolName: toolName,
        success: toolResult.success,
        hasData: !!toolResult.data,
        hasError: !!toolResult.error,
        errorPreview: toolResult.error ? JSON.stringify(toolResult.error).substring(0, 200) : null
      });
      
      // Extract structured data if present (check both success and error cases)
      let structuredData = null;
      if (toolResult.success && toolResult.data) {
        structuredData = toolResult.data;
      } else if (!toolResult.success && toolResult.data) {
        // Error responses also have structured data (e.g., NO_SEATS_AVAILABLE)
        structuredData = toolResult.data;
        console.log('[BOT] Extracted structured_data from error response:', {
          toolName: toolName,
          hasData: !!toolResult.data,
          dataType: toolResult.data?.type,
          hasSpecificReason: !!toolResult.data?.specific_reason,
          specificReason: toolResult.data?.specific_reason,
          hasEventDiagnostics: !!(toolResult.data?.details?.event_diagnostics?.length),
          eventDiagnosticsCount: toolResult.data?.details?.event_diagnostics?.length || 0
        });
      }
      
      // Add tool result to conversation
      // Tool messages MUST have content (the tool result JSON)
      const toolResultContent = JSON.stringify(toolResult);
      if (!toolResultContent || toolResultContent === 'null') {
        console.error('[BOT] Warning: Tool result is empty or null for tool:', toolName);
      }
      toolResults.push({
        tool_call_id: toolCall.id,
        role: 'tool',
        name: toolName,
        content: toolResultContent || '{}', // Ensure content is never null for tool messages
        structured_data: structuredData // Include structured data for frontend rendering (even for errors)
      });
    }

    // Add tool results to conversation
    conversation.messages.push(...toolResults);

    // Get final assistant reply after tool execution
    console.log('[BOT] Getting final assistant reply after tool execution...');
    // Use latest system message here too
    const messagesWithoutOldSystem2 = conversation.messages.filter(msg => msg.role !== 'system');
    const messagesWithTools = [latestSystemMessage, ...messagesWithoutOldSystem2, timestampMessage];
    
    // Don't force tool usage for the final reply - we want a text response
    assistantReply = await generateAssistantReply(messagesWithTools, user, correlationId, false);
    console.log('[BOT] Final assistant reply:', {
      hasContent: !!assistantReply.content,
      contentPreview: assistantReply.content?.substring(0, 150),
      hasToolCalls: !!(assistantReply.tool_calls && assistantReply.tool_calls.length > 0)
    });
    
    // If OpenAI still returns tool calls, we need to prevent infinite loops
    // In this case, generate a text response based on the tool results
    if (assistantReply.tool_calls && assistantReply.tool_calls.length > 0) {
      console.log('[BOT] Warning: Final reply still has tool calls, generating text response from tool results');
      // Extract the tool result data to create a meaningful response
      const toolResultData = toolResults.map(tr => {
        try {
          return JSON.parse(tr.content);
        } catch {
          return null;
        }
      }).find(r => r && r.success && r.data);
      
      if (toolResultData && toolResultData.data) {
        assistantReply.content = `I found ${toolResultData.data.count || 0} events for the next 10 days.`;
        assistantReply.tool_calls = undefined; // Remove tool calls
      } else {
        assistantReply.content = 'I retrieved the event information for you.';
        assistantReply.tool_calls = undefined; // Remove tool calls
      }
    }

    // Extract structured data from tool results for assistant message
    // First try to get structured_data directly from tool result message (most reliable)
    // Then fall back to parsing the content
    const structuredDataFromTools = toolResults
      .map(tr => {
        // Prefer structured_data directly on the tool result message
        if (tr.structured_data) {
          console.log('[BOT] Found structured_data on tool result message:', {
            hasStructuredData: true,
            type: tr.structured_data?.type,
            hasSpecificReason: !!tr.structured_data?.specific_reason
          });
          return tr.structured_data;
        }
        // Fall back to parsing content
        try {
          const result = JSON.parse(tr.content);
          // Include error responses as well
          const data = result.data ? result.data : null;
          if (data) {
            console.log('[BOT] Extracted structured_data from tool result content:', {
              hasData: true,
              type: data?.type,
              hasSpecificReason: !!data?.specific_reason
            });
          }
          return data;
        } catch {
          return null;
        }
      })
      .find(data => data && (data.type === 'coe_created' || data.type === 'coe_updated' || data.type === 'coe_details' || data.type === 'coe_draft' || data.type === 'coe_list' || data.type === 'event_list' || data.type === 'location_list' || data.type === 'coe_preferences_form' || data.type === 'coe_create_form' || data.type === 'error' || data.type === 'user_profile' || data.type === 'client_list'));
    
    console.log('[BOT] Final structuredDataFromTools:', {
      found: !!structuredDataFromTools,
      type: structuredDataFromTools?.type,
      hasSpecificReason: !!structuredDataFromTools?.specific_reason,
      specificReason: structuredDataFromTools?.specific_reason,
      hasEventDiagnostics: !!(structuredDataFromTools?.details?.event_diagnostics?.length),
      eventDiagnosticsCount: structuredDataFromTools?.details?.event_diagnostics?.length || 0
    });

    // Add final assistant reply with structured data if available
    // CRITICAL: If assistantReply has tool_calls but no content, we must not save it with tool_calls
    // Instead, ensure it has content (either from OpenAI or generated from tool results)
    const assistantMessage = {
      role: 'assistant',
      content: assistantReply.content || 'I retrieved the information for you.' // Ensure content is never null or empty
    };
    
    // Only include tool_calls if content is also present (for validation)
    // But for final replies, we should never have tool_calls - they should have been converted to content above
    if (assistantReply.tool_calls && assistantReply.tool_calls.length > 0) {
      console.error('[BOT] ERROR: Final assistant reply has tool_calls - this should not happen after fallback logic');
      // Don't include tool_calls in the saved message - we've already handled it above
    }

    // Include structured data reference if available
    if (structuredDataFromTools) {
      assistantMessage.structured_data = structuredDataFromTools;
      console.log('[BOT] Attaching structured_data to assistant message:', {
        type: structuredDataFromTools.type,
        hasSpecificReason: !!structuredDataFromTools.specific_reason,
        specificReason: structuredDataFromTools.specific_reason,
        hasEventDiagnostics: !!(structuredDataFromTools.details?.event_diagnostics?.length),
        eventDiagnosticsCount: structuredDataFromTools.details?.event_diagnostics?.length || 0,
        hasPrimaryReason: !!structuredDataFromTools.details?.primary_reason,
        primaryReason: structuredDataFromTools.details?.primary_reason,
        structuredDataKeys: Object.keys(structuredDataFromTools)
      });
      
      // Track active COE if COE was created/updated
      if (structuredDataFromTools.type === 'coe_created' || structuredDataFromTools.type === 'coe_updated') {
        if (structuredDataFromTools.coe_id) {
          conversation.active_coe_id = structuredDataFromTools.coe_id;
          conversation.event_log.push({
            timestamp: new Date(),
            action: structuredDataFromTools.type === 'coe_created' ? 'coe_created' : 'coe_updated',
            details: { coe_id: structuredDataFromTools.coe_id }
          });
        }
      }
    } else {
      console.log('[BOT] No structured_data found to attach to assistant message');
    }

    conversation.messages.push(assistantMessage);
  } else {
    // No tool calls - regular text response
    console.log('[BOT] No tool calls detected - OpenAI returned text-only response');
    console.log('[BOT] This might indicate OpenAI did not recognize the intent to use tools.');
    conversation.messages.push({
      role: 'assistant',
      content: assistantReply.content || '' // Ensure content is never null
    });
  }

  // Update last_prompt_category based on prompt content
  const promptLower = prompt.toLowerCase();
  if (promptLower.includes('plan') || promptLower.includes('create') || promptLower.includes('coe')) {
    conversation.last_prompt_category = 'coe_creation';
  } else if (promptLower.includes('event') || promptLower.includes('show') || promptLower.includes('what')) {
    conversation.last_prompt_category = 'event_query';
  } else if (promptLower.includes('update') || promptLower.includes('change') || promptLower.includes('edit')) {
    conversation.last_prompt_category = 'coe_update';
  }

  await conversation.save();

  return conversation.messages;
}

module.exports = {
  getConversationHistory,
  sendBotMessage,
  executeTool,
  getOrCreateConversation
};


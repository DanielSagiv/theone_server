const OpenAI = require('openai');
const crypto = require('crypto');
const BotConversation = require('../models/BotConversation');
const BotUsageLog = require('../models/BotUsageLog');
const BotAuditLog = require('../models/BotAuditLog');
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
const { formatCOEPreferencesFormResponse } = require('./botResponseFormatter');

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
          content: 'You are THE1 assistant helping users plan their experiences. You MUST use the available tools to interact with the system - do not just respond with text when tools are available.\n\nWhen users ask about locations, venues, restaurants, hotels, or clubs (e.g., "show me all locations", "list venues", "show me restaurants", "show me hotels", "show me clubs"), you MUST use the get_locations tool.\n\nWhen users ask about events, upcoming events, future events, or events in a date range (e.g., "next 10 days", "next week", "upcoming events", "show me all future events"), you MUST use the get_events_by_date tool. Convert natural language dates to ISO 8601 format (e.g., "next 10 days" means start_date = today, end_date = today + 10 days in ISO format like "2025-11-12T00:00:00Z").\n\nWhen users ask to create or manage COEs (Curated One Experiences), use the create_coe_draft, update_coe, get_my_coes, get_coe_details, or delete_coe tools as appropriate.\n\nAlways use tools when they are available rather than just responding with text. Only provide text responses for general questions that don\'t require system data.'
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
    const formattedMessages = recentMessages.map(msg => {
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
      
      return formatted;
    });

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
  // BUT: Skip this rule if it's a form submission (has structured format)
  const isFormSubmission = prompt.includes('City:') && prompt.includes('Start date:') && prompt.includes('Budget:');
  
  if (!isFormSubmission) {
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
    // Return preferences form as structured response
    const preferencesForm = formatCOEPreferencesFormResponse('Let\'s build your perfect experience! Please fill in your preferences below.');
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
    const isFormSubmission = prompt.includes('Build my experience with the following preferences:') ||
                             prompt.includes('City:') && prompt.includes('Start date:') && prompt.includes('Budget:');
    
    let extractedPreferences;
    let extractionResult;
    
    if (isFormSubmission) {
      // Use structured form extraction (Phase 2.1)
      console.log('[BOT] ✅ Phase 2.1: Detected form submission, using extractPreferencesFromFormSubmission');
      extractionResult = extractPreferencesFromFormSubmission(prompt);
      
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
      
      // Phase 2.4: Auto-trigger COE creation if this is a form submission
      if (isFormSubmission && extractionResult && extractionResult.valid) {
        try {
          console.log('[BOT] Phase 2.4: Auto-triggering COE creation from form submission...');
          
          // Prepare tool parameters for create_coe_draft
          const toolParams = {
            start_date: extractionResult.raw.start_date,
            end_date: extractionResult.raw.end_date,
            preferences: {
              budget_range: {
                max: extractionResult.raw.budget?.amount || 0
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

          // Add client_id if user is admin (required for admin)
          if (user.role === 'admin') {
            // For now, we'll let the tool handler handle this or use a default
            // The tool will require client_id from admin
          } else if (user.role === 'client') {
            // Client creates COE for themselves
            toolParams.client_id = user._id.toString();
          }

          console.log('[BOT] Phase 2.4: Calling create_coe_draft tool with params:', {
            start_date: toolParams.start_date,
            end_date: toolParams.end_date,
            city: extractionResult.raw.city,
            budget: extractionResult.raw.budget?.amount,
            party_size: toolParams.preferences.party_size
          });

          // Execute create_coe_draft tool
          const toolResult = await executeTool('create_coe_draft', toolParams, user, correlationId);

          if (toolResult.success && toolResult.data) {
            console.log('[BOT] Phase 2.4: ✅ COE draft created successfully');
            
            // toolResult.data is already a formatted structured response from handleCreateCOEDraft
            const coeResponse = toolResult.data;
            
            // Extract COE ID from the response (could be in coe.coe_id or coe.id)
            const coeId = coeResponse.coe_id || coeResponse.coe?.id || coeResponse.coe?._id;
            if (coeId) {
              conversation.active_coe_id = typeof coeId === 'string' ? coeId : coeId.toString();
              await conversation.save();
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
    content: 'You are THE1 assistant helping users plan their experiences. You MUST use the available tools to interact with the system - do not just respond with text when tools are available.\n\nWhen users ask about locations, venues, restaurants, hotels, or clubs (e.g., "show me all locations", "list venues", "show me restaurants", "show me hotels", "show me clubs"), you MUST use the get_locations tool.\n\nWhen users ask about events, upcoming events, future events, or events in a date range (e.g., "next 10 days", "next week", "upcoming events", "show me all future events"), you MUST use the get_events_by_date tool. Convert natural language dates to ISO 8601 format (e.g., "next 10 days" means start_date = today, end_date = today + 10 days in ISO format like "2025-11-12T00:00:00Z").\n\nWhen users ask to create or manage COEs (Curated One Experiences), use the create_coe_draft, update_coe, get_my_coes, get_coe_details, or delete_coe tools as appropriate.\n\nAlways use tools when they are available rather than just responding with text. Only provide text responses for general questions that don\'t require system data.'
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

      const toolResult = await executeTool(toolName, toolParams, user, correlationId);
      
      console.log('[BOT] Tool execution result:', {
        toolName: toolName,
        success: toolResult.success,
        hasData: !!toolResult.data,
        hasError: !!toolResult.error,
        errorPreview: toolResult.error ? JSON.stringify(toolResult.error).substring(0, 200) : null
      });
      
      // Extract structured data if present
      const structuredData = toolResult.success && toolResult.data ? toolResult.data : null;
      
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
        structured_data: structuredData // Include structured data for frontend rendering
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
    const structuredDataFromTools = toolResults
      .map(tr => {
        try {
          const result = JSON.parse(tr.content);
          return result.success && result.data ? result.data : null;
        } catch {
          return null;
        }
      })
      .find(data => data && (data.type === 'coe_created' || data.type === 'coe_updated' || data.type === 'coe_details' || data.type === 'coe_list' || data.type === 'event_list' || data.type === 'location_list'));

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
  executeTool
};


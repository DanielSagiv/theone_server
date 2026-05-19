/**
 * Bot Preference Collection Service
 * @description Handles multi-turn conversation flows for collecting user preferences
 */

const BotConversation = require('../models/BotConversation');
const { parseAndNormalizeDate } = require('../utils/dateParser');

/**
 * Check if sufficient data is collected for COE creation
 * @param {Object} preferenceData - Collected preference data
 * @returns {Object} { sufficient: boolean, missingFields: string[] }
 */
function checkSufficientData(preferenceData) {
  const missingFields = [];
  
  if (!preferenceData.dates || !preferenceData.dates.startDate) {
    missingFields.push('dates');
  }
  
  // City is required for form submissions (Phase 2.1)
  if (preferenceData.city === undefined && preferenceData.location_preferences?.length === 0) {
    // Only require city if we're in form submission mode
    // For natural language, location_preferences array is acceptable
    if (preferenceData.seat_preferences !== undefined || preferenceData.specific_preferences !== undefined) {
      // This looks like form submission data, city is required
      missingFields.push('city');
    }
  }
  
  // Budget and preferences are optional but help with auto-selection
  // Minimum required: dates (and city for form submissions)
  
  return {
    sufficient: missingFields.length === 0,
    missingFields
  };
}

/**
 * Extract preference data from user message
 * @param {string} userMessage - User's message
 * @param {Object} existingPreferences - Existing preference data
 * @returns {Object} Extracted preference data
 */
function extractPreferencesFromMessage(userMessage, existingPreferences = {}) {
  const extracted = { ...existingPreferences };
  const lowerMessage = userMessage.toLowerCase();
  
  // Extract dates
  if (lowerMessage.includes('nov') || lowerMessage.includes('dec') || 
      lowerMessage.includes('jan') || lowerMessage.includes('feb') ||
      lowerMessage.includes('mar') || lowerMessage.includes('apr') ||
      lowerMessage.includes('may') || lowerMessage.includes('jun') ||
      lowerMessage.includes('jul') || lowerMessage.includes('aug') ||
      lowerMessage.includes('sep') || lowerMessage.includes('oct')) {
    try {
      const parsed = parseAndNormalizeDate(userMessage, existingPreferences.user_tz || 'UTC');
      extracted.dates = {
        startDate: parsed.startDate,
        endDate: parsed.endDate,
        isRange: parsed.isRange
      };
    } catch (error) {
      // Date parsing failed, will ask for clarification
    }
  }
  
  // Extract budget
  const budgetMatch = userMessage.match(/\$?(\d+)[,\s]*(?:to|-)?[,\s]*\$?(\d+)?/);
  if (budgetMatch) {
    const min = parseInt(budgetMatch[1]);
    const max = budgetMatch[2] ? parseInt(budgetMatch[2]) : min;
    extracted.budget = {
      min: Math.min(min, max),
      max: Math.max(min, max),
      currency: 'USD'
    };
  }
  
  // Extract party size
  const partySizeMatch = userMessage.match(/(\d+)\s*(?:people|guests|persons|party)/i);
  if (partySizeMatch) {
    extracted.party_size = parseInt(partySizeMatch[1]);
  }
  
  // Extract location preferences (simple keyword matching)
  const locationKeywords = ['las vegas', 'vegas', 'miami', 'new york', 'nyc', 'los angeles', 'la'];
  const foundLocations = locationKeywords.filter(keyword => lowerMessage.includes(keyword));
  if (foundLocations.length > 0) {
    extracted.location_preferences = foundLocations;
  }
  
  // Extract general preferences (nightlife, dining, music, etc.)
  const preferenceKeywords = {
    nightlife: ['nightlife', 'night club', 'club', 'party', 'dancing'],
    dining: ['dining', 'restaurant', 'food', 'dinner', 'lunch'],
    music: ['music', 'dj', 'live music', 'concert'],
    luxury: ['luxury', 'premium', 'vip', 'exclusive']
  };
  
  const foundPreferences = [];
  for (const [key, keywords] of Object.entries(preferenceKeywords)) {
    if (keywords.some(kw => lowerMessage.includes(kw))) {
      foundPreferences.push(key);
    }
  }
  if (foundPreferences.length > 0) {
    extracted.preferences = foundPreferences;
  }
  
  return extracted;
}

/**
 * Get next question to ask based on missing data
 * @param {Object} preferenceData - Current preference data
 * @returns {string | null} Next question or null if all data collected
 */
function getNextQuestion(preferenceData) {
  if (!preferenceData.dates || !preferenceData.dates.startDate) {
    return "What dates are you looking for? (e.g., Nov 15-20, 2025)";
  }
  
  if (!preferenceData.budget) {
    return "What's your budget range? (e.g., $5000-$10000)";
  }
  
  if (!preferenceData.party_size) {
    return "How many people will be in your party?";
  }
  
  // All required data collected
  return null;
}

/**
 * Update conversation with preference data
 * @param {string} userId - User ID
 * @param {Object} preferenceData - Preference data to store
 * @param {string} action - Action type for event log
 * @returns {Promise<Object>} Updated conversation
 */
async function updateConversationPreferences(userId, preferenceData, action = 'preference_collected') {
  const conversation = await BotConversation.findOne({ user_id: userId });
  
  if (!conversation) {
    throw new Error('Conversation not found');
  }
  
  console.log('[PREFERENCE SERVICE] updateConversationPreferences called:', {
    userId: userId.toString(),
    action: action,
    incomingPreferenceData: JSON.stringify(preferenceData, null, 2),
    existingPreferenceData: JSON.stringify(conversation.preference_data || {}, null, 2)
  });
  
  // Merge with existing preferences
  const previousPreferenceData = { ...conversation.preference_data };
  conversation.preference_data = {
    ...conversation.preference_data,
    ...preferenceData
  };
  
  // Update collecting state
  const sufficient = checkSufficientData(conversation.preference_data);
  conversation.collecting_preferences = !sufficient.sufficient;
  
  // Log event
  conversation.event_log.push({
    timestamp: new Date(),
    action: action,
    details: {
      field: Object.keys(preferenceData)[0],
      sufficient: sufficient.sufficient,
      preferenceDataKeys: Object.keys(preferenceData)
    }
  });
  
  await conversation.save();
  
  console.log('[PREFERENCE SERVICE] ✅ Preferences updated in conversation:', {
    conversationId: conversation._id.toString(),
    previousData: JSON.stringify(previousPreferenceData, null, 2),
    newData: JSON.stringify(conversation.preference_data, null, 2),
    sufficient: sufficient.sufficient,
    missingFields: sufficient.missingFields,
    collectingPreferences: conversation.collecting_preferences
  });
  
  return conversation;
}

/**
 * Clear preference data (after COE creation)
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated conversation
 */
async function clearPreferences(userId) {
  const conversation = await BotConversation.findOne({ user_id: userId });
  
  if (!conversation) {
    throw new Error('Conversation not found');
  }
  
  conversation.preference_data = {};
  conversation.collecting_preferences = false;
  
  await conversation.save();
  return conversation;
}

/**
 * Get current preference data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Preference data
 */
async function getPreferences(userId) {
  const conversation = await BotConversation.findOne({ user_id: userId });
  
  if (!conversation) {
    return {};
  }
  
  return conversation.preference_data || {};
}

/**
 * Extract structured preferences from form submission message
 * @description Parses the structured format from the COE preferences form
 * @param {string} message - User message containing preferences
 * Format: "City: Las Vegas\nStart date: 2025-11-15\nEnd date: 2025-11-20\nBudget: $5000 USD\n..."
 * @returns {Object} Structured preferences object with validation
 */
function extractPreferencesFromFormSubmission(message) {
  console.log('[PREFERENCE SERVICE] extractPreferencesFromFormSubmission called with message:', message.substring(0, 200));
  
  if (!message || typeof message !== 'string') {
    console.error('[PREFERENCE SERVICE] Invalid message format');
    return { valid: false, error: 'Invalid message format' };
  }

  const preferences = {
    valid: true,
    errors: []
  };

  // Pattern matching for structured format
  // Support both newline-delimited and space-delimited fields (admin flow)
  const patterns = {
    client_id: /Client ID:\s*([a-fA-F0-9]{24})(?:\s+City:|\s+Start date:|\s|\n|$)/i,
    request_coe_id: /Request COE ID:\s*([a-fA-F0-9]{24})(?:\s+City:|\s+Start date:|\s|\n|$)/i,
    city: /City:\s*([^\n]+?)(?:\s+Start date:|\n|$)/i,
    start_date: /Start date:\s*([^\n]+?)(?:\s+End date:|\n|$)/i,
    end_date: /End date:\s*([^\n]+?)(?:\s+Budget:|\n|$)/i,
    budget: /Budget:\s*\$?(\d+(?:\.\d+)?)\s*(USD)?/i,
    party_size: /Number of people:\s*(\d+)/i,
    seat_preferences: /Seat\/Table preferences:\s*(.+?)(?:\n|$)/i,
    specific_preferences: /Specific preferences:\s*(.+?)(?:\n|$)/i,
    selected_event_ids: /Selected event IDs:\s*([^\n]+?)(?:\n|$)/i,
    prioritized_event_ids: /Prioritized event IDs:\s*([^\n]+?)(?:\n|$)/i,
    selected_seat_categories: /Selected seat categories:\s*([^\n]+?)(?:\n|$)/i,
    selected_simple_joint_prices:
      /Simple joint line prices:\s*([^\n]+?)(?:\n|$)/i,
    selected_the1_negotiated_pricing:
      /THE1 negotiated pricing:\s*([^\n]+?)(?:\n|$)/i,
    admin_create_mode: /Admin create mode:\s*(draft|proposal)/i,
    proposal_deposit_percent: /Deposit percent:\s*(\d+)/i,
    proposal_payment_deadline_hours: /Payment deadline hours:\s*(\d+)/i
  };

  // Extract client_id (for admin COE creation flow)
  // Try multiple patterns to handle different formats (newline or space delimited)
  let clientIdMatch = message.match(patterns.client_id);
  if (!clientIdMatch || !clientIdMatch[1]) {
    // Fallback: Try a more permissive pattern that matches client ID followed by newline or space
    const fallbackPattern = /Client ID:\s*([a-fA-F0-9]{24})/i;
    clientIdMatch = message.match(fallbackPattern);
  }
  if (clientIdMatch && clientIdMatch[1]) {
    preferences.client_id = clientIdMatch[1].trim();
    console.log('[PREFERENCE SERVICE] Extracted client_id:', preferences.client_id);
  } else {
    console.warn('[PREFERENCE SERVICE] Failed to extract client_id from message:', message.substring(0, 200));
  }

  // Extract request_coe_id (for Flow A: build experience from existing request-only COE)
  const requestCoeMatch = message.match(patterns.request_coe_id);
  if (requestCoeMatch && requestCoeMatch[1]) {
    preferences.request_coe_id = requestCoeMatch[1].trim();
    console.log('[PREFERENCE SERVICE] Extracted request_coe_id:', preferences.request_coe_id);
  }

  // Extract city (optional for admin flow)
  const cityMatch = message.match(patterns.city);
  if (cityMatch && cityMatch[1]) {
    preferences.city = cityMatch[1].trim();
  }

  // Extract start date
  const startDateMatch = message.match(patterns.start_date);
  if (startDateMatch && startDateMatch[1]) {
    const startDateStr = startDateMatch[1].trim();
    const startDate = new Date(startDateStr);
    if (!isNaN(startDate.getTime())) {
      preferences.start_date = startDateStr; // Keep as ISO string
      preferences.startDate = startDate; // Also provide Date object
    } else {
      preferences.errors.push('Invalid start date format');
      preferences.valid = false;
    }
  }

  // Extract end date
  const endDateMatch = message.match(patterns.end_date);
  if (endDateMatch && endDateMatch[1]) {
    const endDateStr = endDateMatch[1].trim();
    const endDate = new Date(endDateStr);
    if (!isNaN(endDate.getTime())) {
      preferences.end_date = endDateStr; // Keep as ISO string
      preferences.endDate = endDate; // Also provide Date object
      
      // Validate end date >= start date
      if (preferences.startDate && endDate < preferences.startDate) {
        preferences.errors.push('End date must be on or after start date');
        preferences.valid = false;
      }
    } else {
      preferences.errors.push('Invalid end date format');
      preferences.valid = false;
    }
  }

  // Extract budget
  const budgetMatch = message.match(patterns.budget);
  if (budgetMatch && budgetMatch[1]) {
    const budgetAmount = parseFloat(budgetMatch[1]);
    if (!isNaN(budgetAmount) && budgetAmount > 0) {
      preferences.budget = {
        amount: budgetAmount,
        currency: (budgetMatch[2] || 'USD').toUpperCase()
      };
    } else {
      preferences.errors.push('Invalid budget amount');
      preferences.valid = false;
    }
  }

  // Extract party size
  const partySizeMatch = message.match(patterns.party_size);
  if (partySizeMatch && partySizeMatch[1]) {
    const partySize = parseInt(partySizeMatch[1]);
    if (!isNaN(partySize) && partySize >= 1) {
      preferences.party_size = partySize;
    } else {
      preferences.errors.push('Invalid party size (must be >= 1)');
      preferences.valid = false;
    }
  }

  // Extract seat preferences (optional)
  const seatPrefsMatch = message.match(patterns.seat_preferences);
  if (seatPrefsMatch && seatPrefsMatch[1]) {
    preferences.seat_preferences = seatPrefsMatch[1].trim();
  } else {
    preferences.seat_preferences = '';
  }

  // Extract specific preferences (optional)
  const specificPrefsMatch = message.match(patterns.specific_preferences);
  if (specificPrefsMatch && specificPrefsMatch[1]) {
    preferences.specific_preferences = specificPrefsMatch[1].trim();
  } else {
    preferences.specific_preferences = '';
  }

  // Extract selected event IDs (optional)
  const selectedEventsMatch = message.match(patterns.selected_event_ids);
  if (selectedEventsMatch && selectedEventsMatch[1]) {
    preferences.selected_events = selectedEventsMatch[1]
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
  } else {
    preferences.selected_events = [];
  }

  // Prioritized list (mobile screen 20) — authoritative when present; overrides stale Selected lines.
  const prioritizedEventsMatch = message.match(patterns.prioritized_event_ids);
  if (prioritizedEventsMatch && prioritizedEventsMatch[1]) {
    const prioritized = prioritizedEventsMatch[1]
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    if (prioritized.length > 0) {
      preferences.selected_events = prioritized;
    }
  }

  // Extract selected seat categories per event (optional): "eventId1:Category A, eventId2:Category B"
  let selected_seat_categories = [];
  const seatCategoriesMatch = message.match(patterns.selected_seat_categories);
  if (seatCategoriesMatch && seatCategoriesMatch[1]) {
    const parts = seatCategoriesMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx > 0) {
        const event_id = part.slice(0, colonIdx).trim();
        const seat_category = part.slice(colonIdx + 1).trim();
        if (event_id && seat_category) {
          selected_seat_categories.push({ event_id, seat_category });
        }
      }
    }
  }
  preferences.selected_seat_categories = selected_seat_categories;

  let selected_simple_joint_prices = [];
  const sjPricesMatch = message.match(patterns.selected_simple_joint_prices);
  if (sjPricesMatch && sjPricesMatch[1]) {
    const sjParts = sjPricesMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of sjParts) {
      const colonIdx = part.indexOf(':');
      if (colonIdx > 0) {
        const event_id = part.slice(0, colonIdx).trim();
        const rest = part.slice(colonIdx + 1).trim();
        const pipeIdx = rest.indexOf('|');
        const priceStr =
          pipeIdx >= 0 ? rest.slice(0, pipeIdx).trim() : rest;
        const feeStr = pipeIdx >= 0 ? rest.slice(pipeIdx + 1).trim() : '';
        const manual_price = parseFloat(priceStr);
        let the1_fee_percent;
        if (feeStr !== '') {
          const fp = parseFloat(feeStr);
          if (!Number.isNaN(fp) && fp >= 0) {
            the1_fee_percent = Math.min(100, fp);
          }
        }
        if (
          event_id &&
          !Number.isNaN(manual_price) &&
          manual_price >= 0
        ) {
          selected_simple_joint_prices.push({
            event_id,
            manual_price,
            ...(the1_fee_percent != null
              ? { the1_fee_percent }
              : {})
          });
        }
      }
    }
  }
  preferences.selected_simple_joint_prices = selected_simple_joint_prices;

  let selected_the1_negotiated_pricing = [];
  const the1Match = message.match(patterns.selected_the1_negotiated_pricing);
  if (the1Match && the1Match[1]) {
    const t1Parts = the1Match[1]
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    for (const part of t1Parts) {
      const segs = part.split('|').map(s => s.trim());
      if (segs.length >= 4) {
        const [event_id, venueStr, baseStr, feeStr] = segs;
        const the1_base_price = parseFloat(baseStr);
        const the1_fee_percent = parseFloat(feeStr);
        let venue_catalog_price = null;
        if (venueStr !== '' && venueStr != null) {
          const v = parseFloat(venueStr);
          if (!Number.isNaN(v) && v >= 0) venue_catalog_price = v;
        }
        if (
          event_id &&
          !Number.isNaN(the1_base_price) &&
          the1_base_price >= 0 &&
          !Number.isNaN(the1_fee_percent) &&
          the1_fee_percent >= 0
        ) {
          selected_the1_negotiated_pricing.push({
            event_id: String(event_id).trim(),
            venue_catalog_price,
            the1_base_price,
            the1_fee_percent: Math.min(100, the1_fee_percent)
          });
        }
      }
    }
  }
  preferences.selected_the1_negotiated_pricing = selected_the1_negotiated_pricing;

  const adminModeMatch = message.match(patterns.admin_create_mode);
  if (adminModeMatch && adminModeMatch[1]) {
    preferences.admin_create_mode = String(adminModeMatch[1]).trim().toLowerCase();
  }

  const depPctMatch = message.match(patterns.proposal_deposit_percent);
  if (depPctMatch && depPctMatch[1]) {
    const n = parseInt(depPctMatch[1], 10);
    if (!Number.isNaN(n) && n >= 1 && n <= 100) {
      preferences.proposal_deposit_percent = n;
    }
  }

  const pdhMatch = message.match(patterns.proposal_payment_deadline_hours);
  if (pdhMatch && pdhMatch[1]) {
    const h = parseInt(pdhMatch[1], 10);
    if (!Number.isNaN(h) && h >= 0) {
      preferences.proposal_payment_deadline_hours = h;
    }
  }

  // Convert to format compatible with existing preference storage
  const formattedPreferences = {
    city: preferences.city,
    dates: {
      startDate: preferences.startDate,
      endDate: preferences.endDate,
      isRange: true
    },
    budget: {
      min: preferences.budget?.amount || 0,
      max: preferences.budget?.amount || 0,
      currency: preferences.budget?.currency || 'USD'
    },
    party_size: preferences.party_size,
    location_preferences: preferences.city ? [preferences.city] : [],
    seat_preferences: preferences.seat_preferences,
    specific_preferences: preferences.specific_preferences,
    notes: `${preferences.seat_preferences}\n${preferences.specific_preferences}`.trim()
  };

  const result = {
    ...preferences,
    formatted: formattedPreferences,
    raw: {
      client_id: preferences.client_id,
      request_coe_id: preferences.request_coe_id,
      city: preferences.city,
      start_date: preferences.start_date,
      end_date: preferences.end_date,
      budget: preferences.budget,
      party_size: preferences.party_size,
      seat_preferences: preferences.seat_preferences,
      specific_preferences: preferences.specific_preferences,
      selected_events: preferences.selected_events,
      selected_seat_categories: preferences.selected_seat_categories,
      selected_simple_joint_prices: preferences.selected_simple_joint_prices,
      selected_the1_negotiated_pricing: preferences.selected_the1_negotiated_pricing,
      admin_create_mode: preferences.admin_create_mode,
      proposal_deposit_percent: preferences.proposal_deposit_percent,
      proposal_payment_deadline_hours: preferences.proposal_payment_deadline_hours
    }
  };

  console.log('[PREFERENCE SERVICE] ✅ extractPreferencesFromFormSubmission result:', {
    valid: result.valid,
    errors: result.errors,
    extractedFields: {
      client_id: result.client_id,
      city: result.city,
      start_date: result.start_date,
      end_date: result.end_date,
      budget: result.budget,
      party_size: result.party_size,
      hasSeatPreferences: !!result.seat_preferences,
      hasSpecificPreferences: !!result.specific_preferences
    },
    formatted: JSON.stringify(result.formatted, null, 2)
  });

  return result;
}

/**
 * Convert text preferences to sentiment keywords
 * @description Extracts keywords from free-text preferences for sentiment matching
 * Note: This is a basic implementation. Phase 2.3 will enhance this with OpenAI.
 * @param {string} seatPreferences - Seat/table preferences text
 * @param {string} specificPreferences - Specific preferences text
 * @returns {Array<string>} Array of preference keywords
 */
function extractPreferenceKeywords(seatPreferences, specificPreferences) {
  const combinedText = `${seatPreferences || ''} ${specificPreferences || ''}`.toLowerCase();
  
  if (!combinedText.trim()) {
    return [];
  }

  // Keyword mapping to sentiment categories
  const keywordMap = {
    luxury: ['vip', 'premium', 'exclusive', 'elite', 'luxury', 'high-end', 'upscale', 'upscale'],
    music: ['edm', 'electronic', 'house', 'techno', 'hip-hop', 'rap', 'dj', 'live music', 'concert', 'music'],
    atmosphere: ['atmosphere', 'vibe', 'energy', 'ambiance', 'mood', 'party', 'celebration', 'birthday'],
    location: ['near stage', 'by window', 'outdoor', 'indoor', 'private', 'booth', 'table'],
    dining: ['restaurant', 'cuisine', 'chef', 'menu', 'dining', 'food'],
    nightlife: ['nightclub', 'club', 'nightlife', 'night', 'dancing']
  };

  const extractedKeywords = [];
  
  // Check for category keywords
  for (const [category, keywords] of Object.entries(keywordMap)) {
    for (const keyword of keywords) {
      if (combinedText.includes(keyword)) {
        extractedKeywords.push(category);
        break; // Only add category once
      }
    }
  }

  // Also extract specific phrases
  const phrases = [
    'near the stage', 'by the window', 'private booth', 'birthday celebration',
    'upscale atmosphere', 'live dj', 'edm music', 'vip table'
  ];

  for (const phrase of phrases) {
    if (combinedText.includes(phrase)) {
      extractedKeywords.push(phrase);
    }
  }

  // Remove duplicates
  return [...new Set(extractedKeywords)];
}

module.exports = {
  checkSufficientData,
  extractPreferencesFromMessage,
  extractPreferencesFromFormSubmission,
  extractPreferenceKeywords,
  getNextQuestion,
  updateConversationPreferences,
  clearPreferences,
  getPreferences
};


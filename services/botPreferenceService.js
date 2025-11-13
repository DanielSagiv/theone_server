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
  
  // Budget and preferences are optional but help with auto-selection
  // Minimum required: dates
  
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
  
  // Merge with existing preferences
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
      sufficient: sufficient.sufficient
    }
  });
  
  await conversation.save();
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

module.exports = {
  checkSufficientData,
  extractPreferencesFromMessage,
  getNextQuestion,
  updateConversationPreferences,
  clearPreferences,
  getPreferences
};


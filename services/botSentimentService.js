/**
 * Bot Sentiment Matching Service
 * @description Matches user preferences with location/event sentiment data for auto-selection
 */

const Location = require('../models/Location');
const Event = require('../models/Event');

/**
 * Calculate sentiment match score between user preferences and location/event sentiment
 * @param {Array} userPreferences - User preference keywords (e.g., ['nightlife', 'luxury'])
 * @param {Array} locationSentiments - Location sentiment array (type A/B with text)
 * @param {Array} seatSentiments - Seat sentiment array (optional)
 * @returns {number} Match score (0-1)
 */
function calculateSentimentScore(userPreferences, locationSentiments = [], seatSentiments = []) {
  if (!userPreferences || userPreferences.length === 0) {
    return 0.5; // Neutral score if no preferences
  }
  
  if (!locationSentiments || locationSentiments.length === 0) {
    return 0.3; // Lower score if no sentiment data
  }
  
  const allSentiments = [...locationSentiments, ...seatSentiments];
  const sentimentTexts = allSentiments.map(s => s.text?.toLowerCase() || '').join(' ');
  
  let matchCount = 0;
  const preferenceKeywords = {
    nightlife: ['nightlife', 'night', 'club', 'party', 'dancing', 'dj', 'music'],
    dining: ['dining', 'restaurant', 'food', 'cuisine', 'chef', 'menu'],
    luxury: ['luxury', 'premium', 'vip', 'exclusive', 'elite', 'high-end'],
    music: ['music', 'dj', 'live', 'concert', 'performance'],
    atmosphere: ['atmosphere', 'vibe', 'energy', 'ambiance', 'mood']
  };
  
  for (const preference of userPreferences) {
    const keywords = preferenceKeywords[preference] || [preference];
    if (keywords.some(keyword => sentimentTexts.includes(keyword))) {
      matchCount++;
    }
  }
  
  // Score based on match ratio
  const score = matchCount / userPreferences.length;
  return Math.min(score, 1.0);
}

/**
 * Rank events by sentiment match
 * @param {Array} events - Events to rank
 * @param {Array} userPreferences - User preference keywords
 * @returns {Array} Ranked events with sentiment scores
 */
async function rankEventsBySentiment(events, userPreferences = []) {
  if (!events || events.length === 0) {
    return [];
  }
  
  // Populate location data for sentiment access
  const eventsWithLocation = await Event.find({
    _id: { $in: events.map(e => e._id || e) }
  }).populate('location_id', 'sentiment');
  
  const ranked = eventsWithLocation.map(event => {
    const locationSentiments = event.location_id?.sentiment || [];
    
    // Get seat sentiments if available
    const seatSentiments = event.seats?.flatMap(seat => seat.sentiment || []) || [];
    
    const score = calculateSentimentScore(
      userPreferences,
      locationSentiments,
      seatSentiments
    );
    
    return {
      event: event.toObject ? event.toObject() : event,
      sentimentScore: score,
      sentimentHighlights: extractSentimentHighlights(locationSentiments, userPreferences)
    };
  });
  
  // Sort by score (descending)
  ranked.sort((a, b) => b.sentimentScore - a.sentimentScore);
  
  return ranked;
}

/**
 * Extract sentiment highlights relevant to user preferences
 * @param {Array} sentiments - Sentiment array
 * @param {Array} userPreferences - User preference keywords
 * @returns {Array} Relevant sentiment highlights
 */
function extractSentimentHighlights(sentiments, userPreferences = []) {
  if (!sentiments || sentiments.length === 0) {
    return [];
  }
  
  const highlights = [];
  const preferenceKeywords = {
    nightlife: ['nightlife', 'night', 'club', 'party'],
    dining: ['dining', 'restaurant', 'food', 'cuisine'],
    luxury: ['luxury', 'premium', 'vip', 'exclusive'],
    music: ['music', 'dj', 'live', 'concert']
  };
  
  for (const sentiment of sentiments) {
    const text = (sentiment.text || '').toLowerCase();
    
    // Check if sentiment matches any user preference
    const matches = userPreferences.some(pref => {
      const keywords = preferenceKeywords[pref] || [pref];
      return keywords.some(kw => text.includes(kw));
    });
    
    if (matches && sentiment.text) {
      highlights.push({
        text: sentiment.text,
        type: sentiment.type // 'A' or 'B'
      });
    }
  }
  
  return highlights;
}

/**
 * Auto-select events based on sentiment matching
 * @param {Array} events - Available events
 * @param {Object} preferences - User preferences (dates, budget, preferences array)
 * @param {number} maxEvents - Maximum number of events to select
 * @returns {Promise<Array>} Selected events with sentiment data
 */
async function autoSelectEventsBySentiment(events, preferences, maxEvents = 5) {
  if (!events || events.length === 0) {
    return [];
  }
  
  const userPreferences = preferences.preferences || [];
  
  // Rank events by sentiment
  const ranked = await rankEventsBySentiment(events, userPreferences);
  
  // Filter by budget if provided
  let filtered = ranked;
  if (preferences.budget && preferences.budget.max) {
    filtered = ranked.filter(item => {
      const eventPrice = item.event.base_price || 0;
      return eventPrice <= preferences.budget.max;
    });
  }
  
  // Select top N events
  const selected = filtered.slice(0, maxEvents).map(item => ({
    event_id: item.event._id || item.event.id,
    event: item.event,
    sentimentScore: item.sentimentScore,
    sentimentHighlights: item.sentimentHighlights,
    reason: `Matched ${userPreferences.length} preferences with sentiment score ${item.sentimentScore.toFixed(2)}`
  }));
  
  return selected;
}

module.exports = {
  calculateSentimentScore,
  rankEventsBySentiment,
  extractSentimentHighlights,
  autoSelectEventsBySentiment
};


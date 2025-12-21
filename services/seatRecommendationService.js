/**
 * Seat Recommendation Service
 * @description Generates AI-powered recommendations for seats/tables based on sentiments and user preferences
 */

const OpenAI = require('openai');
const crypto = require('crypto');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// In-memory cache for recommendations
const recommendationCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate cache key for recommendation
 * @param {string} locationId - Location ID
 * @param {string} seatCode - Seat code
 * @param {Array} sentiments - Sentiment array
 * @param {Object} userPreferences - User preferences object
 * @returns {string} Cache key
 */
function getCacheKey(locationId, seatCode, sentiments, userPreferences) {
  const sentimentHash = crypto
    .createHash('md5')
    .update(JSON.stringify(sentiments))
    .digest('hex')
    .substring(0, 8);
  
  const preferencesHash = crypto
    .createHash('md5')
    .update(JSON.stringify({
      budget: userPreferences?.budget?.max || userPreferences?.budget_range?.max,
      party_size: userPreferences?.party_size,
      seat_prefs: userPreferences?.seat_preferences || '',
      specific_prefs: userPreferences?.specific_preferences || ''
    }))
    .digest('hex')
    .substring(0, 8);
  
  return `seat_recommendation_${locationId}_${seatCode}_${sentimentHash}_${preferencesHash}`;
}

/**
 * Get cached recommendation
 * @param {string} cacheKey - Cache key
 * @returns {string|null} Cached recommendation or null
 */
function getCachedRecommendation(cacheKey) {
  const cached = recommendationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.recommendation;
  }
  // Clean up expired cache entry
  if (cached) {
    recommendationCache.delete(cacheKey);
  }
  return null;
}

/**
 * Cache recommendation
 * @param {string} cacheKey - Cache key
 * @param {string} recommendation - Recommendation text
 */
function cacheRecommendation(cacheKey, recommendation) {
  recommendationCache.set(cacheKey, {
    recommendation,
    timestamp: Date.now()
  });
  
  // Clean up old cache entries if cache gets too large (keep last 1000)
  if (recommendationCache.size > 1000) {
    const entries = Array.from(recommendationCache.entries())
      .sort((a, b) => b[1].timestamp - a[1].timestamp)
      .slice(0, 1000);
    recommendationCache.clear();
    entries.forEach(([key, value]) => recommendationCache.set(key, value));
  }
}

/**
 * Generate AI recommendation for a seat based on sentiments and user preferences
 * @param {Object} seatData - Seat data including code, category, capacity, section
 * @param {Array} sentiments - Array of sentiment objects with text and type
 * @param {string} locationId - Location ID
 * @param {Object} userPreferences - User preferences from COE build (budget, party_size, seat_preferences, specific_preferences, etc.)
 * @param {Object} options - Options for generation
 * @returns {Promise<string>} Generated recommendation text
 */
async function generateSeatRecommendation(seatData, sentiments, locationId, userPreferences = {}, options = {}) {
  const { useCache = true, timeout = 5000 } = options;

  // If no sentiments, return generic fallback
  if (!sentiments || sentiments.length === 0) {
    return 'A great choice for your experience';
  }

  // Check cache first
  if (useCache && locationId && seatData.code) {
    const cacheKey = getCacheKey(locationId, seatData.code, sentiments, userPreferences);
    const cached = getCachedRecommendation(cacheKey);
    if (cached) {
      console.log('[SEAT_RECOMMENDATION] Using cached recommendation:', {
        seatCode: seatData.code,
        cacheKey: cacheKey.substring(0, 50) + '...'
      });
      return cached;
    }
  }

  // If OpenAI client not available, return fallback
  if (!openaiClient) {
    console.warn('[SEAT_RECOMMENDATION] OpenAI client not available, using fallback');
    return 'Premium seating option with excellent amenities';
  }

  try {
    // Build prompt with user preferences and sentiments
    const positiveSentiments = sentiments.filter(s => s.type === 'A').map(s => s.text);
    const considerationSentiments = sentiments.filter(s => s.type === 'B').map(s => s.text);
    
    // Extract user preferences text
    const budgetText = userPreferences.budget?.max 
      ? `Budget: $${userPreferences.budget.max.toLocaleString()} ${userPreferences.budget?.currency || 'USD'}`
      : userPreferences.budget_range?.max
      ? `Budget: $${userPreferences.budget_range.max.toLocaleString()} USD`
      : '';
    
    const partySizeText = userPreferences.party_size 
      ? `Party size: ${userPreferences.party_size} people`
      : '';
    
    const locationPrefsText = userPreferences.location_preferences && userPreferences.location_preferences.length > 0
      ? `Location preferences: ${userPreferences.location_preferences.join(', ')}`
      : '';
    
    const seatPrefsText = userPreferences.seat_preferences || '';
    const specificPrefsText = userPreferences.specific_preferences || '';
    
    // Build comprehensive prompt
    const prompt = `Generate a short, precise recommendation (max 150 characters, ideally 100-120) for this table/seat that combines the user's preferences and the table's sentiment data.

User Preferences/Needs:
${budgetText ? `- ${budgetText}\n` : ''}${partySizeText ? `- ${partySizeText}\n` : ''}${locationPrefsText ? `- ${locationPrefsText}\n` : ''}${seatPrefsText ? `- Seat/Table preferences: ${seatPrefsText}\n` : ''}${specificPrefsText ? `- Specific preferences: ${specificPrefsText}\n` : ''}
Table Sentiments:
${positiveSentiments.length > 0 ? `Positive aspects (Type A):\n${positiveSentiments.map(s => `- ${s}`).join('\n')}\n` : ''}${considerationSentiments.length > 0 ? `Considerations (Type B):\n${considerationSentiments.map(s => `- ${s}`).join('\n')}\n` : ''}
Table Details:
- Code: ${seatData.code || 'N/A'}
- Category: ${seatData.category || 'N/A'}
- Capacity: ${seatData.capacity || 0} people
${seatData.section ? `- Section: ${seatData.section}\n` : ''}- Price: $${(seatData.event_price || seatData.base_price || 0).toLocaleString()}

The recommendation should:
- Be SHORT and PRECISE (max 150 characters, ideally 100-120)
- Connect the table's strengths (from sentiments) to the user's specific needs
- Highlight why this table is perfect for their party size, preferences, and experience goals
- Use natural, engaging language
- Focus on the experience value, not just features
- If user mentioned specific preferences (e.g., "close to DJ", "quiet area"), address those directly

Generate the recommendation now:`;

    // Call OpenAI with timeout using Promise.race
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    );

    const apiPromise = openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that generates concise, engaging recommendations for premium seating options. Keep responses under 150 characters and make them precise and valuable.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 100
    });

    const completion = await Promise.race([apiPromise, timeoutPromise]);

    const recommendation = completion.choices[0]?.message?.content?.trim() ||
                          'Premium seating option with excellent amenities';

    // Truncate to 150 characters if needed
    const finalRecommendation = recommendation.length > 150 
      ? recommendation.substring(0, 147) + '...'
      : recommendation;

    // Cache the result
    if (useCache && locationId && seatData.code) {
      const cacheKey = getCacheKey(locationId, seatData.code, sentiments, userPreferences);
      cacheRecommendation(cacheKey, finalRecommendation);
    }

    console.log('[SEAT_RECOMMENDATION] Generated recommendation:', {
      seatCode: seatData.code,
      recommendationLength: finalRecommendation.length,
      sentimentsCount: sentiments.length,
      hasUserPreferences: !!userPreferences
    });

    return finalRecommendation;
  } catch (error) {
    if (error.message === 'Request timeout') {
      console.warn('[SEAT_RECOMMENDATION] Request timeout, using fallback');
      return 'Premium seating option with excellent amenities';
    }
    console.error('[SEAT_RECOMMENDATION] Error generating recommendation:', {
      error: error.message,
      seatCode: seatData.code
    });
    return 'Premium seating option with excellent amenities';
  }
}

/**
 * Generate recommendations for multiple seats in batch
 * @param {Array} seats - Array of seat data objects with seatData, sentiments, locationId
 * @param {Object} userPreferences - User preferences from COE build
 * @param {Object} options - Options for generation
 * @returns {Promise<Array>} Array of recommendation objects with seat_code and recommendation
 */
async function generateSeatRecommendations(seats, userPreferences = {}, options = {}) {
  if (!seats || seats.length === 0) {
    return [];
  }

  console.log('[SEAT_RECOMMENDATION] Generating recommendations for', seats.length, 'seats');

  // Generate recommendations in parallel
  const recommendations = await Promise.all(
    seats.map(async ({ seatData, sentiments, locationId }) => {
      try {
        const recommendation = await generateSeatRecommendation(
          seatData,
          sentiments,
          locationId,
          userPreferences,
          options
        );
        return {
          seat_code: seatData.code || seatData.seat_code,
          recommendation,
          generated_at: new Date(),
          version: 1
        };
      } catch (error) {
        console.error('[SEAT_RECOMMENDATION] Error generating recommendation for seat:', {
          seatCode: seatData.code || seatData.seat_code,
          error: error.message
        });
        return {
          seat_code: seatData.code || seatData.seat_code,
          recommendation: 'Premium seating option with excellent amenities',
          generated_at: new Date(),
          version: 1
        };
      }
    })
  );

  console.log('[SEAT_RECOMMENDATION] Generated', recommendations.length, 'recommendations');
  return recommendations;
}

module.exports = {
  generateSeatRecommendation,
  generateSeatRecommendations
};






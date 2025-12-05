/**
 * Bot Sentiment Matching Service
 * @description Matches user preferences with location/event sentiment data for auto-selection
 * Phase 2.3: Enhanced with OpenAI for semantic understanding and matching
 */

const Location = require('../models/Location');
const Event = require('../models/Event');
const OpenAI = require('openai');

// Initialize OpenAI client
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const EMBEDDING_MODEL = 'text-embedding-3-small';

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
 * Helper: Calculate cosine similarity between two vectors
 * @param {Array<number>} vecA
 * @param {Array<number>} vecB
 * @returns {number} Similarity score (0-1, normalized from -1 to 1)
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }
  
  const similarity = dotProduct / denominator;
  // Normalize from [-1, 1] to [0, 1]
  return (similarity + 1) / 2;
}

/**
 * Use OpenAI to extract structured preferences from free text
 * Phase 2.3: Enhanced preference extraction with AI understanding
 * @param {string} seatPreferences - Seat/table preferences text
 * @param {string} specificPreferences - Specific preferences text
 * @returns {Promise<Object>} Structured preferences with categories, keywords, intent
 */
async function extractStructuredPreferences(seatPreferences, specificPreferences) {
  if (!openaiClient) {
    console.warn('[SENTIMENT SERVICE] OpenAI client not available, using fallback keyword extraction');
    return {
      categories: [],
      keywords: [],
      intent: '',
      requirements: [],
      exclusions: [],
      exclusion_intent: '',
      priority: 'medium'
    };
  }

  const combinedText = `${seatPreferences || ''} ${specificPreferences || ''}`.trim();
  if (!combinedText) {
    return {
      categories: [],
      keywords: [],
      intent: '',
      requirements: [],
      exclusions: [],
      exclusion_intent: '',
      priority: 'medium'
    };
  }

  try {
    const prompt = `Extract and categorize user preferences from this text. Pay special attention to negative preferences (things the user does NOT want):
"${combinedText}"

Return JSON with:
{
  "categories": ["luxury", "music", "atmosphere"],
  "keywords": ["VIP", "EDM", "upscale", "birthday"],
  "intent": "special occasion celebration with premium experience",
  "requirements": ["private area", "live music", "upscale atmosphere"],
  "exclusions": ["toilet", "bathroom", "restroom", "noisy"],
  "exclusion_intent": "do not want seats near toilets or bathrooms",
  "priority": "high"
}

IMPORTANT: 
- Extract negative preferences (things user explicitly does NOT want) into the "exclusions" array
- Look for phrases like "do not want", "avoid", "not", "no", "never", "under no circumstances"
- Extract the actual keywords/terms from negative statements (e.g., "do not want toilets" -> "toilet" in exclusions)
- Include a brief "exclusion_intent" description if negative preferences are found`;

    const completion = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at understanding user preferences for events and experiences. You must identify both positive preferences (what they want) and negative preferences (what they do NOT want). Always return valid JSON with exclusions array for negative preferences.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3 // Lower temperature for consistent extraction
    });

    const result = JSON.parse(completion.choices[0].message.content);
    console.log('[SENTIMENT SERVICE] Phase 2.3: Extracted structured preferences:', {
      categories: result.categories?.length || 0,
      keywords: result.keywords?.length || 0,
      exclusions: result.exclusions?.length || 0,
      intent: result.intent?.substring(0, 50) || ''
    });
    
    return {
      categories: result.categories || [],
      keywords: result.keywords || [],
      intent: result.intent || '',
      requirements: result.requirements || [],
      exclusions: result.exclusions || [],
      exclusion_intent: result.exclusion_intent || '',
      priority: result.priority || 'medium'
    };
  } catch (error) {
    console.error('[SENTIMENT SERVICE] Error extracting structured preferences with OpenAI:', error);
    // Fallback to empty structure
    return {
      categories: [],
      keywords: [],
      intent: '',
      requirements: [],
      exclusions: [],
      exclusion_intent: '',
      priority: 'medium'
    };
  }
}

/**
 * Use OpenAI embeddings to calculate semantic similarity
 * Phase 2.3: Semantic matching using embeddings
 * @param {Object} structuredPreferences - Extracted preferences
 * @param {Array} events - Events with sentiment data
 * @returns {Promise<Array>} Events with match scores
 */
async function matchEventsWithEmbeddings(structuredPreferences, events) {
  if (!openaiClient || !events || events.length === 0) {
    return [];
  }

  try {
    // Create embedding for user preferences
    const preferencesText = [
      structuredPreferences.intent,
      ...structuredPreferences.categories,
      ...structuredPreferences.keywords,
      ...structuredPreferences.requirements
    ].filter(Boolean).join(' ');

    if (!preferencesText.trim()) {
      console.warn('[SENTIMENT SERVICE] No preference text for embedding');
      return events.map(event => ({
        event_id: event._id || event.id || event.event_id,
        match_score: 0.3,
        event
      }));
    }

    console.log('[SENTIMENT SERVICE] Phase 2.3: Creating preference embedding...');
    const preferencesEmbedding = await openaiClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: preferencesText
    });

    // Match each event
    console.log('[SENTIMENT SERVICE] Phase 2.3: Matching', events.length, 'events with embeddings...');
    const eventMatches = await Promise.all(events.map(async (event) => {
      try {
        // Get event data - handle both populated and unpopulated location_id
        let locationSentiment = [];
        let seatSentiment = [];
        let locationAttributes = {};
        let eventName = event.name || event.event_name || 'Unknown Event';

        if (event.location_id) {
          // Check if populated (has sentiment property) or just ID
          if (event.location_id.sentiment) {
            locationSentiment = event.location_id.sentiment || [];
            locationAttributes = event.location_id.attributes || {};
          } else if (event.location_id.toString) {
            // Not populated, would need to fetch, but skip for now
            locationSentiment = [];
          }
        }

        // Get seat sentiments if available
        if (event.seats && Array.isArray(event.seats)) {
          seatSentiment = event.seats.flatMap(seat => seat.sentiment || []);
        }

        // Combine all event sentiment and attributes
        const eventText = [
          ...locationSentiment.map(s => s.text),
          ...seatSentiment.map(s => s.text),
          ...(locationAttributes?.musicGenres || []),
          ...(locationAttributes?.cuisine || []),
          locationAttributes?.dressCode || '',
          locationAttributes?.agePolicy || '',
          eventName
        ].filter(Boolean).join(' ');

        if (!eventText.trim()) {
          return {
            event_id: event._id || event.id || event.event_id,
            match_score: 0.3,
            event
          };
        }

        // Get embedding for event
        const eventEmbedding = await openaiClient.embeddings.create({
          model: EMBEDDING_MODEL,
          input: eventText
        });

        // Calculate cosine similarity
        const similarity = cosineSimilarity(
          preferencesEmbedding.data[0].embedding,
          eventEmbedding.data[0].embedding
        );

        return {
          event_id: event._id || event.id || event.event_id,
          match_score: Math.max(0, Math.min(1, similarity)), // Clamp to 0-1
          event
        };
      } catch (error) {
        console.error('[SENTIMENT SERVICE] Error matching event:', error);
        return {
          event_id: event._id || event.id || event.event_id,
          match_score: 0.3,
          event
        };
      }
    }));

    // Sort by match score
    const sorted = eventMatches.sort((a, b) => b.match_score - a.match_score);
    console.log('[SENTIMENT SERVICE] Phase 2.3: Match scores:', sorted.map(m => ({
      event_id: m.event_id,
      score: m.match_score.toFixed(3)
    })));
    
    return sorted;
  } catch (error) {
    console.error('[SENTIMENT SERVICE] Error in matchEventsWithEmbeddings:', error);
    // Fallback: return events with neutral scores
    return events.map(event => ({
      event_id: event._id || event.id || event.event_id,
      match_score: 0.3,
      event
    }));
  }
}

/**
 * Use OpenAI to generate human-readable match reasons
 * Phase 2.3: AI-generated explanations for matches
 * @param {Object} event - Event object
 * @param {Object} structuredPreferences - User preferences
 * @param {number} matchScore - Calculated match score
 * @returns {Promise<Array<string>>} Array of match reasons
 */
async function generateMatchReasons(event, structuredPreferences, matchScore) {
  if (!openaiClient) {
    return [`Match score: ${matchScore.toFixed(2)}`];
  }

  try {
    // Get event data
    let locationSentiment = [];
    let seatSentiment = [];
    let locationAttributes = {};
    let eventName = event.name || event.event_name || 'Unknown Event';

    if (event.location_id && event.location_id.sentiment) {
      locationSentiment = event.location_id.sentiment || [];
      locationAttributes = event.location_id.attributes || {};
    }

    if (event.seats && Array.isArray(event.seats)) {
      seatSentiment = event.seats.flatMap(seat => seat.sentiment || []);
    }

    const prompt = `Explain why this event matches the user's preferences:

User Intent: ${structuredPreferences.intent || 'Not specified'}
User Categories: ${structuredPreferences.categories.join(', ') || 'None'}
User Keywords: ${structuredPreferences.keywords.join(', ') || 'None'}

Event: ${eventName}
Location Sentiment: ${JSON.stringify(locationSentiment.slice(0, 3) || [])}
Seat Sentiment: ${JSON.stringify(seatSentiment.slice(0, 3) || [])}
Attributes: ${JSON.stringify(locationAttributes || {})}

Match Score: ${matchScore.toFixed(2)}

Provide 2-3 concise reasons (one sentence each) explaining the match.
Return as JSON with a "reasons" array: {"reasons": ["reason 1", "reason 2", "reason 3"]}`;

    const completion = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at explaining why events match user preferences. Always return valid JSON with a "reasons" array.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.5 // Slightly higher for more natural explanations
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const reasons = result.reasons || result.match_reasons || [];
    
    if (reasons.length === 0) {
      return [`Match score: ${matchScore.toFixed(2)}`];
    }
    
    return reasons;
  } catch (error) {
    console.error('[SENTIMENT SERVICE] Error generating match reasons:', error);
    return [`Match score: ${matchScore.toFixed(2)}`];
  }
}

/**
 * Filter events by location exclusions
 * Checks if event location name matches any exclusion keywords
 * @param {Array} events - Events to filter (with populated or unpopulated location_id)
 * @param {Array} exclusions - Exclusion keywords from structured preferences
 * @returns {Array} Filtered events (excluded events removed)
 */
/**
 * Filter events by location exclusions
 * Checks if event location name matches any exclusion keywords
 * @param {Array} events - Events to filter (with populated or unpopulated location_id)
 * @param {Array} exclusions - Exclusion keywords from structured preferences
 * @returns {Array} Filtered events (excluded events removed)
 */
function filterEventsByLocationExclusions(events, exclusions) {
  if (!exclusions || exclusions.length === 0) {
    return events;
  }

  const exclusionKeywords = exclusions.map(ex => ex.toLowerCase().trim()).filter(Boolean);
  if (exclusionKeywords.length === 0) {
    return events;
  }

  const filtered = events.filter(item => {
    // Handle both match objects (from embeddings: { event, event_id, match_score })
    // and event objects (from basic matching: { event, sentimentScore })
    const event = item.event || item;
    if (!event) return true;

    // Get location name - handle both populated and unpopulated location_id
    let locationName = '';
    if (event.location_id) {
      if (typeof event.location_id === 'object' && event.location_id.name) {
        // Populated location
        locationName = (event.location_id.name || '').trim();
      } else if (typeof event.location_id === 'string') {
        // Unpopulated location_id (just an ID string) - cannot check exclusion, allow through
        // This is safe because we can't exclude what we can't identify
        return true;
      }
    }

    if (!locationName) {
      // No location name available - allow through (safe default)
      return true;
    }

    // Check if location name matches any exclusion keyword (case-insensitive partial match)
    const locationNameLower = locationName.toLowerCase();
    const matchesExclusion = exclusionKeywords.some(keyword => {
      // Match if location name contains keyword OR keyword contains location name
      // This handles cases like "liv" matching "LIV" or "LIV club"
      return locationNameLower.includes(keyword) || keyword.includes(locationNameLower);
    });

    if (matchesExclusion) {
      const matchedKeyword = exclusionKeywords.find(k => 
        locationNameLower.includes(k) || k.includes(locationNameLower)
      );
      console.log('[SENTIMENT SERVICE] Excluding event due to location exclusion:', {
        event_name: event.name || 'Unknown',
        event_id: event._id?.toString() || event.id || 'N/A',
        location_name: locationName,
        matched_exclusion: matchedKeyword,
        all_exclusions: exclusionKeywords
      });
      return false;
    }

    return true;
  });

  return filtered;
}

/**
 * Auto-select events based on sentiment matching
 * Phase 2.3: Enhanced with OpenAI semantic matching when text preferences are available
 * @param {Array} events - Available events
 * @param {Object} preferences - User preferences (dates, budget, preferences array, seat_preferences, specific_preferences)
 * @param {number} maxEvents - Maximum number of events to select
 * @returns {Promise<Array>} Selected events with sentiment data
 */
async function autoSelectEventsBySentiment(events, preferences, maxEvents = 5) {
  if (!events || events.length === 0) {
    return [];
  }

  // Phase 2.3: Use OpenAI if we have text preferences (seat_preferences or specific_preferences)
  const hasTextPreferences = (preferences.seat_preferences && preferences.seat_preferences.trim()) ||
                            (preferences.specific_preferences && preferences.specific_preferences.trim());

  if (hasTextPreferences && openaiClient) {
    try {
      console.log('[SENTIMENT SERVICE] Phase 2.3: Using OpenAI-enhanced sentiment matching');
      
      // Step 1: Extract structured preferences using OpenAI
      const structuredPrefs = await extractStructuredPreferences(
        preferences.seat_preferences || '',
        preferences.specific_preferences || ''
      );

      // Step 2: Match events using embeddings
      const matchedEvents = await matchEventsWithEmbeddings(structuredPrefs, events);

      // Step 3: Filter by budget if provided
      let filtered = matchedEvents;
      if (preferences.budget && preferences.budget.max) {
        filtered = matchedEvents.filter(match => {
          const eventPrice = match.event?.base_price || 0;
          return eventPrice <= preferences.budget.max;
        });
      }

      // Step 3.5: Filter out events from excluded locations
      if (structuredPrefs.exclusions && structuredPrefs.exclusions.length > 0) {
        const beforeExclusion = filtered.length;
        filtered = filterEventsByLocationExclusions(filtered, structuredPrefs.exclusions);
        console.log('[SENTIMENT SERVICE] Location exclusion filter applied:', {
          exclusions: structuredPrefs.exclusions,
          before: beforeExclusion,
          after: filtered.length,
          excluded: beforeExclusion - filtered.length
        });
      }

      // Step 4: Generate match reasons for top events
      const topEvents = filtered.slice(0, maxEvents);
      const eventsWithReasons = await Promise.all(
        topEvents.map(async (match) => {
          const reasons = await generateMatchReasons(
            match.event,
            structuredPrefs,
            match.match_score
          );

          return {
            event_id: match.event_id,
            event: match.event,
            sentimentScore: match.match_score,
            sentimentHighlights: reasons,
            matchReasons: reasons,
            structuredPreferences: structuredPrefs
          };
        })
      );

      console.log('[SENTIMENT SERVICE] Phase 2.3: Selected', eventsWithReasons.length, 'events with AI matching');
      return eventsWithReasons;
    } catch (error) {
      console.error('[SENTIMENT SERVICE] Phase 2.3: OpenAI matching failed, falling back to basic matching:', error);
      // Fall through to basic matching
    }
  }

  // Fallback to basic keyword-based matching (existing implementation)
  console.log('[SENTIMENT SERVICE] Using basic keyword-based sentiment matching');
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

  // Filter out events from excluded locations (if exclusions provided in preferences)
  const exclusions = preferences.structuredPreferences?.exclusions || 
                     preferences.exclusions || 
                     [];
  if (exclusions.length > 0) {
    const beforeExclusion = filtered.length;
    filtered = filterEventsByLocationExclusions(filtered, exclusions);
    console.log('[SENTIMENT SERVICE] Location exclusion filter applied (basic matching):', {
      exclusions: exclusions,
      before: beforeExclusion,
      after: filtered.length,
      excluded: beforeExclusion - filtered.length
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
  autoSelectEventsBySentiment,
  // Phase 2.3: New OpenAI-based functions
  extractStructuredPreferences,
  matchEventsWithEmbeddings,
  generateMatchReasons,
  cosineSimilarity
};


/**
 * Bot Auto-Fill Service
 * @description Provides advanced auto-fill logic for COE creation including runner assignment,
 * policy extraction, budget-aware selection, and capacity matching
 */

const User = require('../models/User');
const COE = require('../models/COE');
const Event = require('../models/Event');
const Location = require('../models/Location');
const { findLocationSeat } = require('./seatUpgradeService');
const OpenAI = require('openai');

// Initialize OpenAI client for AI-based exclusion detection
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Budget tolerance for seat selection (25% relaxation)
const BUDGET_TOLERANCE_PERCENT = parseFloat(process.env.BUDGET_TOLERANCE_PERCENT) || 0.25; // 25% default

/**
 * Find available runner for COE assignment
 * @param {Date} startDate - COE start date
 * @param {Date} endDate - COE end date
 * @param {string} assignmentType - 'coe' or 'event'
 * @returns {Promise<Object | null>} Available runner or null
 */
async function findAvailableRunner(startDate, endDate, assignmentType = 'coe') {
  try {
    // Get all active runners
    const runners = await User.find({
      role: 'runner',
      isActive: true,
      entity_status: 'live'
    }).select('_id firstName lastName email');

    if (runners.length === 0) {
      return null; // No runners available
    }

    // Check runner availability by looking at existing COE assignments
    const availableRunners = [];
    
    for (const runner of runners) {
      // Check if runner has conflicts during the date range
      const conflictingCOEs = await COE.find({
        $or: [
          // COE-level assignment
          {
            'runner_assignment.type': 'coe',
            'runner_assignment.runner_id': runner._id,
            'runner_assignment.status': { $in: ['assigned', 'confirmed', 'active'] },
            $or: [
              {
                start_date: { $lte: endDate },
                end_date: { $gte: startDate }
              }
            ]
          },
          // Event-level assignments (if assignmentType is 'event')
          {
            'events.runner_assignment.runner_id': runner._id,
            'events.runner_assignment.status': { $in: ['assigned', 'confirmed', 'active'] },
            $or: [
              {
                start_date: { $lte: endDate },
                end_date: { $gte: startDate }
              }
            ]
          }
        ]
      });

      if (conflictingCOEs.length === 0) {
        availableRunners.push(runner);
      }
    }

    // Return first available runner, or null if none available
    return availableRunners.length > 0 ? availableRunners[0] : null;
  } catch (error) {
    console.error('Error finding available runner:', error);
    return null; // Fail gracefully
  }
}

/**
 * Extract policies from location and event data
 * @param {Array} eventIds - Event IDs
 * @returns {Promise<Object>} Policies object
 */
async function extractPoliciesFromEvents(eventIds) {
  try {
    const events = await Event.find({
      _id: { $in: eventIds }
    }).populate('location_id', 'policies');

    const policies = {
      cancellation: null,
      refund: null,
      terms: null,
      notes: []
    };

    // Collect policies from events and locations
    for (const event of events) {
      if (event.policies) {
        policies.notes.push(`Event: ${event.name} - ${event.policies}`);
      }

      if (event.location_id && event.location_id.policies) {
        policies.notes.push(`Location: ${event.location_id.name} - ${event.location_id.policies}`);
      }
    }

    // Combine policies into a single string
    if (policies.notes.length > 0) {
      policies.combined = policies.notes.join('\n\n');
    }

    return policies;
  } catch (error) {
    console.error('Error extracting policies:', error);
    return {
      cancellation: null,
      refund: null,
      terms: null,
      notes: [],
      combined: null
    };
  }
}

/**
 * Calculate seat quality score based on qualityScore field and sentiment bonus
 * @param {Object} eventSeat - Seat from event
 * @param {Object} locationSeat - Corresponding seat from location (with sentiment)
 * @returns {number} Quality score (higher = better)
 */
function calculateSeatScore(eventSeat, locationSeat) {
  // Base score from qualityScore field (1-10) scaled to 10-100
  const qualityScore = locationSeat?.qualityScore || eventSeat?.qualityScore || 5;
  let score = qualityScore * 10;
  
  // Sentiment bonus
  if (locationSeat?.sentiment && Array.isArray(locationSeat.sentiment)) {
    // Type A sentiment = +5, Type B = +2
    const hasTypeA = locationSeat.sentiment.some(s => s.type === 'A');
    if (hasTypeA) score += 5;
    
    // Keyword bonuses
    const sentimentText = locationSeat.sentiment.map(s => (s.text || '').toLowerCase()).join(' ');
    if (sentimentText.includes('vip')) score += 2;
    if (sentimentText.includes('premium')) score += 2;
    if (sentimentText.includes('upper')) score += 2;
    if (sentimentText.includes('front')) score += 1;
    if (sentimentText.includes('center')) score += 1;
  }
  
  return score;
}

/**
 * Use AI to directly check if a seat violates the user's exclusion preference
 * Takes the user's full exclusion preference text and compares it to seat sentiment
 * Returns true if seat should be EXCLUDED (violates user preference), false otherwise
 * @param {string} userExclusionText - User's exclusion preference text (e.g., "I do not want to seat next to the toilets")
 * @param {string} seatSentimentText - Seat sentiment text from database
 * @returns {Promise<boolean>} True if seat violates preference (should exclude), false otherwise
 */
async function checkIfSeatViolatesExclusionPreference(userExclusionText, seatSentimentText) {
  if (!userExclusionText || !seatSentimentText || !userExclusionText.trim() || !seatSentimentText.trim()) {
    return false; // No exclusion preference or no sentiment - don't exclude
  }

  // Fallback pattern matching if no OpenAI client
  if (!openaiClient) {
    // Conservative fallback: don't exclude without AI confirmation
    console.log('[SEAT SELECTION] OpenAI client unavailable - skipping exclusion check (conservative: don\'t exclude)');
    return false;
  }

  try {
    const prompt = `Analyze if this seat description violates the user's exclusion preference.

**User's Exclusion Preference:** "${userExclusionText}"

**Seat Description:** "${seatSentimentText}"

Return JSON with:
{
  "violates_preference": true/false,
  "confidence": "high"/"medium"/"low",
  "reasoning": "brief explanation"
}

IMPORTANT:
- Return "violates_preference": TRUE if the seat description indicates the seat DOES violate the user's exclusion preference
- Return "violates_preference": FALSE if:
  * The seat description says the seat is NOT what the user wants to avoid (e.g., user says "not next to toilets" and seat says "not next to toilets" = FALSE - seat is good)
  * The seat doesn't have the excluded feature
  * The description is unclear

EXAMPLES:
1. User: "I do not want to seat next to the toilets"
   Seat: "next to the toilets" → violates_preference: TRUE (seat IS next to toilets)
   
2. User: "I do not want to seat next to the toilets"
   Seat: "not next to the toilets" → violates_preference: FALSE (seat is NOT next to toilets)
   
3. User: "I do not want to seat next to the toilets"
   Seat: "VIP area, great view" → violates_preference: FALSE (seat doesn't violate preference)
   
4. User: "I do not want to seat near the bathroom"
   Seat: "near the bathroom" → violates_preference: TRUE (seat IS near bathroom)`;

    const completion = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at understanding user preferences and matching them against seat descriptions. You must carefully analyze if a seat violates the user\'s exclusion preference. If the user says "I do not want X" and the seat has "X", it violates. If the seat says "not X", it does NOT violate. Always return valid JSON with violates_preference boolean.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2 // Low temperature for consistent analysis
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const violatesPreference = result.violates_preference === true;
    
    console.log('[SEAT SELECTION] AI exclusion preference check:', {
      user_exclusion: userExclusionText.substring(0, 100),
      sentiment_snippet: seatSentimentText.substring(0, 100),
      violates_preference: violatesPreference,
      confidence: result.confidence,
      reasoning: result.reasoning?.substring(0, 150)
    });
    
    return violatesPreference; // true = exclude, false = don't exclude
  } catch (error) {
    console.error('[SEAT SELECTION] AI exclusion preference check failed:', error.message);
    // Conservative fallback: don't exclude without AI confirmation
    return false;
  }
}

/**
 * Use AI to calculate preference match score between seat sentiment and user positive preferences
 * Uses actual seat sentiment data from database to compare against user preferences
 * Returns score (0-100) where higher = better match with user preferences
 * Falls back to pattern matching if AI is unavailable
 * IMPORTANT: Only performs AI matching if userPreferenceText is provided. If no text, returns 0 (skip AI call).
 * @param {string} sentimentText - Seat sentiment text (lowercase, all sentiment items joined)
 * @param {Object} structuredPreferences - User structured preferences (categories, keywords, requirements, intent)
 * @param {Array} sentimentItems - Optional: Array of sentiment objects with type (A/B) for context
 * @param {string} userPreferenceText - Optional: Original user preference text for better semantic understanding
 * @returns {Promise<number>} Match score (0-100)
 */
async function calculatePreferenceMatchScore(sentimentText, structuredPreferences, sentimentItems = null, userPreferenceText = null) {
  // If no preferences or no sentiment, return neutral score
  if (!structuredPreferences || !sentimentText || !sentimentText.trim()) {
    return 0;
  }
  
  // CRITICAL: Only perform AI preference matching if user has provided preference text
  // If no user text provided, skip AI call entirely (return 0)
  if (!userPreferenceText || !userPreferenceText.trim()) {
    console.log('[SEAT SELECTION] Skipping preference matching - no user preference text provided');
    return 0;
  }

  // Extract positive preferences (exclude exclusions - those are handled separately)
  const categories = structuredPreferences.categories || [];
  const keywords = structuredPreferences.keywords || [];
  const requirements = structuredPreferences.requirements || [];
  const intent = structuredPreferences.intent || '';

  // If no positive preferences, return neutral score
  const hasPositivePreferences = categories.length > 0 || 
                                  keywords.length > 0 || 
                                  requirements.length > 0 || 
                                  intent.trim();
  
  if (!hasPositivePreferences) {
    return 0;
  }

  // Fallback pattern matching if no OpenAI client
  if (!openaiClient) {
    // Simple keyword matching fallback
    const allPositiveTerms = [
      ...categories,
      ...keywords,
      ...requirements,
      intent
    ].filter(Boolean).map(term => term.toLowerCase());

    let matchCount = 0;
    for (const term of allPositiveTerms) {
      if (sentimentText.includes(term.toLowerCase())) {
        matchCount++;
      }
    }

    // Score: (matches / total terms) * 50 (max 50 points for pattern matching)
    const score = allPositiveTerms.length > 0 
      ? Math.round((matchCount / allPositiveTerms.length) * 50)
      : 0;
    
    return score;
  }

  try {
    // Extract sentiment type information if available (Type A = high importance, Type B = standard)
    const typeASentiments = sentimentItems?.filter(s => s.type === 'A').map(s => s.text).filter(Boolean) || [];
    const typeBSentiments = sentimentItems?.filter(s => s.type === 'B').map(s => s.text).filter(Boolean) || [];
    const hasHighImportanceSentiments = typeASentiments.length > 0;

    const prompt = `Analyze how well this seat's sentiment data matches the user's preferences to determine if it's the right seat for them.

**User's Original Preference Text:** "${userPreferenceText}"

**User's Structured Preferences:**
- Categories: ${categories.join(', ') || 'None'}
- Keywords: ${keywords.join(', ') || 'None'}
- Requirements: ${requirements.join(', ') || 'None'}
- Intent: ${intent || 'Not specified'}

**Seat Sentiment Data** (actual data from database):
"${sentimentText}"
${hasHighImportanceSentiments ? `\n**High Importance Features (Type A):** ${typeASentiments.join(', ')}` : ''}
${typeBSentiments.length > 0 ? `**Standard Features (Type B):** ${typeBSentiments.slice(0, 3).join(', ')}${typeBSentiments.length > 3 ? '...' : ''}` : ''}

Return JSON with:
{
  "match_score": 0-100,
  "confidence": "high"/"medium"/"low",
  "reasoning": "brief explanation of why this seat matches or doesn't match user preferences"
}

IMPORTANT:
- This is SEAT SENTIMENT DATA from the venue database - analyze it thoroughly
- Use the user's original preference text to understand full context and intent
- Compare the seat's actual features (from sentiment) against what the user wants
- Return match_score 0-100 where:
  * 80-100: Excellent match (seat sentiment strongly aligns with user preferences, fulfills requirements)
  * 50-79: Good match (seat partially aligns with preferences, some requirements met)
  * 20-49: Weak match (seat has some related features but doesn't strongly match)
  * 0-19: Poor match (seat doesn't align with preferences, doesn't meet requirements)
- Consider semantic meaning, not just keyword matching
- Use the original text to understand user intent and context
- Higher scores for seats that fulfill specific requirements or match user intent
- Give more weight to Type A (high importance) sentiment features if they match user preferences
- Lower scores if seat conflicts with preferences (though exclusions are handled separately)
- Example: User wants "birthday, VIP area" and seat sentiment says "VIP area, great for celebrations" = HIGH match score`;

    const completion = await openaiClient.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at analyzing seat sentiment data from venue databases to match with user preferences. You understand that seat sentiment data describes actual seat features and characteristics. You must analyze semantic meaning, understand user intent from the original preference text, and compare seat features against user requirements. Always return valid JSON with match_score 0-100.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3 // Low temperature for consistent scoring
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const matchScore = Math.max(0, Math.min(100, result.match_score || 0)); // Clamp to 0-100
    
    console.log('[SEAT SELECTION] AI preference match score:', {
      matchScore,
      confidence: result.confidence,
      reasoning: result.reasoning?.substring(0, 100),
      preferences: {
        categories: categories.length,
        keywords: keywords.length,
        requirements: requirements.length,
        hasIntent: !!intent
      }
    });
    
    return matchScore;
  } catch (error) {
    console.error('[SEAT SELECTION] AI preference match failed, using fallback:', error.message);
    // Fallback to pattern matching on error
    const allPositiveTerms = [
      ...categories,
      ...keywords,
      ...requirements,
      intent
    ].filter(Boolean).map(term => term.toLowerCase());

    let matchCount = 0;
    for (const term of allPositiveTerms) {
      if (sentimentText.includes(term.toLowerCase())) {
        matchCount++;
      }
    }

    const score = allPositiveTerms.length > 0 
      ? Math.round((matchCount / allPositiveTerms.length) * 50)
      : 0;
    
    return score;
  }
}

/**
 * Select seats based on budget and capacity with quality-based scoring
 * Prioritizes: 1) Quality score, 2) Budget maximization, 3) Exclusion filtering
 * @param {Object} event - Event object (may have populated location_id with seats)
 * @param {Object} preferences - User preferences (budget, party_size, structuredPreferences with exclusions)
 * @param {number} remainingBudget - Remaining budget after other selections
 * @returns {Array} Selected seats
 */
/**
 * Select seats by budget and capacity with diagnostic information.
 * If preferredCategory is provided, only seats in that category (seat.category || 'General') are considered.
 * @param {Object} event - Event object with seats
 * @param {Object} preferences - User preferences
 * @param {number} remainingBudget - Remaining budget
 * @param {string} [preferredCategory] - Optional seat category/tier to restrict selection (e.g. "VIP Table")
 * @returns {Object} { seats: Array, diagnostics: Object }
 */
async function selectSeatsByBudgetAndCapacity(event, preferences = {}, remainingBudget = null, preferredCategory = null) {
  const finalBudget = remainingBudget || preferences.budget?.max || preferences.budget_range?.max || Infinity;
  // #region agent log
  try {
    fetch('http://127.0.0.1:7243/ingest/48279e3e-9368-4b19-b1f9-b96a74363f47',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f9384'},body:JSON.stringify({sessionId:'5f9384',location:'botAutoFillService.js:selectSeatsEntry',message:'selectSeatsByBudgetAndCapacity entry',data:{eventId:event?._id?.toString(),eventSeatsCount:event?.seats?.length||0,finalBudget,preferredCategory,party_size:preferences?.party_size},timestamp:Date.now(),hypothesisId:'H1,H3,H4'})}).catch(()=>{});
  } catch (_) {}
  // #endregion
  console.log('[BOT] [COE_CREATION_DEBUG] selectSeatsByBudgetAndCapacity called:', {
    eventId: event._id?.toString() || null,
    eventName: event.name || 'Unknown Event',
    remainingBudget: remainingBudget,
    remainingBudgetType: typeof remainingBudget,
    preferencesBudgetMax: preferences.budget?.max,
    preferencesBudgetMaxType: typeof preferences.budget?.max,
    preferencesBudgetRangeMax: preferences.budget_range?.max,
    preferencesBudgetRangeMaxType: typeof preferences.budget_range?.max,
    finalBudget: finalBudget,
    finalBudgetType: typeof finalBudget,
    partySize: preferences.party_size || 2,
    fullPreferences: JSON.stringify({
      budget: preferences.budget,
      budget_range: preferences.budget_range,
      party_size: preferences.party_size
    }, null, 2)
  });
  
  // Initialize diagnostics
  const diagnostics = {
    event_id: event._id?.toString() || null,
    event_name: event.name || 'Unknown Event',
    total_seats: event.seats?.length || 0,
    party_size: preferences.party_size || 2,
    budget: finalBudget,
    exclusions: preferences.structuredPreferences?.exclusions || preferences.exclusions || [],
    filtering_stages: {
      initial_count: event.seats?.length || 0,
      after_status_filter: 0,
      after_category_filter: 0,
      after_capacity_filter: 0,
      after_budget_filter: 0,
      after_exclusion_filter: 0,
      final_count: 0
    },
    primary_reason: null,
    secondary_reasons: [],
    details: {}
  };

  if (!event.seats || event.seats.length === 0) {
    diagnostics.primary_reason = 'NO_SEATS_IN_EVENT';
    diagnostics.details.no_seats_in_event = {
      event_id: diagnostics.event_id,
      event_name: diagnostics.event_name
    };
    return { seats: [], diagnostics };
  }

  const partySize = preferences.party_size || 2; // Default to 2
  const budget = finalBudget;

  console.log('[BOT] [COE_CREATION_DEBUG] Seat selection parameters:', {
    eventId: event._id?.toString(),
    eventName: event.name,
    partySize: partySize,
    budget: budget,
    budgetType: typeof budget,
    isInfinity: budget === Infinity,
    totalSeats: event.seats?.length || 0
  });

  // Get structured preferences for use in both exclusions and positive preference matching
  const structuredPreferences = preferences.structuredPreferences || null;
  
  // Get user's exclusion preference text (from seat_preferences or exclusion_intent)
  // CRITICAL: When user has explicitly selected a seat category (e.g. "upper_dance"), do NOT use
  // the generic "Seat and general preferences" free text as exclusion input—that field is for
  // notes and positive preferences. Using it as exclusion causes vague text (e.g. "This and that")
  // to be interpreted by AI as something to avoid, excluding the only matching seat and causing
  // "No available seats/tables". Use only explicit exclusion_intent when preferredCategory is set.
  const hasExplicitCategory = preferredCategory && typeof preferredCategory === 'string' && preferredCategory.trim();
  const userExclusionText = hasExplicitCategory
    ? (typeof structuredPreferences?.exclusion_intent === 'string' && structuredPreferences.exclusion_intent.trim())
        ? structuredPreferences.exclusion_intent.trim()
        : null
    : ((typeof preferences.seat_preferences === 'string' && preferences.seat_preferences.trim()) ||
       (typeof structuredPreferences?.exclusion_intent === 'string' && structuredPreferences.exclusion_intent.trim()) ||
       (typeof preferences.notes === 'string' && preferences.notes.trim()) ||
       null);
  
  // Get exclusions array for diagnostics/error messages (populate matchingKeywords for error messages)
  const exclusions = structuredPreferences?.exclusions || 
                     preferences.exclusions || 
                     [];

  // Get location with seats if not already populated
  let location = event.location_id;
  if (!location || !location.seats || (typeof location === 'object' && location._id && !location.seats)) {
    if (event.location_id) {
      const locationId = (location && location._id) ? location._id : (typeof location === 'string' ? location : event.location_id);
      location = await Location.findById(locationId).select('seats');
    }
  }

  // Stage 1: Filter by status (available only)
  let availableSeats = event.seats.filter(seat => seat.status === 'available');
  diagnostics.filtering_stages.after_status_filter = availableSeats.length;

  // Stage 1b: Filter by preferred category/tier if user chose one (e.g. from COE event selection)
  if (preferredCategory && typeof preferredCategory === 'string' && preferredCategory.trim()) {
    const categoryFilter = preferredCategory.trim();
    const beforeCategory = availableSeats.length;
    availableSeats = availableSeats.filter(seat => (seat.category || 'General') === categoryFilter);
    diagnostics.filtering_stages.after_category_filter = availableSeats.length;
    if (availableSeats.length === 0 && beforeCategory > 0) {
      diagnostics.primary_reason = 'NO_SEATS_IN_PREFERRED_CATEGORY';
      diagnostics.details.preferred_category = {
        requested_category: categoryFilter,
        available_seats_before_filter: beforeCategory,
        event_categories: [...new Set(event.seats.map(s => s.category || 'General'))],
      };
      // #region agent log
      try {
        fetch('http://127.0.0.1:7243/ingest/48279e3e-9368-4b19-b1f9-b96a74363f47',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f9384'},body:JSON.stringify({sessionId:'5f9384',location:'botAutoFillService.js:returnNoSeatsCategory',message:'Returning no seats: NO_SEATS_IN_PREFERRED_CATEGORY',data:diagnostics.details.preferred_category,timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
      } catch (_) {}
      // #endregion
      return { seats: [], diagnostics };
    }
  } else {
    diagnostics.filtering_stages.after_category_filter = availableSeats.length;
  }

  if (availableSeats.length === 0) {
    const statusCounts = {
      total: event.seats.length,
      available: event.seats.filter(s => s.status === 'available').length,
      booked: event.seats.filter(s => s.status === 'booked').length,
      held: event.seats.filter(s => s.status === 'held').length,
      blocked: event.seats.filter(s => s.status === 'blocked').length
    };
    diagnostics.primary_reason = 'NO_AVAILABLE_SEATS';
    diagnostics.details.no_available_seats = statusCounts;
    return { seats: [], diagnostics };
  }

  // Stage 2: Filter by capacity
  availableSeats = availableSeats.filter(seat => seat.capacity >= partySize);
  diagnostics.filtering_stages.after_capacity_filter = availableSeats.length;

  if (availableSeats.length === 0) {
    const capacities = event.seats.map(s => s.capacity || 0).filter(c => c > 0);
    const maxCapacity = capacities.length > 0 ? Math.max(...capacities) : 0;
    diagnostics.primary_reason = 'CAPACITY_TOO_SMALL';
    diagnostics.details.capacity_too_small = {
      party_size: partySize,
      max_capacity_found: maxCapacity,
      seats_with_sufficient_capacity: 0
    };
    diagnostics.secondary_reasons.push('NO_AVAILABLE_SEATS'); // Also no available seats
    // #region agent log
    try {
      fetch('http://127.0.0.1:7243/ingest/48279e3e-9368-4b19-b1f9-b96a74363f47',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f9384'},body:JSON.stringify({sessionId:'5f9384',location:'botAutoFillService.js:returnNoSeatsCapacity',message:'Returning no seats: CAPACITY_TOO_SMALL',data:diagnostics.details.capacity_too_small,timestamp:Date.now(),hypothesisId:'H5'})}).catch(()=>{});
    } catch (_) {}
    // #endregion
    return { seats: [], diagnostics };
  }

  // Stage 3: Filter by budget
  console.log('[BOT] [COE_CREATION_DEBUG] Before budget filter:', {
    eventId: event._id?.toString(),
    eventName: event.name,
    seatsAfterCapacityFilter: availableSeats.length,
    budget: budget,
    budgetType: typeof budget,
    isInfinity: budget === Infinity
  });
  
  // Log all seat prices for debugging
  const allSeatPrices = availableSeats.map(seat => ({
    seat_id: seat._id?.toString(),
    seat_code: seat.code,
    event_price: seat.event_price,
    min_spend: seat.min_spend,
    price_used: seat.event_price || seat.min_spend || 0
  }));
  console.log('[BOT] [COE_CREATION_DEBUG] Seat prices before budget filter:', {
    eventId: event._id?.toString(),
    seatCount: allSeatPrices.length,
    seatPrices: allSeatPrices.slice(0, 10), // Log first 10 to avoid spam
    minPrice: allSeatPrices.length > 0 ? Math.min(...allSeatPrices.map(s => s.price_used).filter(p => p > 0)) : 0,
    maxPrice: allSeatPrices.length > 0 ? Math.max(...allSeatPrices.map(s => s.price_used)) : 0
  });
  
  // Calculate relaxed budget with 25% tolerance
  const relaxedBudget = budget === Infinity ? Infinity : budget * (1 + BUDGET_TOLERANCE_PERCENT);
  
  console.log('[BOT] [COE_CREATION_DEBUG] Budget tolerance applied:', {
    originalBudget: budget,
    relaxedBudget: relaxedBudget,
    tolerancePercent: (BUDGET_TOLERANCE_PERCENT * 100).toFixed(0) + '%',
    toleranceAmount: budget !== Infinity ? (budget * BUDGET_TOLERANCE_PERCENT) : null
  });
  
  availableSeats = availableSeats.filter(seat => {
    const price = seat.event_price || seat.min_spend || 0;
    const withinBudget = budget === Infinity || price <= relaxedBudget;
    
    if (!withinBudget) {
      console.log('[BOT] [COE_CREATION_DEBUG] Seat excluded by budget:', {
        seat_id: seat._id?.toString(),
        seat_code: seat.code,
        price: price,
        originalBudget: budget,
        relaxedBudget: relaxedBudget,
        tolerance: `${(BUDGET_TOLERANCE_PERCENT * 100).toFixed(0)}%`,
        comparison: `${price} <= ${relaxedBudget} = ${withinBudget}`
      });
    } else if (price > budget && price <= relaxedBudget) {
      // Log when seat exceeds original budget but is within tolerance
      console.log('[BOT] [COE_CREATION_DEBUG] Seat within budget tolerance:', {
        seat_id: seat._id?.toString(),
        seat_code: seat.code,
        price: price,
        originalBudget: budget,
        relaxedBudget: relaxedBudget,
        overBudget: price - budget,
        overBudgetPercent: ((price - budget) / budget * 100).toFixed(1) + '%'
      });
    }
    
    return withinBudget;
  });
  diagnostics.filtering_stages.after_budget_filter = availableSeats.length;

  console.log('[BOT] [COE_CREATION_DEBUG] After budget filter:', {
    eventId: event._id?.toString(),
    eventName: event.name,
    seatsAfterBudgetFilter: availableSeats.length,
    seatsExcludedByBudget: diagnostics.filtering_stages.after_capacity_filter - availableSeats.length
  });

  if (availableSeats.length === 0) {
    const prices = event.seats
      .map(s => s.event_price || s.min_spend || 0)
      .filter(p => p > 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    
    const relaxedBudget = budget === Infinity ? null : budget * (1 + BUDGET_TOLERANCE_PERCENT);
    
    // Count seats within relaxed budget
    const seatsWithinRelaxedBudget = prices.filter(p => p <= relaxedBudget).length;
    
    console.log('[BOT] [COE_CREATION_DEBUG] BUDGET_TOO_LOW diagnostic created:', {
      eventId: event._id?.toString(),
      eventName: event.name,
      budget: budget,
      relaxedBudget: relaxedBudget,
      budgetType: typeof budget,
      isInfinity: budget === Infinity,
      tolerance: `${(BUDGET_TOLERANCE_PERCENT * 100).toFixed(0)}%`,
      minPrice: minPrice,
      maxPrice: maxPrice,
      totalSeatsChecked: event.seats?.length || 0,
      seatsWithPrices: prices.length,
      seatsWithinRelaxedBudget: seatsWithinRelaxedBudget,
      diagnostic: {
        budget: budget === Infinity ? null : budget,
        relaxed_budget: relaxedBudget,
        budget_tolerance_percent: BUDGET_TOLERANCE_PERCENT * 100,
        min_seat_price: minPrice,
        max_seat_price: maxPrice,
        seats_within_budget: 0,
        seats_within_relaxed_budget: seatsWithinRelaxedBudget
      }
    });
    
    diagnostics.primary_reason = 'BUDGET_TOO_LOW';
    diagnostics.details.budget_too_low = {
      budget: budget === Infinity ? null : budget,
      relaxed_budget: relaxedBudget,
      budget_tolerance_percent: BUDGET_TOLERANCE_PERCENT * 100,
      min_seat_price: minPrice,
      max_seat_price: maxPrice,
      seats_within_budget: 0,
      seats_within_relaxed_budget: seatsWithinRelaxedBudget
    };
    diagnostics.secondary_reasons.push('NO_AVAILABLE_SEATS'); // Also no available seats
    // #region agent log
    try {
      fetch('http://127.0.0.1:7243/ingest/48279e3e-9368-4b19-b1f9-b96a74363f47',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f9384'},body:JSON.stringify({sessionId:'5f9384',location:'botAutoFillService.js:returnNoSeatsBudget',message:'Returning no seats: BUDGET_TOO_LOW',data:diagnostics.details.budget_too_low,timestamp:Date.now(),hypothesisId:'H1'})}).catch(()=>{});
    } catch (_) {}
    // #endregion
    return { seats: [], diagnostics };
  }

  // Stage 4: Filter out seats that violate user's exclusion preferences (AI-only, no keyword matching)
  let seatsExcludedCount = 0;
  const matchingKeywords = [];
  
  // CRITICAL: Only perform exclusion filtering if user has provided exclusion preference text
  // If no user exclusion text, skip this stage entirely (no AI calls, all seats pass through)
  if (userExclusionText && userExclusionText.trim() && location && location.seats && Array.isArray(location.seats)) {
    const beforeExclusion = availableSeats.length;
    
    console.log('[SEAT SELECTION] Starting exclusion filter with user preference:', {
      user_exclusion_text: userExclusionText.substring(0, 150),
      seats_to_check: availableSeats.length
    });
    
    // Populate matchingKeywords from exclusions array for error messages (extracted keywords for display)
    if (exclusions && exclusions.length > 0) {
      exclusions.forEach(ex => {
        if (!matchingKeywords.includes(ex)) {
          matchingKeywords.push(ex);
        }
      });
    }
    
    // Convert filter to async Promise.all since we need AI calls
    const seatFilterResults = await Promise.all(
      availableSeats.map(async (eventSeat) => {
        // Use helper function that prioritizes seat_id matching (stable reference)
        const locationSeat = findLocationSeat(eventSeat, location);
        
        if (!locationSeat || !locationSeat.sentiment || !Array.isArray(locationSeat.sentiment)) {
          // No sentiment - allow through (can't determine if it violates preference without sentiment)
          return { eventSeat, shouldInclude: true };
        }
        
        const locationSeatSentimentText = locationSeat.sentiment
          .map(s => (s.text || '').toLowerCase())
          .join(' ');
        
        // Use AI to directly check if this seat violates the user's exclusion preference
        const violatesPreference = await checkIfSeatViolatesExclusionPreference(
          userExclusionText,
          locationSeatSentimentText
        );
        
        console.log('[SEAT SELECTION] Exclusion preference check result:', {
          seat_code: eventSeat.code,
          seat_id: eventSeat.seat_id?.toString(),
          seat_price: eventSeat.event_price || eventSeat.min_spend || 0,
          user_exclusion: userExclusionText.substring(0, 100),
          sentiment_snippet: locationSeatSentimentText.substring(0, 100),
          full_sentiment: locationSeatSentimentText,
          violates_preference: violatesPreference,
          final_decision: violatesPreference ? 'EXCLUDE' : 'INCLUDE'
        });
        
        if (violatesPreference) {
          console.log('[SEAT SELECTION] ✓ Excluding seat - AI confirmed seat violates user exclusion preference:', {
            seat_code: eventSeat.code,
            seat_price: eventSeat.event_price || eventSeat.min_spend || 0,
            user_exclusion: userExclusionText.substring(0, 80),
            sentiment_snippet: locationSeatSentimentText.substring(0, 80)
          });
          return { eventSeat, shouldInclude: false };
        } else {
          console.log('[SEAT SELECTION] ✗ NOT excluding seat - AI confirmed seat does NOT violate user preference:', {
            seat_code: eventSeat.code,
            seat_price: eventSeat.event_price || eventSeat.min_spend || 0,
            sentiment_snippet: locationSeatSentimentText.substring(0, 80)
          });
          return { eventSeat, shouldInclude: true };
        }
      })
    );
    
    // Filter seats based on results
    availableSeats = seatFilterResults
      .filter(result => result.shouldInclude)
      .map(result => result.eventSeat);
    
    seatsExcludedCount = beforeExclusion - availableSeats.length;
    diagnostics.filtering_stages.after_exclusion_filter = availableSeats.length;
    
    if (availableSeats.length === 0 && beforeExclusion > 0) {
      diagnostics.primary_reason = 'EXCLUDED_BY_PREFERENCES';
      diagnostics.details.excluded_by_preferences = {
        exclusions: exclusions,
        seats_excluded: seatsExcludedCount,
        matching_keywords: matchingKeywords
      };
      return { seats: [], diagnostics };
    }
  } else {
    // No user exclusion preference text - skip exclusion filtering entirely (no AI calls)
    if (!userExclusionText || !userExclusionText.trim()) {
      console.log('[SEAT SELECTION] Skipping exclusion filtering - no user exclusion preference text provided');
    }
    diagnostics.filtering_stages.after_exclusion_filter = availableSeats.length;
  }

  // If we reach here, we have seats available
  diagnostics.filtering_stages.final_count = availableSeats.length;
  diagnostics.primary_reason = null; // Success - no reason needed

  // Score all seats: quality score + preference match score (AI-enhanced)
  // Use Promise.all for async preference matching
  const scoredSeats = await Promise.all(
    availableSeats.map(async (eventSeat) => {
      // Find corresponding location seat by code (primary) or seat_id
      const locationSeat = location?.seats?.find(locSeat => {
        if (locSeat.code === eventSeat.code) return true;
        const eventSeatId = eventSeat.seat_id ? eventSeat.seat_id.toString() : null;
        const locSeatId = locSeat._id ? locSeat._id.toString() : null;
        return eventSeatId && locSeatId && locSeatId === eventSeatId;
      });
      
      // Calculate quality score (existing logic)
      const qualityScore = calculateSeatScore(eventSeat, locationSeat);
      
      // Calculate preference match score if we have structured preferences and user preference text
      // Use actual seat sentiment data to compare against user preferences
      // CRITICAL: Only perform AI preference matching if user has provided preference text
      let preferenceMatchScore = 0;
      
      // Get user's positive preference text (for positive preference matching, not exclusions)
      const userPreferenceText = (typeof preferences.seat_preferences === 'string' && preferences.seat_preferences.trim()) ||
                                (typeof preferences.specific_preferences === 'string' && preferences.specific_preferences.trim()) ||
                                (typeof preferences.notes === 'string' && preferences.notes.trim()) ||
                                (typeof structuredPreferences?.intent === 'string' && structuredPreferences.intent.trim()) ||
                                null;
      
      // ONLY perform preference matching if user has provided preference text AND we have sentiment
      if (userPreferenceText && structuredPreferences && locationSeat?.sentiment && Array.isArray(locationSeat.sentiment)) {
        const locationSeatSentimentText = locationSeat.sentiment
          .map(s => (s.text || '').toLowerCase())
          .join(' ');
        
        // Pass sentiment items array and user preference text for better AI understanding
        preferenceMatchScore = await calculatePreferenceMatchScore(
          locationSeatSentimentText,
          structuredPreferences,
          locationSeat.sentiment, // Pass full sentiment array to include type information
          userPreferenceText // Pass original user preference text for semantic matching
        );
      } else if (!userPreferenceText) {
        // No user preference text - skip AI preference matching (score = 0)
        console.log('[SEAT SELECTION] Skipping preference matching for seat - no user preference text provided:', {
          seat_code: eventSeat.code
        });
      }
      
      // Combined score: quality score (10-100+) + preference match score (0-100)
      // Quality score typically ranges 50-150, preference match 0-100
      // Weight: 60% quality + 40% preference (preference match is bonus on top)
      const combinedScore = qualityScore + Math.round(preferenceMatchScore * 0.4);
      
      const price = eventSeat.event_price || eventSeat.min_spend || 0;
      
      return {
        seat: eventSeat,
        score: combinedScore,
        qualityScore: qualityScore,
        preferenceMatchScore: preferenceMatchScore,
        price
      };
    })
  );
  
  // Sort by combined score DESC, then price DESC (higher price preferred to maximize budget utilization)
  scoredSeats.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.price - a.price; // Prefer higher price among same score to max budget
  });

  console.log('[SEAT SELECTION] Scored seats:', {
    event_name: event.name,
    total_available: scoredSeats.length,
    top_seat: scoredSeats[0] ? {
      code: scoredSeats[0].seat.code,
      combined_score: scoredSeats[0].score,
      quality_score: scoredSeats[0].qualityScore,
      preference_match_score: scoredSeats[0].preferenceMatchScore,
      price: scoredSeats[0].price
    } : null,
    has_preferences: !!(structuredPreferences && (
      structuredPreferences.categories?.length > 0 ||
      structuredPreferences.keywords?.length > 0 ||
      structuredPreferences.requirements?.length > 0 ||
      structuredPreferences.intent
    ))
  });

  // Select the best seat (highest score, and among same score, highest price)
  const selectedSeat = scoredSeats[0].seat;
  
  const selectedSeats = [{
    seat_id: selectedSeat._id,
    seat_code: selectedSeat.code,
    capacity: selectedSeat.capacity,
    base_price: selectedSeat.min_spend || 0,
    event_price: selectedSeat.event_price || selectedSeat.min_spend || 0,
    available_from: event.start_datetime,
    available_until: event.end_datetime || event.start_datetime,
    status: 'selected'
  }];

  return { seats: selectedSeats, diagnostics };
}

/**
 * Match party size to seat capacity
 * @param {number} partySize - Number of people
 * @param {Array} seats - Available seats
 * @returns {Array} Matching seats
 */
function matchCapacity(partySize, seats) {
  return seats.filter(seat => 
    seat.capacity >= partySize
  );
}

/**
 * Calculate total cost for selected seats
 * @param {Array} selectedSeats - Selected seats array
 * @returns {Object} Cost breakdown
 */
function calculateSeatCosts(selectedSeats) {
  console.log('[CALCULATE_COSTS] Input seats:', selectedSeats.length);
  selectedSeats.forEach((seat, idx) => {
    console.log(`[CALCULATE_COSTS] Seat ${idx + 1}:`, {
      seat_code: seat.seat_code,
      event_price: seat.event_price,
      base_price: seat.base_price,
      price_used: seat.event_price || seat.base_price || 0
    });
  });
  
  const subtotal = selectedSeats.reduce((sum, seat) => {
    const price = seat.event_price || seat.base_price || 0;
    console.log('[CALCULATE_COSTS] Adding price:', price, 'Running sum:', sum + price);
    return sum + price;
  }, 0);
  
  const taxes = subtotal * 0.30; // 30% default
  const fees = 0; // Default 0
  const total = subtotal + taxes + fees;
  const depositRequired = total * 0.20; // 20% default

  console.log('[CALCULATE_COSTS] Final calculation:', {
    subtotal,
    taxes,
    fees,
    total,
    depositRequired
  });

  return {
    subtotal,
    taxes,
    fees,
    total,
    depositRequired
  };
}

/**
 * Auto-fill COE data with advanced logic
 * @param {Object} baseData - Base COE data (name, dates, client_id, etc.)
 * @param {Object} preferences - User preferences
 * @param {Array} selectedEvents - Selected events (with sentiment scores if available)
 * @returns {Promise<Object>} Complete COE data with auto-filled fields
 */
async function autoFillCOEData(baseData, preferences = {}, selectedEvents = []) {
  const autoFilled = { ...baseData };

  // 1. Policy Extraction
  if (selectedEvents.length > 0) {
    const eventIds = selectedEvents.map(e => e.event_id || e._id || e);
    const policies = await extractPoliciesFromEvents(eventIds);
    
    if (policies.combined) {
      autoFilled.policies = policies.combined;
    }
  }

  // 2. Budget-aware seat selection (if events provided)
  // Only auto-select seats if baseData doesn't already have selected_seats
  if (selectedEvents.length > 0 && preferences.budget && (!baseData.selected_seats || baseData.selected_seats.length === 0)) {
    let remainingBudget = preferences.budget.max;
    const allSelectedSeats = [];

    for (const eventData of selectedEvents) {
      const eventId = eventData.event_id || eventData._id || eventData;
      if (!eventId) continue;
      
      // Fetch event with location populated (including seats for sentiment checking)
      const event = await Event.findById(eventId)
        .populate('location_id', 'seats');
      if (!event) continue;

      // Ensure structured preferences (including exclusions) are passed through
      const preferencesWithStructured = {
        ...preferences,
        structuredPreferences: preferences.structuredPreferences || 
                               (selectedEvents.find(e => (e.event_id || e._id || e) === eventId)?.structuredPreferences) ||
                               null
      };
      const seatResult = await selectSeatsByBudgetAndCapacity(
        event,
        preferencesWithStructured,
        remainingBudget
      );
      
      // Handle both old format (array) and new format (object with seats/diagnostics)
      const seats = Array.isArray(seatResult) ? seatResult : (seatResult.seats || []);
      const seatDiagnostics = Array.isArray(seatResult) ? null : (seatResult.diagnostics || null);

      if (seats.length > 0) {
        // Validate seats exist in event before adding
        const validSeats = seats.filter(seat => {
          if (!seat.seat_id) {
            console.warn('[AUTO-FILL] Warning: Seat missing seat_id:', seat);
            return false;
          }
          
          // Find seat in event to ensure it exists
          const seatIdStr = seat.seat_id.toString();
          const eventSeat = event.seats.find(s => {
            const sId = s._id ? s._id.toString() : null;
            return sId === seatIdStr;
          });
          
          if (!eventSeat) {
            console.warn('[AUTO-FILL] Warning: Seat not found in event, skipping:', {
              seat_id: seat.seat_id,
              seat_id_str: seatIdStr,
              event_id: eventId,
              event_name: event.name,
              available_seat_ids: event.seats.map(s => s._id?.toString()).filter(Boolean)
            });
            return false;
          }
          
          // Check seat is available
          if (eventSeat.status !== 'available') {
            console.warn('[AUTO-FILL] Warning: Seat is not available, skipping:', {
              seat_id: seat.seat_id,
              status: eventSeat.status
            });
            return false;
          }
          
          return true;
        });
        
        if (validSeats.length > 0) {
          // Ensure each valid seat has event_id
          const seatsWithEventId = validSeats.map(seat => ({
            ...seat,
            event_id: eventId // Add event_id to each seat
          }));
          allSelectedSeats.push(...seatsWithEventId);
          const seatCost = validSeats.reduce((sum, s) => sum + (s.event_price || 0), 0);
          remainingBudget -= seatCost;
        }
      }
    }

    if (allSelectedSeats.length > 0) {
      autoFilled.selected_seats = allSelectedSeats;
      
      // Recalculate pricing
      const costs = calculateSeatCosts(allSelectedSeats);
      autoFilled.subtotal = costs.subtotal;
      autoFilled.taxes = costs.taxes;
      autoFilled.fees = costs.fees;
      autoFilled.total = costs.total;
      autoFilled.deposit_required = costs.depositRequired;
    }
  }

  // 3.5. Calculate pricing if seats already exist but pricing not set
  // This handles the case where seats are pre-selected (not auto-selected by this function)
  if (autoFilled.selected_seats && autoFilled.selected_seats.length > 0) {
    const currentSubtotal = autoFilled.subtotal;
    const needsCalculation = currentSubtotal === undefined || currentSubtotal === null || currentSubtotal === 0;
    
    console.log('[AUTO-FILL] Checking pricing calculation', {
      seatsCount: autoFilled.selected_seats.length,
      currentSubtotal,
      needsCalculation,
      hasSubtotal: 'subtotal' in autoFilled
    });
    
    if (needsCalculation) {
      console.log('[AUTO-FILL] Calculating pricing for pre-selected seats', {
        seatsCount: autoFilled.selected_seats.length,
        currentSubtotal,
        firstSeatSample: autoFilled.selected_seats[0] ? {
          seat_code: autoFilled.selected_seats[0].seat_code,
          event_price: autoFilled.selected_seats[0].event_price,
          base_price: autoFilled.selected_seats[0].base_price
        } : null
      });
      
      const costs = calculateSeatCosts(autoFilled.selected_seats);
      
      console.log('[AUTO-FILL] Calculated costs', {
        subtotal: costs.subtotal,
        taxes: costs.taxes,
        fees: costs.fees,
        total: costs.total,
        depositRequired: costs.depositRequired
      });
      
      // Explicitly set all pricing fields
      autoFilled.subtotal = costs.subtotal;
      autoFilled.taxes = costs.taxes;
      autoFilled.fees = costs.fees;
      autoFilled.total = costs.total;
      autoFilled.deposit_required = costs.depositRequired;
      
      console.log('[AUTO-FILL] Pricing set on autoFilled', {
        subtotal: autoFilled.subtotal,
        taxes: autoFilled.taxes,
        total: autoFilled.total
      });
    } else {
      console.log('[AUTO-FILL] Pricing already calculated, skipping', {
        subtotal: autoFilled.subtotal
      });
    }
  } else {
    console.log('[AUTO-FILL] No seats to calculate pricing for', {
      hasSelectedSeats: !!autoFilled.selected_seats,
      seatsLength: autoFilled.selected_seats?.length || 0
    });
  }

  // 4. Default values
  autoFilled.currency = autoFilled.currency || 'USD';
  // Preserve caller workflow status (e.g. client "request"). Do not use `|| 'draft'` — that can
  // replace a missing intermediate value and hide bugs; explicit baseData.status must win.
  if (baseData.status != null && String(baseData.status).trim() !== '') {
    autoFilled.status = baseData.status;
  } else if (autoFilled.status == null || String(autoFilled.status).trim() === '') {
    autoFilled.status = 'draft';
  }
  autoFilled.created_method = autoFilled.created_method || 'automated';
  autoFilled.participants = autoFilled.participants || [];
  autoFilled.tags = autoFilled.tags || [];
  autoFilled.sharable = autoFilled.sharable !== undefined ? autoFilled.sharable : false;

  return autoFilled;
}

/**
 * Find alternative events with available seats when original events have no seats
 * @param {Array} originalEvents - Events that had no available seats
 * @param {Object} preferences - User preferences (dates, budget, party_size, city, sentiment)
 * @param {Array} excludedLocationIds - Location IDs already tried (to avoid duplicates)
 * @param {Object} autoSelectEventsBySentiment - Function to select events by sentiment
 * @param {number} maxAttempts - Maximum number of alternative search attempts (default: 3)
 * @returns {Promise<{success: boolean, events: Array, searchAttempts: Array}>} Alternative events with seats or null
 */
async function findAlternativeEventsWithSeats(
  originalEvents,
  preferences,
  excludedLocationIds = [],
  autoSelectEventsBySentiment,
  maxAttempts = 3
) {
  const searchAttempts = [];
  const Event = require('../models/Event');
  const Location = require('../models/Location');
  
  try {
    // Handle different date formats in preferences
    let startDate, endDate;
    if (preferences.dates && preferences.dates.startDate) {
      startDate = new Date(preferences.dates.startDate);
      endDate = new Date(preferences.dates.endDate || preferences.dates.startDate);
    } else {
      startDate = new Date(preferences.start_date || preferences.startDate);
      endDate = new Date(preferences.end_date || preferences.endDate);
    }
    
    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.error('[ALTERNATIVE SEARCH] Invalid dates in preferences:', {
        start_date: preferences.start_date || preferences.startDate || preferences.dates?.startDate,
        end_date: preferences.end_date || preferences.endDate || preferences.dates?.endDate,
        dates: preferences.dates
      });
      return {
        success: false,
        events: [],
        searchAttempts: [],
        error: 'Invalid date format in preferences'
      };
    }
    
    const partySize = preferences.party_size || 2;
    const budget = preferences.budget?.max || Infinity;
    const city = preferences.city;
    
    // Get location IDs from original events to exclude
    const originalLocationIds = originalEvents
      .map(e => e.location_id?._id || e.location_id || e.event?.location_id?._id || e.event?.location_id)
      .filter(Boolean)
      .map(id => id.toString ? id.toString() : String(id));
    
    const allExcludedLocationIds = [...new Set([...excludedLocationIds, ...originalLocationIds])];
    
    console.log('[ALTERNATIVE SEARCH] Starting alternative event search', {
      originalEventsCount: originalEvents.length,
      excludedLocations: allExcludedLocationIds.length,
      city,
      dateRange: { start: startDate, end: endDate },
      partySize,
      budget
    });
    
    // Strategy 1: Same city, different locations
    if (city) {
      console.log('[ALTERNATIVE SEARCH] Strategy 1: Same city, different locations');
      
      // Find locations in the same city (excluding already tried)
      const cityLocations = await Location.find({
        'address.city': { $regex: new RegExp(city, 'i') },
        status: 'active',
        _id: { $nin: allExcludedLocationIds }
      }).select('_id name address.city');
      
      if (cityLocations.length > 0) {
        const cityLocationIds = cityLocations.map(loc => loc._id);
        
        // Query events in same city, different locations
        const cityEvents = await Event.find({
          status: 'active',
          location_id: { $in: cityLocationIds },
          start_datetime: { $gte: startDate, $lte: endDate },
          end_datetime: { $gte: new Date() }
        })
        .populate('location_id', 'name sentiment attributes address.city seats')
        .limit(50);
        
        if (cityEvents.length > 0) {
          // Apply sentiment matching if preferences exist
          const selectedEvents = await autoSelectEventsBySentiment(
            cityEvents,
            preferences,
            10 // Get more candidates
          );
          
          // Check for available seats in selected events
          const eventsWithSeats = [];
          for (const eventItem of selectedEvents) {
            const event = eventItem.event || eventItem;
            const eventId = event._id || eventItem.event_id;
            
            if (!eventId) continue;
            
            // Fetch full event with seats and location (for sentiment checking)
            const fullEvent = await Event.findById(eventId)
              .select('seats name')
              .populate('location_id', 'seats');
            if (!fullEvent || !fullEvent.seats || fullEvent.seats.length === 0) continue;
            
            // Check for available seats with 25% budget tolerance
            const relaxedBudget = budget === Infinity ? Infinity : budget * (1 + BUDGET_TOLERANCE_PERCENT);
            const availableSeats = fullEvent.seats.filter(seat => 
              seat.status === 'available' && 
              seat.capacity >= partySize &&
              (seat.event_price || seat.min_spend || 0) <= relaxedBudget
            );
            
            if (availableSeats.length > 0) {
              eventsWithSeats.push({
                event_id: eventId,
                event: event,
                sentimentScore: eventItem.sentimentScore,
                matchReasons: eventItem.matchReasons,
                sentimentHighlights: eventItem.sentimentHighlights,
                structuredPreferences: eventItem.structuredPreferences
              });
            }
          }
          
          searchAttempts.push({
            strategy: 'same_city_different_locations',
            events_tried: selectedEvents.length,
            locations_tried: cityLocations.map(l => l.name),
            events_with_seats: eventsWithSeats.length,
            reason: eventsWithSeats.length > 0 
              ? `Found ${eventsWithSeats.length} events with available seats in ${city}`
              : 'No available seats matching capacity and budget'
          });
          
          if (eventsWithSeats.length > 0) {
            console.log('[ALTERNATIVE SEARCH] Strategy 1 succeeded:', eventsWithSeats.length, 'events with seats');
            return {
              success: true,
              events: eventsWithSeats,
              searchAttempts
            };
          }
        }
      }
    }
    
    // Strategy 2: Different cities, similar sentiment
    console.log('[ALTERNATIVE SEARCH] Strategy 2: Different cities, similar sentiment');
    
    // Query events in all cities (excluding already tried locations)
    const allEvents = await Event.find({
      status: 'active',
      location_id: { $nin: allExcludedLocationIds },
      start_datetime: { $gte: startDate, $lte: endDate },
      end_datetime: { $gte: new Date() }
    })
    .populate('location_id', 'name sentiment attributes address.city seats')
    .limit(100);
    
    if (allEvents.length > 0) {
      // Apply sentiment matching
      const selectedEvents = await autoSelectEventsBySentiment(
        allEvents,
        preferences,
        15 // Get more candidates
      );
      
      // Check for available seats
      const eventsWithSeats = [];
      for (const eventItem of selectedEvents) {
        const event = eventItem.event || eventItem;
        const eventId = event._id || eventItem.event_id;
        
        if (!eventId) continue;
        
        // Fetch full event with seats and location (for sentiment checking)
        const fullEvent = await Event.findById(eventId)
          .select('seats name')
          .populate('location_id', 'seats');
        if (!fullEvent || !fullEvent.seats || fullEvent.seats.length === 0) continue;
        
        // Check for available seats with 25% budget tolerance
        const relaxedBudget = budget === Infinity ? Infinity : budget * (1 + BUDGET_TOLERANCE_PERCENT);
        const availableSeats = fullEvent.seats.filter(seat => 
          seat.status === 'available' && 
          seat.capacity >= partySize &&
          (seat.event_price || seat.min_spend || 0) <= relaxedBudget
        );
        
        if (availableSeats.length > 0) {
          eventsWithSeats.push({
            event_id: eventId,
            event: event,
            sentimentScore: eventItem.sentimentScore,
            matchReasons: eventItem.matchReasons,
            sentimentHighlights: eventItem.sentimentHighlights,
            structuredPreferences: eventItem.structuredPreferences
          });
        }
      }
      
      const uniqueLocations = [...new Set(selectedEvents.map(e => {
        const loc = e.event?.location_id || e.location_id;
        return loc?.name || 'Unknown';
      }))];
      
      searchAttempts.push({
        strategy: 'different_cities_similar_sentiment',
        events_tried: selectedEvents.length,
        locations_tried: uniqueLocations,
        events_with_seats: eventsWithSeats.length,
        reason: eventsWithSeats.length > 0 
          ? `Found ${eventsWithSeats.length} events with available seats in other cities`
          : 'No available seats matching capacity and budget'
      });
      
      if (eventsWithSeats.length > 0) {
        console.log('[ALTERNATIVE SEARCH] Strategy 2 succeeded:', eventsWithSeats.length, 'events with seats');
        return {
          success: true,
          events: eventsWithSeats,
          searchAttempts
        };
      }
    }
    
    // Strategy 3: Relaxed criteria (±3 days, +25% budget tolerance)
    console.log('[ALTERNATIVE SEARCH] Strategy 3: Relaxed criteria');
    
    const relaxedStartDate = new Date(startDate);
    relaxedStartDate.setDate(relaxedStartDate.getDate() - 3);
    const relaxedEndDate = new Date(endDate);
    relaxedEndDate.setDate(relaxedEndDate.getDate() + 3);
    // Use same 25% tolerance as primary selection for consistency
    const relaxedBudget = budget !== Infinity ? budget * (1 + BUDGET_TOLERANCE_PERCENT) : Infinity;
    
    const relaxedEvents = await Event.find({
      status: 'active',
      location_id: { $nin: allExcludedLocationIds },
      start_datetime: { $gte: relaxedStartDate, $lte: relaxedEndDate },
      end_datetime: { $gte: new Date() }
    })
    .populate('location_id', 'name sentiment attributes address.city seats')
    .limit(100);
    
    if (relaxedEvents.length > 0) {
      const relaxedPreferences = {
        ...preferences,
        budget: { ...preferences.budget, max: relaxedBudget }
      };
      
      const selectedEvents = await autoSelectEventsBySentiment(
        relaxedEvents,
        relaxedPreferences,
        15
      );
      
      const eventsWithSeats = [];
      for (const eventItem of selectedEvents) {
        const event = eventItem.event || eventItem;
        const eventId = event._id || eventItem.event_id;
        
        if (!eventId) continue;
        
        // Fetch full event with seats and location (for sentiment checking)
        const fullEvent = await Event.findById(eventId)
          .select('seats name')
          .populate('location_id', 'seats');
        if (!fullEvent || !fullEvent.seats || fullEvent.seats.length === 0) continue;
        
        const availableSeats = fullEvent.seats.filter(seat => 
          seat.status === 'available' && 
          seat.capacity >= partySize &&
          (seat.event_price || seat.min_spend || 0) <= relaxedBudget
        );
        
        if (availableSeats.length > 0) {
          eventsWithSeats.push({
            event_id: eventId,
            event: event,
            sentimentScore: eventItem.sentimentScore,
            matchReasons: eventItem.matchReasons,
            sentimentHighlights: eventItem.sentimentHighlights,
            structuredPreferences: eventItem.structuredPreferences
          });
        }
      }
      
      const uniqueLocations = [...new Set(selectedEvents.map(e => {
        const loc = e.event?.location_id || e.location_id;
        return loc?.name || 'Unknown';
      }))];
      
      searchAttempts.push({
        strategy: 'relaxed_criteria',
        events_tried: selectedEvents.length,
        locations_tried: uniqueLocations,
        events_with_seats: eventsWithSeats.length,
        date_adjustment: '±3 days',
        budget_adjustment: `+${(BUDGET_TOLERANCE_PERCENT * 100).toFixed(0)}%`,
        reason: eventsWithSeats.length > 0 
          ? `Found ${eventsWithSeats.length} events with available seats (relaxed criteria)`
          : 'No available seats even with relaxed criteria'
      });
      
      if (eventsWithSeats.length > 0) {
        console.log('[ALTERNATIVE SEARCH] Strategy 3 succeeded:', eventsWithSeats.length, 'events with seats');
        return {
          success: true,
          events: eventsWithSeats,
          searchAttempts
        };
      }
    }
    
    // No alternatives found
    console.log('[ALTERNATIVE SEARCH] No alternative events found with available seats');
    return {
      success: false,
      events: [],
      searchAttempts
    };
    
  } catch (error) {
    console.error('[ALTERNATIVE SEARCH] Error finding alternative events:', error);
    return {
      success: false,
      events: [],
      searchAttempts,
      error: error.message
    };
  }
}

module.exports = {
  findAvailableRunner,
  extractPoliciesFromEvents,
  selectSeatsByBudgetAndCapacity,
  calculateSeatScore,
  matchCapacity,
  calculateSeatCosts,
  autoFillCOEData,
  findAlternativeEventsWithSeats
};


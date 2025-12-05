/**
 * Bot Auto-Fill Service
 * @description Provides advanced auto-fill logic for COE creation including runner assignment,
 * policy extraction, budget-aware selection, and capacity matching
 */

const User = require('../models/User');
const COE = require('../models/COE');
const Event = require('../models/Event');
const Location = require('../models/Location');

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
 * Select seats based on budget and capacity with quality-based scoring
 * Prioritizes: 1) Quality score, 2) Budget maximization, 3) Exclusion filtering
 * @param {Object} event - Event object (may have populated location_id with seats)
 * @param {Object} preferences - User preferences (budget, party_size, structuredPreferences with exclusions)
 * @param {number} remainingBudget - Remaining budget after other selections
 * @returns {Array} Selected seats
 */
/**
 * Select seats by budget and capacity with diagnostic information
 * @param {Object} event - Event object with seats
 * @param {Object} preferences - User preferences
 * @param {number} remainingBudget - Remaining budget
 * @returns {Object} { seats: Array, diagnostics: Object }
 */
async function selectSeatsByBudgetAndCapacity(event, preferences = {}, remainingBudget = null) {
  // Initialize diagnostics
  const diagnostics = {
    event_id: event._id?.toString() || null,
    event_name: event.name || 'Unknown Event',
    total_seats: event.seats?.length || 0,
    party_size: preferences.party_size || 2,
    budget: remainingBudget || preferences.budget?.max || Infinity,
    exclusions: preferences.structuredPreferences?.exclusions || preferences.exclusions || [],
    filtering_stages: {
      initial_count: event.seats?.length || 0,
      after_status_filter: 0,
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
  const budget = remainingBudget || preferences.budget?.max || Infinity;

  // Get exclusions from structured preferences or direct preferences
  const exclusions = preferences.structuredPreferences?.exclusions || 
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
    return { seats: [], diagnostics };
  }

  // Stage 3: Filter by budget
  availableSeats = availableSeats.filter(seat => {
    const price = seat.event_price || seat.min_spend || 0;
    return price <= budget;
  });
  diagnostics.filtering_stages.after_budget_filter = availableSeats.length;

  if (availableSeats.length === 0) {
    const prices = event.seats
      .map(s => s.event_price || s.min_spend || 0)
      .filter(p => p > 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    diagnostics.primary_reason = 'BUDGET_TOO_LOW';
    diagnostics.details.budget_too_low = {
      budget: budget === Infinity ? null : budget,
      min_seat_price: minPrice,
      max_seat_price: maxPrice,
      seats_within_budget: 0
    };
    diagnostics.secondary_reasons.push('NO_AVAILABLE_SEATS'); // Also no available seats
    return { seats: [], diagnostics };
  }

  // Stage 4: Filter out seats with excluded sentiment keywords
  let seatsExcludedCount = 0;
  const matchingKeywords = [];
  if (exclusions && exclusions.length > 0 && location && location.seats && Array.isArray(location.seats)) {
    const exclusionKeywords = exclusions.map(ex => ex.toLowerCase().trim());
    
    const beforeExclusion = availableSeats.length;
    availableSeats = availableSeats.filter(eventSeat => {
      // Match event seat to location seat by code (primary) or seat_id
      const locationSeat = location.seats.find(locSeat => {
        if (locSeat.code === eventSeat.code) return true;
        const eventSeatId = eventSeat.seat_id ? eventSeat.seat_id.toString() : null;
        const locSeatId = locSeat._id ? locSeat._id.toString() : null;
        return eventSeatId && locSeatId && locSeatId === eventSeatId;
      });
      
      if (!locationSeat || !locationSeat.sentiment || !Array.isArray(locationSeat.sentiment)) {
        return true; // No sentiment - allow through
      }
      
      const locationSeatSentimentText = locationSeat.sentiment
        .map(s => (s.text || '').toLowerCase())
        .join(' ');
      
      const hasExcludedSentiment = exclusionKeywords.some(exclusion => 
        locationSeatSentimentText.includes(exclusion)
      );
      
      if (hasExcludedSentiment) {
        seatsExcludedCount++;
        const matchedKeyword = exclusionKeywords.find(ex => locationSeatSentimentText.includes(ex));
        if (matchedKeyword && !matchingKeywords.includes(matchedKeyword)) {
          matchingKeywords.push(matchedKeyword);
        }
        console.log('[SEAT SELECTION] Excluding seat due to negative preference:', {
          seat_code: eventSeat.code,
          exclusion_matched: matchedKeyword
        });
        return false;
      }
      
      return true;
    });
    
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
    diagnostics.filtering_stages.after_exclusion_filter = availableSeats.length;
  }

  // If we reach here, we have seats available
  diagnostics.filtering_stages.final_count = availableSeats.length;
  diagnostics.primary_reason = null; // Success - no reason needed

  // Score all seats and sort by: quality DESC, then price DESC (to maximize budget)
  const scoredSeats = availableSeats.map(eventSeat => {
    // Find corresponding location seat by code (primary) or seat_id
    const locationSeat = location?.seats?.find(locSeat => {
      if (locSeat.code === eventSeat.code) return true;
      const eventSeatId = eventSeat.seat_id ? eventSeat.seat_id.toString() : null;
      const locSeatId = locSeat._id ? locSeat._id.toString() : null;
      return eventSeatId && locSeatId && locSeatId === eventSeatId;
    });
    
    const score = calculateSeatScore(eventSeat, locationSeat);
    const price = eventSeat.event_price || eventSeat.min_spend || 0;
    
    return {
      seat: eventSeat,
      score,
      price
    };
  });
  
  // Sort by score DESC, then price DESC (higher price preferred to maximize budget utilization)
  scoredSeats.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.price - a.price; // Prefer higher price among same score to max budget
  });

  console.log('[SEAT SELECTION] Scored seats:', {
    event_name: event.name,
    total_available: scoredSeats.length,
    top_seat: scoredSeats[0] ? {
      code: scoredSeats[0].seat.code,
      score: scoredSeats[0].score,
      price: scoredSeats[0].price
    } : null
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
  autoFilled.status = autoFilled.status || 'draft';
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
            
            // Check for available seats
            const availableSeats = fullEvent.seats.filter(seat => 
              seat.status === 'available' && 
              seat.capacity >= partySize &&
              (seat.event_price || seat.min_spend || 0) <= budget
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
        
        const availableSeats = fullEvent.seats.filter(seat => 
          seat.status === 'available' && 
          seat.capacity >= partySize &&
          (seat.event_price || seat.min_spend || 0) <= budget
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
    
    // Strategy 3: Relaxed criteria (±3 days, +10% budget)
    console.log('[ALTERNATIVE SEARCH] Strategy 3: Relaxed criteria');
    
    const relaxedStartDate = new Date(startDate);
    relaxedStartDate.setDate(relaxedStartDate.getDate() - 3);
    const relaxedEndDate = new Date(endDate);
    relaxedEndDate.setDate(relaxedEndDate.getDate() + 3);
    const relaxedBudget = budget !== Infinity ? budget * 1.1 : Infinity;
    
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
        budget_adjustment: '+10%',
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


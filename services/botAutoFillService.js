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
 * Select seats based on budget and capacity
 * @param {Object} event - Event object (may have populated location_id with seats)
 * @param {Object} preferences - User preferences (budget, party_size, structuredPreferences with exclusions)
 * @param {number} remainingBudget - Remaining budget after other selections
 * @returns {Array} Selected seats
 */
async function selectSeatsByBudgetAndCapacity(event, preferences = {}, remainingBudget = null) {
  if (!event.seats || event.seats.length === 0) {
    return [];
  }

  const partySize = preferences.party_size || 2; // Default to 2
  const budget = remainingBudget || preferences.budget?.max || Infinity;

  // Get exclusions from structured preferences or direct preferences
  const exclusions = preferences.structuredPreferences?.exclusions || 
                     preferences.exclusions || 
                     [];

  // Filter available seats
  let availableSeats = event.seats.filter(seat => 
    seat.status === 'available' && 
    seat.capacity >= partySize &&
    (seat.event_price || seat.min_spend || 0) <= budget
  );

  // Filter out seats with excluded sentiment keywords
  // Note: Event seats don't have sentiment - we need to check location seat sentiment
  if (exclusions && exclusions.length > 0) {
    const exclusionKeywords = exclusions.map(ex => ex.toLowerCase().trim());
    
    // Get location with seats if not already populated
    let location = event.location_id;
    if (!location || !location.seats || (typeof location === 'object' && location._id && !location.seats)) {
      // Location not populated or only has ID - fetch it
      if (event.location_id) {
        const locationId = (location && location._id) ? location._id : (typeof location === 'string' ? location : event.location_id);
        location = await Location.findById(locationId).select('seats');
      }
    }
    
    // Filter seats based on location seat sentiment
    if (location && location.seats && Array.isArray(location.seats)) {
      availableSeats = availableSeats.filter(eventSeat => {
        // Match event seat to location seat via seat_id
        const eventSeatId = eventSeat.seat_id ? eventSeat.seat_id.toString() : null;
        if (!eventSeatId) {
          // No seat_id reference - can't check sentiment, allow through
          return true;
        }
        
        // Find corresponding location seat
        const locationSeat = location.seats.find(locSeat => {
          const locSeatId = locSeat._id ? locSeat._id.toString() : null;
          return locSeatId === eventSeatId;
        });
        
        if (!locationSeat || !locationSeat.sentiment || !Array.isArray(locationSeat.sentiment)) {
          // No location seat found or no sentiment - allow through
          return true;
        }
        
        // Check location seat sentiment for excluded keywords
        const locationSeatSentimentText = locationSeat.sentiment
          .map(s => (s.text || '').toLowerCase())
          .join(' ');
        
        // Check if any exclusion keyword appears in location seat sentiment
        const hasExcludedSentiment = exclusionKeywords.some(exclusion => 
          locationSeatSentimentText.includes(exclusion)
        );
        
        if (hasExcludedSentiment) {
          console.log('[SEAT SELECTION] Excluding seat due to negative preference:', {
            seat_code: eventSeat.code,
            exclusion_matched: exclusionKeywords.find(ex => locationSeatSentimentText.includes(ex)),
            location_seat_sentiment: locationSeat.sentiment.map(s => s.text)
          });
          return false;
        }
        
        return true;
      });
    }
  }

  if (availableSeats.length === 0) {
    if (exclusions && exclusions.length > 0) {
      console.log('[SEAT SELECTION] No seats available after filtering exclusions:', {
        exclusions,
        total_seats: event.seats.length
      });
    }
    return [];
  }

  // Sort by price (ascending) to stay within budget
  availableSeats.sort((a, b) => {
    const priceA = a.event_price || a.min_spend || 0;
    const priceB = b.event_price || b.min_spend || 0;
    return priceA - priceB;
  });

  // Select the first seat that fits
  const selectedSeat = availableSeats[0];
  
  return [{
    seat_id: selectedSeat._id,
    seat_code: selectedSeat.code,
    capacity: selectedSeat.capacity,
    base_price: selectedSeat.min_spend || 0,
    event_price: selectedSeat.event_price || selectedSeat.min_spend || 0,
    available_from: event.start_datetime,
    available_until: event.end_datetime || event.start_datetime,
    status: 'selected'
  }];
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
  const subtotal = selectedSeats.reduce((sum, seat) => 
    sum + (seat.event_price || seat.base_price || 0), 0
  );
  
  const taxes = subtotal * 0.30; // 30% default
  const fees = 0; // Default 0
  const total = subtotal + taxes + fees;
  const depositRequired = total * 0.20; // 20% default

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

  // 1. Runner Assignment
  if (baseData.start_date && baseData.end_date) {
    const runner = await findAvailableRunner(
      new Date(baseData.start_date),
      new Date(baseData.end_date),
      'coe' // Default to COE-level assignment
    );

    if (runner) {
      autoFilled.runner_assignment = {
        type: 'coe',
        runner_id: runner._id,
        assigned_by: baseData.created_by || null,
        assigned_at: new Date(),
        status: 'assigned',
        notes: '' // Left empty as per plan
      };
    }
  }

  // 2. Policy Extraction
  if (selectedEvents.length > 0) {
    const eventIds = selectedEvents.map(e => e.event_id || e._id || e);
    const policies = await extractPoliciesFromEvents(eventIds);
    
    if (policies.combined) {
      autoFilled.policies = policies.combined;
    }
  }

  // 3. Budget-aware seat selection (if events provided)
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
      const seats = await selectSeatsByBudgetAndCapacity(
        event,
        preferencesWithStructured,
        remainingBudget
      );

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
    const startDate = new Date(preferences.start_date || preferences.startDate);
    const endDate = new Date(preferences.end_date || preferences.endDate);
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
  matchCapacity,
  calculateSeatCosts,
  autoFillCOEData,
  findAlternativeEventsWithSeats
};


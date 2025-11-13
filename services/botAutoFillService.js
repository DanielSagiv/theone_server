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
 * @param {Object} event - Event object
 * @param {Object} preferences - User preferences (budget, party_size)
 * @param {number} remainingBudget - Remaining budget after other selections
 * @returns {Array} Selected seats
 */
function selectSeatsByBudgetAndCapacity(event, preferences = {}, remainingBudget = null) {
  if (!event.seats || event.seats.length === 0) {
    return [];
  }

  const partySize = preferences.party_size || 2; // Default to 2
  const budget = remainingBudget || preferences.budget?.max || Infinity;

  // Filter available seats
  const availableSeats = event.seats.filter(seat => 
    seat.status === 'available' && 
    seat.capacity >= partySize &&
    (seat.event_price || seat.min_spend || 0) <= budget
  );

  if (availableSeats.length === 0) {
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
  if (selectedEvents.length > 0 && preferences.budget) {
    let remainingBudget = preferences.budget.max;
    const allSelectedSeats = [];

    for (const eventData of selectedEvents) {
      const event = await Event.findById(eventData.event_id || eventData._id || eventData);
      if (!event) continue;

      const seats = selectSeatsByBudgetAndCapacity(
        event,
        preferences,
        remainingBudget
      );

      if (seats.length > 0) {
        allSelectedSeats.push(...seats);
        const seatCost = seats.reduce((sum, s) => sum + (s.event_price || 0), 0);
        remainingBudget -= seatCost;
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

module.exports = {
  findAvailableRunner,
  extractPoliciesFromEvents,
  selectSeatsByBudgetAndCapacity,
  matchCapacity,
  calculateSeatCosts,
  autoFillCOEData
};


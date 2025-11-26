/**
 * Seat Upgrade Service
 * @description Service for identifying and generating seat upgrade offers based on sentiment data
 * 
 * This service analyzes location seat sentiment data to identify better seating options
 * that can be offered as upgrades when a COE is created in draft status.
 */

const Event = require('../models/Event');
const Location = require('../models/Location');

/**
 * Score a seat's quality based on sentiment, category, and price tier
 * @param {Object} seat - Seat object (from event or location)
 * @param {Object} location - Location with seat sentiments
 * @returns {number} Quality score (higher = better)
 */
function scoreSeatQuality(seat, location) {
  let score = 0;
  
  // Price tier (1-5, higher = better)
  const priceTier = seat.priceTier || seat.price_tier || 1;
  score += priceTier * 10;
  
  // Get seat sentiment from location
  const locationSeat = location.seats.find(s => {
    const seatId = seat.seat_id || seat._id;
    const locationSeatId = s._id;
    
    // Match by ID if available
    if (seatId && locationSeatId) {
      return locationSeatId.toString() === seatId.toString();
    }
    
    // Fallback to code matching
    return s.code === (seat.seat_code || seat.code);
  });
  
  if (locationSeat && locationSeat.sentiment) {
    locationSeat.sentiment.forEach(sent => {
      if (sent.type === 'A') score += 20;
      if (sent.type === 'B') score += 10;
    });
  }
  
  // Category hierarchy
  const categoryScores = {
    'owner_tables': 50,
    'upper_dance': 40,
    'stage_tables': 35,
    'lower_dance': 30,
    'third_tier_couch': 25,
    'large_3rd_tier_couch': 25,
    'backwall': 20,
    'four_tops': 15
  };
  const category = seat.category || locationSeat?.category;
  score += categoryScores[category] || 0;
  
  // Sentiment keywords
  if (locationSeat && locationSeat.sentiment) {
    const sentimentText = locationSeat.sentiment
      .map(s => s.text || '')
      .join(' ')
      .toLowerCase();
    
    if (sentimentText.includes('upper')) score += 15;
    if (sentimentText.includes('premium')) score += 15;
    if (sentimentText.includes('vip')) score += 20;
    if (sentimentText.includes('exclusive')) score += 20;
    if (sentimentText.includes('better view')) score += 10;
    if (sentimentText.includes('best')) score += 15;
  }
  
  return score;
}

/**
 * Find better alternative seats for a given selected seat
 * @param {Object} currentSeat - Currently selected seat from COE
 * @param {Object} event - Event with all available seats
 * @param {Object} location - Location with seat sentiments
 * @param {number} partySize - Party size requirement
 * @returns {Promise<Array>} Array of better alternative seats (sorted by quality)
 */
async function findBetterSeats(currentSeat, event, location, partySize = 2) {
  try {
    if (!event.seats || event.seats.length === 0) {
      console.log('[SEAT_UPGRADE] findBetterSeats: No event seats available');
      return [];
    }
    
    console.log('[SEAT_UPGRADE] findBetterSeats: Starting search', {
      currentSeatCode: currentSeat.seat_code || currentSeat.code,
      currentSeatId: currentSeat.seat_id?.toString(),
      eventSeatsCount: event.seats.length,
      locationSeatsCount: location.seats?.length || 0,
      partySize
    });
    
    // Get current seat's quality score
    // Match by code since event seat _id is different from location seat _id
    const currentSeatLocation = location.seats.find(s => {
      // Primary match: by code (most reliable)
      const codeMatch = s.code === (currentSeat.seat_code || currentSeat.code);
      if (codeMatch) return true;
      
      // Fallback: try to match event seat's seat_id reference to location seat _id
      // (event.seats[].seat_id references location.seats[]._id)
      const currentSeatId = currentSeat.seat_id?.toString();
      const locationSeatId = s._id?.toString();
      if (currentSeatId && locationSeatId) {
        return locationSeatId === currentSeatId;
      }
      
      return false;
    });
    
    if (!currentSeatLocation) {
      console.log('[SEAT_UPGRADE] findBetterSeats: Current seat not found in location', {
        currentSeatCode: currentSeat.seat_code || currentSeat.code,
        locationSeatCodes: location.seats.map(s => s.code)
      });
      return []; // Can't compare if current seat not found in location
    }
    
    console.log('[SEAT_UPGRADE] findBetterSeats: Found current seat in location', {
      code: currentSeatLocation.code,
      category: currentSeatLocation.category,
      priceTier: currentSeatLocation.priceTier,
      hasSentiment: !!(currentSeatLocation.sentiment && currentSeatLocation.sentiment.length > 0)
    });
    
    const currentScore = scoreSeatQuality(
      { ...currentSeat, seat_id: currentSeat.seat_id },
      location
    );
    
    // Find all available seats in the same event
    const availableSeats = event.seats.filter(seat => {
      // Must be available
      if (seat.status !== 'available') return false;
      
      // Must meet capacity requirement
      if (seat.capacity < partySize) return false;
      
      // Exclude the current seat by code (primary identifier)
      if (seat.code === (currentSeat.seat_code || currentSeat.code)) {
        return false;
      }
      
      // Also exclude by seat_id if it matches
      const seatIdStr = seat._id?.toString();
      const currentSeatIdStr = currentSeat.seat_id?.toString();
      if (seatIdStr && currentSeatIdStr && seatIdStr === currentSeatIdStr) {
        return false;
      }
      
      return true;
    });
    
    console.log('[SEAT_UPGRADE] findBetterSeats: Available seats after filtering', {
      totalEventSeats: event.seats.length,
      availableSeats: availableSeats.length,
      availableSeatCodes: availableSeats.map(s => s.code)
    });
    
    // Score and filter better seats
    const betterSeats = availableSeats
      .map(seat => {
        // Match event seat to location seat by code (primary) or seat_id reference
        const locationSeat = location.seats.find(s => {
          // Primary match: by code
          if (s.code === seat.code) return true;
          
          // Fallback: event seat's seat_id references location seat's _id
          const eventSeatRef = seat.seat_id?.toString();
          const locationSeatId = s._id?.toString();
          if (eventSeatRef && locationSeatId) {
            return locationSeatId === eventSeatRef;
          }
          
          return false;
        });
        
        if (!locationSeat) {
          console.log('[SEAT_UPGRADE] findBetterSeats: Location seat not found for event seat', {
            eventSeatCode: seat.code,
            eventSeatId: seat._id?.toString()
          });
          return null;
        }
        
        const seatScore = scoreSeatQuality(
          { ...seat, seat_id: seat._id },
          location
        );
        
        console.log('[SEAT_UPGRADE] findBetterSeats: Scored seat', {
          code: seat.code,
          category: seat.category || locationSeat.category,
          score: seatScore,
          currentScore: currentScore,
          isBetter: seatScore > currentScore
        });
        
        return {
          seat,
          locationSeat,
          score: seatScore,
          isBetter: seatScore > currentScore
        };
      })
      .filter(item => item && item.isBetter)
      .sort((a, b) => b.score - a.score) // Sort by quality (best first)
      .slice(0, 3) // Top 3 alternatives
      .map(item => item.seat);
    
    console.log('[SEAT_UPGRADE] findBetterSeats: Final better seats', {
      betterSeatsCount: betterSeats.length,
      betterSeatCodes: betterSeats.map(s => s.code)
    });
    
    return betterSeats;
  } catch (error) {
    console.error('[SEAT_UPGRADE] Error finding better seats:', error);
    return [];
  }
}

/**
 * Calculate upgrade value proposition
 * @param {Object} currentSeat - Current seat from COE
 * @param {Object} upgradeSeat - Proposed upgrade seat from event
 * @param {Object} location - Location with sentiments
 * @returns {Object} Upgrade details
 */
function calculateUpgradeValue(currentSeat, upgradeSeat, location) {
  try {
    const currentPrice = currentSeat.event_price || currentSeat.base_price || 0;
    const upgradePrice = upgradeSeat.event_price || upgradeSeat.min_spend || 0;
    const priceDelta = upgradePrice - currentPrice;
    
    // Get sentiments
    const currentLocationSeat = location.seats.find(s => {
      const currentSeatId = currentSeat.seat_id?.toString();
      const locationSeatId = s._id?.toString();
      
      if (currentSeatId && locationSeatId) {
        return locationSeatId === currentSeatId;
      }
      
      return s.code === (currentSeat.seat_code || currentSeat.code);
    });
    
    const upgradeLocationSeat = location.seats.find(s => {
      const upgradeSeatId = upgradeSeat._id?.toString();
      const locationSeatId = s._id?.toString();
      
      if (upgradeSeatId && locationSeatId) {
        return locationSeatId === upgradeSeatId;
      }
      
      return s.code === upgradeSeat.code;
    });
    
    const upgradeReasons = calculateUpgradeReasons(
      currentLocationSeat,
      upgradeLocationSeat,
      currentSeat,
      upgradeSeat
    );
    
    return {
      price_delta: priceDelta,
      price_delta_percentage: currentPrice > 0 ? ((priceDelta / currentPrice) * 100).toFixed(1) : '0',
      upgrade_reasons: upgradeReasons,
      sentiment_improvement: {
        current: currentLocationSeat?.sentiment || [],
        upgrade: upgradeLocationSeat?.sentiment || []
      }
    };
  } catch (error) {
    console.error('[SEAT_UPGRADE] Error calculating upgrade value:', error);
    return {
      price_delta: 0,
      price_delta_percentage: '0',
      upgrade_reasons: [],
      sentiment_improvement: { current: [], upgrade: [] }
    };
  }
}

/**
 * Generate human-readable upgrade reasons
 * @param {Object} currentLocationSeat - Current seat from location
 * @param {Object} upgradeLocationSeat - Upgrade seat from location
 * @param {Object} currentSeat - Current seat from COE
 * @param {Object} upgradeSeat - Upgrade seat from event
 * @returns {Array<string>} Array of upgrade reason strings
 */
function calculateUpgradeReasons(currentLocationSeat, upgradeLocationSeat, currentSeat, upgradeSeat) {
  const reasons = [];
  
  if (!currentLocationSeat || !upgradeLocationSeat) {
    return reasons;
  }
  
  // Category upgrades
  const categoryUpgrades = {
    'lower_dance': { 'upper_dance': 'Upgrade to upper dance floor' },
    'third_tier_couch': { 'upper_dance': 'Upgrade to upper dance floor', 'lower_dance': 'Upgrade to dance floor' },
    'large_3rd_tier_couch': { 'upper_dance': 'Upgrade to upper dance floor', 'lower_dance': 'Upgrade to dance floor' },
    'backwall': { 'lower_dance': 'Upgrade to dance floor', 'upper_dance': 'Upgrade to upper dance floor' },
    'stage_tables': { 'owner_tables': 'Upgrade to owner tables' }
  };
  
  const currentCategory = currentSeat.category || currentLocationSeat.category;
  const upgradeCategory = upgradeSeat.category || upgradeLocationSeat.category;
  
  if (categoryUpgrades[currentCategory] && categoryUpgrades[currentCategory][upgradeCategory]) {
    reasons.push(categoryUpgrades[currentCategory][upgradeCategory]);
  }
  
  // Price tier upgrade
  const currentTier = currentLocationSeat.priceTier || 1;
  const upgradeTier = upgradeLocationSeat.priceTier || 1;
  
  if (upgradeTier > currentTier) {
    reasons.push(`Premium tier ${upgradeTier} seating`);
  }
  
  // Sentiment-based reasons
  const upgradeSentiment = upgradeLocationSeat.sentiment || [];
  const upgradeSentimentText = upgradeSentiment.map(s => s.text || '').join(' ').toLowerCase();
  
  if (upgradeSentimentText.includes('upper') && !currentLocationSeat.sentiment?.some(s => (s.text || '').toLowerCase().includes('upper'))) {
    reasons.push('Upper level seating');
  }
  
  if (upgradeSentimentText.includes('vip')) {
    reasons.push('VIP section');
  }
  
  if (upgradeSentimentText.includes('premium')) {
    reasons.push('Premium experience');
  }
  
  if (upgradeSentimentText.includes('better view') || upgradeSentimentText.includes('best view')) {
    reasons.push('Better view');
  }
  
  if (upgradeSentimentText.includes('exclusive')) {
    reasons.push('Exclusive area');
  }
  
  // Type A sentiment upgrade
  const hasTypeA = upgradeSentiment.some(s => s.type === 'A');
  const currentHasTypeA = currentLocationSeat.sentiment?.some(s => s.type === 'A');
  
  if (hasTypeA && !currentHasTypeA) {
    reasons.push('Premium sentiment rating');
  }
  
  // Remove duplicates
  return [...new Set(reasons)];
}

/**
 * Generate upgrade offers for all seats in a COE
 * @param {Object} coe - COE object with selected_seats
 * @returns {Promise<Array>} Array of upgrade offers per seat
 */
async function generateSeatUpgradeOffers(coe) {
  try {
    // Only generate offers for draft COEs
    if (coe.status !== 'draft') {
      return [];
    }
    
    if (!coe.selected_seats || coe.selected_seats.length === 0) {
      return [];
    }
    
    const offers = [];
    
    // Group seats by event
    const seatsByEvent = {};
    for (const selectedSeat of coe.selected_seats) {
      const eventId = selectedSeat.event_id?.toString();
      if (!eventId) continue;
      
      if (!seatsByEvent[eventId]) {
        seatsByEvent[eventId] = [];
      }
      seatsByEvent[eventId].push(selectedSeat);
    }
    
    // Process each event
    for (const [eventId, seats] of Object.entries(seatsByEvent)) {
      try {
        // Get event with location populated
        const event = await Event.findById(eventId)
          .populate('location_id', 'seats');
        
        if (!event || !event.location_id) {
          console.warn('[SEAT_UPGRADE] Event or location not found:', eventId);
          continue;
        }
        
        // Get party size from COE or preferences
        const partySize = coe.preferences?.party_size || 2;
        
        // Find better seats for each selected seat
        for (const selectedSeat of seats) {
          const betterSeats = await findBetterSeats(
            selectedSeat,
            event,
            event.location_id,
            partySize
          );
          
          if (betterSeats.length > 0) {
            // Calculate upgrade value for each alternative
            const alternatives = betterSeats.map(seat => {
              const upgradeValue = calculateUpgradeValue(
                selectedSeat,
                seat,
                event.location_id
              );
              
              // Get location seat for sentiment
              const locationSeat = event.location_id.seats.find(s => {
                const seatId = seat._id?.toString();
                const locationSeatId = s._id?.toString();
                
                if (seatId && locationSeatId) {
                  return locationSeatId === seatId;
                }
                
                return s.code === seat.code;
              });
              
              return {
                seat_id: seat._id,
                seat_code: seat.code,
                capacity: seat.capacity,
                event_price: seat.event_price || seat.min_spend || 0,
                base_price: seat.min_spend || 0,
                price_delta: upgradeValue.price_delta,
                price_delta_percentage: upgradeValue.price_delta_percentage,
                upgrade_reasons: upgradeValue.upgrade_reasons,
                sentiment: locationSeat?.sentiment || [],
                category: seat.category,
                section: seat.section,
                media: seat.media || [],
                status: 'pending',
                offered_at: new Date()
              };
            });
            
            offers.push({
              current_seat_id: selectedSeat.seat_id,
              current_seat_code: selectedSeat.seat_code,
              event_id: eventId,
              event_name: event.name,
              current_price: selectedSeat.event_price || selectedSeat.base_price || 0,
              alternatives: alternatives,
              generated_at: new Date()
            });
          }
        }
      } catch (error) {
        console.error('[SEAT_UPGRADE] Error processing event:', eventId, error);
        // Continue with other events
      }
    }
    
    return offers;
  } catch (error) {
    console.error('[SEAT_UPGRADE] Error generating upgrade offers:', error);
    return [];
  }
}

module.exports = {
  scoreSeatQuality,
  findBetterSeats,
  calculateUpgradeValue,
  calculateUpgradeReasons,
  generateSeatUpgradeOffers
};


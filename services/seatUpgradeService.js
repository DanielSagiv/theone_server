/**
 * Seat Upgrade Service
 * @description Service for identifying and generating seat upgrade offers based on sentiment data
 * 
 * This service analyzes location seat sentiment data to identify better seating options
 * that can be offered as upgrades when a COE is created in draft status.
 */

const Event = require('../models/Event');
const Location = require('../models/Location');
const { generateSeatRecommendation } = require('./seatRecommendationService');
const { enrichSeatUpgradeOffersPayload } = require('../utils/ensureImageMetadata');

/**
 * Clone media entries so enrichment does not mutate location/event subdocuments in memory.
 * @param {Array} arr
 * @returns {Array}
 */
function cloneSeatMediaArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((m) => {
    if (!m) return m;
    const o = typeof m.toObject === 'function' ? m.toObject() : { ...m };
    return { ...o };
  });
}

/**
 * Find location seat by matching seat_id first (stable reference), then code as fallback
 * @param {Object} seat - Seat object (from event or COE) with seat_id and/or code
 * @param {Object} location - Location with seats array
 * @returns {Object|null} Matching location seat or null
 */
function findLocationSeat(seat, location) {
  if (!location?.seats || location.seats.length === 0) {
    return null;
  }
  
  // Primary match: by seat_id (stable reference that doesn't change when codes are updated)
  // event.seats[].seat_id references location.seats[]._id
  const seatId = seat.seat_id?.toString();
  if (seatId) {
    const matchById = location.seats.find(s => {
      const locationSeatId = s._id?.toString();
      return locationSeatId && locationSeatId === seatId;
    });
    if (matchById) {
      return matchById;
    }
  }
  
  // Fallback: match by code (can change, less reliable)
  const seatCode = seat.seat_code || seat.code;
  if (seatCode) {
    const matchByCode = location.seats.find(s => s.code === seatCode);
    if (matchByCode) {
      return matchByCode;
    }
  }
  
  return null;
}

/**
 * Score a seat's quality based on qualityScore field and sentiment bonus
 * @param {Object} seat - Seat object (from event or location)
 * @param {Object} location - Location with seat sentiments
 * @returns {number} Quality score (higher = better)
 */
function scoreSeatQuality(seat, location) {
  const seatCode = seat.seat_code || seat.code;
  
  console.log('[SEAT_UPGRADE] scoreSeatQuality input:', {
    seatKeys: Object.keys(seat),
    seat_code: seat.seat_code,
    code: seat.code,
    seat_id: seat.seat_id?.toString(),
    resolvedCode: seatCode,
    locationSeatsCount: location?.seats?.length,
    locationSeatCodes: location?.seats?.map(s => s.code)
  });
  
  // Use helper function that prioritizes seat_id matching
  const locationSeat = findLocationSeat(seat, location);
  
  // Convert to plain object if Mongoose document to ensure all fields are accessible
  const locationSeatPlain = locationSeat?.toObject ? locationSeat.toObject() : locationSeat;
  
  // Primary score: qualityScore field (1-10) scaled to 10-100
  const qualityScore = locationSeatPlain?.qualityScore || seat.qualityScore || 5;
  let score = qualityScore * 10;
  
  // Sentiment bonus: Type A = +5, Type B = +2
  if (locationSeatPlain?.sentiment) {
    locationSeatPlain.sentiment.forEach(sent => {
      if (sent.type === 'A') score += 5;
      if (sent.type === 'B') score += 2;
    });
  }
  
  console.log('[SEAT_UPGRADE] scoreSeatQuality result:', {
    seatCode,
    locationSeatFound: !!locationSeat,
    locationSeatKeys: locationSeat ? Object.keys(locationSeat) : [],
    locationSeatPlainKeys: locationSeatPlain ? Object.keys(locationSeatPlain) : [],
    locationSeatQualityScore: locationSeat?.qualityScore,
    locationSeatPlainQualityScore: locationSeatPlain?.qualityScore,
    qualityScore,
    baseScore: qualityScore * 10,
    finalScore: score,
    hasSentiment: !!(locationSeatPlain?.sentiment?.length)
  });
  
  return score;
}

/**
 * Find better alternative seats for a given selected seat
 * @param {Object} currentSeat - Currently selected seat from COE
 * @param {Object} event - Event with all available seats
 * @param {Object} location - Location with seat sentiments
 * @param {number} partySize - Party size requirement
 * @param {number} remainingBudget - Remaining budget (for fits_budget flag)
 * @param {boolean} isAdmin - Whether user is admin (if true, show all seats, not just better ones)
 * @returns {Promise<Array>} Array of alternative seats (better ones for clients, all for admins)
 */
async function findBetterSeats(currentSeat, event, location, partySize = 2, remainingBudget = 0, isAdmin = false) {
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
    // Use helper function that prioritizes seat_id matching (stable reference)
    const currentSeatLocation = findLocationSeat(currentSeat, location);
    
    // For admins: use default values if current seat not found in location
    // For clients: require current seat location for comparison
    let currentScore = 0;
    let currentPrice = currentSeat.event_price || currentSeat.base_price || currentSeat.min_spend || 0;
    
    if (!currentSeatLocation) {
      console.log('[SEAT_UPGRADE] findBetterSeats: Current seat not found in location', {
        currentSeatCode: currentSeat.seat_code || currentSeat.code,
        currentSeatId: currentSeat.seat_id?.toString(),
        locationSeatCodes: location.seats.map(s => s.code),
        locationSeatIds: location.seats.map(s => s._id?.toString()),
        isAdmin: isAdmin
      });
      
      // For clients: can't compare without current seat location, so return empty
      if (!isAdmin) {
        return []; // Can't compare if current seat not found in location (client only)
      }
      
      // For admins: use default values and continue to show all available seats
      console.log('[SEAT_UPGRADE] findBetterSeats: Admin mode - using default values for current seat comparison');
      currentScore = 0; // Default score
      currentPrice = currentSeat.event_price || currentSeat.base_price || currentSeat.min_spend || 0;
    } else {
      console.log('[SEAT_UPGRADE] findBetterSeats: Found current seat in location', {
        code: currentSeatLocation.code,
        category: currentSeatLocation.category,
        priceTier: currentSeatLocation.priceTier,
        hasSentiment: !!(currentSeatLocation.sentiment && currentSeatLocation.sentiment.length > 0)
      });
      
      // Convert to plain object if Mongoose document
      const currentSeatObj = currentSeat.toObject ? currentSeat.toObject() : currentSeat;
      currentScore = scoreSeatQuality(
        { ...currentSeatObj, seat_id: currentSeatObj.seat_id, code: currentSeatObj.seat_code || currentSeatObj.code },
        location
      );
      
      // Get current seat price for comparison
      currentPrice = currentSeat.event_price || currentSeat.base_price || currentSeat.min_spend || 0;
    }
    
    // Find all available seats in the same event
    // Universal restrictions: only available seats (NOT held or booked)
    const availableSeats = event.seats.filter(seat => {
      // Universal restriction: Must be available (NOT held or booked)
      if (seat.status !== 'available') return false;
      
      // Must meet capacity requirement (admin can override later if needed)
      if (seat.capacity < partySize) return false;
      
      // Exclude the current seat by code (primary identifier)
      // For admin: we'll include it later marked as "current"
      if (!isAdmin && seat.code === (currentSeat.seat_code || currentSeat.code)) {
        return false;
      }
      
      // Also exclude by seat_id if it matches (for clients)
      if (!isAdmin) {
        const seatIdStr = seat._id?.toString();
        const currentSeatIdStr = currentSeat.seat_id?.toString();
        if (seatIdStr && currentSeatIdStr && seatIdStr === currentSeatIdStr) {
          return false;
        }
      }
      
      return true;
    });
    
    console.log('[SEAT_UPGRADE] findBetterSeats: Available seats after filtering', {
      totalEventSeats: event.seats.length,
      availableSeats: availableSeats.length,
      availableSeatCodes: availableSeats.map(s => s.code)
    });
    
    // For admins: show ALL seats (no quality/price filtering)
    // For clients: only show "better" seats (higher quality OR more expensive)
    const processedSeats = availableSeats
      .map(seat => {
        // Use helper function that prioritizes seat_id matching (stable reference)
        const locationSeat = findLocationSeat(seat, location);
        
        if (!locationSeat) {
          console.log('[SEAT_UPGRADE] findBetterSeats: Location seat not found for event seat', {
            eventSeatCode: seat.code,
            eventSeatId: seat._id?.toString()
          });
          return null;
        }
        
        // Convert to plain object if Mongoose document and ensure code is available
        const seatObj = seat.toObject ? seat.toObject() : seat;
        const seatScore = scoreSeatQuality(
          { ...seatObj, seat_id: seatObj._id, code: seatObj.code },
          location
        );
        
        // Get seat price
        const seatPrice = seat.event_price || seat.min_spend || 0;
        
        // Check if this is the current seat
        const isCurrentSeat = seat.code === (currentSeat.seat_code || currentSeat.code) ||
          (seat._id?.toString() === currentSeat.seat_id?.toString());
        
        // For clients: only include if it's better (higher quality OR more expensive)
        // For admins: include all seats (mark current seat)
        const isBetterQuality = seatScore > currentScore;
        const isMoreExpensive = seatPrice > currentPrice;
        const isUpgrade = isBetterQuality || isMoreExpensive;
        const shouldInclude = isAdmin ? true : isUpgrade;
        
        console.log('[SEAT_UPGRADE] findBetterSeats: Scored seat', {
          code: seat.code,
          category: seat.category || locationSeat.category,
          score: seatScore,
          currentScore: currentScore,
          seatPrice: seatPrice,
          currentPrice: currentPrice,
          isBetterQuality: isBetterQuality,
          isMoreExpensive: isMoreExpensive,
          isUpgrade: isUpgrade,
          isCurrentSeat: isCurrentSeat,
          isAdmin: isAdmin,
          shouldInclude: shouldInclude
        });
        
        return {
          seat,
          locationSeat,
          score: seatScore,
          price: seatPrice,
          isBetter: isUpgrade,
          isBetterQuality: isBetterQuality,
          isMoreExpensive: isMoreExpensive,
          isCurrentSeat: isCurrentSeat,
          shouldInclude: shouldInclude
        };
      })
      .filter(item => item && item.shouldInclude)
      .sort((a, b) => {
        // For admins: sort by price (ascending), then quality (descending)
        // For clients: sort by more expensive first, then quality (descending)
        if (isAdmin) {
          if (a.price !== b.price) {
            return a.price - b.price; // Cheaper first for admin
          }
          return b.score - a.score; // Then by quality (descending)
        } else {
          // Client: more expensive first, then quality
          if (a.isMoreExpensive !== b.isMoreExpensive) {
            return b.isMoreExpensive - a.isMoreExpensive;
          }
          return b.score - a.score;
        }
      });
    
    // For clients: limit to top 5, for admins: show all (or reasonable limit)
    const limitedSeats = isAdmin 
      ? processedSeats.slice(0, 100) // Admin: show all (reasonable limit)
      : processedSeats.slice(0, 5); // Client: top 5
    
    const betterSeats = limitedSeats.map(item => {
        // Preserve all seat properties and ensure code and _id are available
        const seat = item.seat;
        // Convert to plain object if Mongoose document
        const seatObj = seat.toObject ? seat.toObject() : seat;
        
        // Ensure code and _id are preserved
        const seatCode = seatObj.code || seatObj.seat_code || '';
        const seatId = seatObj._id || seatObj.seat_id;
        
        console.log('[SEAT_UPGRADE] Mapping better seat', {
          originalCode: seatObj.code,
          originalSeatCode: seatObj.seat_code,
          resolvedCode: seatCode,
          has_id: !!seatObj._id,
          seatKeys: Object.keys(seatObj)
        });
        
        return {
          ...seatObj,
          _id: seatId, // Event seat _id
          seat_id: seatObj.seat_id || seatId, // Location seat reference or event seat _id
          code: seatCode,
          seat_code: seatCode
        };
      });
    
    // Add fits_budget and tag to each seat, ensuring seat_id and code are preserved
    const seatsWithBudgetInfo = betterSeats.map(seat => {
      const seatPrice = seat.event_price || seat.min_spend || 0;
      const priceDelta = seatPrice - currentPrice;
      const fitsBudget = priceDelta <= remainingBudget;
      
      // Ensure seat_id and code are properly set
      const seatId = seat._id || seat.seat_id; // Use _id (event seat ID) as primary
      const seatCode = seat.code || seat.seat_code || '';
      
      console.log('[SEAT_UPGRADE] Mapping seat with budget info', {
        seatId: seatId?.toString(),
        seatCode: seatCode,
        seatKeys: Object.keys(seat),
        has_id: !!seat._id,
        has_seat_id: !!seat.seat_id,
        has_code: !!seat.code
      });
      
      return {
        ...seat,
        _id: seatId, // Ensure _id is set
        seat_id: seatId, // Use same for seat_id
        code: seatCode,
        seat_code: seatCode, // Also set seat_code for compatibility
        fits_budget: fitsBudget,
        tag: fitsBudget ? 'Within Budget' : 'Premium Upgrade'
      };
    });
    
    console.log('[SEAT_UPGRADE] findBetterSeats: Final better seats', {
      betterSeatsCount: seatsWithBudgetInfo.length,
      betterSeatCodes: seatsWithBudgetInfo.map(s => s.code),
      remainingBudget,
      seatsWithinBudget: seatsWithBudgetInfo.filter(s => s.fits_budget).length
    });
    
    return seatsWithBudgetInfo;
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
    
    // Get sentiments using helper function that prioritizes seat_id matching
    const currentLocationSeat = findLocationSeat(currentSeat, location);
    
    // For upgrade seat, we need to match by seat_id (which should be set) or code
    // Note: upgradeSeat might have _id (event seat ID) or seat_id (location seat reference)
    const upgradeLocationSeat = findLocationSeat(upgradeSeat, location);
    
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
 * @param {number} totalBudget - Total budget for budget summary
 * @param {Object} userPreferences - User preferences from COE build (for AI recommendations)
 * @param {boolean} isAdmin - Whether user is admin (if true, show all seats, not just better ones)
 * @returns {Promise<Array>} Array of upgrade offers per seat
 */
async function generateSeatUpgradeOffers(coe, totalBudget = null, userPreferences = {}, isAdmin = false) {
  try {
    // Log function parameters to debug
    console.log('[SEAT_UPGRADE] generateSeatUpgradeOffers: Called with', {
      coeId: coe._id,
      totalBudget,
      isAdmin: isAdmin,
      isAdminType: typeof isAdmin
    });
    
    // Only generate offers for draft COEs
    if (coe.status !== 'draft' && coe.status !== 'request') {
      console.log('[SEAT_UPGRADE] generateSeatUpgradeOffers: COE not in draft status:', coe.status);
      return [];
    }
    
    if (!coe.selected_seats || coe.selected_seats.length === 0) {
      console.log('[SEAT_UPGRADE] generateSeatUpgradeOffers: No selected seats in COE');
      return [];
    }
    
    console.log('[SEAT_UPGRADE] generateSeatUpgradeOffers: Starting', {
      coeId: coe._id,
      selectedSeatsCount: coe.selected_seats.length,
      totalBudget,
      isAdmin: isAdmin
    });
    
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
        // Get event with location populated (include all seat fields including qualityScore)
        const event = await Event.findById(eventId)
          .populate({
            path: 'location_id',
            select: 'seats',
            // Ensure all nested fields in seats array are included
            options: { lean: false }
          });
        
        if (!event || !event.location_id) {
          console.warn('[SEAT_UPGRADE] Event or location not found:', eventId);
          continue;
        }
        
        // Get party size from COE or preferences
        const partySize = coe.preferences?.party_size || 2;
        
        // Calculate remaining budget for fits_budget flag
        const coeTotal = coe.subtotal || 0;
        const remainingBudget = totalBudget ? Math.max(0, totalBudget - coeTotal) : 0;
        
        // Find better seats for each selected seat
        for (const selectedSeat of seats) {
          console.log('[SEAT_UPGRADE] generateSeatUpgradeOffers: Processing seat', {
            seatCode: selectedSeat.seat_code,
            seatId: selectedSeat.seat_id?.toString(),
            eventId: eventId
          });
          
          const betterSeats = await findBetterSeats(
            selectedSeat,
            event,
            event.location_id,
            partySize,
            remainingBudget,
            isAdmin
          );
          
          console.log('[SEAT_UPGRADE] generateSeatUpgradeOffers: Found seats', {
            currentSeatCode: selectedSeat.seat_code,
            seatsCount: betterSeats.length,
            isAdmin: isAdmin
          });
          
          // For admins: show all seats (even if empty, we might want to show current seat)
          // For clients: only show if there are better seats
          if (betterSeats.length > 0 || isAdmin) {
            // Calculate upgrade value and generate recommendations for each alternative
            const alternatives = await Promise.all(betterSeats.map(async (seat) => {
              const upgradeValue = calculateUpgradeValue(
                selectedSeat,
                seat,
                event.location_id
              );
              
              // Get location seat for sentiment and media
              // Use helper function that prioritizes seat_id matching (stable reference)
              const locationSeat = findLocationSeat(seat, event.location_id);
              
              console.log('[SEAT_UPGRADE] Location seat lookup for alternative', {
                seatCode: seat.code || seat.seat_code,
                seatId: seat._id?.toString(),
                seatSeatId: seat.seat_id?.toString(),
                locationSeatsCount: event.location_id.seats.length,
                foundLocationSeat: !!locationSeat,
                hasMedia: !!(locationSeat?.media && locationSeat.media.length > 0),
                mediaCount: locationSeat?.media?.length || 0,
                eventSeatHasMedia: !!(seat.media && seat.media.length > 0),
                eventSeatMediaCount: seat.media?.length || 0
              });
              
              // Ensure seat_id and seat_code are properly extracted
              // seat_id should be the event seat's _id (for referencing the event seat)
              // But we also need the location seat_id reference if available
              const eventSeatId = seat._id || seat.seat_id;
              const seatCode = seat.code || seat.seat_code || '';
              
              // Get location seat ID reference (seat_id field on event seat points to location seat)
              const locationSeatId = seat.seat_id || (locationSeat ? locationSeat._id : null);
              
              console.log('[SEAT_UPGRADE] Creating alternative', {
                eventSeatId: eventSeatId?.toString(),
                locationSeatId: locationSeatId?.toString(),
                seatCode: seatCode,
                seatKeys: Object.keys(seat)
              });
              
              // Get media from location seat (where media is actually stored)
              // Event seats inherit from location but media might not be populated
              const seatMedia = cloneSeatMediaArray(locationSeat?.media || seat.media || []);
              
              // Generate AI recommendation for upgrade alternative if sentiments available
              let aiRecommendation = null;
              if (locationSeat?.sentiment && locationSeat.sentiment.length > 0) {
                try {
                  const locationId = event.location_id._id?.toString() || event.location_id.toString();
                  aiRecommendation = await generateSeatRecommendation(
                    {
                      code: seatCode,
                      category: locationSeat?.category || seat.category,
                      capacity: seat.capacity,
                      section: locationSeat?.section || seat.section,
                      event_price: seat.event_price || seat.min_spend || 0,
                      base_price: seat.min_spend || 0
                    },
                    locationSeat.sentiment,
                    locationId,
                    userPreferences,
                    { timeout: 3000 } // Shorter timeout for upgrade offers
                  );
                } catch (error) {
                  console.warn('[SEAT_UPGRADE] Error generating recommendation for upgrade alternative:', error.message);
                  // Continue without recommendation
                }
              }
              
              // Check if this is the current seat (for admin view)
              const isCurrentSeat = seatCode === selectedSeat.seat_code ||
                (eventSeatId?.toString() === selectedSeat.seat_id?.toString());
              
              return {
                seat_id: eventSeatId, // Use event seat _id as the primary identifier
                seat_code: seatCode,
                capacity: seat.capacity,
                event_price: seat.event_price || seat.min_spend || 0,
                base_price: seat.min_spend || 0,
                price_delta: upgradeValue.price_delta,
                price_delta_percentage: upgradeValue.price_delta_percentage,
                upgrade_reasons: upgradeValue.upgrade_reasons,
                sentiment: locationSeat?.sentiment || [],
                category: seat.category,
                section: seat.section,
                media: seatMedia, // Use location seat media (fallback to event seat media)
                fits_budget: seat.fits_budget || false,
                tag: isCurrentSeat && isAdmin ? 'Currently Selected' : (seat.tag || 'Premium Upgrade'),
                status: 'pending',
                offered_at: new Date(),
                ai_recommendation: aiRecommendation, // Include AI recommendation if generated
                is_current_seat: isCurrentSeat && isAdmin // Mark current seat for admin view
              };
            }));
            
            offers.push({
              current_seat_id: selectedSeat.seat_id,
              current_seat_code: selectedSeat.seat_code,
              event_id: eventId,
              event_name: event.name,
              current_price: selectedSeat.event_price || selectedSeat.base_price || 0,
              alternatives: alternatives,
              generated_at: new Date()
            });
          } else {
            console.log('[SEAT_UPGRADE] generateSeatUpgradeOffers: No better seats found for', {
              seatCode: selectedSeat.seat_code,
              eventName: event.name
            });
          }
        }
      } catch (error) {
        console.error('[SEAT_UPGRADE] Error processing event:', eventId, error);
        // Continue with other events
      }
    }
    
    console.log('[SEAT_UPGRADE] generateSeatUpgradeOffers: Completed', {
      totalOffers: offers.length,
      offersPerSeat: offers.map(o => ({ seat: o.current_seat_code, alternatives: o.alternatives?.length || 0 }))
    });

    try {
      await enrichSeatUpgradeOffersPayload(offers);
    } catch (enrichErr) {
      console.warn('[SEAT_UPGRADE] enrich offer media metadata:', enrichErr.message);
    }

    return offers;
  } catch (error) {
    console.error('[SEAT_UPGRADE] Error generating upgrade offers:', error);
    return [];
  }
}

module.exports = {
  findLocationSeat, // Export helper for reuse in other services
  scoreSeatQuality,
  findBetterSeats,
  calculateUpgradeValue,
  calculateUpgradeReasons,
  generateSeatUpgradeOffers
};


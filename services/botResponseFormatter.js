/**
 * Bot Response Formatter
 * @description Utility functions for formatting structured bot responses
 * 
 * Structured responses enable the frontend to render interactive UI components
 * instead of plain text, improving user experience and enabling direct actions.
 */

/**
 * Normalize an ID to string for comparison
 * @param {*} id - ID (ObjectId, string, or object with _id)
 * @returns {string} Normalized ID string
 */
function normalizeId(id) {
  if (!id) return '';
  if (typeof id === 'string') return id;
  if (id._id) return id._id.toString();
  if (id.toString) return id.toString();
  return String(id);
}

/**
 * Normalize a user document or id into a lightweight runner object
 * @param {Object|string} user - Mongoose user doc or id
 * @returns {{id:string,name:string,email?:string,phone?:string,avatarUrl?:string}|null}
 */
function toRunner(user) {
  if (!user) return null;
  const id = user && user._id ? String(user._id) : String(user);
  const name = (user && user.firstName && user.lastName)
    ? `${user.firstName} ${user.lastName}`
    : (user && user.email) ? user.email : 'Unknown';
  return {
    id,
    name,
    email: user?.email ?? null,
    phone: user?.phone ?? null,
    avatarUrl: user?.avatarUrl ?? null
  };
}

/**
 * Build an event-level runner assignment, falling back to COE-level runner when
 * the event's runner assignment lacks a runner_id.
 * @param {Object} event - COE.events item (with possible runner_assignment)
 * @param {Object} coe - Parent COE (may contain runner_assignment)
 * @returns {{type?:string, runner?:Object, status?:string, assigned_at?:string}|null}
 */
function buildEventRunnerAssignment(event, coe) {
  const evRA = event?.runner_assignment;
  const coeRA = coe?.runner_assignment;
  const user = evRA?.runner_id ?? coeRA?.runner_id ?? null;
  const status = (evRA?.status ?? coeRA?.status) ?? null;
  const type = (evRA?.type ?? coeRA?.type) ?? null;
  const assignedAt = evRA?.assigned_at ?? coeRA?.assigned_at ?? null;

  if (!user && !status && !type && !assignedAt) return null;
  return {
    ...(type ? { type } : {}),
    ...(user ? { runner: toRunner(user) } : {}),
    ...(status ? { status } : {}),
    ...(assignedAt ? { assigned_at: assignedAt } : {})
  };
}
/**
 * Create a structured COE response
 * @param {string} type - Response type: 'coe_created', 'coe_updated', 'coe_details', 'coe_list'
 * @param {Object} coe - COE object
 * @param {string} message - Human-readable message
 * @param {Array} actions - Available actions for this COE
 * @returns {Object} Structured response
 */
async function formatCOEResponse(type, coe, message, actions = [], budget = null) {
  // Enhance selected_seats with media and event info
  const enhancedSeats = (coe.selected_seats || []).map(seat => {
    // Normalize seat event_id for comparison
    const seatEventId = normalizeId(seat.event_id);
    
    // Debug logging
    console.log('[formatCOEResponse] Processing seat:', {
      seatEventId,
      seatEventIdType: typeof seat.event_id,
      seatEventIdValue: seat.event_id,
      availableEvents: coe.events?.map(e => ({
        eventId: normalizeId(e?.event_id),
        eventIdRaw: e?.event_id,
        eventName: e?.event_id?.name,
        eventIdType: typeof e?.event_id,
        isObject: typeof e?.event_id === 'object',
        hasId: !!e?.event_id?._id
      }))
    });
    
    // Find the event for this seat - try multiple matching strategies
    const event = coe.events?.find(e => {
      if (!e || !e.event_id) return false;
      // If event_id is populated (object with _id), compare _id
      const eventId = normalizeId(e.event_id);
      const matches = eventId === seatEventId;
      if (matches) {
        console.log('[formatCOEResponse] Found matching event:', {
          eventId,
          seatEventId,
          eventName: e.event_id?.name,
          event: e
        });
      }
      return matches;
    });
    
    if (!event) {
      console.log('[formatCOEResponse] Event NOT found for seat:', {
        seatEventId,
        eventsCount: coe.events?.length || 0,
        events: coe.events
      });
    }
    
    // Find the seat in event.seats to get media
    let seatMedia = [];
    if (event?.event_id?.seats && Array.isArray(event.event_id.seats)) {
      const seatId = normalizeId(seat.seat_id);
      const seatIdStr = seat.seat_id?.toString();
      const seatCode = seat.seat_code;
      
      console.log('[formatCOEResponse] Looking for seat media:', {
        seatId,
        seatIdStr,
        seatCode,
        seatSeatId: seat.seat_id,
        seatSeatIdType: typeof seat.seat_id,
        eventSeatsCount: event.event_id.seats.length,
        eventSeats: event.event_id.seats.map(s => ({
          _id: s._id?.toString(),
          _idType: typeof s._id,
          code: s.code,
          hasMedia: !!(s.media && s.media.length > 0),
          mediaCount: s.media?.length || 0
        }))
      });
      
      // Try multiple matching strategies
      let eventSeat = null;
      
      // Strategy 1: Match by _id (normalized)
      eventSeat = event.event_id.seats.find(s => {
        const sId = normalizeId(s._id);
        return sId === seatId;
      });
      
      // Strategy 2: Match by _id (direct string comparison)
      if (!eventSeat) {
        eventSeat = event.event_id.seats.find(s => {
          return s._id?.toString() === seatIdStr;
        });
      }
      
      // Strategy 3: Match by _id (ObjectId comparison)
      if (!eventSeat && seat.seat_id) {
        eventSeat = event.event_id.seats.find(s => {
          return s._id?.equals ? s._id.equals(seat.seat_id) : false;
        });
      }
      
      // Strategy 4: Match by code (fallback)
      if (!eventSeat && seatCode) {
        eventSeat = event.event_id.seats.find(s => {
          return s.code === seatCode;
        });
        if (eventSeat) {
          console.log('[formatCOEResponse] Found seat by code fallback:', {
            seatCode,
            eventSeatId: eventSeat._id?.toString(),
            hasMedia: !!(eventSeat.media && eventSeat.media.length > 0),
            media: eventSeat.media
          });
        }
      }
      
      if (eventSeat) {
        console.log('[formatCOEResponse] Found matching seat:', {
          seatId,
          seatCode,
          eventSeatId: eventSeat._id?.toString(),
          eventSeatCode: eventSeat.code,
          hasMedia: !!(eventSeat.media && eventSeat.media.length > 0),
          mediaCount: eventSeat.media?.length || 0,
          media: eventSeat.media
        });
        
        if (eventSeat.media && Array.isArray(eventSeat.media) && eventSeat.media.length > 0) {
          seatMedia = eventSeat.media;
          console.log('[formatCOEResponse] Seat media found in Event seat:', {
            mediaCount: seatMedia.length,
            media: seatMedia
          });
        } else {
          // Fallback: Try to get media from Location seat (Event seats inherit from Location seats)
          if (event?.event_id?.location_id?.seats && Array.isArray(event.event_id.location_id.seats)) {
            const locationSeatId = eventSeat.seat_id?.toString() || normalizeId(eventSeat.seat_id);
            const locationSeat = event.event_id.location_id.seats.find(s => {
              return normalizeId(s._id) === locationSeatId || s._id?.toString() === locationSeatId;
            });
            
            if (locationSeat?.media && Array.isArray(locationSeat.media) && locationSeat.media.length > 0) {
              seatMedia = locationSeat.media;
              console.log('[formatCOEResponse] Seat media found in Location seat (fallback):', {
                locationSeatId,
                mediaCount: seatMedia.length,
                media: seatMedia
              });
            } else {
              console.log('[formatCOEResponse] Seat found but no media in Event or Location seat:', {
                eventSeatId: eventSeat._id?.toString(),
                locationSeatId,
                eventSeatHasMedia: !!(eventSeat.media && eventSeat.media.length > 0),
                locationSeatFound: !!locationSeat,
                locationSeatHasMedia: !!(locationSeat?.media && locationSeat.media.length > 0)
              });
            }
          } else {
            console.log('[formatCOEResponse] Seat found but no media, and no location seats available:', {
              eventSeatId: eventSeat._id?.toString(),
              hasLocation: !!event?.event_id?.location_id,
              hasLocationSeats: !!(event?.event_id?.location_id?.seats),
              locationSeatsType: typeof event?.event_id?.location_id?.seats,
              isArray: Array.isArray(event?.event_id?.location_id?.seats)
            });
          }
        }
      } else {
        console.log('[formatCOEResponse] No matching seat found:', {
          seatId,
          seatIdStr,
          seatCode,
          eventSeatsCodes: event.event_id.seats.map(s => s.code),
          eventSeatsIds: event.event_id.seats.map(s => s._id?.toString())
        });
      }
    } else {
      console.log('[formatCOEResponse] No event seats available:', {
        hasEvent: !!event,
        hasEventId: !!event?.event_id,
        hasSeats: !!(event?.event_id?.seats),
        seatsType: typeof event?.event_id?.seats,
        isArray: Array.isArray(event?.event_id?.seats)
      });
    }
    
    // Get event name from multiple possible locations
    const eventName = event?.event_id?.name || 
                     event?.event_name || 
                     (event?.event_id && typeof event.event_id === 'object' && event.event_id.name) ||
                     'Unknown Event';
    
    console.log('[formatCOEResponse] Final event name:', {
      eventName,
      eventFound: !!event,
      eventIdName: event?.event_id?.name,
      eventNameProp: event?.event_name,
      eventObject: event
    });
    
    // Get event date from multiple possible locations
    // Prioritize populated event_id.start_datetime (actual event date from DB)
    // Fall back to event.event_date (stored in COE) if event_id not populated
    const eventDate = event?.event_id?.start_datetime || 
                     event?.event_date || 
                     null;
    
    // Create a plain object to ensure all fields are included
    const enhancedSeat = {
      event_id: seat.event_id?._id?.toString() || seat.event_id?.toString?.() || seat.event_id,
      seat_id: seat.seat_id?._id?.toString() || seat.seat_id?.toString?.() || seat.seat_id,
      seat_code: seat.seat_code,
      capacity: seat.capacity,
      base_price: seat.base_price,
      event_price: seat.event_price,
      available_from: seat.available_from,
      available_until: seat.available_until,
      status: seat.status,
      event_name: eventName, // Explicitly include event_name
      event_date: eventDate, // Explicitly include event_date
      media: seatMedia, // Add media from event seat
      ai_recommendation: seat.ai_recommendation, // Include AI recommendation
      recommendation_generated_at: seat.recommendation_generated_at,
      recommendation_version: seat.recommendation_version
    };
    
    console.log('[formatCOEResponse] Enhanced seat object:', {
      event_name: enhancedSeat.event_name,
      event_date: enhancedSeat.event_date,
      hasMedia: enhancedSeat.media.length > 0,
      allKeys: Object.keys(enhancedSeat)
    });
    
    return enhancedSeat;
  });
  
  return {
    type: type,
    coe_id: coe._id?.toString() || coe.id,
    coe: {
      id: coe._id?.toString() || coe.id,
      name: coe.name,
      description: coe.description,
      status: coe.status,
      start_date: coe.start_date,
      end_date: coe.end_date,
      created_method: coe.created_method,
      pricing: {
        subtotal: coe.subtotal || 0,
        taxes: coe.taxes || 0,
        fees: coe.fees || 0,
        total: coe.total || 0,
        deposit_required: coe.deposit_required || 0,
        currency: coe.currency || 'USD',
        // Phase 2.5: Budget comparison
        ...(budget ? {
          budget: budget.max || budget.amount || budget,
          over_budget: (coe.total || 0) > (budget.max || budget.amount || budget),
          over_amount: Math.max(0, (coe.total || 0) - (budget.max || budget.amount || budget)),
          under_budget: (coe.total || 0) < (budget.max || budget.amount || budget),
          under_amount: Math.max(0, (budget.max || budget.amount || budget) - (coe.total || 0))
        } : {})
      },
      // Budget summary for smart seat selection feature
      budget_summary: budget ? {
        total_budget: budget.max || budget.amount || budget,
        coe_total: coe.subtotal || 0,
        remaining: Math.max(0, (budget.max || budget.amount || budget) - (coe.subtotal || 0)),
        utilization_percentage: Math.round(((coe.subtotal || 0) / (budget.max || budget.amount || budget)) * 100)
      } : null,
      events: await Promise.all((coe.events || []).map(async (event) => {
        const runner_assignment = buildEventRunnerAssignment(event, coe);
        // Prioritize populated event_id.start_datetime (actual event date from DB)
        // Fall back to event.event_date (stored in COE) if event_id not populated
        const eventDate = event.event_id?.start_datetime || event.event_date || null;
        const eventId = event.event_id?._id?.toString() || event.event_id?.toString() || event.event_id;
        
        // Check if there are same-day alternatives (only for draft COEs)
        let hasSameDayAlternatives = false;
        if (coe.status === 'draft' && eventId && coe._id) {
          try {
            const { hasAlternativeEventsSameDay } = require('./coeService');
            console.log('[BOT_RESPONSE_FORMATTER] Checking same-day alternatives for event:', {
              coeId: coe._id.toString(),
              eventId: eventId,
              eventName: event.event_id?.name || 'Unknown'
            });
            hasSameDayAlternatives = await hasAlternativeEventsSameDay(coe._id.toString(), eventId);
            console.log('[BOT_RESPONSE_FORMATTER] Same-day alternatives result:', {
              eventId: eventId,
              hasSameDayAlternatives: hasSameDayAlternatives
            });
          } catch (error) {
            console.warn('[BOT_RESPONSE_FORMATTER] Error checking same-day alternatives:', error);
            // Default to false on error
          }
        }
        
        return {
          event_id: eventId,
          event_name: event.event_id?.name || 'Unknown Event',
          description: event.event_id?.description || null,
          event_date: eventDate,
          event_time: event.event_time,
          media: event.event_id?.media || [],
          location: event.event_id?.location_id ? {
            id: event.event_id.location_id._id?.toString() || event.event_id.location_id?.toString(),
            name: event.event_id.location_id.name,
            type: event.event_id.location_id.type,
            media: event.event_id.location_id.media || []
          } : null,
          // Phase 2.5: Include sentiment match data if available
          sentiment_match: event.sentiment_match ? {
            score: event.sentiment_match.score || 0,
            reasons: event.sentiment_match.reasons || event.sentiment_match.highlights || [],
            highlights: event.sentiment_match.highlights || event.sentiment_match.reasons || []
          } : null,
          // Flag indicating if same-day alternatives exist (for Replace button visibility)
          has_same_day_alternatives: hasSameDayAlternatives,
          ...(runner_assignment ? { runner_assignment } : {})
        };
      })),
      selected_seats: enhancedSeats, // Use enhanced seats with media
      events_count: coe.events?.length || 0,
      seats_count: coe.selected_seats?.length || 0,
      runner_assignment: coe.runner_assignment ? {
        type: coe.runner_assignment.type,
        runner: coe.runner_assignment.runner_id ? {
          id: coe.runner_assignment.runner_id._id?.toString() || coe.runner_assignment.runner_id.toString(),
          name: coe.runner_assignment.runner_id.firstName && coe.runner_assignment.runner_id.lastName
            ? `${coe.runner_assignment.runner_id.firstName} ${coe.runner_assignment.runner_id.lastName}`
            : coe.runner_assignment.runner_id.email || 'Unknown',
          email: coe.runner_assignment.runner_id.email,
          phone: coe.runner_assignment.runner_id.phone,
          avatarUrl: coe.runner_assignment.runner_id.avatarUrl || null
        } : null,
        status: coe.runner_assignment.status,
        assigned_at: coe.runner_assignment.assigned_at,
        notes: coe.runner_assignment.notes
      } : null,
      client: coe.client_id ? {
        id: coe.client_id._id?.toString() || coe.client_id.toString(),
        name: coe.client_id.firstName && coe.client_id.lastName 
          ? `${coe.client_id.firstName} ${coe.client_id.lastName}`
          : coe.client_id.email || 'Unknown'
      } : null,
      created_at: coe.created_at,
      updated_at: coe.updated_at,
      // Include seat upgrade offers if available, with normalized event_id
      seat_upgrade_offers: (coe.seat_upgrade_offers || []).map(offer => ({
        ...offer.toObject ? offer.toObject() : offer,
        event_id: offer.event_id?._id?.toString() || offer.event_id?.toString() || offer.event_id,
        current_seat_id: offer.current_seat_id?._id?.toString() || offer.current_seat_id?.toString() || offer.current_seat_id,
        alternatives: (offer.alternatives || []).map(alt => ({
          ...alt.toObject ? alt.toObject() : alt,
          seat_id: alt.seat_id?._id?.toString() || alt.seat_id?.toString() || alt.seat_id,
          ai_recommendation: alt.ai_recommendation // Include AI recommendation for upgrade alternatives
        }))
      }))
    },
    message: message,
    actions: actions
  };
}

/**
 * Create a structured event list response
 * @param {Array} events - Array of event objects
 * @param {string} message - Human-readable message
 * @returns {Object} Structured response
 */
function formatEventListResponse(events, message) {
  return {
    type: 'event_list',
    events: events.map(event => ({
      id: event.id || event._id?.toString(),
      name: event.name,
      description: event.description,
      type: event.type,
      start_datetime: event.start_datetime,
      end_datetime: event.end_datetime,
      base_price: event.base_price,
      currency: event.currency || 'USD',
      status: event.status,
      location: event.location || event.location_id ? {
        id: event.location?.id || event.location_id?._id?.toString() || event.location_id?.toString(),
        name: event.location?.name || event.location_id?.name,
        address: event.location?.address || event.location_id?.address || null, // Full address object
        geo: event.location?.geo || event.location_id?.geo || null, // Geo coordinates
        city: event.location?.city || event.location_id?.address?.city,
        country: event.location?.country || event.location_id?.address?.country,
        media: event.location?.media || event.location_id?.media || [] // Include location media for EventCard component
      } : null,
      sentiment: event.sentiment || null,
      media: event.media || [],
      seats: event.seats || [],
      available_seats_count: event.available_seats_count || 0
    })),
    count: events.length,
    message: message
  };
}

/**
 * Create a structured COE list response
 * @param {Array} coes - Array of COE objects
 * @param {string} message - Human-readable message
 * @returns {Object} Structured response
 */
async function formatCOEListResponse(coes, message) {
  return {
    type: 'coe_list',
    coes: await Promise.all(coes.map(async (coe) => {
      // Enhance selected_seats with media and event info (similar to formatCOEResponse)
      const enhancedSeats = (coe.selected_seats || []).map(seat => {
        // Normalize seat event_id for comparison
        const seatEventId = normalizeId(seat.event_id);
        
        // Debug logging
        console.log('[formatCOEListResponse] Processing seat for COE:', coe.name, {
          seatEventId,
          seatEventIdType: typeof seat.event_id,
          seatEventIdValue: seat.event_id,
          availableEvents: coe.events?.map(e => ({
            eventId: normalizeId(e?.event_id),
            eventIdRaw: e?.event_id,
            eventName: e?.event_id?.name,
            eventIdType: typeof e?.event_id,
            isObject: typeof e?.event_id === 'object',
            hasId: !!e?.event_id?._id
          }))
        });
        
        // Find the event for this seat - try multiple matching strategies
        const event = coe.events?.find(e => {
          if (!e || !e.event_id) return false;
          // If event_id is populated (object with _id), compare _id
          const eventId = normalizeId(e.event_id);
          const matches = eventId === seatEventId;
          if (matches) {
            console.log('[formatCOEListResponse] Found matching event:', {
              eventId,
              seatEventId,
              eventName: e.event_id?.name,
              event: e
            });
          }
          return matches;
        });
        
        if (!event) {
          console.log('[formatCOEListResponse] Event NOT found for seat:', {
            seatEventId,
            eventsCount: coe.events?.length || 0,
            events: coe.events
          });
        }
        
        // Find the seat in event.seats to get media
        let seatMedia = [];
        if (event?.event_id?.seats && Array.isArray(event.event_id.seats)) {
          const seatId = normalizeId(seat.seat_id);
          const seatIdStr = seat.seat_id?.toString();
          const seatCode = seat.seat_code;
          
          console.log('[formatCOEListResponse] Looking for seat media:', {
            seatId,
            seatIdStr,
            seatCode,
            seatSeatId: seat.seat_id,
            seatSeatIdType: typeof seat.seat_id,
            eventSeatsCount: event.event_id.seats.length,
            eventSeats: event.event_id.seats.map(s => ({
              _id: s._id?.toString(),
              _idType: typeof s._id,
              code: s.code,
              hasMedia: !!(s.media && s.media.length > 0),
              mediaCount: s.media?.length || 0
            }))
          });
          
          // Try multiple matching strategies
          let eventSeat = null;
          
          // Strategy 1: Match by _id (normalized)
          eventSeat = event.event_id.seats.find(s => {
            const sId = normalizeId(s._id);
            return sId === seatId;
          });
          
          // Strategy 2: Match by _id (direct string comparison)
          if (!eventSeat) {
            eventSeat = event.event_id.seats.find(s => {
              return s._id?.toString() === seatIdStr;
            });
          }
          
          // Strategy 3: Match by _id (ObjectId comparison)
          if (!eventSeat && seat.seat_id) {
            eventSeat = event.event_id.seats.find(s => {
              return s._id?.equals ? s._id.equals(seat.seat_id) : false;
            });
          }
          
          // Strategy 4: Match by code (fallback)
          if (!eventSeat && seatCode) {
            eventSeat = event.event_id.seats.find(s => {
              return s.code === seatCode;
            });
            if (eventSeat) {
              console.log('[formatCOEListResponse] Found seat by code fallback:', {
                seatCode,
                eventSeatId: eventSeat._id?.toString(),
                hasMedia: !!(eventSeat.media && eventSeat.media.length > 0),
                media: eventSeat.media
              });
            }
          }
          
          if (eventSeat) {
            console.log('[formatCOEListResponse] Found matching seat:', {
              seatId,
              seatCode,
              eventSeatId: eventSeat._id?.toString(),
              eventSeatCode: eventSeat.code,
              hasMedia: !!(eventSeat.media && eventSeat.media.length > 0),
              mediaCount: eventSeat.media?.length || 0,
              media: eventSeat.media
            });
            
            if (eventSeat.media && Array.isArray(eventSeat.media) && eventSeat.media.length > 0) {
              seatMedia = eventSeat.media;
              console.log('[formatCOEListResponse] Seat media found in Event seat:', {
                mediaCount: seatMedia.length,
                media: seatMedia
              });
            } else {
              // Fallback: Try to get media from Location seat (Event seats inherit from Location seats)
              if (event?.event_id?.location_id?.seats && Array.isArray(event.event_id.location_id.seats)) {
                const locationSeatId = eventSeat.seat_id?.toString() || normalizeId(eventSeat.seat_id);
                const locationSeat = event.event_id.location_id.seats.find(s => {
                  return normalizeId(s._id) === locationSeatId || s._id?.toString() === locationSeatId;
                });
                
                if (locationSeat?.media && Array.isArray(locationSeat.media) && locationSeat.media.length > 0) {
                  seatMedia = locationSeat.media;
                  console.log('[formatCOEListResponse] Seat media found in Location seat (fallback):', {
                    locationSeatId,
                    mediaCount: seatMedia.length,
                    media: seatMedia
                  });
                } else {
                  console.log('[formatCOEListResponse] Seat found but no media in Event or Location seat:', {
                    eventSeatId: eventSeat._id?.toString(),
                    locationSeatId,
                    eventSeatHasMedia: !!(eventSeat.media && eventSeat.media.length > 0),
                    locationSeatFound: !!locationSeat,
                    locationSeatHasMedia: !!(locationSeat?.media && locationSeat.media.length > 0)
                  });
                }
              } else {
                console.log('[formatCOEListResponse] Seat found but no media, and no location seats available:', {
                  eventSeatId: eventSeat._id?.toString(),
                  hasLocation: !!event?.event_id?.location_id,
                  hasLocationSeats: !!(event?.event_id?.location_id?.seats),
                  locationSeatsType: typeof event?.event_id?.location_id?.seats,
                  isArray: Array.isArray(event?.event_id?.location_id?.seats)
                });
              }
            }
          } else {
            console.log('[formatCOEListResponse] No matching seat found:', {
              seatId,
              seatIdStr,
              seatCode,
              eventSeatsCodes: event.event_id.seats.map(s => s.code),
              eventSeatsIds: event.event_id.seats.map(s => s._id?.toString())
            });
          }
        } else {
          console.log('[formatCOEListResponse] No event seats available:', {
            hasEvent: !!event,
            hasEventId: !!event?.event_id,
            hasSeats: !!(event?.event_id?.seats),
            seatsType: typeof event?.event_id?.seats,
            isArray: Array.isArray(event?.event_id?.seats)
          });
        }
        
        // Get event name from multiple possible locations
        const eventName = event?.event_id?.name || 
                         event?.event_name || 
                         (event?.event_id && typeof event.event_id === 'object' && event.event_id.name) ||
                         'Unknown Event';
        
        console.log('[formatCOEListResponse] Final event name:', {
          eventName,
          eventFound: !!event,
          eventIdName: event?.event_id?.name,
          eventNameProp: event?.event_name,
          eventObject: event
        });
        
        // Get event date from multiple possible locations
        const eventDate = event?.event_date || 
                         event?.event_id?.start_datetime || 
                         null;
        
        // Create a plain object to ensure all fields are included
        const enhancedSeat = {
          event_id: seat.event_id,
          seat_id: seat.seat_id,
          seat_code: seat.seat_code,
          capacity: seat.capacity,
          base_price: seat.base_price,
          event_price: seat.event_price,
          available_from: seat.available_from,
          available_until: seat.available_until,
          status: seat.status,
          event_name: eventName, // Explicitly include event_name
          event_date: eventDate, // Explicitly include event_date
          media: seatMedia // Add media from event seat
        };
        
        console.log('[formatCOEListResponse] Enhanced seat object:', {
          event_name: enhancedSeat.event_name,
          event_date: enhancedSeat.event_date,
          hasMedia: enhancedSeat.media.length > 0,
          allKeys: Object.keys(enhancedSeat)
        });
        
        return enhancedSeat;
      });
      
      console.log('[formatCOEListResponse] Enhanced seats array:', {
        count: enhancedSeats.length,
        firstSeat: enhancedSeats[0] ? {
          event_name: enhancedSeats[0].event_name,
          event_date: enhancedSeats[0].event_date,
          keys: Object.keys(enhancedSeats[0])
        } : null
      });
      
      return {
        id: coe.id || coe._id?.toString(),
        name: coe.name,
        status: coe.status,
        start_date: coe.start_date,
        end_date: coe.end_date,
        events_count: coe.events_count || coe.events?.length || 0,
        seats_count: coe.seats_count || coe.selected_seats?.length || 0,
        total_price: coe.total_price || coe.total || 0,
        currency: coe.currency || 'USD',
        created_at: coe.created_at,
        events: await Promise.all((coe.events || []).map(async (event) => {
          const runner_assignment = buildEventRunnerAssignment(event, coe);
          const eventId = event.event_id?._id?.toString() || event.event_id?.toString() || event.event_id;
          
          // Check if there are same-day alternatives (only for draft COEs)
          let hasSameDayAlternatives = false;
          if (coe.status === 'draft' && eventId && (coe.id || coe._id)) {
            try {
              const { hasAlternativeEventsSameDay } = require('./coeService');
              const coeId = coe.id || coe._id?.toString() || coe._id;
              console.log('[formatCOEListResponse] Checking same-day alternatives for event:', {
                coeId: coeId,
                eventId: eventId,
                eventName: event.event_id?.name || 'Unknown'
              });
              hasSameDayAlternatives = await hasAlternativeEventsSameDay(coeId, eventId);
              console.log('[formatCOEListResponse] Same-day alternatives result:', {
                eventId: eventId,
                hasSameDayAlternatives: hasSameDayAlternatives
              });
            } catch (error) {
              console.warn('[formatCOEListResponse] Error checking same-day alternatives:', error);
              // Default to false on error
            }
          }
          
          return {
            event_id: eventId,
            event_name: event.event_id?.name || 'Unknown Event',
            description: event.event_id?.description || null,
            event_date: event.event_date,
            event_time: event.event_time,
            media: event.event_id?.media || [],
            location: event.event_id?.location_id ? {
              id: event.event_id.location_id._id?.toString() || event.event_id.location_id?.toString(),
              name: event.event_id.location_id.name,
              type: event.event_id.location_id.type,
              media: event.event_id.location_id.media || []
            } : null,
            // Flag indicating if same-day alternatives exist (for Replace button visibility)
            has_same_day_alternatives: hasSameDayAlternatives,
            ...(runner_assignment ? { runner_assignment } : {})
          };
        })),
        selected_seats: enhancedSeats, // Enhanced seats with media
        runner_assignment: coe.runner_assignment ? {
          type: coe.runner_assignment.type,
          runner: coe.runner_assignment.runner_id ? {
            id: coe.runner_assignment.runner_id._id?.toString() || coe.runner_assignment.runner_id.toString(),
            name: coe.runner_assignment.runner_id.firstName && coe.runner_assignment.runner_id.lastName
              ? `${coe.runner_assignment.runner_id.firstName} ${coe.runner_assignment.runner_id.lastName}`
              : coe.runner_assignment.runner_id.email || 'Unknown',
            email: coe.runner_assignment.runner_id.email,
            phone: coe.runner_assignment.runner_id.phone,
            avatarUrl: coe.runner_assignment.runner_id.avatarUrl || null
          } : null,
          status: coe.runner_assignment.status,
          assigned_at: coe.runner_assignment.assigned_at,
          notes: coe.runner_assignment.notes
        } : null,
        pricing: coe.pricing || {
          subtotal: coe.subtotal || 0,
          taxes: coe.taxes || 0,
          fees: coe.fees || 0,
          total: coe.total_price || coe.total || 0,
          deposit_required: coe.deposit_required || 0,
          currency: coe.currency || 'USD'
        }
      };
    })),
    count: coes.length,
    message: message
  };
}

/**
 * Create action buttons for a COE
 * @param {Object} coe - COE object
 * @param {string} userRole - User role (admin, client, runner)
 * @returns {Array} Array of action objects
 */
function createCOEActions(coe, userRole) {
  const actions = [];
  const coeId = coe._id?.toString() || coe.id;
  const status = coe.status;

  // View Details - always available
  actions.push({
    label: 'View Details',
    action: 'view_coe',
    coe_id: coeId,
    type: 'button'
  });

  // Edit - available for draft/approved COEs
  if (userRole === 'admin' || (userRole === 'client' && ['draft', 'approved'].includes(status))) {
    actions.push({
      label: 'Edit',
      action: 'edit_coe',
      coe_id: coeId,
      type: 'button'
    });
  }

  // Approve - only for admins on draft COEs
  if (userRole === 'admin' && status === 'draft') {
    actions.push({
      label: 'Approve',
      action: 'approve_coe',
      coe_id: coeId,
      type: 'button'
    });
  }

  // Phase 2.5: Cancel - available for draft COEs (clients can cancel their own drafts)
  if (status === 'draft' && (userRole === 'client' || userRole === 'admin')) {
    actions.push({
      label: 'Cancel',
      action: 'cancel_draft',
      coe_id: coeId,
      type: 'button',
      confirm: true
    });
  }

  // Send - only for admins on approved COEs
  if (userRole === 'admin' && status === 'approved') {
    actions.push({
      label: 'Send to Client',
      action: 'send_coe',
      coe_id: coeId,
      type: 'button'
    });
  }

  return actions;
}

/**
 * Format a simple text response (for non-structured responses)
 * @param {string} message - Text message
 * @returns {Object} Simple response object
 */
function formatTextResponse(message) {
  return {
    type: 'text',
    message: message
  };
}

/**
 * Create a structured location list response
 * @param {Array} locations - Array of location objects
 * @param {string} message - Human-readable message
 * @returns {Object} Structured response
 */
function formatLocationListResponse(locations, message) {
  return {
    type: 'location_list',
    locations: locations.map(location => ({
      id: location.id || location._id?.toString(),
      name: location.name,
      type: location.type,
      description: location.description,
      address: location.address || null,
      geo: location.geo || null,
      status: location.status,
      score: location.score,
      tags: location.tags || [],
      media: location.media || [],
      seats: location.seats ? location.seats.map(seat => ({
        id: seat._id?.toString() || seat.id?.toString(),
        code: seat.code,
        label: seat.label,
        category: seat.category,
        section: seat.section,
        capacity: seat.capacity,
        minSpendUSD: seat.minSpendUSD,
        priceTier: seat.priceTier,
        media: seat.media || [],
        sentiment: seat.sentiment || []
      })) : []
    })),
    count: locations.length,
    message: message
  };
}

/**
 * Create a structured COE preferences form response
 * @param {string} message - Human-readable message
 * @returns {Object} Structured response
 */
function formatCOEPreferencesFormResponse(message) {
  return {
    type: 'coe_preferences_form',
    message: message || 'Please fill in your preferences to build your experience.',
    fields: {
      city: {
        label: 'City',
        type: 'select',
        required: true,
        placeholder: 'Select a city',
        options: [] // Will be populated from API
      },
      start_date: {
        label: 'Start Date',
        type: 'date',
        required: true,
        placeholder: 'Select start date'
      },
      end_date: {
        label: 'End Date',
        type: 'date',
        required: true,
        placeholder: 'Select end date'
      },
      budget: {
        label: 'Budget',
        type: 'number',
        required: true,
        placeholder: 'Enter your budget',
        currency: 'USD'
      },
      party_size: {
        label: 'Number of People',
        type: 'number',
        required: true,
        placeholder: 'Enter number of people',
        min: 1
      },
      seat_preferences: {
        label: 'Seat/Table Preferences',
        type: 'textarea',
        required: false,
        placeholder: 'E.g., VIP table near the stage, private booth, outdoor seating'
      },
      specific_preferences: {
        label: 'Specific Preferences',
        type: 'textarea',
        required: false,
        placeholder: 'E.g., EDM music, upscale atmosphere, birthday celebration'
      }
    }
  };
}

/**
 * Check if a response is structured
 * @param {Object} response - Response object
 * @returns {boolean} True if structured
 */
/**
 * Format error response when no seats are available
 * @param {Object} errorData - Error data with searchAttempts and preferences
 * @returns {Object} Formatted error response
 */
/**
 * Format user profile response
 * @param {Object} user - User object with profile data
 * @param {string} message - Optional message to display
 * @returns {Object} Structured profile response
 */
function formatProfileResponse(user, message) {
  return {
    type: 'user_profile',
    message: message || 'Here is your profile information.',
    profile: {
      id: user._id?.toString() || user.id?.toString() || user._id || user.id,
      name: user.firstName && user.lastName 
        ? `${user.firstName} ${user.lastName}`
        : user.name || user.email || 'Unknown',
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      email: user.email || null,
      phone: user.phone || null,
      role: user.role || null,
      avatarUrl: user.avatarUrl || null,
      dateOfBirth: user.dateOfBirth || null,
      industry: user.industry || null,
      userTier: user.userTier || 'member',
      entity_status: user.entity_status || null,
      visibilityStatus: user.visibilityStatus || 'public',
      socialMedia: user.socialMedia || {},
      createdAt: user.createdAt || null,
      updatedAt: user.updatedAt || null,
      lastLogin: user.lastLogin || null
    }
  };
}

/**
 * Format no seats available error with pinpoint diagnostics
 * @param {Object} errorData - Error data with diagnostics
 * @returns {Object} Formatted error response
 */
function formatNoSeatsAvailableResponse(errorData) {
  const { searchAttempts = [], preferences = {}, event_diagnostics = [] } = errorData;
  
  // Extract dates from multiple possible locations in preferences
  const startDate = preferences.dates?.startDate || preferences.start_date || preferences.startDate;
  const endDate = preferences.dates?.endDate || preferences.end_date || preferences.endDate;
  // Extract city from multiple possible locations (preferences.city, location_preferences array, etc.)
  const city = preferences.city || 
               (preferences.location_preferences && preferences.location_preferences[0]) ||
               null;
  const budget = preferences.budget?.max || preferences.budget_range?.max;
  const partySize = preferences.party_size;
  
  // Analyze diagnostics to determine primary reason
  let primaryReason = null;
  let specificMessage = errorData.message || 'We couldn\'t find any available seats/tables matching your preferences.';
  const suggestions = [];
  const eventDiagnosticsDetails = [];
  const secondaryReasons = []; // Initialize outside the if block
  
  if (event_diagnostics && event_diagnostics.length > 0) {
    // Count reasons across all events
    const reasonCounts = {};
    const reasonDetails = {};
    
    event_diagnostics.forEach(diag => {
      if (diag && diag.primary_reason) {
        reasonCounts[diag.primary_reason] = (reasonCounts[diag.primary_reason] || 0) + 1;
        if (!reasonDetails[diag.primary_reason]) {
          reasonDetails[diag.primary_reason] = [];
        }
        reasonDetails[diag.primary_reason].push(diag);
      }
      
      // Store event diagnostics for details
      eventDiagnosticsDetails.push({
        event_id: diag.event_id,
        event_name: diag.event_name,
        reason: diag.primary_reason,
        details: diag.details || {}
      });
    });
    
    // Determine most common reason
    const sortedReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
    primaryReason = sortedReasons.length > 0 ? sortedReasons[0][0] : null;
    
    // Build specific message based on primary reason
    if (primaryReason === 'CAPACITY_TOO_SMALL') {
      const capacityDetails = reasonDetails[primaryReason][0]?.details?.capacity_too_small;
      if (capacityDetails) {
        specificMessage = `We couldn't find any available seats/tables matching your preferences. The events${city ? ` in ${city}` : ''} don't have seats that accommodate ${capacityDetails.party_size} people. The largest available seat capacity is ${capacityDetails.max_capacity_found} people.`;
        suggestions.push(`Consider reducing party size to ${capacityDetails.max_capacity_found} or fewer`);
      }
    } else if (primaryReason === 'BUDGET_TOO_LOW') {
      const budgetDetails = reasonDetails[primaryReason][0]?.details?.budget_too_low;
      if (budgetDetails && budgetDetails.min_seat_price > 0) {
        const budgetFormatted = budget && budget !== Infinity ? `$${budget.toLocaleString()}` : 'your budget';
        const minPriceFormatted = `$${Math.ceil(budgetDetails.min_seat_price).toLocaleString()}`;
        specificMessage = `We couldn't find any available seats/tables matching your preferences. All available seats exceed ${budgetFormatted}. The minimum seat price is ${minPriceFormatted}.`;
        suggestions.push(`Consider increasing your budget to at least ${minPriceFormatted}`);
      }
    } else if (primaryReason === 'NO_AVAILABLE_SEATS') {
      specificMessage = `We couldn't find any available seats/tables matching your preferences. All seats for the selected events are currently booked or reserved.`;
      suggestions.push('Try a different date range');
      if (city) {
        suggestions.push(`Try a different city`);
      }
    } else if (primaryReason === 'EXCLUDED_BY_PREFERENCES') {
      const exclusionDetails = reasonDetails[primaryReason][0]?.details?.excluded_by_preferences;
      if (exclusionDetails && exclusionDetails.matching_keywords && exclusionDetails.matching_keywords.length > 0) {
        const keywords = exclusionDetails.matching_keywords.join(', ');
        specificMessage = `We couldn't find any available seats/tables matching your preferences. The available seats were excluded based on your preferences: ${keywords}.`;
        suggestions.push(`Consider removing exclusion: ${keywords}`);
      }
    } else if (primaryReason === 'ALL_EVENTS_EXCLUDED_BY_PREFERENCES') {
      // Location-level exclusion: all events were from excluded locations
      const exclusionDetails = reasonDetails[primaryReason][0]?.details;
      const exclusionType = reasonDetails[primaryReason][0]?.exclusion_type || 'general';
      
      if (exclusionDetails) {
        if (exclusionType === 'location' && exclusionDetails.excluded_locations && exclusionDetails.excluded_locations.length > 0) {
          // Location-level exclusion: "I don't like LIV club"
          const locationNames = exclusionDetails.excluded_locations.join(', ');
          specificMessage = `We couldn't find any available events for you. We found events only in ${locationNames}, which you stated you don't want.`;
          suggestions.push(`Consider removing the exclusion for ${locationNames}`);
        } else {
          // General exclusion (fallback)
          const exclusions = exclusionDetails.exclusions?.join(', ') || 'your preferences';
          specificMessage = `We couldn't find any available events matching your preferences. All available events were excluded based on: ${exclusions}.`;
          suggestions.push(`Consider adjusting your preferences`);
        }
        
        if (city) {
          suggestions.push(`Try a different city`);
        }
        suggestions.push('Try a different date range');
      }
    } else if (primaryReason === 'NO_SEATS_IN_EVENT') {
      specificMessage = `We couldn't find any available seats/tables matching your preferences. The selected events don't have any seats configured.`;
      suggestions.push('Try selecting different events');
    } else if (primaryReason === 'NO_EVENTS_IN_DATE_RANGE') {
      const cityStr = city ? ` in ${city}` : '';
      const startDateStr = startDate ? new Date(startDate).toLocaleDateString() : 'N/A';
      const endDateStr = endDate ? new Date(endDate).toLocaleDateString() : 'N/A';
      specificMessage = `We couldn't find any available events${cityStr} for the selected date range (${startDateStr} - ${endDateStr}).`;
      suggestions.push('Try a different date range');
      if (city) {
        suggestions.push('Try a different city');
      }
    }
    
    // Add secondary reasons as additional context
    event_diagnostics.forEach(diag => {
      if (diag.secondary_reasons && diag.secondary_reasons.length > 0) {
        secondaryReasons.push(...diag.secondary_reasons);
      }
    });
  }
  
  // Generate general suggestions if no specific ones
  if (suggestions.length === 0) {
    suggestions.push('Try a different date range');
    if (budget && budget !== Infinity) {
      suggestions.push('Consider increasing your budget');
    }
    if (city) {
      suggestions.push('Try a different city');
    }
    if (partySize && partySize > 2) {
      suggestions.push('Consider reducing party size');
    }
  }
  
  return {
    type: 'error',
    error_type: 'NO_SEATS_AVAILABLE',
    message: specificMessage,
    specific_reason: primaryReason,
    details: {
      searched_dates: startDate && endDate ? {
        start: new Date(startDate).toISOString().split('T')[0],
        end: new Date(endDate).toISOString().split('T')[0]
      } : null,
      searched_city: city || null,
      budget_range: budget && budget !== Infinity ? { min: 0, max: budget } : null,
      party_size: partySize || null,
      primary_reason: primaryReason,
      secondary_reasons: [...new Set(secondaryReasons)],
      event_diagnostics: eventDiagnosticsDetails,
      attempts: searchAttempts.map(attempt => ({
        strategy: attempt.strategy,
        events_tried: attempt.events_tried || 0,
        locations_tried: attempt.locations_tried || [],
        events_with_seats: attempt.events_with_seats || 0,
        reason: attempt.reason || 'No available seats matching criteria',
        date_adjustment: attempt.date_adjustment || null,
        budget_adjustment: attempt.budget_adjustment || null
      })),
      suggestions
    }
  };
}

/**
 * Format client list response
 * @param {Array} clients - Array of client objects
 * @param {Object} pagination - Pagination info { page, limit, total, totalPages }
 * @param {string} message - Human-readable message
 * @returns {Object} Structured response
 */
function formatClientListResponse(clients, pagination, message) {
  return {
    type: 'client_list',
    message: message || 'Client list retrieved successfully.',
    clients: clients,
    pagination: pagination || {
      page: 1,
      limit: 20,
      total: clients.length,
      totalPages: 1
    }
  };
}

/**
 * Format seat upgrade offers response
 * @param {Object} coe - COE object
 * @param {Array} offers - Upgrade offers array
 * @param {string} message - Optional message
 * @returns {Object} Structured response
 */
function formatSeatUpgradeOffersResponse(coe, offers, message) {
  return {
    type: 'seat_upgrade_offers',
    coe_id: coe._id?.toString() || coe.id,
    message: message || 'We found some premium seating options that might interest you!',
    offers: offers.map(offer => ({
      current_seat: {
        seat_id: offer.current_seat_id?.toString() || offer.current_seat_id,
        seat_code: offer.current_seat_code,
        event_id: offer.event_id?.toString() || offer.event_id,
        event_name: offer.event_name,
        current_price: offer.current_price
      },
      alternatives: offer.alternatives.map(alt => ({
        seat_id: alt.seat_id?.toString() || alt.seat_id,
        seat_code: alt.seat_code,
        capacity: alt.capacity,
        price: alt.event_price,
        base_price: alt.base_price,
        price_delta: alt.price_delta,
        price_delta_percentage: alt.price_delta_percentage,
        upgrade_reasons: alt.upgrade_reasons,
        sentiment: alt.sentiment,
        category: alt.category,
        section: alt.section,
        media: alt.media
      }))
    }))
  };
}

function isStructuredResponse(response) {
  if (!response || typeof response !== 'object') return false;
  return response.type && ['coe_created', 'coe_updated', 'coe_details', 'coe_draft', 'coe_list', 'event_list', 'location_list', 'coe_preferences_form', 'error', 'user_profile', 'client_list', 'seat_upgrade_offers'].includes(response.type);
}

module.exports = {
  formatCOEResponse,
  formatEventListResponse,
  formatCOEListResponse,
  formatLocationListResponse,
  formatCOEPreferencesFormResponse,
  formatNoSeatsAvailableResponse,
  formatProfileResponse,
  formatClientListResponse,
  formatSeatUpgradeOffersResponse,
  createCOEActions,
  formatTextResponse,
  isStructuredResponse
};


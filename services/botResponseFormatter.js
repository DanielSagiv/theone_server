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
function formatCOEResponse(type, coe, message, actions = [], budget = null) {
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
      events: (coe.events || []).map(event => {
        const runner_assignment = buildEventRunnerAssignment(event, coe);
        // Prioritize populated event_id.start_datetime (actual event date from DB)
        // Fall back to event.event_date (stored in COE) if event_id not populated
        const eventDate = event.event_id?.start_datetime || event.event_date || null;
        return {
          event_id: event.event_id?._id?.toString() || event.event_id?.toString() || event.event_id,
          event_name: event.event_id?.name || 'Unknown Event',
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
          ...(runner_assignment ? { runner_assignment } : {})
        };
      }),
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
      updated_at: coe.updated_at
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
        country: event.location?.country || event.location_id?.address?.country
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
function formatCOEListResponse(coes, message) {
  return {
    type: 'coe_list',
    coes: coes.map(coe => {
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
        events: (coe.events || []).map(event => {
          const runner_assignment = buildEventRunnerAssignment(event, coe);
          return {
            event_id: event.event_id?._id?.toString() || event.event_id?.toString() || event.event_id,
            event_name: event.event_id?.name || 'Unknown Event',
            event_date: event.event_date,
            event_time: event.event_time,
            media: event.event_id?.media || [],
            location: event.event_id?.location_id ? {
              id: event.event_id.location_id._id?.toString() || event.event_id.location_id?.toString(),
              name: event.event_id.location_id.name,
              type: event.event_id.location_id.type,
              media: event.event_id.location_id.media || []
            } : null,
            ...(runner_assignment ? { runner_assignment } : {})
          };
        }),
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
    }),
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

  // Delete - available for draft/approved COEs
  if (userRole === 'admin' || (userRole === 'client' && ['draft', 'approved'].includes(status))) {
    actions.push({
      label: 'Delete',
      action: 'delete_coe',
      coe_id: coeId,
      type: 'button',
      confirm: true
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
function formatNoSeatsAvailableResponse(errorData) {
  const { searchAttempts = [], preferences = {} } = errorData;
  
  const startDate = preferences.start_date || preferences.startDate;
  const endDate = preferences.end_date || preferences.endDate;
  const city = preferences.city;
  const budget = preferences.budget?.max || preferences.budget_range?.max;
  const partySize = preferences.party_size;
  
  // Generate suggestions based on search attempts
  const suggestions = [];
  
  // Always suggest trying a different date range (most common solution)
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
  
  return {
    type: 'error',
    error_type: 'NO_SEATS_AVAILABLE',
    message: errorData.message || 'We couldn\'t find any available seats/tables matching your preferences.',
    details: {
      searched_dates: startDate && endDate ? {
        start: new Date(startDate).toISOString().split('T')[0],
        end: new Date(endDate).toISOString().split('T')[0]
      } : null,
      searched_city: city || null,
      budget_range: budget && budget !== Infinity ? { min: 0, max: budget } : null,
      party_size: partySize || null,
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

function isStructuredResponse(response) {
  if (!response || typeof response !== 'object') return false;
  return response.type && ['coe_created', 'coe_updated', 'coe_details', 'coe_draft', 'coe_list', 'event_list', 'location_list', 'coe_preferences_form', 'error'].includes(response.type);
}

module.exports = {
  formatCOEResponse,
  formatEventListResponse,
  formatCOEListResponse,
  formatLocationListResponse,
  formatCOEPreferencesFormResponse,
  formatNoSeatsAvailableResponse,
  createCOEActions,
  formatTextResponse,
  isStructuredResponse
};


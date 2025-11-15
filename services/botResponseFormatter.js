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
 * Create a structured COE response
 * @param {string} type - Response type: 'coe_created', 'coe_updated', 'coe_details', 'coe_list'
 * @param {Object} coe - COE object
 * @param {string} message - Human-readable message
 * @param {Array} actions - Available actions for this COE
 * @returns {Object} Structured response
 */
function formatCOEResponse(type, coe, message, actions = []) {
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
    if (event?.event_id?.seats) {
      const seatId = normalizeId(seat.seat_id);
      const eventSeat = event.event_id.seats.find(s => {
        const sId = normalizeId(s._id);
        return sId === seatId;
      });
      if (eventSeat?.media) {
        seatMedia = eventSeat.media;
      }
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
        currency: coe.currency || 'USD'
      },
      events: coe.events || [],
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
          phone: coe.runner_assignment.runner_id.phone
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
        if (event?.event_id?.seats) {
          const seatId = normalizeId(seat.seat_id);
          const eventSeat = event.event_id.seats.find(s => {
            const sId = normalizeId(s._id);
            return sId === seatId;
          });
          if (eventSeat?.media) {
            seatMedia = eventSeat.media;
          }
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
        selected_seats: enhancedSeats, // Enhanced seats with media
        runner_assignment: coe.runner_assignment ? {
          type: coe.runner_assignment.type,
          runner: coe.runner_assignment.runner_id ? {
            id: coe.runner_assignment.runner_id._id?.toString() || coe.runner_assignment.runner_id.toString(),
            name: coe.runner_assignment.runner_id.firstName && coe.runner_assignment.runner_id.lastName
              ? `${coe.runner_assignment.runner_id.firstName} ${coe.runner_assignment.runner_id.lastName}`
              : coe.runner_assignment.runner_id.email || 'Unknown',
            email: coe.runner_assignment.runner_id.email,
            phone: coe.runner_assignment.runner_id.phone
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
 * Check if a response is structured
 * @param {Object} response - Response object
 * @returns {boolean} True if structured
 */
function isStructuredResponse(response) {
  if (!response || typeof response !== 'object') return false;
  return response.type && ['coe_created', 'coe_updated', 'coe_details', 'coe_list', 'event_list', 'location_list'].includes(response.type);
}

module.exports = {
  formatCOEResponse,
  formatEventListResponse,
  formatCOEListResponse,
  formatLocationListResponse,
  createCOEActions,
  formatTextResponse,
  isStructuredResponse
};


/**
 * Bot Response Formatter
 * @description Utility functions for formatting structured bot responses
 * 
 * Structured responses enable the frontend to render interactive UI components
 * instead of plain text, improving user experience and enabling direct actions.
 */

/**
 * Create a structured COE response
 * @param {string} type - Response type: 'coe_created', 'coe_updated', 'coe_details', 'coe_list'
 * @param {Object} coe - COE object
 * @param {string} message - Human-readable message
 * @param {Array} actions - Available actions for this COE
 * @returns {Object} Structured response
 */
function formatCOEResponse(type, coe, message, actions = []) {
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
      selected_seats: coe.selected_seats || [],
      events_count: coe.events?.length || 0,
      seats_count: coe.selected_seats?.length || 0,
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
    coes: coes.map(coe => ({
      id: coe.id || coe._id?.toString(),
      name: coe.name,
      status: coe.status,
      start_date: coe.start_date,
      end_date: coe.end_date,
      events_count: coe.events_count || coe.events?.length || 0,
      total_price: coe.total_price || coe.total || 0,
      currency: coe.currency || 'USD',
      created_at: coe.created_at
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
      media: location.media || []
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


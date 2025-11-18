/**
 * Bot Tool Handlers
 * @description Implements the actual logic for each bot tool
 * 
 * Each handler:
 * - Validates input parameters
 * - Checks user permissions
 * - Calls appropriate service functions
 * - Formats responses for the bot
 * - Handles errors gracefully
 */

const Event = require('../models/Event');
const Location = require('../models/Location');
const User = require('../models/User');
const BotConversation = require('../models/BotConversation');
const IdempotencyCache = require('../models/IdempotencyCache');
const coeService = require('./coeService');
const {
  formatCOEResponse,
  formatEventListResponse,
  formatCOEListResponse,
  formatLocationListResponse,
  createCOEActions,
  formatTextResponse
} = require('./botResponseFormatter');
const {
  ErrorCodes,
  ErrorCategories,
  createError,
  getErrorCategory
} = require('../utils/botUtils');
const { autoSelectEventsBySentiment } = require('./botSentimentService');
const { autoFillCOEData, selectSeatsByBudgetAndCapacity } = require('./botAutoFillService');
const { getPreferences } = require('./botPreferenceService');
const { parseAndNormalizeDate } = require('../utils/dateParser');

/**
 * Handler 1: Get Events by Date Range
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleGetEventsByDate(params, user, correlationId) {
  try {
    const {
      start_date,
      end_date,
      location,
      type,
      status = 'active',
      search
    } = params;

    console.log('[BOT] handleGetEventsByDate - Received parameters:', {
      start_date,
      end_date,
      location,
      type,
      status,
      search
    });

    // Validate dates
    let startDate = new Date(start_date);
    let endDate = new Date(end_date);
    const now = new Date();

    console.log('[BOT] handleGetEventsByDate - Parsed dates (before normalization):', {
      start_date_input: start_date,
      end_date_input: end_date,
      startDate_parsed: startDate.toISOString(),
      endDate_parsed: endDate.toISOString(),
      now: now.toISOString(),
      startDate_valid: !isNaN(startDate.getTime()),
      endDate_valid: !isNaN(endDate.getTime())
    });

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw createError(
        ErrorCodes.INVALID_DATE_FORMAT,
        'Invalid date format. Dates must be in ISO 8601 format.',
        ErrorCategories.VALIDATION,
        false
      );
    }

    // CRITICAL FIX: Normalize dates if they're in the past (OpenAI sometimes uses wrong year)
    // If dates are more than 1 year in the past, assume they meant relative to today
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    
    if (startDate < oneYearAgo) {
      console.log('[BOT] WARNING: Start date is in the past, normalizing to today');
      // Calculate the relative offset from the parsed date
      const daysOffset = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      // If it looks like "next 10 days" but date is old, use today as start
      const daysBetween = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0); // Start of today
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + daysBetween); // Preserve the range duration
      endDate.setHours(23, 59, 59, 999); // End of the end date
      
      console.log('[BOT] Normalized dates:', {
        original_start: start_date,
        original_end: end_date,
        normalized_start: startDate.toISOString(),
        normalized_end: endDate.toISOString(),
        days_range: daysBetween
      });
    }

    if (startDate > endDate) {
      throw createError(
        ErrorCodes.INVALID_DATE_RANGE,
        'Start date must be before or equal to end date.',
        ErrorCategories.VALIDATION,
        false
      );
    }

    // Build filter
    // Find events that overlap with the date range [startDate, endDate]
    // An event overlaps if: event.start_datetime <= endDate AND event.end_datetime >= startDate
    // Also exclude past events: event.end_datetime >= now (or doesn't exist)
    const filter = {
      status: status,
      start_datetime: { $lte: endDate }, // Event starts before or at end of query range
      $and: [
        {
          // Event overlaps with query range: end_datetime >= startDate
          $or: [
            { end_datetime: { $gte: startDate } },
            { end_datetime: { $exists: false } },
            { end_datetime: null }
          ]
        },
        {
          // Exclude past events: end_datetime >= now
          $or: [
            { end_datetime: { $gte: new Date() } },
            { end_datetime: { $exists: false } },
            { end_datetime: null }
          ]
        }
      ]
    };

    // Location filter (by name or city)
    if (location) {
      const locationDocs = await Location.find({
        $or: [
          { name: { $regex: location, $options: 'i' } },
          { 'address.city': { $regex: location, $options: 'i' } }
        ]
      }).select('_id');
      
      if (locationDocs.length > 0) {
        filter.location_id = { $in: locationDocs.map(loc => loc._id) };
      } else {
        // No matching locations found
        return {
          success: true,
          data: [],
          message: `No events found for location "${location}" in the specified date range.`
        };
      }
    }

    // Type filter
    if (type) {
      filter.type = type;
    }

    // Text search
    if (search) {
      filter.$text = { $search: search };
    }

    // Log the filter for debugging
    console.log('[BOT] handleGetEventsByDate - Filter:', JSON.stringify(filter, null, 2));
    console.log('[BOT] handleGetEventsByDate - Date range:', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      now: new Date().toISOString()
    });

    // Query events
    const events = await Event.find(filter)
      .populate('location_id', 'name type address geo media sentiment')
      .select('name description type start_datetime end_datetime base_price currency status media seats sentiment')
      .sort({ start_datetime: 1 })
      .limit(100); // Limit to prevent huge responses

    console.log('[BOT] handleGetEventsByDate - Query result:', {
      eventsFound: events.length,
      eventDates: events.map(e => ({
        name: e.name, 
        start: e.start_datetime?.toISOString(),
        end: e.end_datetime?.toISOString()
      }))
    });

    // Format response
    const formattedEvents = events.map(event => ({
      id: event._id.toString(),
      name: event.name,
      description: event.description,
      type: event.type,
      start_datetime: event.start_datetime,
      end_datetime: event.end_datetime,
      base_price: event.base_price,
      currency: event.currency || 'USD',
      status: event.status,
      location: event.location_id ? {
        id: event.location_id._id.toString(),
        name: event.location_id.name,
        type: event.location_id.type,
        address: event.location_id.address || null, // Full address object
        geo: event.location_id.geo || null, // Geo coordinates { type: 'Point', coordinates: [longitude, latitude] }
        city: event.location_id.address?.city,
        country: event.location_id.address?.country,
        media: event.location_id.media || []
      } : null,
      location_id: event.location_id?._id?.toString() || null,
      sentiment: {
        location: event.location_id?.sentiment || null,
        event: event.sentiment || null
      },
      media: event.media || [],
      seats: event.seats?.map(seat => ({
        id: seat._id.toString(),
        code: seat.code,
        label: seat.label,
        category: seat.category,
        section: seat.section,
        capacity: seat.capacity,
        event_price: seat.event_price,
        status: seat.status
      })) || [],
      available_seats_count: event.seats?.filter(s => s.status === 'available').length || 0
    }));

    // Return structured response
    const structuredResponse = formatEventListResponse(
      formattedEvents,
      `Found ${formattedEvents.length} event${formattedEvents.length !== 1 ? 's' : ''} in the specified date range.`
    );

    return {
      success: true,
      data: structuredResponse,
      count: formattedEvents.length
    };
  } catch (error) {
    console.error('Error in handleGetEventsByDate:', error);
    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        error.message || 'Failed to query events',
        getErrorCategory(error.code || ErrorCodes.SERVICE_UNAVAILABLE),
        false
      )
    };
  }
}

/**
 * Handler 2: Create COE Draft
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleCreateCOEDraft(params, user, correlationId) {
  try {
    const {
      name,
      description = '',
      start_date,
      end_date,
      idempotency_key,
      events = [],
      client_id,
      preferences = {}
    } = params;

    // Check idempotency cache if key provided
    if (idempotency_key) {
      const cachedResult = await IdempotencyCache.getCachedResult(
        idempotency_key,
        user._id.toString(),
        'create_coe_draft'
      );
      
      if (cachedResult) {
        return {
          success: true,
          data: cachedResult.data,
          message: cachedResult.message || 'COE already created (idempotent response)',
          idempotent: true
        };
      }
    }

    // Validate dates
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw createError(
        ErrorCodes.INVALID_DATE_FORMAT,
        'Invalid date format. Dates must be in ISO 8601 format.',
        ErrorCategories.VALIDATION,
        false
      );
    }

    if (startDate > endDate) {
      throw createError(
        ErrorCodes.INVALID_DATE_RANGE,
        'Start date must be before or equal to end date.',
        ErrorCategories.VALIDATION,
        false
      );
    }

    // Determine client_id based on user role
    let targetClientId = client_id;
    if (user.role === 'client') {
      // Clients can only create COEs for themselves
      targetClientId = user._id.toString();
    } else if (user.role === 'admin') {
      // Admins must provide client_id
      if (!targetClientId) {
        throw createError(
          ErrorCodes.MISSING_REQUIRED_FIELD,
          'Admin must provide client_id when creating a COE.',
          ErrorCategories.VALIDATION,
          false,
          { client_id: 'Required for admin users' }
        );
      }
    } else {
      throw createError(
        ErrorCodes.PERMISSION_DENIED,
        'Only clients and admins can create COEs.',
        ErrorCategories.PERMISSION,
        false
      );
    }

    // Get client to generate COE name
    const client = await User.findById(targetClientId);
    if (!client) {
      throw createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Client not found.',
        ErrorCategories.SERVICE,
        false
      );
    }

    // Auto-generate COE name and description if not provided
    const { formatDateRange } = require('../utils/dateParser');
    const dateStr = formatDateRange(startDate, endDate || startDate);
    
    // Get client full name
    const clientFullName = client.firstName && client.lastName 
      ? `${client.firstName} ${client.lastName}`
      : client.firstName || client.email || 'Client';
    
    // Generate description: "<client full name> experience, <start date> to <end date>"
    let coeDescription = description;
    if (!coeDescription || coeDescription.trim() === '') {
      coeDescription = `${clientFullName} experience, ${dateStr}`;
    }
    
    // Auto-generate COE name (same as description for now)
    let coeName = name;
    if (!coeName) {
      coeName = coeDescription; // Use same as description
    }

    // Get preferences from conversation context
    let conversationPreferences = preferences;
    try {
      const conversation = await BotConversation.findOne({ user_id: user._id });
      if (conversation && conversation.preference_data) {
        conversationPreferences = {
          ...conversation.preference_data,
          ...preferences // Tool params override conversation preferences
        };
      }
    } catch (error) {
      console.error('Error fetching conversation preferences:', error);
      // Continue with provided preferences
    }

    // If events not provided, use sentiment-based auto-selection
    let finalEvents = events;
    if (!finalEvents || finalEvents.length === 0) {
      // Query events in date range
      const availableEvents = await Event.find({
        status: 'active',
        start_datetime: { $gte: startDate, $lte: endDate },
        end_datetime: { $gte: new Date() }
      })
      .populate('location_id', 'name sentiment attributes')
      .limit(50);

      if (availableEvents.length > 0) {
        // Auto-select events using sentiment matching
        const selectedEvents = await autoSelectEventsBySentiment(
          availableEvents,
          conversationPreferences,
          5 // Max 5 events
        );
        
        // Phase 2.5: Preserve sentiment match data for display
        // Note: Don't pre-select seats here - let budget-aware selection handle it to ensure seats exist in DB
        finalEvents = selectedEvents.map(item => {
          // Ensure event_id is properly extracted - normalize to ObjectId or string
          const eventId = item.event_id || 
                          (item.event && (item.event._id || item.event.id)) || 
                          null;
          
          if (!eventId) {
            console.error('[BOT] Warning: No event_id found for selected event item:', {
              hasEventId: !!item.event_id,
              hasEvent: !!item.event,
              eventIdType: typeof item.event_id,
              eventIdValue: item.event_id
            });
            return null; // Will be filtered out
          }
          
          return {
            event_id: eventId, // Keep as ObjectId or string as-is
            // Don't pre-select seats - let budget-aware selection handle it after fetching from DB
            selected_seats: [],
            // Phase 2.5: Store sentiment match data
            sentiment_match: item.sentimentScore !== undefined ? {
              score: item.sentimentScore,
              reasons: item.matchReasons || item.sentimentHighlights || [],
              highlights: item.sentimentHighlights || item.matchReasons || []
            } : null
          };
        }).filter(Boolean); // Remove null entries
      }
    }

    // Get admin_id (first available admin if created by client, or current user if created by admin)
    let adminId;
    if (user.role === 'client') {
      const admin = await User.findOne({ role: 'admin', isActive: true });
      if (!admin) {
        throw new Error('No active admin found to assign to COE.');
      }
      adminId = admin._id.toString();
    } else {
      adminId = user._id.toString();
    }

    // Build selected_seats array from events (with budget-aware selection if needed)
    const selectedSeats = [];
    for (const eventData of finalEvents) {
      // Validate event_id exists
      if (!eventData.event_id) {
        console.error('[BOT] Error: eventData missing event_id:', eventData);
        continue; // Skip events without event_id
      }
      
      const event = await Event.findById(eventData.event_id);
      if (!event) {
        console.error('[BOT] Error: Event not found for event_id:', eventData.event_id);
        continue; // Skip missing events
      }

      // Ensure event has _id (should always be true for found documents, but add safety check)
      const eventId = event._id || eventData.event_id;
      if (!eventId) {
        console.error('[BOT] Error: No valid event_id available for event:', event);
        continue; // Skip if no valid event_id
      }

      // If seats not provided, use budget-aware selection
      if (!eventData.selected_seats || eventData.selected_seats.length === 0) {
        const autoSeats = selectSeatsByBudgetAndCapacity(
          event,
          conversationPreferences,
          conversationPreferences.budget?.max
        );
        eventData.selected_seats = autoSeats;
      }

      if (eventData.selected_seats && eventData.selected_seats.length > 0) {
        for (const seatData of eventData.selected_seats) {
          // Validate seat_id exists
          if (!seatData.seat_id) {
            console.warn('[BOT] Warning: Seat data missing seat_id:', seatData);
            continue; // Skip invalid seat data
          }
          
          // Find seat in event - normalize both IDs for comparison
          const seatIdStr = seatData.seat_id.toString();
          const eventSeat = event.seats.find(s => {
            const sId = s._id ? s._id.toString() : null;
            return sId === seatIdStr;
          });
          
          if (!eventSeat) {
            console.warn('[BOT] Warning: Seat not found in event:', {
              seat_id: seatData.seat_id,
              seat_id_str: seatIdStr,
              event_id: eventId,
              available_seat_ids: event.seats.map(s => s._id?.toString()).filter(Boolean)
            });
            continue; // Skip missing seats
          }

          // Ensure eventId is valid before adding
          if (!eventId) {
            console.error('[BOT] Error: Cannot add seat - eventId is undefined');
            continue; // Skip if eventId is invalid
          }

          selectedSeats.push({
            event_id: eventId, // Use validated event_id (from event._id or fallback to eventData.event_id)
            seat_id: seatData.seat_id,
            seat_code: seatData.seat_code || eventSeat.code,
            capacity: seatData.capacity || eventSeat.capacity,
            base_price: eventSeat.min_spend || 0,
            event_price: eventSeat.event_price || eventSeat.min_spend || 0,
            available_from: event.start_datetime,
            available_until: event.end_datetime || event.start_datetime,
            status: 'selected'
          });
        }
      }
    }
    
    // Validate we have at least some seats selected
    if (selectedSeats.length === 0) {
      console.warn('[BOT] Warning: No valid seats selected for COE. This may cause issues.');
    }

    // Final validation: Ensure all seats have event_id
    const validatedSeats = selectedSeats.filter(seat => {
      if (!seat.event_id) {
        console.error('[BOT] Error: Seat missing event_id, removing from selection:', seat);
        return false;
      }
      return true;
    });

    if (validatedSeats.length === 0 && selectedSeats.length > 0) {
      throw new Error('All selected seats are missing event_id. Cannot create COE.');
    }

    // Build base COE data
    const baseCoeData = {
      name: coeName,
      description: coeDescription,
      start_date: startDate,
      end_date: endDate,
      client_id: targetClientId,
      admin_id: adminId,
      created_by: user._id.toString(),
      events: finalEvents.map(e => ({
        event_id: e.event_id,
        event_date: startDate,
        event_time: 'TBD',
        base_price: 0,
        quantity: 1,
        total_price: 0,
        sequence: finalEvents.indexOf(e) + 1,
        // Phase 2.5: Store sentiment match data in event item (will be preserved in COE)
        sentiment_match: e.sentiment_match || null
      })),
      selected_seats: validatedSeats, // Use validated seats
      participants: [],
      tags: [],
      sharable: false
    };

    // Apply advanced auto-fill (runner, policies, budget-aware pricing)
    const coeData = await autoFillCOEData(
      baseCoeData,
      conversationPreferences,
      finalEvents.map(e => ({ event_id: e.event_id }))
    );
    
    // Final check: Ensure autoFillCOEData didn't remove event_id from seats
    if (coeData.selected_seats && coeData.selected_seats.length > 0) {
      const seatsWithoutEventId = coeData.selected_seats.filter(s => !s.event_id);
      if (seatsWithoutEventId.length > 0) {
        console.error('[BOT] Error: autoFillCOEData returned seats without event_id. This should not happen with the fix. Removing invalid seats:', seatsWithoutEventId);
        // Remove seats without event_id (shouldn't happen with our fix, but defensive)
        coeData.selected_seats = coeData.selected_seats.filter(s => s.event_id);
        
        if (coeData.selected_seats.length === 0) {
          throw new Error('All seats lost event_id during autoFillCOEData. Cannot create COE.');
        }
      }
    }

    // Create COE
    const coe = await coeService.createCOE(coeData, user._id);

    // Get populated COE for response
    const populatedCOE = await coeService.getCOEById(coe._id);

    // Create actions
    const actions = createCOEActions(populatedCOE, user.role);

    // Format structured response with budget comparison (Phase 2.5)
    const budgetForComparison = conversationPreferences.budget || 
                                (conversationPreferences.budget_range ? { max: conversationPreferences.budget_range.max } : null);
    // Phase 2.5: Use 'coe_draft' type for draft COEs to enable enhanced display
    const responseType = populatedCOE.status === 'draft' ? 'coe_draft' : 'coe_created';
    const structuredResponse = formatCOEResponse(
      responseType,
      populatedCOE,
      populatedCOE.status === 'draft' 
        ? 'Your experience draft has been created! Review the selected events and details below.'
        : 'COE created successfully in draft status. It requires approval before it can be accepted.',
      actions,
      budgetForComparison
    );

    const result = {
      success: true,
      data: structuredResponse,
      message: structuredResponse.message
    };

    // Cache result for idempotency if key provided
    if (idempotency_key) {
      try {
        await IdempotencyCache.cacheResult(
          idempotency_key,
          user._id.toString(),
          'create_coe_draft',
          result
        );
      } catch (cacheError) {
        console.error('Error caching idempotency result:', cacheError);
        // Don't fail the request if caching fails
      }
    }

    return result;
  } catch (error) {
    console.error('Error in handleCreateCOEDraft:', error);
    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        error.message || 'Failed to create COE',
        getErrorCategory(error.code || ErrorCodes.SERVICE_UNAVAILABLE),
        false
      )
    };
  }
}

/**
 * Handler 3: Update COE
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleUpdateCOE(params, user, correlationId) {
  try {
    let { coe_id, updates, idempotency_key } = params;

    // Handle active COE reference ("the COE we just created")
    if (!coe_id) {
      try {
        const conversation = await BotConversation.findOne({ user_id: user._id });
        if (conversation && conversation.active_coe_id) {
          coe_id = conversation.active_coe_id.toString();
        } else {
          throw createError(
            ErrorCodes.MISSING_REQUIRED_FIELD,
            'COE ID is required. Please specify which COE to update, or create a COE first.',
            ErrorCategories.VALIDATION,
            false,
            { coe_id: 'Required' }
          );
        }
      } catch (error) {
        if (error.code) throw error;
        throw createError(
          ErrorCodes.MISSING_REQUIRED_FIELD,
          'COE ID is required.',
          ErrorCategories.VALIDATION,
          false,
          { coe_id: 'Required' }
        );
      }
    }

    // Check idempotency cache if key provided
    if (idempotency_key) {
      const cachedResult = await IdempotencyCache.getCachedResult(
        idempotency_key,
        user._id.toString(),
        'update_coe'
      );
      
      if (cachedResult) {
        return {
          success: true,
          data: cachedResult.data,
          message: cachedResult.message || 'COE already updated (idempotent response)',
          idempotent: true
        };
      }
    }

    // Get existing COE
    const existingCOE = await coeService.getCOEById(coe_id);
    if (!existingCOE) {
      throw createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'COE not found.',
        ErrorCategories.SERVICE,
        false
      );
    }

    // Permission check
    if (user.role === 'client') {
      // Clients can only edit their own COEs
      if (existingCOE.client_id.toString() !== user._id.toString()) {
        throw createError(
          ErrorCodes.PERMISSION_DENIED,
          'You can only edit your own COEs.',
          ErrorCategories.PERMISSION,
          false
        );
      }
      // Clients can only edit draft or approved COEs
      if (!['draft', 'approved'].includes(existingCOE.status)) {
        throw createError(
          ErrorCodes.PERMISSION_DENIED,
          `Cannot edit COE with status "${existingCOE.status}".`,
          ErrorCategories.PERMISSION,
          false
        );
      }
    }
    // Admins can edit any COE

    // Prepare update data
    const updateData = {};
    if (updates.name) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.start_date) updateData.start_date = new Date(updates.start_date);
    if (updates.end_date) updateData.end_date = new Date(updates.end_date);
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.client_notes !== undefined) updateData.client_notes = updates.client_notes;
    if (updates.events) updateData.events = updates.events;
    if (updates.selected_seats) updateData.selected_seats = updates.selected_seats;

    // Update COE
    const updatedCOE = await coeService.updateCOE(coe_id, updateData);

    // Get populated COE for response
    const populatedCOE = await coeService.getCOEById(updatedCOE._id);

    // Create actions
    const actions = createCOEActions(populatedCOE, user.role);

    // Format structured response
    const structuredResponse = formatCOEResponse(
      'coe_updated',
      populatedCOE,
      'COE updated successfully.',
      actions
    );

    const result = {
      success: true,
      data: structuredResponse,
      message: structuredResponse.message
    };

    // Cache result for idempotency if key provided
    if (idempotency_key) {
      try {
        await IdempotencyCache.cacheResult(
          idempotency_key,
          user._id.toString(),
          'update_coe',
          result
        );
      } catch (cacheError) {
        console.error('Error caching idempotency result:', cacheError);
        // Don't fail the request if caching fails
      }
    }

    return result;
  } catch (error) {
    console.error('Error in handleUpdateCOE:', error);
    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        error.message || 'Failed to update COE',
        getErrorCategory(error.code || ErrorCodes.SERVICE_UNAVAILABLE),
        false
      )
    };
  }
}

/**
 * Handler 4: Get My COEs
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleGetMyCOEs(params, user, correlationId) {
  try {
    const { status, limit = 50, offset = 0 } = params;

    // Build filters based on user role
    const filters = {};
    if (status) filters.status = status;

    if (user.role === 'client') {
      filters.client_id = user._id.toString();
    } else if (user.role === 'runner') {
      filters.runner_id = user._id.toString();
    }
    // Admins can see all COEs (no filter)

    // Get COEs
    const result = await coeService.getCOEs(filters, {
      page: Math.floor(offset / limit) + 1,
      limit: Math.min(limit, 100), // Cap at 100
      sortBy: 'created_at',
      sortOrder: 'desc'
    });

    // Fetch full COE data with populated references (seats, runner, events)
    const fullCOEs = await Promise.all(
      result.coes.map(coe => coeService.getCOEById(coe._id))
    );

    // Format response with full data
    const formattedCOEs = fullCOEs.map(coe => ({
      id: coe._id.toString(),
      name: coe.name,
      status: coe.status,
      start_date: coe.start_date,
      end_date: coe.end_date,
      events_count: coe.events?.length || 0,
      seats_count: coe.selected_seats?.length || 0,
      total_price: coe.total,
      currency: coe.currency || 'USD',
      created_at: coe.created_at,
      selected_seats: coe.selected_seats || [],
      runner_assignment: coe.runner_assignment || null,
      events: coe.events || [],
      pricing: {
        subtotal: coe.subtotal || 0,
        taxes: coe.taxes || 0,
        fees: coe.fees || 0,
        total: coe.total || 0,
        deposit_required: coe.deposit_required || 0,
        currency: coe.currency || 'USD'
      }
    }));

    // Return structured response
    const structuredResponse = formatCOEListResponse(
      formattedCOEs,
      `Found ${formattedCOEs.length} COE${formattedCOEs.length !== 1 ? 's' : ''}.`
    );

    return {
      success: true,
      data: structuredResponse,
      count: formattedCOEs.length,
      total: result.pagination.total
    };
  } catch (error) {
    console.error('Error in handleGetMyCOEs:', error);
    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        error.message || 'Failed to query COEs',
        getErrorCategory(error.code || ErrorCodes.SERVICE_UNAVAILABLE),
        false
      )
    };
  }
}

/**
 * Handler 5: Get COE Details
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleGetCOEDetails(params, user, correlationId) {
  try {
    const { coe_id } = params;

    // Get COE
    const coe = await coeService.getCOEById(coe_id);
    if (!coe) {
      throw createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'COE not found.',
        ErrorCategories.SERVICE,
        false
      );
    }

    // Permission check
    if (user.role === 'client') {
      if (coe.client_id.toString() !== user._id.toString()) {
        throw createError(
          ErrorCodes.PERMISSION_DENIED,
          'You can only view your own COEs.',
          ErrorCategories.PERMISSION,
          false
        );
      }
    } else if (user.role === 'runner') {
      const isAssigned = coe.runner_assignment?.runner_id?.toString() === user._id.toString() ||
                        coe.events?.some(e => e.runner_assignment?.runner_id?.toString() === user._id.toString());
      if (!isAssigned) {
        throw createError(
          ErrorCodes.PERMISSION_DENIED,
          'You can only view COEs assigned to you.',
          ErrorCategories.PERMISSION,
          false
        );
      }
    }
    // Admins can view any COE

    // Create actions
    const actions = createCOEActions(coe, user.role);

    // Format structured response
    const structuredResponse = formatCOEResponse(
      'coe_details',
      coe,
      `COE details for "${coe.name}".`,
      actions
    );

    return {
      success: true,
      data: structuredResponse
    };
  } catch (error) {
    console.error('Error in handleGetCOEDetails:', error);
    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        error.message || 'Failed to get COE details',
        getErrorCategory(error.code || ErrorCodes.SERVICE_UNAVAILABLE),
        false
      )
    };
  }
}

/**
 * Handler 6: Delete COE
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleDeleteCOE(params, user, correlationId) {
  try {
    const { coe_id } = params;

    // Get existing COE
    const existingCOE = await coeService.getCOEById(coe_id);
    if (!existingCOE) {
      throw createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'COE not found.',
        ErrorCategories.SERVICE,
        false
      );
    }

    // Permission check
    if (user.role === 'client') {
      // Clients can only delete their own COEs
      if (existingCOE.client_id.toString() !== user._id.toString()) {
        throw createError(
          ErrorCodes.PERMISSION_DENIED,
          'You can only delete your own COEs.',
          ErrorCategories.PERMISSION,
          false
        );
      }
      // Clients can only delete draft or approved COEs
      if (!['draft', 'approved'].includes(existingCOE.status)) {
        throw createError(
          ErrorCodes.PERMISSION_DENIED,
          `Cannot delete COE with status "${existingCOE.status}".`,
          ErrorCategories.PERMISSION,
          false
        );
      }
    }
    // Admins can delete any COE

    // Delete COE
    await coeService.deleteCOE(coe_id);

    return {
      success: true,
      message: 'COE deleted successfully.'
    };
  } catch (error) {
    console.error('Error in handleDeleteCOE:', error);
    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        error.message || 'Failed to delete COE',
        getErrorCategory(error.code || ErrorCodes.SERVICE_UNAVAILABLE),
        false
      )
    };
  }
}

/**
 * Helper: Format date range for COE name
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {string} Formatted date range
 */
function formatDateRange(startDate, endDate) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const startMonth = months[startDate.getMonth()];
  const startDay = startDate.getDate();
  const startYear = startDate.getFullYear();
  
  const endMonth = months[endDate.getMonth()];
  const endDay = endDate.getDate();
  const endYear = endDate.getFullYear();

  if (startMonth === endMonth && startYear === endYear) {
    return `${startMonth} ${startDay}-${endDay}, ${startYear}`;
  } else {
    return `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${startYear}`;
  }
}

/**
 * Handler 7: Get Locations
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleGetLocations(params, user, correlationId) {
  try {
    const {
      type,
      status = 'active',
      search,
      city,
      country,
      limit = 100
    } = params;

    console.log('[BOT] handleGetLocations - Received parameters:', {
      type,
      status,
      search,
      city,
      country,
      limit
    });

    // Build filter
    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    if (type) {
      filter.type = type;
    }
    
    if (city) {
      filter['address.city'] = { $regex: city, $options: 'i' };
    }
    
    if (country) {
      filter['address.country'] = { $regex: country, $options: 'i' };
    }
    
    if (search) {
      filter.$text = { $search: search };
    }

    // Query locations
    const locations = await Location.find(filter)
      .select('name type description address geo media status score tags seats')
      .sort({ name: 1 })
      .limit(limit);

    console.log('[BOT] handleGetLocations - Query result:', {
      locationsFound: locations.length
    });

    // Format response
    const formattedLocations = locations.map(location => ({
      id: location._id.toString(),
      name: location.name,
      type: location.type,
      description: location.description,
      address: location.address || null,
      geo: location.geo || null,
      status: location.status,
      score: location.score,
      tags: location.tags || [],
      media: location.media || [],
      seats: location.seats || []
    }));

    // Return structured response
    const structuredResponse = formatLocationListResponse(
      formattedLocations,
      `Found ${formattedLocations.length} location${formattedLocations.length !== 1 ? 's' : ''}.`
    );

    return {
      success: true,
      data: structuredResponse,
      count: formattedLocations.length
    };
  } catch (error) {
    console.error('Error in handleGetLocations:', error);
    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Failed to retrieve locations',
        ErrorCategories.SYSTEM,
        false
      )
    };
  }
}

/**
 * Tool handler map
 */
const toolHandlers = {
  handleGetEventsByDate,
  handleCreateCOEDraft,
  handleUpdateCOE,
  handleGetMyCOEs,
  handleGetCOEDetails,
  handleDeleteCOE,
  handleGetLocations
};

module.exports = {
  toolHandlers,
  handleGetEventsByDate,
  handleCreateCOEDraft,
  handleUpdateCOE,
  handleGetMyCOEs,
  handleGetCOEDetails,
  handleDeleteCOE,
  handleGetLocations
};


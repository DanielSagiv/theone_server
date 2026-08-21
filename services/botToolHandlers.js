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
const COE = require('../models/COE');
const User = require('../models/User');
const BotConversation = require('../models/BotConversation');
const IdempotencyCache = require('../models/IdempotencyCache');
const coeService = require('./coeService');
const {
  formatCOEResponse,
  formatEventListResponse,
  formatCOEListResponse,
  formatLocationListResponse,
  formatNoSeatsAvailableResponse,
  formatProfileResponse,
  formatClientListResponse,
  createCOEActions,
  formatTextResponse
} = require('./botResponseFormatter');
const { generateSeatRecommendations } = require('./seatRecommendationService');
const {
  ErrorCodes,
  ErrorCategories,
  createError,
  getErrorCategory
} = require('../utils/botUtils');
const { autoSelectEventsBySentiment, normalizeEventDate } = require('./botSentimentService');
const { findAlternativeEventsWithSeats, autoFillCOEData, selectSeatsByBudgetAndCapacity, calculateSeatCosts } = require('./botAutoFillService');
const { getPreferences } = require('./botPreferenceService');
const { parseAndNormalizeDate } = require('../utils/dateParser');
const { normalizeCoeDatePair, applyCoeCalendarDates } = require('../utils/calendarDateOnly');
const { generateSeatUpgradeOffers } = require('./seatUpgradeService');

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
 * Handler X: Open Create COE Form For Client (Admin only)
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleOpenCreateCOEForClient(params, user, correlationId) {
  try {
    const { client_id } = params;

    console.log('[BOT] handleOpenCreateCOEForClient - Received parameters:', {
      client_id,
      userRole: user.role,
      correlationId
    });

    // Only admins can open this form
    if (user.role !== 'admin') {
      throw createError(
        ErrorCodes.PERMISSION_DENIED,
        'Only admins can create COEs for clients.',
        ErrorCategories.PERMISSION,
        false
      );
    }

    // Validate client_id format
    if (!client_id || !client_id.match(/^[0-9a-fA-F]{24}$/)) {
      throw createError(
        ErrorCodes.MISSING_REQUIRED_FIELD,
        'A valid client_id is required to create a COE for a client.',
        ErrorCategories.VALIDATION,
        false,
        { client_id: 'Must be a 24-character hex string' }
      );
    }

    const client = await User.findById(client_id).select('firstName lastName email phone avatarUrl');
    if (!client) {
      throw createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Client not found.',
        ErrorCategories.SERVICE,
        false
      );
    }

    const clientName = client.firstName && client.lastName
      ? `${client.firstName} ${client.lastName}`
      : client.firstName || client.email || 'Client';

    const response = {
      type: 'coe_create_form',
      client: {
        id: client._id.toString(),
        name: clientName,
        email: client.email || null,
        phone: client.phone || null,
        avatarUrl: client.avatarUrl || null
      },
      defaults: {
        currency: 'USD',
        start_date: null,
        end_date: null,
        notes: ''
      },
      message: `Create a new COE draft for ${clientName}.`
    };

    return {
      success: true,
      data: response,
      message: response.message
    };
  } catch (error) {
    console.error('Error in handleOpenCreateCOEForClient:', error);
    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        error.message || 'Failed to open Create COE form for client',
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
  console.log('[BOT] [COE_CREATION_FULL_DEBUG] ========== START handleCreateCOEDraft ==========');
  console.log('[BOT] [COE_CREATION_FULL_DEBUG] Entry point:', {
    correlationId: correlationId,
    userId: user._id?.toString(),
    userRole: user.role,
    userEmail: user.email,
    paramsKeys: Object.keys(params),
    paramsFull: JSON.stringify(params, null, 2)
  });
  
  try {
    const {
      name,
      description = '',
      start_date,
      end_date,
      idempotency_key,
      events = [],
      client_id,
      preferences = {},
      manual_event_selection = false,
      request_coe_id = null,
      admin_create_as_proposal = false,
      proposal_deposit_percent: proposalDepositPercent
    } = params;
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Params destructured:', {
      name: name,
      description: description,
      start_date: start_date,
      end_date: end_date,
      idempotency_key: idempotency_key,
      eventsCount: events?.length || 0,
      events: events,
      client_id: client_id,
      client_idType: typeof client_id,
      preferencesKeys: Object.keys(preferences),
      preferencesFull: JSON.stringify(preferences, null, 2),
      request_coe_id: request_coe_id
    });

    // Check feature flag for client COE creation
    const { isClientCOECreationEnabled } = require('../utils/featureFlags');
    if (user.role === 'client' && !isClientCOECreationEnabled()) {
      throw createError(
        ErrorCodes.PERMISSION_DENIED,
        'Client COE creation is currently disabled. Please contact an admin to create an experience for you.',
        ErrorCategories.PERMISSION,
        false
      );
    }

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
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Date parsing:', {
      start_date_raw: start_date,
      end_date_raw: end_date,
      start_dateType: typeof start_date,
      end_dateType: typeof end_date
    });
    
    let startDate;
    let endDate;
    try {
      ({ startDate, endDate } = normalizeCoeDatePair(start_date, end_date));
    } catch (dateErr) {
      throw createError(
        ErrorCodes.INVALID_DATE_FORMAT,
        dateErr.message || 'Invalid date format. Dates must be in ISO 8601 format.',
        ErrorCategories.VALIDATION,
        false
      );
    }
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Parsed dates:', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      startDateValid: !isNaN(startDate.getTime()),
      endDateValid: !isNaN(endDate.getTime()),
      dateComparison: startDate > endDate ? 'INVALID: start > end' : 'VALID'
    });

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
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Client ID determination:', {
      userRole: user.role,
      client_id_provided: client_id,
      client_idType: typeof client_id,
      userId: user._id?.toString()
    });
    
    let targetClientId = client_id;
    if (user.role === 'client') {
      // Clients can only create COEs for themselves
      targetClientId = user._id.toString();
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Client role - using user ID as targetClientId:', targetClientId);
    } else if (user.role === 'admin') {
      // Admins must provide client_id
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Admin role - checking client_id:', {
        hasClientId: !!targetClientId,
        targetClientId: targetClientId
      });
      
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
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Fetching client:', {
      targetClientId: targetClientId,
      targetClientIdType: typeof targetClientId
    });
    
    const client = await User.findById(targetClientId);
    if (!client) {
      console.error('[BOT] [COE_CREATION_FULL_DEBUG] Client not found:', {
        targetClientId: targetClientId,
        searchedWith: typeof targetClientId === 'string' ? targetClientId : String(targetClientId)
      });
      throw createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Client not found.',
        ErrorCategories.SERVICE,
        false
      );
    }
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Client found:', {
      clientId: client._id?.toString(),
      clientName: `${client.firstName || ''} ${client.lastName || ''}`.trim(),
      clientEmail: client.email,
      clientRole: client.role
    });

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
    console.log('[BOT] [COE_CREATION_DEBUG] Initial preferences from params:', {
      preferences: JSON.stringify(preferences, null, 2),
      budget_range: preferences.budget_range,
      budget_max: preferences.budget_range?.max,
      city: preferences.city,
      party_size: preferences.party_size
    });
    
    try {
      const conversation = await BotConversation.findOne({ user_id: user._id });
      if (conversation && conversation.preference_data) {
        console.log('[BOT] [COE_CREATION_DEBUG] Conversation preferences found:', {
          conversationId: conversation._id.toString(),
          conversationPreferences: JSON.stringify(conversation.preference_data, null, 2),
          conversationBudget: conversation.preference_data.budget_range,
          conversationBudgetMax: conversation.preference_data.budget_range?.max
        });
        
        conversationPreferences = {
          ...conversation.preference_data,
          ...preferences // Tool params override conversation preferences
        };
        
        console.log('[BOT] [COE_CREATION_DEBUG] Merged preferences (tool params override):', {
          mergedPreferences: JSON.stringify(conversationPreferences, null, 2),
          finalBudgetRange: conversationPreferences.budget_range,
          finalBudgetMax: conversationPreferences.budget_range?.max,
          finalBudgetMaxType: typeof conversationPreferences.budget_range?.max
        });
      } else {
        console.log('[BOT] [COE_CREATION_DEBUG] No conversation preferences found, using tool params only');
      }
    } catch (error) {
      console.error('[BOT] [COE_CREATION_DEBUG] Error fetching conversation preferences:', error);
      // Continue with provided preferences
    }

    // Prioritize city from form submission (preferences.city) over conversation preferences
    // This needs to be available for both event filtering and diagnostics
    // Check multiple possible locations for city: preferences.city, preferences.location_preferences[0], conversationPreferences.city
    const cityToUse = preferences.city || 
                      (preferences.location_preferences && preferences.location_preferences[0]) ||
                      conversationPreferences.city ||
                      (conversationPreferences.location_preferences && conversationPreferences.location_preferences[0]);
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] City determination:', {
      preferencesCity: preferences.city,
      preferencesLocationPrefs: preferences.location_preferences,
      conversationCity: conversationPreferences.city,
      conversationLocationPrefs: conversationPreferences.location_preferences,
      finalCityToUse: cityToUse
    });

    // If events not provided, use sentiment-based auto-selection
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Event selection check:', {
      eventsProvided: events?.length || 0,
      eventsProvidedArray: events,
      willAutoSelect: !events || events.length === 0,
      manualEventSelection: !!manual_event_selection
    });
    
    let finalEvents = events;
    if (!finalEvents || finalEvents.length === 0) {
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Starting auto-selection of events');
      // Build event filter using overlap logic (same as routes/events.js COE date range filtering)
      // Events that overlap with COE date range:
      // Event starts before COE ends AND Event ends after COE starts
      const now = new Date();
      const eventFilter = {
        status: 'active',
        $and: [
          { start_datetime: { $lt: endDate } },  // Event starts before COE ends
          {
            $or: [
              { end_datetime: { $gt: startDate } },  // Event ends after COE starts
              { end_datetime: { $exists: false } },     // Event has no end date
              { end_datetime: null }                    // Event end date is null
            ]
          },
          // Exclude past events when selecting for COE
          {
            $or: [
              { end_datetime: { $gte: now } },  // Event hasn't ended yet
              { end_datetime: { $exists: false } },  // Or has no end date
              { end_datetime: null }  // Or end date is null
            ]
          }
        ]
      };
      
      // If city is specified, first find locations in that city, then filter events by those location IDs
      if (cityToUse) {
        // Create city matching map for common abbreviations
        const cityMap = {
          'las vegas': ['lv', 'las vegas', 'vegas'],
          'new york': ['ny', 'new york', 'nyc'],
          'los angeles': ['la', 'los angeles'],
          'miami': ['miami', 'mia'],
          'chicago': ['chicago', 'chi']
        };
        
        const searchCity = cityToUse.toLowerCase().trim();
        const cityVariations = cityMap[searchCity] || [searchCity];
        
        // Build regex pattern that matches any variation
        const cityPattern = cityVariations.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const cityRegex = new RegExp(`^(${cityPattern})$`, 'i');
        
        const cityLocations = await Location.find({
          'address.city': cityRegex
        }).select('_id name address.city');
        
        const locationIds = cityLocations.map(loc => loc._id);
        console.log('[BOT] City filter applied:', {
          searchCity: cityToUse,
          cityFromForm: preferences.city || 'none',
          cityFromConversation: conversationPreferences.city || 'none',
          cityVariations: cityVariations,
          locationsFound: locationIds.length,
          locationNames: cityLocations.map(loc => ({ name: loc.name, city: loc.address?.city })),
          locationIds: locationIds
        });
        
        if (locationIds.length > 0) {
          eventFilter.location_id = { $in: locationIds };
        } else {
          // No locations in this city, so no events will match
          eventFilter.location_id = { $in: [] }; // Empty array = no matches
        }
      }
      
      console.log('[BOT] Querying events with overlap filter:', {
        status: eventFilter.status,
        coe_date_range: { from: startDate, to: endDate },
        overlap_logic: 'Event starts before COE ends AND Event ends after COE starts',
        exclude_past: true,
        city_filter: cityToUse || 'none',
        city_from_form: preferences.city || 'none',
        city_from_conversation: conversationPreferences.city || 'none',
        hasLocationFilter: !!eventFilter.location_id,
        filter: JSON.stringify(eventFilter, null, 2)
      });
      
      const availableEvents = await Event.find(eventFilter)
      .populate('location_id', 'name sentiment attributes address.city')
      .limit(50);

      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Events found in query:', {
        count: availableEvents.length,
        eventNames: availableEvents.map(e => e.name),
        eventDetails: availableEvents.map(e => ({
          id: e._id?.toString(),
          name: e.name,
          start: e.start_datetime,
          end: e.end_datetime,
          city: e.location_id?.address?.city,
          status: e.status,
          locationName: e.location_id?.name,
          locationId: e.location_id?._id?.toString(),
          seatsCount: e.seats?.length || 0
        })),
        filterUsed: JSON.stringify(eventFilter, null, 2)
      });

      if (availableEvents.length > 0) {
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Calling autoSelectEventsBySentiment:', {
          availableEventsCount: availableEvents.length,
          preferencesForSelection: JSON.stringify({
            city: cityToUse,
            budget: conversationPreferences.budget,
            budget_range: conversationPreferences.budget_range,
            party_size: conversationPreferences.party_size,
            seat_preferences: conversationPreferences.seat_preferences,
            specific_preferences: conversationPreferences.specific_preferences
          }, null, 2),
          maxEvents: 5
        });
        
        // Auto-select events using sentiment matching
        const selectedEvents = await autoSelectEventsBySentiment(
          availableEvents,
          conversationPreferences,
          5 // Max 5 events
        );
        
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Events selected by sentiment:', {
          selectedCount: selectedEvents.length,
          selectedEvents: selectedEvents.map(e => ({
            eventId: e.event_id || (e.event && (e.event._id || e.event.id)),
            eventName: (e.event && e.event.name) || e.name,
            sentimentScore: e.sentimentScore,
            matchReasons: e.matchReasons,
            structuredPreferences: e.structuredPreferences
          }))
        });
        
        // Safety check: Validate no date conflicts in final selection
        if (selectedEvents.length > 0) {
          const selectedDates = new Set();
          const eventsWithConflicts = [];
          
          for (const eventItem of selectedEvents) {
            const event = eventItem.event || eventItem;
            const eventDate = normalizeEventDate(event);
            
            if (eventDate) {
              if (selectedDates.has(eventDate)) {
                eventsWithConflicts.push({
                  event_id: eventItem.event_id || event._id || event.id,
                  event_name: event.name || 'Unknown',
                  date: eventDate
                });
              } else {
                selectedDates.add(eventDate);
              }
            }
          }
          
          if (eventsWithConflicts.length > 0) {
            console.error('[BOT] CRITICAL: Date conflicts detected in selected events! This should not happen.', {
              conflicts: eventsWithConflicts,
              selectedEventsCount: selectedEvents.length
            });
            // Remove conflicting events (keep first occurrence of each date)
            const uniqueEvents = [];
            const seenDates = new Set();
            
            for (const eventItem of selectedEvents) {
              const event = eventItem.event || eventItem;
              const eventDate = normalizeEventDate(event);
              
              if (!eventDate || !seenDates.has(eventDate)) {
                uniqueEvents.push(eventItem);
                if (eventDate) {
                  seenDates.add(eventDate);
                }
              }
            }
            
            console.log('[BOT] Removed', selectedEvents.length - uniqueEvents.length, 'conflicting events');
            selectedEvents.length = 0;
            selectedEvents.push(...uniqueEvents);
          }
        }
        
        // Check if all events were excluded due to location preferences
        // This happens when availableEvents.length > 0 but selectedEvents.length === 0
        // and exclusions were applied in autoSelectEventsBySentiment
        let allExcludedByLocation = null;
        if (availableEvents.length > 0 && selectedEvents.length === 0) {
          // Check if we have text preferences that might contain exclusions
          const hasTextPreferences = conversationPreferences.seat_preferences || 
                                     conversationPreferences.specific_preferences;
          
          if (hasTextPreferences) {
            // Re-extract structured preferences to get exclusions
            // This is needed because selectedEvents is empty, so we can't get structuredPrefs from it
            const { extractStructuredPreferences } = require('./botSentimentService');
            try {
              const structuredPrefs = await extractStructuredPreferences(
                conversationPreferences.seat_preferences || '',
                conversationPreferences.specific_preferences || ''
              );
              
              const exclusions = structuredPrefs?.exclusions || [];
              
              // Check if all available events were from excluded locations
              if (exclusions.length > 0) {
                const excludedLocations = availableEvents
                  .filter(event => {
                    const locationName = event.location_id?.name?.toLowerCase() || '';
                    return exclusions.some(ex => {
                      const exLower = ex.toLowerCase();
                      return locationName.includes(exLower) || exLower.includes(locationName);
                    });
                  })
                  .map(event => event.location_id?.name)
                  .filter(Boolean);
                
                // If ALL events were from excluded locations, it's a location-level exclusion
                if (excludedLocations.length === availableEvents.length && excludedLocations.length > 0) {
                  console.log('[BOT] All events excluded due to location preferences:', {
                    excluded_locations: excludedLocations,
                    exclusions: exclusions,
                    total_events: availableEvents.length
                  });
                  allExcludedByLocation = {
                    excluded_locations: [...new Set(excludedLocations)],
                    exclusions: exclusions,
                    total_events_found: availableEvents.length
                  };
                }
              }
            } catch (error) {
              console.error('[BOT] Error extracting structured preferences for exclusion check:', error);
              // Continue without exclusion info
            }
          }
        }
        
        // Phase 2.5: Preserve sentiment match data for display
        // Note: Don't pre-select seats here - let budget-aware selection handle it to ensure seats exist in DB
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Mapping selected events to finalEvents format');
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
            // Phase 2.5: Store sentiment match data (including structuredPreferences with exclusions)
            sentiment_match: item.sentimentScore !== undefined ? {
              score: item.sentimentScore,
              reasons: item.matchReasons || item.sentimentHighlights || [],
              highlights: item.sentimentHighlights || item.matchReasons || [],
              structuredPreferences: item.structuredPreferences || null
            } : null
          };
        }).filter(Boolean); // Remove null entries
        
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Final events after mapping:', {
          finalEventsCount: finalEvents.length,
          finalEvents: finalEvents.map(e => ({
            event_id: e.event_id?.toString(),
            selected_seats_count: e.selected_seats?.length || 0,
            hasSentimentMatch: !!e.sentiment_match
          }))
        });
        
        // Store location exclusion info for later diagnostic creation
        if (allExcludedByLocation) {
          finalEvents._locationExclusionInfo = allExcludedByLocation;
          console.log('[BOT] [COE_CREATION_FULL_DEBUG] Location exclusion info stored:', allExcludedByLocation);
        }
      } else {
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] No available events found - will create diagnostic');
      }
    } else {
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Using provided events, skipping auto-selection:', {
        eventsCount: finalEvents.length,
        events: finalEvents.map(e => ({
          event_id: e.event_id?.toString(),
          selected_seats_count: e.selected_seats?.length || 0
        }))
      });
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
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] ========== SEAT SELECTION PHASE ==========');
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Starting seat selection:', {
      finalEventsCount: finalEvents?.length || 0,
      hasEvents: !!finalEvents && finalEvents.length > 0
    });
    
    const selectedSeats = [];
    const eventDiagnostics = []; // Collect diagnostics from all events
    
    // If no events found at all, create a diagnostic for that
    if (!finalEvents || finalEvents.length === 0) {
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] No events - creating diagnostic');
      // Check if all events were excluded due to location preferences
      if (finalEvents && finalEvents._locationExclusionInfo) {
        const exclusionInfo = finalEvents._locationExclusionInfo;
        console.log('[BOT] All events excluded by location preferences - creating diagnostic');
        eventDiagnostics.push({
          event_id: null,
          event_name: null,
          primary_reason: 'ALL_EVENTS_EXCLUDED_BY_PREFERENCES',
          exclusion_type: 'location',
          details: {
            excluded_locations: exclusionInfo.excluded_locations,
            exclusions: exclusionInfo.exclusions,
            total_events_found: exclusionInfo.total_events_found
          }
        });
      } else {
        console.log('[BOT] No events found in date range/city - creating diagnostic');
        // Extract dates from multiple possible locations
        const diagnosticStartDate = conversationPreferences.dates?.startDate || 
                                     conversationPreferences.start_date || 
                                     startDate;
        const diagnosticEndDate = conversationPreferences.dates?.endDate || 
                                   conversationPreferences.end_date || 
                                   endDate;
        eventDiagnostics.push({
          event_id: null,
          event_name: null,
          primary_reason: 'NO_EVENTS_IN_DATE_RANGE',
          details: {
            searched_city: cityToUse || conversationPreferences.city || null,
            searched_dates: {
              start: diagnosticStartDate,
              end: diagnosticEndDate
            },
            party_size: conversationPreferences.party_size || null,
            budget: conversationPreferences.budget?.max || null
          }
        });
      }
    }
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Processing events for seat selection:', {
      eventsCount: finalEvents.length
    });

    // Batch-load all events once (replaces per-event findById in the loop below).
    const finalEventIds = (finalEvents || [])
      .map((e) => e?.event_id)
      .filter(Boolean);
    const eventsById = await coeService.loadEventsMapByIds(finalEventIds, {
      populate: { path: 'location_id', select: 'seats' },
    });
    
    for (const eventData of finalEvents) {
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Processing event:', {
        eventId: eventData.event_id?.toString(),
        hasSelectedSeats: !!eventData.selected_seats,
        selectedSeatsCount: eventData.selected_seats?.length || 0
      });
      
      // Validate event_id exists
      if (!eventData.event_id) {
        console.error('[BOT] [COE_CREATION_FULL_DEBUG] ERROR: eventData missing event_id:', {
          eventData: eventData,
          eventDataKeys: Object.keys(eventData)
        });
        continue; // Skip events without event_id
      }
      
      const eventIdKey =
        eventData.event_id?._id?.toString?.() ||
        eventData.event_id?.toString?.() ||
        String(eventData.event_id);
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Resolving event from batch map:', {
        eventId: eventIdKey,
        eventIdType: typeof eventData.event_id
      });
      
      const event = eventsById.get(eventIdKey);
        
      if (!event) {
        console.error('[BOT] [COE_CREATION_FULL_DEBUG] ERROR: Event not found in DB:', {
          searchedEventId: eventData.event_id,
          searchedEventIdType: typeof eventData.event_id,
          searchedEventIdString: String(eventData.event_id)
        });
        continue; // Skip missing events
      }
      
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Event fetched successfully:', {
        eventId: event._id?.toString(),
        eventName: event.name,
        eventStatus: event.status,
        seatsCount: event.seats?.length || 0,
        locationId: event.location_id?._id?.toString(),
        locationName: event.location_id?.name,
        locationSeatsCount: event.location_id?.seats?.length || 0
      });

      // Ensure event has _id (should always be true for found documents, but add safety check)
      const eventId = event._id || eventData.event_id;
      if (!eventId) {
        console.error('[BOT] Error: No valid event_id available for event:', event);
        continue; // Skip if no valid event_id
      }

      // If seats not provided, use budget-aware selection
      if (!eventData.selected_seats || eventData.selected_seats.length === 0) {
        // Pass structured preferences (including exclusions) to seat selection
        const preferencesWithStructured = {
          ...conversationPreferences,
          structuredPreferences: eventData.sentiment_match?.structuredPreferences || null
        };
        const eventParty =
          eventData.party_size != null &&
          Number.isFinite(Number(eventData.party_size)) &&
          Number(eventData.party_size) >= 1
            ? Math.floor(Number(eventData.party_size))
            : null;
        if (eventParty != null) {
          preferencesWithStructured.party_size = eventParty;
        }
        
        const budgetForSelection = conversationPreferences.budget?.max || 
                                  conversationPreferences.budget_range?.max || 
                                  null;
        
        console.log('[BOT] [COE_CREATION_DEBUG] Calling selectSeatsByBudgetAndCapacity for event:', {
          eventId: eventId.toString(),
          eventName: event.name,
          budgetForSelection: budgetForSelection,
          budgetType: typeof budgetForSelection,
          budgetFromPreferences: conversationPreferences.budget?.max,
          budgetFromRange: conversationPreferences.budget_range?.max,
          preferencesWithStructured: JSON.stringify({
            budget: preferencesWithStructured.budget,
            budget_range: preferencesWithStructured.budget_range,
            party_size: preferencesWithStructured.party_size
          }, null, 2)
        });
        
        const preferredCategory = eventData.preferred_seat_category || null;
        // #region agent log
        try {
          fetch('http://127.0.0.1:7243/ingest/48279e3e-9368-4b19-b1f9-b96a74363f47',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f9384'},body:JSON.stringify({sessionId:'5f9384',location:'botToolHandlers.js:beforeSelectSeats',message:'Before selectSeatsByBudgetAndCapacity',data:{eventId:eventId?.toString(),eventName:event?.name,eventSeatsCount:event?.seats?.length||0,preferredCategory,budgetForSelection,party_size:preferencesWithStructured?.party_size},timestamp:Date.now(),hypothesisId:'H1,H2,H3'})}).catch(()=>{});
        } catch (_) {}
        // #endregion
        const seatResult = await selectSeatsByBudgetAndCapacity(
          event,
          preferencesWithStructured,
          budgetForSelection,
          preferredCategory
        );
        // #region agent log
        try {
          const resSeats = Array.isArray(seatResult) ? seatResult : (seatResult?.seats || []);
          const resDiag = Array.isArray(seatResult) ? null : (seatResult?.diagnostics || null);
          fetch('http://127.0.0.1:7243/ingest/48279e3e-9368-4b19-b1f9-b96a74363f47',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f9384'},body:JSON.stringify({sessionId:'5f9384',location:'botToolHandlers.js:afterSelectSeats',message:'After selectSeatsByBudgetAndCapacity',data:{eventId:eventId?.toString(),seatsCount:resSeats.length,primary_reason:resDiag?.primary_reason,filtering_stages:resDiag?.filtering_stages},timestamp:Date.now(),hypothesisId:'H1,H2,H3,H4,H5'})}).catch(()=>{});
        } catch (_) {}
        // #endregion
        console.log('[BOT] [COE_CREATION_DEBUG] Seat selection result:', {
          eventId: eventId.toString(),
          eventName: event.name,
          seatResultType: Array.isArray(seatResult) ? 'array' : 'object',
          seatsCount: Array.isArray(seatResult) ? seatResult.length : (seatResult.seats?.length || 0),
          hasDiagnostics: !Array.isArray(seatResult) && !!seatResult.diagnostics,
          diagnostics: !Array.isArray(seatResult) ? seatResult.diagnostics : null
        });
        
        // Handle both old format (array) and new format (object with seats/diagnostics)
        let autoSeats = Array.isArray(seatResult) ? seatResult : (seatResult.seats || []);
        const seatDiagnostics = Array.isArray(seatResult) ? null : (seatResult.diagnostics || null);
        
        // Store diagnostics for later use in error handling
        if (seatDiagnostics) {
          eventData.seat_diagnostics = seatDiagnostics;
          eventDiagnostics.push(seatDiagnostics);
        }

        // When admin/client set a preferred section + negotiated price (including $0),
        // do not drop the section if inventory is booked/held — mobile allows picking
        // sections with 0 available seats. Attach any matching category seat so
        // selected_seats (and thus the section label) persist.
        const hasNegotiatedPrice =
          (eventData.the1_pricing &&
            eventData.the1_pricing.the1_base_price != null &&
            Number.isFinite(Number(eventData.the1_pricing.the1_base_price))) ||
          (eventData.simple_joint_manual_price != null &&
            eventData.simple_joint_manual_price !== '' &&
            Number.isFinite(Number(eventData.simple_joint_manual_price)));
        const preferredCat =
          preferredCategory && typeof preferredCategory === 'string'
            ? preferredCategory.trim()
            : '';
        if (
          autoSeats.length === 0 &&
          preferredCat &&
          hasNegotiatedPrice &&
          Array.isArray(event.seats) &&
          event.seats.length > 0
        ) {
          const categoryMatches = event.seats.filter(
            s => String(s?.category || s?.section || 'General').trim() === preferredCat
          );
          const forcedSeat =
            categoryMatches.find(s => s.status === 'available') ||
            categoryMatches[0] ||
            null;
          if (forcedSeat && forcedSeat._id) {
            console.warn(
              '[BOT] [COE_CREATION_FULL_DEBUG] Force-attaching preferred category seat (negotiated price set, auto-select empty):',
              {
                eventId: eventId.toString(),
                preferredCategory: preferredCat,
                seatId: forcedSeat._id.toString(),
                seatCode: forcedSeat.code,
                inventoryStatus: forcedSeat.status,
                the1_base_price: eventData.the1_pricing?.the1_base_price,
                simple_joint_manual_price: eventData.simple_joint_manual_price
              }
            );
            autoSeats = [
              {
                seat_id: forcedSeat._id,
                seat_code: forcedSeat.code,
                capacity: forcedSeat.capacity,
                base_price: forcedSeat.min_spend || 0,
                event_price:
                  forcedSeat.event_price || forcedSeat.min_spend || 0,
                available_from: event.start_datetime,
                available_until:
                  event.end_datetime || event.start_datetime,
                status: 'selected'
              }
            ];
          } else {
            console.error(
              '[BOT] [COE_CREATION_FULL_DEBUG] Preferred category + negotiated price but no inventory seat in category:',
              {
                eventId: eventId.toString(),
                preferredCategory: preferredCat,
                eventCategories: [
                  ...new Set(
                    event.seats.map(s => s.category || s.section || 'General')
                  )
                ]
              }
            );
          }
        }
        
        eventData.selected_seats = autoSeats;
        
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Seat selection completed for event:', {
          eventId: eventId.toString(),
          eventName: event.name,
          seatsSelected: autoSeats.length,
          hasDiagnostics: !!seatDiagnostics,
          diagnostics: seatDiagnostics ? {
            primary_reason: seatDiagnostics.primary_reason,
            budget: seatDiagnostics.budget,
            filtering_stages: seatDiagnostics.filtering_stages
          } : null
        });
      } else {
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Event already has selected seats, skipping auto-selection:', {
          eventId: eventId.toString(),
          selectedSeatsCount: eventData.selected_seats?.length || 0
        });
      }

      if (eventData.selected_seats && eventData.selected_seats.length > 0) {
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Processing selected seats for event:', {
          eventId: eventId.toString(),
          seatsCount: eventData.selected_seats.length
        });
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

          const seatToAdd = {
            event_id: eventId, // Use validated event_id (from event._id or fallback to eventData.event_id)
            seat_id: seatData.seat_id,
            seat_code: seatData.seat_code || eventSeat.code,
            category: eventSeat.category || eventSeat.section,
            capacity: seatData.capacity || eventSeat.capacity,
            base_price: eventSeat.min_spend || 0,
            event_price: eventSeat.event_price || eventSeat.min_spend || 0,
            available_from: event.start_datetime,
            available_until: event.end_datetime || event.start_datetime,
            status: 'selected'
          };

          const sjManual = eventData.simple_joint_manual_price;
          if (
            sjManual != null &&
            sjManual !== '' &&
            Number.isFinite(Number(sjManual))
          ) {
            const manual = Number(sjManual);
            if (manual >= 0) {
              const catalogEventPrice =
                Number(eventSeat.event_price) ||
                Number(eventSeat.min_spend) ||
                0;
              seatToAdd.is_simple_joint = true;
              seatToAdd.simple_joint_original_price = catalogEventPrice;
              seatToAdd.event_price = manual;
              seatToAdd.base_price = manual;
              const sjT1 = eventData.simple_joint_the1_fee_percent;
              if (
                sjT1 != null &&
                sjT1 !== '' &&
                Number.isFinite(Number(sjT1))
              ) {
                seatToAdd.the1_fee_percent = Math.min(
                  100,
                  Math.max(0, Number(sjT1))
                );
              }
            }
          } else if (
            eventData.the1_pricing &&
            eventData.the1_pricing.the1_base_price != null &&
            Number.isFinite(Number(eventData.the1_pricing.the1_base_price))
          ) {
            const t1 = eventData.the1_pricing;
            const catalogFromVenue =
              t1.venue_catalog_price != null &&
              Number.isFinite(Number(t1.venue_catalog_price))
                ? Number(t1.venue_catalog_price)
                : Number(eventSeat.event_price) ||
                  Number(eventSeat.min_spend) ||
                  0;
            seatToAdd.venue_catalog_price = catalogFromVenue;
            const base = Number(t1.the1_base_price);
            seatToAdd.event_price = base;
            seatToAdd.base_price = base;
            seatToAdd.the1_fee_percent =
              t1.the1_fee_percent != null &&
              Number.isFinite(Number(t1.the1_fee_percent))
                ? Math.min(100, Math.max(0, Number(t1.the1_fee_percent)))
                : 20;
          }

          console.log('[BOT] [COE_CREATION_FULL_DEBUG] Adding seat to selection:', {
            seatId: seatToAdd.seat_id?.toString(),
            seatCode: seatToAdd.seat_code,
            eventId: seatToAdd.event_id?.toString(),
            capacity: seatToAdd.capacity,
            eventPrice: seatToAdd.event_price,
            basePrice: seatToAdd.base_price
          });
          
          selectedSeats.push(seatToAdd);
        }
        
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] Completed processing seats for event:', {
          eventId: eventId.toString(),
          seatsAdded: eventData.selected_seats.length,
          totalSelectedSeatsSoFar: selectedSeats.length
        });
      } else {
        // No seats were selected for this event (but other events may still have seats).
        // Log detailed diagnostics so we can understand why this specific event ended up
        // without seats while others succeeded.
        const diagnosticsForEvent = eventData.seat_diagnostics || null;
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] No seats selected for event:', {
          eventId: eventId.toString(),
          eventName: event.name,
          eventStatus: event.status,
          eventSeatsCount: event.seats?.length || 0,
          locationId: event.location_id?._id?.toString() || event.location_id?.toString(),
          locationSeatsCount: event.location_id?.seats?.length || 0,
          manual_event_selection: !!manual_event_selection,
          party_size: conversationPreferences.party_size,
          budget_max: conversationPreferences.budget?.max || conversationPreferences.budget_range?.max || null,
          city: cityToUse || conversationPreferences.city || null,
          hasDiagnostics: !!diagnosticsForEvent,
          diagnostics: diagnosticsForEvent || undefined
        });
      }
    }
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Seat selection phase complete:', {
      totalSeatsSelected: selectedSeats.length,
      eventsProcessed: finalEvents.length,
      eventDiagnosticsCount: eventDiagnostics.length
    });
    
    // Validate we have at least some seats selected
    // If no seats found, try alternative events before giving up
    if (selectedSeats.length === 0) {
      // If events came from an explicit manual selection, do NOT auto-replace them
      // with alternative events. Instead, return a clear NO_SEATS_AVAILABLE error.
      if (manual_event_selection) {
        console.log('[BOT] [COE_CREATION_FULL_DEBUG] No seats found and manual_event_selection=true - returning NO_SEATS_AVAILABLE without alternative events');
        const noSeatsError = createError(
          ErrorCodes.NO_SEATS_AVAILABLE,
          'No available seats/tables were found for the selected events.',
          ErrorCategories.BUSINESS,
          false
        );
        noSeatsError.type = 'NO_SEATS_AVAILABLE';
        noSeatsError.details = {
          event_diagnostics: eventDiagnostics,
          location_exclusion_info: finalEvents && finalEvents._locationExclusionInfo
            ? finalEvents._locationExclusionInfo
            : null
        };
        throw noSeatsError;
      }
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] No seats found - attempting alternative search:', {
        selectedSeatsCount: selectedSeats.length,
        finalEventsCount: finalEvents.length,
        eventDiagnosticsCount: eventDiagnostics.length
      });
      
      // Get original events with location info for exclusion
      const originalEventsWithLocations = [];
      for (const eventData of finalEvents) {
        if (eventData.event_id) {
          const event = await Event.findById(eventData.event_id).populate('location_id', '_id name');
          if (event) {
            originalEventsWithLocations.push({
              event_id: eventData.event_id,
              location_id: event.location_id
            });
          }
        }
      }
      
      // Try to find alternative events with seats
      const alternativeResult = await findAlternativeEventsWithSeats(
        originalEventsWithLocations,
        conversationPreferences,
        [],
        autoSelectEventsBySentiment,
        3
      );
      
      if (alternativeResult.success && alternativeResult.events.length > 0) {
        console.log('[BOT] Alternative events found:', alternativeResult.events.length, 'events with seats');
        
        // Replace finalEvents with alternative events
        finalEvents = alternativeResult.events.map(item => ({
          event_id: item.event_id || (item.event && (item.event._id || item.event.id)),
          selected_seats: [],
          sentiment_match: item.sentimentScore !== undefined ? {
            score: item.sentimentScore,
            reasons: item.matchReasons || item.sentimentHighlights || [],
            highlights: item.sentimentHighlights || item.matchReasons || [],
            structuredPreferences: item.structuredPreferences || null
          } : null
        })).filter(e => e.event_id);
        
        // Re-select seats for alternative events
        selectedSeats.length = 0; // Clear array
        for (const eventData of finalEvents) {
          if (!eventData.event_id) continue;
          
          // Fetch event with location populated (including seats for sentiment checking)
          const event = await Event.findById(eventData.event_id)
            .populate('location_id', 'seats');
          if (!event) continue;
          
          const eventId = event._id || eventData.event_id;
          if (!eventId) continue;
          
          // Pass structured preferences (including exclusions) to seat selection
          const preferencesWithStructured = {
            ...conversationPreferences,
            structuredPreferences: eventData.sentiment_match?.structuredPreferences || null
          };
          const seatResult = await selectSeatsByBudgetAndCapacity(
            event,
            preferencesWithStructured,
            conversationPreferences.budget?.max
          );
          
          // Handle both old format (array) and new format (object with seats/diagnostics)
          const autoSeats = Array.isArray(seatResult) ? seatResult : (seatResult.seats || []);
          const seatDiagnostics = Array.isArray(seatResult) ? null : (seatResult.diagnostics || null);
          
          // Store diagnostics for later use in error handling
          if (seatDiagnostics) {
            eventData.seat_diagnostics = seatDiagnostics;
            eventDiagnostics.push(seatDiagnostics);
          }
          
          if (autoSeats.length > 0) {
            for (const seatData of autoSeats) {
              if (!seatData.seat_id) continue;
              
              const seatIdStr = seatData.seat_id.toString();
              const eventSeat = event.seats.find(s => {
                const sId = s._id ? s._id.toString() : null;
                return sId === seatIdStr;
              });
              
              if (!eventSeat || eventSeat.status !== 'available') continue;
              
              selectedSeats.push({
                event_id: eventId,
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
        
        if (selectedSeats.length === 0) {
          // Still no seats after alternative search - return error with aggregated diagnostics
          console.log('[BOT] No seats found even after alternative search');
          
          // Collect diagnostics from alternative events too
          const allEventDiagnostics = [...eventDiagnostics];
          for (const eventData of finalEvents) {
            if (eventData.seat_diagnostics) {
              allEventDiagnostics.push(eventData.seat_diagnostics);
            }
          }
          
          // Ensure preferences object has the correct city (from form submission)
          const errorPreferences = {
            ...conversationPreferences,
            city: cityToUse || conversationPreferences.city,
            location_preferences: cityToUse ? [cityToUse] : (conversationPreferences.location_preferences || [])
          };
          throw {
            type: 'NO_SEATS_AVAILABLE',
            message: 'We couldn\'t find any available seats/tables matching your preferences.',
            searchAttempts: alternativeResult.searchAttempts,
            preferences: errorPreferences,
            event_diagnostics: allEventDiagnostics
          };
        }
      } else {
        // No alternative events found - return error with diagnostics
        console.log('[BOT] No alternative events found with available seats');
        // Ensure preferences object has the correct city (from form submission)
        const errorPreferences = {
          ...conversationPreferences,
          city: cityToUse || conversationPreferences.city,
          location_preferences: cityToUse ? [cityToUse] : (conversationPreferences.location_preferences || [])
        };
        throw {
          type: 'NO_SEATS_AVAILABLE',
          message: 'We couldn\'t find any available seats/tables matching your preferences.',
          searchAttempts: alternativeResult.searchAttempts || [],
          preferences: errorPreferences,
          event_diagnostics: eventDiagnostics
        };
      }
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

    // Admin create/propose is optimized for speed: skip optional OpenAI enrichment
    // (seat recommendation tips + upgrade-offer generation). Pricing, seats, deposit,
    // and approve are unaffected. Client/bot flows keep AI enrichment unchanged.
    const skipAiEnrichmentForCreate =
      (user.role != null ? String(user.role) : '').toLowerCase() === 'admin';

    // Phase 3: Generate AI recommendations for selected seats
    if (validatedSeats.length > 0 && !skipAiEnrichmentForCreate) {
      try {
        console.log('[BOT] Generating AI recommendations for selected seats...');
        
        // Collect recommendation data: need to fetch location and sentiments for each seat
        const recommendationData = [];
        const eventMap = new Map();
        
        // Fetch unique event IDs and populate with location.seats
        const uniqueEventIds = [...new Set(validatedSeats.map(s => s.event_id.toString()))];
        const eventsWithLocations = await Event.find({ _id: { $in: uniqueEventIds } })
          .populate({
            path: 'location_id',
            select: 'seats',
            options: { lean: false }
          });
        
        // Build event map with populated location.seats
        for (const event of eventsWithLocations) {
          eventMap.set(event._id.toString(), event);
        }
        
        // Collect seat data with location and sentiments
        for (const seat of validatedSeats) {
          const eventId = seat.event_id.toString();
          const event = eventMap.get(eventId);
          
          if (event && event.location_id) {
            // Find location seat to get sentiments
            const location = event.location_id;
            const locationSeat = location.seats?.find(s => {
              // Match by seat_id (stable reference)
              const seatIdStr = seat.seat_id?.toString();
              const locationSeatId = s._id?.toString();
              if (seatIdStr && locationSeatId && locationSeatId === seatIdStr) {
                return true;
              }
              // Fallback: match by code
              return s.code === seat.seat_code;
            });
            
            if (locationSeat && locationSeat.sentiment && locationSeat.sentiment.length > 0) {
              recommendationData.push({
                seatData: {
                  code: seat.seat_code,
                  category: locationSeat.category || seat.category,
                  capacity: seat.capacity,
                  section: locationSeat.section || seat.section,
                  event_price: seat.event_price || seat.base_price || 0,
                  base_price: seat.base_price || 0
                },
                sentiments: locationSeat.sentiment,
                locationId: location._id?.toString() || location.toString()
              });
            } else {
              // Log why recommendation wasn't generated for debugging
              console.log('[BOT] No sentiment found for seat:', {
                seat_code: seat.seat_code,
                seat_id: seat.seat_id?.toString(),
                hasEvent: !!event,
                hasLocation: !!event?.location_id,
                hasLocationSeats: !!event?.location_id?.seats,
                locationSeatsCount: event?.location_id?.seats?.length || 0,
                locationSeatFound: !!locationSeat,
                hasSentiment: !!(locationSeat?.sentiment),
                sentimentLength: locationSeat?.sentiment?.length || 0
              });
            }
          } else {
            console.log('[BOT] Event or location not found for seat:', {
              seat_code: seat.seat_code,
              seat_id: seat.seat_id?.toString(),
              eventId: eventId,
              hasEvent: !!event,
              hasLocation: !!event?.location_id
            });
          }
        }
        
        // Generate recommendations in parallel
        if (recommendationData.length > 0) {
          const recommendations = await generateSeatRecommendations(
            recommendationData,
            conversationPreferences,
            { timeout: 5000 }
          );
          
          // Attach recommendations to validated seats
          const recommendationMap = new Map(
            recommendations.map(rec => [rec.seat_code, rec])
          );
          
          validatedSeats.forEach(seat => {
            const rec = recommendationMap.get(seat.seat_code);
            if (rec) {
              seat.ai_recommendation = rec.recommendation;
              seat.recommendation_generated_at = rec.generated_at;
              seat.recommendation_version = rec.version;
            }
          });
          
          // Log recommendations after attachment for debugging
          const seatsWithRecommendations = validatedSeats.filter(s => s.ai_recommendation);
          console.log('[BOT] Generated', recommendations.length, 'seat recommendations');
          console.log('[BOT] Recommendations attached to seats:', {
            totalSeats: validatedSeats.length,
            seatsWithRecommendations: seatsWithRecommendations.length,
            recommendations: seatsWithRecommendations.map(s => ({
              seat_code: s.seat_code,
              hasRecommendation: !!s.ai_recommendation,
              recommendation: s.ai_recommendation?.substring(0, 50) + '...'
            }))
          });
        } else {
          console.log('[BOT] No sentiments found for seats, skipping recommendation generation');
        }
      } catch (error) {
        console.error('[BOT] Error generating seat recommendations:', error);
        // Don't fail COE creation if recommendations fail
      }
    } else if (validatedSeats.length > 0 && skipAiEnrichmentForCreate) {
      console.log('[BOT] Skipping AI seat recommendations for admin create (speed).');
    }

    // Determine initial status based on creator role
    // Client-created COEs start as 'request', admin-created COEs start as 'draft'
    const roleNorm = (user.role != null ? String(user.role) : '').toLowerCase();
    const initialStatus = roleNorm === 'client' ? 'request' : 'draft';
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Setting initial COE status:', {
      userRole: user.role,
      initialStatus: initialStatus,
      isClientCreated: user.role === 'client'
    });

    // Re-apply per-event party sizes from preferences map (survives auto-select remaps).
    const partySizeByEventId = new Map();
    const partySizeRows = [
      ...(Array.isArray(conversationPreferences?.event_party_sizes)
        ? conversationPreferences.event_party_sizes
        : []),
      ...(Array.isArray(preferences?.event_party_sizes)
        ? preferences.event_party_sizes
        : []),
    ];
    for (const row of partySizeRows) {
      const id = String(row?.event_id ?? '')
        .trim()
        .toLowerCase();
      const n = Number(row?.party_size);
      if (id && Number.isFinite(n) && n >= 1) {
        partySizeByEventId.set(id, Math.floor(n));
      }
    }
    if (Array.isArray(finalEvents)) {
      for (const e of finalEvents) {
        const id = String(e?.event_id?._id ?? e?.event_id ?? '')
          .trim()
          .toLowerCase();
        const fromEvent = Number(e?.party_size);
        if (id && Number.isFinite(fromEvent) && fromEvent >= 1) {
          partySizeByEventId.set(id, Math.floor(fromEvent));
        }
      }
      finalEvents = finalEvents.map(e => {
        const id = String(e?.event_id?._id ?? e?.event_id ?? '')
          .trim()
          .toLowerCase();
        const ps = id ? partySizeByEventId.get(id) : null;
        if (ps == null) return e;
        return {...e, party_size: ps};
      });
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
      status: initialStatus, // Set status based on creator role
      events: finalEvents.map(e => ({
        event_id: e.event_id,
        event_date: startDate,
        event_time: 'TBD',
        base_price: 0,
        quantity: 1,
        total_price: 0,
        sequence: finalEvents.indexOf(e) + 1,
        // Phase 2.5: Store sentiment match data in event item (will be preserved in COE)
        sentiment_match: e.sentiment_match || null,
        ...(e.party_size != null &&
        Number.isFinite(Number(e.party_size)) &&
        Number(e.party_size) >= 1
          ? { party_size: Math.floor(Number(e.party_size)) }
          : {}),
      })),
      selected_seats: validatedSeats, // Use validated seats
      participants: [],
      tags: [],
      sharable: false,
      is_the1_event:
        preferences.is_the1_event === true ||
        conversationPreferences.is_the1_event === true,
    };

    console.log('[BOT] [COE_CREATION_FULL_DEBUG] ========== AUTO-FILL PHASE ==========');
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Base COE data before autoFill:', {
      name: baseCoeData.name,
      description: baseCoeData.description,
      start_date: baseCoeData.start_date,
      end_date: baseCoeData.end_date,
      client_id: baseCoeData.client_id,
      admin_id: baseCoeData.admin_id,
      created_by: baseCoeData.created_by,
      eventsCount: baseCoeData.events.length,
      selectedSeatsCount: baseCoeData.selected_seats.length,
      events: baseCoeData.events.map(e => ({
        event_id: e.event_id?.toString(),
        sequence: e.sequence
      })),
      seats: baseCoeData.selected_seats.map(s => ({
        event_id: s.event_id?.toString(),
        seat_id: s.seat_id?.toString(),
        seat_code: s.seat_code,
        event_price: s.event_price,
        hasAiRecommendation: !!s.ai_recommendation
      }))
    });
    
    // Apply advanced auto-fill (runner, policies, budget-aware pricing)
    const coeData = await autoFillCOEData(
      baseCoeData,
      conversationPreferences,
      finalEvents.map(e => ({ event_id: e.event_id }))
    );
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] COE data after autoFill:', {
      hasSubtotal: !!coeData.subtotal,
      subtotal: coeData.subtotal,
      hasTaxes: !!coeData.taxes,
      taxes: coeData.taxes,
      hasFees: !!coeData.fees,
      fees: coeData.fees,
      hasTotal: !!coeData.total,
      total: coeData.total,
      deposit_required: coeData.deposit_required,
      selectedSeatsCount: coeData.selected_seats?.length || 0,
      runnerAssignment: coeData.runner_assignment ? {
        type: coeData.runner_assignment.type,
        runner_id: coeData.runner_assignment.runner_id?.toString()
      } : null
    });
    
    // Safety check: Ensure pricing is calculated if seats exist
    if (coeData.selected_seats && coeData.selected_seats.length > 0) {
      const needsPricing = !coeData.subtotal || coeData.subtotal === 0;
      if (needsPricing) {
        console.log('[BOT] Pricing not set after autoFillCOEData, calculating now', {
          seatsCount: coeData.selected_seats.length,
          currentSubtotal: coeData.subtotal
        });
        const costs = calculateSeatCosts(coeData.selected_seats);
        coeData.subtotal = costs.subtotal;
        coeData.taxes = costs.taxes;
        coeData.fees = costs.fees;
        coeData.total = costs.total;
        coeData.deposit_required = costs.depositRequired;
        console.log('[BOT] Pricing calculated as safety check', {
          subtotal: coeData.subtotal,
          total: coeData.total
        });
      } else {
        console.log('[BOT] Pricing already set', {
          subtotal: coeData.subtotal,
          total: coeData.total
        });
      }
    }
    
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

    // Log pricing before COE creation
    console.log('[BOT] Pricing in coeData before COE creation:', {
      subtotal: coeData.subtotal,
      taxes: coeData.taxes,
      fees: coeData.fees,
      total: coeData.total,
      deposit_required: coeData.deposit_required,
      seatsCount: coeData.selected_seats?.length || 0
    });

    // Log recommendations before COE creation for debugging
    const seatsWithRecsBeforeSave = (coeData.selected_seats || []).filter(s => s.ai_recommendation);
    console.log('[BOT] Recommendations before COE creation:', {
      totalSeats: coeData.selected_seats?.length || 0,
      seatsWithRecommendations: seatsWithRecsBeforeSave.length,
      recommendations: seatsWithRecsBeforeSave.map(s => ({
        seat_code: s.seat_code,
        recommendation: s.ai_recommendation?.substring(0, 50) + '...'
      }))
    });

    // Capture original request data for client requests AND admin drafts (form party/budget).
    // Previously only `request` status was filled, so admin-created drafts had no original_request_data
    // and the mobile admin card fell back to table capacity (wrong) for group size.
    if (initialStatus === 'request' || initialStatus === 'draft') {
      try {
        // Get conversation to extract original request text
        const conversation = await BotConversation.findOne({ user_id: user._id });
        let originalRequestText = '';
        
        if (conversation && conversation.messages && conversation.messages.length > 0) {
          // Find the most recent user message that likely triggered COE creation
          // Look for user messages containing COE-related keywords or recent messages
          const userMessages = conversation.messages
            .filter(msg => msg.role === 'user')
            .slice(-5) // Check last 5 user messages
            .reverse(); // Most recent first
          
          // Use the most recent user message as original request
          if (userMessages.length > 0) {
            originalRequestText = userMessages[0].content || '';
          }
        }
        
        const budgetMaxRaw =
          conversationPreferences.budget_range?.max ?? conversationPreferences.budget?.max;
        const budgetMaxNum =
          budgetMaxRaw != null && budgetMaxRaw !== '' ? Number(budgetMaxRaw) : NaN;
        const budgetSubdoc =
          !Number.isNaN(budgetMaxNum) && budgetMaxNum > 0
            ? {
                max: budgetMaxNum,
                currency:
                  conversationPreferences.budget_range?.currency ||
                  conversationPreferences.budget?.currency ||
                  'USD',
              }
            : undefined;

        const partyRaw = conversationPreferences.party_size;
        const partyNum =
          partyRaw != null && partyRaw !== '' ? Number(partyRaw) : NaN;
        const partySizeVal =
          !Number.isNaN(partyNum) && partyNum >= 1 ? Math.floor(partyNum) : undefined;

        // Build original request data
        const originalRequestData = {
          original_request_text: originalRequestText,
          budget: budgetSubdoc,
          requested_dates: {
            start_date: startDate,
            end_date: endDate
          },
          party_size: partySizeVal,
          seat_preferences: conversationPreferences.seat_preferences,
          general_preferences: conversationPreferences.specific_preferences,
          city: cityToUse || conversationPreferences.city,
          open_to_join_events: conversationPreferences.open_to_join_events === true,
          is_the1_event: conversationPreferences.is_the1_event === true,
          requested_at: new Date()
        };
        
        // Only add if we have meaningful data
        if (
          originalRequestText ||
          originalRequestData.budget ||
          originalRequestData.party_size != null ||
          originalRequestData.seat_preferences ||
          originalRequestData.general_preferences
        ) {
          coeData.original_request_data = originalRequestData;
          console.log('[BOT] Original request data captured:', {
            hasOriginalText: !!originalRequestText,
            originalTextLength: originalRequestText.length,
            budget: originalRequestData.budget,
            partySize: originalRequestData.party_size,
            hasSeatPreferences: !!originalRequestData.seat_preferences,
            city: originalRequestData.city,
            initialStatus
          });
        }
      } catch (error) {
        console.error('[BOT] Error capturing original request data:', error);
        // Don't fail COE creation if we can't capture request data
      }
    }

    console.log('[BOT] [COE_CREATION_FULL_DEBUG] ========== COE CREATION PHASE ==========');
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] COE data prepared for persistence:', {
      coeDataKeys: Object.keys(coeData),
      createdBy: user._id.toString(),
      userRole: user.role,
      coeDataSummary: {
        name: coeData.name,
        client_id: coeData.client_id,
        eventsCount: coeData.events?.length || 0,
        seatsCount: coeData.selected_seats?.length || 0,
        subtotal: coeData.subtotal,
        total: coeData.total
      },
      request_coe_id: request_coe_id
    });
    
    let coe;
    if (request_coe_id) {
      // Flow A / client request edit: upgrade existing request COE in place.
      console.log('[BOT] [COE_CREATION_FULL_DEBUG] Flow A detected - updating existing request COE:', {
        request_coe_id: request_coe_id
      });

      const existingRequestCoe = await coeService.getCOEById(request_coe_id);
      const preserveRequestStatus =
        roleNorm === 'client' && existingRequestCoe?.status === 'request';

      coe = await coeService.updateCOE(
        request_coe_id,
        {
          ...coeData,
          status: preserveRequestStatus ? 'request' : coeData.status || 'draft',
        },
        { actorRole: user.role }
      );
      coeService.filterSelectedSeatsByEvents(
        coe,
        '[create_coe_draft request_coe_id]'
      );
      if (coe.isModified && coe.isModified('selected_seats')) {
        await coe.save();
      }
    } else {
      // Default behaviour: create a new draft/request COE as before.
      coe = await coeService.createCOE(coeData, user._id, {
        actorRole: user.role,
      });
    }
    
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] COE created successfully:', {
      coeId: coe._id?.toString(),
      coeStatus: coe.status,
      coeName: coe.name,
      subtotal: coe.subtotal,
      total: coe.total,
      eventsCount: coe.events?.length || 0,
      selectedSeatsCount: coe.selected_seats?.length || 0
    });

    // Log pricing after COE creation (before population)
    console.log('[BOT] Pricing in coe after creation (before population):', {
      subtotal: coe.subtotal,
      taxes: coe.taxes,
      fees: coe.fees,
      total: coe.total,
      deposit_required: coe.deposit_required
    });

    // Get populated COE for response
    let populatedCOE = await coeService.getCOEById(coe._id);
    
    // Log pricing after population
    console.log('[BOT] Pricing in populatedCOE after getCOEById:', {
      subtotal: populatedCOE.subtotal,
      taxes: populatedCOE.taxes,
      fees: populatedCOE.fees,
      total: populatedCOE.total,
      deposit_required: populatedCOE.deposit_required
    });

    // Admin push for client `request` COEs is sent from coeService.createCOE (single place).

    // Generate seat upgrade offers for draft or request COEs.
    // Skipped on admin create/propose for speed (fans out per-seat + OpenAI per alternative).
    // Admins still have the manual paid seat upgrade flow post-create.
    if (
      (populatedCOE.status === 'draft' || populatedCOE.status === 'request') &&
      !skipAiEnrichmentForCreate
    ) {
      try {
        console.log('[BOT] Generating seat upgrade offers for COE:', populatedCOE._id);
        const totalBudget = conversationPreferences.budget?.max || conversationPreferences.budget_range?.max || null;
        // Pass isAdmin flag: admins see all seats, clients see only better seats
        const isAdmin = user.role === 'admin';
        const upgradeOffers = await generateSeatUpgradeOffers(populatedCOE, totalBudget, conversationPreferences, isAdmin);
        
        console.log('[BOT] Generated upgrade offers:', upgradeOffers.length, 'offers');
        
        if (upgradeOffers.length > 0) {
          // Store offers in COE
          populatedCOE.seat_upgrade_offers = upgradeOffers;
          await populatedCOE.save();
          console.log('[BOT] Saved upgrade offers to COE');
          
          // Refresh COE to ensure we have the latest data including upgrade offers
          populatedCOE = await coeService.getCOEById(populatedCOE._id);
          console.log('[BOT] Refreshed COE, upgrade offers count:', populatedCOE.seat_upgrade_offers?.length || 0);
        } else {
          console.log('[BOT] No upgrade offers generated (no better seats found)');
        }
      } catch (error) {
        console.error('[BOT] Error generating upgrade offers:', error);
        // Don't fail COE creation if offers fail
      }
    } else if (skipAiEnrichmentForCreate) {
      console.log('[BOT] Skipping seat upgrade offer generation for admin create (speed).');
    }

    /**
     * Admin "Create proposal" from mobile form: after draft is built (and optional upgrade offers),
     * set deposit then transition to approved so the client sees it and receives coe_approved.
     * Does not set payment_deadline_at / payment_deadline_hours (admin can set a timer later via Propose / re-propose on draft or approved flow).
     * Not applied when upgrading a request-only COE (request_coe_id) or for non-admins.
     */
    if (
      user.role === 'admin' &&
      admin_create_as_proposal === true &&
      !request_coe_id &&
      populatedCOE.status === 'draft'
    ) {
      const depPct =
        typeof proposalDepositPercent === 'number' &&
        proposalDepositPercent > 0 &&
        proposalDepositPercent <= 100
          ? Math.round(proposalDepositPercent)
          : 20;
      try {
        const coeDoc = await COE.findById(populatedCOE._id);
        if (!coeDoc || coeDoc.status !== 'draft') {
          console.warn('[BOT] admin_create_as_proposal: COE missing or not draft, skipping auto-approve');
        } else {
          coeDoc.deposit_percent = depPct;
          coeDoc.deposit_required = Math.round((coeDoc.total || 0) * (depPct / 100));
          await coeDoc.save();
          await coeService.updateCOEStatus(populatedCOE._id.toString(), 'approved', user._id);
          populatedCOE = await coeService.getCOEById(populatedCOE._id);
          console.log('[BOT] Admin create-as-proposal: COE approved; deposit %', depPct, '(no payment timer set)');
        }
      } catch (proposalErr) {
        console.error('[BOT] Admin create-as-proposal failed:', proposalErr);
      }
    }

    // Create actions
    const actions = createCOEActions(populatedCOE, user.role);

    // Format structured response with budget comparison (Phase 2.5)
    const budgetForComparison = conversationPreferences.budget || 
                                (conversationPreferences.budget_range ? { max: conversationPreferences.budget_range.max } : null);
    // Phase 2.5: Use 'coe_draft' type for draft or request COEs to enable enhanced display
    const responseType = (populatedCOE.status === 'draft' || populatedCOE.status === 'request') ? 'coe_draft' : 'coe_created';
    // Determine appropriate message based on status and creator role
    let creationMessage;
    if (populatedCOE.status === 'request') {
      // User-requested COE
      creationMessage = 'Your experience request has been submitted! THE1 will review it and update you soon. Review the details below.';
    } else if (populatedCOE.status === 'draft' && user.role === 'client') {
      // Client-created draft (edge case, but handle it)
      creationMessage = 'Your experience request has been submitted! THE1 will review it and update you soon. Review the details below.';
    } else if (populatedCOE.status === 'approved' && user.role === 'admin') {
      creationMessage =
        'The experience has been sent to the client as a proposal. They have been notified to review and respond.';
    } else {
      // Admin-created draft
      creationMessage = 'Your experience draft has been created! Review the selected events and details below.';
    }
    
    const structuredResponse = await formatCOEResponse(
      responseType,
      populatedCOE,
      creationMessage,
      actions,
      budgetForComparison
    );
    
    // Include upgrade offers in response if available (both top level and in coe object)
    // Note: upgrade offers are already normalized in formatCOEResponse, so we use those
    if (populatedCOE.seat_upgrade_offers && populatedCOE.seat_upgrade_offers.length > 0) {
      console.log('[BOT] Including upgrade offers in response:', populatedCOE.seat_upgrade_offers.length, 'offers');
      // Use the normalized offers from structuredResponse.coe (already normalized in formatCOEResponse)
      if (structuredResponse.coe && structuredResponse.coe.seat_upgrade_offers) {
        structuredResponse.seat_upgrade_offers = structuredResponse.coe.seat_upgrade_offers;
      } else {
        // Fallback: normalize manually if not already done
        structuredResponse.seat_upgrade_offers = populatedCOE.seat_upgrade_offers.map(offer => ({
          ...offer.toObject ? offer.toObject() : offer,
          event_id: offer.event_id?._id?.toString() || offer.event_id?.toString() || offer.event_id,
          current_seat_id: offer.current_seat_id?._id?.toString() || offer.current_seat_id?.toString() || offer.current_seat_id,
          alternatives: (offer.alternatives || []).map(alt => ({
            ...alt.toObject ? alt.toObject() : alt,
            seat_id: alt.seat_id?._id?.toString() || alt.seat_id?.toString() || alt.seat_id
          }))
        }));
        if (structuredResponse.coe) {
          structuredResponse.coe.seat_upgrade_offers = structuredResponse.seat_upgrade_offers;
        }
      }
    } else {
      console.log('[BOT] No upgrade offers to include in response');
    }

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

    console.log('[BOT] [COE_CREATION_FULL_DEBUG] ========== SUCCESS - Returning result ==========');
    console.log('[BOT] [COE_CREATION_FULL_DEBUG] Final result:', {
      success: result.success,
      hasData: !!result.data,
      message: result.message,
      responseType: result.data?.type
    });
    
    return result;
  } catch (error) {
    console.error('[BOT] [COE_CREATION_FULL_DEBUG] ========== ERROR in handleCreateCOEDraft ==========');
    console.error('[BOT] [COE_CREATION_FULL_DEBUG] Error details:', {
      errorType: error?.type || error?.constructor?.name,
      errorMessage: error?.message,
      errorStack: error?.stack,
      errorFull: JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
      correlationId: correlationId,
      userId: user._id?.toString(),
      userRole: user.role
    });
    
    console.error('Error in handleCreateCOEDraft:', error);
    
    // Handle NO_SEATS_AVAILABLE error specially
    if (error && error.type === 'NO_SEATS_AVAILABLE') {
      const errorResponse = formatNoSeatsAvailableResponse(error);
      console.log('[BOT_TOOL_HANDLER] NO_SEATS_AVAILABLE error formatted:', {
        hasSpecificReason: !!errorResponse.specific_reason,
        specificReason: errorResponse.specific_reason,
        hasEventDiagnostics: !!(errorResponse.details?.event_diagnostics?.length),
        eventDiagnosticsCount: errorResponse.details?.event_diagnostics?.length || 0,
        hasPrimaryReason: !!errorResponse.details?.primary_reason,
        primaryReason: errorResponse.details?.primary_reason,
        errorResponseType: errorResponse.type,
        errorResponseKeys: Object.keys(errorResponse)
      });
      return {
        success: false,
        error: {
          code: 'NO_SEATS_AVAILABLE',
          message: error.message || 'No seats available',
          category: 'validation', // lowercase for BotAuditLog enum
          userFacing: true
        },
        data: errorResponse,
        message: errorResponse.message
      };
    }
    
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

    // Check feature flag for client COE editing
    const { isClientCOEEditingEnabled } = require('../utils/featureFlags');
    if (user.role === 'client' && !isClientCOEEditingEnabled()) {
      throw createError(
        ErrorCodes.PERMISSION_DENIED,
        'Client COE editing is currently disabled. Please contact an admin for assistance.',
        ErrorCategories.PERMISSION,
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
    if (updates.start_date || updates.end_date) {
      const datePatch = applyCoeCalendarDates(
        {
          ...(updates.start_date ? { start_date: updates.start_date } : {}),
          ...(updates.end_date ? { end_date: updates.end_date } : {}),
        },
        {
          start_date: existingCOE.start_date,
          end_date: existingCOE.end_date,
        },
      );
      if (datePatch.start_date) updateData.start_date = datePatch.start_date;
      if (datePatch.end_date) updateData.end_date = datePatch.end_date;
      if (datePatch.original_request_data) {
        updateData.original_request_data = datePatch.original_request_data;
      }
    }
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.client_notes !== undefined) updateData.client_notes = updates.client_notes;
    if (updates.events) updateData.events = updates.events;
    if (updates.selected_seats) updateData.selected_seats = updates.selected_seats;

    // Update COE
    const updatedCOE = await coeService.updateCOE(coe_id, updateData, {
      actorRole: user.role,
    });

    // Get populated COE for response
    const populatedCOE = await coeService.getCOEById(updatedCOE._id);

    // Create actions
    const actions = createCOEActions(populatedCOE, user.role);

    // Format structured response
    const structuredResponse = await formatCOEResponse(
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
    const structuredResponse = await formatCOEListResponse(
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
    const structuredResponse = await formatCOEResponse(
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
 * Handler 8: Get User Profile
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleGetUserProfile(params, user, correlationId) {
  try {
    const { user_id } = params || {};
    
    console.log('[BOT] handleGetUserProfile - Received parameters:', {
      user_id,
      currentUserId: user._id.toString(),
      currentUserRole: user.role
    });

    // Security validation: Determine target user ID
    let targetUserId;
    
    if (user_id) {
      // User specified a user_id - check permissions
      if (user.role === 'client') {
        // Clients can only view their own profile
        if (user_id !== user._id.toString()) {
          throw createError(
            ErrorCodes.PERMISSION_DENIED,
            'Clients can only view their own profile.',
            ErrorCategories.PERMISSION,
            false
          );
        }
        targetUserId = user._id.toString();
      } else if (user.role === 'admin' || user.role === 'runner') {
        // Admins and runners can view any profile
        targetUserId = user_id;
      } else {
        throw createError(
          ErrorCodes.PERMISSION_DENIED,
          'You do not have permission to view user profiles.',
          ErrorCategories.PERMISSION,
          false
        );
      }
    } else {
      // No user_id specified - return current user's profile
      targetUserId = user._id.toString();
    }

    // Fetch user profile
    const targetUser = await User.findById(targetUserId);
    
    if (!targetUser) {
      throw createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'User not found.',
        ErrorCategories.SERVICE,
        false
      );
    }

    // Get profile data
    const profileData = targetUser.getProfile ? targetUser.getProfile() : {
      _id: targetUser._id,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      email: targetUser.email,
      phone: targetUser.phone,
      role: targetUser.role,
      avatarUrl: targetUser.avatarUrl,
      dateOfBirth: targetUser.dateOfBirth,
      industry: targetUser.industry,
      userTier: targetUser.userTier,
      entity_status: targetUser.entity_status,
      visibilityStatus: targetUser.visibilityStatus,
      socialMedia: targetUser.socialMedia,
      createdAt: targetUser.createdAt,
      updatedAt: targetUser.updatedAt,
      lastLogin: targetUser.lastLogin
    };

    console.log('[BOT] handleGetUserProfile - Profile retrieved:', {
      userId: targetUserId,
      name: profileData.firstName && profileData.lastName 
        ? `${profileData.firstName} ${profileData.lastName}`
        : profileData.email
    });

    // Format response
    const profileResponse = formatProfileResponse(
      profileData,
      targetUserId === user._id.toString() 
        ? 'Here is your profile information.'
        : `Here is ${profileData.firstName && profileData.lastName ? `${profileData.firstName} ${profileData.lastName}` : 'the user'}'s profile information.`
    );

    return {
      success: true,
      data: profileResponse,
      message: 'Profile retrieved successfully',
      structured_data: profileResponse
    };

  } catch (error) {
    console.error('[BOT] Error in handleGetUserProfile:', {
      error: error.message,
      code: error.code,
      category: error.category,
      correlationId
    });

    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Failed to retrieve user profile',
        ErrorCategories.SYSTEM,
        false
      )
    };
  }
}

/**
 * Build client search filter
 * Shared helper function for building search filters
 * @param {string} search - Search query string
 * @returns {Object} MongoDB filter object
 */
function buildClientSearchFilter(search) {
  const filter = { role: 'client' };
  
  if (search && search.trim()) {
    const searchRegex = { $regex: search.trim(), $options: 'i' };
    filter.$or = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
      { $expr: { 
        $regexMatch: { 
          input: { $concat: ['$firstName', ' ', '$lastName'] }, 
          regex: search.trim(), 
          options: 'i' 
        } 
      }}
    ];
  }
  
  return filter;
}

/**
 * Format client data for response
 * Shared helper function for formatting client objects
 * @param {Object} client - MongoDB user document
 * @returns {Object} Formatted client object
 */
function formatClientForResponse(client) {
  return {
    id: client._id.toString(),
    _id: client._id.toString(),
    name: client.firstName && client.lastName 
      ? `${client.firstName} ${client.lastName}`
      : client.firstName || client.email || 'Unknown',
    firstName: client.firstName || null,
    lastName: client.lastName || null,
    email: client.email || null,
    phone: client.phone || null,
    avatarUrl: client.avatarUrl || null,
    role: client.role || 'client',
    entity_status: client.entity_status || null,
    createdAt: client.createdAt || null
  };
}

/**
 * Handler 9: Get Clients List
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Tool execution result
 */
async function handleGetClients(params, user, correlationId) {
  try {
    // Security check: Only admins and runners can access
    if (user.role !== 'admin' && user.role !== 'runner') {
      throw createError(
        ErrorCodes.PERMISSION_DENIED,
        'Only admins and runners can view client lists.',
        ErrorCategories.PERMISSION,
        false
      );
    }

    const {
      search,
      page = 1,
      limit = 20
    } = params || {};

    console.log('[BOT] handleGetClients - Received parameters:', {
      search,
      page,
      limit,
      currentUserRole: user.role
    });

    // Build filter using shared helper
    const filter = buildClientSearchFilter(search);

    // Calculate pagination
    const skip = (page - 1) * limit;
    const validLimit = Math.min(Math.max(1, limit), 100); // Clamp between 1 and 100

    // Query clients
    const clients = await User.find(filter)
      .select('firstName lastName email phone avatarUrl role entity_status createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(validLimit);

    // Get total count for pagination
    const total = await User.countDocuments(filter);
    const totalPages = Math.ceil(total / validLimit);

    console.log('[BOT] handleGetClients - Query result:', {
      clientsFound: clients.length,
      total,
      page,
      totalPages
    });

    // Format clients using shared helper
    const formattedClients = clients.map(formatClientForResponse);

    // Return structured response
    const structuredResponse = formatClientListResponse(
      formattedClients,
      {
        page,
        limit: validLimit,
        total,
        totalPages
      },
      search ? `Found ${total} client${total !== 1 ? 's' : ''} matching "${search}".` : `Found ${total} client${total !== 1 ? 's' : ''}.`
    );

    return {
      success: true,
      data: structuredResponse,
      count: formattedClients.length,
      pagination: {
        page,
        limit: validLimit,
        total,
        totalPages
      }
    };
  } catch (error) {
    console.error('[BOT] Error in handleGetClients:', {
      error: error.message,
      code: error.code,
      category: error.category,
      correlationId
    });

    return {
      success: false,
      error: error.code ? error : createError(
        ErrorCodes.SERVICE_UNAVAILABLE,
        'Failed to retrieve clients',
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
  handleGetLocations,
  handleGetUserProfile,
  handleGetClients,
  handleOpenCreateCOEForClient,
  handleSearchEvents
};

/**
 * Handler: Search Events
 * @param {Object} params - Tool parameters
 * @param {Object} user - Current user object
 * @param {string} correlationId - Correlation ID for tracing
 * @returns {Promise<Object>} Search results
 */
async function handleSearchEvents(params, user, correlationId) {
  try {
    const { extractSearchIntent } = require('./eventSearchIntentService');
    const { searchEvents } = require('./eventSearchService');

    const { query, city, location_name, performer, start_date, end_date } = params;

    console.log('[BOT] handleSearchEvents called:', {
      query,
      provided_params: { city, location_name, performer, start_date, end_date },
      correlationId
    });

    // Extract intent from query if parameters not explicitly provided
    let searchParams = {
      city: city || null,
      location_name: location_name || null,
      performer: performer || null,
      start_date: start_date || null,
      end_date: end_date || null
    };

    // If query is provided and parameters are missing, use AI to extract intent
    if (query && (!city && !location_name && !performer)) {
      console.log('[BOT] Extracting search intent from query:', query);
      const intent = await extractSearchIntent(query, {
        user_tz: user.timezone || 'UTC'
      });

      console.log('[BOT] Extracted intent:', intent);

      if (intent.clarification_needed) {
        return {
          success: false,
          message: intent.clarification_message || 'I need more information to search for events. Could you specify a city, venue, or performer?',
          data: []
        };
      }

      // Merge extracted parameters
      searchParams = {
        city: searchParams.city || intent.city || null,
        location_name: searchParams.location_name || intent.location_name || null,
        performer: searchParams.performer || intent.performer || null,
        start_date: searchParams.start_date || intent.start_date || null,
        end_date: searchParams.end_date || intent.end_date || null
      };
    }

    // Execute search
    const results = await searchEvents(searchParams, {
      limit: 50,
      skip: 0
    });

    // Format response to match EventCard component expectations
    const formattedEvents = results.events.map(event => {
      // Get media - prioritize event media, fallback to location media
      let eventMedia = [];
      if (event.media && Array.isArray(event.media) && event.media.length > 0) {
        eventMedia = event.media.filter(m => m && m.url && m.type === 'image');
      } else if (event.location_id?.media && Array.isArray(event.location_id.media) && event.location_id.media.length > 0) {
        eventMedia = event.location_id.media.filter(m => m && m.url && m.type === 'image');
      }

      return {
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
          city: event.location_id.address?.city,
          country: event.location_id.address?.country,
          address: event.location_id.address || null,
          geo: event.location_id.geo || null,
          media: event.location_id.media || [] // Include location media for EventCard component
        } : null,
        performers: event.performers || [],
        media: eventMedia // Always include media array (event or location media)
      };
    });
    
    console.log('[BOT] handleSearchEvents - Sample formatted event media:', {
      sampleEvent: formattedEvents.length > 0 ? {
        name: formattedEvents[0].name,
        hasMedia: !!formattedEvents[0].media,
        mediaCount: formattedEvents[0].media?.length || 0,
        mediaUrls: formattedEvents[0].media?.map(m => m?.url).filter(Boolean) || [],
        hasLocation: !!formattedEvents[0].location,
        locationMediaCount: formattedEvents[0].location?.media?.length || 0,
        rawEventMedia: results.events[0]?.media,
        rawLocationMedia: results.events[0]?.location_id?.media
      } : null
    });

    // Use formatEventListResponse to ensure proper structure for BotResponseRenderer
    const structuredResponse = formatEventListResponse(
      formattedEvents,
      `Found ${results.total} event(s) matching your search.`
    );

    return {
      success: true,
      data: structuredResponse,
      total: results.total,
      pagination: results.pagination,
      message: `Found ${results.total} event(s) matching your search.`
    };
  } catch (error) {
    console.error('[BOT] handleSearchEvents error:', error);
    return {
      success: false,
      message: `Error searching events: ${error.message}`,
      data: []
    };
  }
}

module.exports = {
  toolHandlers,
  handleGetEventsByDate,
  handleCreateCOEDraft,
  handleUpdateCOE,
  handleGetMyCOEs,
  handleGetCOEDetails,
  handleDeleteCOE,
  handleGetLocations,
  handleGetUserProfile,
  handleGetClients,
  handleOpenCreateCOEForClient,
  handleSearchEvents,
  buildClientSearchFilter,
  formatClientForResponse
};


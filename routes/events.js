const express = require('express');
const router = express.Router();
const Event = require('../models/Event');
const Location = require('../models/Location');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { searchEvents } = require('../services/eventSearchService');
const { extractSearchIntent } = require('../services/eventSearchIntentService');
const { getEventSeatsWithSummaries } = require('../services/eventSeatService');
const { 
  createEventSchema, 
  updateEventSchema, 
  bookSeatSchema, 
  updateAvailabilitySchema 
} = require('../utils/validationSchemas');
const multer = require('multer');
const { enrichEventImageFields } = require('../utils/ensureImageMetadata');
const { uploadMediaWithMetadata } = require('../utils/mediaUploadHelpers');

const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

/**
 * Event Routes
 * @description REST API endpoints for event management
 */

/**
 * GET /v1/events
 * @description Get all events with optional filtering
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      location_id, 
      status, 
      type, 
      start_date, 
      end_date,
      search,
      coe_start_date,
      coe_end_date
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (location_id) filter.location_id = location_id;
    if (status) filter.status = status;
    if (type) filter.type = type;
    
    if (start_date || end_date) {
      filter.start_datetime = {};
      if (start_date) filter.start_datetime.$gte = new Date(start_date);
      if (end_date) filter.start_datetime.$lte = new Date(end_date);
    }
    
    // COE date range filtering - events that overlap with COE date range
    if (coe_start_date && coe_end_date) {
      const coeStartDate = new Date(coe_start_date);
      const coeEndDate = new Date(coe_end_date);
      const now = new Date();
      
      // Events that overlap with COE date range:
      // Event starts before COE ends AND Event ends after COE starts
      filter.$and = [
        { start_datetime: { $lt: coeEndDate } },  // Event starts before COE ends
        { 
          $or: [
            { end_datetime: { $gt: coeStartDate } },  // Event ends after COE starts
            { end_datetime: { $exists: false } },     // Event has no end date
            { end_datetime: null }                    // Event end date is null
          ]
        },
        // Exclude past events when selecting for COE (allow events without end_datetime)
        {
          $or: [
            { end_datetime: { $gte: now } },  // Event hasn't ended yet
            { end_datetime: { $exists: false } },  // Or has no end date
            { end_datetime: null }  // Or end date is null
          ]
        }
      ];
    }
    
    if (search) {
      filter.$text = { $search: search };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Execute query with population
    const events = await Event.find(filter)
      .populate('location_id', 'name type address.city address.country media')
      .populate('created_by', 'firstName lastName email')
      .select('name description type start_datetime end_datetime base_price currency status media seats')
      .sort({ start_datetime: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Inherit media from location if event doesn't have media (only for display purposes)
    events.forEach(event => {
      if ((!event.media || event.media.length === 0) && event.location_id && event.location_id.media) {
        // Create a copy of location media to avoid modifying the original
        event.media = [...event.location_id.media];
      }
    });

    // Get total count for pagination
    const total = await Event.countDocuments(filter);

    res.json({
      success: true,
      data: events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch events',
        details: error.message
      }
    });
  }
});

/**
 * GET /v1/events/search
 * @description Search events using natural language or structured parameters
 * @access Client, Admin, Runner
 */
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const {
      query,           // Natural language query (optional)
      city,            // City name (optional)
      location_name,   // Venue/club name (optional)
      performer,       // Performer name (optional)
      start_date,      // ISO 8601 start date (optional)
      end_date,        // ISO 8601 end date (optional)
      status = 'active',
      page = 1,
      limit = 20
    } = req.query;

    console.log('[EventsRoute] /search called:', {
      query,
      city,
      location_name,
      performer,
      start_date,
      end_date,
      status,
      page,
      limit,
      user_id: req.user._id?.toString()
    });

    // Build search parameters
    let searchParams = {
      city: city || null,
      location_name: location_name || null,
      performer: performer || null,
      start_date: start_date || null,
      end_date: end_date || null,
      status
    };

    // If query is provided, extract intent
    if (query && (!city && !location_name && !performer)) {
      try {
        const intent = await extractSearchIntent(query, {
          user_tz: req.user.timezone || 'UTC'
        });

        if (!intent.clarification_needed) {
          searchParams = {
            city: searchParams.city || intent.city || null,
            location_name: searchParams.location_name || intent.location_name || null,
            performer: searchParams.performer || intent.performer || null,
            start_date: searchParams.start_date || intent.start_date || null,
            end_date: searchParams.end_date || intent.end_date || null,
            status
          };
        } else {
          return res.status(400).json({
            success: false,
            error: {
              message: intent.clarification_message || 'Please provide more specific search criteria.',
              code: 'CLARIFICATION_NEEDED'
            }
          });
        }
      } catch (error) {
        console.error('[EventsRoute] Error extracting search intent:', error);
        // Continue with provided parameters if extraction fails
      }
    }

    // Execute search
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const results = await searchEvents(searchParams, {
      limit: parseInt(limit),
      skip,
      sort: { start_datetime: 1 }
    });

    res.json({
      success: true,
      data: results.events,
      pagination: results.pagination
    });
  } catch (error) {
    console.error('[EventsRoute] Error searching events:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to search events',
        details: error.message
      }
    });
  }
});

/**
 * GET /v1/events/:id/seats
 * @description Get event seats with AI-generated sentiment summaries
 * @access Client, Admin, Runner
 * NOTE: This route must come BEFORE /:id to avoid route conflicts
 */
router.get('/:id/seats', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const availableOnly = req.query.available_only === 'true' || req.query.available_only === '1';
    let excludeClientId = req.query.exclude_client_id?.toString?.() || null;
    if (!excludeClientId && req.user?.role === 'client') {
      excludeClientId = req.user._id?.toString() || null;
    }

    console.log('[EventsRoute] GET /:id/seats called:', {
      eventId: id,
      available_only: availableOnly,
      exclude_client_id: excludeClientId,
      user_id: req.user._id?.toString()
    });

    const result = await getEventSeatsWithSummaries(id, {
      available_only: availableOnly,
      exclude_client_id: excludeClientId || undefined,
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[EventsRoute] Error getting event seats:', error);
    res.status(error.message === 'Event not found' ? 404 : 500).json({
      success: false,
      error: {
        message: error.message || 'Failed to get event seats',
        code: error.message === 'Event not found' ? 'EVENT_NOT_FOUND' : 'SERVER_ERROR'
      }
    });
  }
});

/**
 * GET /v1/events/:id
 * @description Get single event by ID
 */
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id)
      .populate('location_id', 'name type address media seats units')
      .populate('created_by', 'firstName lastName email')
      .populate('updated_by', 'firstName lastName email')
      .populate('approved_by', 'firstName lastName email');

    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Event not found',
          code: 'EVENT_NOT_FOUND'
        }
      });
    }

    // Populate seat media from location seats if event seats don't have media
    if (event.location_id && event.location_id.seats) {
      event.seats = event.seats.map(eventSeat => {
        // Find corresponding location seat
        const locationSeat = event.location_id.seats.find(ls => ls._id.toString() === eventSeat.seat_id.toString());
        if (locationSeat && (!eventSeat.media || eventSeat.media.length === 0)) {
          eventSeat.media = locationSeat.media || [];
        }
        return eventSeat;
      });
    }

    res.json({
      success: true,
      data: event
    });

  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch event',
        details: error.message
      }
    });
  }
});

/**
 * POST /v1/events
 * @description Create new event
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Validate request body
    const { error, value } = createEventSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation error',
          details: error.details[0].message
        }
      });
    }

    console.log('=== EVENT CREATION DEBUG ===');
    console.log('Request body media field:', req.body.media);
    console.log('Validated media field:', value.media);
    console.log('Media array length:', Array.isArray(value.media) ? value.media.length : 'Not an array');

    // Check if location exists
    const location = await Location.findById(value.location_id);
    if (!location) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Location not found',
          code: 'LOCATION_NOT_FOUND'
        }
      });
    }

    // Inherit seats/units from location
    const inheritedSeats = location.seats.map(seat => ({
      seat_id: seat._id,
      code: seat.code,
      label: seat.label,
      category: seat.category,
      section: seat.section,
      capacity: seat.capacity,
      min_spend: seat.minSpendUSD, // Location base price
      price_tier: seat.priceTier,
      event_price: seat.minSpendUSD, // Use location base price as initial event price
      event_min_spend: seat.minSpendUSD, // Use location base price as initial min spend
      status: 'available',
      map_anchor: seat.mapAnchor,
      polygon: seat.polygon,
      media: [],
      gxnItemCode: seat.gxnItemCode,
      gxnMasterItemCode: seat.gxnMasterItemCode
    }));

    const inheritedUnits = location.units.map(unit => ({
      unit_id: unit._id,
      code: unit.code,
      kind: unit.kind,
      beds: unit.beds,
      occupancy: unit.occupancy,
      view: unit.view,
      smoking: unit.smoking,
      floor: unit.floor,
      min_price: unit.minPriceUSD, // Location base price
      event_price: unit.minPriceUSD, // Use location base price as initial event price
      status: 'available',
      media: []
    }));

    // Calculate total capacity
    const totalCapacity = inheritedSeats.reduce((sum, seat) => sum + (seat.capacity || 0), 0) +
                         inheritedUnits.reduce((sum, unit) => sum + (unit.occupancy || 0), 0);

    // Create event
    const eventData = {
      ...value,
      seats: inheritedSeats,
      units: inheritedUnits,
      total_capacity: totalCapacity,
      total_available: totalCapacity,
      total_booked: 0,
      total_revenue: 0,
      created_by: req.user?.id || '507f1f77bcf86cd799439011', // TODO: Get from auth middleware
      views: 0,
      inquiries: 0,
      conversion_rate: 0,
      coe_count: 0,
      is_featured: false,
      priority: 0
    };

    console.log('=== FINAL EVENT DATA ===');
    console.log('Event data media field:', eventData.media);
    console.log('Media type:', typeof eventData.media);
    console.log('Media length:', Array.isArray(eventData.media) ? eventData.media.length : 'Not array');

    const event = new Event(eventData);
    console.log('Event object media field:', event.media);
    
    await event.save();
    console.log('✅ Event saved. Final media field:', event.media);
    console.log('=== END EVENT CREATION DEBUG ===');

    try {
      if (await enrichEventImageFields(event)) {
        event.markModified('media');
        event.markModified('seats');
        event.markModified('units');
        await event.save();
      }
    } catch (enrichErr) {
      console.warn('[events] create enrich metadata:', enrichErr.message);
    }

    // Populate the created event
    const populatedEvent = await Event.findById(event._id)
      .populate('location_id', 'name type address.city address.country')
      .populate('created_by', 'firstName lastName email');

    res.status(201).json({
      success: true,
      data: populatedEvent,
      message: 'Event created successfully'
    });

  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to create event',
        details: error.message
      }
    });
  }
});

/**
 * POST /v1/events/media/upload
 * @description Upload event-specific media asset (image/video) to S3
 */
router.post('/media/upload', authenticateToken, requireAdmin, (req, res, next) => {
  upload.single('asset')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: 'File size too large. Maximum size is 50MB.' }
        });
      }
      return res.status(400).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'File upload error: ' + err.message }
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No file uploaded. Use field name "asset".' }
      });
    }

    const mime = req.file.mimetype || 'application/octet-stream';
    const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'other';
    
    console.log('=== EVENT MEDIA UPLOAD DEBUG ===');
    console.log('File received:', {
      originalName: req.file.originalname,
      mimetype: mime,
      detectedType: type,
      size: req.file.size
    });
    
    if (type === 'other') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_FILE_TYPE', message: 'Only image and video files are allowed.' }
      });
    }

    const userId = req.user._id.toString();
    const data = await uploadMediaWithMetadata(req.file, `events/${userId}`, userId);

    console.log('✅ Event media upload successful:', {
      url: data.url,
      type: data.type,
      detectedFromMime: mime
    });
    console.log('=== END EVENT MEDIA UPLOAD DEBUG ===');

    return res.json({
      success: true,
      data,
      message: 'Event media uploaded successfully'
    });
  } catch (error) {
    console.error('Upload event media error:', { error: error.message, timestamp: new Date().toISOString() });
    return res.status(500).json({
      success: false,
      error: { code: 'MEDIA_UPLOAD_FAILED', message: 'Failed to upload media' }
    });
  }
});

/**
 * PUT /v1/events/:id
 * @description Update event
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate request body
    const { error, value } = updateEventSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation error',
          details: error.details[0].message
        }
      });
    }

    // Check if event exists
    const existingEvent = await Event.findById(id);
    if (!existingEvent) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Event not found',
          code: 'EVENT_NOT_FOUND'
        }
      });
    }

    // Update event
    const updateData = {
      ...value,
      updated_by: req.user?.id || '507f1f77bcf86cd799439011' // TODO: Get from auth middleware
    };

    let event = await Event.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('location_id', 'name type address.city address.country')
      .populate('updated_by', 'firstName lastName email');

    try {
      if (event && (await enrichEventImageFields(event))) {
        event.markModified('media');
        event.markModified('seats');
        event.markModified('units');
        await event.save();
        event = await Event.findById(id)
          .populate('location_id', 'name type address.city address.country')
          .populate('updated_by', 'firstName lastName email');
      }
    } catch (enrichErr) {
      console.warn('[events] update enrich metadata:', enrichErr.message);
    }

    res.json({
      success: true,
      data: event,
      message: 'Event updated successfully'
    });

  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to update event',
        details: error.message
      }
    });
  }
});

/**
 * DELETE /v1/events/:id
 * @description Delete event
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Event not found',
          code: 'EVENT_NOT_FOUND'
        }
      });
    }

    // Check if event has bookings
    const hasBookings = event.seats.some(seat => seat.status === 'booked') ||
                       event.units.some(unit => unit.status === 'booked');

    if (hasBookings) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Cannot delete event with existing bookings',
          code: 'EVENT_HAS_BOOKINGS'
        }
      });
    }

    await Event.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to delete event',
        details: error.message
      }
    });
  }
});

/**
 * GET /v1/events/location/:locationId
 * @description Get events for specific location
 */
router.get('/location/:locationId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { locationId } = req.params;
    const { status, upcoming_only } = req.query;

    // Build filter
    const filter = { location_id: locationId };
    if (status) filter.status = status;
    
    if (upcoming_only === 'true') {
      filter.start_datetime = { $gte: new Date() };
    }

    const events = await Event.find(filter)
      .populate('location_id', 'name type address.city address.country')
      .sort({ start_datetime: 1 });

    res.json({
      success: true,
      data: events
    });

  } catch (error) {
    console.error('Error fetching location events:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch location events',
        details: error.message
      }
    });
  }
});

/**
 * PUT /v1/events/:id/availability
 * @description Update event availability
 */
router.put('/:id/availability', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate request body
    const { error, value } = updateAvailabilitySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation error',
          details: error.details[0].message
        }
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Event not found',
          code: 'EVENT_NOT_FOUND'
        }
      });
    }

    // Update availability
    event.total_available = value.total_available;
    event.total_booked = value.total_booked;
    event.total_revenue = value.total_revenue;
    event.last_availability_check = new Date();
    event.availability_updated_by = req.user?.id || '507f1f77bcf86cd799439011';

    await event.save();

    res.json({
      success: true,
      data: event,
      message: 'Event availability updated successfully'
    });

  } catch (error) {
    console.error('Error updating event availability:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to update event availability',
        details: error.message
      }
    });
  }
});

/**
 * POST /v1/events/:id/seats/:seatId/book
 * @description Book specific seat
 */
router.post('/:id/seats/:seatId/book', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, seatId } = req.params;

    // Validate request body
    const { error, value } = bookSeatSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation error',
          details: error.details[0].message
        }
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Event not found',
          code: 'EVENT_NOT_FOUND'
        }
      });
    }

    // Find the seat
    const seat = event.seats.id(seatId);
    if (!seat) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Seat not found',
          code: 'SEAT_NOT_FOUND'
        }
      });
    }

    // Check if seat is available
    if (seat.status !== 'available') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Seat is not available',
          code: 'SEAT_NOT_AVAILABLE',
          current_status: seat.status
        }
      });
    }

    // Book the seat
    seat.status = 'booked';
    seat.booked_by = value.user_id;
    seat.booked_at = new Date();
    seat.booking_reference = value.booking_reference || null;

    // Update event totals
    event.total_booked += seat.capacity || 0;
    event.total_available -= seat.capacity || 0;
    event.total_revenue += seat.event_price || 0;

    await event.save();

    res.json({
      success: true,
      data: {
        event_id: event._id,
        seat_id: seat._id,
        seat_code: seat.code,
        status: seat.status,
        booked_by: seat.booked_by,
        booked_at: seat.booked_at,
        booking_reference: seat.booking_reference
      },
      message: 'Seat booked successfully'
    });

  } catch (error) {
    console.error('Error booking seat:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to book seat',
        details: error.message
      }
    });
  }
});

/**
 * POST /v1/events/:id/seats/:seatId/release
 * @description Release seat booking
 */
router.post('/:id/seats/:seatId/release', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, seatId } = req.params;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Event not found',
          code: 'EVENT_NOT_FOUND'
        }
      });
    }

    // Find the seat
    const seat = event.seats.id(seatId);
    if (!seat) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Seat not found',
          code: 'SEAT_NOT_FOUND'
        }
      });
    }

    // Check if seat is booked
    if (seat.status !== 'booked') {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Seat is not booked',
          code: 'SEAT_NOT_BOOKED',
          current_status: seat.status
        }
      });
    }

    // Release the seat
    seat.status = 'available';
    seat.booked_by = null;
    seat.booked_at = null;
    seat.booking_reference = null;

    // Update event totals
    event.total_booked -= seat.capacity || 0;
    event.total_available += seat.capacity || 0;
    event.total_revenue -= seat.event_price || 0;

    await event.save();

    res.json({
      success: true,
      data: {
        event_id: event._id,
        seat_id: seat._id,
        seat_code: seat.code,
        status: seat.status
      },
      message: 'Seat released successfully'
    });

  } catch (error) {
    console.error('Error releasing seat:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to release seat',
        details: error.message
      }
    });
  }
});

/**
 * PUT /v1/events/:id/seats/:seatId/status
 * @description Update seat status
 */
router.put('/:id/seats/:seatId/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, seatId } = req.params;
    const { status } = req.body;

    if (!status || !['available', 'held', 'booked', 'blocked'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Invalid status. Must be: available, held, booked, or blocked' }
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        error: { message: 'Event not found' }
      });
    }

    // Find the seat in the event
    const seat = event.seats.find(s => s._id.toString() === seatId);
    if (!seat) {
      return res.status(404).json({
        success: false,
        error: { message: 'Seat not found in this event' }
      });
    }

    // Update seat status
    seat.status = status;
    
    // Clear booking details if status is not booked
    if (status !== 'booked') {
      seat.booked_by = undefined;
      seat.booked_at = undefined;
      seat.booking_reference = undefined;
    }

    await event.save();

    res.json({
      success: true,
      data: {
        message: `Seat ${seat.code} status updated to ${status}`,
        seat: {
          _id: seat._id,
          code: seat.code,
          status: seat.status
        }
      }
    });
  } catch (error) {
    console.error('Error updating seat status:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error' }
    });
  }
});

/**
 * PUT /v1/events/seats/bulk-status
 * @description Update multiple seat statuses in bulk
 */
router.put('/seats/bulk-status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { seatUpdates } = req.body;

    if (!seatUpdates || !Array.isArray(seatUpdates)) {
      return res.status(400).json({
        success: false,
        error: { message: 'seatUpdates array is required' }
      });
    }

    const validStatuses = ['available', 'held', 'booked', 'blocked', 'pending'];
    const results = [];

    for (const update of seatUpdates) {
      const { eventId, seatId, status, bookingReference } = update;

      if (!eventId || !seatId || !status) {
        results.push({
          eventId,
          seatId,
          success: false,
          error: 'Missing required fields: eventId, seatId, status'
        });
        continue;
      }

      if (!validStatuses.includes(status)) {
        results.push({
          eventId,
          seatId,
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
        });
        continue;
      }

      try {
        const event = await Event.findById(eventId);
        if (!event) {
          results.push({
            eventId,
            seatId,
            success: false,
            error: 'Event not found'
          });
          continue;
        }

        const seat = event.seats.find(s => s._id.toString() === seatId);
        if (!seat) {
          results.push({
            eventId,
            seatId,
            success: false,
            error: 'Seat not found in this event'
          });
          continue;
        }

        // Update seat status
        await Event.updateOne(
          { '_id': eventId, 'seats._id': seatId },
          { 
            $set: { 
              'seats.$.status': status,
              'seats.$.booking_reference': bookingReference || undefined,
              'seats.$.booked_at': status === 'booked' || status === 'held' ? new Date() : undefined
            }
          }
        );

        results.push({
          eventId,
          seatId,
          success: true,
          message: `Seat ${seat.code} status updated to ${status}`
        });
      } catch (error) {
        results.push({
          eventId,
          seatId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      data: {
        message: `Updated ${successCount} seats successfully, ${failureCount} failed`,
        results,
        summary: {
          total: seatUpdates.length,
          successful: successCount,
          failed: failureCount
        }
      }
    });
  } catch (error) {
    console.error('Error updating bulk seat statuses:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Internal server error' }
    });
  }
});

/**
 * GET /v1/events/:id/pricing
 * Get event seat pricing (admin only)
 * @access Admin only
 */
router.get('/:id/pricing', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event ID format'
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    // Return seat pricing data
    const seatPricing = event.seats.map(seat => ({
      // Event seat subdocument identifier (used for pricing updates)
      event_seat_id: seat._id,
      // Location seat reference (kept for compatibility with other flows)
      seat_id: seat.seat_id,
      code: seat.code,
      category: seat.category,
      capacity: seat.capacity,
      base_price: seat.min_spend, // Location base price
      event_price: seat.event_price, // Event-specific price
      price_change_reason: seat.price_change_reason || '',
      status: seat.status
    }));

    res.json({
      success: true,
      data: {
        event_id: event._id,
        event_name: event.name,
        seat_pricing: seatPricing
      }
    });
  } catch (error) {
    console.error('Error fetching event pricing:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch event pricing'
    });
  }
});

/**
 * PUT /v1/events/:id/pricing/:seatKey
 * Update a specific seat's price for an event (admin only)
 *
 * `seatKey` is expected to be the event seat subdocument `_id`. For backward compatibility,
 * if it is not a valid ObjectId, it will be interpreted as a seat `code` (first match).
 *
 * @access Admin only
 */
router.put('/:id/pricing/:seatKey', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, seatKey } = req.params;
    const { event_price, price_change_reason } = req.body;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid event ID format'
      });
    }

    if (!event_price || typeof event_price !== 'number' || event_price < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid event_price is required'
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found'
      });
    }

    // Resolve seat either by event seat _id (preferred) or by code (legacy, first match)
    let seat = null;
    const isObjectId = typeof seatKey === 'string' && /^[0-9a-fA-F]{24}$/.test(seatKey);

    if (isObjectId) {
      seat = event.seats.id(seatKey);
    }
    if (!seat) {
      // Fallback for any legacy callers still sending seat code
      seat = event.seats.find(s => s.code === seatKey);
    }

    if (!seat) {
      return res.status(404).json({
        success: false,
        error: 'Seat not found in event'
      });
    }

    // Store previous price for history
    const previousPrice = seat.event_price;

    // Update the seat price
    seat.event_price = event_price;
    seat.price_change_reason = price_change_reason || '';

    await event.save();

    res.json({
      success: true,
      message: 'Seat price updated successfully',
      data: {
        event_id: event._id,
        // Event seat subdocument id used for updates
        seat_id: seat._id,
        // Human-readable code for display/logging
        seat_code: seat.code,
        base_price: seat.min_spend,
        previous_price: previousPrice,
        new_price: event_price,
        price_change_reason: price_change_reason || ''
      }
    });
  } catch (error) {
    console.error('Error updating seat price:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update seat price'
    });
  }
});

module.exports = router;

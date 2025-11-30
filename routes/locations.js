const express = require('express');
const Location = require('../models/Location');
const Event = require('../models/Event');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { createLocationSchema, updateLocationSchema, addSentimentSchema, updateSentimentSchema } = require('../utils/validationSchemas');
const { 
  getLocationEventCount, 
  getLocationEventRevenue, 
  getLocationAnalytics,
  validateLocationCapacity 
} = require('../services/locationEventService');
const { getAllCitiesWithLocations } = require('../services/locationService');
const multer = require('multer');
const { uploadBufferToS3, extFromMime } = require('../utils/s3');
const crypto = require('crypto');

const router = express.Router();
// Increased file size limit to 50MB for media uploads
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

/**
 * GET /v1/locations
 * List locations (admin only for now)
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const q = req.query.q;

    const filter = {};
    if (q) {
      filter.$text = { $search: q };
    }

    const locations = await Location.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await Location.countDocuments(filter);

    res.json({
      success: true,
      data: locations,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      message: 'Locations retrieved successfully'
    });
  } catch (error) {
    console.error('Get locations error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ success: false, error: { code: 'LOCATIONS_LIST_FAILED', message: 'Failed to retrieve locations' } });
  }
});

/**
 * GET /v1/locations/cities
 * Get all unique cities that have locations
 */
router.get('/cities', authenticateToken, async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    console.log('[GET /v1/locations/cities] Request received:', { status, query: req.query });
    
    const cities = await getAllCitiesWithLocations({ 
      status: status || 'active' 
    });
    
    console.log('[GET /v1/locations/cities] Cities retrieved:', { 
      count: cities.length, 
      cities: cities 
    });
    
    res.json({
      success: true,
      data: cities,
      count: cities.length,
      message: 'Cities retrieved successfully'
    });
  } catch (error) {
    console.error('Get cities error:', { error: error.message, stack: error.stack, timestamp: new Date().toISOString() });
    res.status(500).json({ 
      success: false, 
      error: { 
        code: 'CITIES_LIST_FAILED', 
        message: 'Failed to retrieve cities' 
      } 
    });
  }
});

/**
 * GET /v1/locations/:id
 */
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const loc = await Location.findById(req.params.id);
    if (!loc) {
      return res.status(404).json({ success: false, error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } });
    }
    res.json({ success: true, data: loc, message: 'Location retrieved successfully' });
  } catch (error) {
    console.error('Get location error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ success: false, error: { code: 'LOCATION_GET_FAILED', message: 'Failed to retrieve location' } });
  }
});

/**
 * POST /v1/locations
 * Create new location (admin only)
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = createLocationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    }

    const loc = await Location.create({ ...value, createdBy: req.user._id, updatedBy: req.user._id });
    res.status(201).json({ success: true, data: loc, message: 'Location created successfully' });
  } catch (error) {
    console.error('Create location error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ success: false, error: { code: 'LOCATION_CREATE_FAILED', message: 'Failed to create location' } });
  }
});

/**
 * PUT /v1/locations/:id
 * Update location (admin only)
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = updateLocationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
    }

    // Fetch existing location to preserve arrays that aren't in update
    const existingLocation = await Location.findById(req.params.id);
    if (!existingLocation) {
      return res.status(404).json({ success: false, error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } });
    }

    // Build update object, preserving seats and media if not provided in update
    const updateData = { ...value, updatedBy: req.user._id };
    
    // Preserve existing seats array if not provided in update payload
    if (!value.hasOwnProperty('seats') || value.seats === undefined) {
      updateData.seats = existingLocation.seats;
    }
    
    // Preserve existing media array if not provided in update payload
    if (!value.hasOwnProperty('media') || value.media === undefined) {
      updateData.media = existingLocation.media;
    }
    
    // Preserve existing units array if not provided in update payload
    if (!value.hasOwnProperty('units') || value.units === undefined) {
      updateData.units = existingLocation.units;
    }

    const loc = await Location.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!loc) {
      return res.status(404).json({ success: false, error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } });
    }
    res.json({ success: true, data: loc, message: 'Location updated successfully' });
  } catch (error) {
    console.error('Update location error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ success: false, error: { code: 'LOCATION_UPDATE_FAILED', message: 'Failed to update location' } });
  }
});

/**
 * DELETE /v1/locations/:id
 * Delete location (admin only)
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } 
      });
    }

    await Location.findByIdAndDelete(req.params.id);
    
    res.json({ 
      success: true, 
      message: 'Location deleted successfully' 
    });
  } catch (error) {
    console.error('Delete location error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ 
      success: false, 
      error: { code: 'LOCATION_DELETE_FAILED', message: 'Failed to delete location' } 
    });
  }
});

/**
 * POST /v1/locations/media/upload
 * Admin uploads a media asset (image/video) for locations to S3, returns URL
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
        error: { code: 'NO_FILE', message: 'No file uploaded. Field name must be "asset".' } 
      });
    }

    const mime = req.file.mimetype || 'application/octet-stream';
    const type = mime.startsWith('image/') ? 'image' : (mime.startsWith('video/') ? 'video' : 'other');
    
    console.log('Upload debug:', {
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

    const ext = extFromMime(mime);
    const userId = req.user._id.toString();
    const hash = crypto.createHash('sha256').update(userId + Date.now().toString()).digest('hex').slice(0, 16);
    const key = `locations/${userId}/${hash}.${ext}`; // Store under locations/userId/

    const url = await uploadBufferToS3(req.file.buffer, key, mime);

    console.log('Upload response:', {
      url: url,
      type: type,
      detectedFromMime: mime
    });

    return res.json({
      success: true,
      data: { url, type },
      message: 'Media uploaded successfully'
    });
  } catch (error) {
    console.error('Upload location media error:', { error: error.message, timestamp: new Date().toISOString() });
    return res.status(500).json({
      success: false,
      error: { code: 'MEDIA_UPLOAD_FAILED', message: 'Failed to upload media' }
    });
  }
});

/**
 * POST /v1/locations/:id/sentiment
 * Add sentiment to location
 */
router.post('/:id/sentiment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = addSentimentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'VALIDATION_ERROR', message: error.details[0].message } 
      });
    }

    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } 
      });
    }

    const newSentiment = {
      ...value,
      updatedBy: req.user._id,
      updatedAt: new Date()
    };

    location.sentiment.push(newSentiment);
    location.updatedBy = req.user._id;
    await location.save();

    res.status(201).json({ 
      success: true, 
      data: newSentiment, 
      message: 'Sentiment added successfully' 
    });
  } catch (error) {
    console.error('Add location sentiment error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ 
      success: false, 
      error: { code: 'SENTIMENT_ADD_FAILED', message: 'Failed to add sentiment' } 
    });
  }
});

/**
 * POST /v1/locations/:id/seats/:seatCode/sentiment
 * Add sentiment to seat
 */
router.post('/:id/seats/:seatCode/sentiment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = addSentimentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'VALIDATION_ERROR', message: error.details[0].message } 
      });
    }

    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } 
      });
    }

    // Try to find seat by _id first (more reliable), then fallback to code
    let seat = location.seats.find(s => s._id && s._id.toString() === req.params.seatCode);
    if (!seat) {
      // Fallback to code for backward compatibility
      seat = location.seats.find(s => s.code === req.params.seatCode);
    }
    if (!seat) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'SEAT_NOT_FOUND', message: 'Seat not found' } 
      });
    }

    const newSentiment = {
      ...value,
      updatedBy: req.user._id,
      updatedAt: new Date()
    };

    seat.sentiment.push(newSentiment);
    location.updatedBy = req.user._id;
    await location.save();

    res.status(201).json({ 
      success: true, 
      data: newSentiment, 
      message: 'Seat sentiment added successfully' 
    });
  } catch (error) {
    console.error('Add seat sentiment error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ 
      success: false, 
      error: { code: 'SEAT_SENTIMENT_ADD_FAILED', message: 'Failed to add seat sentiment' } 
    });
  }
});

/**
 * POST /v1/locations/:id/units/:unitCode/sentiment
 * Add sentiment to unit
 */
router.post('/:id/units/:unitCode/sentiment', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = addSentimentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'VALIDATION_ERROR', message: error.details[0].message } 
      });
    }

    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } 
      });
    }

    const unit = location.units.find(u => u.code === req.params.unitCode);
    if (!unit) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'UNIT_NOT_FOUND', message: 'Unit not found' } 
      });
    }

    const newSentiment = {
      ...value,
      updatedBy: req.user._id,
      updatedAt: new Date()
    };

    unit.sentiment.push(newSentiment);
    location.updatedBy = req.user._id;
    await location.save();

    res.status(201).json({ 
      success: true, 
      data: newSentiment, 
      message: 'Unit sentiment added successfully' 
    });
  } catch (error) {
    console.error('Add unit sentiment error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ 
      success: false, 
      error: { code: 'UNIT_SENTIMENT_ADD_FAILED', message: 'Failed to add unit sentiment' } 
    });
  }
});

/**
 * DELETE /v1/locations/:id/sentiment/:index
 * Delete sentiment from location by index
 */
router.delete('/:id/sentiment/:index', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } 
      });
    }

    const index = parseInt(req.params.index);
    if (index < 0 || index >= location.sentiment.length) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'INVALID_INDEX', message: 'Invalid sentiment index' } 
      });
    }

    location.sentiment.splice(index, 1);
    location.updatedBy = req.user._id;
    await location.save();

    res.json({ 
      success: true, 
      message: 'Location sentiment deleted successfully' 
    });
  } catch (error) {
    console.error('Delete location sentiment error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ 
      success: false, 
      error: { code: 'SENTIMENT_DELETE_FAILED', message: 'Failed to delete location sentiment' } 
    });
  }
});

/**
 * DELETE /v1/locations/:id/seats/:seatCode/sentiment/:index
 * Delete sentiment from seat by index
 */
router.delete('/:id/seats/:seatCode/sentiment/:index', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } 
      });
    }

    // Try to find seat by _id first (more reliable), then fallback to code
    let seat = location.seats.find(s => s._id && s._id.toString() === req.params.seatCode);
    if (!seat) {
      // Fallback to code for backward compatibility
      seat = location.seats.find(s => s.code === req.params.seatCode);
    }
    if (!seat) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'SEAT_NOT_FOUND', message: 'Seat not found' } 
      });
    }

    const index = parseInt(req.params.index);
    if (index < 0 || index >= (seat.sentiment?.length || 0)) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'INVALID_INDEX', message: 'Invalid sentiment index' } 
      });
    }

    seat.sentiment.splice(index, 1);
    location.updatedBy = req.user._id;
    await location.save();

    res.json({ 
      success: true, 
      message: 'Seat sentiment deleted successfully' 
    });
  } catch (error) {
    console.error('Delete seat sentiment error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ 
      success: false, 
      error: { code: 'SEAT_SENTIMENT_DELETE_FAILED', message: 'Failed to delete seat sentiment' } 
    });
  }
});

/**
 * DELETE /v1/locations/:id/units/:unitCode/sentiment/:index
 * Delete sentiment from unit by index
 */
router.delete('/:id/units/:unitCode/sentiment/:index', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const location = await Location.findById(req.params.id);
    if (!location) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'LOCATION_NOT_FOUND', message: 'Location not found' } 
      });
    }

    const unit = location.units.find(u => u.code === req.params.unitCode);
    if (!unit) {
      return res.status(404).json({ 
        success: false, 
        error: { code: 'UNIT_NOT_FOUND', message: 'Unit not found' } 
      });
    }

    const index = parseInt(req.params.index);
    if (index < 0 || index >= (unit.sentiment?.length || 0)) {
      return res.status(400).json({ 
        success: false, 
        error: { code: 'INVALID_INDEX', message: 'Invalid sentiment index' } 
      });
    }

    unit.sentiment.splice(index, 1);
    location.updatedBy = req.user._id;
    await location.save();

    res.json({ 
      success: true, 
      message: 'Unit sentiment deleted successfully' 
    });
  } catch (error) {
    console.error('Delete unit sentiment error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({ 
      success: false, 
      error: { code: 'UNIT_SENTIMENT_DELETE_FAILED', message: 'Failed to delete unit sentiment' } 
    });
  }
});

/**
 * GET /v1/locations/:id/events
 * @description Get all events for a specific location
 */
router.get('/:id/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, upcoming_only, page = 1, limit = 20 } = req.query;

    // Check if location exists
    const location = await Location.findById(id);
    if (!location) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Location not found',
          code: 'LOCATION_NOT_FOUND'
        }
      });
    }

    // Build filter
    const filter = { location_id: id };
    if (status) filter.status = status;
    
    if (upcoming_only === 'true') {
      filter.start_datetime = { $gte: new Date() };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query
    const events = await Event.find(filter)
      .populate('created_by', 'firstName lastName email')
      .sort({ start_datetime: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Event.countDocuments(filter);

    res.json({
      success: true,
      data: events,
      location: {
        id: location._id,
        name: location.name,
        type: location.type
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
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
 * GET /v1/locations/:id/events/active
 * @description Get active events for a specific location
 */
router.get('/:id/events/active', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const events = await Event.find({
      location_id: id,
      status: 'active'
    })
    .populate('created_by', 'firstName lastName email')
    .sort({ start_datetime: 1 });

    res.json({
      success: true,
      data: events
    });

  } catch (error) {
    console.error('Error fetching active location events:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch active location events',
        details: error.message
      }
    });
  }
});

/**
 * GET /v1/locations/:id/events/upcoming
 * @description Get upcoming events for a specific location
 */
router.get('/:id/events/upcoming', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const events = await Event.find({
      location_id: id,
      status: 'active',
      start_datetime: { $gte: new Date() }
    })
    .populate('created_by', 'firstName lastName email')
    .sort({ start_datetime: 1 });

    res.json({
      success: true,
      data: events
    });

  } catch (error) {
    console.error('Error fetching upcoming location events:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch upcoming location events',
        details: error.message
      }
    });
  }
});

/**
 * GET /v1/locations/:id/events/analytics
 * @description Get location event analytics
 */
router.get('/:id/events/analytics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date } = req.query;

    // Check if location exists
    const location = await Location.findById(id);
    if (!location) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Location not found',
          code: 'LOCATION_NOT_FOUND'
        }
      });
    }

    // Get analytics
    const analytics = await getLocationAnalytics(id);

    // Get revenue analytics with date filter if provided
    const startDate = start_date ? new Date(start_date) : null;
    const endDate = end_date ? new Date(end_date) : null;
    const revenueAnalytics = await getLocationEventRevenue(id, startDate, endDate);

    res.json({
      success: true,
      data: {
        ...analytics,
        revenue_analytics: revenueAnalytics
      }
    });

  } catch (error) {
    console.error('Error fetching location event analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch location event analytics',
        details: error.message
      }
    });
  }
});

/**
 * POST /v1/locations/:id/events/validate
 * @description Validate if location can support new event
 */
router.post('/:id/events/validate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { requested_capacity, start_date, end_date } = req.body;

    // Validate required fields
    if (!requested_capacity || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Missing required fields: requested_capacity, start_date, end_date',
          code: 'MISSING_REQUIRED_FIELDS'
        }
      });
    }

    // Check if location exists
    const location = await Location.findById(id);
    if (!location) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Location not found',
          code: 'LOCATION_NOT_FOUND'
        }
      });
    }

    // Validate capacity
    const validation = await validateLocationCapacity(
      id, 
      parseInt(requested_capacity), 
      new Date(start_date), 
      new Date(end_date)
    );

    res.json({
      success: true,
      data: validation,
      message: validation.validation_passed ? 
        'Location can accommodate the event' : 
        'Location cannot accommodate the event'
    });

  } catch (error) {
    console.error('Error validating location capacity:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to validate location capacity',
        details: error.message
      }
    });
  }
});

/**
 * GET /v1/locations/:id/events/count
 * @description Get event count for location
 */
router.get('/:id/events/count', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query;

    // Check if location exists
    const location = await Location.findById(id);
    if (!location) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Location not found',
          code: 'LOCATION_NOT_FOUND'
        }
      });
    }

    // Get event count
    const eventCount = await getLocationEventCount(id, status);

    res.json({
      success: true,
      data: eventCount
    });

  } catch (error) {
    console.error('Error fetching location event count:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch location event count',
        details: error.message
      }
    });
  }
});

/**
 * GET /v1/locations/:id/events/revenue
 * @description Get event revenue for location
 */
router.get('/:id/events/revenue', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date } = req.query;

    // Check if location exists
    const location = await Location.findById(id);
    if (!location) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Location not found',
          code: 'LOCATION_NOT_FOUND'
        }
      });
    }

    // Get revenue analytics
    const startDate = start_date ? new Date(start_date) : null;
    const endDate = end_date ? new Date(end_date) : null;
    const revenueAnalytics = await getLocationEventRevenue(id, startDate, endDate);

    res.json({
      success: true,
      data: revenueAnalytics
    });

  } catch (error) {
    console.error('Error fetching location event revenue:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch location event revenue',
        details: error.message
      }
    });
  }
});

module.exports = router;
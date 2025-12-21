const express = require('express');
const router = express.Router();
const COE = require('../models/COE');
const coeService = require('../services/coeService');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');
const {
  createCOESchema,
  updateCOESchema,
  addEventToCOESchema,
  updateCOEStatusSchema,
  assignRunnerToCOESchema,
  updateSeatAssignmentsSchema
} = require('../utils/validationSchemas');

/**
 * COE Routes
 * @description API endpoints for COE management
 */

/**
 * GET /v1/coes/my
 * Get COEs associated with the current user
 * @access Authenticated users
 */
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Event = require('../models/Event');
    const userId = req.user.id;
    
    // Get COEs where user is admin, client, runner, or participant
    const coes = await COE.find({
      $or: [
        { admin_id: userId },
        { client_id: userId },
        { 'runner_assignment.runner_id': userId },
        { 'participants.user_id': userId }
      ]
    })
    .populate('admin_id', 'name email')
    .populate('client_id', 'name')
    .populate({
      path: 'events.event_id',
      select: 'name description start_datetime end_datetime location_id media',
      populate: {
        path: 'location_id',
        select: 'name type media'
      }
    })
    .sort({ created_at: -1 });

    // Manual population fallback for events that weren't populated
    // This ensures events replaced via updateOne are properly populated
    for (const coe of coes) {
      if (coe.events && Array.isArray(coe.events)) {
        for (let i = 0; i < coe.events.length; i++) {
          const eventItem = coe.events[i];
          if (eventItem.event_id) {
            // Check if event_id is not populated (it's an ObjectId or string, not an object with name)
            const isPopulated = eventItem.event_id && 
                               typeof eventItem.event_id === 'object' && 
                               eventItem.event_id.name !== undefined;
            
            if (!isPopulated) {
              // Extract the event ID (could be ObjectId, string, or object with _id)
              let eventIdValue;
              if (eventItem.event_id._id) {
                eventIdValue = eventItem.event_id._id;
              } else if (eventItem.event_id instanceof mongoose.Types.ObjectId) {
                eventIdValue = eventItem.event_id;
              } else if (typeof eventItem.event_id === 'string') {
                eventIdValue = eventItem.event_id;
              } else {
                eventIdValue = eventItem.event_id;
              }
              
              try {
                const populatedEvent = await Event.findById(eventIdValue)
                  .populate('location_id', 'name type media')
                  .select('name description location_id start_datetime end_datetime media');
                if (populatedEvent) {
                  eventItem.event_id = populatedEvent;
                  console.log('[GET /coes/my] Manually populated event:', populatedEvent.name, 'for COE:', coe._id);
                } else {
                  console.warn('[GET /coes/my] Event not found for manual population:', eventIdValue, 'in COE:', coe._id);
                }
              } catch (populateError) {
                console.warn('[GET /coes/my] Failed to manually populate event:', populateError.message, 'for event_id:', eventIdValue, 'in COE:', coe._id);
              }
            }
          }
        }
      }
    }

    res.json({
      success: true,
      data: coes
    });
  } catch (error) {
    console.error('Error fetching user COEs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user COEs'
    });
  }
});

/**
 * GET /v1/coes
 * Get all COEs with filtering and pagination
 * @access Admin only
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      status,
      client_id,
      admin_id,
      runner_id,
      created_method,
      start_date,
      end_date,
      page = 1,
      limit = 10,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const filters = {
      status,
      client_id,
      admin_id,
      runner_id,
      created_method,
      start_date,
      end_date
    };

    const pagination = {
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy,
      sortOrder
    };

    const result = await coeService.getCOEs(filters, pagination);

    res.json({
      success: true,
      data: result.coes,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Error getting COEs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get COEs',
      error: error.message
    });
  }
});

/**
 * GET /v1/coes/statistics
 * Get COE statistics
 * @access Admin only
 */
router.get('/statistics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const statistics = await coeService.getCOEStatistics();

    res.json({
      success: true,
      data: statistics
    });
  } catch (error) {
    console.error('Error getting COE statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get COE statistics',
      error: error.message
    });
  }
});

/**
 * GET /v1/coes/client/:clientId
 * Get COEs for a specific client
 * @access Admin only
 */
router.get('/client/:clientId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;

    if (!clientId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid client ID format'
      });
    }

    const coes = await coeService.getCOEsByClient(clientId);

    res.json({
      success: true,
      data: coes
    });
  } catch (error) {
    console.error('Error getting COEs by client:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get client COEs',
      error: error.message
    });
  }
});

/**
 * GET /v1/coes/runner/:runnerId
 * Get COEs assigned to a specific runner
 * @access Admin only
 */
router.get('/runner/:runnerId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { runnerId } = req.params;

    if (!runnerId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid runner ID format'
      });
    }

    const coes = await coeService.getCOEsByRunner(runnerId);

    res.json({
      success: true,
      data: coes
    });
  } catch (error) {
    console.error('Error getting COEs by runner:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get runner COEs',
      error: error.message
    });
  }
});

/**
 * GET /v1/coes/my/:id
 * Get COE by ID for current user (if they have access)
 * @access Authenticated users
 */
router.get('/my/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid COE ID format'
      });
    }

    // Use getCOEById for consistent population (same as other endpoints)
    // First verify user has access
    const coeCheck = await COE.findOne({
      _id: id,
      $or: [
        { admin_id: userId },
        { client_id: userId },
        { 'runner_assignment.runner_id': userId },
        { 'participants.user_id': userId }
      ]
    }).select('_id');
    
    if (!coeCheck) {
      return res.status(404).json({
        success: false,
        error: 'COE not found or access denied'
      });
    }
    
    // Fetch COE with lean() to get plain object and avoid Mongoose serialization issues
    let coe;
    try {
      // Use lean() directly to avoid Mongoose document serialization issues
      coe = await COE.findById(id)
        .lean()
        .populate('client_id', 'firstName lastName email phone')
        .populate('admin_id', 'firstName lastName email')
        .populate('created_by', 'firstName lastName email')
        .populate('participants.user_id', 'firstName lastName email phone')
        .populate('runner_assignment.runner_id', 'firstName lastName email phone avatarUrl')
        .populate({
          path: 'events.event_id',
          select: 'name description location_id start_datetime end_datetime base_price currency status media seats',
          populate: [
            {
              path: 'location_id',
              select: 'name type media seats'
            }
          ]
        })
        .populate('events.runner_assignment.runner_id', 'firstName lastName email phone avatarUrl');
    } catch (getError) {
      console.error('[GET /coes/my/:id] Error fetching COE:', getError);
      console.error('[GET /coes/my/:id] Error stack:', getError.stack);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch COE',
        details: process.env.NODE_ENV === 'development' ? getError.message : undefined
      });
    }

    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found or access denied'
      });
    }

    // Manual population fallback for events (if needed)
    if (coe.events && Array.isArray(coe.events)) {
      const Event = require('../models/Event');
      for (let i = 0; i < coe.events.length; i++) {
        const eventItem = coe.events[i];
        if (eventItem.event_id && typeof eventItem.event_id === 'string') {
          try {
            const populatedEvent = await Event.findById(eventItem.event_id)
              .lean()
              .populate('location_id', 'name type media seats')
              .select('name description location_id start_datetime end_datetime base_price currency status media seats');
            if (populatedEvent) {
              coe.events[i].event_id = populatedEvent;
            }
          } catch (populateError) {
            console.warn('[GET /coes/my/:id] Failed to populate event:', populateError.message);
          }
        }
      }
    }

    // Enhance selected_seats with media from event/location seats (dashboard logic)
    if (coe.selected_seats && Array.isArray(coe.selected_seats) && coe.events && Array.isArray(coe.events)) {
      console.log('[GET /coes/my/:id] Enhancing selected_seats with media. Seats count:', coe.selected_seats.length, 'Events count:', coe.events.length);
      
      coe.selected_seats = coe.selected_seats.map(selectedSeat => {
        // Find the event this seat belongs to
        const eventItem = coe.events.find(e => {
          const eventId = e.event_id?._id?.toString() || e.event_id?.toString() || e.event_id;
          const seatEventId = selectedSeat.event_id?.toString() || selectedSeat.event_id;
          return eventId === seatEventId;
        });

        if (eventItem && eventItem.event_id) {
          const event = eventItem.event_id;
          const selectedSeatId = selectedSeat.seat_id?.toString() || selectedSeat.seat_id; // This is the location seat ID
          
          console.log('[GET /coes/my/:id] Processing seat:', {
            seat_code: selectedSeat.seat_code,
            selected_seat_id: selectedSeatId, // Location seat ID
            event_name: event.name,
            event_seats_count: event.seats?.length || 0,
            location_seats_count: event.location_id?.seats?.length || 0,
          });
          
          // First try event seats - match by _id (event seat ID), same as dashboard
          if (event.seats && Array.isArray(event.seats)) {
            const eventSeat = event.seats.find(s => {
              // Match: selectedSeat.seat_id === event.seats[]._id (event seat ID) - same as dashboard
              const eventSeatId = s._id?.toString() || s._id;
              return eventSeatId === selectedSeatId || s.code === selectedSeat.seat_code;
            });
            
            if (eventSeat) {
              console.log('[GET /coes/my/:id] Found event seat:', {
                event_seat_id: eventSeat._id?.toString(),
                event_seat_seat_id: eventSeat.seat_id?.toString(), // Location seat reference (for fallback)
                seat_code: eventSeat.code,
                hasMedia: !!(eventSeat.media && eventSeat.media.length > 0),
                mediaCount: eventSeat.media?.length || 0,
                imageCount: eventSeat.media?.filter(m => m && m.type === 'image').length || 0,
              });
              
              if (eventSeat.media && Array.isArray(eventSeat.media) && eventSeat.media.length > 0) {
                console.log('[GET /coes/my/:id] ✅ Added media from event seat');
                return { ...selectedSeat, media: eventSeat.media };
              }
              
              // If event seat has no media, use its seat_id to find location seat
              const locationSeatRefId = eventSeat.seat_id?.toString() || eventSeat.seat_id;
              if (locationSeatRefId && event.location_id && event.location_id.seats && Array.isArray(event.location_id.seats)) {
                const locationSeat = event.location_id.seats.find(s => {
                  const locationSeatId = s._id?.toString() || s._id;
                  return locationSeatId === locationSeatRefId;
                });
                
                if (locationSeat) {
                  console.log('[GET /coes/my/:id] Found location seat via event seat.seat_id:', {
                    location_seat_id: locationSeat._id?.toString(),
                    seat_code: locationSeat.code,
                    hasMedia: !!(locationSeat.media && locationSeat.media.length > 0),
                    mediaCount: locationSeat.media?.length || 0,
                    imageCount: locationSeat.media?.filter(m => m && m.type === 'image').length || 0,
                  });
                  
                  if (locationSeat.media && Array.isArray(locationSeat.media) && locationSeat.media.length > 0) {
                    // Check if location seat has images
                    const imageMedia = locationSeat.media.filter(m => m && m.type === 'image');
                    if (imageMedia.length > 0) {
                      console.log('[GET /coes/my/:id] ✅ Added images from location seat');
                      return { ...selectedSeat, media: imageMedia };
                    } else {
                      // Location seat only has videos, fallback to location media
                      if (event.location_id && event.location_id.media && Array.isArray(event.location_id.media)) {
                        const locationImageMedia = event.location_id.media.filter(m => m && m.type === 'image');
                        if (locationImageMedia.length > 0) {
                          console.log('[GET /coes/my/:id] ✅ Added images from location media (fallback)');
                          return { ...selectedSeat, media: locationImageMedia };
                        }
                      }
                      // If no images anywhere, use all media from location seat
                      console.log('[GET /coes/my/:id] ⚠️ Only videos found, using location seat media');
                      return { ...selectedSeat, media: locationSeat.media };
                    }
                  } else {
                    // Location seat has no media, try location media
                    if (event.location_id && event.location_id.media && Array.isArray(event.location_id.media)) {
                      const locationImageMedia = event.location_id.media.filter(m => m && m.type === 'image');
                      if (locationImageMedia.length > 0) {
                        console.log('[GET /coes/my/:id] ✅ Added images from location media (location seat has no media)');
                        return { ...selectedSeat, media: locationImageMedia };
                      }
                    }
                  }
                }
              }
            }
            
            // Fallback: Direct match with location seats using selectedSeat.seat_id
            if (event.location_id && event.location_id.seats && Array.isArray(event.location_id.seats)) {
              const locationSeat = event.location_id.seats.find(s => {
                const locationSeatId = s._id?.toString() || s._id;
                return locationSeatId === selectedSeatId || s.code === selectedSeat.seat_code;
              });
              
              if (locationSeat) {
                console.log('[GET /coes/my/:id] Found location seat (direct match):', {
                  location_seat_id: locationSeat._id?.toString(),
                  seat_code: locationSeat.code,
                  hasMedia: !!(locationSeat.media && locationSeat.media.length > 0),
                  mediaCount: locationSeat.media?.length || 0,
                  imageCount: locationSeat.media?.filter(m => m && m.type === 'image').length || 0,
                });
                
                if (locationSeat.media && Array.isArray(locationSeat.media) && locationSeat.media.length > 0) {
                  const imageMedia = locationSeat.media.filter(m => m && m.type === 'image');
                  if (imageMedia.length > 0) {
                    console.log('[GET /coes/my/:id] ✅ Added images from location seat (direct)');
                    return { ...selectedSeat, media: imageMedia };
                  } else {
                    // Location seat only has videos, fallback to location media
                    if (event.location_id && event.location_id.media && Array.isArray(event.location_id.media)) {
                      const locationImageMedia = event.location_id.media.filter(m => m && m.type === 'image');
                      if (locationImageMedia.length > 0) {
                        console.log('[GET /coes/my/:id] ✅ Added images from location media (direct fallback)');
                        return { ...selectedSeat, media: locationImageMedia };
                      }
                    }
                  }
                } else {
                  // Location seat has no media, try location media
                  if (event.location_id && event.location_id.media && Array.isArray(event.location_id.media)) {
                    const locationImageMedia = event.location_id.media.filter(m => m && m.type === 'image');
                    if (locationImageMedia.length > 0) {
                      console.log('[GET /coes/my/:id] ✅ Added images from location media (direct, no seat media)');
                      return { ...selectedSeat, media: locationImageMedia };
                    }
                  }
                }
              } else {
                // No location seat found, try location media directly
                if (event.location_id && event.location_id.media && Array.isArray(event.location_id.media)) {
                  const locationImageMedia = event.location_id.media.filter(m => m && m.type === 'image');
                  if (locationImageMedia.length > 0) {
                    console.log('[GET /coes/my/:id] ✅ Added images from location media (no matching seat)');
                    return { ...selectedSeat, media: locationImageMedia };
                  }
                }
              }
            }
          }
        } else {
          console.log('[GET /coes/my/:id] ❌ No matching event found for seat:', {
            seat_code: selectedSeat.seat_code,
            seat_event_id: selectedSeat.event_id,
          });
        }
        
        return selectedSeat;
      });
      
      // Log final result
      const seatsWithMedia = coe.selected_seats.filter(s => s.media && s.media.length > 0);
      console.log('[GET /coes/my/:id] Enhancement complete. Seats with media:', seatsWithMedia.length, 'out of', coe.selected_seats.length);
    }

    res.json({
      success: true,
      data: coe
    });
  } catch (error) {
    console.error('[GET /coes/my/:id] Unexpected error:', error);
    console.error('[GET /coes/my/:id] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch COE',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /v1/coes/:id
 * Get COE by ID
 * @access Admin only
 */
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    const coe = await coeService.getCOEById(id);

    res.json({
      success: true,
      data: coe
    });
  } catch (error) {
    console.error('Error getting COE:', error);
    if (error.message === 'COE not found') {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to get COE',
      error: error.message
    });
  }
});

/**
 * POST /v1/coes
 * Create new COE
 * @access Admin only
 */
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Validate request data
    const { error, value } = createCOESchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const coe = await coeService.createCOE(value, req.user.id);

    res.status(201).json({
      success: true,
      message: 'COE created successfully',
      data: coe
    });
  } catch (error) {
    console.error('Error creating COE:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create COE',
      error: error.message
    });
  }
});

/**
 * PUT /v1/coes/:id
 * Update COE
 * @access Admin only
 */
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    // Validate request data
    const { error, value } = updateCOESchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const coe = await coeService.updateCOE(id, value);

    res.json({
      success: true,
      message: 'COE updated successfully',
      data: coe
    });
  } catch (error) {
    console.error('Error updating COE:', error);
    if (error.message === 'COE not found') {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update COE',
      error: error.message
    });
  }
});

/**
 * DELETE /v1/coes/:id
 * Delete COE
 * @access Admin only
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    await coeService.deleteCOE(id);

    res.json({
      success: true,
      message: 'COE deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting COE:', error);
    if (error.message === 'COE not found') {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to delete COE',
      error: error.message
    });
  }
});

/**
 * POST /v1/coes/:id/events
 * Add event to COE
 * @access Admin only
 */
router.post('/:id/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    // Validate request data
    const { error, value } = addEventToCOESchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const coe = await coeService.addEventToCOE(id, value);

    res.json({
      success: true,
      message: 'Event added to COE successfully',
      data: coe
    });
  } catch (error) {
    console.error('Error adding event to COE:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to add event to COE',
      error: error.message
    });
  }
});

/**
 * DELETE /v1/coes/:id/events/:eventId
 * Remove event from COE
 * @access Admin only
 */
router.delete('/:id/events/:eventId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id, eventId } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/) || !eventId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format'
      });
    }

    const coe = await coeService.removeEventFromCOE(id, eventId);

    res.json({
      success: true,
      message: 'Event removed from COE successfully',
      data: coe
    });
  } catch (error) {
    console.error('Error removing event from COE:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to remove event from COE',
      error: error.message
    });
  }
});

/**
 * PUT /v1/coes/:id/status
 * Update COE status
 * @access Admin only
 */
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    // Validate request data
    const { error, value } = updateCOEStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const coe = await coeService.updateCOEStatus(id, value.status, req.user.id);

    res.json({
      success: true,
      message: 'COE status updated successfully',
      data: coe
    });
  } catch (error) {
    console.error('Error updating COE status:', error);
    if (error.message === 'COE not found') {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    if (error.message.includes('Invalid status transition')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update COE status',
      error: error.message
    });
  }
});

/**
 * POST /v1/coes/:id/runners
 * Assign runner to COE
 * @access Admin only
 */
router.post('/:id/runners', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    // Validate request data
    const { error, value } = assignRunnerToCOESchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const coe = await coeService.assignRunnerToCOE(id, value, req.user.id);

    res.json({
      success: true,
      message: 'Runner assigned to COE successfully',
      data: coe
    });
  } catch (error) {
    console.error('Error assigning runner to COE:', error);
    if (error.message === 'COE not found') {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    if (error.message === 'Invalid runner') {
      return res.status(400).json({
        success: false,
        message: 'Invalid runner'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to assign runner to COE',
      error: error.message
    });
  }
});

/**
 * PUT /v1/coes/:id/seats
 * Update seat assignments for COE
 * @access Admin only
 */
router.put('/:id/seats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    // Validate request data
    const { error, value } = updateSeatAssignmentsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    const coe = await coeService.updateSeatAssignments(id, value.selected_seats);

    res.json({
      success: true,
      message: 'Seat assignments updated successfully',
      data: coe
    });
  } catch (error) {
    console.error('Error updating seat assignments:', error);
    if (error.message === 'COE not found') {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update seat assignments',
      error: error.message
    });
  }
});

/**
 * POST /v1/coes/:id/seat-upgrades/accept
 * Accept a seat upgrade offer
 * @access Authenticated users (COE client only)
 */
router.post('/:id/seat-upgrades/accept', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { current_seat_id, alternative_seat_id, event_id } = req.body;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    if (!current_seat_id || !alternative_seat_id || !event_id) {
      return res.status(400).json({
        success: false,
        message: 'current_seat_id, alternative_seat_id, and event_id are required'
      });
    }

    const coe = await coeService.acceptSeatUpgrade(id, current_seat_id, alternative_seat_id, event_id);

    res.json({
      success: true,
      message: 'Seat upgrade accepted successfully',
      data: coe
    });
  } catch (error) {
    console.error('Error accepting seat upgrade:', error);
    if (error.message === 'COE not found') {
      return res.status(404).json({ success: false, message: 'COE not found' });
    }
    if (error.message.includes('not found') || error.message.includes('only be accepted')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to accept seat upgrade',
      error: error.message
    });
  }
});

/**
 * POST /v1/coes/:id/payments/full
 * Process full payment for COE
 * @access Authenticated users (COE client only)
 */
router.post('/:id/payments/full', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { token_id } = req.body;
    const userId = req.user.id;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid COE ID format'
      });
    }

    if (!token_id) {
      return res.status(400).json({
        success: false,
        error: 'Payment token is required'
      });
    }

    // Find COE and verify user access
    const coe = await COE.findOne({
      _id: id,
      $or: [
        { client_id: userId },
        { admin_id: userId }
      ]
    });

    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found or access denied'
      });
    }

    // Check if already paid
    if (coe.payment_status === 'paid') {
      return res.status(400).json({
        success: false,
        error: 'COE is already paid'
      });
    }

    // Process payment using existing payment service
    const paymentService = require('../services/paymentService');
    const payment = await paymentService.chargeSavedCard(
      userId,
      token_id,
      coe.total,
      `COE Payment - ${coe.name}`,
      id
    );

    // Update COE payment status
    coe.payment_status = 'paid';
    coe.payment_id = payment._id;
    coe.payment_date = new Date();
    coe.payment_amount = coe.total;
    await coe.save();

    res.json({
      success: true,
      message: 'COE payment processed successfully',
      data: {
        payment_id: payment._id,
        amount: coe.total,
        status: 'paid'
      }
    });
  } catch (error) {
    console.error('Error processing COE payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process COE payment'
    });
  }
});

/**
 * GET /v1/coes/:id/payments/status
 * Get COE payment status
 * @access Authenticated users (COE client only)
 */
router.get('/:id/payments/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid COE ID format'
      });
    }

    // Find COE and verify user access
    const coe = await COE.findOne({
      _id: id,
      $or: [
        { client_id: userId },
        { admin_id: userId }
      ]
    });

    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found or access denied'
      });
    }

    res.json({
      success: true,
      data: {
        payment_status: coe.payment_status,
        total_amount: coe.total,
        payment_date: coe.payment_date,
        payment_amount: coe.payment_amount
      }
    });
  } catch (error) {
    console.error('Error fetching COE payment status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment status'
    });
  }
});

/**
 * POST /v1/coes/:id/payments/refund
 * Process COE refund (admin only)
 * @access Admin only
 */
router.post('/:id/payments/refund', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { refund_amount, reason } = req.body;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid COE ID format'
      });
    }

    if (!refund_amount || refund_amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Refund amount must be greater than zero'
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Refund reason is required'
      });
    }

    // Find COE
    const coe = await COE.findById(id);
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Check if COE is paid
    if (coe.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        error: 'Only paid COEs can be refunded'
      });
    }

    // Check refund amount limits
    const maxRefundAmount = coe.payment_amount || coe.total;
    const totalRefunded = coe.refund_amount || 0;
    const remainingRefundable = maxRefundAmount - totalRefunded;

    if (refund_amount > remainingRefundable) {
      return res.status(400).json({
        success: false,
        error: `Refund amount cannot exceed $${remainingRefundable.toLocaleString()}`
      });
    }

    // Process refund using existing payment service
    const paymentService = require('../services/paymentService');
    const refundPayment = await paymentService.processRefund(
      coe.payment_id,
      refund_amount,
      `COE Refund - ${coe.name}`,
      reason
    );

    // Update COE refund status
    const newTotalRefunded = totalRefunded + refund_amount;
    coe.refund_amount = newTotalRefunded;
    coe.refund_date = new Date();
    coe.refund_reason = reason;
    coe.refund_payment_id = refundPayment._id;

    if (newTotalRefunded >= maxRefundAmount) {
      coe.refund_status = 'full';
      coe.payment_status = 'unpaid'; // Revert to unpaid for full refund
    } else {
      coe.refund_status = 'partial';
      // Keep payment_status as 'paid' for partial refund
    }

    await coe.save();

    res.json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        refund_id: refundPayment._id,
        refund_amount: refund_amount,
        total_refunded: newTotalRefunded,
        refund_status: coe.refund_status,
        payment_status: coe.payment_status
      }
    });
  } catch (error) {
    console.error('Error processing COE refund:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process refund'
    });
  }
});

/**
 * GET /v1/coes/:id/payments/refund-status
 * Get COE refund status (admin only)
 * @access Admin only
 */
router.get('/:id/payments/refund-status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid COE ID format'
      });
    }

    // Find COE
    const coe = await COE.findById(id);
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    const maxRefundAmount = coe.payment_amount || coe.total;
    const remainingRefundable = maxRefundAmount - (coe.refund_amount || 0);

    res.json({
      success: true,
      data: {
        payment_status: coe.payment_status,
        refund_status: coe.refund_status,
        original_amount: maxRefundAmount,
        total_refunded: coe.refund_amount || 0,
        remaining_refundable: remainingRefundable,
        refund_date: coe.refund_date,
        refund_reason: coe.refund_reason
      }
    });
  } catch (error) {
    console.error('Error fetching COE refund status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch refund status'
    });
  }
});

/**
 * PUT /v1/coes/:id/covered-amount
 * Update COE covered amount by THE1 (admin only)
 * @access Admin only
 */
router.put('/:id/covered-amount', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid COE ID format'
      });
    }

    if (typeof amount !== 'number' || amount < 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required'
      });
    }

    const coe = await COE.findById(id);
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Validate amount doesn't exceed total
    if (amount > coe.total) {
      return res.status(400).json({
        success: false,
        error: `Covered amount cannot exceed COE total of $${coe.total.toLocaleString()}`
      });
    }

    // Update covered amount
    coe.covered_by_t1.amount = amount;
    coe.covered_by_t1.date = new Date();
    coe.covered_by_t1.updated_by = req.user.id;

    await coe.save();

    res.json({
      success: true,
      message: 'COE covered amount updated successfully',
      data: {
        coe_id: coe._id,
        covered_amount: amount,
        total: coe.total,
        coverage_percentage: ((amount / coe.total) * 100).toFixed(2),
        updated_at: coe.covered_by_t1.date,
        updated_by: req.user.id
      }
    });
  } catch (error) {
    console.error('Error updating COE covered amount:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update COE covered amount'
    });
  }
});

/**
 * PUT /v1/coes/:id/covered-all
 * Set COE as fully covered by THE1 (admin only)
 * @access Admin only
 */
router.put('/:id/covered-all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid COE ID format'
      });
    }

    const coe = await COE.findById(id);
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Set covered amount to total
    coe.covered_by_t1.amount = coe.total;
    coe.covered_by_t1.date = new Date();
    coe.covered_by_t1.updated_by = req.user.id;

    await coe.save();

    res.json({
      success: true,
      message: 'COE set as fully covered by THE1',
      data: {
        coe_id: coe._id,
        covered_amount: coe.total,
        total: coe.total,
        coverage_percentage: 100,
        updated_at: coe.covered_by_t1.date,
        updated_by: req.user.id
      }
    });
  } catch (error) {
    console.error('Error setting COE as fully covered:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set COE as fully covered'
    });
  }
});

/**
 * DELETE /v1/coes/:coeId/events
 * Remove events from a draft COE
 * @access Authenticated users (admin or COE owner)
 */
router.delete('/:coeId/events', authenticateToken, async (req, res) => {
  try {
    const { coeId } = req.params;
    const { event_ids } = req.body;

    if (!event_ids || !Array.isArray(event_ids) || event_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'event_ids array is required and must not be empty'
      });
    }

    const coe = await COE.findById(coeId);
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Check permissions: admin or COE owner
    const isAdmin = req.user.role === 'admin';
    const isOwner = coe.client_id?.toString() === req.user.id || coe.admin_id?.toString() === req.user.id;
    
    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to modify this COE'
      });
    }

    // Validate at least one event remains
    const currentEventIds = new Set();
    (coe.selected_seats || []).forEach(seat => {
      const eventIdStr = seat.event_id?.toString() || seat.event_id;
      if (eventIdStr) {
        currentEventIds.add(eventIdStr);
      }
    });

    const eventIdsToRemove = event_ids.map(id => id.toString());
    const remainingEvents = Array.from(currentEventIds).filter(id => !eventIdsToRemove.includes(id));

    if (remainingEvents.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove all events from COE. At least one event must remain.'
      });
    }

    const updatedCoe = await coeService.removeEventsFromCOE(coeId, event_ids);

    res.json({
      success: true,
      message: `Successfully removed ${event_ids.length} event(s) from COE`,
      data: updatedCoe
    });
  } catch (error) {
    console.error('Error removing events from COE:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to remove events from COE'
    });
  }
});

/**
 * PUT /v1/coes/:coeId/events/:oldEventId
 * Replace an event in a draft COE
 * @access Authenticated users (admin or COE owner)
 */
router.put('/:coeId/events/:oldEventId', authenticateToken, async (req, res) => {
  try {
    const { coeId, oldEventId } = req.params;
    const { new_event_id, preserve_seats = false, seat_preferences = {} } = req.body;

    if (!new_event_id) {
      return res.status(400).json({
        success: false,
        error: 'new_event_id is required'
      });
    }

    // Use native MongoDB to load COE and bypass Mongoose validation entirely
    // This is a workaround for events created before base_price/total_price were required
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const coesCollection = db.collection('coes');
    const coeObjectId = mongoose.Types.ObjectId.isValid(coeId) 
      ? new mongoose.Types.ObjectId(coeId) 
      : coeId;
    
    const coe = await coesCollection.findOne({ _id: coeObjectId });
    
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Check permissions: admin or COE owner
    const isAdmin = req.user.role === 'admin';
    const coeClientId = coe.client_id?.toString?.() || (typeof coe.client_id === 'object' ? coe.client_id?._id?.toString() : coe.client_id);
    const coeAdminId = coe.admin_id?.toString?.() || (typeof coe.admin_id === 'object' ? coe.admin_id?._id?.toString() : coe.admin_id);
    const isOwner = coeClientId === req.user.id || coeAdminId === req.user.id;
    
    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to modify this COE'
      });
    }

    const updatedCoe = await coeService.replaceEventInCOE(
      coeId,
      oldEventId,
      new_event_id,
      { preserve_seats, seat_preferences, isAdmin }
    );

    res.json({
      success: true,
      message: 'Event replaced successfully',
      data: updatedCoe
    });
  } catch (error) {
    console.error('Error replacing event in COE:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to replace event in COE'
    });
  }
});

/**
 * GET /v1/coes/:coeId/events/:eventId/alternatives
 * Get alternative events for replacement
 * @access Authenticated users (admin or COE owner)
 */
router.get('/:coeId/events/:eventId/alternatives', authenticateToken, async (req, res) => {
  try {
    const { coeId, eventId } = req.params;
    const { city, date_range_start, date_range_end, limit = 10 } = req.query;

    const coe = await COE.findById(coeId);
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Check permissions: admin or COE owner
    const isAdmin = req.user.role === 'admin';
    const isOwner = coe.client_id?.toString() === req.user.id || coe.admin_id?.toString() === req.user.id;
    
    if (!isAdmin && !isOwner) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to view this COE'
      });
    }

    const filters = {
      city: city || undefined,
      date_range_start: date_range_start ? new Date(date_range_start) : undefined,
      date_range_end: date_range_end ? new Date(date_range_end) : undefined,
      limit: parseInt(limit, 10),
      isAdmin: isAdmin // Pass admin flag to service
    };

    const alternatives = await coeService.findAlternativeEvents(coeId, eventId, filters);

    res.json({
      success: true,
      data: alternatives,
      count: alternatives.length
    });
  } catch (error) {
    console.error('Error finding alternative events:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to find alternative events'
    });
  }
});

module.exports = router;

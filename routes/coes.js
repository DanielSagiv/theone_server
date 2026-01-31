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
  addEventToCOEWithSeatSchema,
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
    
    // Ensure userId is properly formatted for comparison
    const userId = req.user._id || req.user.id;
    const userIdObj = userId instanceof mongoose.Types.ObjectId 
      ? userId 
      : new mongoose.Types.ObjectId(userId);
    
    // Get COEs where user is admin, client, runner, or participant
    const coes = await COE.find({
      $or: [
        { admin_id: userIdObj },
        { client_id: userIdObj },
        { 'runner_assignment.runner_id': userIdObj },
        { 'participants.user_id': userIdObj }
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

      // CRITICAL FIX: Filter selected_seats to only include seats matching events currently in the COE
      // This ensures seats from replaced events (if not fully cleaned from DB) are not returned to client
      // This prevents incorrect cost breakdown calculation on client side
      coeService.filterSelectedSeatsByEvents(coe, '[GET /coes/my]');
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

    const mongoose = require('mongoose');
    const Event = require('../models/Event');
    
    // Get COEs with proper population (same pattern as /coes/my)
    const coes = await COE.find({ 
      $or: [
        { client_id: clientId },
        { 'participants.user_id': clientId }
      ]
    })
    .lean()
    .populate('client_id', 'firstName lastName email')
    .populate('admin_id', 'firstName lastName email')
    .populate('runner_assignment.runner_id', 'firstName lastName email avatarUrl')
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
    // This ensures events replaced via updateOne are properly populated (same as /coes/my)
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
                  console.log('[GET /coes/client/:clientId] Manually populated event:', populatedEvent.name, 'for COE:', coe._id);
                } else {
                  console.warn('[GET /coes/client/:clientId] Event not found for manual population:', eventIdValue, 'in COE:', coe._id);
                }
              } catch (populateError) {
                console.warn('[GET /coes/client/:clientId] Failed to manually populate event:', populateError.message, 'for event_id:', eventIdValue, 'in COE:', coe._id);
              }
            }
          }
        }
      }

      // Filter selected_seats to only include seats matching events currently in the COE
      // This ensures seats from replaced events (if not fully cleaned from DB) are not returned to client
      coeService.filterSelectedSeatsByEvents(coe, '[GET /coes/client/:clientId]');
    }

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
    const mongoose = require('mongoose');
    
    // Ensure userId is properly formatted for comparison
    const userId = req.user._id || req.user.id;
    const userIdObj = userId instanceof mongoose.Types.ObjectId 
      ? userId 
      : new mongoose.Types.ObjectId(userId);

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid COE ID format'
      });
    }

    // Use getCOEById for consistent population (same as other endpoints)
    // First verify user has access - convert userId to ObjectId for proper comparison
    // DEBUG: Log user access check (for TestFlight debugging)
    console.log('[GET /coes/my/:id] 🔍 CHECKING USER ACCESS:', {
      coeId: id,
      userId: userId?.toString(),
      userIdObj: userIdObj?.toString(),
      userRole: req.user.role,
      userRoleType: typeof req.user.role,
      userEmail: req.user.email,
      timestamp: new Date().toISOString()
    });
    
    const coeCheck = await COE.findOne({
      _id: id,
      $or: [
        { admin_id: userIdObj },
        { client_id: userIdObj },
        { 'runner_assignment.runner_id': userIdObj },
        { 'participants.user_id': userIdObj }
      ]
    }).select('_id admin_id client_id runner_assignment.runner_id');
    
    if (!coeCheck) {
      // Log for debugging
      const coeExists = await COE.findById(id).select('admin_id client_id runner_assignment.runner_id').lean();
      console.log('[GET /coes/my/:id] Access denied:', {
        coeId: id,
        userId: userId?.toString(),
        userIdObj: userIdObj?.toString(),
        coeExists: !!coeExists,
        coeAdminId: coeExists?.admin_id?.toString(),
        coeClientId: coeExists?.client_id?.toString(),
        coeRunnerId: coeExists?.runner_assignment?.runner_id?.toString()
      });
      
      return res.status(404).json({
        success: false,
        error: 'COE not found or access denied'
      });
    }
    
    console.log('[GET /coes/my/:id] Access granted:', {
      coeId: id,
      userId: userId?.toString()
    });
    
    // CRITICAL: Use native MongoDB to get absolute latest data (same as findAlternativeEvents)
    // This ensures we get fresh data after event replacements that use native MongoDB updates
    // mongoose already required above
    const db = mongoose.connection.db;
    const coesCollection = db.collection('coes');
    const coeObjectId = mongoose.Types.ObjectId.isValid(id) 
      ? new mongoose.Types.ObjectId(id) 
      : id;
    
    // Fetch COE with lean() to get plain object and avoid Mongoose serialization issues
    let coe;
    try {
      // Use native MongoDB to get absolute latest data (same approach as findAlternativeEvents)
      // This ensures we see the latest state after replacements
      const coeRaw = await coesCollection.findOne({ _id: coeObjectId });
      if (!coeRaw) {
        return res.status(404).json({
          success: false,
          error: 'COE not found or access denied'
        });
      }
      
      console.log('[GET /coes/my/:id] Raw COE from native MongoDB:', {
        coeId: id,
        eventsCount: coeRaw.events?.length || 0,
        eventIds: (coeRaw.events || []).map(e => e.event_id?.toString() || e.event_id),
        seatsCount: coeRaw.selected_seats?.length || 0,
        seatEventIds: [...new Set((coeRaw.selected_seats || []).map(s => s.event_id?.toString() || s.event_id))]
      });
      
      // Now use Mongoose to populate relationships
      // Using lean() ensures we get a plain object and bypasses Mongoose document cache
      // This queries fresh from the database
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
      
      // Verify events array matches raw data
      const rawEventIds = (coeRaw.events || []).map(e => String(e.event_id)).sort();
      const mongooseEventIds = (coe.events || []).map(e => String(e.event_id?._id || e.event_id)).sort();
      if (rawEventIds.join(',') !== mongooseEventIds.join(',')) {
        console.warn('[GET /coes/my/:id] ⚠️ Events array mismatch!', {
          rawEventIds,
          mongooseEventIds,
          note: 'Mongoose may have cached old data. Using raw data event IDs.'
        });
        // If mismatch, we should ideally rebuild the events array from raw data
        // For now, log the warning - the populated data should still be correct
      } else {
        console.log('[GET /coes/my/:id] ✅ Events array matches between raw and populated');
      }
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

    // CRITICAL FIX: Filter selected_seats to only include seats matching events currently in the COE
    // This ensures seats from replaced events (if not fully cleaned from DB) are not returned to client
    // This prevents incorrect cost breakdown calculation on client side
    coeService.filterSelectedSeatsByEvents(coe, '[GET /coes/my/:id]');
    
    // DEBUG: Log original_request_data so we can inspect what mobile receives
    try {
      const originalRequestPreview = coe.original_request_data
        ? {
            hasData: true,
            keys: Object.keys(coe.original_request_data),
            // Key fields that are relevant for the mobile "Original Request Details" card
            budget: coe.original_request_data.budget || null,
            requested_dates: coe.original_request_data.requested_dates || null,
            party_size: coe.original_request_data.party_size || null,
            city: coe.original_request_data.city || null,
            has_seat_preferences: !!coe.original_request_data.seat_preferences,
            has_general_preferences: !!coe.original_request_data.general_preferences,
          }
        : { hasData: false };

      console.log(
        '[GET /coes/my/:id] [COE request json to inspect]:',
        JSON.stringify(originalRequestPreview)
      );
    } catch (previewError) {
      console.error(
        '[GET /coes/my/:id] Failed to log [COE request json to inspect]:',
        previewError
      );
    }
    
    // DEBUG: Log COE data being sent to client (for TestFlight debugging)
    console.log('[GET /coes/my/:id] 📱 COE DATA SENT TO CLIENT:', {
      coeId: coe._id?.toString() || coe.id?.toString(),
      coeStatus: coe.status,
      coeName: coe.name,
      userId: userId?.toString(),
      userRole: req.user.role,
      userEmail: req.user.email,
      canApprove: req.user.role === 'admin' && (coe.status === 'draft' || coe.status === 'request'),
      isAdmin: req.user.role === 'admin',
      isDraftOrRequest: coe.status === 'draft' || coe.status === 'request',
      timestamp: new Date().toISOString()
    });

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
 * @access Admin or Client (can cancel their own COEs before payment)
 */
router.put('/:id/status', authenticateToken, async (req, res) => {
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

    // Fetch COE for authorization check
    const coe = await COE.findById(id).populate('client_id', '_id');
    if (!coe) {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    // Authorization check: Admin can change any status, Client can only cancel their own COEs
    const isAdmin = req.user.role === 'admin';
    const isClientOwner = (coe.client_id?._id?.toString() || coe.client_id?.toString()) === req.user.id.toString();
    
    // Allow client cancellation from specific statuses
    const clientCancelAllowed = !isAdmin && 
                                isClientOwner &&
                                value.status === 'cancelled' &&
                                ['request', 'draft', 'approved', 'pending_pay'].includes(coe.status);
    
    if (!isAdmin && !clientCancelAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only admins can change COE status, or clients can cancel their own COEs before payment.',
        error: {
          code: 'PERMISSION_DENIED',
          current_status: coe.status,
          requested_status: value.status,
          user_role: req.user.role,
          is_owner: isClientOwner
        }
      });
    }

    const updatedCoe = await coeService.updateCOEStatus(id, value.status, req.user.id);

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

    // Get COE to check permissions
    const coe = await COE.findById(id).populate('created_by', 'role');
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Check if client can edit this COE (blocks client-created draft COEs)
    const { canClientEditCOE } = require('../utils/coeUtils');
    const permissionCheck = canClientEditCOE(coe, req.user.id, req.user);
    if (!permissionCheck.canEdit) {
      return res.status(403).json({
        success: false,
        error: permissionCheck.reason || 'You do not have permission to edit this COE'
      });
    }

    // Continue with seat upgrade
    const updatedCoe = await coeService.acceptSeatUpgrade(id, current_seat_id, alternative_seat_id, event_id);

    res.json({
      success: true,
      message: 'Seat upgrade accepted successfully',
      data: updatedCoe
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

    // Check COE status - must be approved or pending_pay before payment
    if (coe.status === 'draft' || coe.status === 'request') {
      return res.status(403).json({
        success: false,
        error: 'COE must be approved by admin before payment'
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
 * Remove events from an unpaid COE (admin only)
 * When removing last event: deletes COE and notifies admin and user
 * @access Admin only
 */
router.delete('/:coeId/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { coeId } = req.params;
    const { event_ids } = req.body;

    if (!event_ids || !Array.isArray(event_ids) || event_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'event_ids array is required and must not be empty'
      });
    }

    const coe = await COE.findById(coeId).populate('created_by', 'role');
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Reject removal for paid COEs
    if (coe.payment_status === 'paid' || coe.status === 'paid') {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove events from a paid experience'
      });
    }

    // Build set of event IDs currently in COE (from events array)
    const currentEventIds = new Set();
    (coe.events || []).forEach(e => {
      const eventIdStr = e.event_id?.toString() || e.event_id;
      if (eventIdStr) currentEventIds.add(eventIdStr);
    });

    const eventIdsToRemove = event_ids.map(id => id.toString());
    const remainingEventIds = Array.from(currentEventIds).filter(id => !eventIdsToRemove.includes(id));

    // When removing last event: delete COE, notify admin and user
    if (remainingEventIds.length === 0) {
      const coeName = coe.name || 'Experience';
      await coeService.deleteCOE(coeId);

      // Notify admin and user (async, non-blocking)
      try {
        const notificationService = require('../services/notificationService');
        const notifyData = { coe_id: coeId, coe: { name: coeName } };
        const userIds = new Set();
        if (coe.admin_id) userIds.add(coe.admin_id.toString());
        if (coe.client_id) userIds.add(coe.client_id.toString());
        for (const userId of userIds) {
          notificationService.createAndSendNotification(userId, 'coe_cancelled', notifyData)
            .catch(err => console.error('[COES] Failed to notify:', err));
        }
      } catch (notifErr) {
        console.error('[COES] Error sending last-event notifications:', notifErr);
      }

      return res.json({
        success: true,
        deleted: true,
        message: 'Experience removed (last event deleted)',
        data: null
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
 * POST /v1/coes/:coeId/events/remove
 * Remove events from an unpaid COE (admin only)
 * Uses POST instead of DELETE because many proxies strip DELETE request bodies
 * @access Admin only
 */
router.post('/:coeId/events/remove', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { coeId } = req.params;
    const { event_ids } = req.body;

    if (!event_ids || !Array.isArray(event_ids) || event_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'event_ids array is required and must not be empty'
      });
    }

    const coe = await COE.findById(coeId).populate('created_by', 'role');
    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Reject removal for paid COEs
    if (coe.payment_status === 'paid' || coe.status === 'paid') {
      return res.status(400).json({
        success: false,
        error: 'Cannot remove events from a paid experience'
      });
    }

    // Build set of event IDs currently in COE (from events array)
    const currentEventIds = new Set();
    (coe.events || []).forEach(e => {
      const eventIdStr = e.event_id?.toString() || e.event_id;
      if (eventIdStr) currentEventIds.add(eventIdStr);
    });

    const eventIdsToRemove = event_ids.map(id => id.toString());
    const remainingEventIds = Array.from(currentEventIds).filter(id => !eventIdsToRemove.includes(id));

    // When removing last event: delete COE, notify admin and user
    if (remainingEventIds.length === 0) {
      const coeName = coe.name || 'Experience';
      await coeService.deleteCOE(coeId);

      try {
        const notificationService = require('../services/notificationService');
        const notifyData = { coe_id: coeId, coe: { name: coeName } };
        const userIds = new Set();
        if (coe.admin_id) userIds.add(coe.admin_id.toString());
        if (coe.client_id) userIds.add(coe.client_id.toString());
        for (const userId of userIds) {
          notificationService.createAndSendNotification(userId, 'coe_cancelled', notifyData)
            .catch(err => console.error('[COES] Failed to notify:', err));
        }
      } catch (notifErr) {
        console.error('[COES] Error sending last-event notifications:', notifErr);
      }

      return res.json({
        success: true,
        deleted: true,
        message: 'Experience removed (last event deleted)',
        data: null
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
 * Replace an event in a draft or request COE
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

    // Fetch COE with Mongoose for permission check (needs populated created_by)
    const coeForPermission = await COE.findById(coeId).populate('created_by', 'role');
    if (!coeForPermission) {
      return res.status(404).json({
        success: false,
        error: 'COE not found'
      });
    }

    // Check if client can edit this COE (blocks client-created draft COEs)
    const { canClientEditCOE } = require('../utils/coeUtils');
    const permissionCheck = canClientEditCOE(coeForPermission, req.user.id, req.user);
    if (!permissionCheck.canEdit) {
      return res.status(403).json({
        success: false,
        error: permissionCheck.reason || 'You do not have permission to edit this COE'
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
 * GET /v1/coes/:coeId/events/available-to-add
 * Get events available to add to COE (admin add-event flow)
 * Uses COE date range and city from client request
 * @access Admin only
 */
router.get('/:coeId/events/available-to-add', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { coeId } = req.params;
    const coe = await COE.findById(coeId);
    if (!coe) {
      return res.status(404).json({ success: false, error: 'COE not found' });
    }
    if (coe.payment_status === 'paid' || coe.status === 'paid') {
      return res.status(400).json({
        success: false,
        error: 'Cannot add event to a paid experience'
      });
    }
    const events = await coeService.findEventsAvailableToAdd(coeId);
    res.json({ success: true, data: events, count: events.length });
  } catch (error) {
    console.error('Error finding events available to add:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to find events available to add'
    });
  }
});

/**
 * POST /v1/coes/:coeId/events/add-with-seat
 * Add event with selected seat to COE (admin add-event flow)
 * @access Admin only
 */
router.post('/:coeId/events/add-with-seat', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { coeId } = req.params;
    console.log('[COES] add-with-seat body:', JSON.stringify(req.body, null, 2));
    const { error, value } = addEventToCOEWithSeatSchema.validate(req.body);
    if (error) {
      const msg = error.details[0]?.message || 'Validation error';
      console.log('[COES] add-with-seat validation failed:', msg);
      return res.status(400).json({
        success: false,
        error: msg
      });
    }
    const adminUserId = req.user._id?.toString() || req.user.id;
    const updatedCoe = await coeService.addEventToCOEWithSeat(coeId, value, adminUserId);
    res.json({
      success: true,
      message: 'Event added to experience successfully',
      data: updatedCoe
    });
  } catch (error) {
    console.error('Error adding event with seat to COE:', error);
    const status = error.message?.includes('not found') ? 404 :
      error.message?.includes('paid') || error.message?.includes('already') || error.message?.includes('no longer') ? 400 : 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to add event to experience'
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

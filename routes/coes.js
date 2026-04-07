const express = require('express');
const router = express.Router();
const COE = require('../models/COE');
const coeService = require('../services/coeService');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/auth');
const mergeService = require('../services/mergeService');
const { executeTool, getOrCreateConversation } = require('../services/botService');
const notificationService = require('../services/notificationService');
const { getHistoryForCOE } = require('../services/coeHistoryService');
const {
  createCOESchema,
  updateCOESchema,
  addEventToCOESchema,
  addEventToCOEWithSeatSchema,
  updateCOEStatusSchema,
  assignRunnerToCOESchema,
  updateSeatAssignmentsSchema
} = require('../utils/validationSchemas');
const proposalGroupService = require('../services/proposalGroupService');

/**
 * COE Routes
 * @description API endpoints for COE management
 */

/**
 * GET /v1/coes/merge-opportunities
 * List possible merge opportunities between COEs (admin only)
 */
router.get('/merge-opportunities', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, event_id, limit, coe_id, debug } = req.query;

    const options = {};
    if (status) {
      options.status = String(status)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }
    if (event_id) {
      options.event_id = event_id;
    }
    if (coe_id) {
      options.coe_id = coe_id;
    }
    if (limit) {
      const parsed = parseInt(limit, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        options.limit = parsed;
      }
    }
    if (debug === '1' || debug === 'true') {
      options.debug = true;
    }

    const result = await mergeService.findMergeOpportunities(options);

    const data = { opportunities: result.opportunities };
    if (result.debug) {
      data.debug = result.debug;
    }
    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[COES] Error getting merge opportunities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get merge opportunities',
      error: error.message,
    });
  }
});

/**
 * POST /v1/coes/merge
 * Execute merge between two COEs for a specific event/seat (admin only)
 */
router.post('/merge', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      coe_id_a,
      coe_id_b,
      event_id,
      target_seat_id,
      target_owner_coe_id,
    } = req.body || {};

    if (!coe_id_a || !coe_id_b || !event_id || !target_seat_id) {
      return res.status(400).json({
        success: false,
        message: 'coe_id_a, coe_id_b, event_id and target_seat_id are required',
      });
    }

    const result = await mergeService.executeMerge({
      coe_id_a,
      coe_id_b,
      event_id,
      target_seat_id,
      target_owner_coe_id,
      admin_id: req.user.id,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[COES] Error executing merge:', error);
    const status =
      error.message &&
      (error.message.includes('not found') ||
        error.message.includes('Cannot merge the same COE'))
        ? 400
        : 500;

    res.status(status).json({
      success: false,
      message: 'Failed to execute merge',
      error: error.message,
    });
  }
});

/**
 * POST /v1/coes/unmerge
 * Unmerge a single COE from a shared seat (admin only)
 */
router.post('/unmerge', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { primary_coe_id, merged_coe_id, event_id, mode } = req.body || {};

    if (!primary_coe_id || !event_id) {
      return res.status(400).json({
        success: false,
        message: 'primary_coe_id and event_id are required',
      });
    }

    let result;
    if (mode === 'all') {
      result = await mergeService.unmergeAllForSeat({
        primary_coe_id,
        event_id,
      });
    } else {
      if (!merged_coe_id) {
        return res.status(400).json({
          success: false,
          message: 'merged_coe_id is required when mode is not "all"',
        });
      }
      result = await mergeService.unmergeSingle({
        primary_coe_id,
        merged_coe_id,
        event_id,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[COES] Error executing unmerge:', error);
    const status =
      error.message && error.message.includes('not found') ? 404 : 500;

    res.status(status).json({
      success: false,
      message: 'Failed to execute unmerge',
      error: error.message,
    });
  }
});

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
    let coes = await COE.find({
      $or: [
        { admin_id: userIdObj },
        { client_id: userIdObj },
        { 'runner_assignment.runner_id': userIdObj },
        { 'participants.user_id': userIdObj }
      ]
    })
    .populate('admin_id', 'firstName lastName email')
    .populate('client_id', 'firstName lastName email avatarUrl')
    .populate({
      path: 'events.event_id',
      select: 'name description start_datetime end_datetime location_id media seats performers type timezone',
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
                  .select('name description location_id start_datetime end_datetime media seats performers type timezone');
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

    // Ensure proposal_group_id from raw BSON is on each doc (multi-proposal list grouping on mobile)
    if (coes.length > 0) {
      const ids = coes.map((c) => c._id);
      const rows = await COE.collection
        .find({ _id: { $in: ids } }, { projection: { proposal_group_id: 1 } })
        .toArray();
      const gidById = new Map(rows.map((r) => [String(r._id), r.proposal_group_id]));
      for (const coe of coes) {
        const fromDb = gidById.get(String(coe._id));
        if (
          fromDb != null &&
          String(fromDb).trim() !== '' &&
          (coe.proposal_group_id == null || String(coe.proposal_group_id).trim() === '')
        ) {
          coe.set('proposal_group_id', String(fromDb));
        }
      }
    }

    // Business rule: clients should not see draft or cancelled Experiences (losers after multi-proposal resolve)
    if (req.user.role === 'client') {
      coes = coes.filter((c) => c.status !== 'draft' && c.status !== 'cancelled');
    }

    if (req.user.role === 'client' && coes.length > 0) {
      const proposalGroupService = require('../services/proposalGroupService');
      for (const doc of coes) {
        try {
          if (
            doc.proposal_group_id &&
            (!doc.proposal_label || !String(doc.proposal_label).trim())
          ) {
            await proposalGroupService.ensureProposalOptionLabelIfMissing(doc);
          }
        } catch (labelErr) {
          console.warn('[GET /coes/my] ensureProposalOptionLabelIfMissing:', labelErr.message);
        }
      }
    }

    // Plain JSON with explicit proposal_group_id so mobile can group (undefined keys are omitted by JSON)
    const data = coes.map((doc) => {
      const o = typeof doc.toObject === 'function' ? doc.toObject() : {...doc};
      return {
        ...o,
        proposal_group_id:
          o.proposal_group_id != null && String(o.proposal_group_id).trim() !== ''
            ? String(o.proposal_group_id)
            : null,
        proposal_label:
          o.proposal_label != null && String(o.proposal_label).trim() !== ''
            ? String(o.proposal_label)
            : null,
      };
    });

    res.json({
      success: true,
      data,
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
    .populate('client_id', 'firstName lastName email avatarUrl')
    .populate('admin_id', 'firstName lastName email')
    .populate('runner_assignment.runner_id', 'firstName lastName email avatarUrl')
    .populate({
      path: 'events.event_id',
      select: 'name description start_datetime end_datetime location_id media seats performers type timezone',
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
                  .select('name description location_id start_datetime end_datetime media seats performers type timezone');
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
    }).select('_id admin_id client_id runner_assignment.runner_id status');
    
    if (!coeCheck || (req.user.role === 'client' && coeCheck.status === 'draft')) {
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
          select: 'name description location_id start_datetime end_datetime base_price currency status media seats performers type timezone',
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
              .select('name description location_id start_datetime end_datetime base_price currency status media seats performers type timezone');
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
          const isMatch = eventId === seatEventId;
          if (!isMatch && seatEventId && eventId) {
            console.log('[GET /coes/my/:id] Seat/event mismatch before enhancement:', {
              coeId: coe._id?.toString() || id,
              eventId,
              seatEventId,
              seatCode: selectedSeat.seat_code,
            });
          }
          return isMatch;
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

      // Section label for Manage Events / clients: fill category from Event.seats when missing on COE row
      coeService.enrichSelectedSeatsCategoryFromPopulatedEvents(coe);
      
      // Log final result
      const seatsWithMedia = coe.selected_seats.filter(s => s.media && s.media.length > 0);
      console.log('[GET /coes/my/:id] Enhancement complete. Seats with media:', seatsWithMedia.length, 'out of', coe.selected_seats.length);
    }

    // Enrich selected_seats with shared_with (other client name + avatar) when seat is part of a merge
    try {
      await mergeService.enrichCoeSelectedSeatsWithSharedWith(coe);
    } catch (sharedErr) {
      console.warn('[GET /coes/my/:id] Failed to enrich shared_with:', sharedErr.message);
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

    let openMultiProposalClientAccept = false;
    const proposalGroupService = require('../services/proposalGroupService');
    if (req.user.role === 'client' && coe.proposal_group_id) {
      try {
        if (!coe.proposal_label || !String(coe.proposal_label).trim()) {
          await proposalGroupService.ensureProposalOptionLabelIfMissing(coe);
        }
      } catch (labelErr) {
        console.warn('[GET /coes/my/:id] ensureProposalOptionLabelIfMissing:', labelErr.message);
      }
    }
    if (req.user.role === 'client' && coe.status === 'approved' && coe.proposal_group_id) {
      try {
        openMultiProposalClientAccept = await proposalGroupService.clientMayChooseWithoutFullDeposit(coe);
      } catch (multiErr) {
        console.warn('[GET /coes/my/:id] openMultiProposalClientAccept check failed:', multiErr.message);
      }
    }

    res.json({
      success: true,
      data: {
        ...coe,
        open_multi_proposal_client_accept: openMultiProposalClientAccept,
      },
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
 * POST /v1/coes/:coeId/build-experience-form
 * Create a "Create COE for client" form (coe_create_form) for an existing request-only COE.
 * Admin only. This does NOT modify the COE; it just returns structured data
 * so the mobile app can render the existing Create Experience flow.
 */
router.post('/:coeId/build-experience-form', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { coeId } = req.params;
    const user = req.user;

    const coe = await COE.findById(coeId);
    if (!coe) {
      return res.status(404).json({ success: false, error: 'COE not found' });
    }

    if (coe.status !== 'request') {
      return res.status(400).json({
        success: false,
        error: 'Build experience is only available for request status experiences',
      });
    }

    if (!coe.client_id) {
      return res.status(400).json({
        success: false,
        error: 'COE is missing client information',
      });
    }

    const correlationId = `build-experience-form-${coeId}-${Date.now()}`;
    const toolParams = { client_id: coe.client_id.toString() };

    const toolResult = await executeTool('open_create_coe_for_client', toolParams, user, correlationId);

    if (!toolResult.success || !toolResult.data) {
      const message = toolResult.error?.message || 'Failed to open Create COE form for client';
      return res.status(400).json({ success: false, error: message });
    }

    // If this COE was created via Flow A (request-only), we have original_request_data
    // that can be used to pre-populate the admin Create Experience form so the admin
    // doesn't need to re-enter information the client already provided.
    const originalRequest = coe.original_request_data || {};
    const requestedDates = originalRequest.requested_dates || {};

    // Normalize dates to YYYY-MM-DD strings expected by COECreateForm
    const normalizeDateForForm = dateValue => {
      if (!dateValue) return null;
      try {
        const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().split('T')[0];
      } catch (e) {
        return null;
      }
    };

    const startDateDefault = normalizeDateForForm(requestedDates.start_date);
    const endDateDefault = normalizeDateForForm(requestedDates.end_date);

    // Normalize budget to a single numeric amount used by the admin form
    let budgetDefault = null;
    if (originalRequest.budget) {
      const b = originalRequest.budget;
      const amount =
        typeof b === 'number'
          ? b
          : (b.max != null && !Number.isNaN(Number(b.max))
              ? Number(b.max)
              : b.amount != null && !Number.isNaN(Number(b.amount))
                ? Number(b.amount)
                : null);
      if (amount != null) {
        budgetDefault = amount;
      }
    }

    const partySizeDefault =
      typeof originalRequest.party_size === 'number' && originalRequest.party_size > 0
        ? originalRequest.party_size
        : null;

    const seatPreferencesDefault = originalRequest.seat_preferences || '';
    const specificPreferencesDefault = originalRequest.general_preferences || '';
    const cityDefault = originalRequest.city || null;

    // Enrich the coe_create_form payload with the originating request COE ID (Flow A).
    // Also, when original_request_data is present, pre-populate the defaults for:
    // - dates, city, budget, party size, seat/general preferences, and occasion/reason.
    // This allows the admin's form submission to "upgrade" the existing request-only COE
    // instead of creating a second draft COE, and avoids re-typing data.
    const enrichedData = {
      ...toolResult.data,
      defaults: {
        ...(toolResult.data.defaults || {}),
        request_coe_id: coeId.toString(),
        ...(startDateDefault ? { start_date: startDateDefault } : {}),
        ...(endDateDefault ? { end_date: endDateDefault } : {}),
        ...(cityDefault ? { city: cityDefault } : {}),
        ...(budgetDefault != null ? { budget: budgetDefault } : {}),
        ...(partySizeDefault != null ? { party_size: partySizeDefault } : {}),
        ...(seatPreferencesDefault
          ? { seat_preferences: seatPreferencesDefault }
          : {}),
        ...(specificPreferencesDefault
          ? { specific_preferences: specificPreferencesDefault }
          : {}),
      },
    };

    // Append a new assistant message with the coe_create_form structured_data
    // to the admin's bot conversation so it appears in the Bot screen.
    const conversation = await getOrCreateConversation(user._id || user.id, { role: user.role });
    conversation.messages.push({
      role: 'assistant',
      content: enrichedData.message || toolResult.data.message || 'Create a new COE draft for this client.',
      structured_data: enrichedData,
      timestamp: new Date().toISOString(),
    });
    await conversation.save();

    res.json({
      success: true,
      data: enrichedData,
    });
  } catch (error) {
    console.error('[POST /coes/:coeId/build-experience-form] Unexpected error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to build experience form',
    });
  }
});

/**
 * GET /v1/coes/proposal-groups/:proposalGroupId/members
 * List COEs in a proposal group (client: own group; admin: must own a COE in the group)
 */
router.get('/proposal-groups/:proposalGroupId/members', authenticateToken, async (req, res) => {
  try {
    const { proposalGroupId } = req.params;
    if (!proposalGroupId || String(proposalGroupId).trim() === '') {
      return res.status(400).json({ success: false, message: 'proposalGroupId is required' });
    }
    const list = await proposalGroupService.listMembersForUser(proposalGroupId, {
      userId: req.user.id,
      role: req.user.role,
      clientId: req.query.client_id
    });
    const data = await Promise.all(
      list.map((doc) => coeService.getCOEById(doc._id.toString()))
    );
    res.json({ success: true, data });
  } catch (error) {
    console.error('[COES] proposal-groups members:', error);
    const status =
      error.message === 'Proposal group not found'
        ? 404
        : error.message === 'Forbidden' || error.message === 'Client does not match proposal group'
          ? 403
          : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to list proposal group members'
    });
  }
});

/**
 * POST /v1/coes/proposal-groups/:proposalGroupId/publish
 * Approve all draft/request COEs in the group; send one grouped client notification when N>=2 approved
 * @access Admin (must own a COE in the group)
 */
router.post(
  '/proposal-groups/:proposalGroupId/publish',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { proposalGroupId } = req.params;
      if (!proposalGroupId || String(proposalGroupId).trim() === '') {
        return res.status(400).json({ success: false, message: 'proposalGroupId is required' });
      }
      const result = await proposalGroupService.publishProposalGroup(proposalGroupId, req.user.id);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('[COES] proposal-groups publish:', error);
      const msg = error.message || '';
      const status =
        msg === 'Proposal group not found'
          ? 404
          : msg === 'Forbidden' || msg === 'Admin only'
            ? 403
            : msg === 'Proposal group is not open'
              ? 400
              : 400;
      res.status(status).json({
        success: false,
        message: msg || 'Failed to publish proposal group'
      });
    }
  }
);

/**
 * POST /v1/coes/proposal-groups/:proposalGroupId/timer/start
 * Set shared payment deadline for all members (2+ COEs). Mirrors to each COE.
 */
router.post(
  '/proposal-groups/:proposalGroupId/timer/start',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { proposalGroupId } = req.params;
      const hours = req.body?.payment_deadline_hours;
      if (!proposalGroupId || String(proposalGroupId).trim() === '') {
        return res.status(400).json({ success: false, message: 'proposalGroupId is required' });
      }
      const data = await proposalGroupService.startProposalGroupTimer(
        proposalGroupId,
        req.user.id,
        hours,
      );
      res.json({ success: true, data });
    } catch (error) {
      console.error('[COES] proposal-groups timer/start:', error);
      const msg = error.message || '';
      const status =
        msg === 'Proposal group not found'
          ? 404
          : msg === 'Forbidden' || msg === 'Admin only'
            ? 403
            : msg === 'Proposal group is not open' || msg.includes('payment_deadline_hours')
              ? 400
              : 400;
      res.status(status).json({ success: false, message: msg || 'Failed to start group timer' });
    }
  },
);

/**
 * POST /v1/coes/proposal-groups/:proposalGroupId/timer/cancel
 * Clear group timer and mirrored payment deadlines on all members.
 */
router.post(
  '/proposal-groups/:proposalGroupId/timer/cancel',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { proposalGroupId } = req.params;
      if (!proposalGroupId || String(proposalGroupId).trim() === '') {
        return res.status(400).json({ success: false, message: 'proposalGroupId is required' });
      }
      await proposalGroupService.cancelProposalGroupTimer(proposalGroupId, req.user.id);
      res.json({ success: true, message: 'Group payment timer cancelled' });
    } catch (error) {
      console.error('[COES] proposal-groups timer/cancel:', error);
      const msg = error.message || '';
      const status =
        msg === 'Proposal group not found'
          ? 404
          : msg === 'Forbidden' || msg === 'Admin only'
            ? 403
            : msg === 'Proposal group is not open'
              ? 400
              : 400;
      res.status(status).json({ success: false, message: msg || 'Failed to cancel group timer' });
    }
  },
);

/**
 * POST /v1/coes/proposal-groups/:proposalGroupId/timer/reset
 * New payment window from now (same as start).
 */
router.post(
  '/proposal-groups/:proposalGroupId/timer/reset',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { proposalGroupId } = req.params;
      const hours = req.body?.payment_deadline_hours;
      if (!proposalGroupId || String(proposalGroupId).trim() === '') {
        return res.status(400).json({ success: false, message: 'proposalGroupId is required' });
      }
      const data = await proposalGroupService.resetProposalGroupTimer(
        proposalGroupId,
        req.user.id,
        hours,
      );
      res.json({ success: true, data });
    } catch (error) {
      console.error('[COES] proposal-groups timer/reset:', error);
      const msg = error.message || '';
      const status =
        msg === 'Proposal group not found'
          ? 404
          : msg === 'Forbidden' || msg === 'Admin only'
            ? 403
            : 400;
      res.status(status).json({ success: false, message: msg || 'Failed to reset group timer' });
    }
  },
);

/**
 * POST /v1/coes/proposal-groups/:proposalGroupId/expire-proposals
 * Expire all approved/pending_pay/accepted_not_paid members; drafts unchanged. Clears group timer.
 */
router.post(
  '/proposal-groups/:proposalGroupId/expire-proposals',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { proposalGroupId } = req.params;
      if (!proposalGroupId || String(proposalGroupId).trim() === '') {
        return res.status(400).json({ success: false, message: 'proposalGroupId is required' });
      }
      const data = await proposalGroupService.expireAllProposalsInGroup(
        proposalGroupId,
        req.user.id,
      );
      res.json({ success: true, data });
    } catch (error) {
      console.error('[COES] proposal-groups expire-proposals:', error);
      const msg = error.message || '';
      const status =
        msg === 'Proposal group not found'
          ? 404
          : msg === 'Forbidden' || msg === 'Admin only'
            ? 403
            : 400;
      res.status(status).json({ success: false, message: msg || 'Failed to expire proposals' });
    }
  },
);

/**
 * POST /v1/coes/:id/add-proposal
 * Duplicate COE as a sibling draft in the same proposal group (admin = COE admin)
 */
router.post('/:id/add-proposal', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ success: false, message: 'Invalid COE ID format' });
    }
    const coe = await proposalGroupService.duplicateCoeAsProposal(id, req.user.id);
    res.json({ success: true, data: coe });
  } catch (error) {
    console.error('[COES] add-proposal:', error);
    const msg = error.message || '';
    const status =
      msg === 'COE not found'
        ? 404
        : msg === 'Admin only' || msg === 'Forbidden'
          ? 403
          : 400;
    res.status(status).json({
      success: false,
      message: msg || 'Failed to add proposal'
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
 * GET /v1/coes/:id/history
 * Get COE change history incidents
 * @access Admin, client owner, or assigned runner
 */
router.get('/:id/history', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    const coe = await COE.findById(id)
      .select('name client_id admin_id runner_assignment events');

    if (!coe) {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    const userId = req.user.id.toString();
    const isAdmin = req.user.role === 'admin';
    const isClientOwner = coe.client_id?.toString() === userId;
    const isRunner =
      coe.runner_assignment &&
      coe.runner_assignment.runner_id &&
      coe.runner_assignment.runner_id.toString() === userId;

    if (!isAdmin && !isClientOwner && !isRunner) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view this Experience history.'
      });
    }

    const { limit, offset } = req.query;
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 100, 200) : 100;
    const parsedOffset = offset ? parseInt(offset, 10) || 0 : 0;

    const incidents = await getHistoryForCOE(id, {
      limit: parsedLimit,
      offset: parsedOffset
    });

    // Derive simple date range from events if available
    let dateRange = null;
    if (coe.events && coe.events.length > 0) {
      const dates = coe.events
        .map(e => e.event_date)
        .filter(Boolean)
        .map(d => new Date(d));
      if (dates.length > 0) {
        const min = new Date(Math.min.apply(null, dates));
        const max = new Date(Math.max.apply(null, dates));
        dateRange = {
          start: min,
          end: max
        };
      }
    }

    return res.json({
      success: true,
      data: {
        coe: {
          id: coe._id.toString(),
          name: coe.name,
          dateRange
        },
        incidents
      }
    });
  } catch (error) {
    console.error('Error getting COE history:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get COE history',
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

    const coe = await coeService.removeEventsFromCOE(id, [eventId]);

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
    const msg = error.message || '';
    if (
      msg.includes('Cannot remove') ||
      msg.includes('Cannot change events') ||
      msg.includes('revision') ||
      msg.includes('Can only remove events from')
    ) {
      return res.status(400).json({
        success: false,
        message: msg
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

    // Validate request data (status plus optional deposit_percent and payment_deadline_hours)
    const { error, value } = updateCOEStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }

    // Fetch COE for authorization check and optional deposit / deadline update
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
                                ['request', 'draft', 'approved', 'accepted_not_paid', 'pending_pay'].includes(coe.status);
    
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

    // If admin is proposing/approving and provided a valid deposit_percent, persist it
    if (
      isAdmin &&
      typeof value.deposit_percent === 'number' &&
      (value.status === 'approved' || value.status === 'proposal')
    ) {
      coe.deposit_percent = value.deposit_percent;
    }

    // If admin is proposing/approving and provided a payment_deadline_hours, compute deadline
    if (
      isAdmin &&
      typeof value.payment_deadline_hours === 'number' &&
      (value.status === 'approved' || value.status === 'proposal')
    ) {
      const pgid =
        coe.proposal_group_id != null && String(coe.proposal_group_id).trim() !== ''
          ? String(coe.proposal_group_id).trim()
          : '';
      if (pgid) {
        const memberCount = await proposalGroupService.countMembersInGroup(pgid);
        if (memberCount >= 2) {
          return res.status(400).json({
            success: false,
            message:
              'This experience is part of a multi-proposal group. Set or change the payment timer from the group (proposal-groups timer endpoints), not per experience.',
          });
        }
      }
      coe.payment_deadline_hours = value.payment_deadline_hours;
      if (value.payment_deadline_hours > 0) {
        const now = new Date();
        const deadlineMs = now.getTime() + value.payment_deadline_hours * 60 * 60 * 1000;
        coe.payment_deadline_at = new Date(deadlineMs);
      } else {
        // 0 or negative treated as no limit
        coe.payment_deadline_at = undefined;
      }
    }

    // Persist any admin-configured proposal metadata before status transition
    await coe.save();

    const updatedCoe = await coeService.updateCOEStatus(id, value.status, req.user.id);

    res.json({
      success: true,
      message: 'COE status updated successfully',
      data: updatedCoe
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
 * POST /v1/coes/:id/repropose
 * Allow admin to adjust deposit percentage and/or payment time limit
 * for an already proposed (approved) COE without changing its status.
 */
router.post('/:id/repropose', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    // Only admins can re-propose
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only admins can re-propose Experiences.'
      });
    }

    const coe = await COE.findById(id).populate('client_id', '_id');
    if (!coe) {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }

    const { deposit_percent, payment_deadline_hours } = req.body || {};
    const isPaidOrDepositPaid = ['deposit_paid', 'paid'].includes(coe.payment_status);

    // Paid/deposit-paid revision flow: compute revision case + pending_accept.
    if (isPaidOrDepositPaid) {
      // Guard: do not allow revisions for experiences already in the past
      const now = new Date();
      // Prefer experience-level dates (end_date) since `events.event_date` is often start date.
      const endDate = coe?.end_date ? new Date(coe.end_date) : null;
      const isPastExperience =
        endDate && !Number.isNaN(endDate.getTime())
          ? endDate.getTime() < now.getTime()
          : (Array.isArray(coe.events)
              ? coe.events.some(e => {
                  if (!e?.event_date) return false;
                  const d = new Date(e.event_date);
                  // Strictly less-than so same-day doesn't block revisions.
                  return d.getTime() < now.getTime();
                })
              : false);

      if (isPastExperience) {
        return res.status(400).json({
          success: false,
          message: 'Cannot re-propose a past experience'
        });
      }

      // Legacy COEs paid before revision snapshots existed: backfill baseline from current document.
      await coeService.ensureRevisionBaseSnapshotForPaidCOE(coe);

      // For revisions after payment, admin must provide a revision timer (forced).
      // Mobile should send a number, but accept numeric strings too.
      const normalizedPaymentDeadlineHours =
        typeof payment_deadline_hours === 'number'
          ? payment_deadline_hours
          : (typeof payment_deadline_hours === 'string' && payment_deadline_hours.trim().length > 0
              ? Number(payment_deadline_hours)
              : payment_deadline_hours);

      // Fallback: if payload missed it, reuse existing payment_deadline_hours (when valid).
      const fallbackPaymentDeadlineHours =
        typeof coe.payment_deadline_hours === 'number' && coe.payment_deadline_hours > 0
          ? coe.payment_deadline_hours
          : undefined;

      const effectivePaymentDeadlineHours =
        typeof normalizedPaymentDeadlineHours === 'number' && normalizedPaymentDeadlineHours > 0
          ? normalizedPaymentDeadlineHours
          : fallbackPaymentDeadlineHours;

      if (typeof effectivePaymentDeadlineHours !== 'number' || effectivePaymentDeadlineHours <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Revision requires a valid payment_deadline_hours (hours > 0)'
        });
      }

      if (effectivePaymentDeadlineHours < 0 || effectivePaymentDeadlineHours > 720) {
        return res.status(400).json({
          success: false,
          message: 'Payment time limit must be between 0 and 720 hours.'
        });
      }

      // Base snapshot must exist (persisted when deposit/full payment happened).
      const baseSnapshot = coe.revision_base_snapshot;
      const coerceToNumber = (v) => {
        if (typeof v === 'number') return v;
        if (v == null) return undefined;
        if (typeof v === 'string') {
          const trimmed = v.trim();
          if (!trimmed) return undefined;
          const n = Number(trimmed);
          return Number.isNaN(n) ? undefined : n;
        }

        // Handles Decimal128 and other types that can be cast to number.
        const n = Number(v);
        if (!Number.isNaN(n)) return n;
        if (typeof v?.toString === 'function') {
          const n2 = Number(v.toString());
          return Number.isNaN(n2) ? undefined : n2;
        }
        return undefined;
      };

      const baseTotal =
        coerceToNumber(baseSnapshot?.total) ??
        coerceToNumber(baseSnapshot?.total_price) ??
        coerceToNumber(baseSnapshot?.totalPrice) ??
        (coerceToNumber(baseSnapshot?.subtotal) != null ||
          coerceToNumber(baseSnapshot?.taxes) != null ||
          coerceToNumber(baseSnapshot?.fees) != null
          ? (coerceToNumber(baseSnapshot?.subtotal) || 0) +
            (coerceToNumber(baseSnapshot?.taxes) || 0) +
            (coerceToNumber(baseSnapshot?.fees) || 0)
          : undefined) ??
        coerceToNumber(baseSnapshot?.pricing_breakdown?.total) ??
        coerceToNumber(baseSnapshot?.pricing_breakdown?.total_price);

      if (typeof baseTotal !== 'number' || Number.isNaN(baseTotal) || baseTotal < 0) {
        return res.status(400).json({
          success: false,
          message: 'Missing revision base snapshot. Please ensure deposit/full payment was completed normally.'
        });
      }

      // Align subtotal/taxes/total with selected_seats before revision due math (paid / deposit_paid repropose).
      try {
        await coeService.applyPricingFromSelectedSeats(coe);
        await coe.save();
      } catch (recalcErr) {
        console.error('[COES] repropose: pricing recalc failed:', recalcErr.message);
      }

      const currentTotal = typeof coe.total === 'number' ? coe.total : 0;
      // Freeze deposit percent to the last paid value (prefer the stored base snapshot).
      const baseDepositPercent = coerceToNumber(baseSnapshot?.deposit_percent);
      const depositPercentFrozen =
        typeof coe.revision_deposit_percent_frozen === 'number'
          ? coe.revision_deposit_percent_frozen
          : (baseDepositPercent != null
              ? baseDepositPercent
              : coerceToNumber(coe.deposit_percent) ?? 20);

      // Compute revision case + due amounts/credit based on base snapshot totals.
      let revisionCase = null;
      let dueDepositDiff = 0;
      let dueFullDiff = 0;
      let creditBalance = 0;

      if (coe.payment_status === 'deposit_paid') {
        const baseDepositAmount = baseTotal * (depositPercentFrozen / 100);
        if (currentTotal > baseTotal) {
          revisionCase = 'deposit_increased';
          const currentDepositAmount = currentTotal * (depositPercentFrozen / 100);
          dueDepositDiff = Math.max(0, currentDepositAmount - baseDepositAmount);
          dueFullDiff = Math.max(0, currentTotal - baseDepositAmount);
        } else if (currentTotal < baseTotal) {
          revisionCase = 'deposit_decreased';
          dueDepositDiff = 0;
          // Deposit is not changed, only the remaining amount becomes lower (or 0).
          dueFullDiff = Math.max(0, currentTotal - baseDepositAmount);
        } else {
          revisionCase = 'deposit_decreased';
          dueDepositDiff = 0;
          dueFullDiff = 0;
        }
      } else if (coe.payment_status === 'paid') {
        if (currentTotal > baseTotal) {
          revisionCase = 'full_increased';
          // Client may have paid "full" old total while new total implies a higher deposit cap (frozen %).
          // Expose both deposit remainder and balance remainder (Flow 3 hybrid).
          let totalPaidNow =
            coerceToNumber(coe.total_paid) ??
            coerceToNumber(baseSnapshot?.total_paid) ??
            baseTotal;
          if (typeof totalPaidNow !== 'number' || Number.isNaN(totalPaidNow) || totalPaidNow < 0) {
            totalPaidNow = 0;
          }
          const newDepositCap = currentTotal * (depositPercentFrozen / 100);
          dueDepositDiff = Math.max(
            0,
            newDepositCap - Math.min(totalPaidNow, newDepositCap)
          );
          dueFullDiff = Math.max(0, currentTotal - totalPaidNow);
        } else if (currentTotal < baseTotal) {
          revisionCase = 'full_decreased';
          creditBalance = Math.max(0, baseTotal - currentTotal);
        } else {
          revisionCase = 'full_decreased';
          creditBalance = 0;
          dueFullDiff = 0;
        }
      }

      // Enforce deposit percent freeze: ignore payload deposit_percent for revisions after payment.
      coe.revision_state = 'pending_accept';
      coe.revision_case = revisionCase;
      coe.revision_deposit_percent_frozen = depositPercentFrozen;
      coe.revision_deadline_hours = effectivePaymentDeadlineHours;
      coe.revision_deadline_at = new Date(
        now.getTime() + effectivePaymentDeadlineHours * 60 * 60 * 1000
      );
      coe.revision_due_deposit_diff_amount = dueDepositDiff;
      coe.revision_due_full_diff_amount = dueFullDiff;
      coe.client_credit_balance = creditBalance;

      await coe.save();

      // History logging for revision submission
      try {
        await require('../services/coeHistoryService').logIncident({
          coe,
          coeId: coe._id,
          userId: req.user.id,
          userRole: req.user.role || 'admin',
          title: 'Experience revision submitted',
          changes: [
            {
              field: 'revision_state',
              label: 'Revision state',
              from: 'none',
              to: 'pending_accept',
              message: 'Revision submitted; client must accept'
            },
            {
              field: 'revision_case',
              label: 'Revision case',
              from: null,
              to: revisionCase,
              message: `Revision case computed as ${revisionCase}`
            },
            {
              field: 'total',
              label: 'Experience total',
              from: baseTotal,
              to: currentTotal,
              message: `Total updated from $${baseTotal.toFixed(2)} to $${currentTotal.toFixed(2)}`
            },
            {
              field: 'revision_due_deposit_diff_amount',
              label: 'Deposit difference due',
              from: 0,
              to: dueDepositDiff,
              message: `Deposit diff due: $${dueDepositDiff.toFixed(2)}`
            },
            {
              field: 'revision_due_full_diff_amount',
              label: 'Extra difference due',
              from: 0,
              to: dueFullDiff,
              message: `Full diff due: $${dueFullDiff.toFixed(2)}`
            },
            {
              field: 'client_credit_balance',
              label: 'Credit balance',
              from: 0,
              to: creditBalance,
              message: `Credit balance: $${creditBalance.toFixed(2)}`
            }
          ],
          metadata: {
            revision_deadline_at: coe.revision_deadline_at,
            base_total: baseTotal,
            current_total: currentTotal,
            deposit_percent_frozen: depositPercentFrozen
          }
        });
      } catch (historyErr) {
        console.error('[COES] Failed to log revision submission incident:', historyErr.message);
      }

      // Notify client about revision submission (push)
      try {
        if (coe.client_id?._id) {
          await notificationService.createAndSendNotification(
            coe.client_id._id,
            'coe_revision_submitted',
            {
              coe_id: coe._id,
              revision_case: revisionCase,
              credit_amount: creditBalance,
              revision_deadline_hours: payment_deadline_hours,
              coe: { name: coe.name }
            }
          );
        }
      } catch (notifyErr) {
        console.error('[COES] Failed to send revision notification:', notifyErr);
      }

      const updatedCoe = await coeService.getCOEById(id);
      return res.json({
        success: true,
        message: 'Experience revised successfully; client acceptance required',
        data: updatedCoe
      });
    }

    // Proposal re-propose flow (unpaid / approved)
    // Only allow re-propose on already approved (proposal) COEs
    if (coe.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Re-propose is only allowed for Experiences in PROPOSAL status.'
      });
    }

    // Validate and apply deposit percentage if provided
    if (typeof deposit_percent === 'number') {
      if (deposit_percent < 1 || deposit_percent > 100) {
        return res.status(400).json({
          success: false,
          message: 'Deposit percentage must be between 1 and 100.'
        });
      }
      coe.deposit_percent = deposit_percent;
    }

    // Validate and apply time limit if provided
    if (typeof payment_deadline_hours === 'number') {
      if (payment_deadline_hours < 0 || payment_deadline_hours > 720) {
        return res.status(400).json({
          success: false,
          message: 'Payment time limit must be between 0 and 720 hours.'
        });
      }

      coe.payment_deadline_hours = payment_deadline_hours;
      if (payment_deadline_hours > 0) {
        const now = new Date();
        const deadlineMs = now.getTime() + payment_deadline_hours * 60 * 60 * 1000;
        coe.payment_deadline_at = new Date(deadlineMs);
      } else {
        // 0 treated as no limit
        coe.payment_deadline_at = undefined;
      }
    }

    const previousDepositPercent = coe.deposit_percent;
    const previousDeadlineHours = coe.payment_deadline_hours;

    await coe.save();

    // History logging for re-propose (deposit / time limit adjustments)
    try {
      const { logIncident } = require('../services/coeHistoryService');
      const changes = [];

      if (typeof deposit_percent === 'number' && deposit_percent !== previousDepositPercent) {
        changes.push({
          field: 'deposit_percent',
          label: 'Deposit percentage',
          from: previousDepositPercent != null ? `${previousDepositPercent}%` : null,
          to: `${deposit_percent}%`,
          message: `Deposit percentage changed from ${previousDepositPercent != null ? previousDepositPercent : 'unset'}% to ${deposit_percent}%`
        });
      }

      if (typeof payment_deadline_hours === 'number' && payment_deadline_hours !== previousDeadlineHours) {
        changes.push({
          field: 'payment_deadline_hours',
          label: 'Payment time limit',
          from: previousDeadlineHours != null ? `${previousDeadlineHours}h` : null,
          to: `${payment_deadline_hours}h`,
          message: `Payment time limit changed from ${previousDeadlineHours != null ? previousDeadlineHours : 'no limit'} to ${payment_deadline_hours} hours`
        });
      }

      if (changes.length > 0) {
        await logIncident({
          coe,
          coeId: coe._id,
          userId: req.user.id,
          userRole: req.user.role || 'admin',
          title: 'Proposal settings updated',
          changes
        });
      }
    } catch (historyErr) {
      console.error('[COES] Failed to log re-propose history incident:', historyErr.message);
    }

    // Notify client that the Experience has been updated / re-proposed
    if (coe.client_id?._id) {
      try {
        await notificationService.createAndSendNotification(
          coe.client_id._id,
          'coe_approved',
          {
            coe_id: coe._id,
            coe: { name: coe.name },
            sender_name: req.user.firstName || 'The1'
          }
        );
      } catch (notifyErr) {
        console.error('Error sending re-propose notification:', notifyErr);
      }
    }

    // Return fresh COE details
    const updatedCoe = await coeService.getCOEById(id);

    return res.json({
      success: true,
      message: 'Experience re-proposed successfully',
      data: updatedCoe
    });
  } catch (error) {
    console.error('Error re-proposing COE:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to re-propose Experience',
      error: error.message
    });
  }
});

/**
 * POST /v1/coes/:id/revision/expire
 * Admin only: immediately expire an active revision (pending_accept or accepted), revert to revision_base_snapshot,
 * clear revision dues — same outcome as revision timer cron (no COE status=expired path).
 */
router.post('/:id/revision/expire', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format'
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only admins can expire a revision.'
      });
    }

    const result = await coeService.adminExpireRevisionNow(id, req.user.id);
    if (!result.success) {
      const status =
        result.message === 'COE not found'
          ? 404
          : 400;
      return res.status(status).json({
        success: false,
        message: result.message || 'Failed to expire revision'
      });
    }

    const updatedCoe = await coeService.getCOEById(id);
    return res.json({
      success: true,
      message: 'Revision expired. Experience reverted to the last paid version.',
      data: updatedCoe
    });
  } catch (error) {
    console.error('[COES] Error expiring revision:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to expire revision',
      error: error.message
    });
  }
});

/**
 * POST /v1/coes/:id/accept
 * Client: accepted_not_paid when deposit is 100%, or when choosing among N>=2 approved options in an open proposal group.
 * Admin: accept-on-behalf regardless of deposit_percent. Moves into accepted_not_paid without triggering payment.
 */
router.post('/:id/accept', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid COE ID format',
      });
    }

    const coe = await COE.findById(id);
    if (!coe) {
      return res.status(404).json({
        success: false,
        message: 'COE not found',
      });
    }

    // Revision accept flow: allow accept even when COE isn't in the "approved + unpaid" step.
    if (coe.revision_state === 'pending_accept') {
      const role = req.user.role;
      const isAdmin = role === 'admin';
      const isClient = role === 'client';
      const isClientOwner = coe.client_id?.toString() === req.user.id?.toString();

      if (!isAdmin && !isClient) {
        return res.status(403).json({
          success: false,
          message: 'Permission denied',
        });
      }

      if (isClient && !isClientOwner) {
        return res.status(403).json({
          success: false,
          message: 'Permission denied',
        });
      }

      const dueDepositDiff =
        typeof coe.revision_due_deposit_diff_amount === 'number' ? coe.revision_due_deposit_diff_amount : 0;
      const dueFullDiff =
        typeof coe.revision_due_full_diff_amount === 'number' ? coe.revision_due_full_diff_amount : 0;

      // If nothing is due, accepting the revision fully resolves it (e.g., full_decreased credit-only case).
      const autoResolve = dueDepositDiff <= 0 && dueFullDiff <= 0;
      coe.revision_state = autoResolve ? 'resolved' : 'accepted';

      if (autoResolve) {
        coe.revision_deadline_at = undefined;
        coe.revision_deadline_hours = null;
      }

      await coe.save();

      // Log revision acceptance incident
      try {
        const creditBalance = typeof coe.client_credit_balance === 'number' ? coe.client_credit_balance : 0;
        await require('../services/coeHistoryService').logIncident({
          coe,
          coeId: coe._id,
          userId: req.user.id,
          userRole: role,
          title: 'Experience revision accepted',
          changes: [
            {
              field: 'revision_state',
              label: 'Revision state',
              from: 'pending_accept',
              to: coe.revision_state,
              message: autoResolve
                ? 'Client/admin accepted the revision (no payment required)'
                : 'Client/admin accepted the revision'
            },
            ...(coe.revision_case === 'full_decreased' && creditBalance > 0
              ? [
                  {
                    field: 'client_credit_balance',
                    label: 'Client credit balance',
                    from: 0,
                    to: creditBalance,
                    message: `Credit assigned: $${creditBalance.toFixed(2)}`
                  }
                ]
              : [])
          ],
          metadata: {
            revision_case: coe.revision_case
          }
        });
      } catch (historyErr) {
        console.error('[COES] Failed to log revision acceptance incident:', historyErr.message);
      }

      const updatedCoe = await coeService.getCOEById(id);
      return res.json({
        success: true,
        message: 'Experience revision accepted',
        data: updatedCoe,
      });
    }

    // Guard: only accepted steps happen from an approved, unpaid proposal
    if (coe.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'COE must be in approved status to be accepted',
      });
    }

    if (coe.payment_status !== 'unpaid') {
      return res.status(400).json({
        success: false,
        message: 'COE payment must be unpaid to be accepted',
      });
    }

    const depositPercent = typeof coe.deposit_percent === 'number' ? coe.deposit_percent : 20;
    const isAdmin = req.user.role === 'admin';
    const isClient = req.user.role === 'client';
    const isClientOwner = coe.client_id?.toString() === req.user.id?.toString();

    // Client accept: 100% deposit unless choosing among N>=2 approved options in an open proposal group
    if (isClient) {
      if (!isClientOwner) {
        return res.status(403).json({
          success: false,
          message: 'Permission denied',
        });
      }
      const proposalGroupService = require('../services/proposalGroupService');
      const openMultiChoice = await proposalGroupService.clientMayChooseWithoutFullDeposit(coe);
      if (!openMultiChoice && depositPercent !== 100) {
        return res.status(400).json({
          success: false,
          message: 'Client can accept only when deposit is 100%',
        });
      }

      const updatedCoe = await coeService.updateCOEStatus(id, 'accepted_not_paid', req.user.id);
      return res.json({
        success: true,
        message: 'Experience accepted',
        data: updatedCoe,
      });
    }

    // Admin accept-on-behalf: allowed regardless of deposit_percent
    if (isAdmin) {
      const updatedCoe = await coeService.updateCOEStatus(id, 'accepted_not_paid', req.user.id);
      return res.json({
        success: true,
        message: 'Experience accepted on behalf of the client',
        data: updatedCoe,
      });
    }

    return res.status(403).json({
      success: false,
      message: 'Permission denied',
    });
  } catch (error) {
    console.error('[COES] Failed to accept Experience:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to accept Experience',
      error: error.message,
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
 * POST /v1/coes/:id/admin/seat-upgrade
 * Admin-only: replace a selected seat with any available seat from the same event.
 * Body: { current_seat_id, new_seat_id, event_id }
 * @access Admin only
 */
router.post('/:id/admin/seat-upgrade', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { current_seat_id, new_seat_id, event_id } = req.body || {};

    if (!current_seat_id || !new_seat_id || !event_id) {
      return res.status(400).json({
        success: false,
        message: 'current_seat_id, new_seat_id, and event_id are required'
      });
    }

    const updatedCoe = await coeService.adminReplaceSeat(
      id,
      current_seat_id,
      new_seat_id,
      event_id
    );

    res.json({
      success: true,
      message: 'Seat upgraded successfully',
      data: updatedCoe
    });
  } catch (error) {
    console.error('[COES] Error in admin seat upgrade:', error);

    if (error.message === 'COE not found') {
      return res.status(404).json({ success: false, message: 'COE not found' });
    }
    if (error.message === 'Event not found') {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    if (
      error.message.includes('Seat upgrades can only be applied') ||
      error.message.includes('Current seat not found') ||
      error.message.includes('New seat not found') ||
      error.message.includes('New seat is not available')
    ) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to perform admin seat upgrade',
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

    // Process payment using existing payment service (full_payment type for correct COE/Invoice tracking)
    const paymentService = require('../services/paymentService');
    const payment = await paymentService.chargeSavedCard(
      userId,
      token_id,
      coe.total,
      `COE Payment - ${coe.name}`,
      id,
      'full_payment'
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

    if (coeService.isRevisionStructurallyLocked(coe)) {
      return res.status(400).json({
        success: false,
        error:
          'Cannot change events while a revision is awaiting client acceptance or payment. Resolve that revision first.'
      });
    }

    const isPaidLike =
      coe.payment_status === 'paid' ||
      coe.payment_status === 'deposit_paid' ||
      coe.status === 'paid';

    // Build set of event IDs currently in COE (from events array)
    const currentEventIds = new Set();
    (coe.events || []).forEach(e => {
      const eventIdStr = e.event_id?.toString() || e.event_id;
      if (eventIdStr) currentEventIds.add(eventIdStr);
    });

    const eventIdsToRemove = event_ids.map(id => id.toString());
    const remainingEventIds = Array.from(currentEventIds).filter(id => !eventIdsToRemove.includes(id));

    if (remainingEventIds.length === 0) {
      if (isPaidLike) {
        return res.status(400).json({
          success: false,
          error:
            'Cannot remove the last event from a paid experience. At least one event must remain before you submit a revision.'
        });
      }

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

    if (coeService.isRevisionStructurallyLocked(coe)) {
      return res.status(400).json({
        success: false,
        error:
          'Cannot change events while a revision is awaiting client acceptance or payment. Resolve that revision first.'
      });
    }

    const isPaidLike =
      coe.payment_status === 'paid' ||
      coe.payment_status === 'deposit_paid' ||
      coe.status === 'paid';

    // Build set of event IDs currently in COE (from events array)
    const currentEventIds = new Set();
    (coe.events || []).forEach(e => {
      const eventIdStr = e.event_id?.toString() || e.event_id;
      if (eventIdStr) currentEventIds.add(eventIdStr);
    });

    const eventIdsToRemove = event_ids.map(id => id.toString());
    const remainingEventIds = Array.from(currentEventIds).filter(id => !eventIdsToRemove.includes(id));

    if (remainingEventIds.length === 0) {
      if (isPaidLike) {
        return res.status(400).json({
          success: false,
          error:
            'Cannot remove the last event from a paid experience. At least one event must remain before you submit a revision.'
        });
      }

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
    if (coeService.isRevisionStructurallyLocked(coe)) {
      return res.status(400).json({
        success: false,
        error:
          'Cannot change events while a revision is awaiting client acceptance or payment. Resolve that revision first.'
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

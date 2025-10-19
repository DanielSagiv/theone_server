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
    .populate('events.event_id', 'name start_datetime end_datetime location')
    .sort({ created_at: -1 });

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

    // Find COE where user has access (admin, client, runner, or participant)
    const coe = await COE.findOne({
      _id: id,
      $or: [
        { admin_id: userId },
        { client_id: userId },
        { 'runner_assignment.runner_id': userId },
        { 'participants.user_id': userId }
      ]
    })
    .populate('admin_id', 'name email')
    .populate('client_id', 'name email')
    .populate('events.event_id', 'name start_datetime end_datetime location')
    .populate('runner_assignment.runner_id', 'name email');

    if (!coe) {
      return res.status(404).json({
        success: false,
        error: 'COE not found or access denied'
      });
    }

    res.json({
      success: true,
      data: coe
    });
  } catch (error) {
    console.error('Error fetching user COE:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch COE'
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

    const coe = await coeService.updateSeatAssignments(id, value.available_seats);

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

module.exports = router;

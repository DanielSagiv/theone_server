const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const Joi = require('joi');

/**
 * Notification Routes
 * @description API endpoints for push notifications
 */

// Validation schemas
const markReadSchema = Joi.object({
  notificationId: Joi.string().required()
});

/**
 * GET /v1/notifications
 * Get user's notification history
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const filters = {
      read: req.query.read,
      type: req.query.type
    };

    const pagination = {
      page: req.query.page,
      limit: req.query.limit
    };

    const result = await notificationService.getUserNotifications(
      req.user._id,
      filters,
      pagination
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get notifications error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'GET_NOTIFICATIONS_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * PUT /v1/notifications/:notificationId/read
 * Mark notification as read
 */
router.put('/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const notification = await notificationService.markAsRead(
      req.params.notificationId,
      req.user._id
    );

    res.json({
      success: true,
      data: {
        notification
      }
    });
  } catch (error) {
    console.error('Mark notification read error:', {
      notification_id: req.params.notificationId,
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    const statusCode = error.message.includes('not found') ? 404 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: 'MARK_READ_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * PUT /v1/notifications/read-all
 * Mark all user's notifications as read
 */
router.put('/read-all', authenticateToken, async (req, res) => {
  try {
    const result = await notificationService.markAllAsRead(req.user._id);

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: result
    });
  } catch (error) {
    console.error('Mark all read error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'MARK_ALL_READ_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/notifications/unread-count
 * Get unread notification count
 */
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user._id);

    res.json({
      success: true,
      data: {
        unread_count: count
      }
    });
  } catch (error) {
    console.error('Get unread count error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'GET_UNREAD_COUNT_FAILED',
        message: error.message
      }
    });
  }
});

module.exports = router;




const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const messagingService = require('../services/messagingService');
const Joi = require('joi');

/**
 * Messaging Routes
 * @description API endpoints for COE-scoped messaging
 */

// Validation schemas
const sendMessageSchema = Joi.object({
  content: Joi.string().min(1).max(2000).required().trim()
});

/**
 * GET /v1/messaging/coe/:coeId
 * Get all messages for a specific COE
 */
router.get('/coe/:coeId', authenticateToken, async (req, res) => {
  try {
    const pagination = {
      page: req.query.page,
      limit: req.query.limit
    };

    const result = await messagingService.getCOEMessages(
      req.params.coeId,
      req.user._id,
      pagination
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get COE messages error:', {
      coe_id: req.params.coeId,
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    const statusCode = error.message.includes('Access denied') ? 403 : 
                      error.message.includes('not found') ? 404 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: 'GET_MESSAGES_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /v1/messaging/coe/:coeId
 * Send a message to COE thread
 */
router.post('/coe/:coeId', authenticateToken, async (req, res) => {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  console.log(`[MessagingRoute] [${requestId}] [${new Date().toISOString()}] POST /coe/:coeId called:`, {
    coe_id: req.params.coeId,
    user_id: req.user._id?.toString(),
    content_length: req.body?.content?.length,
    ip: req.ip,
    user_agent: req.get('user-agent')
  });
  
  try {
    const { error, value } = sendMessageSchema.validate(req.body);
    if (error) {
      console.log(`[MessagingRoute] [${requestId}] Validation error:`, error.details[0].message);
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    console.log(`[MessagingRoute] [${requestId}] Calling sendCOEMessage...`);
    const message = await messagingService.sendCOEMessage(
      req.params.coeId,
      req.user._id,
      value.content
    );

    const duration = Date.now() - startTime;
    console.log(`[MessagingRoute] [${requestId}] Message sent successfully in ${duration}ms:`, {
      message_id: message._id?.toString(),
      duration_ms: duration
    });

    res.json({
      success: true,
      data: {
        message
      }
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[MessagingRoute] [${requestId}] Send COE message error (${duration}ms):`, {
      coe_id: req.params.coeId,
      user_id: req.user._id?.toString(),
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    const statusCode = error.message.includes('Access denied') ? 403 : 
                      error.message.includes('not found') ? 404 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: 'SEND_MESSAGE_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * PUT /v1/messaging/:messageId/read
 * Mark a specific message as read
 */
router.put('/:messageId/read', authenticateToken, async (req, res) => {
  try {
    const message = await messagingService.markMessageAsRead(
      req.params.messageId,
      req.user._id
    );

    res.json({
      success: true,
      data: {
        message
      }
    });
  } catch (error) {
    console.error('Mark message read error:', {
      message_id: req.params.messageId,
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    const statusCode = error.message.includes('Access denied') ? 403 : 
                      error.message.includes('not found') ? 404 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: 'MARK_MESSAGE_READ_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/messaging/coe/:coeId/unread
 * Get unread message count for current user
 */
router.get('/coe/:coeId/unread', authenticateToken, async (req, res) => {
  try {
    const count = await messagingService.getUnreadCount(
      req.params.coeId,
      req.user._id
    );

    res.json({
      success: true,
      data: {
        unread_count: count
      }
    });
  } catch (error) {
    console.error('Get unread count error:', {
      coe_id: req.params.coeId,
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    const statusCode = error.message.includes('Access denied') ? 403 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: 'GET_UNREAD_COUNT_FAILED',
        message: error.message
      }
    });
  }
});

module.exports = router;




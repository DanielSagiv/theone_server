const express = require('express');
const router = express.Router();
const Joi = require('joi');

const { authenticateToken } = require('../middleware/auth');
const { getConversationHistory, sendBotMessage } = require('../services/botService');
const { userRateLimit, ipRateLimit, costLimitCheck } = require('../middleware/botRateLimiter');
const { generateCorrelationId } = require('../utils/botUtils');

const sendMessageSchema = Joi.object({
  prompt: Joi.string().min(1).max(4000).required()
});

/**
 * GET /v1/bot/conversation
 * @description Fetch conversation history for current user
 */
router.get('/conversation', authenticateToken, async (req, res) => {
  try {
    const history = await getConversationHistory(req.user._id, { role: req.user.role });
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('Error fetching bot conversation:', error);
    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch conversation history',
        details: error.message
      }
    });
  }
});

/**
 * POST /v1/bot/message
 * @description Send a user prompt to the bot and receive a response
 * @middleware Rate limiting (per-user, per-IP), cost checking
 */
router.post('/message', 
  authenticateToken,
  ipRateLimit,
  userRateLimit,
  costLimitCheck,
  async (req, res) => {
    try {
      const { error, value } = sendMessageSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation error',
            category: 'validation',
            retryable: false,
            details: error.details[0].message
          }
        });
      }

      // Generate correlation ID for tracing
      const correlationId = generateCorrelationId();
      
      // Add correlation ID to response headers
      res.set('X-Correlation-ID', correlationId);

      // Pass user object and correlation ID for tool execution and permissions
      const updatedHistory = await sendBotMessage(req.user._id, value.prompt, req.user, correlationId);
      
      res.json({
        success: true,
        data: updatedHistory,
        correlation_id: correlationId
      });
    } catch (error) {
      console.error('Error sending bot message:', error);
      console.error('Error stack:', error.stack);
      console.error('Error details:', {
        message: error.message,
        name: error.name,
        code: error.code,
        userId: req.user?._id?.toString(),
        prompt: req.body?.prompt?.substring(0, 200)
      });
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process bot message',
          category: 'service',
          retryable: true,
          details: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }
      });
    }
  }
);

module.exports = router;


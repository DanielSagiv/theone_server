const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');
const Joi = require('joi');

/**
 * Subscription Routes - Recurring Billing
 * @description API endpoints for subscription management
 */

// Validation Schemas
const createSubscriptionSchema = Joi.object({
  tier: Joi.string().valid('basic', 'premium', 'vip', 'elite').required(),
  frequency: Joi.string().valid('monthly', 'yearly').required(),
  payment_token_id: Joi.string().required()
});

const cancelSubscriptionSchema = Joi.object({
  reason: Joi.string().optional()
});

const updatePaymentMethodSchema = Joi.object({
  payment_token_id: Joi.string().required()
});

/**
 * POST /v1/subscriptions
 * Create new membership subscription
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Validate input
    const { error, value } = createSubscriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }
    
    const { tier, frequency, payment_token_id } = value;
    
    const result = await subscriptionService.createSubscription(
      req.user._id,
      tier,
      frequency,
      payment_token_id
    );
    
    res.json({
      success: true,
      data: result,
      message: 'Subscription created successfully'
    });
    
  } catch (error) {
    console.error('Create subscription error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({
      success: false,
      error: {
        code: 'SUBSCRIPTION_CREATION_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/subscriptions/my
 * Get current user's subscriptions
 */
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const subscriptions = await subscriptionService.getUserSubscriptions(req.user._id);
    
    res.json({
      success: true,
      data: subscriptions
    });
    
  } catch (error) {
    console.error('Get subscriptions error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_SUBSCRIPTIONS_FAILED',
        message: 'Failed to retrieve subscriptions'
      }
    });
  }
});

/**
 * GET /v1/subscriptions/pricing
 * Get membership pricing (public)
 */
router.get('/pricing', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        pricing: subscriptionService.MEMBERSHIP_PRICING,
        tiers: {
          basic: {
            name: 'Basic',
            benefits: [
              'Access to events',
              '5% COE discount',
              'Priority support'
            ]
          },
          premium: {
            name: 'Premium',
            benefits: [
              'All Basic benefits',
              '10% COE discount',
              'Priority booking',
              'Exclusive event access'
            ]
          },
          vip: {
            name: 'VIP',
            benefits: [
              'All Premium benefits',
              '15% COE discount',
              'Concierge service',
              'VIP event access'
            ]
          },
          elite: {
            name: 'Elite',
            benefits: [
              'All VIP benefits',
              '20% COE discount',
              'Dedicated event runner',
              'Exclusive elite events',
              'Personal concierge'
            ]
          }
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * GET /v1/subscriptions/:id
 * Get subscription details
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const subscription = await subscriptionService.getSubscriptionById(
      req.params.id,
      req.user._id
    );
    
    res.json({
      success: true,
      data: subscription
    });
    
  } catch (error) {
    console.error('Get subscription error:', {
      subscription_id: req.params.id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(404).json({
      success: false,
      error: {
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: error.message
      }
    });
  }
});

/**
 * POST /v1/subscriptions/:id/cancel
 * Cancel subscription
 */
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { error, value } = cancelSubscriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }
    
    const result = await subscriptionService.cancelSubscription(
      req.params.id,
      req.user._id,
      value.reason
    );
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Cancel subscription error:', {
      subscription_id: req.params.id,
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({
      success: false,
      error: {
        code: 'SUBSCRIPTION_CANCELLATION_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * PUT /v1/subscriptions/:id/payment-method
 * Update subscription payment method
 */
router.put('/:id/payment-method', authenticateToken, async (req, res) => {
  try {
    const { error, value } = updatePaymentMethodSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }
    
    const subscription = await subscriptionService.updateSubscriptionPaymentMethod(
      req.params.id,
      req.user._id,
      value.payment_token_id
    );
    
    res.json({
      success: true,
      data: subscription,
      message: 'Payment method updated successfully'
    });
    
  } catch (error) {
    console.error('Update payment method error:', {
      subscription_id: req.params.id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({
      success: false,
      error: {
        code: 'UPDATE_PAYMENT_METHOD_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/subscriptions (admin only)
 * Get all subscriptions with optional filters
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, tier } = req.query;
    
    const subscriptions = await subscriptionService.getAllSubscriptions({
      status,
      tier
    });
    
    res.json({
      success: true,
      data: subscriptions
    });
    
  } catch (error) {
    console.error('Get all subscriptions error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_SUBSCRIPTIONS_FAILED',
        message: 'Failed to retrieve subscriptions'
      }
    });
  }
});

module.exports = router;


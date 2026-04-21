const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Payment = require('../models/Payment');
const paymentService = require('./paymentService');

/**
 * Subscription Service - Recurring Billing
 * @description Handles subscription creation, billing, and management
 */

// Membership pricing configuration
const MEMBERSHIP_PRICING = {
  basic: { monthly: 49, yearly: 490 },
  premium: { monthly: 99, yearly: 990 },
  vip: { monthly: 199, yearly: 1990 },
  elite: { monthly: 499, yearly: 4999 }
};

/**
 * Create subscription
 * @param {string} userId - User ID
 * @param {string} tier - Membership tier (basic, premium, vip, elite)
 * @param {string} frequency - Billing frequency (monthly, yearly)
 * @param {string} paymentTokenId - Saved payment token
 * @returns {Promise<Object>} Subscription data
 */
async function createSubscription(userId, tier, frequency, paymentTokenId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    // Verify payment token exists
    const savedMethod = user.saved_payment_methods.find(m => m.token_id === paymentTokenId);
    if (!savedMethod) {
      throw new Error('Payment method not found. Please save a payment method first.');
    }
    
    // Check for existing active subscription
    const existingSubscription = await Subscription.findOne({
      user_id: userId,
      status: 'active'
    });
    
    if (existingSubscription) {
      throw new Error('User already has an active subscription. Cancel existing subscription first.');
    }
    
    // Get pricing
    const amount = MEMBERSHIP_PRICING[tier][frequency];
    if (!amount) {
      throw new Error('Invalid tier or frequency');
    }
    
    // Calculate dates
    const startDate = new Date();
    const nextBillingDate = new Date(startDate);
    
    if (frequency === 'monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }
    
    // Create subscription record
    const subscription = new Subscription({
      user_id: userId,
      tier,
      frequency,
      amount,
      currency: 'USD',
      start_date: startDate,
      current_period_start: startDate,
      current_period_end: nextBillingDate,
      next_billing_date: nextBillingDate,
      payment_token_id: paymentTokenId,
      card_last_four: savedMethod.card_last_four,
      card_brand: savedMethod.card_brand,
      status: 'active'
    });
    
    await subscription.save();
    
    // Process first payment immediately
    const firstPayment = await paymentService.chargeSavedCard(
      userId,
      paymentTokenId,
      amount,
      `${tier.toUpperCase()} Membership - ${frequency} billing`,
      null
    );
    
    // Update subscription with first payment info
    subscription.total_payments = 1;
    subscription.total_amount_paid = amount;
    subscription.last_payment_date = new Date();
    subscription.last_payment_id = firstPayment._id;
    await subscription.save();
    
    // Update user membership status
    user.membership_status = 'active';
    user.membership_tier = tier;
    user.membership_started_at = startDate;
    user.membership_expires_at = nextBillingDate;
    user.active_subscription_id = subscription._id;
    await user.save();
    
    console.log('Subscription created:', {
      user_id: userId,
      subscription_id: subscription._id,
      tier,
      frequency,
      amount,
      next_billing: nextBillingDate,
      timestamp: new Date().toISOString()
    });
    
    return {
      subscription,
      first_payment: firstPayment
    };
    
  } catch (error) {
    console.error('Subscription creation failed:', {
      user_id: userId,
      tier,
      frequency,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Process subscription payment (called by cron job)
 * @param {string} subscriptionId - Subscription ID
 * @param {boolean} isFirstPayment - Is this the first payment
 * @returns {Promise<Object>} Payment result
 */
async function processSubscriptionPayment(subscriptionId, isFirstPayment = false) {
  try {
    const subscription = await Subscription.findById(subscriptionId).populate('user_id');
    
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    if (subscription.status !== 'active') {
      throw new Error(`Cannot process payment for ${subscription.status} subscription`);
    }
    
    // Charge saved card
    const payment = await paymentService.chargeSavedCard(
      subscription.user_id._id,
      subscription.payment_token_id,
      subscription.amount,
      `${subscription.tier.toUpperCase()} Membership - ${subscription.frequency} billing`,
      null
    );
    
    // Update subscription
    subscription.total_payments += 1;
    subscription.total_amount_paid += subscription.amount;
    subscription.last_payment_date = new Date();
    subscription.last_payment_id = payment._id;
    
    // Calculate next billing date
    const nextBilling = new Date(subscription.next_billing_date);
    if (subscription.frequency === 'monthly') {
      nextBilling.setMonth(nextBilling.getMonth() + 1);
    } else {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1);
    }
    
    subscription.current_period_start = subscription.next_billing_date;
    subscription.current_period_end = nextBilling;
    subscription.next_billing_date = nextBilling;
    
    await subscription.save();
    
    // Update user membership expiration
    const user = subscription.user_id;
    user.membership_expires_at = nextBilling;
    await user.save();
    
    console.log('Subscription payment processed:', {
      subscription_id: subscriptionId,
      payment_id: payment._id,
      amount: subscription.amount,
      next_billing: nextBilling,
      timestamp: new Date().toISOString()
    });
    
    return payment;
    
  } catch (error) {
    console.error('Subscription payment failed:', {
      subscription_id: subscriptionId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    // Update subscription with failure
    const subscription = await Subscription.findById(subscriptionId);
    if (subscription) {
      subscription.failed_payments += 1;
      subscription.last_failure_date = new Date();
      subscription.last_failure_reason = error.message;
      
      // Suspend after 3 failures
      if (subscription.failed_payments >= 3) {
        subscription.status = 'failed';
        
        const user = await User.findById(subscription.user_id);
        if (user) {
          user.membership_status = 'suspended';
          await user.save();
        }
        
        console.log('Subscription suspended after 3 failures:', {
          subscription_id: subscriptionId,
          timestamp: new Date().toISOString()
        });
      }
      
      await subscription.save();
    }
    
    throw error;
  }
}

/**
 * Cancel subscription
 * @param {string} subscriptionId - Subscription ID
 * @param {string} userId - User ID (for authorization)
 * @param {string} reason - Cancellation reason
 * @returns {Promise<Object>} Cancellation result
 */
async function cancelSubscription(subscriptionId, userId, reason = '') {
  try {
    const subscription = await Subscription.findById(subscriptionId);
    
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    // Verify user owns this subscription
    if (subscription.user_id.toString() !== userId.toString()) {
      throw new Error('Unauthorized: You can only cancel your own subscription');
    }
    
    if (subscription.status === 'cancelled') {
      throw new Error('Subscription already cancelled');
    }
    
    // Update subscription
    subscription.status = 'cancelled';
    subscription.cancelled_at = new Date();
    subscription.cancellation_reason = reason;
    subscription.cancelled_by = userId;
    subscription.end_date = subscription.current_period_end; // Access until period ends
    await subscription.save();
    
    // Update user (membership expires at end of current period)
    const user = await User.findById(userId);
    if (user) {
      user.membership_status = 'cancelled';
      await user.save();
    }
    
    console.log('Subscription cancelled:', {
      subscription_id: subscriptionId,
      user_id: userId,
      access_until: subscription.end_date,
      timestamp: new Date().toISOString()
    });
    
    return {
      subscription,
      access_until: subscription.end_date,
      message: 'Subscription cancelled. Access continues until end of current billing period.'
    };
    
  } catch (error) {
    console.error('Subscription cancellation failed:', {
      subscription_id: subscriptionId,
      user_id: userId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Get user's subscriptions
 * @param {string} userId - User ID
 * @returns {Promise<Array>} User subscriptions
 */
async function getUserSubscriptions(userId) {
  try {
    const subscriptions = await Subscription.find({ user_id: userId })
      .sort({ created_at: -1 });
    
    return subscriptions;
  } catch (error) {
    console.error('Error getting user subscriptions:', {
      user_id: userId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Get subscription by ID
 * @param {string} subscriptionId - Subscription ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Subscription
 */
async function getSubscriptionById(subscriptionId, userId) {
  try {
    const subscription = await Subscription.findById(subscriptionId)
      .populate('user_id', 'firstName lastName email');
    
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    // Verify user owns this subscription
    if (subscription.user_id._id.toString() !== userId.toString()) {
      throw new Error('Unauthorized');
    }
    
    return subscription;
  } catch (error) {
    console.error('Error getting subscription:', {
      subscription_id: subscriptionId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Update subscription payment method
 * @param {string} subscriptionId - Subscription ID
 * @param {string} userId - User ID
 * @param {string} newTokenId - New payment token ID
 * @returns {Promise<Object>} Updated subscription
 */
async function updateSubscriptionPaymentMethod(subscriptionId, userId, newTokenId) {
  try {
    const subscription = await Subscription.findById(subscriptionId);
    
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    // Verify ownership
    if (subscription.user_id.toString() !== userId.toString()) {
      throw new Error('Unauthorized');
    }
    
    const user = await User.findById(userId);
    const newMethod = user.saved_payment_methods.find(m => m.token_id === newTokenId);
    
    if (!newMethod) {
      throw new Error('Payment method not found');
    }
    
    // Update subscription
    subscription.payment_token_id = newTokenId;
    subscription.card_last_four = newMethod.card_last_four;
    subscription.card_brand = newMethod.card_brand;
    subscription.failed_payments = 0; // Reset failure count
    
    // Reactivate if was failed
    if (subscription.status === 'failed') {
      subscription.status = 'active';
      
      user.membership_status = 'active';
      await user.save();
    }
    
    await subscription.save();
    
    console.log('Subscription payment method updated:', {
      subscription_id: subscriptionId,
      new_token_id: newTokenId,
      timestamp: new Date().toISOString()
    });
    
    return subscription;
    
  } catch (error) {
    console.error('Update payment method failed:', {
      subscription_id: subscriptionId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Get all subscriptions (admin only)
 * @param {Object} filters - Query filters
 * @returns {Promise<Array>} Subscriptions
 */
async function getAllSubscriptions(filters = {}) {
  try {
    const query = {};
    
    if (filters.status) query.status = filters.status;
    if (filters.tier) query.tier = filters.tier;
    
    const subscriptions = await Subscription.find(query)
      .populate('user_id', 'firstName lastName email')
      .sort({ created_at: -1 });
    
    return subscriptions;
  } catch (error) {
    console.error('Error getting all subscriptions:', error);
    throw error;
  }
}

/**
 * Charge and unlock required annual subscription gate for approved clients.
 * @param {string} userId
 * @param {string} paymentTokenId
 */
async function payRequiredAnnualSubscription(userId, paymentTokenId) {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  if (user.role !== 'client') {
    throw new Error('Only client users can pay required annual subscription');
  }
  if (user.entity_status !== 'live') {
    throw new Error('Account must be approved before paying subscription');
  }

  const now = new Date();
  const hasValidSubscription =
    user.subscription_required !== true &&
    user.subscription_expires_at &&
    new Date(user.subscription_expires_at) > now;
  if (hasValidSubscription) {
    throw new Error('Required annual subscription is already active');
  }

  const amount = 1000;
  const payment = await paymentService.chargeSavedCard(
    userId,
    paymentTokenId,
    amount,
    'Required annual subscription',
    null,
    'subscription'
  );

  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  user.subscription_required = false;
  user.subscription_paid_at = now;
  user.subscription_expires_at = expiresAt;
  await user.save();

  return {
    payment,
    subscription_paid_at: now,
    subscription_expires_at: expiresAt,
    amount,
  };
}

module.exports = {
  createSubscription,
  processSubscriptionPayment,
  cancelSubscription,
  getUserSubscriptions,
  getSubscriptionById,
  updateSubscriptionPaymentMethod,
  getAllSubscriptions,
  MEMBERSHIP_PRICING,
  payRequiredAnnualSubscription
};


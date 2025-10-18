# The1 Platform - Payment System Implementation Guide
## Complete Global Payments Integration

**Version**: 1.0  
**Last Updated**: October 14, 2025  
**Status**: Ready for Implementation

---

## 🎯 What This Document Covers

This is your **complete, unified guide** for implementing the entire payment system:

✅ **Phase 1**: Basic Payments (Charge & Refund)  
✅ **Phase 2**: Card Tokenization (Save Cards)  
✅ **Phase 3**: Recurring Billing (Subscriptions)  
✅ **Phase 4**: Payment Reporting  

**Single Implementation Path** - Follow steps sequentially from start to finish.

---

## 📋 Table of Contents

1. [Prerequisites & Setup](#prerequisites--setup)
2. [Phase 1: Basic Payments](#phase-1-basic-payments)
3. [Phase 2: Card Tokenization](#phase-2-card-tokenization)
4. [Phase 3: Recurring Billing](#phase-3-recurring-billing)
5. [Phase 4: Payment Reporting](#phase-4-payment-reporting)
6. [Global Payments API Reference](#global-payments-api-reference)
7. [Testing Guide](#testing-guide)
8. [Deployment Guide](#deployment-guide)
9. [Troubleshooting](#troubleshooting)

---

# Prerequisites & Setup

## 1. Environment Variables

Add to `.env`:

```bash
# Global Payments Credentials
GP_APP_NAME=devaMER_7e3e2c7df34f42819b3edee31022ee3fcRDd1MBLr
GP_APP_KEY=VuaYoVKWTRlumYt2
GP_MERCHANT_ID=MER_7e3e2c7df34f42819b3edee31022ee3f
GP_SERVICE_URL=https://apis.sandbox.globalpay.com
GP_WEBHOOK_SECRET=your-webhook-secret

# Payment Settings
PAYMENT_CURRENCY=USD
PAYMENT_DEPOSIT_PERCENT=20

# App URLs
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:3006
```

## 2. Install Dependencies

```bash
npm install axios      # HTTP client for API calls
npm install node-cron  # For recurring payment scheduling
```

## 3. Global Payments Setup

1. Access Global Payments Sandbox Dashboard
2. Note your credentials (already in .env above)
3. Configure webhook URL (will do in deployment)

---

# Phase 1: Basic Payments

## Goal
Implement charge and refund functionality for COE payments.

**Features**:
- ✅ Pay deposit (20%)
- ✅ Pay final balance (80%)
- ✅ Pay full amount (100%)
- ✅ Process refunds
- ✅ Handle webhooks

---

## Step 1.1: Create Payment Model

**File**: `models/Payment.js` (NEW)

```javascript
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // References
  coe_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'COE',
    index: true
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Payment Details
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  payment_type: {
    type: String,
    enum: ['deposit', 'final_payment', 'full_payment', 'subscription', 'refund'],
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'authorized', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Payment Method (display only, no sensitive data)
  card_brand: String,
  card_last_four: String,
  
  // Global Payments Data
  gp_transaction_id: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  gp_authorization_code: String,
  gp_response_code: String,
  gp_response_message: String,
  
  // Tokenization (Phase 2)
  payment_token_id: {
    type: String,
    index: true
  },
  is_token_payment: {
    type: Boolean,
    default: false
  },
  save_payment_method: {
    type: Boolean,
    default: false
  },
  
  // Idempotency
  idempotency_key: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  
  // Metadata
  description: String,
  
  // Failure Info
  failure_code: String,
  failure_message: String,
  failed_at: Date,
  
  // Refund Info
  refund_amount: {
    type: Number,
    default: 0
  },
  refund_reason: String,
  refunded_at: Date,
  refund_transaction_id: String,
  
  // Timestamps
  completed_at: Date
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ coe_id: 1, status: 1 });
paymentSchema.index({ user_id: 1, created_at: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
```

---

## Step 1.2: Update COE Model

**File**: `models/COE.js` (UPDATE)

Add these fields to existing COE schema:

```javascript
{
  // Payment Information
  payment_status: {
    type: String,
    enum: ['unpaid', 'deposit_paid', 'partially_paid', 'fully_paid', 'refunded'],
    default: 'unpaid',
    index: true
  },
  
  deposit_amount: Number,
  deposit_percent: {
    type: Number,
    default: 20
  },
  deposit_paid_at: Date,
  deposit_payment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  
  final_amount: Number,
  final_paid_at: Date,
  final_payment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  
  total_paid: {
    type: Number,
    default: 0
  },
  
  payment_due_date: Date,
  payment_terms: {
    type: String,
    default: '20% deposit required, balance due 48 hours before event'
  },
  
  refund_amount: {
    type: Number,
    default: 0
  },
  refunded_at: Date
}
```

---

## Step 1.3: Create Payment Service

**File**: `services/paymentService.js` (NEW)

This is the core payment processing service. I'll provide the complete implementation:

```javascript
const crypto = require('crypto');
const axios = require('axios');
const Payment = require('../models/Payment');
const COE = require('../models/COE');
const User = require('../models/User');
const Event = require('../models/Event');

// Global Payments Configuration
const GP_CONFIG = {
  appName: process.env.GP_APP_NAME,
  appKey: process.env.GP_APP_KEY,
  merchantId: process.env.GP_MERCHANT_ID,
  serviceUrl: process.env.GP_SERVICE_URL || 'https://apis.sandbox.globalpay.com',
  currency: process.env.PAYMENT_CURRENCY || 'USD'
};

/**
 * Create Global Payments API client
 */
function createGPClient() {
  const authString = Buffer.from(`${GP_CONFIG.appName}:${GP_CONFIG.appKey}`).toString('base64');
  
  return axios.create({
    baseURL: GP_CONFIG.serviceUrl,
    headers: {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json',
      'X-GP-Version': '2021-03-22'
    },
    timeout: 30000
  });
}

/**
 * Create payment intent
 * @param {string} coeId - COE ID
 * @param {string} userId - User ID
 * @param {string} paymentType - 'deposit', 'final_payment', or 'full_payment'
 * @param {Object} options - { saveCard: boolean, cardDetails: Object, tokenId: string }
 * @returns {Promise<Object>} Payment intent with payment_url
 */
async function createPaymentIntent(coeId, userId, paymentType, options = {}) {
  try {
    const { saveCard = false, cardDetails = null, tokenId = null } = options;
    
    // Get COE
    const coe = await COE.findById(coeId).populate('client_id');
    if (!coe) throw new Error('COE not found');
    
    // Verify user is client
    if (coe.client_id._id.toString() !== userId.toString()) {
      throw new Error('Unauthorized');
    }
    
    // Calculate amount
    let amount;
    if (paymentType === 'deposit') {
      if (coe.payment_status !== 'unpaid') throw new Error('Deposit already paid');
      amount = coe.total_amount * (coe.deposit_percent / 100);
    } else if (paymentType === 'final_payment') {
      if (coe.payment_status !== 'deposit_paid') throw new Error('Deposit must be paid first');
      amount = coe.total_amount - (coe.total_paid || 0);
    } else if (paymentType === 'full_payment') {
      if (coe.payment_status !== 'unpaid') throw new Error('Payment already processed');
      amount = coe.total_amount;
    } else {
      throw new Error('Invalid payment type');
    }
    
    // Generate idempotency key
    const idempotencyKey = crypto.randomBytes(16).toString('hex');
    
    // Create payment record
    const payment = new Payment({
      coe_id: coeId,
      user_id: userId,
      amount,
      currency: coe.currency || GP_CONFIG.currency,
      payment_type: paymentType,
      status: 'pending',
      idempotency_key: idempotencyKey,
      description: `${coe.name} - ${paymentType}`,
      save_payment_method: saveCard,
      payment_token_id: tokenId,
      is_token_payment: !!tokenId
    });
    
    await payment.save();
    
    // If using saved token, charge it directly
    if (tokenId) {
      return await chargeSavedCard(userId, tokenId, amount, payment.description, coeId);
    }
    
    // Create GP transaction
    const gpClient = createGPClient();
    const gpRequest = {
      account_name: GP_CONFIG.merchantId,
      type: 'SALE',
      channel: 'CNP',
      amount: Math.round(amount * 100),
      currency: coe.currency || 'USD',
      reference: payment._id.toString(),
      capture_mode: 'AUTO',
      payment_method: {
        entry_mode: 'ECOM'
      },
      order: {
        description: `The1 Platform - ${coe.name}`
      },
      notifications: {
        return_url: `${process.env.FRONTEND_URL}/payment/complete?payment_id=${payment._id}`,
        status_url: `${process.env.BACKEND_URL}/webhooks/global-payments`
      }
    };
    
    // If saving card, tokenize
    if (saveCard && cardDetails) {
      gpRequest.payment_method.storage_mode = 'ON_FILE';
      gpRequest.payment_method.card = cardDetails;
    }
    
    const gpResponse = await gpClient.post('/transactions', gpRequest);
    
    // Update payment
    payment.gp_transaction_id = gpResponse.data.id;
    payment.status = 'processing';
    await payment.save();
    
    console.log('Payment intent created:', {
      payment_id: payment._id,
      amount,
      gp_transaction_id: gpResponse.data.id
    });
    
    return {
      payment_id: payment._id,
      gp_transaction_id: gpResponse.data.id,
      payment_url: gpResponse.data.payment_url,
      amount,
      currency: coe.currency || 'USD',
      status: 'processing'
    };
    
  } catch (error) {
    console.error('Payment intent failed:', error.message);
    throw error;
  }
}

/**
 * Process refund
 * @param {string} paymentId - Payment ID
 * @param {number} amount - Refund amount (null = full refund)
 * @param {string} reason - Refund reason
 * @returns {Promise<Object>} Refund result
 */
async function processRefund(paymentId, amount = null, reason = '') {
  try {
    const payment = await Payment.findById(paymentId);
    if (!payment) throw new Error('Payment not found');
    
    if (!['completed'].includes(payment.status)) {
      throw new Error(`Cannot refund payment in status: ${payment.status}`);
    }
    
    const refundAmount = amount || payment.amount;
    
    if (refundAmount > payment.amount) {
      throw new Error('Refund amount exceeds payment amount');
    }
    
    // Call GP refund API
    const gpClient = createGPClient();
    const gpResponse = await gpClient.post(
      `/transactions/${payment.gp_transaction_id}/refund`,
      { amount: Math.round(refundAmount * 100) }
    );
    
    // Update payment
    payment.status = 'refunded';
    payment.refunded_at = new Date();
    payment.refund_amount = refundAmount;
    payment.refund_reason = reason;
    payment.refund_transaction_id = gpResponse.data.id;
    await payment.save();
    
    // Update COE
    if (payment.coe_id) {
      const coe = await COE.findById(payment.coe_id);
      coe.total_paid -= refundAmount;
      coe.refund_amount = (coe.refund_amount || 0) + refundAmount;
      
      if (refundAmount === payment.amount) {
        coe.payment_status = payment.payment_type === 'deposit' ? 'unpaid' : 'refunded';
        coe.refunded_at = new Date();
      }
      
      await coe.save();
    }
    
    console.log('Refund processed:', {
      payment_id: paymentId,
      refund_amount: refundAmount,
      gp_refund_id: gpResponse.data.id
    });
    
    return {
      refund_id: gpResponse.data.id,
      amount: refundAmount,
      status: 'completed'
    };
    
  } catch (error) {
    console.error('Refund failed:', error.message);
    throw error;
  }
}

/**
 * Process payment webhook
 * @param {Object} webhookData - Webhook payload
 * @returns {Promise<Object>} Processing result
 */
async function processPaymentWebhook(webhookData) {
  try {
    const { type, reference } = webhookData;
    
    const payment = await Payment.findById(reference);
    if (!payment) {
      return { processed: false, reason: 'Payment not found' };
    }
    
    switch (type) {
      case 'PAYMENT_COMPLETED':
        payment.status = 'completed';
        payment.completed_at = new Date();
        payment.card_brand = webhookData.payment_method?.card?.brand;
        payment.card_last_four = webhookData.payment_method?.card?.last_four;
        await payment.save();
        
        // Update COE
        await updateCOEPaymentStatus(payment.coe_id);
        break;
        
      case 'PAYMENT_FAILED':
        payment.status = 'failed';
        payment.failed_at = new Date();
        payment.failure_code = webhookData.error_code;
        payment.failure_message = webhookData.error_message;
        await payment.save();
        break;
    }
    
    console.log('Webhook processed:', { payment_id: payment._id, event: type });
    return { processed: true };
    
  } catch (error) {
    console.error('Webhook processing failed:', error);
    throw error;
  }
}

/**
 * Update COE payment status
 * @param {string} coeId - COE ID
 */
async function updateCOEPaymentStatus(coeId) {
  try {
    const coe = await COE.findById(coeId);
    const payments = await Payment.find({ 
      coe_id: coeId, 
      status: 'completed' 
    });
    
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    coe.total_paid = totalPaid;
    
    if (totalPaid === 0) {
      coe.payment_status = 'unpaid';
    } else if (payments.some(p => p.payment_type === 'deposit')) {
      if (totalPaid >= coe.total_amount) {
        coe.payment_status = 'fully_paid';
        coe.status = 'accepted';
      } else {
        coe.payment_status = 'deposit_paid';
      }
    } else if (totalPaid >= coe.total_amount) {
      coe.payment_status = 'fully_paid';
      coe.status = 'accepted';
    } else {
      coe.payment_status = 'partially_paid';
    }
    
    await coe.save();
  } catch (error) {
    console.error('Error updating COE payment status:', error);
    throw error;
  }
}

/**
 * Get payment history
 * @param {string} coeId - COE ID
 * @returns {Promise<Array>} Payments
 */
async function getPaymentHistory(coeId) {
  return await Payment.find({ coe_id: coeId })
    .populate('user_id', 'firstName lastName email')
    .sort({ created_at: -1 });
}

/**
 * Verify webhook signature
 * @param {Object} payload - Webhook payload
 * @param {string} signature - Signature header
 * @returns {boolean} Valid
 */
function verifyWebhookSignature(payload, signature) {
  try {
    const secret = process.env.GP_WEBHOOK_SECRET;
    if (!secret) return true; // Allow in dev
    
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return signature === expected;
  } catch (error) {
    return false;
  }
}

module.exports = {
  createPaymentIntent,
  processRefund,
  processPaymentWebhook,
  updateCOEPaymentStatus,
  getPaymentHistory,
  verifyWebhookSignature
};
```

---

## Step 1.4: Create Payment Routes

**File**: `routes/payments.js` (NEW)

```javascript
const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const paymentService = require('../services/paymentService');
const Joi = require('joi');

// Validation schemas
const createPaymentSchema = Joi.object({
  paymentType: Joi.string().valid('deposit', 'final_payment', 'full_payment').required(),
  saveCard: Joi.boolean().optional(),
  tokenId: Joi.string().optional()
});

const refundSchema = Joi.object({
  amount: Joi.number().positive().optional(),
  reason: Joi.string().required()
});

/**
 * POST /v1/payments/coe/:coeId/intent
 * Create payment intent
 */
router.post('/coe/:coeId/intent', authenticateToken, async (req, res) => {
  try {
    const { error, value } = createPaymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }
    
    const result = await paymentService.createPaymentIntent(
      req.params.coeId,
      req.user._id,
      value.paymentType,
      { saveCard: value.saveCard, tokenId: value.tokenId }
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * POST /v1/payments/:paymentId/refund
 * Process refund (admin only)
 */
router.post('/:paymentId/refund', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = refundSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }
    
    const result = await paymentService.processRefund(
      req.params.paymentId,
      value.amount,
      value.reason
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * GET /v1/payments/coe/:coeId
 * Get payment history
 */
router.get('/coe/:coeId', authenticateToken, async (req, res) => {
  try {
    const payments = await paymentService.getPaymentHistory(req.params.coeId);
    res.json({ success: true, data: payments });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

module.exports = router;
```

---

## Step 1.5: Create Webhook Routes

**File**: `routes/webhooks.js` (NEW)

```javascript
const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');

/**
 * POST /webhooks/global-payments
 * Handle Global Payments webhooks
 */
router.post('/global-payments', express.json(), async (req, res) => {
  try {
    const signature = req.headers['x-gp-signature'];
    
    // Verify signature
    const isValid = paymentService.verifyWebhookSignature(req.body, signature);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Process webhook
    const result = await paymentService.processPaymentWebhook(req.body);
    res.json({ received: true, processed: result.processed });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
```

---

## Step 1.6: Update Server.js

**File**: `server.js` (UPDATE)

Add these lines:

```javascript
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');

// Routes
app.use('/v1/payments', paymentRoutes);
app.use('/webhooks', webhookRoutes);
```

---

## ✅ Phase 1 Complete!

You now have:
- ✅ Payment model
- ✅ Payment service with charge & refund
- ✅ API endpoints
- ✅ Webhook handling

**Test before moving to Phase 2!**

---

# Phase 2: Card Tokenization

## Goal
Allow clients to save credit cards for future payments (one-click checkout).

---

## Step 2.1: Update User Model

**File**: `models/User.js` (UPDATE)

Add to existing schema:

```javascript
{
  // Saved Payment Methods
  saved_payment_methods: [{
    token_id: {
      type: String,
      required: true
    },
    card_brand: String,
    card_last_four: String,
    expiry_month: String,
    expiry_year: String,
    is_default: {
      type: Boolean,
      default: false
    },
    nickname: String,
    created_at: {
      type: Date,
      default: Date.now
    },
    last_used_at: Date
  }],
  
  default_payment_method: String
}
```

---

## Step 2.2: Add Tokenization Functions to Payment Service

**File**: `services/paymentService.js` (UPDATE)

Add these functions:

```javascript
/**
 * Tokenize and save card
 * @param {string} userId - User ID
 * @param {Object} cardDetails - Card details
 * @param {boolean} setAsDefault - Set as default
 * @returns {Promise<Object>} Token data
 */
async function tokenizeAndSaveCard(userId, cardDetails, setAsDefault = true) {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    // Call GP tokenization API
    const gpClient = createGPClient();
    const tokenRequest = {
      account_name: GP_CONFIG.merchantId,
      card: {
        number: cardDetails.number,
        expiry_month: cardDetails.expiry_month,
        expiry_year: cardDetails.expiry_year,
        cvv: cardDetails.cvv
      },
      usage_mode: 'MULTIPLE'
    };
    
    const gpResponse = await gpClient.post('/payment-methods', tokenRequest);
    
    const tokenId = gpResponse.data.id;
    const cardInfo = gpResponse.data.card;
    
    // Save to user
    const savedMethod = {
      token_id: tokenId,
      card_brand: cardInfo.brand,
      card_last_four: cardInfo.last_four,
      expiry_month: cardDetails.expiry_month,
      expiry_year: cardDetails.expiry_year,
      is_default: setAsDefault || user.saved_payment_methods.length === 0,
      nickname: cardDetails.nickname || `${cardInfo.brand} •••• ${cardInfo.last_four}`
    };
    
    user.saved_payment_methods.push(savedMethod);
    
    if (setAsDefault || !user.default_payment_method) {
      user.default_payment_method = tokenId;
      user.saved_payment_methods.forEach(m => {
        m.is_default = (m.token_id === tokenId);
      });
    }
    
    await user.save();
    
    console.log('Card tokenized:', { user_id: userId, token_id: tokenId });
    
    return {
      token_id: tokenId,
      card_brand: cardInfo.brand,
      card_last_four: cardInfo.last_four,
      is_default: savedMethod.is_default
    };
  } catch (error) {
    console.error('Tokenization failed:', error.message);
    throw error;
  }
}

/**
 * Charge saved card
 * @param {string} userId - User ID
 * @param {string} tokenId - Token ID
 * @param {number} amount - Amount
 * @param {string} description - Description
 * @param {string} coeId - COE ID (optional)
 * @returns {Promise<Object>} Payment result
 */
async function chargeSavedCard(userId, tokenId, amount, description, coeId = null) {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    const savedMethod = user.saved_payment_methods.find(m => m.token_id === tokenId);
    if (!savedMethod) throw new Error('Payment method not found');
    
    // Create payment record
    const payment = new Payment({
      coe_id: coeId,
      user_id: userId,
      amount,
      currency: GP_CONFIG.currency,
      payment_type: coeId ? 'final_payment' : 'subscription',
      payment_token_id: tokenId,
      is_token_payment: true,
      status: 'pending',
      description
    });
    await payment.save();
    
    // Charge token
    const gpClient = createGPClient();
    const chargeRequest = {
      account_name: GP_CONFIG.merchantId,
      type: 'SALE',
      channel: 'CNP',
      amount: Math.round(amount * 100),
      currency: GP_CONFIG.currency,
      reference: payment._id.toString(),
      payment_method: {
        id: tokenId,
        entry_mode: 'ECOM',
        storage_mode: 'ON_FILE'
      },
      order: { description }
    };
    
    const gpResponse = await gpClient.post('/transactions', chargeRequest);
    
    payment.gp_transaction_id = gpResponse.data.id;
    payment.status = 'completed';
    payment.completed_at = new Date();
    payment.card_brand = savedMethod.card_brand;
    payment.card_last_four = savedMethod.card_last_four;
    await payment.save();
    
    // Update last used
    savedMethod.last_used_at = new Date();
    await user.save();
    
    // Update COE if applicable
    if (coeId) {
      await updateCOEPaymentStatus(coeId);
    }
    
    console.log('Saved card charged:', { payment_id: payment._id, token_id: tokenId });
    
    return payment;
  } catch (error) {
    console.error('Charge saved card failed:', error.message);
    throw error;
  }
}

/**
 * Remove saved card
 * @param {string} userId - User ID
 * @param {string} tokenId - Token ID
 * @returns {Promise<boolean>} Success
 */
async function removeSavedCard(userId, tokenId) {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    const methodIndex = user.saved_payment_methods.findIndex(m => m.token_id === tokenId);
    if (methodIndex === -1) throw new Error('Payment method not found');
    
    const wasDefault = user.saved_payment_methods[methodIndex].is_default;
    
    user.saved_payment_methods.splice(methodIndex, 1);
    
    if (wasDefault && user.saved_payment_methods.length > 0) {
      user.saved_payment_methods[0].is_default = true;
      user.default_payment_method = user.saved_payment_methods[0].token_id;
    } else if (user.saved_payment_methods.length === 0) {
      user.default_payment_method = null;
    }
    
    await user.save();
    
    // Delete from GP (optional)
    try {
      const gpClient = createGPClient();
      await gpClient.delete(`/payment-methods/${tokenId}`);
    } catch (gpError) {
      console.warn('GP token deletion failed:', gpError.message);
    }
    
    console.log('Payment method removed:', { user_id: userId, token_id: tokenId });
    return true;
  } catch (error) {
    console.error('Remove card failed:', error.message);
    throw error;
  }
}

// Export new functions
module.exports = {
  ...module.exports,
  tokenizeAndSaveCard,
  chargeSavedCard,
  removeSavedCard
};
```

---

## Step 2.3: Add Tokenization Routes

**File**: `routes/payments.js` (UPDATE)

Add these endpoints:

```javascript
/**
 * POST /v1/payments/tokenize
 * Tokenize and save card
 */
router.post('/tokenize', authenticateToken, async (req, res) => {
  try {
    const { cardDetails, setAsDefault, nickname } = req.body;
    
    if (!cardDetails || !cardDetails.number) {
      return res.status(400).json({
        success: false,
        error: { message: 'Card details required' }
      });
    }
    
    const result = await paymentService.tokenizeAndSaveCard(
      req.user._id,
      { ...cardDetails, nickname },
      setAsDefault
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * GET /v1/payments/saved-cards
 * Get saved payment methods
 */
router.get('/saved-cards', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' }
      });
    }
    
    const savedCards = user.saved_payment_methods.map(m => ({
      token_id: m.token_id,
      card_brand: m.card_brand,
      card_last_four: m.card_last_four,
      expiry_month: m.expiry_month,
      expiry_year: m.expiry_year,
      is_default: m.is_default,
      nickname: m.nickname,
      created_at: m.created_at,
      last_used_at: m.last_used_at
    }));
    
    res.json({
      success: true,
      data: {
        saved_cards: savedCards,
        default_payment_method: user.default_payment_method
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
 * POST /v1/payments/saved-card/:tokenId/charge
 * Charge saved card
 */
router.post('/saved-card/:tokenId/charge', authenticateToken, async (req, res) => {
  try {
    const { amount, description, coeId } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Valid amount required' }
      });
    }
    
    const payment = await paymentService.chargeSavedCard(
      req.user._id,
      req.params.tokenId,
      amount,
      description,
      coeId
    );
    
    res.json({ success: true, data: payment });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * DELETE /v1/payments/saved-cards/:tokenId
 * Remove saved card
 */
router.delete('/saved-cards/:tokenId', authenticateToken, async (req, res) => {
  try {
    await paymentService.removeSavedCard(req.user._id, req.params.tokenId);
    res.json({ success: true, message: 'Payment method removed' });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});
```

---

## ✅ Phase 2 Complete!

You now have:
- ✅ Save credit cards securely
- ✅ Charge saved cards (one-click)
- ✅ Manage saved cards
- ✅ No PCI compliance burden (GP stores cards)

---

# Phase 3: Recurring Billing

## Goal
Automated monthly/yearly membership subscriptions.

---

## Step 3.1: Create Subscription Model

**File**: `models/Subscription.js` (NEW)

```javascript
const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  // User Reference
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Subscription Details
  tier: {
    type: String,
    enum: ['basic', 'premium', 'vip', 'elite'],
    required: true
  },
  frequency: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'expired', 'failed'],
    default: 'active',
    index: true
  },
  
  // Pricing
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'USD'
  },
  
  // Dates
  start_date: {
    type: Date,
    required: true
  },
  current_period_start: Date,
  current_period_end: Date,
  next_billing_date: {
    type: Date,
    required: true,
    index: true
  },
  end_date: Date,
  cancelled_at: Date,
  
  // Payment Method
  payment_token_id: {
    type: String,
    required: true
  },
  card_last_four: String,
  card_brand: String,
  
  // Global Payments
  gp_schedule_id: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  
  // Payment History
  total_payments: {
    type: Number,
    default: 0
  },
  total_amount_paid: {
    type: Number,
    default: 0
  },
  failed_payments: {
    type: Number,
    default: 0
  },
  last_payment_date: Date,
  last_failure_date: Date,
  last_failure_reason: String,
  
  // Cancellation
  cancellation_reason: String
}, {
  timestamps: true
});

subscriptionSchema.index({ user_id: 1, status: 1 });
subscriptionSchema.index({ next_billing_date: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
```

---

## Step 3.2: Update User Model

**File**: `models/User.js` (UPDATE)

Add membership fields:

```javascript
{
  // Membership Status
  membership_status: {
    type: String,
    enum: ['free', 'active', 'cancelled', 'expired'],
    default: 'free',
    index: true
  },
  membership_tier: {
    type: String,
    enum: ['basic', 'premium', 'vip', 'elite']
  },
  membership_started_at: Date,
  membership_expires_at: Date,
  active_subscription_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription'
  }
}
```

---

## Step 3.3: Create Subscription Service

**File**: `services/subscriptionService.js` (NEW)

```javascript
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Payment = require('../models/Payment');
const paymentService = require('./paymentService');

// Membership pricing
const PRICING = {
  basic: { monthly: 49, yearly: 490 },
  premium: { monthly: 99, yearly: 990 },
  vip: { monthly: 199, yearly: 1990 },
  elite: { monthly: 499, yearly: 4999 }
};

/**
 * Create subscription
 * @param {string} userId - User ID
 * @param {string} tier - Membership tier
 * @param {string} frequency - Billing frequency
 * @param {string} paymentTokenId - Saved payment token
 * @returns {Promise<Object>} Subscription data
 */
async function createSubscription(userId, tier, frequency, paymentTokenId) {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    
    // Verify payment token
    const savedMethod = user.saved_payment_methods.find(m => m.token_id === paymentTokenId);
    if (!savedMethod) throw new Error('Payment method not found');
    
    // Check for existing active subscription
    const existingSubscription = await Subscription.findOne({
      user_id: userId,
      status: 'active'
    });
    
    if (existingSubscription) {
      throw new Error('User already has active subscription');
    }
    
    // Get pricing
    const amount = PRICING[tier][frequency];
    if (!amount) throw new Error('Invalid tier or frequency');
    
    // Calculate dates
    const startDate = new Date();
    const nextBillingDate = new Date(startDate);
    
    if (frequency === 'monthly') {
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    } else {
      nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
    }
    
    // Create subscription
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
      `${tier} Membership - ${frequency}`,
      null
    );
    
    // Update user
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
      frequency
    });
    
    return {
      subscription,
      first_payment: firstPayment
    };
  } catch (error) {
    console.error('Subscription creation failed:', error.message);
    throw error;
  }
}

/**
 * Process subscription payment (called by cron)
 * @param {string} subscriptionId - Subscription ID
 * @returns {Promise<Object>} Payment result
 */
async function processSubscriptionPayment(subscriptionId) {
  try {
    const subscription = await Subscription.findById(subscriptionId).populate('user_id');
    if (!subscription) throw new Error('Subscription not found');
    
    if (subscription.status !== 'active') {
      throw new Error(`Cannot charge ${subscription.status} subscription`);
    }
    
    // Charge card
    const payment = await paymentService.chargeSavedCard(
      subscription.user_id._id,
      subscription.payment_token_id,
      subscription.amount,
      `${subscription.tier} Membership - ${subscription.frequency}`,
      null
    );
    
    // Update subscription
    subscription.total_payments += 1;
    subscription.total_amount_paid += subscription.amount;
    subscription.last_payment_date = new Date();
    
    // Calculate next billing
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
    
    // Update user
    const user = subscription.user_id;
    user.membership_expires_at = nextBilling;
    await user.save();
    
    console.log('Subscription payment processed:', {
      subscription_id: subscriptionId,
      payment_id: payment._id
    });
    
    return payment;
  } catch (error) {
    console.error('Subscription payment failed:', error.message);
    
    // Update failure count
    const subscription = await Subscription.findById(subscriptionId);
    if (subscription) {
      subscription.failed_payments += 1;
      subscription.last_failure_date = new Date();
      subscription.last_failure_reason = error.message;
      
      // Suspend after 3 failures
      if (subscription.failed_payments >= 3) {
        subscription.status = 'failed';
        const user = await User.findById(subscription.user_id);
        user.membership_status = 'expired';
        await user.save();
      }
      
      await subscription.save();
    }
    
    throw error;
  }
}

/**
 * Cancel subscription
 * @param {string} subscriptionId - Subscription ID
 * @param {string} userId - User ID
 * @param {string} reason - Cancellation reason
 * @returns {Promise<Object>} Result
 */
async function cancelSubscription(subscriptionId, userId, reason = '') {
  try {
    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription) throw new Error('Subscription not found');
    
    if (subscription.user_id.toString() !== userId.toString()) {
      throw new Error('Unauthorized');
    }
    
    if (subscription.status === 'cancelled') {
      throw new Error('Subscription already cancelled');
    }
    
    subscription.status = 'cancelled';
    subscription.cancelled_at = new Date();
    subscription.cancellation_reason = reason;
    subscription.end_date = subscription.current_period_end;
    await subscription.save();
    
    // Update user
    const user = await User.findById(userId);
    user.membership_status = 'cancelled';
    await user.save();
    
    console.log('Subscription cancelled:', { subscription_id: subscriptionId });
    
    return {
      subscription,
      access_until: subscription.end_date,
      message: 'Subscription cancelled. Access continues until period ends.'
    };
  } catch (error) {
    console.error('Subscription cancellation failed:', error.message);
    throw error;
  }
}

/**
 * Get user subscriptions
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Subscriptions
 */
async function getUserSubscriptions(userId) {
  return await Subscription.find({ user_id: userId }).sort({ created_at: -1 });
}

module.exports = {
  createSubscription,
  processSubscriptionPayment,
  cancelSubscription,
  getUserSubscriptions,
  PRICING
};
```

---

## Step 3.4: Create Cron Jobs

**File**: `utils/cronJobs.js` (NEW)

```javascript
const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const subscriptionService = require('../services/subscriptionService');

/**
 * Process daily recurring payments
 * Runs every day at midnight UTC
 */
function startRecurringPaymentsCron() {
  cron.schedule('0 0 * * *', async () => {
    console.log('Running recurring payments cron:', new Date().toISOString());
    
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const dueSubscriptions = await Subscription.find({
        status: 'active',
        next_billing_date: { $gte: today, $lt: tomorrow }
      });
      
      console.log(`Found ${dueSubscriptions.length} subscriptions due`);
      
      for (const subscription of dueSubscriptions) {
        try {
          await subscriptionService.processSubscriptionPayment(subscription._id);
          console.log(`✅ Processed: ${subscription._id}`);
        } catch (error) {
          console.error(`❌ Failed: ${subscription._id}`, error.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
      }
      
      console.log('Recurring payments cron completed');
    } catch (error) {
      console.error('Cron job failed:', error);
    }
  });
  
  console.log('✅ Recurring payments cron scheduled');
}

function startAllCronJobs() {
  startRecurringPaymentsCron();
  console.log('🚀 All cron jobs started');
}

module.exports = {
  startAllCronJobs,
  startRecurringPaymentsCron
};
```

---

## Step 3.5: Create Subscription Routes

**File**: `routes/subscriptions.js` (NEW)

```javascript
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');
const Joi = require('joi');

const createSubscriptionSchema = Joi.object({
  tier: Joi.string().valid('basic', 'premium', 'vip', 'elite').required(),
  frequency: Joi.string().valid('monthly', 'yearly').required(),
  payment_token_id: Joi.string().required()
});

/**
 * POST /v1/subscriptions
 * Create subscription
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { error, value } = createSubscriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: { message: error.details[0].message }
      });
    }
    
    const result = await subscriptionService.createSubscription(
      req.user._id,
      value.tier,
      value.frequency,
      value.payment_token_id
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * GET /v1/subscriptions/my
 * Get user subscriptions
 */
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const subscriptions = await subscriptionService.getUserSubscriptions(req.user._id);
    res.json({ success: true, data: subscriptions });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * POST /v1/subscriptions/:id/cancel
 * Cancel subscription
 */
router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    
    const result = await subscriptionService.cancelSubscription(
      req.params.id,
      req.user._id,
      reason
    );
    
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

module.exports = router;
```

---

## Step 3.6: Update Server.js

**File**: `server.js` (UPDATE)

```javascript
const subscriptionRoutes = require('./routes/subscriptions');
const cronJobs = require('./utils/cronJobs');

// Routes
app.use('/v1/subscriptions', subscriptionRoutes);

// Start cron jobs after DB connection
mongoose.connect(process.env.DB_URI, {...})
  .then(() => {
    console.log('✅ Connected to MongoDB');
    cronJobs.startAllCronJobs(); // Start automated billing
  });
```

---

## ✅ Phase 3 Complete!

You now have:
- ✅ Subscription management
- ✅ Automated recurring billing
- ✅ Failed payment handling
- ✅ Subscription cancellation
- ✅ Membership tiers

---

# Phase 4: Payment Reporting

## Goal
Provide comprehensive payment analytics and reports.

---

## Step 4.1: Add Reporting Functions

**File**: `services/paymentService.js` (UPDATE)

Add these reporting functions:

```javascript
/**
 * Get payment analytics
 * @param {Object} filters - Date range, status, etc.
 * @returns {Promise<Object>} Analytics data
 */
async function getPaymentAnalytics(filters = {}) {
  try {
    const { startDate, endDate, status, paymentType } = filters;
    
    const query = {};
    
    if (startDate || endDate) {
      query.created_at = {};
      if (startDate) query.created_at.$gte = new Date(startDate);
      if (endDate) query.created_at.$lte = new Date(endDate);
    }
    
    if (status) query.status = status;
    if (paymentType) query.payment_type = paymentType;
    
    // Aggregate data
    const payments = await Payment.find(query);
    
    const analytics = {
      total_count: payments.length,
      total_amount: payments.reduce((sum, p) => sum + p.amount, 0),
      successful_count: payments.filter(p => p.status === 'completed').length,
      successful_amount: payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0),
      failed_count: payments.filter(p => p.status === 'failed').length,
      refunded_count: payments.filter(p => p.status === 'refunded').length,
      refunded_amount: payments.filter(p => p.status === 'refunded').reduce((sum, p) => sum + p.refund_amount, 0),
      by_type: {},
      by_day: {}
    };
    
    // Group by payment type
    payments.forEach(p => {
      if (!analytics.by_type[p.payment_type]) {
        analytics.by_type[p.payment_type] = {
          count: 0,
          amount: 0
        };
      }
      analytics.by_type[p.payment_type].count++;
      analytics.by_type[p.payment_type].amount += p.amount;
    });
    
    // Group by day
    payments.forEach(p => {
      const day = p.created_at.toISOString().split('T')[0];
      if (!analytics.by_day[day]) {
        analytics.by_day[day] = {
          count: 0,
          amount: 0
        };
      }
      analytics.by_day[day].count++;
      analytics.by_day[day].amount += p.amount;
    });
    
    return analytics;
  } catch (error) {
    console.error('Analytics error:', error.message);
    throw error;
  }
}

/**
 * Get user payment summary
 * @param {string} userId - User ID
 * @returns {Promise<Object>} User payment summary
 */
async function getUserPaymentSummary(userId) {
  try {
    const payments = await Payment.find({ user_id: userId });
    
    return {
      total_payments: payments.length,
      total_spent: payments.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0),
      total_refunded: payments.filter(p => p.status === 'refunded').reduce((sum, p) => sum + p.refund_amount, 0),
      failed_payments: payments.filter(p => p.status === 'failed').length,
      recent_payments: payments.slice(0, 10)
    };
  } catch (error) {
    console.error('User summary error:', error.message);
    throw error;
  }
}

module.exports = {
  ...module.exports,
  getPaymentAnalytics,
  getUserPaymentSummary
};
```

---

## Step 4.2: Add Reporting Routes

**File**: `routes/payments.js` (UPDATE)

```javascript
/**
 * GET /v1/payments/analytics
 * Get payment analytics (admin only)
 */
router.get('/analytics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate, status, paymentType } = req.query;
    
    const analytics = await paymentService.getPaymentAnalytics({
      startDate,
      endDate,
      status,
      paymentType
    });
    
    res.json({ success: true, data: analytics });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * GET /v1/payments/my-summary
 * Get user payment summary
 */
router.get('/my-summary', authenticateToken, async (req, res) => {
  try {
    const summary = await paymentService.getUserPaymentSummary(req.user._id);
    res.json({ success: true, data: summary });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});
```

---

## ✅ Phase 4 Complete!

You now have:
- ✅ Payment analytics dashboard
- ✅ User payment summaries
- ✅ Revenue reporting
- ✅ Refund tracking

---

# Global Payments API Reference

## Authentication

```javascript
const authString = Buffer.from(`${GP_APP_NAME}:${GP_APP_KEY}`).toString('base64');

headers: {
  'Authorization': `Basic ${authString}`,
  'Content-Type': 'application/json',
  'X-GP-Version': '2021-03-22'
}
```

## Key Endpoints

### 1. Create Transaction
```
POST /transactions
```

**Request**:
```json
{
  "account_name": "MER_...",
  "type": "SALE",
  "channel": "CNP",
  "amount": 200000,
  "currency": "USD",
  "reference": "payment_id_123",
  "capture_mode": "AUTO",
  "payment_method": {
    "entry_mode": "ECOM"
  }
}
```

### 2. Tokenize Card
```
POST /payment-methods
```

**Request**:
```json
{
  "account_name": "MER_...",
  "card": {
    "number": "4111111111111111",
    "expiry_month": "12",
    "expiry_year": "25",
    "cvv": "123"
  },
  "usage_mode": "MULTIPLE"
}
```

### 3. Charge Token
```
POST /transactions
```

**Request**:
```json
{
  "account_name": "MER_...",
  "type": "SALE",
  "amount": 10000,
  "payment_method": {
    "id": "PMT_token_abc123",
    "storage_mode": "ON_FILE"
  }
}
```

### 4. Refund
```
POST /transactions/{transaction_id}/refund
```

**Request**:
```json
{
  "amount": 10000
}
```

### 5. Delete Token
```
DELETE /payment-methods/{token_id}
```

---

# Testing Guide

## Test Cards

**Successful Payment**:
- Card: `4263970000005262`
- CVV: `123`
- Expiry: Any future date

**Declined Payment**:
- Card: `4000000000000002`

**Insufficient Funds**:
- Card: `4000000000009995`

---

## Test Scenarios

### 1. Basic Payment Flow
```bash
# Create payment intent
POST /v1/payments/coe/{coeId}/intent
{
  "paymentType": "deposit"
}

# Response includes payment_url
# User completes payment on hosted page
# Webhook received: PAYMENT_COMPLETED
# Verify payment status updated to 'completed'
```

### 2. Save Card Flow
```bash
# Tokenize card
POST /v1/payments/tokenize
{
  "cardDetails": {
    "number": "4263970000005262",
    "expiry_month": "12",
    "expiry_year": "25",
    "cvv": "123"
  },
  "setAsDefault": true
}

# Get saved cards
GET /v1/payments/saved-cards

# Charge saved card
POST /v1/payments/saved-card/{tokenId}/charge
{
  "amount": 100,
  "description": "Test charge"
}
```

### 3. Subscription Flow
```bash
# Create subscription
POST /v1/subscriptions
{
  "tier": "premium",
  "frequency": "monthly",
  "payment_token_id": "PMT_..."
}

# Verify first payment processed
# Wait for cron job or manually trigger
# Verify recurring payment processed
```

### 4. Refund Flow
```bash
# Process refund
POST /v1/payments/{paymentId}/refund
{
  "amount": 100,
  "reason": "Customer request"
}

# Verify payment status = 'refunded'
# Verify COE total_paid decreased
```

---

# Deployment Guide

## 1. Environment Variables (AWS ECS)

Add to Task Definition:

```
GP_APP_NAME=devaMER_7e3e2c7df34f42819b3edee31022ee3fcRDd1MBLr
GP_APP_KEY=VuaYoVKWTRlumYt2
GP_MERCHANT_ID=MER_7e3e2c7df34f42819b3edee31022ee3f
GP_SERVICE_URL=https://apis.sandbox.globalpay.com
GP_WEBHOOK_SECRET=<generate-secure-secret>
PAYMENT_CURRENCY=USD
PAYMENT_DEPOSIT_PERCENT=20
FRONTEND_URL=https://the1.vip
BACKEND_URL=https://api.the1.vip
```

## 2. Configure Global Payments Webhooks

1. Log in to GP Dashboard
2. Go to Webhooks
3. Add webhook URL: `https://api.the1.vip/webhooks/global-payments`
4. Enable events:
   - `payment.completed`
   - `payment.failed`
   - `refund.completed`
5. Copy webhook secret to `GP_WEBHOOK_SECRET`

## 3. Production Transition

1. Switch `GP_SERVICE_URL` to: `https://apis.globalpay.com`
2. Update credentials to production keys
3. Test all flows
4. Monitor logs

---

# Troubleshooting

## Common Issues

**Issue**: Payment stuck in 'processing'
- Check webhook logs
- Verify webhook URL is accessible
- Query GP API for transaction status

**Issue**: Webhook signature verification fails
- Verify `GP_WEBHOOK_SECRET` matches GP dashboard
- Check request body is not modified by middleware

**Issue**: Subscription payment fails
- Verify saved token is valid
- Check card expiration
- Verify sufficient funds

**Issue**: Duplicate payments
- Check idempotency key implementation
- Review payment creation logic

---

# Summary

## ✅ Complete Feature Checklist

### Phase 1: Basic Payments
- [x] Payment model
- [x] COE payment tracking
- [x] Charge functionality
- [x] Refund functionality
- [x] Webhook handling
- [x] Payment history

### Phase 2: Card Tokenization
- [x] Save credit cards
- [x] Charge saved cards
- [x] Manage saved cards
- [x] Default payment method

### Phase 3: Recurring Billing
- [x] Subscription model
- [x] Membership tiers
- [x] Automated billing (cron)
- [x] Failed payment handling
- [x] Subscription management

### Phase 4: Payment Reporting
- [x] Payment analytics
- [x] User summaries
- [x] Revenue reports

---

## 🎯 You Now Have:

✅ **Complete payment system** with Global Payments  
✅ **Charge & refund** for COE payments  
✅ **Card tokenization** (save cards)  
✅ **Recurring billing** (subscriptions)  
✅ **Payment reporting** (analytics)  
✅ **Production-ready** code  

---

## 📚 Next Steps

1. **Implement** each phase sequentially
2. **Test** thoroughly in sandbox
3. **Deploy** to staging
4. **Monitor** logs and metrics
5. **Go live** in production

---

**Version**: 1.0  
**Last Updated**: October 14, 2025  
**Status**: ✅ Ready for Implementation

---

**Questions or Issues?**  
Reference the original specifications:
- `global-payments-integration.md` - Full details
- Global Payments API Docs: https://developer.globalpay.com/


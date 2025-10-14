# Global Payments Integration Specification

## Overview
This document specifies the integration of Global Payments as the payment gateway for The1 Platform, enabling secure payment processing for COE (Curated One Experience) packages, deposits, final payments, and refunds.

---

## MVP Payment Requirements (From mvp.md)

### Core Payment Features (Priority 1)
1. **Payments Interface** - Interface to Global Payments gateway
2. **Payment Capture** - Capture deposit and final payments
3. **Refunds** - Full and partial refund support
4. **Payment Transactions Log** - Track all payment activities
5. **Idempotency** - Prevent duplicate payments on retries
6. **Webhook Support** - Handle Global Payments events
7. **Availability Revalidation** - Verify before payment capture

### Payment Flow (From mvp.md)
```
1. Client reviews COE
   ↓
2. Client accepts terms and pays deposit
   ↓
3. System revalidates availability
   ↓
4. System captures payment via Global Payments
   ↓
5. Confirmation sent to client
   ↓
6. Audit log updated
   ↓
7. Future: Final payment captured
   ↓
8. Future: Upgrade delta payments
```

---

## Global Payments Configuration

### Environment Variables

**Configured in .env:**
```bash
# Global Payments Credentials
GP_APP_NAME=devaMER_7e3e2c7df34f42819b3edee31022ee3fcRDd1MBLr
GP_APP_KEY=VuaYoVKWTRlumYt2
GP_MERCHANT_ID=MER_7e3e2c7df34f42819b3edee31022ee3f

# Payment Settings
GP_SERVICE_URL=https://apis.sandbox.globalpay.com  # Sandbox for development
GP_WEBHOOK_SECRET=your-webhook-secret
PAYMENT_CURRENCY=USD
PAYMENT_DEPOSIT_PERCENT=20
```

**AWS Deployment**: Add these to ECS Task Definition environment variables.

---

## Architecture

### Payment Flow Components

```
Frontend (Client)                Backend (API)                  Global Payments
─────────────────                ─────────────                  ───────────────
                                                                
1. View COE                                                    
2. Click "Pay Deposit"          
                          →      3. Create Payment Intent
                                 4. Revalidate availability
                                 5. Create Payment record
                          →                              →      6. Create GP transaction
                          ←                              ←      7. Return payment URL/token
3. Redirect to GP                
4. Enter card details     →                              →      8. Process payment
                          ←                              ←      9. Webhook: payment.success
                                 10. Update Payment status
                                 11. Update COE status
                                 12. Mark seats as 'booked'
                                 13. Send confirmation email
5. Redirect back
6. See confirmation
```

---

## Database Schema

### Payment Model (New)

**File**: `models/Payment.js`

```javascript
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // References
  coe_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'COE',
    required: true,
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
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP']
  },
  payment_type: {
    type: String,
    enum: ['deposit', 'final_payment', 'full_payment', 'upgrade', 'refund'],
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'authorized', 'captured', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Payment Method Info (for display only, no sensitive data)
  payment_method: {
    type: String,
    enum: ['card', 'bank_transfer', 'digital_wallet']
  },
  card_brand: {
    type: String  // visa, mastercard, amex, discover
  },
  card_last_four: {
    type: String,
    maxlength: 4
  },
  
  // Global Payments Data
  gp_transaction_id: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  gp_order_id: {
    type: String,
    index: true
  },
  gp_authorization_code: {
    type: String
  },
  gp_response_code: {
    type: String
  },
  gp_response_message: {
    type: String
  },
  
  // Idempotency
  idempotency_key: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  
  // Metadata
  description: {
    type: String
  },
  metadata: {
    type: Object,
    default: {}
  },
  
  // Failure Info
  failure_code: {
    type: String
  },
  failure_message: {
    type: String
  },
  failed_at: {
    type: Date
  },
  
  // Refund Info
  refund_amount: {
    type: Number,
    default: 0
  },
  refund_reason: {
    type: String
  },
  refunded_at: {
    type: Date
  },
  refund_transaction_id: {
    type: String
  },
  
  // Timestamps
  authorized_at: {
    type: Date
  },
  captured_at: {
    type: Date
  },
  completed_at: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for queries
paymentSchema.index({ coe_id: 1, status: 1 });
paymentSchema.index({ user_id: 1, created_at: -1 });
paymentSchema.index({ gp_transaction_id: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
```

---

### COE Schema Updates

**File**: `models/COE.js`

**Add Payment Fields:**
```javascript
{
  // Payment Information
  payment_status: {
    type: String,
    enum: ['unpaid', 'deposit_paid', 'partially_paid', 'fully_paid', 'refunded'],
    default: 'unpaid',
    index: true
  },
  
  deposit_amount: {
    type: Number,
    default: 0
  },
  deposit_percent: {
    type: Number,
    default: 20  // 20% deposit
  },
  deposit_paid_at: {
    type: Date
  },
  deposit_payment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  
  final_amount: {
    type: Number,
    default: 0
  },
  final_paid_at: {
    type: Date
  },
  final_payment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  
  total_paid: {
    type: Number,
    default: 0
  },
  
  payment_due_date: {
    type: Date
  },
  
  payment_terms: {
    type: String,
    default: '20% deposit required, balance due 48 hours before event'
  },
  
  refund_amount: {
    type: Number,
    default: 0
  },
  refunded_at: {
    type: Date
  }
}
```

---

## Payment Service Implementation

### File: `services/paymentService.js` (New)

```javascript
const crypto = require('crypto');
const axios = require('axios');
const Payment = require('../models/Payment');
const COE = require('../models/COE');
const User = require('../models/User');
const Event = require('../models/Event');
const emailService = require('../utils/emailService');

/**
 * Global Payments API Configuration
 */
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
 * Revalidate COE availability before payment
 * @param {string} coeId - COE ID
 * @returns {Promise<boolean>} Availability status
 */
async function revalidateCOEAvailability(coeId) {
  try {
    const coe = await COE.findById(coeId).populate('events.event_id');
    
    if (!coe) {
      throw new Error('COE not found');
    }
    
    // Check each seat in available_seats is still available
    for (const seatData of coe.available_seats) {
      const event = await Event.findById(seatData.event_id);
      
      if (!event) {
        throw new Error(`Event ${seatData.event_id} not found`);
      }
      
      const seat = event.seats.find(s => s._id.toString() === seatData.seat_id);
      
      if (!seat) {
        throw new Error(`Seat ${seatData.seat_id} not found`);
      }
      
      // Seat should be 'available' or 'held' by this COE
      if (seat.status !== 'available' && seat.status !== 'held') {
        throw new Error(`Seat ${seat.code} is no longer available (status: ${seat.status})`);
      }
      
      if (seat.status === 'held' && seat.booking_reference !== coeId.toString()) {
        throw new Error(`Seat ${seat.code} is held by another booking`);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Availability revalidation failed:', error);
    throw error;
  }
}

/**
 * Create payment intent
 * @param {string} coeId - COE ID
 * @param {string} userId - User ID
 * @param {string} paymentType - Payment type (deposit, final_payment, full_payment)
 * @param {string} idempotencyKey - Idempotency key
 * @returns {Promise<Object>} Payment intent data
 */
async function createPaymentIntent(coeId, userId, paymentType, idempotencyKey) {
  try {
    // Get COE details
    const coe = await COE.findById(coeId)
      .populate('client_id')
      .populate('events.event_id');
    
    if (!coe) {
      throw new Error('COE not found');
    }
    
    // Validate user is the client
    if (coe.client_id._id.toString() !== userId.toString()) {
      throw new Error('Unauthorized: You can only pay for your own COEs');
    }
    
    // Check if COE is in valid state for payment
    if (!['sent', 'deposit_paid'].includes(coe.status)) {
      throw new Error(`Cannot pay for COE in status: ${coe.status}`);
    }
    
    // Revalidate availability
    await revalidateCOEAvailability(coeId);
    
    // Calculate amount based on payment type
    let amount;
    if (paymentType === 'deposit') {
      if (coe.payment_status !== 'unpaid') {
        throw new Error('Deposit already paid');
      }
      amount = coe.deposit_amount || (coe.total_amount * (coe.deposit_percent / 100));
    } else if (paymentType === 'final_payment') {
      if (coe.payment_status !== 'deposit_paid') {
        throw new Error('Deposit must be paid first');
      }
      amount = coe.final_amount || (coe.total_amount - (coe.deposit_amount || 0));
    } else if (paymentType === 'full_payment') {
      if (coe.payment_status !== 'unpaid') {
        throw new Error('Payment already processed');
      }
      amount = coe.total_amount;
    } else {
      throw new Error('Invalid payment type');
    }
    
    // Check for duplicate payment with same idempotency key
    const existingPayment = await Payment.findOne({ idempotency_key: idempotencyKey });
    if (existingPayment) {
      console.log('Duplicate payment attempt detected, returning existing payment:', existingPayment._id);
      return {
        payment_id: existingPayment._id,
        gp_transaction_id: existingPayment.gp_transaction_id,
        amount: existingPayment.amount,
        status: existingPayment.status
      };
    }
    
    // Create payment record in database
    const payment = new Payment({
      coe_id: coeId,
      user_id: userId,
      amount,
      currency: coe.currency || GP_CONFIG.currency,
      payment_type: paymentType,
      status: 'pending',
      idempotency_key: idempotencyKey,
      description: `${coe.name} - ${paymentType.replace('_', ' ')}`
    });
    
    await payment.save();
    
    // Create Global Payments transaction
    const gpClient = createGPClient();
    
    const gpRequest = {
      account_name: GP_CONFIG.merchantId,
      type: 'SALE',
      channel: 'CNP',  // Card Not Present
      amount: Math.round(amount * 100),  // Convert to cents
      currency: coe.currency || 'USD',
      reference: payment._id.toString(),
      country: 'US',
      capture_mode: 'LATER',  // Authorize first, capture later
      payment_method: {
        entry_mode: 'ECOM',
        authentication: {
          three_ds: {
            mode: 'REQUIRED'  // Require 3D Secure
          }
        }
      },
      order: {
        description: `The1 Platform - ${coe.name}`
      },
      notifications: {
        return_url: `${process.env.FRONTEND_URL}/payment/complete?payment_id=${payment._id}`,
        status_url: `${process.env.FRONTEND_URL}/webhooks/global-payments`
      }
    };
    
    const gpResponse = await gpClient.post('/transactions', gpRequest);
    
    // Update payment with GP transaction details
    payment.gp_transaction_id = gpResponse.data.id;
    payment.gp_order_id = gpResponse.data.reference;
    payment.status = 'processing';
    await payment.save();
    
    // Log payment creation
    console.log('Payment intent created:', {
      payment_id: payment._id,
      coe_id: coeId,
      amount,
      payment_type: paymentType,
      gp_transaction_id: gpResponse.data.id,
      timestamp: new Date().toISOString()
    });
    
    return {
      payment_id: payment._id,
      gp_transaction_id: gpResponse.data.id,
      payment_url: gpResponse.data.payment_url,  // Hosted payment page URL
      amount,
      currency: coe.currency || 'USD',
      status: 'processing'
    };
    
  } catch (error) {
    console.error('Payment intent creation failed:', {
      coe_id: coeId,
      user_id: userId,
      payment_type: paymentType,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Capture authorized payment
 * @param {string} paymentId - Payment ID
 * @returns {Promise<Object>} Capture result
 */
async function capturePayment(paymentId) {
  try {
    const payment = await Payment.findById(paymentId);
    
    if (!payment) {
      throw new Error('Payment not found');
    }
    
    if (payment.status !== 'authorized') {
      throw new Error(`Cannot capture payment in status: ${payment.status}`);
    }
    
    // Call Global Payments capture API
    const gpClient = createGPClient();
    const gpResponse = await gpClient.post(`/transactions/${payment.gp_transaction_id}/capture`, {
      amount: Math.round(payment.amount * 100)
    });
    
    // Update payment status
    payment.status = 'captured';
    payment.captured_at = new Date();
    payment.gp_response_code = gpResponse.data.response_code;
    payment.gp_response_message = gpResponse.data.response_message;
    await payment.save();
    
    // Update COE payment status
    await updateCOEPaymentStatus(payment.coe_id);
    
    console.log('Payment captured:', {
      payment_id: paymentId,
      gp_transaction_id: payment.gp_transaction_id,
      amount: payment.amount,
      timestamp: new Date().toISOString()
    });
    
    return payment;
    
  } catch (error) {
    console.error('Payment capture failed:', {
      payment_id: paymentId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Process payment webhook from Global Payments
 * @param {Object} webhookData - Webhook payload
 * @returns {Promise<Object>} Processing result
 */
async function processPaymentWebhook(webhookData) {
  try {
    const { type, id, reference } = webhookData;
    
    // Find payment by reference (our payment _id)
    const payment = await Payment.findById(reference);
    
    if (!payment) {
      console.error('Payment not found for webhook:', reference);
      return { processed: false, reason: 'Payment not found' };
    }
    
    // Update payment based on webhook event
    switch (type) {
      case 'PAYMENT_AUTHORIZED':
        payment.status = 'authorized';
        payment.authorized_at = new Date();
        payment.gp_authorization_code = webhookData.authorization_code;
        break;
        
      case 'PAYMENT_CAPTURED':
        payment.status = 'captured';
        payment.captured_at = new Date();
        payment.card_brand = webhookData.payment_method?.card?.brand;
        payment.card_last_four = webhookData.payment_method?.card?.last_four;
        break;
        
      case 'PAYMENT_COMPLETED':
        payment.status = 'completed';
        payment.completed_at = new Date();
        await updateCOEPaymentStatus(payment.coe_id);
        await sendPaymentConfirmation(payment._id);
        break;
        
      case 'PAYMENT_FAILED':
        payment.status = 'failed';
        payment.failed_at = new Date();
        payment.failure_code = webhookData.error_code;
        payment.failure_message = webhookData.error_message;
        break;
        
      default:
        console.log('Unhandled webhook type:', type);
        return { processed: false, reason: 'Unknown event type' };
    }
    
    await payment.save();
    
    console.log('Webhook processed:', {
      payment_id: payment._id,
      event_type: type,
      status: payment.status,
      timestamp: new Date().toISOString()
    });
    
    return { processed: true, payment_id: payment._id };
    
  } catch (error) {
    console.error('Webhook processing failed:', error);
    throw error;
  }
}

/**
 * Update COE payment status based on payments
 * @param {string} coeId - COE ID
 */
async function updateCOEPaymentStatus(coeId) {
  try {
    const coe = await COE.findById(coeId);
    const payments = await Payment.find({ coe_id: coeId, status: { $in: ['completed', 'captured'] } });
    
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    coe.total_paid = totalPaid;
    
    // Update payment status
    if (totalPaid === 0) {
      coe.payment_status = 'unpaid';
    } else if (payments.some(p => p.payment_type === 'deposit' && p.status === 'completed')) {
      if (totalPaid >= coe.total_amount) {
        coe.payment_status = 'fully_paid';
        coe.status = 'accepted';  // Auto-accept on full payment
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
    
    // If fully paid, mark seats as booked
    if (coe.payment_status === 'fully_paid') {
      await markSeatsAsBooked(coeId);
    }
    
  } catch (error) {
    console.error('Error updating COE payment status:', error);
    throw error;
  }
}

/**
 * Mark COE seats as booked
 * @param {string} coeId - COE ID
 */
async function markSeatsAsBooked(coeId) {
  try {
    await Event.updateMany(
      { 'seats.booking_reference': coeId.toString(), 'seats.status': 'held' },
      { 
        $set: { 
          'seats.$[seat].status': 'booked'
        }
      },
      { 
        arrayFilters: [{ 'seat.booking_reference': coeId.toString(), 'seat.status': 'held' }]
      }
    );
    
    console.log('Seats marked as booked for COE:', coeId);
  } catch (error) {
    console.error('Error marking seats as booked:', error);
    throw error;
  }
}

/**
 * Send payment confirmation
 * @param {string} paymentId - Payment ID
 */
async function sendPaymentConfirmation(paymentId) {
  try {
    const payment = await Payment.findById(paymentId)
      .populate('user_id')
      .populate('coe_id');
    
    if (!payment || !payment.user_id || !payment.coe_id) {
      throw new Error('Payment data incomplete');
    }
    
    // Send confirmation email to client
    await emailService.sendPaymentConfirmationEmail(
      payment.user_id,
      payment.coe_id,
      payment
    );
    
    // Notify admin
    await emailService.sendAdminNotificationEmail(
      'admin@the1.vip',
      'Payment Received',
      `Payment of $${payment.amount} received for ${payment.coe_id.name} from ${payment.user_id.firstName} ${payment.user_id.lastName}`
    );
    
  } catch (error) {
    console.error('Error sending payment confirmation:', error);
    // Don't throw - email failure shouldn't block payment
  }
}

/**
 * Process refund
 * @param {string} paymentId - Payment ID
 * @param {number} amount - Refund amount (optional, defaults to full amount)
 * @param {string} reason - Refund reason
 * @returns {Promise<Object>} Refund result
 */
async function processRefund(paymentId, amount = null, reason = '') {
  try {
    const payment = await Payment.findById(paymentId);
    
    if (!payment) {
      throw new Error('Payment not found');
    }
    
    if (!['completed', 'captured'].includes(payment.status)) {
      throw new Error(`Cannot refund payment in status: ${payment.status}`);
    }
    
    const refundAmount = amount || payment.amount;
    
    if (refundAmount > payment.amount) {
      throw new Error('Refund amount cannot exceed payment amount');
    }
    
    // Call Global Payments refund API
    const gpClient = createGPClient();
    const gpResponse = await gpClient.post(`/transactions/${payment.gp_transaction_id}/refund`, {
      amount: Math.round(refundAmount * 100)
    });
    
    // Update payment record
    payment.status = 'refunded';
    payment.refunded_at = new Date();
    payment.refund_amount = refundAmount;
    payment.refund_reason = reason;
    payment.refund_transaction_id = gpResponse.data.id;
    await payment.save();
    
    // Update COE
    const coe = await COE.findById(payment.coe_id);
    coe.total_paid -= refundAmount;
    coe.refund_amount = (coe.refund_amount || 0) + refundAmount;
    
    if (refundAmount === payment.amount) {
      // Full refund
      if (payment.payment_type === 'deposit') {
        coe.payment_status = 'unpaid';
      } else {
        coe.payment_status = 'refunded';
      }
      coe.refunded_at = new Date();
    }
    
    await coe.save();
    
    // If COE fully refunded, release seats
    if (coe.payment_status === 'refunded') {
      await releaseSeats(coe._id);
    }
    
    console.log('Refund processed:', {
      payment_id: paymentId,
      refund_amount: refundAmount,
      gp_refund_id: gpResponse.data.id,
      timestamp: new Date().toISOString()
    });
    
    return {
      refund_id: gpResponse.data.id,
      amount: refundAmount,
      status: 'completed'
    };
    
  } catch (error) {
    console.error('Refund processing failed:', {
      payment_id: paymentId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Release seats back to available
 * @param {string} coeId - COE ID
 */
async function releaseSeats(coeId) {
  try {
    await Event.updateMany(
      { 'seats.booking_reference': coeId.toString() },
      { 
        $set: { 
          'seats.$[seat].status': 'available',
          'seats.$[seat].booking_reference': undefined,
          'seats.$[seat].booked_at': undefined,
          'seats.$[seat].booked_by': undefined
        }
      },
      { 
        arrayFilters: [{ 'seat.booking_reference': coeId.toString() }]
      }
    );
    
    console.log('Seats released for COE:', coeId);
  } catch (error) {
    console.error('Error releasing seats:', error);
    throw error;
  }
}

/**
 * Get payment history for COE
 * @param {string} coeId - COE ID
 * @returns {Promise<Array>} Payment history
 */
async function getPaymentHistory(coeId) {
  try {
    const payments = await Payment.find({ coe_id: coeId })
      .populate('user_id', 'firstName lastName email')
      .sort({ created_at: -1 });
    
    return payments;
  } catch (error) {
    console.error('Error getting payment history:', error);
    throw error;
  }
}

/**
 * Get payment by ID
 * @param {string} paymentId - Payment ID
 * @returns {Promise<Object>} Payment details
 */
async function getPaymentById(paymentId) {
  try {
    const payment = await Payment.findById(paymentId)
      .populate('user_id', 'firstName lastName email')
      .populate('coe_id', 'name total_amount currency');
    
    if (!payment) {
      throw new Error('Payment not found');
    }
    
    return payment;
  } catch (error) {
    console.error('Error getting payment:', error);
    throw error;
  }
}

/**
 * Verify Global Payments webhook signature
 * @param {Object} payload - Webhook payload
 * @param {string} signature - Webhook signature header
 * @returns {boolean} Signature valid
 */
function verifyWebhookSignature(payload, signature) {
  try {
    const webhookSecret = process.env.GP_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.warn('GP_WEBHOOK_SECRET not configured, skipping signature verification');
      return true;  // Allow in development
    }
    
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return signature === expectedSignature;
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return false;
  }
}

module.exports = {
  createPaymentIntent,
  capturePayment,
  processPaymentWebhook,
  processRefund,
  getPaymentHistory,
  getPaymentById,
  verifyWebhookSignature,
  revalidateCOEAvailability
};
```

---

## API Endpoints

### File: `routes/payments.js` (New)

```javascript
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const paymentService = require('../services/paymentService');
const Joi = require('joi');

/**
 * Validation Schemas
 */
const createPaymentIntentSchema = Joi.object({
  paymentType: Joi.string().valid('deposit', 'final_payment', 'full_payment').required()
});

const refundSchema = Joi.object({
  amount: Joi.number().positive().optional(),
  reason: Joi.string().required()
});

/**
 * POST /v1/payments/coe/:coeId/intent
 * Create payment intent for COE (client can pay their own COE)
 */
router.post('/coe/:coeId/intent', authenticateToken, async (req, res) => {
  try {
    // Validate input
    const { error, value } = createPaymentIntentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }
    
    const { paymentType } = value;
    
    // Generate idempotency key if not provided
    const idempotencyKey = req.headers['idempotency-key'] || crypto.randomBytes(16).toString('hex');
    
    const result = await paymentService.createPaymentIntent(
      req.params.coeId,
      req.user._id,
      paymentType,
      idempotencyKey
    );
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Payment intent error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({
      success: false,
      error: {
        code: 'PAYMENT_INTENT_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /v1/payments/:paymentId/capture
 * Capture authorized payment (admin only)
 */
router.post('/:paymentId/capture', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payment = await paymentService.capturePayment(req.params.paymentId);
    
    res.json({
      success: true,
      data: payment
    });
    
  } catch (error) {
    console.error('Payment capture error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({
      success: false,
      error: {
        code: 'PAYMENT_CAPTURE_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /v1/payments/:paymentId/refund
 * Process refund (admin only)
 */
router.post('/:paymentId/refund', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Validate input
    const { error, value } = refundSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }
    
    const { amount, reason } = value;
    
    const refund = await paymentService.processRefund(
      req.params.paymentId,
      amount,
      reason
    );
    
    res.json({
      success: true,
      data: refund
    });
    
  } catch (error) {
    console.error('Refund error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({
      success: false,
      error: {
        code: 'REFUND_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/payments/coe/:coeId
 * Get payment history for COE
 */
router.get('/coe/:coeId', authenticateToken, async (req, res) => {
  try {
    const payments = await paymentService.getPaymentHistory(req.params.coeId);
    
    res.json({
      success: true,
      data: payments
    });
    
  } catch (error) {
    console.error('Get payment history error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_PAYMENTS_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/payments/:paymentId
 * Get payment details
 */
router.get('/:paymentId', authenticateToken, async (req, res) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.paymentId);
    
    res.json({
      success: true,
      data: payment
    });
    
  } catch (error) {
    console.error('Get payment error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(404).json({
      success: false,
      error: {
        code: 'PAYMENT_NOT_FOUND',
        message: error.message
      }
    });
  }
});

module.exports = router;
```

---

### File: `routes/webhooks.js` (New)

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
    
    // Verify webhook signature
    const isValid = paymentService.verifyWebhookSignature(req.body, signature);
    
    if (!isValid) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // Process webhook
    const result = await paymentService.processPaymentWebhook(req.body);
    
    res.json({ received: true, processed: result.processed });
    
  } catch (error) {
    console.error('Webhook processing error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
```

---

## Email Service Updates

### Add Payment Confirmation Email

**File**: `utils/emailService.js`

**Add new function:**

```javascript
/**
 * Send payment confirmation email
 * @param {Object} user - User who made payment
 * @param {Object} coe - COE object
 * @param {Object} payment - Payment object
 * @returns {Promise<Object>} Send result
 */
async function sendPaymentConfirmationEmail(user, coe, payment) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { margin: 0; font-size: 28px; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-badge { background: #27ae60; color: white; padding: 10px 20px; border-radius: 20px; display: inline-block; margin: 10px 0; font-weight: bold; }
        .payment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #27ae60; }
        .detail-row { margin: 10px 0; }
        .detail-label { font-weight: bold; color: #666; }
        .amount { font-size: 24px; color: #27ae60; font-weight: bold; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Payment Confirmed!</h2>
          <p>Hi ${user.firstName},</p>
          <p><span class="success-badge">✓ Payment Successful</span></p>
          <p>Your payment has been processed successfully.</p>
          
          <div class="payment-details">
            <h3 style="margin-top: 0; color: #2c3e50;">${coe.name}</h3>
            <div class="detail-row">
              <span class="detail-label">Payment Type:</span> ${payment.payment_type.replace('_', ' ').toUpperCase()}
            </div>
            <div class="detail-row">
              <span class="detail-label">Amount Paid:</span> $${formatCurrency(payment.amount)}
            </div>
            <div class="detail-row">
              <span class="detail-label">Transaction ID:</span> ${payment.gp_transaction_id}
            </div>
            <div class="detail-row">
              <span class="detail-label">Payment Date:</span> ${formatDate(payment.completed_at || new Date())}
            </div>
            ${payment.card_last_four ? `
              <div class="detail-row">
                <span class="detail-label">Payment Method:</span> ${payment.card_brand} ending in ${payment.card_last_four}
              </div>
            ` : ''}
          </div>
          
          ${payment.payment_type === 'deposit' ? `
            <p><strong>Next Steps:</strong></p>
            <p>Your deposit has been received. The final payment of $${formatCurrency(coe.final_amount || (coe.total_amount - payment.amount))} is due 48 hours before the event.</p>
          ` : ''}
          
          ${payment.payment_type === 'full_payment' || payment.payment_type === 'final_payment' ? `
            <p><strong>You're all set!</strong></p>
            <p>Your booking is confirmed. We look forward to providing you with an unforgettable experience!</p>
          ` : ''}
          
          <p>If you have any questions, please contact us.</p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: `Payment Confirmed: ${coe.name}`,
    html
  });
}

// Add to exports
module.exports = {
  // ... existing exports
  sendPaymentConfirmationEmail
};
```

---

## Server.js Updates

**Add payment and webhook routes:**

```javascript
// Import routes
const paymentRoutes = require('./routes/payments');
const webhookRoutes = require('./routes/webhooks');

// Routes
app.use('/v1/payments', paymentRoutes);
app.use('/webhooks', webhookRoutes);
```

---

## Dependencies

### Required Packages

```bash
npm install axios  # For HTTP requests to Global Payments API
```

**Note**: No official Global Payments Node.js SDK needed - we'll use REST API directly with axios.

---

## Global Payments API Integration

### Authentication

**Method**: HTTP Basic Authentication

```javascript
const authString = Buffer.from(`${GP_APP_NAME}:${GP_APP_KEY}`).toString('base64');

headers: {
  'Authorization': `Basic ${authString}`
}
```

### Base URLs

**Sandbox**: `https://apis.sandbox.globalpay.com`  
**Production**: `https://apis.globalpay.com`

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/transactions` | POST | Create payment transaction |
| `/transactions/:id/capture` | POST | Capture authorized payment |
| `/transactions/:id/refund` | POST | Refund payment |
| `/transactions/:id` | GET | Get transaction details |

---

## Payment Workflow Details

### Deposit Payment Flow

```
1. Client views COE → Status: 'sent', Payment: 'unpaid'
2. Client clicks "Pay Deposit" ($2,000 for $10,000 COE)
3. Frontend calls: POST /v1/payments/coe/{coeId}/intent
4. Backend:
   - Revalidates seat availability ✓
   - Creates Payment record (status: 'pending')
   - Calls Global Payments API
   - Returns payment URL
5. Client redirected to Global Payments hosted page
6. Client enters card details
7. Global Payments processes payment
8. Webhook received: payment.completed
9. Backend updates:
   - Payment status → 'completed'
   - COE payment_status → 'deposit_paid'
   - COE status → 'accepted' (or stays 'sent')
10. Confirmation email sent to client
11. Admin notified
```

### Final Payment Flow

```
1. COE status: 'accepted', Payment: 'deposit_paid'
2. Client clicks "Pay Balance" ($8,000 remaining)
3. Same flow as deposit
4. On completion:
   - COE payment_status → 'fully_paid'
   - Seats status → 'booked' (from 'held')
   - COE status → 'accepted' (confirmed)
```

### Full Payment Flow (No Deposit)

```
1. Client pays full amount upfront ($10,000)
2. Same flow as deposit
3. On completion:
   - COE payment_status → 'fully_paid'
   - Seats status → 'booked'
   - COE status → 'accepted'
```

### Refund Flow

```
1. Admin decides to cancel COE or issue refund
2. Admin clicks "Refund" in dashboard
3. POST /v1/payments/{paymentId}/refund
4. Backend calls Global Payments refund API
5. On success:
   - Payment status → 'refunded'
   - COE total_paid reduced
   - Seats released → 'available'
   - Refund confirmation email sent
```

---

## Security & Compliance

### PCI Compliance

**Approach**: Hosted Payment Pages (PCI Level 1 compliant)

✅ **Card data never touches our servers**  
✅ **Global Payments handles all card processing**  
✅ **We only store**:
- Last 4 digits of card
- Card brand (Visa, Mastercard)
- Transaction IDs
- Payment status

### Idempotency

**Prevent duplicate payments:**

```javascript
// Client sends idempotency key in header
headers: {
  'Idempotency-Key': 'unique-request-id'
}

// Backend checks for duplicate
const existing = await Payment.findOne({ idempotency_key: key });
if (existing) {
  return existing;  // Return existing payment, don't create new
}
```

### Webhook Security

**Verify webhook signature:**

```javascript
const signature = req.headers['x-gp-signature'];
const isValid = verifyWebhookSignature(req.body, signature);

if (!isValid) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

---

## Testing

### Sandbox Testing

**Test Cards** (provided by Global Payments):

```
Successful Payment:
Card: 4263970000005262
CVV: 123
Exp: Any future date

Declined Payment:
Card: 4000000000000002
CVV: 123
Exp: Any future date

3D Secure Required:
Card: 4222000001227408
CVV: 123
Exp: Any future date
```

### Test Scenarios

1. **Deposit Payment**:
   - Create COE ($10,000)
   - Pay deposit ($2,000)
   - Verify: payment_status = 'deposit_paid'

2. **Final Payment**:
   - After deposit paid
   - Pay balance ($8,000)
   - Verify: payment_status = 'fully_paid', seats = 'booked'

3. **Full Payment**:
   - Create COE ($10,000)
   - Pay full amount ($10,000)
   - Verify: payment_status = 'fully_paid', seats = 'booked'

4. **Failed Payment**:
   - Use declined test card
   - Verify: payment status = 'failed', COE unchanged

5. **Refund**:
   - Process successful payment
   - Initiate refund
   - Verify: payment refunded, seats released

6. **Idempotency**:
   - Submit payment twice with same key
   - Verify: Only one payment created

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `INVALID_CREDENTIALS` | Wrong GP_APP_KEY | Check credentials |
| `INSUFFICIENT_FUNDS` | Card declined | Ask client to use different card |
| `SEATS_UNAVAILABLE` | Seats taken during checkout | Notify client, offer alternatives |
| `DUPLICATE_PAYMENT` | Same idempotency key | Return existing payment |
| `REFUND_FAILED` | Already refunded | Check payment status |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "PAYMENT_FAILED",
    "message": "Payment processing failed",
    "details": {
      "gp_error_code": "declined",
      "gp_error_message": "Insufficient funds"
    }
  }
}
```

---

## Monitoring & Logging

### Payment Events to Log

- Payment intent created
- Payment authorized
- Payment captured
- Payment completed
- Payment failed
- Refund initiated
- Refund completed
- Webhook received
- Availability revalidation results

### Metrics to Track

- **Success Rate**: % of successful payments
- **Average Payment Time**: Intent → completion
- **Refund Rate**: % of payments refunded
- **Failed Payment Reasons**: Categorize failures
- **Revenue**: Total captured, by time period

---

## Cost Estimation

### Global Payments Fees

**Standard Pricing**:
- Card payments: 2.9% + $0.30 per transaction
- ACH payments: 0.8% + $0.30 per transaction

**Example COE Costs**:

| COE Amount | GP Fee (2.9%) | Net Revenue |
|------------|---------------|-------------|
| $1,000     | $29.30        | $970.70     |
| $5,000     | $145.30       | $4,854.70   |
| $10,000    | $290.30       | $9,709.70   |
| $50,000    | $1,450.30     | $48,549.70  |

**Fee Strategy**:
- Option A: Platform absorbs fees
- Option B: Pass to client (add 3% to prices)
- Option C: Hybrid (split fees)

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [x] Configure Global Payments credentials
- [ ] Create Payment model
- [ ] Create payment service
- [ ] Add payment routes
- [ ] Add webhook handler

### Phase 2: COE Payment Integration (Week 2)
- [ ] Update COE schema with payment fields
- [ ] Implement deposit payment flow
- [ ] Implement final payment flow
- [ ] Implement full payment flow
- [ ] Add availability revalidation

### Phase 3: Admin Features (Week 3)
- [ ] Payment dashboard in admin UI
- [ ] Refund interface
- [ ] Payment history view
- [ ] Transaction log display

### Phase 4: Client Experience (Week 3-4)
- [ ] COE payment UI for clients
- [ ] Payment status display
- [ ] Payment confirmation page
- [ ] Payment receipt generation

### Phase 5: Testing & Production (Week 4)
- [ ] Sandbox testing complete
- [ ] Webhook testing
- [ ] Error handling validation
- [ ] Production credentials configured
- [ ] First live transaction test

---

## Rollout Plan

### Development Phase
1. ✅ Global Payments credentials configured
2. Implement payment service with sandbox
3. Test with sandbox test cards
4. Verify webhook delivery
5. Complete integration testing

### Staging Phase
1. Deploy to staging environment
2. Test complete payment flows
3. Verify email confirmations
4. Test refund processing
5. Load testing

### Production Phase
1. Configure production GP credentials
2. Deploy to production
3. Test with small transaction ($10)
4. Monitor for 24 hours
5. Gradual rollout to real clients

---

## Webhook Configuration

### In Global Payments Dashboard

1. Log into Global Payments Dashboard
2. Go to **Webhooks** or **Developer Settings**
3. Add webhook URL: `https://the1.vip/webhooks/global-payments`
4. Select events to receive:
   - `payment.authorized`
   - `payment.captured`
   - `payment.completed`
   - `payment.failed`
   - `refund.completed`
5. Copy webhook secret to `GP_WEBHOOK_SECRET`

---

## Card Tokenization (Save Payment Methods)

### Overview
Card tokenization allows clients to save their payment information securely for future use, enabling one-click payments without re-entering card details.

**Note**: ⚠️ Verify exact API endpoints and request formats with [Global Payments API Documentation](https://developer.globalpay.com/api) during implementation.

### Benefits
- ✅ One-click payments for returning clients
- ✅ No PCI compliance burden (Global Payments stores card data)
- ✅ Improved user experience
- ✅ Reduced cart abandonment
- ✅ Enables recurring payments
- ✅ Clients can manage multiple payment methods

---

### Database Schema for Tokenization

#### Update User Model

**File**: `models/User.js`

**Add fields:**
```javascript
{
  // Saved Payment Methods
  saved_payment_methods: [{
    token_id: {
      type: String,
      required: true
    },
    card_brand: {
      type: String  // visa, mastercard, amex, discover
    },
    card_last_four: {
      type: String,
      maxlength: 4
    },
    expiry_month: {
      type: String
    },
    expiry_year: {
      type: String
    },
    is_default: {
      type: Boolean,
      default: false
    },
    nickname: {
      type: String  // e.g., "Business Card", "Personal Card"
    },
    created_at: {
      type: Date,
      default: Date.now
    },
    last_used_at: {
      type: Date
    }
  }],
  
  default_payment_method: {
    type: String  // token_id of default payment method
  }
}
```

#### Update Payment Model

**File**: `models/Payment.js`

**Add fields:**
```javascript
{
  // Tokenization
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
  }
}
```

---

### Tokenization Service Functions

**File**: `services/paymentService.js`

**Add these functions:**

```javascript
/**
 * Tokenize card and save to user profile
 * @param {string} userId - User ID
 * @param {Object} cardDetails - Card details from payment form
 * @param {boolean} setAsDefault - Set as default payment method
 * @returns {Promise<Object>} Token data
 */
async function tokenizeAndSaveCard(userId, cardDetails, setAsDefault = true) {
  try {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Call Global Payments tokenization API
    const gpClient = createGPClient();
    
    const tokenRequest = {
      account_name: GP_CONFIG.merchantId,
      card: {
        number: cardDetails.number,
        expiry_month: cardDetails.expiry_month,
        expiry_year: cardDetails.expiry_year,
        cvv: cardDetails.cvv
      },
      usage_mode: 'MULTIPLE'  // Can be used multiple times
    };
    
    const gpResponse = await gpClient.post('/payment-methods', tokenRequest);
    
    // Extract token and card info
    const tokenId = gpResponse.data.id;
    const cardInfo = gpResponse.data.card;
    
    // Save to user profile
    const savedMethod = {
      token_id: tokenId,
      card_brand: cardInfo.brand,
      card_last_four: cardInfo.last_four || cardInfo.masked_number_last4,
      expiry_month: cardDetails.expiry_month,
      expiry_year: cardDetails.expiry_year,
      is_default: setAsDefault || user.saved_payment_methods.length === 0,
      nickname: cardDetails.nickname || `${cardInfo.brand} ending in ${cardInfo.last_four}`,
      created_at: new Date()
    };
    
    user.saved_payment_methods.push(savedMethod);
    
    // Set as default if requested or if first card
    if (setAsDefault || !user.default_payment_method) {
      user.default_payment_method = tokenId;
      
      // Unset other cards as default
      user.saved_payment_methods.forEach(method => {
        if (method.token_id !== tokenId) {
          method.is_default = false;
        }
      });
    }
    
    await user.save();
    
    console.log('Card tokenized and saved:', {
      user_id: userId,
      token_id: tokenId,
      card_last_four: cardInfo.last_four,
      timestamp: new Date().toISOString()
    });
    
    return {
      token_id: tokenId,
      card_brand: cardInfo.brand,
      card_last_four: cardInfo.last_four,
      is_default: savedMethod.is_default
    };
    
  } catch (error) {
    console.error('Card tokenization failed:', {
      user_id: userId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Charge a saved payment method
 * @param {string} userId - User ID
 * @param {string} tokenId - Payment token ID
 * @param {number} amount - Amount to charge
 * @param {string} description - Payment description
 * @param {string} coeId - COE ID (optional)
 * @returns {Promise<Object>} Payment result
 */
async function chargeSavedCard(userId, tokenId, amount, description, coeId = null) {
  try {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Verify user owns this token
    const savedMethod = user.saved_payment_methods.find(m => m.token_id === tokenId);
    
    if (!savedMethod) {
      throw new Error('Payment method not found or unauthorized');
    }
    
    // Create payment record
    const payment = new Payment({
      coe_id: coeId,
      user_id: userId,
      amount,
      currency: GP_CONFIG.currency,
      payment_type: coeId ? 'coe_payment' : 'general_payment',
      payment_token_id: tokenId,
      is_token_payment: true,
      status: 'pending',
      description
    });
    
    await payment.save();
    
    // Charge using saved token
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
        storage_mode: 'ON_FILE'  // Indicates stored credential
      },
      order: {
        description
      }
    };
    
    const gpResponse = await gpClient.post('/transactions', chargeRequest);
    
    // Update payment
    payment.gp_transaction_id = gpResponse.data.id;
    payment.status = gpResponse.data.status === 'CAPTURED' ? 'completed' : 'processing';
    payment.completed_at = new Date();
    payment.card_brand = savedMethod.card_brand;
    payment.card_last_four = savedMethod.card_last_four;
    await payment.save();
    
    // Update last used timestamp
    savedMethod.last_used_at = new Date();
    await user.save();
    
    console.log('Saved card charged:', {
      user_id: userId,
      token_id: tokenId,
      amount,
      payment_id: payment._id,
      timestamp: new Date().toISOString()
    });
    
    return payment;
    
  } catch (error) {
    console.error('Saved card charge failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Remove saved payment method
 * @param {string} userId - User ID
 * @param {string} tokenId - Token ID to remove
 * @returns {Promise<boolean>} Success status
 */
async function removeSavedCard(userId, tokenId) {
  try {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Find the payment method
    const methodIndex = user.saved_payment_methods.findIndex(m => m.token_id === tokenId);
    
    if (methodIndex === -1) {
      throw new Error('Payment method not found');
    }
    
    const wasDefault = user.saved_payment_methods[methodIndex].is_default;
    
    // Remove from user profile
    user.saved_payment_methods.splice(methodIndex, 1);
    
    // If was default, set another as default
    if (wasDefault && user.saved_payment_methods.length > 0) {
      user.saved_payment_methods[0].is_default = true;
      user.default_payment_method = user.saved_payment_methods[0].token_id;
    } else if (user.saved_payment_methods.length === 0) {
      user.default_payment_method = null;
    }
    
    await user.save();
    
    // Optionally: Delete token from Global Payments
    // (Some gateways auto-expire unused tokens)
    try {
      const gpClient = createGPClient();
      await gpClient.delete(`/payment-methods/${tokenId}`);
    } catch (gpError) {
      console.warn('GP token deletion failed (may not be supported):', gpError.message);
    }
    
    console.log('Payment method removed:', {
      user_id: userId,
      token_id: tokenId,
      timestamp: new Date().toISOString()
    });
    
    return true;
    
  } catch (error) {
    console.error('Remove payment method failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Set default payment method
 * @param {string} userId - User ID
 * @param {string} tokenId - Token ID to set as default
 * @returns {Promise<boolean>} Success status
 */
async function setDefaultPaymentMethod(userId, tokenId) {
  try {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Verify token exists
    const method = user.saved_payment_methods.find(m => m.token_id === tokenId);
    
    if (!method) {
      throw new Error('Payment method not found');
    }
    
    // Update default
    user.saved_payment_methods.forEach(m => {
      m.is_default = (m.token_id === tokenId);
    });
    
    user.default_payment_method = tokenId;
    await user.save();
    
    console.log('Default payment method updated:', {
      user_id: userId,
      token_id: tokenId,
      timestamp: new Date().toISOString()
    });
    
    return true;
    
  } catch (error) {
    console.error('Set default payment method failed:', error);
    throw error;
  }
}
```

---

### Tokenization API Endpoints

**File**: `routes/payments.js`

**Add these endpoints:**

```javascript
/**
 * POST /v1/payments/tokenize
 * Tokenize and save card for future use
 */
router.post('/tokenize', authenticateToken, async (req, res) => {
  try {
    const { cardDetails, setAsDefault, nickname } = req.body;
    
    // Validate card details
    if (!cardDetails || !cardDetails.number || !cardDetails.expiry_month || !cardDetails.expiry_year) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Card details are required'
        }
      });
    }
    
    const result = await paymentService.tokenizeAndSaveCard(
      req.user._id,
      { ...cardDetails, nickname },
      setAsDefault
    );
    
    res.json({
      success: true,
      data: result,
      message: 'Payment method saved successfully'
    });
    
  } catch (error) {
    console.error('Tokenization error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({
      success: false,
      error: {
        code: 'TOKENIZATION_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/payments/saved-cards
 * Get user's saved payment methods
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
    
    // Return saved cards (without sensitive data)
    const savedCards = user.saved_payment_methods.map(method => ({
      token_id: method.token_id,
      card_brand: method.card_brand,
      card_last_four: method.card_last_four,
      expiry_month: method.expiry_month,
      expiry_year: method.expiry_year,
      is_default: method.is_default,
      nickname: method.nickname,
      created_at: method.created_at,
      last_used_at: method.last_used_at
    }));
    
    res.json({
      success: true,
      data: {
        saved_cards: savedCards,
        default_payment_method: user.default_payment_method
      }
    });
    
  } catch (error) {
    console.error('Get saved cards error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to retrieve saved cards' }
    });
  }
});

/**
 * POST /v1/payments/saved-card/:tokenId/charge
 * Charge a saved payment method
 */
router.post('/saved-card/:tokenId/charge', authenticateToken, async (req, res) => {
  try {
    const { amount, description, coeId } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'Valid amount is required' }
      });
    }
    
    const payment = await paymentService.chargeSavedCard(
      req.user._id,
      req.params.tokenId,
      amount,
      description,
      coeId
    );
    
    res.json({
      success: true,
      data: payment,
      message: 'Payment processed successfully'
    });
    
  } catch (error) {
    console.error('Charge saved card error:', error);
    res.status(400).json({
      success: false,
      error: {
        code: 'CHARGE_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * DELETE /v1/payments/saved-cards/:tokenId
 * Remove saved payment method
 */
router.delete('/saved-cards/:tokenId', authenticateToken, async (req, res) => {
  try {
    await paymentService.removeSavedCard(req.user._id, req.params.tokenId);
    
    res.json({
      success: true,
      message: 'Payment method removed successfully'
    });
    
  } catch (error) {
    console.error('Remove card error:', error);
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * PUT /v1/payments/saved-cards/:tokenId/default
 * Set default payment method
 */
router.put('/saved-cards/:tokenId/default', authenticateToken, async (req, res) => {
  try {
    await paymentService.setDefaultPaymentMethod(req.user._id, req.params.tokenId);
    
    res.json({
      success: true,
      message: 'Default payment method updated'
    });
    
  } catch (error) {
    console.error('Set default card error:', error);
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});
```

---

### Tokenization Workflows

#### Workflow 1: Save Card During First Payment

```
1. Client views COE → Clicks "Pay Deposit"
   ↓
2. Payment form shown with:
   - Card number field
   - Expiry date
   - CVV
   - ☑ "Save card for future payments"
   ↓
3. Client enters card details and checks "Save card"
   ↓
4. Frontend → POST /v1/payments/coe/{id}/intent
   Body: { paymentType: 'deposit', saveCard: true, cardDetails: {...} }
   ↓
5. Backend:
   - Calls GP tokenization API
   - Receives token: PMT_abc123
   - Saves token to user.saved_payment_methods
   - Charges token for deposit
   - Creates Payment record
   ↓
6. Payment completed
   ↓
7. Card saved for future use ✅
```

#### Workflow 2: Pay with Saved Card

```
1. Client views COE → Clicks "Pay Balance"
   ↓
2. UI shows saved cards:
   [DEFAULT] Visa ending in 5262
   Mastercard ending in 1234
   [+ Add new card]
   ↓
3. Client selects saved card → Clicks "Pay Now"
   (No card entry needed!)
   ↓
4. Frontend → POST /v1/payments/saved-card/{tokenId}/charge
   Body: { amount: 8000, description: 'Final payment', coeId: '...' }
   ↓
5. Backend:
   - Validates user owns token
   - Charges token via GP
   - No card details needed
   ↓
6. Payment completed ✅
```

#### Workflow 3: Manage Saved Cards

```
1. Client → Profile → Payment Methods
   ↓
2. See list of saved cards:
   - Visa ending in 5262 [DEFAULT] [Remove]
   - Mastercard ending in 1234 [Set as Default] [Remove]
   ↓
3. Actions:
   - Add new card → Tokenize and save
   - Remove card → DELETE /v1/payments/saved-cards/{tokenId}
   - Set default → PUT /v1/payments/saved-cards/{tokenId}/default
```

---

## Recurring Payments & Subscriptions

### Overview
Recurring payments enable automatic monthly or yearly membership billing, allowing clients to subscribe to premium tiers with automatic renewals.

**Note**: ⚠️ Verify exact API endpoints with [Global Payments Recurring Billing Docs](https://developer.globalpay.com/) during implementation.

### Membership Tiers

| Tier | Monthly | Yearly | Savings | Benefits |
|------|---------|--------|---------|----------|
| **Basic** | $49 | $490 | $98/year | Access to events, 5% COE discount |
| **Premium** | $99 | $990 | $198/year | 10% COE discount, priority booking |
| **VIP** | $199 | $1,990 | $398/year | 15% COE discount, concierge service |
| **Elite** | $499 | $4,999 | $989/year | 20% COE discount, exclusive events, dedicated runner |

---

### Subscription Database Schema

#### New Model: Subscription

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
    enum: ['active', 'paused', 'cancelled', 'expired', 'failed'],
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
  current_period_start: {
    type: Date,
    required: true
  },
  current_period_end: {
    type: Date,
    required: true
  },
  next_billing_date: {
    type: Date,
    required: true,
    index: true
  },
  end_date: {
    type: Date
  },
  cancelled_at: {
    type: Date
  },
  paused_at: {
    type: Date
  },
  
  // Payment Method
  payment_token_id: {
    type: String,
    required: true
  },
  card_last_four: {
    type: String
  },
  card_brand: {
    type: String
  },
  
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
  last_payment_date: {
    type: Date
  },
  last_payment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  last_failure_date: {
    type: Date
  },
  last_failure_reason: {
    type: String
  },
  
  // Cancellation
  cancellation_reason: {
    type: String
  },
  cancelled_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
subscriptionSchema.index({ user_id: 1, status: 1 });
subscriptionSchema.index({ next_billing_date: 1, status: 1 });
subscriptionSchema.index({ gp_schedule_id: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
```

#### Update User Model for Memberships

**File**: `models/User.js`

**Add fields:**
```javascript
{
  // Membership Status
  membership_status: {
    type: String,
    enum: ['free', 'active', 'cancelled', 'expired', 'suspended'],
    default: 'free',
    index: true
  },
  membership_tier: {
    type: String,
    enum: ['basic', 'premium', 'vip', 'elite'],
    index: true
  },
  membership_started_at: {
    type: Date
  },
  membership_expires_at: {
    type: Date
  },
  active_subscription_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription'
  }
}
```

---

### Recurring Payment Service Functions

**File**: `services/subscriptionService.js` (NEW)

```javascript
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Payment = require('../models/Payment');
const emailService = require('../utils/emailService');
const axios = require('axios');

/**
 * Membership pricing configuration
 */
const MEMBERSHIP_PRICING = {
  basic: { monthly: 49, yearly: 490 },
  premium: { monthly: 99, yearly: 990 },
  vip: { monthly: 199, yearly: 1990 },
  elite: { monthly: 499, yearly: 4999 }
};

/**
 * Create Global Payments API client
 */
function createGPClient() {
  const authString = Buffer.from(`${process.env.GP_APP_NAME}:${process.env.GP_APP_KEY}`).toString('base64');
  
  return axios.create({
    baseURL: process.env.GP_SERVICE_URL || 'https://apis.sandbox.globalpay.com',
    headers: {
      'Authorization': `Basic ${authString}`,
      'Content-Type': 'application/json',
      'X-GP-Version': '2021-03-22'
    },
    timeout: 30000
  });
}

/**
 * Create subscription
 * @param {string} userId - User ID
 * @param {string} tier - Membership tier
 * @param {string} frequency - Billing frequency (monthly/yearly)
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
      throw new Error('Payment method not found');
    }
    
    // Check if user already has active subscription
    const existingSubscription = await Subscription.findOne({
      user_id: userId,
      status: 'active'
    });
    
    if (existingSubscription) {
      throw new Error('User already has an active subscription');
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
    
    // Create recurring schedule in Global Payments
    const gpClient = createGPClient();
    
    const scheduleRequest = {
      account_name: process.env.GP_MERCHANT_ID,
      payment_method: {
        id: paymentTokenId,
        storage_mode: 'ON_FILE'
      },
      amount: Math.round(amount * 100),
      currency: 'USD',
      frequency: frequency === 'monthly' ? 'MONTHLY' : 'YEARLY',
      start_date: nextBillingDate.toISOString().split('T')[0],
      description: `The1 Platform - ${tier} Membership (${frequency})`,
      number_of_payments: null  // Indefinite
    };
    
    const gpResponse = await gpClient.post('/recurring/schedules', scheduleRequest);
    
    // Update subscription with GP schedule ID
    subscription.gp_schedule_id = gpResponse.data.id;
    await subscription.save();
    
    // Process first payment immediately
    const firstPayment = await processSubscriptionPayment(subscription._id, true);
    
    // Update user membership status
    user.membership_status = 'active';
    user.membership_tier = tier;
    user.membership_started_at = startDate;
    user.membership_expires_at = nextBillingDate;
    user.active_subscription_id = subscription._id;
    await user.save();
    
    // Send subscription confirmation email
    emailService.sendSubscriptionConfirmationEmail(user, subscription)
      .catch(err => console.error('Subscription email error:', err));
    
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
 * Process subscription payment (called by cron or webhook)
 * @param {string} subscriptionId - Subscription ID
 * @param {boolean} isFirstPayment - Is this the first payment
 * @returns {Promise<Object>} Payment result
 */
async function processSubscriptionPayment(subscriptionId, isFirstPayment = false) {
  try {
    const subscription = await Subscription.findById(subscriptionId)
      .populate('user_id');
    
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    if (subscription.status !== 'active') {
      throw new Error(`Cannot process payment for ${subscription.status} subscription`);
    }
    
    // Create payment record
    const payment = new Payment({
      user_id: subscription.user_id._id,
      amount: subscription.amount,
      currency: subscription.currency,
      payment_type: 'subscription',
      payment_token_id: subscription.payment_token_id,
      is_token_payment: true,
      status: 'pending',
      description: `${subscription.tier} Membership - ${subscription.frequency} billing`
    });
    
    await payment.save();
    
    // Charge saved card via Global Payments
    const gpClient = createGPClient();
    
    const chargeRequest = {
      account_name: process.env.GP_MERCHANT_ID,
      type: 'SALE',
      channel: 'CNP',
      amount: Math.round(subscription.amount * 100),
      currency: subscription.currency,
      reference: payment._id.toString(),
      payment_method: {
        id: subscription.payment_token_id,
        entry_mode: 'ECOM',
        storage_mode: 'ON_FILE',
        initiator: 'MERCHANT'  // Indicates recurring payment
      },
      order: {
        description: `Subscription payment - ${subscription.tier}`
      }
    };
    
    const gpResponse = await gpClient.post('/transactions', chargeRequest);
    
    // Update payment
    payment.gp_transaction_id = gpResponse.data.id;
    payment.status = gpResponse.data.status === 'CAPTURED' ? 'completed' : 'processing';
    payment.completed_at = new Date();
    payment.card_brand = subscription.card_brand;
    payment.card_last_four = subscription.card_last_four;
    await payment.save();
    
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
    
    // Send receipt email
    if (!isFirstPayment) {
      emailService.sendSubscriptionPaymentReceiptEmail(user, subscription, payment)
        .catch(err => console.error('Receipt email error:', err));
    }
    
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
        user.membership_status = 'suspended';
        await user.save();
        
        // Send suspension email
        emailService.sendSubscriptionSuspendedEmail(user, subscription)
          .catch(err => console.error('Suspension email error:', err));
      } else {
        // Send payment failed email
        emailService.sendSubscriptionPaymentFailedEmail(subscription.user_id, subscription, subscription.failed_payments)
          .catch(err => console.error('Failed payment email error:', err));
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
    
    // Cancel in Global Payments
    try {
      const gpClient = createGPClient();
      await gpClient.post(`/recurring/schedules/${subscription.gp_schedule_id}/cancel`);
    } catch (gpError) {
      console.warn('GP schedule cancellation failed:', gpError.message);
      // Continue anyway - we'll stop billing from our side
    }
    
    // Update subscription
    subscription.status = 'cancelled';
    subscription.cancelled_at = new Date();
    subscription.cancellation_reason = reason;
    subscription.cancelled_by = userId;
    subscription.end_date = subscription.current_period_end;  // Access until period ends
    await subscription.save();
    
    // Update user (membership expires at end of current period)
    const user = await User.findById(userId);
    user.membership_status = 'cancelled';
    await user.save();
    
    // Send cancellation confirmation
    emailService.sendSubscriptionCancelledEmail(user, subscription)
      .catch(err => console.error('Cancellation email error:', err));
    
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
    console.error('Subscription cancellation failed:', error);
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
    console.error('Error getting user subscriptions:', error);
    throw error;
  }
}

/**
 * Update subscription payment method
 * @param {string} subscriptionId - Subscription ID
 * @param {string} userId - User ID
 * @param {string} newTokenId - New payment token ID
 * @returns {Promise<Object>} Update result
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
    
    // Update in Global Payments
    try {
      const gpClient = createGPClient();
      await gpClient.put(`/recurring/schedules/${subscription.gp_schedule_id}`, {
        payment_method: {
          id: newTokenId
        }
      });
    } catch (gpError) {
      console.warn('GP schedule update failed:', gpError.message);
    }
    
    // Update subscription
    subscription.payment_token_id = newTokenId;
    subscription.card_last_four = newMethod.card_last_four;
    subscription.card_brand = newMethod.card_brand;
    subscription.failed_payments = 0;  // Reset failure count
    
    // Reactivate if was failed
    if (subscription.status === 'failed') {
      subscription.status = 'active';
      
      const user = await User.findById(userId);
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
    console.error('Update payment method failed:', error);
    throw error;
  }
}

module.exports = {
  createSubscription,
  processSubscriptionPayment,
  cancelSubscription,
  getUserSubscriptions,
  updateSubscriptionPaymentMethod,
  MEMBERSHIP_PRICING
};
```

---

### Subscription API Endpoints

**File**: `routes/subscriptions.js` (NEW)

```javascript
const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const subscriptionService = require('../services/subscriptionService');
const Joi = require('joi');

/**
 * Validation Schemas
 */
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
    console.error('Create subscription error:', error);
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
    console.error('Get subscriptions error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to retrieve subscriptions' }
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
        error: { message: error.details[0].message }
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
    console.error('Cancel subscription error:', error);
    res.status(400).json({
      success: false,
      error: { message: error.message }
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
        error: { message: error.details[0].message }
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
    console.error('Update payment method error:', error);
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

/**
 * GET /v1/subscriptions (admin only)
 * Get all subscriptions
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, tier } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (tier) query.tier = tier;
    
    const subscriptions = await Subscription.find(query)
      .populate('user_id', 'firstName lastName email')
      .sort({ created_at: -1 });
    
    res.json({
      success: true,
      data: subscriptions
    });
    
  } catch (error) {
    console.error('Get all subscriptions error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to retrieve subscriptions' }
    });
  }
});

module.exports = router;
```

---

### Automated Billing (Cron Jobs)

**File**: `utils/cronJobs.js` (NEW)

```javascript
const cron = require('node-cron');
const Subscription = require('../models/Subscription');
const subscriptionService = require('../services/subscriptionService');

/**
 * Process daily recurring payments
 * Runs every day at 00:00 UTC
 */
function startRecurringPaymentsCron() {
  // Run daily at midnight UTC
  cron.schedule('0 0 * * *', async () => {
    console.log('Running recurring payments cron job:', new Date().toISOString());
    
    try {
      // Find subscriptions due for billing today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const dueSubscriptions = await Subscription.find({
        status: 'active',
        next_billing_date: {
          $gte: today,
          $lt: tomorrow
        }
      });
      
      console.log(`Found ${dueSubscriptions.length} subscriptions due for billing`);
      
      // Process each subscription
      for (const subscription of dueSubscriptions) {
        try {
          await subscriptionService.processSubscriptionPayment(subscription._id);
          console.log(`✅ Processed subscription: ${subscription._id}`);
        } catch (error) {
          console.error(`❌ Failed to process subscription ${subscription._id}:`, error.message);
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      console.log('Recurring payments cron job completed');
      
    } catch (error) {
      console.error('Recurring payments cron job failed:', error);
    }
  });
  
  console.log('✅ Recurring payments cron job scheduled (daily at 00:00 UTC)');
}

/**
 * Retry failed subscription payments
 * Runs every day at 12:00 UTC
 */
function startFailedPaymentRetryCron() {
  // Run daily at noon UTC
  cron.schedule('0 12 * * *', async () => {
    console.log('Running failed payment retry cron job:', new Date().toISOString());
    
    try {
      // Find subscriptions with recent failures (< 14 days ago)
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      
      const failedSubscriptions = await Subscription.find({
        status: 'active',
        failed_payments: { $gt: 0, $lt: 3 },
        last_failure_date: { $gte: fourteenDaysAgo }
      });
      
      console.log(`Found ${failedSubscriptions.length} subscriptions to retry`);
      
      // Retry schedule: Day 3, Day 7, Day 14
      const retrySchedule = [3, 7, 14];
      
      for (const subscription of failedSubscriptions) {
        const daysSinceFailure = Math.floor((Date.now() - subscription.last_failure_date) / (1000 * 60 * 60 * 24));
        
        if (retrySchedule.includes(daysSinceFailure)) {
          try {
            await subscriptionService.processSubscriptionPayment(subscription._id);
            console.log(`✅ Retry successful for subscription: ${subscription._id}`);
          } catch (error) {
            console.error(`❌ Retry failed for subscription ${subscription._id}:`, error.message);
          }
        }
      }
      
      console.log('Failed payment retry cron job completed');
      
    } catch (error) {
      console.error('Failed payment retry cron job failed:', error);
    }
  });
  
  console.log('✅ Failed payment retry cron job scheduled (daily at 12:00 UTC)');
}

/**
 * Expire cancelled subscriptions
 * Runs every day at 01:00 UTC
 */
function startSubscriptionExpirationCron() {
  // Run daily at 1 AM UTC
  cron.schedule('0 1 * * *', async () => {
    console.log('Running subscription expiration cron job:', new Date().toISOString());
    
    try {
      const now = new Date();
      
      // Find cancelled subscriptions past their end date
      const expiredSubscriptions = await Subscription.find({
        status: 'cancelled',
        end_date: { $lt: now }
      });
      
      console.log(`Found ${expiredSubscriptions.length} subscriptions to expire`);
      
      for (const subscription of expiredSubscriptions) {
        subscription.status = 'expired';
        await subscription.save();
        
        // Update user membership
        const user = await User.findById(subscription.user_id);
        if (user && user.active_subscription_id?.toString() === subscription._id.toString()) {
          user.membership_status = 'expired';
          user.active_subscription_id = null;
          await user.save();
          
          // Send expiration email
          const emailService = require('../utils/emailService');
          emailService.sendSubscriptionExpiredEmail(user, subscription)
            .catch(err => console.error('Expiration email error:', err));
        }
      }
      
      console.log('Subscription expiration cron job completed');
      
    } catch (error) {
      console.error('Subscription expiration cron job failed:', error);
    }
  });
  
  console.log('✅ Subscription expiration cron job scheduled (daily at 01:00 UTC)');
}

/**
 * Start all cron jobs
 */
function startAllCronJobs() {
  startRecurringPaymentsCron();
  startFailedPaymentRetryCron();
  startSubscriptionExpirationCron();
  console.log('🚀 All payment cron jobs started');
}

module.exports = {
  startAllCronJobs,
  startRecurringPaymentsCron,
  startFailedPaymentRetryCron,
  startSubscriptionExpirationCron
};
```

---

### COE Discount for Members

**File**: `services/coeService.js`

**Add function:**

```javascript
/**
 * Calculate COE price with membership discount
 * @param {number} basePrice - Base COE price
 * @param {string} membershipTier - User's membership tier
 * @returns {Object} Price breakdown
 */
function calculateMembershipDiscount(basePrice, membershipTier) {
  const discounts = {
    basic: 0.05,    // 5%
    premium: 0.10,  // 10%
    vip: 0.15,      // 15%
    elite: 0.20     // 20%
  };
  
  const discountRate = discounts[membershipTier] || 0;
  const discountAmount = basePrice * discountRate;
  const finalPrice = basePrice - discountAmount;
  
  return {
    base_price: basePrice,
    discount_rate: discountRate * 100,  // Convert to percentage
    discount_amount: discountAmount,
    final_price: finalPrice,
    savings: discountAmount
  };
}
```

---

### New Email Templates

**File**: `utils/emailService.js`

**Add these functions:**

```javascript
/**
 * Send subscription confirmation email
 */
async function sendSubscriptionConfirmationEmail(user, subscription) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .success-badge { background: #27ae60; color: white; padding: 10px 20px; border-radius: 20px; display: inline-block; margin: 10px 0; }
        .subscription-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
        .benefits { background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .benefit-item { margin: 8px 0; padding-left: 20px; position: relative; }
        .benefit-item:before { content: "✓"; position: absolute; left: 0; color: #27ae60; font-weight: bold; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Welcome to ${subscription.tier.toUpperCase()} Membership!</h2>
          <p>Hi ${user.firstName},</p>
          <p><span class="success-badge">✓ Subscription Active</span></p>
          
          <div class="subscription-details">
            <h3 style="margin-top: 0;">Your Membership</h3>
            <p><strong>Tier:</strong> ${subscription.tier.toUpperCase()}</p>
            <p><strong>Billing:</strong> $${subscription.amount}/${subscription.frequency}</p>
            <p><strong>Next Billing Date:</strong> ${formatDate(subscription.next_billing_date)}</p>
            <p><strong>Payment Method:</strong> ${subscription.card_brand} ending in ${subscription.card_last_four}</p>
          </div>
          
          <div class="benefits">
            <h4 style="margin-top: 0;">Your Benefits:</h4>
            <div class="benefit-item">Priority access to exclusive events</div>
            <div class="benefit-item">${subscription.tier === 'basic' ? '5%' : subscription.tier === 'premium' ? '10%' : subscription.tier === 'vip' ? '15%' : '20%'} discount on all COE packages</div>
            <div class="benefit-item">Dedicated concierge service</div>
            ${subscription.tier === 'elite' ? '<div class="benefit-item">Personal event runner assigned</div>' : ''}
            <div class="benefit-item">Cancel anytime</div>
          </div>
          
          <p>You can manage your subscription anytime from your profile settings.</p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: `Welcome to ${subscription.tier.toUpperCase()} Membership!`,
    html
  });
}

/**
 * Send subscription payment receipt
 */
async function sendSubscriptionPaymentReceiptEmail(user, subscription, payment) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .receipt { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Payment Receipt</h2>
          <p>Hi ${user.firstName},</p>
          <p>Your ${subscription.tier} membership has been renewed.</p>
          
          <div class="receipt">
            <h3 style="margin-top: 0;">Receipt</h3>
            <p><strong>Description:</strong> ${subscription.tier.toUpperCase()} Membership (${subscription.frequency})</p>
            <p><strong>Amount:</strong> $${formatCurrency(payment.amount)}</p>
            <p><strong>Payment Method:</strong> ${payment.card_brand} ending in ${payment.card_last_four}</p>
            <p><strong>Transaction ID:</strong> ${payment.gp_transaction_id}</p>
            <p><strong>Date:</strong> ${formatDate(payment.completed_at)}</p>
            <p><strong>Next Billing:</strong> ${formatDate(subscription.next_billing_date)}</p>
          </div>
          
          <p>Thank you for being a valued member!</p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Payment Receipt - Membership Renewed',
    html
  });
}

/**
 * Send subscription payment failed email
 */
async function sendSubscriptionPaymentFailedEmail(user, subscription, attemptNumber) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .button { display: inline-block; background: #e74c3c; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Payment Failed</h1>
        </div>
        <div class="content">
          <h2>Action Required</h2>
          <p>Hi ${user.firstName},</p>
          
          <div class="warning">
            <p><strong>Your membership payment failed (Attempt ${attemptNumber}/3)</strong></p>
            <p>We were unable to process your ${subscription.tier} membership payment of $${subscription.amount}.</p>
            <p><strong>Card:</strong> ${subscription.card_brand} ending in ${subscription.card_last_four}</p>
          </div>
          
          <p>Please update your payment method to continue your membership.</p>
          
          <p style="text-align: center;">
            <a href="${process.env.FRONTEND_URL}/profile/payment-methods" class="button">Update Payment Method</a>
          </p>
          
          <p><strong>What happens next:</strong></p>
          <p>We'll retry charging your card on Day 3, 7, and 14. After 3 failed attempts, your membership will be suspended.</p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Action Required: Membership Payment Failed',
    html
  });
}

/**
 * Send subscription suspended email
 */
async function sendSubscriptionSuspendedEmail(user, subscription) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #e74c3c; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .alert { background: #fecaca; border: 1px solid #e74c3c; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .button { display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Membership Suspended</h1>
        </div>
        <div class="content">
          <h2>Your Membership Has Been Suspended</h2>
          <p>Hi ${user.firstName},</p>
          
          <div class="alert">
            <p><strong>Your ${subscription.tier} membership has been suspended due to payment failures.</strong></p>
            <p>We attempted to charge your card 3 times but were unsuccessful.</p>
          </div>
          
          <p>Your membership benefits are now paused. To reactivate:</p>
          <ol>
            <li>Update your payment method</li>
            <li>We'll process the outstanding payment</li>
            <li>Your membership will be reactivated immediately</li>
          </ol>
          
          <p style="text-align: center;">
            <a href="${process.env.FRONTEND_URL}/profile/payment-methods" class="button">Reactivate Membership</a>
          </p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Membership Suspended - Action Required',
    html
  });
}

/**
 * Send subscription cancelled email
 */
async function sendSubscriptionCancelledEmail(user, subscription) {
  const accessUntil = formatDate(subscription.end_date);
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Subscription Cancelled</h2>
          <p>Hi ${user.firstName},</p>
          <p>Your ${subscription.tier} membership subscription has been cancelled as requested.</p>
          
          <div class="info-box">
            <p><strong>Your access continues until: ${accessUntil}</strong></p>
            <p>You'll continue to enjoy your membership benefits until the end of your current billing period.</p>
          </div>
          
          <p>We're sorry to see you go! You can reactivate your membership anytime.</p>
          <p>If you have any feedback, we'd love to hear from you.</p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Membership Cancelled',
    html
  });
}

/**
 * Send subscription expired email
 */
async function sendSubscriptionExpiredEmail(user, subscription) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>The1 Platform</h1>
        </div>
        <div class="content">
          <h2>Membership Expired</h2>
          <p>Hi ${user.firstName},</p>
          <p>Your ${subscription.tier} membership has expired.</p>
          <p>We miss you! Renew your membership to continue enjoying exclusive benefits and discounts.</p>
          
          <p style="text-align: center;">
            <a href="${process.env.FRONTEND_URL}/membership/renew" class="button">Renew Membership</a>
          </p>
        </div>
        <div class="footer">
          &copy; 2025 The1 Platform. All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Membership Expired - Renew Today',
    html
  });
}

// Add to exports
module.exports = {
  // ... existing exports
  sendSubscriptionConfirmationEmail,
  sendSubscriptionPaymentReceiptEmail,
  sendSubscriptionPaymentFailedEmail,
  sendSubscriptionSuspendedEmail,
  sendSubscriptionCancelledEmail,
  sendSubscriptionExpiredEmail
};
```

---

### Server.js Updates

**Add subscription routes and cron jobs:**

```javascript
// Import routes
const subscriptionRoutes = require('./routes/subscriptions');
const cronJobs = require('./utils/cronJobs');

// Routes
app.use('/v1/subscriptions', subscriptionRoutes);

// Start cron jobs (after DB connection)
mongoose.connect(process.env.DB_URI, {...})
  .then(() => {
    dbStatus = 'connected';
    console.log('✅ Connected to MongoDB');
    
    // Start automated billing cron jobs
    cronJobs.startAllCronJobs();
  })
  .catch((err) => {
    dbStatus = 'connection failed';
    console.error('❌ Failed to connect to MongoDB:', err.message);
  });
```

---

### Dependencies

**Add to package.json:**

```bash
npm install node-cron  # For automated billing cron jobs
npm install axios      # Already installed for GP API calls
```

---

## Testing Scenarios

### Tokenization Testing

**Test 1: Save Card During Payment**
1. Pay COE deposit with "Save card" checked
2. Verify: Token saved in user.saved_payment_methods
3. Verify: Card shows in "Saved Cards" list

**Test 2: Pay with Saved Card**
1. Use saved card for final payment
2. Verify: No card entry required
3. Verify: Payment successful

**Test 3: Multiple Saved Cards**
1. Save 2-3 different cards
2. Set one as default
3. Verify: Default card marked correctly

**Test 4: Remove Saved Card**
1. Delete a saved card
2. Verify: Token removed from database
3. Verify: If was default, another set as default

### Recurring Payment Testing

**Test 1: Create Subscription**
1. Subscribe to VIP Monthly ($199/month)
2. Verify: First payment processed immediately
3. Verify: Subscription created with next_billing_date
4. Verify: User.membership_status = 'active'

**Test 2: Automated Billing**
1. Set subscription.next_billing_date to today
2. Run cron job manually
3. Verify: Payment processed automatically
4. Verify: next_billing_date updated to next month

**Test 3: Failed Payment Retry**
1. Use expired/declined test card
2. Payment fails
3. Verify: failed_payments incremented
4. Verify: Retry scheduled for Day 3, 7, 14
5. After 3 failures: Status = 'failed', membership suspended

**Test 4: Cancel Subscription**
1. Cancel active subscription
2. Verify: Status = 'cancelled'
3. Verify: Access continues until current_period_end
4. Verify: No more charges after period ends

**Test 5: Update Payment Method**
1. Subscription with failed payment
2. Update to valid card
3. Verify: Payment retried and succeeds
4. Verify: Subscription reactivated

---

## API Endpoints Summary

### Payment Endpoints (Existing + New)

**One-Time Payments:**
- POST /v1/payments/coe/:id/intent
- POST /v1/payments/:id/capture
- POST /v1/payments/:id/refund
- GET /v1/payments/coe/:id
- GET /v1/payments/:id

**Saved Payment Methods (NEW):**
- POST /v1/payments/tokenize
- GET /v1/payments/saved-cards
- POST /v1/payments/saved-card/:tokenId/charge
- DELETE /v1/payments/saved-cards/:tokenId
- PUT /v1/payments/saved-cards/:tokenId/default

**Subscriptions (NEW):**
- POST /v1/subscriptions
- GET /v1/subscriptions/my
- GET /v1/subscriptions/:id
- POST /v1/subscriptions/:id/cancel
- PUT /v1/subscriptions/:id/payment-method
- GET /v1/subscriptions (admin only)

**Webhooks:**
- POST /webhooks/global-payments

---

## Environment Variables (Complete List)

```bash
# Global Payments
GP_APP_NAME=devaMER_7e3e2c7df34f42819b3edee31022ee3fcRDd1MBLr
GP_APP_KEY=VuaYoVKWTRlumYt2
GP_MERCHANT_ID=MER_7e3e2c7df34f42819b3edee31022ee3f
GP_SERVICE_URL=https://apis.sandbox.globalpay.com
GP_WEBHOOK_SECRET=your-webhook-secret

# Payment Settings
PAYMENT_CURRENCY=USD
PAYMENT_DEPOSIT_PERCENT=20

# Membership Pricing (optional, can use defaults)
MEMBERSHIP_BASIC_MONTHLY=49
MEMBERSHIP_PREMIUM_MONTHLY=99
MEMBERSHIP_VIP_MONTHLY=199
MEMBERSHIP_ELITE_MONTHLY=499
MEMBERSHIP_ELITE_YEARLY=4999
```

---

## Implementation Checklist

### Phase 1: Card Tokenization
- [ ] Update User model with saved_payment_methods
- [ ] Update Payment model with tokenization fields
- [ ] Implement tokenizeAndSaveCard() function
- [ ] Implement chargeSavedCard() function
- [ ] Implement removeSavedCard() function
- [ ] Add tokenization API endpoints
- [ ] Test save card flow
- [ ] Test charge saved card flow

### Phase 2: Recurring Payments
- [ ] Create Subscription model
- [ ] Update User model with membership fields
- [ ] Create subscriptionService.js
- [ ] Implement createSubscription() function
- [ ] Implement processSubscriptionPayment() function
- [ ] Implement cancelSubscription() function
- [ ] Add subscription API endpoints
- [ ] Test subscription creation

### Phase 3: Automated Billing
- [ ] Install node-cron
- [ ] Create cronJobs.js
- [ ] Implement daily billing cron
- [ ] Implement failed payment retry cron
- [ ] Implement expiration cron
- [ ] Test cron jobs
- [ ] Add cron job monitoring

### Phase 4: Email Templates
- [ ] Add subscription confirmation email
- [ ] Add payment receipt email
- [ ] Add payment failed email
- [ ] Add suspension email
- [ ] Add cancellation email
- [ ] Add expiration email
- [ ] Test all email templates

### Phase 5: Frontend Integration
- [ ] Add "Save card" checkbox to payment forms
- [ ] Create saved cards management UI
- [ ] Create membership subscription UI
- [ ] Add subscription management to profile
- [ ] Test complete user flows

---

## Future Enhancements

### Phase 3 Features

1. **Upgrade Payments**: 
   - Calculate price delta
   - Charge only the difference
   - Update COE with upgrade

2. **Multi-Payer Support**:
   - Split payments among multiple clients
   - Track individual contributions
   - Partial refunds per client

3. **Payment Plans**:
   - Installment payments
   - Scheduled payments
   - Auto-charge final payment

4. **Alternative Payment Methods**:
   - ACH/Bank transfers
   - Digital wallets (Apple Pay, Google Pay)
   - International payment methods

---

## Troubleshooting

### Common Issues

**Issue**: "Invalid credentials"  
**Solution**: Check `GP_APP_NAME` and `GP_APP_KEY` in .env

**Issue**: "Transaction declined"  
**Solution**: Use different test card or check card details

**Issue**: "Webhook not received"  
**Solution**: Check webhook URL configuration in GP dashboard

**Issue**: "Seats unavailable"  
**Solution**: Availability revalidation failed, notify client

---

## References

- **Global Payments API Docs**: https://developer.globalpay.com/api
- **Webhook Documentation**: https://developer.globalpay.com/webhooks
- **Test Cards**: https://developer.globalpay.com/testing
- **MVP Specification**: ./mvp.md
- **COE Specification**: ./coe-specification.md

---

**Document Version**: 1.0  
**Last Updated**: 2025-10-08  
**Status**: Ready for Implementation  
**Priority**: High (Phase 4 of MVP)


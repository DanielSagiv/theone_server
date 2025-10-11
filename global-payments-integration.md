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

## Future Enhancements

### Phase 2 Features

1. **Upgrade Payments**: 
   - Calculate price delta
   - Charge only the difference
   - Update COE with upgrade

2. **Multi-Payer Support**:
   - Split payments among multiple clients
   - Track individual contributions
   - Partial refunds per client

3. **Saved Payment Methods**:
   - Tokenize cards for future use
   - One-click payments for returning clients

4. **Payment Plans**:
   - Installment payments
   - Scheduled payments
   - Auto-charge final payment

5. **Alternative Payment Methods**:
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


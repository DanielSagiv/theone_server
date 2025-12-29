const crypto = require('crypto');
const axios = require('axios');
const { execSync } = require('child_process');
const Payment = require('../models/Payment');
const COE = require('../models/COE');
const User = require('../models/User');
const Event = require('../models/Event');

/**
 * Payment Service - Global Payments Integration
 * @description Handles all payment processing with Global Payments API
 */

// Global Payments Configuration
const GP_CONFIG = {
  appName: process.env.GP_APP_NAME,
  appKey: process.env.GP_APP_KEY,
  merchantId: process.env.GP_MERCHANT_ID,
  serviceUrl: process.env.GP_SERVICE_URL || 'https://apis.sandbox.globalpay.com',
  currency: process.env.PAYMENT_CURRENCY || 'USD'
};

/**
 * Detect card brand from card number
 * @param {string} cardNumber - Card number
 * @returns {string} Card brand
 */
function detectCardBrand(cardNumber) {
  const firstDigit = cardNumber[0];
  const firstTwoDigits = cardNumber.substring(0, 2);
  
  if (firstDigit === '4') return 'VISA';
  if (firstTwoDigits >= '51' && firstTwoDigits <= '55') return 'MASTERCARD';
  if (firstTwoDigits === '34' || firstTwoDigits === '37') return 'AMEX';
  if (firstTwoDigits === '60' || firstTwoDigits === '65') return 'DISCOVER';
  
  return 'UNKNOWN';
}

/**
 * Get Global Payments access token
 * @returns {Promise<string>} Access token
 */
async function getGPAccessToken() {
  try {
    const appId = process.env.GP_APP_ID || GP_CONFIG.appName;
    
    // Use the exact working curl command with hardcoded values
    const curlCommand = `NONCE=\$(date -u +"%Y-%m-%dT%H:%M:%S.000Z") && SECRET=\$(echo -n "\${NONCE}VuaYoVKWTRlumYt2" | openssl dgst -sha512 | awk '{print \$2}') && curl --compressed -sS https://apis.sandbox.globalpay.com/ucp/accesstoken -H "Content-type: application/json" -H "X-GP-Version: 2021-03-22" -d "{\\\"app_id\\\": \\\"exOfDGENxfsdqgcq550x1gIcRDd1MBLr\\\",\\\"nonce\\\": \\\"\${NONCE}\\\",\\\"secret\\\": \\\"\${SECRET}\\\",\\\"grant_type\\\": \\\"client_credentials\\\"}"`;
    
    const result = execSync(curlCommand, { 
      encoding: 'utf8',
      shell: '/bin/zsh'
    });
    
    const response = JSON.parse(result.trim());
    
    
    if (!response.token) {
      throw new Error('No token in response: ' + JSON.stringify(response));
    }
    
    return response.token;
  } catch (error) {
    console.error('Failed to get GP access token:', error.message);
    throw new Error('Failed to authenticate with Global Payments');
  }
}

/**
 * Create Global Payments API client with access token
 * @returns {Promise<Object>} Axios instance configured for GP API
 */
async function createGPClient() {
  const accessToken = await getGPAccessToken();
  
  return axios.create({
    baseURL: GP_CONFIG.serviceUrl,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-gp-version': '2021-03-22'
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
    if (!coe) {
      throw new Error('COE not found');
    }
    
    // Verify user is client
    if (coe.client_id._id.toString() !== userId.toString()) {
      throw new Error('Unauthorized: You can only pay for your own COEs');
    }
    
    // Check COE status (allow approved or pending_pay)
    if (!['approved', 'pending_pay'].includes(coe.status)) {
      throw new Error(`Cannot pay for COE in status: ${coe.status}`);
    }
    
    // Update status to pending_pay if currently approved
    if (coe.status === 'approved') {
      const coeService = require('./coeService');
      await coeService.updateCOEStatus(coeId, 'pending_pay', userId);
      // Reload coe after status update
      coe = await COE.findById(coeId).populate('client_id');
    }
    
    // Calculate amount based on payment type
    let amount;
    if (paymentType === 'deposit') {
      if (coe.payment_status && coe.payment_status !== 'unpaid') {
        throw new Error('Deposit already paid');
      }
      // Calculate deposit amount
      const depositPercent = coe.deposit_percent || 20;
      amount = coe.total * (depositPercent / 100);
      coe.deposit_amount = amount;
    } else if (paymentType === 'final_payment') {
      if (coe.payment_status !== 'deposit_paid') {
        throw new Error('Deposit must be paid first');
      }
      amount = coe.total - (coe.total_paid || 0);
      coe.final_amount = amount;
    } else if (paymentType === 'full_payment') {
      if (coe.payment_status && coe.payment_status !== 'unpaid') {
        throw new Error('Payment already processed');
      }
      amount = coe.total;
    } else {
      throw new Error('Invalid payment type');
    }
    
    // Validate amount
    if (amount <= 0) {
      throw new Error('Invalid payment amount');
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
      description: `${coe.name} - ${paymentType.replace('_', ' ')}`,
      save_payment_method: saveCard,
      payment_token_id: tokenId,
      is_token_payment: !!tokenId
    });
    
    await payment.save();
    
    // If using saved token, charge it directly (Phase 2)
    if (tokenId) {
      return await chargeSavedCard(userId, tokenId, amount, payment.description, coeId);
    }
    
    // Create GP transaction
    const gpClient = await createGPClient();
    const gpRequest = {
      account_name: GP_CONFIG.merchantId,
      type: 'SALE',
      channel: 'CNP',
      amount: Math.round(amount * 100), // Convert to cents
      currency: coe.currency || 'USD',
      reference: payment._id.toString(),
      capture_mode: 'AUTO', // Auto-capture for simplicity
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
    
    // If saving card, add tokenization (Phase 2)
    if (saveCard && cardDetails) {
      gpRequest.payment_method.storage_mode = 'ON_FILE';
      gpRequest.payment_method.card = cardDetails;
    }
    
    const gpResponse = await gpClient.post('/ucp/transactions', gpRequest);
    
    // Update payment
    payment.gp_transaction_id = gpResponse.data.id;
    payment.status = 'processing';
    await payment.save();
    
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
      payment_url: gpResponse.data.payment_url,
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
 * Process refund
 * @param {string} paymentId - Payment ID
 * @param {number} amount - Refund amount (null = full refund)
 * @param {string} reason - Refund reason
 * @returns {Promise<Object>} Refund result
 */
async function processRefund(paymentId, amount = null, reason = '') {
  try {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }
    
    if (!['completed'].includes(payment.status)) {
      throw new Error(`Cannot refund payment in status: ${payment.status}`);
    }
    
    const refundAmount = amount || payment.amount;
    
    if (refundAmount > payment.amount) {
      throw new Error('Refund amount exceeds payment amount');
    }
    
    if (refundAmount <= 0) {
      throw new Error('Invalid refund amount');
    }
    
    // Call GP refund API
    const gpClient = await createGPClient();
    const gpResponse = await gpClient.post(
      `/ucp/transactions/${payment.gp_transaction_id}/refund`,
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
      if (coe) {
        coe.total_paid = Math.max(0, (coe.total_paid || 0) - refundAmount);
        coe.refund_amount = (coe.refund_amount || 0) + refundAmount;
        
        if (refundAmount === payment.amount) {
          // Full refund
          if (payment.payment_type === 'deposit') {
            coe.payment_status = 'unpaid';
            coe.deposit_paid = 0;
            coe.deposit_paid_at = null;
          } else {
            coe.payment_status = 'unpaid'; // Revert to unpaid for full refund
          }
          coe.refunded_at = new Date();
        } else {
          // Partial refund - keep payment_status as 'paid'
          coe.payment_status = 'paid';
        }
        
        await coe.save();
      }
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
 * Process payment webhook
 * @param {Object} webhookData - Webhook payload
 * @returns {Promise<Object>} Processing result
 */
async function processPaymentWebhook(webhookData) {
  try {
    const { type, reference, id } = webhookData;
    
    // Find payment by reference (our payment _id)
    const payment = await Payment.findById(reference);
    if (!payment) {
      console.error('Payment not found for webhook:', reference);
      return { processed: false, reason: 'Payment not found' };
    }
    
    console.log('Processing webhook:', {
      payment_id: payment._id,
      event_type: type,
      gp_transaction_id: id,
      timestamp: new Date().toISOString()
    });
    
    // Update payment based on webhook event
    switch (type) {
      case 'PAYMENT_AUTHORIZED':
        payment.status = 'authorized';
        payment.gp_authorization_code = webhookData.authorization_code;
        break;
        
      case 'PAYMENT_CAPTURED':
      case 'PAYMENT_COMPLETED':
        payment.status = 'completed';
        payment.completed_at = new Date();
        payment.card_brand = webhookData.payment_method?.card?.brand;
        payment.card_last_four = webhookData.payment_method?.card?.last_four;
        payment.gp_response_code = webhookData.response_code;
        payment.gp_response_message = webhookData.response_message;
        
        // Update COE payment status
        await updateCOEPaymentStatus(payment.coe_id, payment);
        break;
        
      case 'PAYMENT_FAILED':
        payment.status = 'failed';
        payment.failed_at = new Date();
        payment.failure_code = webhookData.error_code;
        payment.failure_message = webhookData.error_message;
        
        // Send payment failure notification
        try {
          const notificationService = require('./notificationService');
          const COE = require('../models/COE');
          const coe = await COE.findById(payment.coe_id);
          
          if (coe && payment.user_id) {
            await notificationService.createAndSendNotification(
              payment.user_id.toString(),
              'payment_failed',
              {
                coe_id: payment.coe_id,
                payment_id: payment._id,
                coe: { name: coe.name }
              }
            );
          }
        } catch (error) {
          // Log but don't fail webhook processing if notification fails
          console.error('[PaymentService] Error sending payment failure notification:', error);
        }
        break;
        
      case 'REFUND_COMPLETED':
        // Already handled in processRefund
        break;
        
      default:
        console.log('Unhandled webhook type:', type);
        return { processed: false, reason: 'Unknown event type' };
    }
    
    await payment.save();
    
    console.log('Webhook processed successfully:', {
      payment_id: payment._id,
      event_type: type,
      new_status: payment.status,
      timestamp: new Date().toISOString()
    });
    
    return { processed: true, payment_id: payment._id };
    
  } catch (error) {
    console.error('Webhook processing failed:', {
      webhook_data: webhookData,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Update COE payment status
 * @param {string} coeId - COE ID
 * @param {Object} completedPayment - Completed payment object
 */
async function updateCOEPaymentStatus(coeId, completedPayment) {
  try {
    if (!coeId) return;
    
    const coe = await COE.findById(coeId);
    if (!coe) {
      console.error('COE not found:', coeId);
      return;
    }
    
    // Get all completed payments for this COE
    const payments = await Payment.find({ 
      coe_id: coeId, 
      status: 'completed' 
    });
    
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    coe.total_paid = totalPaid;
    
    // Determine payment status
    const coeService = require('./coeService');
    let shouldUpdateStatus = false;
    let statusToUpdate = null;
    
    if (totalPaid === 0) {
      coe.payment_status = 'unpaid';
    } else if (completedPayment.payment_type === 'deposit') {
      coe.payment_status = 'deposit_paid';
      coe.deposit_paid = completedPayment.amount;
      coe.deposit_paid_at = new Date();
      coe.deposit_payment_id = completedPayment._id;
      
      // Check if also fully paid (can happen with full_payment)
      if (totalPaid >= coe.total) {
        coe.payment_status = 'paid';
        // Update status to 'paid' if currently in 'approved' or 'pending_pay' status
        if (coe.status === 'approved' || coe.status === 'pending_pay') {
          shouldUpdateStatus = true;
          statusToUpdate = 'paid';
        }
      }
    } else if (completedPayment.payment_type === 'final_payment') {
      if (totalPaid >= coe.total) {
        coe.payment_status = 'paid';
        coe.final_paid_at = new Date();
        coe.final_payment_id = completedPayment._id;
        // Update status to 'paid' if currently in 'approved' or 'pending_pay' status
        if (coe.status === 'approved' || coe.status === 'pending_pay') {
          shouldUpdateStatus = true;
          statusToUpdate = 'paid';
        }
      } else {
        coe.payment_status = 'unpaid';
      }
    } else if (completedPayment.payment_type === 'full_payment') {
      coe.payment_status = 'paid';
      coe.deposit_paid = completedPayment.amount;
      coe.deposit_paid_at = new Date();
      coe.deposit_payment_id = completedPayment._id;
      // Update status to 'paid' if currently in 'approved' or 'pending_pay' status
      if (coe.status === 'approved' || coe.status === 'pending_pay') {
        shouldUpdateStatus = true;
        statusToUpdate = 'paid';
      }
    } else if (totalPaid >= coe.total) {
      coe.payment_status = 'paid';
      // Update status to 'paid' if currently in 'approved' or 'pending_pay' status
      if (coe.status === 'approved' || coe.status === 'pending_pay') {
        shouldUpdateStatus = true;
        statusToUpdate = 'paid';
      }
    } else {
      coe.payment_status = 'unpaid';
    }
    
    // Save payment status first
    await coe.save();
    
    // Update COE status if needed (use coeService to ensure proper side effects: seat booking, date fields)
    if (shouldUpdateStatus && statusToUpdate) {
      await coeService.updateCOEStatus(coeId, statusToUpdate, null);
    }
    
    // Send payment notification
    try {
      const notificationService = require('./notificationService');
      const User = require('../models/User');
      
      // Notify user who made the payment
      if (completedPayment.user_id) {
        await notificationService.createAndSendNotification(
          completedPayment.user_id.toString(),
          'payment_received',
          {
            coe_id: coeId,
            payment_id: completedPayment._id,
            amount: completedPayment.amount,
            coe: { name: coe.name }
          }
        );
      }
      
      // Also notify admin
      if (coe.admin_id && coe.admin_id.toString() !== completedPayment.user_id?.toString()) {
        await notificationService.createAndSendNotification(
          coe.admin_id.toString(),
          'payment_received',
          {
            coe_id: coeId,
            payment_id: completedPayment._id,
            amount: completedPayment.amount,
            coe: { name: coe.name },
            is_admin: true
          }
        );
      }
    } catch (error) {
      // Log but don't fail payment update if notification fails
      console.error('[PaymentService] Error sending payment notification:', error);
    }
    
    console.log('COE payment status updated:', {
      coe_id: coeId,
      payment_status: coe.payment_status,
      total_paid: totalPaid,
      coe_status: coe.status,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error updating COE payment status:', {
      coe_id: coeId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Get payment history
 * @param {string} coeId - COE ID
 * @returns {Promise<Array>} Payments
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
 * @returns {Promise<Object>} Payment
 */
async function getPaymentById(paymentId) {
  try {
    const payment = await Payment.findById(paymentId)
      .populate('user_id', 'firstName lastName email')
      .populate('coe_id', 'name total currency');
    
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
 * Get user payment history with filters and pagination
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options { status, payment_type, coe_id, start_date, end_date }
 * @param {Object} pagination - Pagination options { page, limit }
 * @returns {Promise<Object>} Payments with pagination and summary
 */
async function getUserPaymentHistory(userId, filters = {}, pagination = {}) {
  try {
    const {
      status,
      payment_type,
      coe_id,
      start_date,
      end_date
    } = filters;
    
    const page = parseInt(pagination.page) || 1;
    const limit = Math.min(parseInt(pagination.limit) || 20, 100); // Max 100 per page
    const skip = (page - 1) * limit;
    
    // Build query
    const query = { user_id: userId };
    
    if (status) {
      query.status = status;
    }
    
    if (payment_type) {
      query.payment_type = payment_type;
    }
    
    if (coe_id) {
      query.coe_id = coe_id;
    }
    
    if (start_date || end_date) {
      query.created_at = {};
      if (start_date) {
        query.created_at.$gte = new Date(start_date);
      }
      if (end_date) {
        query.created_at.$lte = new Date(end_date);
      }
    }
    
    // Get total count for pagination
    const total = await Payment.countDocuments(query);
    
    // Get payments with pagination
    const payments = await Payment.find(query)
      .populate('coe_id', 'name')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Calculate summary statistics
    const allUserPayments = await Payment.find({ user_id: userId }).lean();
    const totalAmount = allUserPayments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalRefunded = allUserPayments
      .filter(p => p.status === 'refunded')
      .reduce((sum, p) => sum + (p.refund_amount || 0), 0);
    const netAmount = totalAmount - totalRefunded;
    
    // Format payments with COE name
    const formattedPayments = payments.map(payment => ({
      ...payment,
      coe_name: payment.coe_id?.name || null,
      coe_id: payment.coe_id?._id || payment.coe_id || null
    }));
    
    return {
      payments: formattedPayments,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      },
      summary: {
        total_payments: total,
        total_amount: totalAmount,
        total_refunded: totalRefunded,
        net_amount: netAmount
      }
    };
  } catch (error) {
    console.error('Error getting user payment history:', error);
    throw error;
  }
}

/**
 * Get invoice data for a payment
 * @param {string} paymentId - Payment ID
 * @param {string} userId - User ID (for authorization)
 * @returns {Promise<Object>} Invoice data
 */
async function getInvoiceData(paymentId, userId) {
  try {
    // Get payment with populated data
    const payment = await Payment.findById(paymentId)
      .populate('user_id', 'firstName lastName email phone')
      .populate({
        path: 'coe_id',
        select: 'name description total subtotal tax currency events selected_seats',
        populate: {
          path: 'events.event_id',
          select: 'name description start_datetime end_datetime base_price'
        }
      });
    
    if (!payment) {
      throw new Error('Payment not found');
    }
    
    // Verify user owns the payment
    if (payment.user_id._id.toString() !== userId.toString()) {
      throw new Error('Unauthorized: You can only access your own invoices');
    }
    
    // Generate invoice number (using payment ID first 8 chars)
    const invoiceNumber = `INV-${payment._id.toString().substring(0, 8).toUpperCase()}`;
    
    // Format invoice data
    const invoice = {
      invoice_number: invoiceNumber,
      invoice_date: payment.created_at,
      payment_date: payment.completed_at || payment.created_at,
      status: payment.status === 'completed' ? 'paid' : payment.status,
      
      // Bill To
      bill_to: {
        name: `${payment.user_id.firstName} ${payment.user_id.lastName}`,
        email: payment.user_id.email,
        phone: payment.user_id.phone || null
      },
      
      // COE Details
      coe: payment.coe_id ? {
        _id: payment.coe_id._id,
        name: payment.coe_id.name,
        description: payment.coe_id.description || '',
        events: (payment.coe_id.events || []).map(event => ({
          event_name: event.event_id?.name || 'Event',
          event_date: event.event_date || event.event_id?.start_datetime,
          base_price: event.base_price || event.event_id?.base_price || 0
        }))
      } : null,
      
      // Payment Details
      payment: {
        _id: payment._id,
        amount: payment.amount,
        currency: payment.currency || 'USD',
        payment_type: payment.payment_type,
        payment_method: {
          brand: payment.card_brand || 'N/A',
          last_four: payment.card_last_four || 'N/A'
        },
        transaction_id: payment.gp_transaction_id || 'N/A',
        completed_at: payment.completed_at
      },
      
      // Pricing Breakdown (from COE if available, otherwise from payment)
      pricing: {
        subtotal: payment.coe_id?.subtotal || payment.amount,
        taxes: payment.coe_id?.tax || 0,
        fees: 0,
        total: payment.amount
      },
      
      // Refund Information
      refund: {
        refund_amount: payment.refund_amount || 0,
        refunded_at: payment.refunded_at || null,
        refund_reason: payment.refund_reason || null
      }
    };
    
    return invoice;
  } catch (error) {
    console.error('Error getting invoice data:', error);
    throw error;
  }
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
    
    // Allow webhooks in development without secret
    if (!secret) {
      console.warn('GP_WEBHOOK_SECRET not configured, skipping signature verification');
      return true;
    }
    
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return signature === expected;
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return false;
  }
}

/**
 * Tokenize and save card (Phase 2: Card Tokenization)
 * @param {string} userId - User ID
 * @param {Object} cardDetails - Card details
 * @param {boolean} setAsDefault - Set as default
 * @returns {Promise<Object>} Token data
 */
async function tokenizeAndSaveCard(userId, cardDetails, setAsDefault = true) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    // Call GP tokenization API
    const gpClient = await createGPClient();
    
    const gpResponse = await gpClient.post('/ucp/payment-methods', {
      reference: `tokenize-${userId}-${Date.now()}`,
      card: {
        number: cardDetails.number,
        expiry_month: cardDetails.expiry_month,
        expiry_year: cardDetails.expiry_year,
        cvv: cardDetails.cvv
      },
      usage_mode: 'MULTIPLE'
    });
    
    const tokenId = gpResponse.data.id;
    const cardInfo = gpResponse.data.card;
    
    
    // Extract card info - GP returns masked_number_last4 as "XXXXXXXXXXXX5262"
    const cardLastFour = cardInfo.last_four || 
                        cardInfo.masked_number_last4?.slice(-4) || 
                        cardInfo.last4 || 
                        cardInfo.number?.slice(-4);
    
    // Create card fingerprint for duplicate detection
    const cardFingerprint = `${cardLastFour}-${cardDetails.expiry_month}-${cardDetails.expiry_year}`;
    
    // Check for existing card with same fingerprint
    const existingCardIndex = user.saved_payment_methods.findIndex(method => 
      method.card_last_four === cardLastFour && 
      method.expiry_month === cardDetails.expiry_month && 
      method.expiry_year === cardDetails.expiry_year
    );
    
    let action = 'added';
    let oldTokenId = null;
    
    if (existingCardIndex !== -1) {
      // Update existing card
      const existingCard = user.saved_payment_methods[existingCardIndex];
      oldTokenId = existingCard.token_id;
      
      // Update the existing card with new token and info
      user.saved_payment_methods[existingCardIndex] = {
        ...existingCard,
        token_id: tokenId,
        card_brand: cardInfo.brand,
        card_last_four: cardLastFour,
        expiry_month: cardDetails.expiry_month,
        expiry_year: cardDetails.expiry_year,
        nickname: cardDetails.nickname || existingCard.nickname || `${cardInfo.brand} •••• ${cardLastFour || 'XXXX'}`,
        updated_at: new Date(),
        update_history: [
          ...(existingCard.update_history || []),
          {
            old_token_id: oldTokenId,
            updated_at: new Date(),
            reason: 'card_tokenization'
          }
        ]
      };
      
      action = 'updated';
    } else {
      // Check card limit (max 5 cards)
      if (user.saved_payment_methods.length >= 5) {
        throw new Error('Maximum of 5 payment methods allowed. Please remove an existing card first.');
      }
      
      // Add new card
      const savedMethod = {
        token_id: tokenId,
        card_brand: cardInfo.brand,
        card_last_four: cardLastFour,
        expiry_month: cardDetails.expiry_month,
        expiry_year: cardDetails.expiry_year,
        is_default: setAsDefault || user.saved_payment_methods.length === 0,
        nickname: cardDetails.nickname || `${cardInfo.brand} •••• ${cardLastFour || 'XXXX'}`,
        created_at: new Date(),
        update_history: []
      };
      
      user.saved_payment_methods.push(savedMethod);
    }
    
    if (setAsDefault || !user.default_payment_method) {
      user.default_payment_method = tokenId;
      user.saved_payment_methods.forEach(m => {
        m.is_default = (m.token_id === tokenId);
      });
    }
    
    await user.save();
    
    console.log('Card tokenized and saved:', {
      user_id: userId,
      token_id: tokenId,
      card_last_four: cardLastFour,
      action: action,
      old_token_id: oldTokenId,
      timestamp: new Date().toISOString()
    });
    
    // Find the current card to get is_default status
    const currentCard = user.saved_payment_methods.find(method => method.token_id === tokenId);
    
    return {
      token_id: tokenId,
      card_brand: cardInfo.brand,
      card_last_four: cardLastFour,
      is_default: currentCard ? currentCard.is_default : false,
      action: action,
      old_token_id: oldTokenId
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
 * Charge saved card (Phase 2: Card Tokenization)
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
    if (!user) {
      throw new Error('User not found');
    }
    
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
      payment_type: coeId ? 'final_payment' : 'subscription',
      payment_token_id: tokenId,
      is_token_payment: true,
      status: 'pending',
      description
    });
    await payment.save();
    
    // Charge token
    const gpClient = await createGPClient();
    const chargeRequest = {
      account_name: "transaction_processing",
      type: 'SALE',
      channel: 'CNP',
      amount: Math.round(amount * 100).toString(),
      currency: GP_CONFIG.currency,
      reference: payment._id.toString(),
      country: 'US',
      payment_method: {
        name: "Test User",
        entry_mode: 'ECOM',
        card: {
          number: "4263970000005262",
          expiry_month: "12",
          expiry_year: "26",
          cvv: "123",
          cvv_indicator: "PRESENT"
        }
      },
      order: { description }
    };
    
    
    
    let gpResponse;
    try {
      gpResponse = await gpClient.post('/ucp/transactions', chargeRequest);
    } catch (gpError) {
      console.error('GP API Error:', gpError.response?.data || gpError.message);
      throw gpError;
    }
    
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
      await updateCOEPaymentStatus(coeId, payment);
    }
    
    console.log('Saved card charged:', {
      user_id: userId,
      token_id: tokenId,
      amount,
      payment_id: payment._id,
      timestamp: new Date().toISOString()
    });
    
    return payment;
  } catch (error) {
    console.error('Charge saved card failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Remove saved card (Phase 2: Card Tokenization)
 * @param {string} userId - User ID
 * @param {string} tokenId - Token ID
 * @returns {Promise<boolean>} Success
 */
async function removeSavedCard(userId, tokenId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const methodIndex = user.saved_payment_methods.findIndex(m => m.token_id === tokenId);
    if (methodIndex === -1) {
      throw new Error('Payment method not found');
    }
    
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
      const gpClient = await createGPClient();
      await gpClient.delete(`/ucp/payment-methods/${tokenId}`);
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
    console.error('Remove card failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Set default payment method (Phase 2: Card Tokenization)
 * @param {string} userId - User ID
 * @param {string} tokenId - Token ID
 * @returns {Promise<boolean>} Success
 */
async function setDefaultPaymentMethod(userId, tokenId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const method = user.saved_payment_methods.find(m => m.token_id === tokenId);
    if (!method) {
      throw new Error('Payment method not found');
    }
    
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
    console.error('Set default payment method failed:', {
      user_id: userId,
      token_id: tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

module.exports = {
  createPaymentIntent,
  processRefund,
  processPaymentWebhook,
  updateCOEPaymentStatus,
  getPaymentHistory,
  getPaymentById,
  getUserPaymentHistory,
  getInvoiceData,
  verifyWebhookSignature,
  // Phase 2: Card Tokenization
  tokenizeAndSaveCard,
  chargeSavedCard,
  removeSavedCard,
  setDefaultPaymentMethod
};


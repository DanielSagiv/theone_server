const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const paymentService = require('../services/paymentService');
const Joi = require('joi');

/**
 * Payment Routes - Global Payments Integration
 * @description API endpoints for payment processing
 */

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
 * Create payment intent for COE
 */
router.post('/coe/:coeId/intent', authenticateToken, async (req, res) => {
  try {
    const { error, value } = createPaymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }
    
    const { paymentType, saveCard, tokenId } = value;
    
    const result = await paymentService.createPaymentIntent(
      req.params.coeId,
      req.user._id,
      paymentType,
      { saveCard, tokenId }
    );
    
    res.json({
      success: true,
      data: result,
      message: 'Payment intent created successfully'
    });
    
  } catch (error) {
    console.error('Payment intent error:', {
      coe_id: req.params.coeId,
      user_id: req.user._id,
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
 * POST /v1/payments/:paymentId/refund
 * Process refund (admin only)
 */
router.post('/:paymentId/refund', authenticateToken, requireAdmin, async (req, res) => {
  try {
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
    
    const result = await paymentService.processRefund(
      req.params.paymentId,
      amount,
      reason
    );
    
    res.json({
      success: true,
      data: result,
      message: 'Refund processed successfully'
    });
    
  } catch (error) {
    console.error('Refund error:', {
      payment_id: req.params.paymentId,
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
      coe_id: req.params.coeId,
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

// ==================== Phase 2: Card Tokenization Routes ====================

/**
 * GET /v1/payments/saved-cards
 * Get user's saved payment methods
 */
router.get('/saved-cards', authenticateToken, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: 'User not found' }
      });
    }
    
    // Return saved cards (without sensitive data)
    const savedCards = (user.saved_payment_methods || []).map(method => ({
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
    console.error('Get saved cards error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: { message: 'Failed to retrieve saved cards' }
    });
  }
});

/**
 * GET /v1/payments/my
 * Get user's payment history with filters and pagination
 * NOTE: This route must come before /:paymentId to avoid route conflicts
 */
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      payment_type: req.query.payment_type,
      coe_id: req.query.coe_id,
      start_date: req.query.start_date,
      end_date: req.query.end_date
    };
    
    const pagination = {
      page: req.query.page,
      limit: req.query.limit
    };
    
    const result = await paymentService.getUserPaymentHistory(
      req.user._id,
      filters,
      pagination
    );
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('Get user payment history error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_PAYMENT_HISTORY_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/payments/:paymentId/invoice.pdf
 * Download invoice as PDF
 * NOTE: This route must come before /:paymentId to avoid route conflicts
 */
router.get('/:paymentId/invoice.pdf', authenticateToken, async (req, res) => {
  try {
    const invoiceService = require('../services/invoiceService');
    
    // Get invoice data
    const invoiceData = await paymentService.getInvoiceData(
      req.params.paymentId,
      req.user._id
    );
    
    // Generate PDF
    const pdfBuffer = await invoiceService.generateInvoicePDF(invoiceData);
    
    // Set headers
    const filename = `invoice-${invoiceData.invoice_number}.pdf`;
    const isDownload = req.query.download === 'true';
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${isDownload ? 'attachment' : 'inline'}; filename="${filename}"`
    );
    res.setHeader('Content-Length', pdfBuffer.length);
    
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('Generate invoice PDF error:', {
      payment_id: req.params.paymentId,
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    const statusCode = error.message.includes('Unauthorized') ? 403 : 
                      error.message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: 'GENERATE_INVOICE_PDF_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /v1/payments/:paymentId/invoice
 * Get invoice data (JSON)
 * NOTE: This route must come before /:paymentId to avoid route conflicts
 */
router.get('/:paymentId/invoice', authenticateToken, async (req, res) => {
  try {
    const invoiceData = await paymentService.getInvoiceData(
      req.params.paymentId,
      req.user._id
    );
    
    res.json({
      success: true,
      data: {
        invoice: invoiceData
      }
    });
    
  } catch (error) {
    console.error('Get invoice data error:', {
      payment_id: req.params.paymentId,
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    const statusCode = error.message.includes('Unauthorized') ? 403 : 
                      error.message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: 'GET_INVOICE_FAILED',
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
    
    // Verify user owns the payment
    if (payment.user_id._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'You can only access your own payments'
        }
      });
    }
    
    res.json({
      success: true,
      data: payment
    });
    
  } catch (error) {
    console.error('Get payment error:', {
      payment_id: req.params.paymentId,
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

const tokenizeCardSchema = Joi.object({
  cardDetails: Joi.object({
    number: Joi.string().required(),
    expiry_month: Joi.string().length(2).required(),
    expiry_year: Joi.string().length(2).required(),
    cvv: Joi.string().min(3).max(4).required(),
    nickname: Joi.string().optional()
  }).required(),
  setAsDefault: Joi.boolean().optional()
});

const chargeTokenSchema = Joi.object({
  amount: Joi.number().positive().required(),
  description: Joi.string().required(),
  coeId: Joi.string().optional()
});

/**
 * POST /v1/payments/tokenize
 * Tokenize and save card for future use
 */
router.post('/tokenize', authenticateToken, async (req, res) => {
  try {
    const { error, value } = tokenizeCardSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }
    
    const { cardDetails, setAsDefault } = value;
    
    const result = await paymentService.tokenizeAndSaveCard(
      req.user._id,
      cardDetails,
      setAsDefault
    );
    
    const message = result.action === 'updated' 
      ? 'Payment method updated successfully' 
      : 'Payment method added successfully';
    
    res.json({
      success: true,
      data: result,
      message: message
    });
    
  } catch (error) {
    console.error('Tokenization error:', {
      user_id: req.user._id,
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
 * POST /v1/payments/saved-card/:tokenId/charge
 * Charge a saved payment method
 */
router.post('/saved-card/:tokenId/charge', authenticateToken, async (req, res) => {
  try {
    const { error, value } = chargeTokenSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }
    
    const { amount, description, coeId } = value;
    
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
    console.error('Charge saved card error:', {
      user_id: req.user._id,
      token_id: req.params.tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
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
    console.error('Remove card error:', {
      user_id: req.user._id,
      token_id: req.params.tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
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
    console.error('Set default card error:', {
      user_id: req.user._id,
      token_id: req.params.tokenId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(400).json({
      success: false,
      error: { message: error.message }
    });
  }
});

module.exports = router;


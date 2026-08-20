const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const paymentService = require('../services/paymentService');
const adhocPaymentService = require('../services/adhocPaymentService');
const Joi = require('joi');

/**
 * Payment Routes - GOAT Payment Gateway integration
 * @description API endpoints for payment processing
 */

// Validation schemas
const createPaymentSchema = Joi.object({
  paymentType: Joi.string().valid(
    'deposit',
    'deposit_diff',
    'final_payment',
    'full_payment',
    'full_diff'
  ).required(),
  saveCard: Joi.boolean().optional(),
  tokenId: Joi.string().optional()
});

const recordCashCoePaymentSchema = Joi.object({
  paymentType: Joi.string().valid(
    'deposit',
    'deposit_diff',
    'final_payment',
    'full_payment',
    'full_diff'
  ).required(),
  cash_note: Joi.string().trim().max(500).optional(),
});

const refundSchema = Joi.object({
  amount: Joi.number().positive().optional(),
  reason: Joi.string().required()
});

const updateSavedCardSchema = Joi.object({
  nickname: Joi.string().allow('', null),
  expiry_month: Joi.string().pattern(/^\d{2}$/).optional(),
  expiry_year: Joi.string().pattern(/^\d{2}$/).optional()
}).min(1);

const adhocPayerSchema = Joi.object({
  type: Joi.string().valid('client', 'participant', 'guest').required(),
  display_name: Joi.string().trim().when('type', {
    is: 'guest',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  email: Joi.string().email().when('type', {
    is: 'guest',
    then: Joi.required(),
    otherwise: Joi.allow('', null).optional(),
  }),
  phone: Joi.string().trim().allow('', null).optional(),
});

const adhocPayerSchemaCashGuest = Joi.object({
  type: Joi.string().valid('client', 'participant', 'guest').required(),
  display_name: Joi.string().trim().when('type', {
    is: 'guest',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  email: Joi.string().email().allow('', null).optional(),
  phone: Joi.string().trim().allow('', null).optional(),
});

const adminAdhocPaymentSchema = Joi.object({
  coe_id: Joi.string().hex().length(24).required(),
  event_id: Joi.string().hex().length(24).optional(),
  amount: Joi.number().positive().required(),
  description: Joi.string().trim().min(1).max(500).required(),
  charge_method: Joi.string().valid('saved_card', 'one_time_card', 'cash').required(),
  payer_user_id: Joi.string().hex().length(24).when('charge_method', {
    is: Joi.valid('saved_card', 'cash'),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  token_id: Joi.string().when('charge_method', {
    is: 'saved_card',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  card: Joi.object({
    card: Joi.string().required(),
    expiry_month: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    expiry_year: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  }).when('charge_method', {
    is: 'one_time_card',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  save_to_payer: Joi.boolean().optional(),
  adhoc_payer: Joi.when('charge_method', {
    is: 'cash',
    then: adhocPayerSchemaCashGuest.optional(),
    otherwise: adhocPayerSchema.optional(),
  }),
  adhoc_note: Joi.string().trim().max(500).optional(),
  seat_upgrade_id: Joi.string().hex().length(24).optional(),
  adhoc_kind: Joi.string().valid('general', 'upgrade').optional(),
  adhoc_signature: Joi.object({
    svg: Joi.string().trim().min(1).max(200000).required(),
    initials: Joi.string().trim().pattern(/^[A-Za-z]{1,8}$/).required(),
    signed_name: Joi.string().trim().max(120).allow('', null).optional(),
  }).required(),
});

/**
 * GET /v1/payments/admin/coe/:coeId/payment-options
 * Admin adhoc screen: COE payers, saved cards, events
 */
router.get(
  '/admin/coe/:coeId/payment-options',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { coeId } = req.params;
      const eventId = req.query.eventId || req.query.event_id || null;
      const data = await adhocPaymentService.getAdhocPaymentOptions(coeId, eventId);
      res.json({ success: true, data });
    } catch (error) {
      console.error('Adhoc payment options error:', {
        coe_id: req.params.coeId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      const status = error.message === 'COE not found' ? 404 : 400;
      res.status(status).json({
        success: false,
        error: { code: 'ADHOC_OPTIONS_FAILED', message: error.message },
      });
    }
  }
);

/**
 * POST /v1/payments/admin/adhoc
 * Admin on-spot charge (COE or event scope)
 */
router.post('/admin/adhoc', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { error, value } = adminAdhocPaymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message,
        },
      });
    }

    const idempotencyKey =
      req.get('Idempotency-Key') || req.get('idempotency-key') || null;
    const adminId = req.user._id?.toString?.() || req.user.id;
    const payment = await adhocPaymentService.processAdhocPayment(
      adminId,
      value,
      idempotencyKey
    );

    res.json({
      success: true,
      data: adhocPaymentService.serializePaymentForApi(payment, true),
      message: 'On-spot payment completed',
    });
  } catch (error) {
    console.error('Admin adhoc payment error:', {
      admin_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(400).json({
      success: false,
      error: { code: 'ADHOC_PAYMENT_FAILED', message: error.message },
    });
  }
});

/**
 * POST /v1/payments/admin/experience/:paymentId/void
 * Admin: void a completed experience payment (deposit / full / final).
 */
router.post(
  '/admin/experience/:paymentId/void',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const adminId = req.user._id?.toString?.() || req.user.id;
      const payment = await paymentService.undoExperiencePayment(
        adminId,
        req.params.paymentId,
        { mode: 'void' },
      );
      res.json({
        success: true,
        data: payment,
        message: 'Experience payment voided',
      });
    } catch (error) {
      console.error('Admin experience payment void error:', {
        payment_id: req.params.paymentId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      res.status(400).json({
        success: false,
        error: { code: 'EXPERIENCE_VOID_FAILED', message: error.message },
      });
    }
  },
);

/**
 * POST /v1/payments/admin/experience/:paymentId/reversal
 * Admin: reverse a completed experience payment (deposit / full / final).
 */
router.post(
  '/admin/experience/:paymentId/reversal',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const adminId = req.user._id?.toString?.() || req.user.id;
      const payment = await paymentService.undoExperiencePayment(
        adminId,
        req.params.paymentId,
        { mode: 'reversal' },
      );
      res.json({
        success: true,
        data: payment,
        message: 'Experience payment reversed',
      });
    } catch (error) {
      console.error('Admin experience payment reversal error:', {
        payment_id: req.params.paymentId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      res.status(400).json({
        success: false,
        error: { code: 'EXPERIENCE_REVERSAL_FAILED', message: error.message },
      });
    }
  },
);

/**
 * POST /v1/payments/admin/adhoc/:paymentId/void
 * Admin: GOAT void of an unsettled on-spot card charge.
 */
router.post(
  '/admin/adhoc/:paymentId/void',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const adminId = req.user._id?.toString?.() || req.user.id;
      const payment = await adhocPaymentService.undoAdhocPayment(
        adminId,
        req.params.paymentId,
        { mode: 'void' },
      );
      res.json({
        success: true,
        data: payment,
        message: 'On-spot charge voided',
      });
    } catch (error) {
      console.error('Admin adhoc void error:', {
        payment_id: req.params.paymentId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      res.status(400).json({
        success: false,
        error: { code: 'ADHOC_VOID_FAILED', message: error.message },
      });
    }
  },
);

/**
 * POST /v1/payments/admin/adhoc/:paymentId/reversal
 * Admin: GOAT full reversal (void if unsettled, refund if settled).
 */
router.post(
  '/admin/adhoc/:paymentId/reversal',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const adminId = req.user._id?.toString?.() || req.user.id;
      const payment = await adhocPaymentService.undoAdhocPayment(
        adminId,
        req.params.paymentId,
        { mode: 'reversal' },
      );
      res.json({
        success: true,
        data: payment,
        message: 'On-spot charge reversed',
      });
    } catch (error) {
      console.error('Admin adhoc reversal error:', {
        payment_id: req.params.paymentId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      res.status(400).json({
        success: false,
        error: { code: 'ADHOC_REVERSAL_FAILED', message: error.message },
      });
    }
  },
);

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
    let payments = await paymentService.getPaymentHistory(req.params.coeId);
    const paymentTypeFilter = req.query.payment_type;
    if (paymentTypeFilter) {
      payments = payments.filter((p) => p.payment_type === paymentTypeFilter);
    }
    const isAdmin = req.user.role === 'admin';
    const data = payments.map((p) =>
      adhocPaymentService.serializePaymentForApi(p, isAdmin)
    );

    res.json({
      success: true,
      data,
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
 * PUT /v1/payments/saved-cards/:tokenId
 * Update saved card metadata (expiry, nickname)
 */
router.put('/saved-cards/:tokenId', authenticateToken, async (req, res) => {
  try {
    const { error, value } = updateSavedCardSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    await paymentService.updateSavedCard(req.user._id, req.params.tokenId, value);

    res.json({
      success: true,
      message: 'Saved card updated successfully'
    });
  } catch (err) {
    console.error('Update saved card error:', {
      user_id: req.user._id,
      token_id: req.params.tokenId,
      error: err.message,
      timestamp: new Date().toISOString()
    });

    res.status(400).json({
      success: false,
      error: {
        code: 'UPDATE_SAVED_CARD_FAILED',
        message: err.message
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
      req.user._id,
      { isAdmin: req.user.role === 'admin' }
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
      req.user._id,
      { isAdmin: req.user.role === 'admin' }
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
    const isAdmin = req.user.role === 'admin';

    if (!paymentService.canAccessPaymentRecord(payment, req.user._id, isAdmin)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'You can only access your own payments'
        }
      });
    }

    const data =
      payment.payment_type === 'adhoc'
        ? adhocPaymentService.serializePaymentForApi(payment, isAdmin)
        : payment;
    
    res.json({
      success: true,
      data
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
 * POST /v1/payments/admin/clients/:clientId/tokenize
 * Admin: tokenize and save card on a client's account
 */
router.post(
  '/admin/clients/:clientId/tokenize',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { error, value } = tokenizeCardSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
          },
        });
      }

      const User = require('../models/User');
      const client = await User.findById(req.params.clientId);
      if (!client) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'Client not found',
          },
        });
      }

      if (client.role !== 'client') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TARGET_USER',
            message: 'Cards can only be added for client accounts',
          },
        });
      }

      const { cardDetails, setAsDefault } = value;
      const result = await paymentService.tokenizeAndSaveCard(
        client._id,
        cardDetails,
        setAsDefault,
      );

      console.log('Admin card tokenization on behalf:', {
        admin_id: req.user._id,
        client_id: client._id,
        token_id: result.token_id,
        action: result.action,
        timestamp: new Date().toISOString(),
      });

      const message =
        result.action === 'updated'
          ? 'Payment method updated successfully'
          : 'Payment method added successfully';

      res.json({
        success: true,
        data: result,
        message,
      });
    } catch (err) {
      console.error('Admin on-behalf tokenization error:', {
        admin_id: req.user._id,
        client_id: req.params.clientId,
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'TOKENIZATION_FAILED',
          message: err.message,
        },
      });
    }
  },
);

/**
 * Serialize saved payment methods for API (no sensitive data).
 * @param {import('../models/User')} user
 * @returns {{ saved_cards: object[], default_payment_method: string|null }}
 */
function serializeUserSavedCards(user) {
  const savedCards = (user.saved_payment_methods || []).map(method => ({
    token_id: method.token_id,
    card_brand: method.card_brand,
    card_last_four: method.card_last_four,
    expiry_month: method.expiry_month,
    expiry_year: method.expiry_year,
    is_default: method.is_default,
    nickname: method.nickname,
    created_at: method.created_at,
    last_used_at: method.last_used_at,
  }));

  return {
    saved_cards: savedCards,
    default_payment_method: user.default_payment_method || null,
  };
}

/**
 * GET /v1/payments/admin/clients/:clientId/saved-cards
 * Admin: list a client's saved payment methods
 */
router.get(
  '/admin/clients/:clientId/saved-cards',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const User = require('../models/User');
      const client = await User.findById(req.params.clientId);
      if (!client) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'CLIENT_NOT_FOUND',
            message: 'Client not found',
          },
        });
      }

      if (client.role !== 'client') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TARGET_USER',
            message: 'Saved cards are only available for client accounts',
          },
        });
      }

      res.json({
        success: true,
        data: serializeUserSavedCards(client),
      });
    } catch (err) {
      console.error('Admin get client saved cards error:', {
        admin_id: req.user._id,
        client_id: req.params.clientId,
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'SAVED_CARDS_FAILED',
          message: err.message,
        },
      });
    }
  },
);

/**
 * POST /v1/payments/admin/coe/:coeId/intent
 * Admin: charge client's saved card for COE payment
 */
router.post(
  '/admin/coe/:coeId/intent',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { error, value } = createPaymentSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
          },
        });
      }

      const COE = require('../models/COE');
      const coe = await COE.findById(req.params.coeId).select('client_id');
      if (!coe) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'COE_NOT_FOUND',
            message: 'Experience not found',
          },
        });
      }

      const clientId = coe.client_id?._id || coe.client_id;
      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'COE_CLIENT_MISSING',
            message: 'Experience has no associated client',
          },
        });
      }

      const { paymentType, tokenId } = value;

      const result = await paymentService.createPaymentIntent(
        req.params.coeId,
        clientId,
        paymentType,
        { tokenId },
      );

      console.log('Admin pay on behalf intent:', {
        admin_id: req.user._id,
        client_id: clientId,
        coe_id: req.params.coeId,
        payment_type: paymentType,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        data: result,
        message: 'Payment intent created successfully',
      });
    } catch (err) {
      console.error('Admin pay on behalf intent error:', {
        admin_id: req.user._id,
        coe_id: req.params.coeId,
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'PAYMENT_INTENT_FAILED',
          message: err.message,
        },
      });
    }
  },
);

/**
 * POST /v1/payments/admin/coe/:coeId/record-cash
 * Admin: record COE lifecycle payment as cash (no GOAT).
 */
router.post(
  '/admin/coe/:coeId/record-cash',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { error, value } = recordCashCoePaymentSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
          },
        });
      }

      const COE = require('../models/COE');
      const coe = await COE.findById(req.params.coeId).select('client_id');
      if (!coe) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'COE_NOT_FOUND',
            message: 'Experience not found',
          },
        });
      }

      const clientId = coe.client_id?._id || coe.client_id;
      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'COE_CLIENT_MISSING',
            message: 'Experience has no associated client',
          },
        });
      }

      const adminId = req.user._id?.toString?.() || req.user.id;
      const result = await paymentService.recordCashCoePayment(
        adminId,
        req.params.coeId,
        clientId,
        value.paymentType,
        { cash_note: value.cash_note },
      );

      if (result.coe_updated) {
        return res.json({
          success: true,
          data: result,
          message: result.message,
        });
      }

      console.log('Admin cash COE payment recorded:', {
        admin_id: adminId,
        client_id: clientId,
        coe_id: req.params.coeId,
        payment_type: value.paymentType,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: true,
        data: result,
        message: 'Cash payment recorded successfully',
      });
    } catch (err) {
      console.error('Admin record cash COE payment error:', {
        admin_id: req.user._id,
        coe_id: req.params.coeId,
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'CASH_PAYMENT_FAILED',
          message: err.message,
        },
      });
    }
  },
);

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


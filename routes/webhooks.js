const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');

/**
 * Webhook Routes - GOAT Payment Gateway
 * @description Handle webhook callbacks from GOAT (register URL via GOAT API POST /api/v2/webhooks).
 */

/**
 * POST /webhooks/goat
 * Handle GOAT webhook events (signature: optional x-signature / x-goat-signature when GOAT_WEBHOOK_SIGNATURE is set).
 */
router.post('/goat', express.json(), async (req, res) => {
  try {
    const signature =
      req.headers['x-signature'] ||
      req.headers['x-goat-signature'] ||
      req.headers['x-webhook-signature'];

    console.log('Received GOAT webhook:', {
      timestamp: new Date().toISOString(),
      hasBody: !!req.body,
    });

    const isValid = paymentService.verifyGoatWebhookSignature(req.body, signature);

    if (!isValid) {
      console.error('Invalid GOAT webhook signature');
      return res.status(401).json({
        error: 'Invalid signature',
        received: false,
      });
    }

    const result = await paymentService.processGoatWebhook(req.body);

    res.json({
      received: true,
      processed: result.processed,
    });
  } catch (error) {
    console.error('GOAT webhook processing error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    res.status(500).json({
      error: 'Webhook processing failed',
      received: true,
      processed: false,
    });
  }
});

/**
 * POST /webhooks/global-payments
 * @deprecated Global Payments removed; respond 410 so old dashboards fail clearly.
 */
router.post('/global-payments', express.json(), (req, res) => {
  res.status(410).json({
    error: 'Global Payments integration removed. Configure GOAT webhooks to POST /webhooks/goat',
    received: false,
  });
});

module.exports = router;

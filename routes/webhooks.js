const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');

/**
 * Webhook Routes - Global Payments Integration
 * @description Handle webhook events from Global Payments
 */

/**
 * POST /webhooks/global-payments
 * Handle Global Payments webhook events
 */
router.post('/global-payments', express.json(), async (req, res) => {
  try {
    const signature = req.headers['x-gp-signature'];
    
    console.log('Received webhook:', {
      type: req.body.type,
      timestamp: new Date().toISOString()
    });
    
    // Verify webhook signature
    const isValid = paymentService.verifyWebhookSignature(req.body, signature);
    
    if (!isValid) {
      console.error('Invalid webhook signature');
      return res.status(401).json({ 
        error: 'Invalid signature',
        received: false
      });
    }
    
    // Process webhook
    const result = await paymentService.processPaymentWebhook(req.body);
    
    res.json({ 
      received: true, 
      processed: result.processed 
    });
    
  } catch (error) {
    console.error('Webhook processing error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    // Return 500 so GP retries
    res.status(500).json({ 
      error: 'Webhook processing failed',
      received: true,
      processed: false
    });
  }
});

module.exports = router;


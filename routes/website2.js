const express = require('express');
const router = express.Router();
const path = require('path');
const { requireWebsitePasswordAuth } = require('../middleware/websitePasswordProtection');
const { sendContactFormEmail, sendNewsletterSubscriptionEmail } = require('../utils/emailService');

/**
 * Basic in-memory rate limiter for website2 contact form (per IP)
 */
const contactRateLimitStore = new Map();
const CONTACT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const CONTACT_RATE_LIMIT_MAX = 10; // max submissions per window per IP

function isContactRateLimited(ip) {
  const now = Date.now();
  const record = contactRateLimitStore.get(ip) || { count: 0, resetAt: now + CONTACT_RATE_LIMIT_WINDOW_MS };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + CONTACT_RATE_LIMIT_WINDOW_MS;
  }

  record.count += 1;
  contactRateLimitStore.set(ip, record);

  return record.count > CONTACT_RATE_LIMIT_MAX;
}

/**
 * GET /website2
 * Serve the new single-page website (password protected)
 */
router.get('/', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website2/index.html'));
  } catch (error) {
    console.error('Error serving website2 index:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website2/membership
 * Serve the membership page (password protected)
 */
router.get('/membership', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website2/membership.html'));
  } catch (error) {
    console.error('Error serving website2 membership page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website2/contact
 * Serve the contact page (password protected)
 */
router.get('/contact', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website2/contact.html'));
  } catch (error) {
    console.error('Error serving website2 contact page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website2/terms
 * Serve the terms and conditions page (password protected)
 */
router.get('/terms', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website2/terms.html'));
  } catch (error) {
    console.error('Error serving website2 terms page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website2/privacy
 * Serve the privacy policy page (password protected)
 */
router.get('/privacy', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website2/privacy.html'));
  } catch (error) {
    console.error('Error serving website2 privacy page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website2/refund
 * Serve the refund policy page (password protected)
 */
router.get('/refund', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website2/refund.html'));
  } catch (error) {
    console.error('Error serving website2 refund page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * POST /website2/contact
 * Handle contact form submission for website2
 */
router.post('/contact', requireWebsitePasswordAuth, async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    console.log('[WEBSITE2_CONTACT] Incoming contact form submission', {
      ip,
      timestamp: new Date().toISOString()
    });

    if (isContactRateLimited(ip)) {
      console.warn('Contact form rate limit exceeded', {
        ip,
        timestamp: new Date().toISOString()
      });
      return res.status(429).json({
        success: false,
        error: 'Too many submissions. Please try again later.'
      });
    }

    const { name, email, phone, subject, message, company } = req.body || {};

    console.log('[WEBSITE2_CONTACT] Parsed body (redacted message)', {
      hasName: !!name,
      hasEmail: !!email,
      hasSubject: !!subject,
      hasMessage: !!message,
      hasCompany: !!company
    });

    // Honeypot check
    if (company && typeof company === 'string' && company.trim().length > 0) {
      console.warn('Contact form honeypot triggered, likely bot submission', {
        ip,
        timestamp: new Date().toISOString()
      });
      return res.json({ success: true });
    }

    const errors = {};
    if (!name || !name.trim()) errors.name = 'Name is required';
    if (!email || !email.trim()) errors.email = 'Email is required';
    if (!subject || !subject.trim()) errors.subject = 'Subject is required';
    if (!message || !message.trim()) errors.message = 'Message is required';

    if (Object.keys(errors).length > 0) {
      console.warn('[WEBSITE2_CONTACT] Validation failed', {
        ip,
        errors,
        timestamp: new Date().toISOString()
      });
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    await sendContactFormEmail({
      name: name.trim(),
      email: email.trim(),
      phone: (phone || '').trim(),
      subject: subject.trim(),
      message
    });

    console.log('[WEBSITE2_CONTACT] Contact form email send completed successfully', {
      ip,
      to: process.env.CONTACT_EMAIL,
      timestamp: new Date().toISOString()
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('[WEBSITE2_CONTACT] Error handling contact form submission:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
});

/**
 * POST /website2/newsletter
 * Handle newsletter subscription
 */
router.post('/newsletter', requireWebsitePasswordAuth, async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    console.log('[WEBSITE2_NEWSLETTER] Incoming newsletter subscription', {
      ip,
      timestamp: new Date().toISOString()
    });

    // Basic rate limiting for newsletter (same as contact form)
    if (isContactRateLimited(ip)) {
      console.warn('Newsletter subscription rate limit exceeded', {
        ip,
        timestamp: new Date().toISOString()
      });
      return res.status(429).json({
        success: false,
        error: 'Too many submissions. Please try again later.'
      });
    }

    const { email } = req.body || {};

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    // Send newsletter subscription email (clearly identified as subscription)
    await sendNewsletterSubscriptionEmail(email.trim());

    console.log('[WEBSITE2_NEWSLETTER] Newsletter subscription email sent successfully', {
      ip,
      email: email.trim(),
      to: process.env.CONTACT_EMAIL,
      timestamp: new Date().toISOString()
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('[WEBSITE2_NEWSLETTER] Error handling newsletter subscription:', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to subscribe'
    });
  }
});

module.exports = router;


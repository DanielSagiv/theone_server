const express = require('express');
const router = express.Router();
const path = require('path');
const { requireWebsitePasswordAuth } = require('../middleware/websitePasswordProtection');
const { sendContactFormEmail } = require('../utils/emailService');

/**
 * POST /website/login
 * Handle password authentication for website access
 * The middleware will process the password and redirect if correct
 */
router.post('/login', requireWebsitePasswordAuth, (req, res) => {
  // If we reach here, user is authenticated, redirect to home
  res.redirect('/website');
});

/**
 * GET /website/login
 * Show login page
 * The middleware will show login form if not authenticated
 */
router.get('/login', requireWebsitePasswordAuth, (req, res) => {
  // If we reach here, user is authenticated, redirect to home
  res.redirect('/website');
});

/**
 * GET /website
 * Serve the main website page (password protected)
 */
router.get('/', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/index.html'));
  } catch (error) {
    console.error('Error serving website index:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/experience
 * Serve the experience page (password protected)
 */
router.get('/experience', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/experience.html'));
  } catch (error) {
    console.error('Error serving experience page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/membership
 * Serve the membership page (password protected)
 */
router.get('/membership', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/membership.html'));
  } catch (error) {
    console.error('Error serving membership page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/vision
 * Serve the vision page (password protected)
 */
router.get('/vision', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/vision.html'));
  } catch (error) {
    console.error('Error serving vision page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/contact
 * Serve the contact page (password protected)
 */
router.get('/contact', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/contact.html'));
  } catch (error) {
    console.error('Error serving contact page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * Basic in-memory rate limiter for website contact form (per IP)
 * Lightweight to avoid adding new dependencies.
 */
const contactRateLimitStore = new Map();
const CONTACT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const CONTACT_RATE_LIMIT_MAX = 10; // max submissions per window per IP

function isContactRateLimited(ip) {
  const now = Date.now();
  const record = contactRateLimitStore.get(ip) || { count: 0, resetAt: now + CONTACT_RATE_LIMIT_WINDOW_MS };

  if (now > record.resetAt) {
    // Window expired, reset
    record.count = 0;
    record.resetAt = now + CONTACT_RATE_LIMIT_WINDOW_MS;
  }

  record.count += 1;
  contactRateLimitStore.set(ip, record);

  return record.count > CONTACT_RATE_LIMIT_MAX;
}

/**
 * POST /website/contact
 * Handle contact form submission: validate input and send email via AWS SES
 * Includes basic rate limiting and honeypot spam protection.
 */
router.post('/contact', requireWebsitePasswordAuth, async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';

    console.log('[WEBSITE_CONTACT] Incoming contact form submission', {
      ip,
      timestamp: new Date().toISOString()
    });

    if (isContactRateLimited(ip)) {
      console.warn('Contact form rate limit exceeded', {
        ip,
        timestamp: new Date().toISOString()
      });
      // Return generic error to client
      return res.status(429).json({
        success: false,
        error: 'Too many submissions. Please try again later.'
      });
    }

    const { name, email, phone, subject, message, company } = req.body || {};

    console.log('[WEBSITE_CONTACT] Parsed body (redacted message)', {
      hasName: !!name,
      hasEmail: !!email,
      hasSubject: !!subject,
      hasMessage: !!message,
      hasCompany: !!company
    });

    // Honeypot: if "company" is filled, treat as bot/spam and short-circuit
    if (company && typeof company === 'string' && company.trim().length > 0) {
      console.warn('Contact form honeypot triggered, likely bot submission', {
        ip,
        timestamp: new Date().toISOString()
      });
      // Pretend success to avoid giving feedback to bots
      return res.json({ success: true });
    }

    const errors = {};
    if (!name || !name.trim()) errors.name = 'Name is required';
    if (!email || !email.trim()) errors.email = 'Email is required';
    if (!subject || !subject.trim()) errors.subject = 'Subject is required';
    if (!message || !message.trim()) errors.message = 'Message is required';

    if (Object.keys(errors).length > 0) {
      console.warn('[WEBSITE_CONTACT] Validation failed', {
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

    console.log('[WEBSITE_CONTACT] Contact form email send completed successfully', {
      ip,
      to: process.env.CONTACT_EMAIL,
      timestamp: new Date().toISOString()
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('[WEBSITE_CONTACT] Error handling contact form submission:', {
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
 * GET /website/terms
 * Serve the terms and conditions page (password protected)
 */
router.get('/terms', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/terms.html'));
  } catch (error) {
    console.error('Error serving terms page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/privacy
 * Serve the privacy policy page (password protected)
 */
router.get('/privacy', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/privacy.html'));
  } catch (error) {
    console.error('Error serving privacy page:', error);
    res.status(500).send('Error loading page');
  }
});

module.exports = router;


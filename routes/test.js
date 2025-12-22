const express = require('express');
const router = express.Router();
const path = require('path');

/**
 * GET /test/login
 * Display login form for testing
 */
router.get('/login', (req, res) => {
  res.render('test/login', {
    title: 'The1 Platform - Login Test',
    error: null,
    success: null
  });
});

/**
 * GET /test/signup
 * Display signup form for testing
 */
router.get('/signup', (req, res) => {
  res.render('test/signup', {
    title: 'The1 Platform - Sign Up',
    error: null,
    success: null
  });
});

/**
 * GET /test/verify-email
 * Display email verification page
 */
router.get('/verify-email', (req, res) => {
  res.render('test/verify-email', {
    title: 'Verify Email - The1 Platform'
  });
});

/**
 * GET /test/dashboard
 * Display user dashboard with API testing tools
 */
router.get('/dashboard', (req, res) => {
  res.render('test/dashboard', {
    title: 'The1 Platform - API Test Dashboard',
    user: null,
    token: null
  });
});

/**
 * GET /test/gxn-sample
 * Display a static GXN inventoryinfo sample viewer (no external calls)
 */
// Removed deprecated gxn-sample route

// Venues-only viewer
router.get('/gxn-venues', (req, res) => {
  res.render('test/gxn-venues', {
    title: 'GXN Venues'
  });
});

/**
 * GET /test/gxn-res.json
 * Serve static GXN sample JSON from project root
 */
router.get('/gxn-res.json', (req, res) => {
  const filePath = path.resolve(process.cwd(), 'gxn_res.json');
  res.sendFile(filePath);
});

/**
 * GET /test/users
 * Display user management testing interface
 */
router.get('/users', (req, res) => {
  res.render('test/users', {
    title: 'The1 Platform - User Management Test',
    users: [],
    error: null
  });
});

/**
 * GET /test/sessions
 * Display session management testing interface
 */
router.get('/sessions', (req, res) => {
  res.render('test/sessions', {
    title: 'The1 Platform - Session Management Test',
    sessions: [],
    error: null
  });
});

/**
 * GET /test/email-test
 * Test email service by sending a test email
 * Query params: ?email=your@email.com (optional, defaults to CONTACT_EMAIL)
 */
router.get('/email-test', async (req, res) => {
  try {
    const emailService = require('../utils/emailService');
    const testEmail = req.query.email || process.env.CONTACT_EMAIL;
    
    if (!testEmail) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'No email provided. Add ?email=your@email.com or set CONTACT_EMAIL in .env',
          code: 'MISSING_EMAIL'
        }
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(testEmail)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid email format',
          code: 'INVALID_EMAIL'
        }
      });
    }

    // Check AWS configuration
    const configStatus = {
      hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
      hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
      hasRegion: !!process.env.AWS_REGION,
      fromEmail: process.env.FROM_EMAIL || 'noreply@the1.vip'
    };

    // Test basic email send
    const result = await emailService.sendEmail({
      to: testEmail,
      subject: 'Test Email - The1 Platform',
      html: '<h1>Test Email</h1><p>If you receive this, email service is working!</p><p>Timestamp: ' + new Date().toISOString() + '</p>'
    });

    res.json({
      success: true,
      message: 'Test email sent successfully',
      data: {
        messageId: result.messageId,
        to: testEmail,
        from: configStatus.fromEmail,
        timestamp: new Date().toISOString()
      },
      config: configStatus
    });
  } catch (error) {
    console.error('[EMAIL_TEST_ERROR]', {
      error: {
        message: error.message,
        code: error.code,
        statusCode: error.statusCode,
        requestId: error.requestId,
        retryable: error.retryable
      },
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        message: error.message || 'Failed to send test email',
        code: error.code || 'EMAIL_SEND_FAILED',
        statusCode: error.statusCode,
        requestId: error.requestId,
        retryable: error.retryable,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      config: {
        hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
        hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
        hasRegion: !!process.env.AWS_REGION,
        fromEmail: process.env.FROM_EMAIL || 'noreply@the1.vip'
      }
    });
  }
});

module.exports = router;

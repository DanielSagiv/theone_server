const express = require('express');
const crypto = require('crypto');
const authService = require('../services/authService');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const emailService = require('../utils/emailService');
const { 
  signupSchema, 
  signinSchema, 
  renewPasswordSchema, 
  resetPasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema
} = require('../utils/validationSchemas');

const router = express.Router();

/**
 * POST /v1/auth/signup
 * Register new user
 */
router.post('/signup', async (req, res) => {
  try {
    // Validate input
    const { error, value } = signupSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    // Register user
    const user = await authService.registerUser(value);

    res.status(201).json({
      success: true,
      data: user,
      message: 'User registered successfully'
    });

  } catch (error) {
    console.error('Signup error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(400).json({
      success: false,
      error: {
        code: 'SIGNUP_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /v1/auth/signin
 * User login
 */
router.post('/signin', async (req, res) => {
  try {
    // DEBUG: Log incoming request
    const passwordValue = req.body?.password || '';
    const passwordPreview = passwordValue.length > 0 
      ? `${passwordValue.substring(0, 1)}${'*'.repeat(Math.max(0, passwordValue.length - 2))}${passwordValue.substring(passwordValue.length - 1)}`
      : 'missing';
    console.log('[AUTH_SIGNIN] Incoming signin request', {
      timestamp: new Date().toISOString(),
      bodyKeys: Object.keys(req.body || {}),
      email: req.body?.email ? `${req.body.email.substring(0, 10)}...` : 'missing',
      hasPassword: !!req.body?.password,
      passwordLength: passwordValue.length,
      passwordPreview: passwordPreview,
      passwordFirstChar: passwordValue.length > 0 ? passwordValue[0] : null,
      passwordLastChar: passwordValue.length > 0 ? passwordValue[passwordValue.length - 1] : null,
      contentType: req.headers['content-type']
    });

    // Validate input
    const { error, value } = signinSchema.validate(req.body);
    if (error) {
      console.log('[AUTH_SIGNIN] Validation failed', {
        error: error.details[0].message,
        received: { email: req.body?.email, hasPassword: !!req.body?.password }
      });
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    console.log('[AUTH_SIGNIN] Validation passed', {
      email: value.email,
      emailLowercase: value.email.toLowerCase()
    });

    // Authenticate user
    const result = await authService.authenticateUser(value.email, value.password, req);

    res.json({
      success: true,
      data: result,
      message: 'Login successful'
    });

  } catch (error) {
    console.error('Signin error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    // Special handling for unverified email
    if (error.message === 'EMAIL_NOT_VERIFIED') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email address before logging in. Check your inbox for the verification link.',
          action: 'resend_verification'
        }
      });
    }

    // Determine appropriate status code based on error type
    let statusCode = 401;
    if (
      error.message.includes('pending approval') ||
      error.message.includes('suspended') ||
      error.message.includes('deleted') ||
      error.message.includes('declined')
    ) {
      statusCode = 403; // Forbidden for status-related issues
    }

    res.status(statusCode).json({
      success: false,
      error: {
        code: 'SIGNIN_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /v1/auth/logout
 * User logout
 */
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const token = req.headers['authorization'].split(' ')[1];
    await authService.logoutUser(token);

    // Optionally remove current device's push token (if provided by mobile app)
    // This allows users to have multiple devices (iPhone, iPad, Android) without affecting others
    const { pushToken } = req.body;
    
    if (pushToken) {
      try {
        const user = await User.findById(req.user._id);
        if (user && user.push_tokens && user.push_tokens.length > 0) {
          const beforeCount = user.push_tokens.length;
          user.push_tokens = user.push_tokens.filter(t => t.token !== pushToken);
          const removedCount = beforeCount - user.push_tokens.length;
          
          if (removedCount > 0) {
            await user.save();
            console.log(`[AuthRoute] Removed current device's push token on logout for user ${req.user._id}`);
          }
        }
      } catch (tokenError) {
        // Don't fail logout if token removal fails
        console.warn('[AuthRoute] Failed to remove push token on logout:', tokenError.message);
      }
    }
    // If no pushToken provided, don't remove any tokens (safer - user might have multiple devices)

    res.json({
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('Logout error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_FAILED',
        message: 'Logout failed'
      }
    });
  }
});

/**
 * POST /v1/auth/renew-password
 * Request password renewal (legacy endpoint - kept for backward compatibility)
 */
router.post('/renew-password', async (req, res) => {
  try {
    // Validate input
    const { error, value } = renewPasswordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const result = await authService.requestPasswordReset(value.email);

    res.json({
      success: true,
      message: result.message
    });

  } catch (error) {
    console.error('Renew password error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'RENEW_PASSWORD_FAILED',
        message: 'Password renewal failed'
      }
    });
  }
});

/**
 * POST /v1/auth/forgot-password
 * Request password reset (new endpoint per MD spec)
 */
router.post('/forgot-password', async (req, res) => {
  try {
    // Validate input
    const { error, value } = renewPasswordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const result = await authService.requestPasswordReset(value.email);

    res.json({
      success: true,
      message: result.message
    });

  } catch (error) {
    console.error('Forgot password error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'FORGOT_PASSWORD_FAILED',
        message: 'Password reset request failed'
      }
    });
  }
});

/**
 * POST /v1/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', async (req, res) => {
  try {
    // Validate input
    const { error, value } = resetPasswordSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const result = await authService.resetPassword(value.code, value.password);

    res.json({
      success: true,
      message: result.message
    });

  } catch (error) {
    console.error('Reset password error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(400).json({
      success: false,
      error: {
        code: 'RESET_PASSWORD_FAILED',
        message: error.message || 'Password reset failed'
      }
    });
  }
});

/**
 * POST /v1/auth/verify-email
 * Verify user email with token
 */
router.post('/verify-email', async (req, res) => {
  try {
    // Validate input
    const { error, value } = verifyEmailSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const { code } = value;

    // Find user with valid code
    const user = await User.findOne({
      emailVerificationCode: code,
      emailVerificationExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CODE',
          message: 'Invalid or expired verification code'
        }
      });
    }

    // Check if already verified
    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'Email is already verified'
        }
      });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationCode = undefined;
    user.emailVerificationExpires = undefined;
    
    await user.save();

    // Send welcome email (optional, non-blocking)
    emailService.sendWelcomeEmail(user)
      .catch(err => console.error('Welcome email error:', err));

    // Log verification event
    console.log('Email verified:', {
      userId: user._id,
      email: user.email,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      data: {
        message: 'Email verified successfully! You can now log in.',
        redirectUrl: '/test/login'
      }
    });

  } catch (error) {
    console.error('Email verification error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_FAILED',
        message: 'Email verification failed'
      }
    });
  }
});

/**
 * POST /v1/auth/resend-verification
 * Resend verification email to user
 */
router.post('/resend-verification', async (req, res) => {
  try {
    // Validate input
    const { error, value } = resendVerificationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    const { email } = value;

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // Don't reveal if user exists (security)
      return res.json({
        success: true,
        message: 'If an account exists with this email, a verification link has been sent.'
      });
    }

    // Check if already verified
    if (user.emailVerified) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_VERIFIED',
          message: 'Email is already verified'
        }
      });
    }

    // Check rate limiting (prevent spam)
    const lastSent = user.emailVerificationSentAt;
    if (lastSent) {
      const minutesSinceLastSend = (Date.now() - lastSent) / 1000 / 60;
      if (minutesSinceLastSend < 5) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Please wait ${Math.ceil(5 - minutesSinceLastSend)} minutes before requesting another verification email`
          }
        });
      }
    }

    // Generate new 6-digit code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.emailVerificationCode = verificationCode;
    user.emailVerificationExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    user.emailVerificationSentAt = new Date();
    await user.save();

    // Send email
    await emailService.sendVerificationEmail(user, verificationCode);

    // Log resend event
    console.log('Verification email resent:', {
      userId: user._id,
      email: user.email,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.'
    });

  } catch (error) {
    console.error('Resend verification error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'RESEND_FAILED',
        message: 'Failed to resend verification email'
      }
    });
  }
});

/**
 * GET /v1/auth/validate
 * Validate current session
 */
router.get('/validate', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        user: req.user.getProfile(),
        session: req.userSession
      },
      message: 'Session is valid'
    });

  } catch (error) {
    console.error('Session validation error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Session validation failed'
      }
    });
  }
});

module.exports = router;

const express = require('express');
const authService = require('../services/authService');
const { authenticateToken } = require('../middleware/auth');
const { 
  signupSchema, 
  signinSchema, 
  renewPasswordSchema, 
  resetPasswordSchema 
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
    // Validate input
    const { error, value } = signinSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

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

    // Determine appropriate status code based on error type
    let statusCode = 401;
    if (error.message.includes('pending approval') || error.message.includes('suspended') || error.message.includes('deleted')) {
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
 * Request password renewal
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

    // TODO: Implement password reset email logic
    // For now, just return success
    res.json({
      success: true,
      message: 'Password reset email sent (not implemented yet)'
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
 * PUT /v1/auth/reset-password
 * Reset password with token
 */
router.put('/reset-password', async (req, res) => {
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

    // TODO: Implement password reset logic
    // For now, just return success
    res.json({
      success: true,
      message: 'Password reset successful (not implemented yet)'
    });

  } catch (error) {
    console.error('Reset password error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'RESET_PASSWORD_FAILED',
        message: 'Password reset failed'
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

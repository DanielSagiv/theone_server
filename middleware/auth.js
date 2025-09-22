const jwt = require('jsonwebtoken');
const Session = require('../models/Session');
const User = require('../models/User');

/**
 * Authentication middleware for protected routes
 * @description Validates JWT token and checks session validity
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authenticateToken = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_TOKEN_MISSING',
          message: 'Access token is required'
        }
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if session exists and is valid
    const session = await Session.findOne({
      token: token,
      userId: decoded.userId,
      isActive: true
    });

    if (!session || !session.isValid()) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_SESSION_INVALID',
          message: 'Session is invalid or expired'
        }
      });
    }

    // Get user data
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_USER_INVALID',
          message: 'User account is invalid or disabled'
        }
      });
    }

    // Update last accessed time
    await session.updateLastAccessed();

    // Add user and session to request object
    req.user = user;
    req.session = session;

    next();
  } catch (error) {
    console.error('Authentication error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_TOKEN_INVALID',
          message: 'Invalid access token'
        }
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_TOKEN_EXPIRED',
          message: 'Access token has expired'
        }
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_INTERNAL_ERROR',
        message: 'Authentication failed'
      }
    });
  }
};

/**
 * Authorization middleware for admin-only routes
 * @description Checks if user has admin role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required'
        }
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'AUTH_INSUFFICIENT_PERMISSIONS',
          message: 'Admin access required'
        }
      });
    }

    next();
  } catch (error) {
    console.error('Authorization error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_INTERNAL_ERROR',
        message: 'Authorization failed'
      }
    });
  }
};

module.exports = {
  authenticateToken,
  requireAdmin
};

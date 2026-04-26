/**
 * Password Protection Middleware
 * Protects the application with a simple password before allowing access to login/signup
 */

const crypto = require('crypto');

// The access password (hashed for security)
const ACCESS_PASSWORD = 'The0ne1976';
const SESSION_KEY = 'authorized_access';

/**
 * Hash a password using SHA-256
 * @param {string} password - Password to hash
 * @returns {string} Hashed password
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Check if user has provided correct password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function requirePasswordAuth(req, res, next) {
  // Check if user is already authorized
  if (req.session && req.session[SESSION_KEY]) {
    return next();
  }

  // If this is a POST request to verify password
  if (req.method === 'POST' && req.body.password) {
    const providedPassword = req.body.password;
    const hashedProvidedPassword = hashPassword(providedPassword);
    const hashedAccessPassword = hashPassword(ACCESS_PASSWORD);

    if (hashedProvidedPassword === hashedAccessPassword) {
      // Password is correct, set session
      if (!req.session) {
        req.session = {};
      }
      req.session[SESSION_KEY] = true;
      
      // Redirect to the originally requested URL or dashboard
      const redirectUrl = req.query.redirect || '/test/dashboard';
      return res.redirect(redirectUrl);
    } else {
      // Password is incorrect
      return res.render('landing', {
        title: 'The1 Platform - Access Required',
        error: 'Incorrect password. Please try again.',
        redirectUrl: req.query.redirect || '/test/dashboard'
      });
    }
  }

  // Show password form
  return res.render('landing', {
    title: 'The1 Platform - Access Required',
    error: null,
    redirectUrl: req.query.redirect || '/test/dashboard'
  });
}

/**
 * Check if user is authorized (for API routes)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function checkPasswordAuth(req, res, next) {
  if (req.session && req.session[SESSION_KEY]) {
    return next();
  }
  
  return res.status(401).json({
    success: false,
    error: { message: 'Password authorization required' }
  });
}

module.exports = {
  requirePasswordAuth,
  checkPasswordAuth
};

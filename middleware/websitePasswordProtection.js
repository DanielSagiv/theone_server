/**
 * Website Password Protection Middleware
 * Protects the website with a password before allowing access
 * Temporary protection until site goes live
 */

const crypto = require('crypto');

// The website access password (stored in backend only)
const WEBSITE_PASSWORD = 'the0ne1976';
const WEBSITE_SESSION_KEY = 'website_authorized';

/**
 * Hash a password using SHA-256
 * @param {string} password - Password to hash
 * @returns {string} Hashed password
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Check if user has provided correct password for website access
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function requireWebsitePasswordAuth(req, res, next) {
  // Check if user is already authorized for website
  if (req.session && req.session[WEBSITE_SESSION_KEY]) {
    return next();
  }

  // If this is a POST request to verify password
  if (req.method === 'POST' && req.body.password) {
    const providedPassword = req.body.password;
    const hashedProvidedPassword = hashPassword(providedPassword);
    const hashedWebsitePassword = hashPassword(WEBSITE_PASSWORD);

    if (hashedProvidedPassword === hashedWebsitePassword) {
      // Password is correct, set session
      if (!req.session) {
        req.session = {};
      }
      req.session[WEBSITE_SESSION_KEY] = true;
      
      // Redirect to the originally requested URL or home
      const redirectUrl = req.body.redirect || req.query.redirect || '/website';
      return res.redirect(redirectUrl);
    } else {
      // Password is incorrect
      return res.render('website/login', {
        title: 'Website Access - Password Required',
        error: 'Incorrect password. Please try again.',
        redirectUrl: req.body.redirect || req.query.redirect || '/website'
      });
    }
  }

  // Show password form
  return res.render('website/login', {
    title: 'Website Access - Password Required',
    error: null,
    redirectUrl: req.query.redirect || req.originalUrl
  });
}

module.exports = {
  requireWebsitePasswordAuth
};









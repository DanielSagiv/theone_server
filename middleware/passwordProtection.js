/**
 * Password Protection Middleware
 * Protects the application with a simple password before allowing access to login/signup
 */

const crypto = require('crypto');

// The access password (hashed for security)
const ACCESS_PASSWORD = 'The0ne1976';
const SESSION_KEY = 'authorized_access';
const PASSWORD_AUTH_LOG_PREFIX = '[PasswordAuth]';

/**
 * Hash a password using SHA-256
 * @param {string} password - Password to hash
 * @returns {string} Hashed password
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Build structured diagnostics context for password-auth logs.
 * @param {Object} req - Express request object
 * @returns {Object} Log context with request metadata
 */
function getPasswordAuthLogContext(req) {
  return {
    method: req.method,
    originalUrl: req.originalUrl,
    ip: req.ip,
    forwardedFor: req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || 'unknown',
    hasSessionObject: !!req.session,
    isSessionAuthorized: !!(req.session && req.session[SESSION_KEY]),
    hasPasswordField: !!(req.body && Object.prototype.hasOwnProperty.call(req.body, 'password')),
    passwordLength: req.body && typeof req.body.password === 'string' ? req.body.password.length : null,
    queryRedirect: req.query ? req.query.redirect || null : null
  };
}

/**
 * Check if user has provided correct password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function requirePasswordAuth(req, res, next) {
  const baseLogContext = getPasswordAuthLogContext(req);
  console.info(`${PASSWORD_AUTH_LOG_PREFIX} Incoming request`, baseLogContext);

  // Check if user is already authorized
  if (req.session && req.session[SESSION_KEY]) {
    console.info(`${PASSWORD_AUTH_LOG_PREFIX} Session already authorized; allowing request`, baseLogContext);
    return next();
  }

  // If this is a POST request to verify password
  if (req.method === 'POST' && req.body && req.body.password) {
    const providedPassword = req.body.password;
    const hashedProvidedPassword = hashPassword(providedPassword);
    const hashedAccessPassword = hashPassword(ACCESS_PASSWORD);
    const passwordsMatch = hashedProvidedPassword === hashedAccessPassword;

    if (passwordsMatch) {
      // Password is correct, set session
      if (!req.session) {
        req.session = {};
      }
      req.session[SESSION_KEY] = true;
      
      // Redirect to the originally requested URL or dashboard
      const redirectUrl = req.query.redirect || '/test/dashboard';
      console.info(`${PASSWORD_AUTH_LOG_PREFIX} Password accepted; redirecting`, {
        ...baseLogContext,
        passwordsMatch,
        redirectUrl
      });
      return res.redirect(redirectUrl);
    } else {
      // Password is incorrect
      console.warn(`${PASSWORD_AUTH_LOG_PREFIX} Password rejected; rendering landing with error`, {
        ...baseLogContext,
        passwordsMatch
      });
      return res.render('landing', {
        title: 'The1 Platform - Access Required',
        error: 'Incorrect password. Please try again.',
        redirectUrl: req.query.redirect || '/test/dashboard'
      });
    }
  }

  if (req.method === 'POST') {
    console.warn(`${PASSWORD_AUTH_LOG_PREFIX} POST request missing password field; rendering landing`, baseLogContext);
  }

  // Show password form
  console.info(`${PASSWORD_AUTH_LOG_PREFIX} Rendering landing password form`, baseLogContext);
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

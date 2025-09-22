const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');

/**
 * Generate JWT token for user
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {string} role - User role
 * @returns {string} JWT token
 */
const generateToken = (userId, email, role) => {
  try {
    const payload = {
      userId,
      email,
      role
    };

    const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
  } catch (error) {
    console.error('Token generation error:', error);
    throw new Error('Failed to generate token');
  }
};

/**
 * Create user session in database
 * @param {string} userId - User ID
 * @param {string} token - JWT token
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Created session
 */
const createSession = async (userId, token, req) => {
  try {
    const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
    const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)); // Default 24 hours

    const session = new Session({
      userId,
      token,
      expiresAt,
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip || req.connection.remoteAddress
    });

    return await session.save();
  } catch (error) {
    console.error('Session creation error:', error);
    throw new Error('Failed to create session');
  }
};

/**
 * Register new user
 * @param {Object} userData - User registration data
 * @returns {Promise<Object>} Created user without password
 */
const registerUser = async (userData) => {
  try {
    // Check if user already exists
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Create new user
    const user = new User(userData);
    await user.save();

    // Return user profile without password
    return user.getProfile();
  } catch (error) {
    console.error('User registration error:', error);
    throw error;
  }
};

/**
 * Authenticate user login
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {Object} req - Express request object
 * @returns {Promise<Object>} Authentication result with token and user data
 */
const authenticateUser = async (email, password, req) => {
  try {
    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new Error('User account is disabled');
    }

    // Check entity status
    if (user.entity_status === 'deleted') {
      throw new Error('Your account has been deleted. Please contact an administrator for assistance.');
    }

    if (user.entity_status === 'pendingApproval') {
      throw new Error('Your account is pending approval. Please contact an administrator.');
    }

    if (user.entity_status === 'suspended') {
      throw new Error('Your account has been suspended. Please contact an administrator.');
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      throw new Error('Invalid credentials');
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id, user.email, user.role);

    // Create session
    const session = await createSession(user._id, token, req);

    return {
      token,
      user: user.getProfile(),
      expiresAt: session.expiresAt
    };
  } catch (error) {
    console.error('User authentication error:', error);
    throw error;
  }
};

/**
 * Logout user by invalidating session
 * @param {string} token - JWT token
 * @returns {Promise<boolean>} Success status
 */
const logoutUser = async (token) => {
  try {
    const session = await Session.findOne({ token, isActive: true });
    if (session) {
      await session.deactivate();
    }
    return true;
  } catch (error) {
    console.error('User logout error:', error);
    throw new Error('Failed to logout user');
  }
};

/**
 * Validate session token
 * @param {string} token - JWT token
 * @returns {Promise<Object>} Session validation result
 */
const validateSession = async (token) => {
  try {
    const session = await Session.findOne({ token, isActive: true });
    if (!session || !session.isValid()) {
      throw new Error('Invalid or expired session');
    }

    const user = await User.findById(session.userId);
    if (!user || !user.isActive) {
      throw new Error('User account is invalid or disabled');
    }

    // Check entity status for existing sessions
    if (user.entity_status === 'deleted') {
      throw new Error('Your account has been deleted. Please contact an administrator for assistance.');
    }

    if (user.entity_status === 'suspended') {
      throw new Error('Your account has been suspended. Please contact an administrator.');
    }

    return {
      user: user.getProfile(),
      session: session
    };
  } catch (error) {
    console.error('Session validation error:', error);
    throw error;
  }
};

module.exports = {
  generateToken,
  createSession,
  registerUser,
  authenticateUser,
  logoutUser,
  validateSession
};

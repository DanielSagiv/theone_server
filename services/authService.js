const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Session = require('../models/Session');
const emailService = require('../utils/emailService');

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
      // If user exists but email not verified, allow resend
      if (!existingUser.emailVerified) {
        throw new Error('EMAIL_NOT_VERIFIED');
      }
      throw new Error('User with this email already exists');
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create new user with verification fields
    const user = new User({
      ...userData,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
      emailVerificationSentAt: new Date(),
      entity_status: 'pendingApproval'
    });
    await user.save();

    // Send verification email (async, non-blocking)
    emailService.sendVerificationEmail(user, verificationToken)
      .then(() => {
        console.log('Verification email sent:', { 
          email: user.email, 
          timestamp: new Date().toISOString() 
        });
      })
      .catch(err => {
        console.error('Email send error:', { 
          email: user.email, 
          error: err.message,
          timestamp: new Date().toISOString()
        });
        // Don't throw - user can resend later
      });

    // Return user profile without password
    return {
      user: user.getProfile(),
      message: 'Account created successfully. Please check your email to verify your account.'
    };
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
    const emailLower = email.toLowerCase();
    console.log('[AUTH_SERVICE] authenticateUser called', {
      email: email,
      emailLower: emailLower,
      passwordLength: password ? password.length : 0,
      timestamp: new Date().toISOString()
    });

    // Find user by email
    const user = await User.findOne({ email: emailLower });
    console.log('[AUTH_SERVICE] User lookup result', {
      userFound: !!user,
      userId: user?._id?.toString(),
      emailVerified: user?.emailVerified,
      isActive: user?.isActive,
      entityStatus: user?.entity_status,
      hasPassword: !!user?.password,
      passwordHashLength: user?.password?.length
    });

    if (!user) {
      console.log('[AUTH_SERVICE] User not found', { email: emailLower });
      throw new Error('Invalid credentials');
    }

    // Verify password
    console.log('[AUTH_SERVICE] Comparing password', {
      userId: user._id.toString(),
      passwordProvided: password ? 'yes' : 'no',
      passwordLength: password?.length
    });
    const isPasswordValid = await user.comparePassword(password);
    console.log('[AUTH_SERVICE] Password comparison result', {
      isValid: isPasswordValid,
      userId: user._id.toString()
    });

    if (!isPasswordValid) {
      console.log('[AUTH_SERVICE] Password mismatch', { userId: user._id.toString() });
      throw new Error('Invalid credentials');
    }

    // Check if email is verified
    if (!user.emailVerified) {
      throw new Error('EMAIL_NOT_VERIFIED');
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

/**
 * Request password reset - generates token and sends email
 * @param {string} email - User email
 * @returns {Promise<Object>} Success message (always returns success for security)
 */
const requestPasswordReset = async (email) => {
  try {
    const emailLower = email.toLowerCase();
    const user = await User.findOne({ email: emailLower });

    // Always return success message (security - don't reveal if email exists)
    if (!user) {
      return {
        message: 'If email exists, reset link sent'
      };
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store token in user record
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetExpires;
    await user.save();

    // Send reset email (async, non-blocking)
    emailService.sendPasswordResetEmail(user, resetToken)
      .then(() => {
        console.log('Password reset email sent:', {
          email: user.email,
          timestamp: new Date().toISOString()
        });
      })
      .catch(err => {
        console.error('Password reset email error:', {
          email: user.email,
          error: err.message,
          timestamp: new Date().toISOString()
        });
        // Don't throw - we already returned success
      });

    return {
      message: 'If email exists, reset link sent'
    };
  } catch (error) {
    console.error('Password reset request error:', error);
    // Still return success for security
    return {
      message: 'If email exists, reset link sent'
    };
  }
};

/**
 * Reset password with token
 * @param {string} token - Reset token
 * @param {string} password - New password
 * @returns {Promise<Object>} Success message
 */
const resetPassword = async (token, password) => {
  try {
    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      throw new Error('Invalid or expired reset token');
    }

    // Update password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Invalidate all existing sessions for security
    await Session.updateMany(
      { userId: user._id, isActive: true },
      { $set: { isActive: false } }
    );

    return {
      message: 'Password reset successful'
    };
  } catch (error) {
    console.error('Password reset error:', error);
    throw error;
  }
};

module.exports = {
  generateToken,
  createSession,
  registerUser,
  authenticateUser,
  logoutUser,
  validateSession,
  requestPasswordReset,
  resetPassword
};

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Session = require('../models/Session');
const emailService = require('../utils/emailService');
const { isClientRegistrationApprovalRequired } = require('../utils/featureFlags');

/**
 * Same eligibility rules as password sign-in (verified email, active, entity status).
 * @param {Object} user - User document
 * @throws {Error} With message/code matching existing signin behavior
 */
const enforceLoginEligibility = (user) => {
  if (!user.emailVerified) {
    const err = new Error('EMAIL_NOT_VERIFIED');
    err.code = 'EMAIL_NOT_VERIFIED';
    throw err;
  }
  if (!user.isActive) {
    throw new Error('User account is disabled');
  }
  if (user.entity_status === 'deleted') {
    throw new Error('Your account has been deleted. Please contact an administrator for assistance.');
  }
  if (user.entity_status === 'registrationDeclined') {
    throw new Error('Your account registration was declined. Please contact an administrator for assistance.');
  }
  if (user.entity_status === 'pendingApproval' && user.role !== 'client') {
    throw new Error('Your account is pending approval. Please contact an administrator.');
  }
  if (user.entity_status === 'suspended') {
    throw new Error('Your account has been suspended. Please contact an administrator.');
  }
};

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
 * Update last login, create JWT and DB session (shared by password sign-in and login OTP).
 * @param {Object} user - User document
 * @param {Object} req - Express request
 * @returns {Promise<{ token: string, user: Object, expiresAt: Date }>}
 */
const issueSessionForUser = async (user, req) => {
  user.lastLogin = new Date();
  await user.save();
  const token = generateToken(user._id, user.email, user.role);
  const session = await createSession(user._id, token, req);
  return {
    token,
    user: user.getProfile(),
    expiresAt: session.expiresAt
  };
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

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    const role = userData.role || 'client';
    const autoApproveClient =
      role === 'client' && !isClientRegistrationApprovalRequired();

    // Create new user with verification fields (entity_status owned by server, not signup body)
    const user = new User({
      ...userData,
      emailVerified: false,
      emailVerificationCode: verificationCode,
      emailVerificationExpires: verificationExpires,
      emailVerificationSentAt: new Date(),
      entity_status: autoApproveClient ? 'live' : 'pendingApproval',
      ...(autoApproveClient
        ? {
            first_coe_deduction_enabled: false,
            first_coe_deduction_consumed: false,
            first_coe_deduction_amount: 1000,
          }
        : {}),
    });
    await user.save();

    // Send verification email (async, non-blocking)
    emailService.sendVerificationEmail(user, verificationCode)
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

    // Notify admins (non-blocking) that a new client is waiting for approval
    if (user.role === 'client' && user.entity_status === 'pendingApproval') {
      setImmediate(() => {
        (async () => {
          try {
            const notificationService = require('./notificationService');
            const adminUsers = await User.find({
              role: 'admin',
              isActive: true,
              entity_status: 'live',
            }).select('_id');

            if (!adminUsers || adminUsers.length === 0) {
              return;
            }

            const senderName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'A new client';
            await Promise.all(
              adminUsers.map((adminUser) =>
                notificationService.createAndSendNotification(
                  adminUser._id.toString(),
                  'admin_new_client_signup',
                  {
                    sender_id: user._id,
                    sender_name: senderName,
                    action_url: 'the1://manage-new-clients',
                  }
                )
              )
            );
          } catch (notifyError) {
            console.error('Admin signup notification error:', {
              error: notifyError.message,
              userId: user._id?.toString(),
              timestamp: new Date().toISOString(),
            });
          }
        })();
      });
    }

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

const ADMIN_CREATE_INDUSTRY_ENUM = [
  'fintech',
  'cyber',
  'social',
  'sales',
  'e-commerce',
  'AI',
  'energy',
  'crypto',
  'banking',
  'real-estate',
  'tech',
  'other',
];

/**
 * Create a client user directly (admin). User is live and email-verified; random password; welcome email with app links.
 * @param {Object} payload - Validated body (adminCreateClientSchema)
 * @returns {Promise<{ user: object }>}
 */
const createClientByAdmin = async (payload) => {
  const crypto = require('crypto');
  const emailLower = (payload.email || '').toLowerCase().trim();

  const existingUser = await User.findOne({ email: emailLower });
  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  const phoneRaw = payload.phone != null ? String(payload.phone).trim() : '';
  const phone =
    phoneRaw.length >= 10 ? phoneRaw : '0000000000';

  const industry =
    payload.industry && ADMIN_CREATE_INDUSTRY_ENUM.includes(payload.industry)
      ? payload.industry
      : 'other';

  const randomPassword = crypto.randomBytes(32).toString('hex');
  const now = new Date();

  const user = new User({
    email: emailLower,
    password: randomPassword,
    firstName: payload.firstName.trim(),
    lastName: payload.lastName.trim(),
    phone,
    dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : undefined,
    industry,
    industryCustom: payload.industryCustom || undefined,
    role: 'client',
    entity_status: 'live',
    emailVerified: true,
    emailVerifiedAt: now,
    termsAcceptedAt: now,
    privacyConsentAt: now,
    first_coe_deduction_enabled: Boolean(payload.first_coe_deduction_enabled),
    first_coe_deduction_consumed: false,
    first_coe_deduction_amount: 1000,
  });

  await user.save();

  emailService
    .sendAdminCreatedClientWelcomeEmail(user)
    .then(() => {
      console.log('[AUTH_SERVICE] Admin-created client welcome email queued', {
        email: user.email,
        timestamp: new Date().toISOString(),
      });
    })
    .catch((err) => {
      console.error('[AUTH_SERVICE] Admin-created client welcome email failed', {
        email: user.email,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    });

  return { user: user.getProfile() };
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

    enforceLoginEligibility(user);
    return issueSessionForUser(user, req);
  } catch (error) {
    console.error('User authentication error:', error);
    throw error;
  }
};

/**
 * Permanently delete the authenticated user's account (self-service).
 * Soft-deletes via entity_status, scrubs PII, and invalidates all sessions.
 * @param {import('mongoose').Types.ObjectId|string} userId
 * @returns {Promise<{ message: string }>}
 */
const deleteOwnAccount = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    if (user.entity_status === 'deleted') {
      throw new Error('Account already deleted');
    }

    const uid = user._id.toString();
    user.entity_status = 'deleted';
    user.isActive = false;
    user.push_tokens = [];
    user.saved_payment_methods = [];
    user.default_payment_method = undefined;
    user.resetPasswordToken = undefined;
    user.resetPasswordCode = undefined;
    user.resetPasswordExpires = undefined;
    user.loginOtpCode = undefined;
    user.loginOtpExpires = undefined;
    user.loginOtpSentAt = undefined;
    user.emailVerificationToken = undefined;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpires = undefined;
    user.email = `deleted+${uid}@removed.the1.vip`;
    user.firstName = 'Deleted';
    user.lastName = 'Account';
    user.phone = `+1000${uid.replace(/[^a-f0-9]/gi, '').slice(-10).padStart(10, '0')}`;
    user.avatarUrl = undefined;
    user.avatar_thumb_url = undefined;
    user.avatar_width = undefined;
    user.avatar_height = undefined;
    user.avatar_byte_size = undefined;
    user.socialMedia = undefined;
    user.goat_customer_id = undefined;

    await user.save();

    await Session.updateMany(
      { userId: user._id, isActive: true },
      { $set: { isActive: false } }
    );

    return { message: 'Account deleted successfully' };
  } catch (error) {
    console.error('Delete own account error:', {
      error: error.message,
      userId: userId?.toString?.(),
      timestamp: new Date().toISOString()
    });
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

    // Generate 6-digit reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Store code in user record
    user.resetPasswordCode = resetCode;
    user.resetPasswordExpires = resetExpires;
    await user.save();

    // Send reset email (async, non-blocking)
    emailService.sendPasswordResetEmail(user, resetCode)
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
 * Reset password with code
 * @param {string} code - Reset code (6-digit)
 * @param {string} password - New password
 * @returns {Promise<Object>} Success message
 */
/**
 * Send a login OTP email after eligibility checks (passwordless sign-in).
 * @param {string} email - User email
 * @param {Object} req - Express request (for logging context)
 * @returns {Promise<{ message: string }>}
 */
const requestLoginOtp = async (email, req) => {
  try {
    const emailLower = email.toLowerCase();
    const user = await User.findOne({ email: emailLower });
    if (!user) {
      const err = new Error('No account found for this email address.');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    enforceLoginEligibility(user);

    // Temporary: disable OTP resend rate-limit during UI/flow testing.
    // Keep loginOtpSentAt updates so this can be re-enabled later without schema changes.

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    user.loginOtpCode = otp;
    user.loginOtpExpires = expiresAt;
    user.loginOtpSentAt = new Date();
    await user.save();

    emailService.sendLoginOtpEmail(user, otp)
      .then(() => {
        console.log('[AUTH_SERVICE] Login OTP email sent', {
          email: user.email,
          requestId: req?.id,
          timestamp: new Date().toISOString()
        });
      })
      .catch((sendErr) => {
        console.error('[AUTH_SERVICE] Login OTP email failed', {
          email: user.email,
          error: sendErr.message,
          timestamp: new Date().toISOString()
        });
      });

    return {
      message: 'Sign-in code sent to your email.'
    };
  } catch (error) {
    console.error('[AUTH_SERVICE] requestLoginOtp error:', {
      message: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

/**
 * Verify login OTP and return the same payload as password sign-in.
 * @param {string} email - User email
 * @param {string} code - 6-digit code
 * @param {Object} req - Express request
 * @returns {Promise<{ token: string, user: Object, expiresAt: Date }>}
 */
const verifyLoginOtp = async (email, code, req) => {
  try {
    const emailLower = email.toLowerCase();
    const user = await User.findOne({ email: emailLower }).select('+loginOtpCode');

    if (
      !user ||
      !user.loginOtpCode ||
      user.loginOtpCode !== code ||
      !user.loginOtpExpires ||
      user.loginOtpExpires.getTime() <= Date.now()
    ) {
      const err = new Error('Invalid or expired sign-in code');
      err.code = 'INVALID_LOGIN_OTP';
      throw err;
    }

    enforceLoginEligibility(user);

    user.loginOtpCode = undefined;
    user.loginOtpExpires = undefined;

    return issueSessionForUser(user, req);
  } catch (error) {
    console.error('[AUTH_SERVICE] verifyLoginOtp error:', {
      message: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
};

const resetPassword = async (code, password) => {
  try {
    // Find user with valid code
    const user = await User.findOne({
      resetPasswordCode: code,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      throw new Error('Invalid or expired reset code');
    }

    // Update password
    user.password = password;
    user.resetPasswordCode = undefined;
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
  createClientByAdmin,
  authenticateUser,
  deleteOwnAccount,
  logoutUser,
  validateSession,
  requestPasswordReset,
  resetPassword,
  requestLoginOtp,
  verifyLoginOtp
};

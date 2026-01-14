const express = require('express');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { updateProfileSchema, updateEntityStatusSchema, updateRoleSchema, updateVisibilityStatusSchema, updateUserTierSchema } = require('../utils/validationSchemas');
const multer = require('multer');
const { uploadBufferToS3, extFromMime } = require('../utils/s3');
const crypto = require('crypto');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

/**
 * GET /v1/users/profile
 * Get current user profile
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      data: req.user.getProfile(),
      message: 'Profile retrieved successfully'
    });

  } catch (error) {
    console.error('Get profile error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_RETRIEVAL_FAILED',
        message: 'Failed to retrieve profile'
      }
    });
  }
});

/**
 * PUT /v1/users/profile
 * Update user profile
 */
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    // Validate input
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    // Check if email is being changed and if it already exists
    if (value.email && value.email !== req.user.email) {
      const existingUser = await User.findOne({ email: value.email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'EMAIL_EXISTS',
            message: 'Email already exists'
          }
        });
      }
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      value,
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      data: updatedUser.getProfile(),
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Update profile error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_UPDATE_FAILED',
        message: 'Failed to update profile'
      }
    });
  }
});

/**
 * POST /v1/users/profile/avatar
 * Upload avatar image to S3 and save URL (self only)
 */
router.post('/profile/avatar', authenticateToken, (req, res, next) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: 'File size too large. Maximum size is 50MB.' }
        });
      }
      return res.status(400).json({
        success: false,
        error: { code: 'UPLOAD_ERROR', message: 'File upload error: ' + err.message }
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'No file uploaded. Use field name "avatar".' }
      });
    }

    const mime = req.file.mimetype || 'application/octet-stream';
    if (!mime.startsWith('image/')) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_FILE_TYPE', message: 'Only image files are allowed.' }
      });
    }

    const ext = extFromMime(mime);
    const userId = req.user._id.toString();
    const hash = crypto.createHash('sha256').update(userId + Date.now().toString()).digest('hex').slice(0, 16);
    const key = `avatars/${userId}/${hash}.${ext}`;

    const url = await uploadBufferToS3(req.file.buffer, key, mime);

    // Save the URL as-is; ensure your bucket/object can be read by clients.
    const updated = await User.findByIdAndUpdate(userId, { avatarUrl: url }, { new: true });

    return res.json({
      success: true,
      data: { avatarUrl: updated.avatarUrl },
      message: 'Avatar updated successfully'
    });
  } catch (error) {
    console.error('Upload avatar error:', { error: error.message, timestamp: new Date().toISOString() });
    return res.status(500).json({
      success: false,
      error: { code: 'AVATAR_UPLOAD_FAILED', message: 'Failed to upload avatar' }
    });
  }
});

/**
 * GET /v1/users
 * List all users (admin only)
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get users with pagination
    const users = await User.find({})
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Get total count
    const total = await User.countDocuments({});

    res.json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      },
      message: 'Users retrieved successfully'
    });

  } catch (error) {
    console.error('Get users error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'USERS_RETRIEVAL_FAILED',
        message: 'Failed to retrieve users'
      }
    });
  }
});

/**
 * GET /v1/users/search
 * Search clients by name, email, or phone (admin only)
 */
router.get('/search', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { q: search, page = 1, limit = 20 } = req.query;
    
    // Build filter using shared helper from botToolHandlers
    const { buildClientSearchFilter, formatClientForResponse } = require('../services/botToolHandlers');
    const filter = buildClientSearchFilter(search);

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const validLimit = Math.min(Math.max(1, parseInt(limit)), 100); // Clamp between 1 and 100

    // Query clients
    const clients = await User.find(filter)
      .select('firstName lastName email phone avatarUrl role entity_status createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(validLimit);

    // Get total count for pagination
    const total = await User.countDocuments(filter);
    const totalPages = Math.ceil(total / validLimit);

    // Format clients using shared helper
    const formattedClients = clients.map(formatClientForResponse);

    res.json({
      success: true,
      data: formattedClients,
      pagination: {
        page: parseInt(page),
        limit: validLimit,
        total,
        totalPages
      },
      message: search 
        ? `Found ${total} client${total !== 1 ? 's' : ''} matching "${search}".`
        : `Found ${total} client${total !== 1 ? 's' : ''}.`
    });

  } catch (error) {
    console.error('Search clients error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'CLIENT_SEARCH_FAILED',
        message: 'Failed to search clients'
      }
    });
  }
});

/**
 * GET /v1/users/:id/profile
 * Get user profile by ID (admin only)
 */
router.get('/:id/profile', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Getting user profile for ID:', id);

    const user = await User.findById(id);
    console.log('User found:', user ? 'Yes' : 'No');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    console.log('Raw user data from DB:', {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      entity_status: user.entity_status,
      socialMedia: user.socialMedia,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });

    const profileData = user.getProfile();
    console.log('Profile data after getProfile():', profileData);

    // Disable caching for profile responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json({
      success: true,
      data: profileData,
      message: 'User profile retrieved successfully'
    });

  } catch (error) {
    console.error('Get user profile error:', {
      error: error.message,
      userId: req.params.id,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_RETRIEVAL_FAILED',
        message: 'Failed to retrieve user profile'
      }
    });
  }
});

/**
 * GET /v1/users/:id
 * Get specific user by ID (admin only or own profile)
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Check if user is requesting their own profile or is admin
    if (userId !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied'
        }
      });
    }

    const user = await User.findById(userId).select('-password -resetPasswordToken -resetPasswordExpires');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    res.json({
      success: true,
      data: user,
      message: 'User retrieved successfully'
    });

  } catch (error) {
    console.error('Get user error:', {
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'USER_RETRIEVAL_FAILED',
        message: 'Failed to retrieve user'
      }
    });
  }
});

/**
 * PUT /v1/users/:id/status
 * Update user entity status (admin only)
 */
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate input
    const { error, value } = updateEntityStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    // Find user by ID
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Update entity status
    user.entity_status = value.entity_status;
    await user.save();

    res.json({
      success: true,
      data: {
        user: user.getProfile()
      },
      message: 'User status updated successfully'
    });

  } catch (error) {
    console.error('Update user status error:', {
      error: error.message,
      userId: req.params.id,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_UPDATE_FAILED',
        message: 'Failed to update user status'
      }
    });
  }
});

/**
 * PUT /v1/users/:id/role
 * Update user role (admin only)
 */
router.put('/:id/role', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate input
    const { error, value } = updateRoleSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    // Find user by ID
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Update role
    user.role = value.role;
    await user.save();

    res.json({
      success: true,
      data: {
        user: user.getProfile()
      },
      message: 'User role updated successfully'
    });

  } catch (error) {
    console.error('Update user role error:', {
      error: error.message,
      userId: req.params.id,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'ROLE_UPDATE_FAILED',
        message: 'Failed to update user role'
      }
    });
  }
});

/**
 * PUT /v1/users/:id/visibility
 * @description Update user visibility status (admin only)
 */
router.put('/:id/visibility', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate input
    const { error, value } = updateVisibilityStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    // Find user by ID
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Update visibility status
    user.visibilityStatus = value.visibilityStatus;
    await user.save();

    res.json({
      success: true,
      data: {
        user: user.getProfile()
      },
      message: 'User visibility status updated successfully'
    });

  } catch (error) {
    console.error('Update user visibility status error:', {
      error: error.message,
      userId: req.params.id,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'VISIBILITY_UPDATE_FAILED',
        message: 'Failed to update user visibility status'
      }
    });
  }
});

/**
 * PUT /v1/users/:id/tier
 * @description Update user tier (admin only)
 */
router.put('/:id/tier', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate input
    const { error, value } = updateUserTierSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message
        }
      });
    }

    // Find user by ID
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Update user tier
    user.userTier = value.userTier;
    await user.save();

    res.json({
      success: true,
      data: {
        user: user.getProfile()
      },
      message: 'User tier updated successfully'
    });

  } catch (error) {
    console.error('Update user tier error:', {
      error: error.message,
      userId: req.params.id,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'TIER_UPDATE_FAILED',
        message: 'Failed to update user tier'
      }
    });
  }
});

/**
 * POST /v1/users/push-token
 * Register device push token for notifications
 */
router.post('/push-token', authenticateToken, async (req, res) => {
  // Add logging at the very start to catch all requests
  console.log(`[UsersRoute] 🔔 Push token registration request received:`, {
    user_id: req.user._id?.toString(),
    platform: req.body?.platform,
    has_token: !!req.body?.token,
    token_preview: req.body?.token ? req.body.token.substring(0, 20) + '...' : 'none',
    user_agent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });

  try {
    const { token, platform } = req.body;

    if (!token || !platform) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Token and platform are required'
        }
      });
    }

    if (!['ios', 'android'].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Platform must be "ios" or "android"'
        }
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Check if token already exists
    // Check for exact token match
    const existingTokenIndex = user.push_tokens.findIndex(t => t.token === token);

    if (existingTokenIndex >= 0) {
      // Update existing token
      console.log(`[UsersRoute] Updating existing push token for user ${req.user._id}:`, {
        token_preview: token.substring(0, 20) + '...',
        platform
      });
      user.push_tokens[existingTokenIndex].last_used_at = new Date();
      user.push_tokens[existingTokenIndex].platform = platform;
    } else {
      // Check for duplicate tokens (same token string but different object)
      // This can happen if token was registered multiple times
      const duplicateIndex = user.push_tokens.findIndex(t => 
        t.token && t.token.toString() === token.toString()
      );
      
      if (duplicateIndex >= 0) {
        // Found duplicate - update existing instead of adding new
        console.log(`[UsersRoute] Found duplicate push token, updating instead of adding:`, {
          token_preview: token.substring(0, 20) + '...',
          platform,
          existing_index: duplicateIndex
        });
        user.push_tokens[duplicateIndex].last_used_at = new Date();
        user.push_tokens[duplicateIndex].platform = platform;
      } else {
        // Add new token
        console.log(`[UsersRoute] Adding new push token for user ${req.user._id}:`, {
          token_preview: token.substring(0, 20) + '...',
          platform,
          total_tokens_before: user.push_tokens.length
        });
        user.push_tokens.push({
          token,
          platform,
          registered_at: new Date(),
          last_used_at: new Date()
        });
      }
    }

    // Clean up any duplicate tokens (defensive measure)
    const uniqueTokens = [];
    const seenTokens = new Set();
    for (const tokenData of user.push_tokens) {
      const tokenStr = tokenData.token?.toString();
      if (tokenStr && !seenTokens.has(tokenStr)) {
        seenTokens.add(tokenStr);
        uniqueTokens.push(tokenData);
      } else if (tokenStr) {
        console.warn(`[UsersRoute] Removing duplicate push token during registration:`, {
          token_preview: tokenStr.substring(0, 20) + '...',
          user_id: req.user._id
        });
      }
    }
    
    if (uniqueTokens.length !== user.push_tokens.length) {
      console.log(`[UsersRoute] Cleaned up duplicate tokens:`, {
        before: user.push_tokens.length,
        after: uniqueTokens.length,
        removed: user.push_tokens.length - uniqueTokens.length
      });
      user.push_tokens = uniqueTokens;
    }

    await user.save();
    
    console.log(`[UsersRoute] Push token registration complete:`, {
      user_id: req.user._id,
      total_tokens: user.push_tokens.length,
      token_preview: token.substring(0, 20) + '...'
    });

    res.json({
      success: true,
      message: 'Push token registered successfully'
    });
  } catch (error) {
    console.error('Register push token error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'REGISTER_TOKEN_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * DELETE /v1/users/push-token
 * Remove push token (e.g., on logout)
 */
router.delete('/push-token', authenticateToken, async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Token is required'
        }
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    // Remove token
    user.push_tokens = user.push_tokens.filter(t => t.token !== token);
    await user.save();

    res.json({
      success: true,
      message: 'Push token removed successfully'
    });
  } catch (error) {
    console.error('Remove push token error:', {
      user_id: req.user._id,
      error: error.message,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'REMOVE_TOKEN_FAILED',
        message: error.message
      }
    });
  }
});

module.exports = router;

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * User schema for authentication and profile management
 * @description Defines user data structure with authentication fields
 */
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  dateOfBirth: {
    type: Date,
    required: false,
    validate: {
      validator: function(value) {
        if (!value) return true; // Allow empty values for existing users
        return value < new Date(); // DOB must be in the past
      },
      message: 'Date of birth must be in the past'
    }
  },
  industry: {
    type: String,
    required: false,
    enum: ['fintech', 'cyber', 'social', 'sales', 'e-commerce', 'AI', 'energy', 'crypto', 'banking', 'real-estate', 'tech', 'other'],
    index: true
  },
  industryCustom: {
    type: String,
    required: false,
    trim: true
  },
  role: {
    type: String,
    enum: ['admin', 'client', 'runner'],
    default: 'client'
  },
  entity_status: {
    type: String,
    enum: ['live', 'suspended', 'deleted', 'pendingApproval', 'registrationDeclined'],
    default: 'pendingApproval'
  },
  visibilityStatus: {
    type: String,
    enum: ['public', 'private'],
    default: 'public',
    index: true
  },
  userTier: {
    type: String,
    enum: ['member', 'vip', 'elite', 'silver', 'gold', 'platinum'],
    default: function() {
      // Default all non-admins to silver; admins to platinum
      return this.role === 'admin' ? 'platinum' : 'silver';
    },
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  resetPasswordToken: {
    type: String
  },
  resetPasswordCode: {
    type: String,
    index: true
  },
  resetPasswordExpires: {
    type: Date
  },
  socialMedia: {
    facebook: {
      type: String,
      trim: true
    },
    linkedin: {
      type: String,
      trim: true
    },
    x: {
      type: String,
      trim: true
    },
    instagram: {
      type: String,
      trim: true
    }
  },
  termsAcceptedAt: {
    type: Date
  },
  privacyConsentAt: {
    type: Date
  },
  avatarUrl: {
    type: String,
    trim: true
  },
  /** Pixel width of avatar image (optional; filled on upload/enrich). */
  avatar_width: { type: Number, min: 0 },
  /** Pixel height of avatar image (optional). */
  avatar_height: { type: Number, min: 0 },
  avatar_byte_size: { type: Number, min: 0 },
  avatar_thumb_url: { type: String, trim: true },
  // Email Verification Fields
  emailVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  emailVerificationToken: {
    type: String,
    index: true
  },
  emailVerificationCode: {
    type: String,
    index: true
  },
  emailVerificationExpires: {
    type: Date,
    index: true
  },
  emailVerificationSentAt: {
    type: Date
  },
  emailVerifiedAt: {
    type: Date
  },
  
  // Saved Payment Methods (Phase 2: Card Tokenization)
  saved_payment_methods: [{
    token_id: {
      type: String,
      required: true
    },
    card_brand: String,
    card_last_four: String,
    expiry_month: String,
    expiry_year: String,
    is_default: {
      type: Boolean,
      default: false
    },
    nickname: String,
    created_at: {
      type: Date,
      default: Date.now
    },
    last_used_at: Date
  }],
  
  default_payment_method: String,
  
  // Membership Status (Phase 3: Recurring Billing)
  membership_status: {
    type: String,
    enum: ['free', 'active', 'cancelled', 'expired', 'suspended'],
    default: 'free',
    index: true
  },
  membership_tier: {
    type: String,
    enum: ['basic', 'premium', 'vip', 'elite'],
    index: true
  },
  membership_started_at: {
    type: Date
  },
  membership_expires_at: {
    type: Date
  },
  active_subscription_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription'
  },
  
  // Push Notification Tokens
  push_tokens: [{
    token: {
      type: String,
      required: true
    },
    platform: {
      type: String,
      enum: ['ios', 'android'],
      required: true
    },
    device_id: String,
    registered_at: {
      type: Date,
      default: Date.now
    },
    last_used_at: Date
  }]
}, {
  timestamps: true
});

/**
 * Hash password before saving
 * @description Pre-save middleware to hash password using bcrypt
 */
userSchema.pre('save', async function(next) {
  try {
    // Only hash password if it's been modified
    if (!this.isModified('password')) return next();
    
    // Hash password with configured rounds
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Sanitize push_tokens before saving
 * @description Remove any invalid push token entries that are missing required fields
 *              to prevent user validation errors from breaking login and other flows.
 *              This runs BEFORE validation, so it prevents validation errors.
 */
userSchema.pre('validate', function(next) {
  try {
    if (Array.isArray(this.push_tokens)) {
      const beforeCount = this.push_tokens.length;
      this.push_tokens = this.push_tokens.filter(tokenEntry => {
        // Remove null/undefined entries
        if (!tokenEntry || typeof tokenEntry !== 'object') return false;
        
        // Check token field - must be non-empty string
        const tokenStr = tokenEntry.token;
        if (!tokenStr || typeof tokenStr !== 'string' || tokenStr.trim().length === 0) {
          return false;
        }
        
        // Check platform field - must be non-empty string
        const platformStr = tokenEntry.platform;
        if (!platformStr || typeof platformStr !== 'string' || platformStr.trim().length === 0) {
          return false;
        }
        
        return true;
      });

      const afterCount = this.push_tokens.length;
      if (beforeCount !== afterCount) {
        console.warn('[UserModel] Cleaned invalid push_tokens before validation:', {
          user_id: this._id?.toString?.(),
          before: beforeCount,
          after: afterCount,
          removed: beforeCount - afterCount,
        });
      }
    }

    next();
  } catch (error) {
    console.error('[UserModel] Error in push_tokens sanitizer:', error);
    next(error);
  }
});

/**
 * Compare password with hashed password
 * @param {string} candidatePassword - Password to compare
 * @returns {Promise<boolean>} True if password matches
 */
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

/**
 * Get user profile without sensitive data
 * @returns {Object} User profile without password
 */
userSchema.methods.getProfile = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordCode;
  delete userObject.resetPasswordExpires;
  return userObject;
};

module.exports = mongoose.model('User', userSchema);

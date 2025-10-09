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
    enum: ['fintech', 'cyber', 'social', 'sales', 'e-commerce', 'AI', 'energy', 'crypto', 'banking', 'real-estate', 'tech'],
    index: true
  },
  role: {
    type: String,
    enum: ['admin', 'client', 'runner'],
    default: 'client'
  },
  entity_status: {
    type: String,
    enum: ['live', 'suspended', 'deleted', 'pendingApproval'],
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
    enum: ['member', 'vip', 'elite'],
    default: 'member',
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
  emailVerificationExpires: {
    type: Date,
    index: true
  },
  emailVerificationSentAt: {
    type: Date
  },
  emailVerifiedAt: {
    type: Date
  }
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
  delete userObject.resetPasswordExpires;
  return userObject;
};

module.exports = mongoose.model('User', userSchema);

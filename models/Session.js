const mongoose = require('mongoose');

/**
 * Session schema for managing user sessions
 * @description Defines session data structure for JWT token management
 */
const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // MongoDB TTL index
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastAccessedAt: {
    type: Date,
    default: Date.now
  },
  userAgent: {
    type: String
  },
  ipAddress: {
    type: String
  }
}, {
  timestamps: true
});

/**
 * Update last accessed time
 * @description Updates the lastAccessedAt timestamp
 */
sessionSchema.methods.updateLastAccessed = function() {
  this.lastAccessedAt = new Date();
  return this.save();
};

/**
 * Deactivate session
 * @description Marks session as inactive
 */
sessionSchema.methods.deactivate = function() {
  this.isActive = false;
  return this.save();
};

/**
 * Check if session is valid
 * @returns {boolean} True if session is active and not expired
 */
sessionSchema.methods.isValid = function() {
  return this.isActive && this.expiresAt > new Date();
};

module.exports = mongoose.model('Session', sessionSchema);

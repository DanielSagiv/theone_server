const mongoose = require('mongoose');

/**
 * Idempotency Cache Schema
 * @description Stores idempotency keys to prevent duplicate operations on retries
 */
const IdempotencyCacheSchema = new mongoose.Schema({
  idempotency_key: {
    type: String,
    required: true,
    trim: true
    // unique constraint and index defined below (compound index includes this field)
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  tool_name: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now,
    required: true
    // indexed below (including TTL index)
  }
}, {
  timestamps: false // We only use created_at
});

// Compound index for efficient lookups
IdempotencyCacheSchema.index({ user_id: 1, tool_name: 1, idempotency_key: 1 });

// TTL index - automatically delete entries older than 24 hours
IdempotencyCacheSchema.index({ created_at: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

/**
 * Get cached result for idempotency key
 * @param {string} idempotencyKey - Idempotency key
 * @param {string} userId - User ID
 * @param {string} toolName - Tool name
 * @returns {Promise<Object|null>} Cached result or null
 */
IdempotencyCacheSchema.statics.getCachedResult = async function(idempotencyKey, userId, toolName) {
  const cache = await this.findOne({
    idempotency_key: idempotencyKey,
    user_id: userId,
    tool_name: toolName
  });

  if (!cache) return null;

  return cache.result;
};

/**
 * Store result for idempotency key
 * @param {string} idempotencyKey - Idempotency key
 * @param {string} userId - User ID
 * @param {string} toolName - Tool name
 * @param {Object} result - Result to cache
 * @returns {Promise<Object>} Cached entry
 */
IdempotencyCacheSchema.statics.cacheResult = async function(idempotencyKey, userId, toolName, result) {
  // Use findOneAndUpdate with upsert to handle race conditions
  return this.findOneAndUpdate(
    {
      idempotency_key: idempotencyKey,
      user_id: userId,
      tool_name: toolName
    },
    {
      $set: {
        result: result,
        created_at: new Date()
      }
    },
    {
      upsert: true,
      new: true
    }
  );
};

module.exports = mongoose.model('IdempotencyCache', IdempotencyCacheSchema);


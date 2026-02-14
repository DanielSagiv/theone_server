const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Bot Audit Log Schema //
 * @description Tracks all bot tool calls for audit trails and compliance
 */
const BotAuditLogSchema = new mongoose.Schema({
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
  parameters_hash: {
    type: String,
    trim: true
  },
  result_hash: {
    type: String,
    trim: true
  },
  correlation_id: {
    type: String,
    trim: true
    // indexed below
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
    // indexed below (including TTL index)
  },
  success: {
    type: Boolean,
    required: true,
    index: true
  },
  error_code: {
    type: String,
    trim: true,
    index: true
  },
  error_category: {
    type: String,
    enum: ['validation', 'permission', 'service', 'network', 'conversation'],
    trim: true
  },
  execution_time_ms: {
    type: Number,
    min: 0
  },
  user_role: {
    type: String,
    enum: ['admin', 'client', 'runner'],
    index: true
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Compound indexes for efficient querying
BotAuditLogSchema.index({ user_id: 1, timestamp: -1 });
BotAuditLogSchema.index({ tool_name: 1, timestamp: -1 });
BotAuditLogSchema.index({ correlation_id: 1 });
BotAuditLogSchema.index({ success: 1, timestamp: -1 });
BotAuditLogSchema.index({ error_code: 1, timestamp: -1 });

// TTL index - automatically delete logs older than 1 year
BotAuditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

/**
 * Create hash of parameters for privacy
 * @param {Object} params - Parameters object
 * @returns {string} SHA256 hash
 */
BotAuditLogSchema.statics.hashParameters = function(params) {
  const str = JSON.stringify(params);
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Create hash of result for verification
 * @param {Object} result - Result object
 * @returns {string} SHA256 hash
 */
BotAuditLogSchema.statics.hashResult = function(result) {
  const str = JSON.stringify(result);
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Get audit logs for a user
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Audit logs
 */
BotAuditLogSchema.statics.getUserAuditLogs = async function(userId, options = {}) {
  const {
    startDate,
    endDate,
    toolName,
    success,
    limit = 100,
    offset = 0
  } = options;

  const query = { user_id: new mongoose.Types.ObjectId(userId) };

  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = startDate;
    if (endDate) query.timestamp.$lte = endDate;
  }

  if (toolName) query.tool_name = toolName;
  if (success !== undefined) query.success = success;

  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .skip(offset)
    .select('-parameters_hash -result_hash'); // Exclude hashes from default queries
};

module.exports = mongoose.model('BotAuditLog', BotAuditLogSchema);


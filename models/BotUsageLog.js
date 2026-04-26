const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Bot Usage Log Schema
 * @description Tracks OpenAI API usage and costs per user for cost management and rate limiting
 */
const BotUsageLogSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
    // indexed below (including TTL index)
  },
  model: {
    type: String,
    required: true,
    enum: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  tokens_input: {
    type: Number,
    required: true,
    min: 0
  },
  tokens_output: {
    type: Number,
    required: true,
    min: 0
  },
  tokens_total: {
    type: Number,
    required: true,
    min: 0
  },
  cost_usd: {
    type: Number,
    required: true,
    min: 0
  },
  correlation_id: {
    type: String,
    trim: true
    // indexed below
  },
  tool_name: {
    type: String,
    index: true,
    trim: true
  },
  request_type: {
    type: String,
    enum: ['chat_completion', 'function_calling'],
    default: 'chat_completion'
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

// Compound indexes for efficient querying
BotUsageLogSchema.index({ user_id: 1, timestamp: -1 });
BotUsageLogSchema.index({ user_id: 1, timestamp: 1 }); // For date range queries
BotUsageLogSchema.index({ correlation_id: 1 });
BotUsageLogSchema.index({ tool_name: 1, timestamp: -1 });

// TTL index - automatically delete logs older than 90 days
BotUsageLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

/**
 * Calculate cost based on model and token usage
 * @param {string} model - OpenAI model name
 * @param {number} tokensInput - Input tokens
 * @param {number} tokensOutput - Output tokens
 * @returns {number} Cost in USD
 */
BotUsageLogSchema.statics.calculateCost = function(model, tokensInput, tokensOutput) {
  // Pricing per 1M tokens (as of 2024)
  const pricing = {
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
  };

  const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
  const inputCost = (tokensInput / 1_000_000) * modelPricing.input;
  const outputCost = (tokensOutput / 1_000_000) * modelPricing.output;
  
  return inputCost + outputCost;
};

/**
 * Get total cost for a user in a date range
 * @param {string} userId - User ID
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<number>} Total cost in USD
 */
BotUsageLogSchema.statics.getUserCost = async function(userId, startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        user_id: new mongoose.Types.ObjectId(userId),
        timestamp: {
          $gte: startDate,
          $lte: endDate
        }
      }
    },
    {
      $group: {
        _id: null,
        total_cost: { $sum: '$cost_usd' }
      }
    }
  ]);

  return result.length > 0 ? result[0].total_cost : 0;
};

/**
 * Get total system cost in a date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<number>} Total cost in USD
 */
BotUsageLogSchema.statics.getSystemCost = async function(startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        timestamp: {
          $gte: startDate,
          $lte: endDate
        }
      }
    },
    {
      $group: {
        _id: null,
        total_cost: { $sum: '$cost_usd' }
      }
    }
  ]);

  return result.length > 0 ? result[0].total_cost : 0;
};

module.exports = mongoose.model('BotUsageLog', BotUsageLogSchema);


const mongoose = require('mongoose');

/**
 * Bot conversation schema
 * @description Stores chronological chat history per user for the BOT sandbox
 */
const BotMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['system', 'user', 'assistant', 'tool'],
    required: true
  },
  content: {
    type: String,
    required: function() {
      // Content is required for all roles EXCEPT assistant messages with tool_calls
      // For assistant messages with tool_calls, content is optional (can be empty string)
      if (this.role === 'assistant' && this.tool_calls && this.tool_calls.length > 0) {
        return false; // Not required for assistant messages with tool_calls
      }
      // For all other cases, content is required
      return true;
    },
    trim: true
  },
  // OpenAI function calling support
  tool_calls: {
    type: [{
      id: String,
      type: { type: String, default: 'function' },
      function: {
        name: String,
        arguments: String
      }
    }],
    default: undefined
  },
  tool_call_id: {
    type: String,
    default: undefined
  },
  name: {
    type: String,
    default: undefined
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false, strict: false }); // strict: false allows additional fields for flexibility

const BotConversationSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  messages: {
    type: [BotMessageSchema],
    default: []
  },
  // Enhanced context tracking fields
  user_tz: {
    type: String,
    trim: true,
    description: "User's timezone in IANA format (e.g., 'America/New_York')"
  },
  locale: {
    type: String,
    trim: true,
    default: 'en-US',
    description: "User's locale for date/number formatting (e.g., 'en-US')"
  },
  active_coe_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'COE',
    index: true,
    description: 'Currently active COE in conversation (for references like "the COE we just created")'
  },
  last_prompt_category: {
    type: String,
    trim: true,
    description: 'Category of last user prompt (e.g., "coe_creation", "event_query") for analytics'
  },
  // Preference collection state
  collecting_preferences: {
    type: Boolean,
    default: false,
    description: 'Whether bot is currently collecting preferences from user'
  },
  preference_data: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    description: 'Stored preference data (dates, budget, location_preferences, party_size, notes)'
  },
  // Event log for traceability
  event_log: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    action: {
      type: String,
      trim: true,
      description: 'Action type (e.g., "tool_called", "preference_collected", "coe_created")'
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      description: 'Additional details about the event'
    }
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

/**
 * Ensure we always update the timestamp when messages change
 */
BotConversationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('BotConversation', BotConversationSchema);


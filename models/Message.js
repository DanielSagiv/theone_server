const mongoose = require('mongoose');

/**
 * Message schema for COE-scoped messaging
 * @description Stores messages in COE conversation threads
 */
const messageSchema = new mongoose.Schema({
  coe_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'COE',
    required: true,
    index: true
  },
  sender_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sender_role: {
    type: String,
    enum: ['admin', 'client', 'runner'],
    required: true
  },
  sender_name: {
    type: String,
    trim: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000,
    trim: true
  },
  read_by: [{
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    read_at: {
      type: Date,
      default: Date.now
    }
  }],
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
messageSchema.index({ coe_id: 1, created_at: -1 });
messageSchema.index({ sender_id: 1, created_at: -1 });
messageSchema.index({ 'read_by.user_id': 1 });

module.exports = mongoose.model('Message', messageSchema);


const mongoose = require('mongoose');

/**
 * Notification schema for push notifications
 * @description Stores all push notifications for users
 */
const notificationSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: [
      // COE Status Notifications
      'coe_sent',
      'coe_requested',
      'coe_approved',
      'coe_accepted',
      'coe_rejected',
      'coe_paid',
      'coe_completed',
      'coe_cancelled',
      'coe_expired',
      // COE revision flow
      'coe_revision_submitted',
      'coe_revision_reverted',
      // Messaging Notifications
      'coe_message',
      // Payment Notifications
      'payment_received',
      'payment_failed',
      // Runner Notifications
      'runner_assigned',
      'runner_updated',
      // Seat / section availability Notifications
      'seat_section_unavailable',
      // Multi-proposal group (client)
      'proposal_group_ready',
      // Admin notifications
      'admin_new_client_signup'
    ],
    required: true,
    index: true
  },
  title: {
    type: String,
    required: true
  },
  body: {
    type: String,
    required: true
  },
  data: {
    coe_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'COE'
    },
    message_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    payment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment'
    },
    sender_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    action: String,
    action_url: String,
    proposal_group_id: String,
    proposal_count: Number
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  sent: {
    type: Boolean,
    default: false
  },
  sent_at: Date,
  read_at: Date
}, {
  timestamps: true
});

// Indexes for efficient queries
notificationSchema.index({ user_id: 1, read: 1 });
notificationSchema.index({ user_id: 1, createdAt: -1 }); // Use createdAt (camelCase) from timestamps
notificationSchema.index({ type: 1, createdAt: -1 }); // Use createdAt (camelCase) from timestamps

// Unique index to prevent duplicate notifications for the same message
// Sparse: only applies when message_id exists (allows other notification types)
notificationSchema.index(
  { user_id: 1, type: 1, 'data.message_id': 1 },
  { 
    unique: true, 
    sparse: true,
    name: 'unique_message_notification'
  }
);

module.exports = mongoose.model('Notification', notificationSchema);




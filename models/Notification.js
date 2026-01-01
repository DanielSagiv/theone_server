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
      'coe_approved',
      'coe_accepted',
      'coe_rejected',
      'coe_paid',
      'coe_completed',
      'coe_cancelled',
      'coe_expired',
      // Messaging Notifications
      'coe_message',
      // Payment Notifications
      'payment_received',
      'payment_failed',
      // Runner Notifications
      'runner_assigned',
      'runner_updated'
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
    action_url: String
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

module.exports = mongoose.model('Notification', notificationSchema);




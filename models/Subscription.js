const mongoose = require('mongoose');

/**
 * Subscription schema for recurring membership billing
 * @description Manages automated monthly/yearly subscription payments
 */
const subscriptionSchema = new mongoose.Schema({
  // User Reference
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Subscription Details
  tier: {
    type: String,
    enum: ['basic', 'premium', 'vip', 'elite'],
    required: true,
    index: true
  },
  frequency: {
    type: String,
    enum: ['monthly', 'yearly'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'expired', 'failed'],
    default: 'active',
    index: true
  },
  
  // Pricing
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  
  // Dates
  start_date: {
    type: Date,
    required: true
  },
  current_period_start: {
    type: Date,
    required: true
  },
  current_period_end: {
    type: Date,
    required: true
  },
  next_billing_date: {
    type: Date,
    required: true,
    index: true
  },
  end_date: {
    type: Date
  },
  cancelled_at: {
    type: Date
  },
  
  // Payment Method
  payment_token_id: {
    type: String,
    required: true
  },
  card_last_four: {
    type: String
  },
  card_brand: {
    type: String
  },
  
  // Global Payments
  gp_schedule_id: {
    type: String,
    unique: true,
    sparse: true
  },
  
  // Payment History
  total_payments: {
    type: Number,
    default: 0
  },
  total_amount_paid: {
    type: Number,
    default: 0
  },
  failed_payments: {
    type: Number,
    default: 0
  },
  last_payment_date: {
    type: Date
  },
  last_payment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  last_failure_date: {
    type: Date
  },
  last_failure_reason: {
    type: String
  },
  
  // Cancellation
  cancellation_reason: {
    type: String
  },
  cancelled_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
subscriptionSchema.index({ user_id: 1, status: 1 });
subscriptionSchema.index({ next_billing_date: 1, status: 1 });
subscriptionSchema.index({ gp_schedule_id: 1 }, { unique: true, sparse: true });
subscriptionSchema.index({ tier: 1, status: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);


const mongoose = require('mongoose');

/**
 * Payment schema for payment transaction tracking
 * @description Stores all payment transactions with Global Payments integration
 */
const paymentSchema = new mongoose.Schema({
  // References
  coe_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'COE',
    index: true
  },
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Payment Details
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  payment_type: {
    type: String,
    enum: [
      'deposit',
      'deposit_diff',
      'final_payment',
      'full_payment',
      'full_diff',
      'subscription',
      'refund'
    ],
    required: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'authorized', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Payment Method (display only, no sensitive data)
  card_brand: String,
  card_last_four: String,
  
  // Global Payments Data
  gp_transaction_id: {
    type: String
    // unique sparse index defined below
  },
  gp_authorization_code: String,
  gp_response_code: String,
  gp_response_message: String,
  
  // Tokenization (Phase 2)
  payment_token_id: {
    type: String,
    index: true
  },
  is_token_payment: {
    type: Boolean,
    default: false
  },
  save_payment_method: {
    type: Boolean,
    default: false
  },
  
  // Idempotency
  idempotency_key: {
    type: String
    // unique sparse index defined below
  },
  
  // Metadata
  description: String,
  
  // Failure Info
  failure_code: String,
  failure_message: String,
  failed_at: Date,
  
  // Refund Info
  refund_amount: {
    type: Number,
    default: 0
  },
  refund_reason: String,
  refunded_at: Date,
  refund_transaction_id: String,
  
  // Timestamps
  completed_at: Date
}, {
  timestamps: true
});

// Indexes for queries
paymentSchema.index({ coe_id: 1, status: 1 });
paymentSchema.index({ user_id: 1, created_at: -1 });
paymentSchema.index({ gp_transaction_id: 1 }, { unique: true, sparse: true });
paymentSchema.index({ idempotency_key: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);


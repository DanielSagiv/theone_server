const mongoose = require('mongoose');

/**
 * Payment schema for payment transaction tracking
 * @description Stores all payment transactions (GOAT gateway; legacy field names gp_* hold processor ids)
 */
const paymentSchema = new mongoose.Schema({
  // References
  coe_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'COE',
    index: true
  },
  /** When adhoc charge is scoped to a specific COE event line. */
  event_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    index: true,
    default: null,
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
      'refund',
      'adhoc'
    ],
    required: true
  },
  /** Admin who executed an on-spot (adhoc) charge. */
  created_by_admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    default: null,
  },
  /** Payer identity for adhoc charges (guest vs COE client/participant). */
  adhoc_payer: {
    type: {
      type: String,
      enum: ['client', 'participant', 'guest'],
    },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    display_name: { type: String, trim: true },
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
  },
  adhoc_note: { type: String, trim: true },

  /** Payer scribble + initials captured at on-spot charge time. */
  adhoc_signature: {
    svg: { type: String },
    initials: { type: String, trim: true, maxlength: 8 },
    signed_name: { type: String, trim: true },
    signed_at: { type: Date },
  },

  /** Links on-spot charge to a paid_seat_upgrades entry when charging an upgrade delta. */
  seat_upgrade_id: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true,
  },
  /** Narrows adhoc purpose without changing payment_type (still 'adhoc'). */
  adhoc_kind: {
    type: String,
    enum: ['general', 'upgrade'],
    default: 'general',
  },

  /** How the payment was collected: card (GOAT), admin-recorded cash, or min-spend deduction (no card charge). */
  payment_channel: {
    type: String,
    enum: ['card', 'cash', 'min_spend'],
    default: 'card',
    index: true,
  },
  /** For on-spot charges: portion of base price absorbed by min-spend (no card charge). */
  min_spend_absorbed: { type: Number, min: 0, default: 0 },
  /** For on-spot charges: portion of base price charged to card (fee-exclusive). */
  card_charged_base: { type: Number, min: 0, default: 0 },
  /** Admin who recorded a cash payment (lifecycle or adhoc). */
  recorded_by_admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    default: null,
  },
  /** Optional admin note for cash (receipt ref, drawer ID, etc.). */
  cash_note: { type: String, trim: true, maxlength: 500 },
  /** Hook for future finance/ERP sync. */
  finance_sync_status: {
    type: String,
    enum: ['pending', 'synced', 'skipped'],
    default: 'pending',
    index: true,
  },
  finance_external_id: { type: String, trim: true, default: null },
  
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

  /**
   * How GOAT undid an adhoc card charge: void, refund, or adjust.
   * Set only after a successful void/reversal.
   */
  goat_undo_type: {
    type: String,
    enum: ['void', 'refund', 'adjust'],
  },
  
  // Timestamps
  completed_at: Date
}, {
  timestamps: true
});

// Indexes for queries
paymentSchema.index({ coe_id: 1, status: 1 });
paymentSchema.index({ coe_id: 1, payment_type: 1 });
paymentSchema.index({ coe_id: 1, event_id: 1 });
paymentSchema.index({ user_id: 1, created_at: -1 });
paymentSchema.index({ gp_transaction_id: 1 }, { unique: true, sparse: true });
paymentSchema.index({ idempotency_key: 1 }, { unique: true, sparse: true });
paymentSchema.index({ payment_channel: 1, completed_at: -1 });

module.exports = mongoose.model('Payment', paymentSchema);


const mongoose = require('mongoose');

/**
 * COE Item schema for events within a COE
 */
const COEItemSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  coe_id: { type: mongoose.Schema.Types.ObjectId, ref: 'COE' },
  
  // Event Reference
  event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  event_date: { type: Date, required: true },
  event_time: { type: String, required: true },
  
  // Pricing
  base_price: { type: Number, min: 0, default: 0 }, // Changed from required to default 0 for backward compatibility
  quantity: { type: Number, min: 1, default: 1 },
  total_price: { type: Number, min: 0, default: 0 }, // Changed from required to default 0 for backward compatibility
  
  // Runner Assignment (Event-Level)
  runner_assignment: {
    runner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_at: { type: Date },
    status: { 
      type: String, 
      enum: ['assigned', 'confirmed', 'active', 'completed', 'cancelled'],
      default: 'assigned'
    },
    notes: { type: String, trim: true }
  },
  
  // Status
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'pending'
  },

  // Section availability flags (post-payment diagnostics)
  section_unavailable_after_payment: {
    type: Boolean,
    default: false
  },
  
  // Notes
  notes: { type: String, trim: true },
  client_notes: { type: String, trim: true },
  
  // Ordering
  sequence: { type: Number, required: true }, // Order within COE

  /** True when this line is a joint-table share (deposit uses full line amount, see paymentService). */
  is_joint_allocation: { type: Boolean, default: false },
  /** UUID linking all clients sharing the same physical table for this event line. */
  joint_event_group_id: { type: String, trim: true, default: null },
  
  // Timestamps
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { _id: true });

/**
 * COE Schema - Curated One Experience
 * Comprehensive event package combining multiple locations/events
 */
const coeSchema = new mongoose.Schema({
  // Core Information
  name: { 
    type: String, 
    required: true, 
    trim: true,
    maxlength: 200
  },
  description: { 
    type: String, 
    required: true, 
    trim: true,
    maxlength: 1000
  },
  status: { 
    type: String, 
    enum: [
      'draft',
      'request',
      'approved',
      'accepted_not_paid',
      'pending_pay',
      'paid',
      'rejected',
      'expired',
      'completed',
      'cancelled'
    ],
    default: 'draft',
    index: true
  },
  
  // Manual Creation Fields
  created_method: { 
    type: String, 
    enum: ['manual', 'automated'],
    default: 'manual',
    index: true
  },
  created_by: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  creation_notes: { 
    type: String, 
    trim: true,
    maxlength: 500
  },
  
  // Associations
  client_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  admin_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  participants: [{ // Additional clients
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { 
      type: String, 
      enum: ['owner', 'participant'],
      default: 'participant'
    },
    status: { 
      type: String, 
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    added_at: { type: Date, default: Date.now },
    added_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],

  /** Shared id for multi-proposal groups (ProposalGroup doc + member COEs). */
  proposal_group_id: {
    type: String,
    trim: true,
    default: null,
    sparse: true,
    index: true,
  },
  /**
   * Same as joint line item joint_event_group_id; duplicated on root for queries across COEs.
   * Set when this COE includes at least one joint shared-table allocation.
   */
  joint_event_group_id: {
    type: String,
    trim: true,
    default: null,
    sparse: true,
    index: true,
  },
  /** Optional display label for carousel (e.g. Standard / Premium). */
  proposal_label: {
    type: String,
    trim: true,
    maxlength: 80,
    default: null,
  },
  
  // Runner Assignment
  runner_assignment: {
    type: { 
      type: String, 
      enum: ['coe', 'event'],
      default: 'coe'
    },
    runner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_at: { type: Date },
    status: { 
      type: String, 
      enum: ['assigned', 'confirmed', 'active', 'completed', 'cancelled'],
      default: 'assigned'
    },
    notes: { type: String, trim: true }
  },
  
  // Financial
  currency: { 
    type: String, 
    enum: ['USD', 'EUR', 'GBP'],
    default: 'USD'
  },
  subtotal: { type: Number, min: 0, default: 0 },
  taxes: { type: Number, min: 0, default: 0 },
  fees: { type: Number, min: 0, default: 0 },
  /** Aggregated fee lines (gratuity, venue admin, THE1 fee); sales tax is coe.taxes. */
  fee_breakdown: {
    gratuity_total: { type: Number, min: 0, default: 0 },
    venue_admin_fee_total: { type: Number, min: 0, default: 0 },
    sales_tax_total: { type: Number, min: 0, default: 0 },
    the1_fee_total: { type: Number, min: 0, default: 0 }
  },
  total: { type: Number, min: 0, default: 0 },
  deposit_required: { type: Number, min: 0, default: 0 },
  deposit_paid: { type: Number, min: 0, default: 0 },
  
  // THE1 Organization Coverage
  covered_by_t1: {
    amount: { type: Number, min: 0, default: 0 },
    date: { type: Date, default: Date.now },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  
  // Original request snapshot (client `request` COEs and admin `draft` builds from the form/bot)
  original_request_data: {
    // Original user request text/message
    original_request_text: { type: String, trim: true },
    
    // Budget from request
    budget: {
      max: { type: Number, min: 0 },
      currency: { type: String, default: 'USD' }
    },
    
    // Dates from request
    requested_dates: {
      start_date: { type: Date },
      end_date: { type: Date }
    },
    
    // Party size
    party_size: { type: Number, min: 1 },
    
    // Preferences
    seat_preferences: { type: String, trim: true },
    general_preferences: { type: String, trim: true }, // specific_preferences
    city: { type: String, trim: true },
    
    // When this request was made
    requested_at: { type: Date, default: Date.now }
  },

  // Bot / mobile flows may store party_size, budget, budget_range, city, etc. (legacy + active paths).
  // Mixed so existing DB documents serialize to API clients; does not affect COEs without this field.
  preferences: {
    type: mongoose.Schema.Types.Mixed,
    default: undefined
  },
  
  // Detailed pricing breakdown (event-specific pricing)
  pricing_breakdown: {
    events: [{
      event_id: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Event', 
        required: true 
      },
      event_name: { 
        type: String, 
        required: true 
      },
      event_date: { 
        type: Date, 
        required: true 
      },
      tables: [{
        table_id: { 
          type: mongoose.Schema.Types.ObjectId, 
          ref: 'Table', 
          required: true 
        },
        table_code: { 
          type: String, 
          required: true 
        },
        base_price: { 
          type: Number, 
          min: 0, 
          required: true 
        },
        event_price: { 
          type: Number, 
          min: 0, 
          required: true 
        },
        price_difference: { 
          type: Number, 
          default: 0 
        } // event_price - base_price
      }],
      event_subtotal: { 
        type: Number, 
        min: 0, 
        required: true 
      }
    }],
    
    // Overall totals
    subtotal: { type: Number, min: 0, default: 0 },
    taxes: { type: Number, min: 0, default: 0 },
    fees: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 }
  },
  
  // Pricing history for unpaid COEs (admin actions only)
  pricing_history: [{
    changed_at: { 
      type: Date, 
      default: Date.now 
    },
    previous_total: { 
      type: Number, 
      required: true 
    },
    new_total: { 
      type: Number, 
      required: true 
    },
    change_reason: { 
      type: String, 
      required: true 
    },
    changed_by: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User', 
      required: true 
    } // Always admin
  }],
  
  // Payment Information (Full Payment Only)
  payment_status: {
    type: String,
    enum: ['unpaid', 'deposit_paid', 'paid'],
    default: 'unpaid',
    index: true
  },
  // Deposit / final payment tracking (for deposit-then-remaining flow)
  deposit_percent: { type: Number, min: 0, max: 100, default: 20 },
  deposit_paid_at: Date,
  deposit_payment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  final_paid_at: Date,
  final_payment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
  // Full Payment Fields
  payment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  payment_date: Date,
  payment_amount: Number,
  total_paid: {
    type: Number,
    default: 0
  },
  payment_due_date: Date,
  payment_terms: {
    type: String,
    default: '20% deposit required, balance due 48 hours before event'
  },
  // Optional payment time limit for proposals
  payment_deadline_hours: {
    type: Number,
    min: 0,
    default: null
  },
  payment_deadline_at: {
    type: Date
  },

  // Revision flow (post-payment COE revisions)
  revision_state: {
    type: String,
    enum: ['none', 'pending_accept', 'accepted', 'resolved', 'reverted'],
    default: 'none',
    index: true
  },
  revision_deadline_hours: {
    type: Number,
    min: 0,
    default: null
  },
  revision_deadline_at: {
    type: Date
  },
  revision_case: {
    type: String,
    enum: [
      'deposit_increased',
      'deposit_decreased',
      'full_increased',
      'full_decreased'
    ],
    default: null
  },
  // Snapshot representing the "base" state the client already paid for.
  // Stored as a flexible object to avoid coupling to internal breakdown structure.
  revision_base_snapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  revision_due_deposit_diff_amount: {
    type: Number,
    min: 0,
    default: 0
  },
  revision_due_full_diff_amount: {
    type: Number,
    min: 0,
    default: 0
  },
  // Credit owed to the client when the revised experience becomes cheaper.
  client_credit_balance: {
    type: Number,
    min: 0,
    default: 0
  },
  // Deposit % frozen to the last paid deposit percent used for the base snapshot.
  revision_deposit_percent_frozen: {
    type: Number,
    min: 0,
    max: 100,
    default: null
  },
  // Refund Information
  refund_status: {
    type: String,
    enum: ['none', 'partial', 'full'],
    default: 'none',
    index: true
  },
  refund_amount: {
    type: Number,
    default: 0
  },
  refund_date: Date,
  refund_reason: String,
  refund_payment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  refunded_at: Date, // Keep for backward compatibility
  
  // Timeline
  request_date: { type: Date, default: Date.now },
  approved_date: { type: Date },
  pending_pay_date: { type: Date },
  paid_date: { type: Date },
  accepted_date: { type: Date }, // Keep for backward compatibility
  sent_date: { type: Date }, // Keep for backward compatibility (old flow)
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  
  // Content
  events: [COEItemSchema],
  selected_seats: [{ // Selected seats for the COE
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    seat_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    seat_code: { type: String, required: true, trim: true },
    /** Section / tier label from Event.seats (e.g. dance_floor); used by clients to show "selected section". */
    category: { type: String, trim: true },
    capacity: { type: Number, min: 1, required: true },
    base_price: { type: Number, min: 0, required: true },
    event_price: { type: Number, min: 0, required: true },
    available_from: { type: Date, required: true },
    available_until: { type: Date, required: true },
    status: { 
      type: String, 
      enum: ['selected', 'held', 'booked', 'released', 'expired', 'rejected'], 
      default: 'selected' 
    },
    // Merge metadata (for shared tables)
    is_merged_booking: { type: Boolean, default: false },
    primary_coe_id: { type: mongoose.Schema.Types.ObjectId, ref: 'COE' },
    ai_recommendation: { type: String, trim: true, maxlength: 200 },
    recommendation_generated_at: { type: Date },
    recommendation_version: { type: Number, default: 1 },
    /** Joint shared table: full deposit of this row is due at initial deposit (not deposit_percent). */
    is_joint_allocation: { type: Boolean, default: false },
    joint_event_group_id: { type: String, trim: true, default: null },
    /** Admin-set share of table price (0-100) for this client. */
    joint_share_percent: { type: Number, min: 0, max: 100, default: null },
    /** Admin-only per-COE joint pricing override (no cross-client link; see simpleJoint plan). */
    is_simple_joint: { type: Boolean, default: false },
    /** Catalog line price before override; used for strikethrough UI when is_simple_joint. */
    simple_joint_original_price: { type: Number, min: 0, default: null },
    /** Venue catalog price for strikethrough vs THE1 negotiated line (optional). */
    venue_catalog_price: { type: Number, min: 0, default: null },
    /** THE1 platform fee % on negotiated base B (0–100); optional, 0 if unset. */
    the1_fee_percent: { type: Number, min: 0, max: 100, default: null },
  }],
  // Seat upgrade offers (only for draft COEs)
  seat_upgrade_offers: [{
    current_seat_id: { 
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    current_seat_code: { 
      type: String,
      required: true
    },
    event_id: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Event',
      required: true
    },
    event_name: {
      type: String
    },
    current_price: {
      type: Number,
      min: 0
    },
    alternatives: [{
      seat_id: { 
        type: mongoose.Schema.Types.ObjectId,
        required: true
      },
      seat_code: { 
        type: String,
        required: true
      },
      capacity: {
        type: Number,
        min: 1
      },
      event_price: {
        type: Number,
        min: 0,
        required: true
      },
      base_price: {
        type: Number,
        min: 0
      },
      price_delta: {
        type: Number,
        required: true
      },
      price_delta_percentage: {
        type: String
      },
      upgrade_reasons: [{
        type: String
      }],
      sentiment: [{
        text: { type: String },
        type: { 
          type: String, 
          enum: ['A', 'B'] 
        }
      }],
      category: {
        type: String
      },
      section: {
        type: String
      },
      media: [{
        type: { 
          type: String, 
          enum: ['image', 'video'] 
        },
        url: { type: String },
        caption: { type: String }
      }],
      offered_at: { 
        type: Date, 
        default: Date.now 
      },
      status: { 
        type: String, 
        enum: ['pending', 'accepted', 'rejected', 'expired'],
        default: 'pending'
      },
      ai_recommendation: { type: String, trim: true, maxlength: 200 }
    }],
    generated_at: { 
      type: Date, 
      default: Date.now 
    },
    expires_at: { 
      type: Date 
    } // Optional: offers expire when COE moves out of draft
  }],
  policies: { 
    type: String, 
    trim: true,
    maxlength: 2000
  },
  notes: { 
    type: String, 
    trim: true,
    maxlength: 1000
  },
  client_notes: { 
    type: String, 
    trim: true,
    maxlength: 1000
  },
  
  // Metadata
  sharable: { type: Boolean, default: false },
  tags: [{ type: String, trim: true }],
  
  // Timestamps
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, {
  timestamps: true,
  collection: 'coes'
});

// Indexes for performance
coeSchema.index({ client_id: 1, status: 1 });
coeSchema.index({ admin_id: 1, status: 1 });
coeSchema.index({ 'runner_assignment.runner_id': 1, status: 1 });
coeSchema.index({ start_date: 1, end_date: 1 });
coeSchema.index({ created_method: 1, status: 1 });

// Virtual for total events count
coeSchema.virtual('events_count').get(function() {
  return this.events ? this.events.length : 0;
});

// Virtual for total participants count
coeSchema.virtual('participants_count').get(function() {
  return this.participants ? this.participants.length + 1 : 1; // +1 for main client
});

// Pre-save middleware to update timestamps
coeSchema.pre('save', function(next) {
  this.updated_at = new Date();
  
  // Update COE item timestamps
  if (this.events && this.events.length > 0) {
    this.events.forEach(event => {
      event.updated_at = new Date();
    });
  }
  
  next();
});

// Pre-save middleware to calculate totals
coeSchema.pre('save', function(next) {
  // Only recalculate if subtotal is not already set (0 or undefined)
  // This allows explicit pricing to be preserved
  const hasExplicitPricing = this.subtotal !== undefined && this.subtotal !== null && this.subtotal !== 0;
  
  if (!hasExplicitPricing && this.events && this.events.length > 0) {
    // Calculate from events if pricing not explicitly set
    this.subtotal = this.events.reduce((total, event) => {
      return total + (event.total_price || 0);
    }, 0);
    
    this.total = this.subtotal + this.taxes + this.fees;
    
    // Set default deposit if not specified
    if (this.deposit_required === 0 && this.total > 0) {
      this.deposit_required = Math.round(this.total * 0.2); // 20% deposit
    }
  } else if (hasExplicitPricing) {
    // If explicit pricing is set, ensure total is calculated correctly
    this.total = (this.subtotal || 0) + (this.taxes || 0) + (this.fees || 0);
    
    // Set default deposit if not specified
    if (this.deposit_required === 0 && this.total > 0) {
      this.deposit_required = Math.round(this.total * 0.2); // 20% deposit
    }
  }
  
  next();
});

// Static method to find COEs by status
coeSchema.statics.findByStatus = function(status) {
  return this.find({ status: status }).sort({ created_at: -1 });
};

// Static method to find COEs by client
coeSchema.statics.findByClient = function(clientId) {
  return this.find({ client_id: clientId }).sort({ created_at: -1 });
};

// Instance method to add event to COE
coeSchema.methods.addEvent = function(eventData) {
  if (!this.events) {
    this.events = [];
  }
  
  const sequence = this.events.length + 1;
  const event = {
    ...eventData,
    coe_id: this._id,
    sequence: sequence,
    created_at: new Date(),
    updated_at: new Date()
  };
  
  this.events.push(event);
  return this.save();
};

// Instance method to remove event from COE
coeSchema.methods.removeEvent = function(eventId) {
  if (!this.events) {
    return Promise.resolve(this);
  }
  
  this.events = this.events.filter(event => event._id.toString() !== eventId.toString());
  
  // Reorder remaining events
  this.events.forEach((event, index) => {
    event.sequence = index + 1;
  });
  
  return this.save();
};

// Instance method to update COE status
coeSchema.methods.updateStatus = function(newStatus, updatedBy) {
  this.status = newStatus;
  this.updated_at = new Date();
  
  // Set specific date fields based on status
  switch (newStatus) {
    case 'approved':
      this.approved_date = new Date();
      break;
    case 'pending_pay':
      this.pending_pay_date = new Date();
      break;
    case 'paid':
      this.paid_date = new Date();
      this.accepted_date = new Date(); // Backward compatibility
      break;
    case 'sent':
      // Keep for backward compatibility (old flow)
      this.sent_date = new Date();
      break;
    case 'accepted':
      // Keep for backward compatibility (old flow)
      this.accepted_date = new Date();
      break;
  }
  
  return this.save();
};

module.exports = mongoose.model('COE', coeSchema);

# General System Concerns - Production Readiness

**Status**: To Be Determined (TBD)  
**Scope**: System-wide production hardening concerns that affect all parts of the platform, not just the bot

---

## Overview

This document outlines general system concerns that need to be addressed for production readiness. These concerns affect the entire platform (bot, manual UI, API endpoints) and should be implemented at the system level, not just for the bot.

**Note**: Bot-specific production concerns are documented in `bot-architecture-plan.md`. This document focuses on system-wide concerns.

---

## High Impact Gaps

### 1. Seat Holds and Inventory Consistency

**Problem**: Race conditions can cause double-booking when multiple users or processes select the same seat simultaneously.

**Solution**:
- Implement atomic seat holds with TTL (Time To Live)
- Create a dedicated `SeatHold` collection with:
  - `seat_id`: Reference to event seat
  - `coe_id`: Reference to COE (if applicable)
  - `user_id`: Who holds the seat
  - `expires_at`: When the hold expires (default: 15 minutes)
  - `status`: `active`, `converted`, `expired`, `released`
  - `idempotency_key`: Prevent duplicate holds
- Unique compound index: `{ seat_id: 1, status: 1 }` where `status: 'active'`
- TTL index on `expires_at` for automatic cleanup
- Conflict checks before creating holds

**Implementation**:
```javascript
// SeatHold model
const SeatHoldSchema = new mongoose.Schema({
  seat_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  event_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  coe_id: { type: mongoose.Schema.Types.ObjectId, ref: 'COE' },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  expires_at: { type: Date, required: true, index: true },
  status: { 
    type: String, 
    enum: ['active', 'converted', 'expired', 'released'], 
    default: 'active',
    index: true 
  },
  idempotency_key: { type: String, unique: true, sparse: true },
  created_at: { type: Date, default: Date.now }
});

// Unique constraint: only one active hold per seat
SeatHoldSchema.index({ seat_id: 1, status: 1 }, { 
  unique: true, 
  partialFilterExpression: { status: 'active' } 
});

// TTL index for automatic expiration
SeatHoldSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
```

**Flow**:
1. User selects seat → Create `SeatHold` with 15-minute TTL
2. If hold exists → Return error "Seat is currently held"
3. On COE creation → Convert hold to booking, update seat status
4. On timeout → Hold expires, seat becomes available
5. On COE cancellation → Release hold, seat becomes available

---

### 2. Approval Workflow State Machine

**Problem**: Current approval logic is implicit and scattered. Need explicit state machine with guard rules.

**Solution**:
- Define explicit state machine with allowed transitions
- Add `approvals[]` array to COE model
- Add `history[]` array for audit trail
- Include `who_approved`, `when_approved`, `reason` fields

**State Machine**:
```
States: draft → approved → sent → accepted/rejected → completed/cancelled

Transitions:
- draft → approved: Admin approves (if created by client) OR Client approves (if created by admin)
- approved → sent: Admin sends to client
- sent → accepted: Client accepts
- sent → rejected: Client rejects
- accepted → completed: After events occur
- Any → cancelled: Admin or system cancels
```

**Implementation**:
```javascript
// COE approval schema
const ApprovalSchema = new mongoose.Schema({
  approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approved_at: { type: Date, required: true },
  reason: { type: String, trim: true },
  previous_status: { type: String, required: true },
  new_status: { type: String, required: true }
}, { _id: false });

// COE history schema
const COEHistorySchema = new mongoose.Schema({
  action: { type: String, required: true }, // 'created', 'approved', 'sent', etc.
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, default: Date.now },
  changes: { type: mongoose.Schema.Types.Mixed }, // Snapshot of what changed
  reason: { type: String, trim: true }
}, { _id: false });

// Add to COE schema
approvals: [ApprovalSchema],
history: [COEHistorySchema]
```

**Guard Rules**:
- Only admin can approve client-created COEs
- Only client can approve admin-created COEs
- Cannot approve COEs with no events
- Cannot send COEs that aren't approved
- Cannot accept COEs that aren't sent

---

### 3. Pricing Logic and Policy Engine

**Problem**: Taxes at 30% and fees at 0 are placeholders. Need configurable pricing rules.

**Solution**:
- Create `PricingPolicy` model for configurable rules
- Support currency-aware math and rounding rules
- Per-location tax profiles
- Discount rules and application

**Implementation**:
```javascript
// PricingPolicy model
const PricingPolicySchema = new mongoose.Schema({
  name: { type: String, required: true },
  currency: { type: String, required: true, enum: ['USD', 'EUR', 'GBP'] },
  tax_rate: { type: Number, min: 0, max: 100, default: 0 }, // Percentage
  service_fee: { type: Number, min: 0, default: 0 }, // Fixed amount
  service_fee_percentage: { type: Number, min: 0, max: 100, default: 0 },
  rounding_rule: { 
    type: String, 
    enum: ['round', 'floor', 'ceiling', 'nearest_cent'], 
    default: 'nearest_cent' 
  },
  location_specific: [{
    location_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Location' },
    tax_rate: { type: Number }, // Override default
    service_fee: { type: Number }
  }],
  effective_from: { type: Date, default: Date.now },
  effective_until: { type: Date }
}, { timestamps: true });

// Apply to COE
const policy = await PricingPolicy.findOne({ 
  currency: coe.currency,
  effective_from: { $lte: new Date() },
  $or: [
    { effective_until: { $gte: new Date() } },
    { effective_until: null }
  ]
}).sort({ effective_from: -1 });

coe.taxes = applyTaxPolicy(coe.subtotal, policy);
coe.fees = applyFeePolicy(coe.subtotal, policy);
```

---

### 4. RBAC Scope Granularity

**Problem**: Current roles (Admin, Client, Runner) are too coarse. Need field-level permissions.

**Solution**:
- Add permission scopes per tool and per field
- Example: Admin can view client PII, but Runner cannot see payment details
- Implement permission matrix with field-level granularity

**Implementation**:
```javascript
// Permission schema
const PermissionSchema = new mongoose.Schema({
  role: { type: String, enum: ['admin', 'client', 'runner'], required: true },
  resource: { type: String, required: true }, // 'coe', 'event', 'payment'
  actions: [{ type: String }], // ['read', 'write', 'delete']
  fields: {
    allowed: [{ type: String }], // Fields user can access
    denied: [{ type: String }]   // Fields explicitly denied
  },
  conditions: { type: mongoose.Schema.Types.Mixed } // Ownership rules, etc.
});

// Example permissions
{
  role: 'runner',
  resource: 'coe',
  actions: ['read'],
  fields: {
    allowed: ['name', 'events', 'start_date', 'end_date'],
    denied: ['payment_details', 'client_pii', 'pricing_breakdown']
  },
  conditions: { 
    assigned_to_runner: true // Only COEs assigned to this runner
  }
}
```

---

### 5. Payment Totals Snapshot

**Problem**: Pricing can change over time. Need to snapshot totals at quote time and payment time.

**Solution**:
- Store `pricing_snapshot` in COE at creation time
- Store `payment_snapshot` at payment time
- Include currency, exchange rate, discounts applied
- Never recompute historical COEs

**Implementation**:
```javascript
// Pricing snapshot schema
const PricingSnapshotSchema = new mongoose.Schema({
  captured_at: { type: Date, required: true },
  currency: { type: String, required: true },
  exchange_rate: { type: Number }, // If currency conversion occurred
  exchange_rate_source: { type: String }, // 'openexchangerates', 'manual', etc.
  subtotal: { type: Number, required: true },
  taxes: { type: Number, required: true },
  fees: { type: Number, required: true },
  discounts: [{
    type: { type: String }, // 'membership', 'promo', 'manual'
    amount: { type: Number },
    code: { type: String }
  }],
  total: { type: Number, required: true },
  deposit_required: { type: Number, required: true },
  policies_snapshot: { type: mongoose.Schema.Types.Mixed } // Terms at time of quote
}, { _id: false });

// Add to COE schema
pricing_snapshot: PricingSnapshotSchema, // At quote time
payment_snapshot: PricingSnapshotSchema,  // At payment time
```

---

### 6. Payment Compliance and Security

**Problem**: Need to ensure PCI compliance and secure payment handling.

**Solution**:
- Keep card data out of system (use provider tokens only)
- Sign and verify all webhooks
- Record payment attempts with status and receipt identifiers
- Implement refund rules and pro-ration

**Implementation**:
```javascript
// Payment attempt schema
const PaymentAttemptSchema = new mongoose.Schema({
  attempt_number: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled'],
    required: true 
  },
  provider: { type: String, required: true }, // 'global_payments'
  provider_transaction_id: { type: String },
  receipt_identifier: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, required: true },
  error_code: { type: String },
  error_message: { type: String },
  attempted_at: { type: Date, default: Date.now }
}, { _id: false });

// Add to Payment model
attempts: [PaymentAttemptSchema],
webhook_signature: { type: String }, // For verification
webhook_received_at: { type: Date }
```

**Refund Rules**:
- Define cancellation policies in `policies_snapshot`
- Calculate pro-rated refunds based on time before event
- Record refund reason and approval
- Maintain refund audit trail

---

## Data Model Enhancements

### COE Model Additions

```javascript
// Additional fields for COE
version: { type: Number, default: 1 }, // For versioning
approvals: [ApprovalSchema], // Approval history
history: [COEHistorySchema], // Change history
pricing_snapshot: PricingSnapshotSchema, // Quote-time pricing
payment_snapshot: PricingSnapshotSchema, // Payment-time pricing
currency: { type: String, enum: ['USD', 'EUR', 'GBP'], default: 'USD' },
exchange_rate_source: { type: String },
discounts: [{
  type: { type: String },
  amount: { type: Number },
  code: { type: String },
  applied_at: { type: Date }
}],
policies_snapshot: { type: mongoose.Schema.Types.Mixed }, // Terms at creation
computed_totals: { // Stored at write time for stable receipts
  subtotal: { type: Number },
  taxes: { type: Number },
  fees: { type: Number },
  total: { type: Number },
  computed_at: { type: Date }
}
```

### Seat Selection Enhancements

```javascript
// Event seat schema additions
catalog_price: { type: Number }, // Price at catalog time
locked_price: { type: Number }, // Final price when selected
availability_source: { 
  type: String, 
  enum: ['gxn', 'manual', 'calculated'],
  default: 'manual' 
},
last_checked_at: { type: Date }, // Last availability check
hold_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SeatHold' }
```

### Runner Assignment Enhancements

```javascript
// Runner assignment schema additions
constraints: {
  max_concurrent_events: { type: Number, default: 3 },
  preferred_locations: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
  availability_windows: [{
    day_of_week: { type: Number, min: 0, max: 6 },
    start_time: { type: String }, // "09:00"
    end_time: { type: String }     // "17:00"
  }]
},
conflicts: [{
  event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  conflict_type: { type: String, enum: ['time_overlap', 'location_distance', 'capacity'] },
  detected_at: { type: Date }
}],
workload_score: { type: Number, default: 0 }, // Current workload (0-100)
soft_lock_window: { type: Number, default: 30 }, // Minutes to hold assignment
```

---

## Testing Strategy

### Golden Path E2E Scripts

Create end-to-end test scripts for each critical flow:
- COE creation flow (bot + manual)
- Seat hold and booking flow
- Payment processing flow
- Approval workflow
- Refund processing

### Property Tests

Use property-based testing for:
- Pricing calculations (ensure totals always add up correctly)
- Date parsing (handle all edge cases)
- Currency conversions (rounding, precision)

### Chaos Testing

Simulate:
- Service timeouts
- Network partitions
- Database connection failures
- External API failures

Ensure:
- Idempotency works correctly
- Retries don't cause duplicates
- Partial failures are handled gracefully

---

## Implementation Priority

### Phase 1: Critical (Before Production)
1. ✅ Seat holds and inventory consistency
2. ✅ Payment totals snapshot
3. ✅ Approval state machine

### Phase 2: High Priority (Soon After Launch)
4. Pricing policy engine
5. Payment compliance enhancements
6. Field-level RBAC (basic implementation)

### Phase 3: Medium Priority (Iterative)
7. Advanced RBAC scopes
8. Enhanced testing infrastructure
9. Performance optimizations

---

## Related Documents

- **Bot Architecture Plan** (`../architecture/bot-architecture-plan.md`): Bot-specific production concerns (idempotency, error taxonomy, rate limits, observability)
- **COE Specification**: COE data model and workflow
- **Payment Implementation Guide**: Payment system details

---

## Cross-References

### Bot Architecture Plan Dependencies

The bot architecture plan relies on these general system concerns:
- **Seat Holds**: Bot uses the seat hold system when creating COEs (see "Seat Holds and Inventory Consistency" above)
- **Payment Snapshots**: Bot-created COEs use payment snapshot system (see "Payment Totals Snapshot" above)
- **Approval Workflow**: Bot-created COEs follow the approval state machine (see "Approval Workflow State Machine" above)
- **Pricing Policy**: Bot uses pricing policy engine for calculations (see "Pricing Logic and Policy Engine" above)

---

**Last Updated**: 2025-01-XX  
**Status**: Planning Phase


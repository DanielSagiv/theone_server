# COE Status Flow Documentation

## Overview

This document defines the complete status flow for Curated One Experiences (COEs). The status system tracks the lifecycle of a COE from creation through completion, including payment processing and execution phases.

**Last Updated:** January 2025  
**Version:** 2.0 (Simplified - removed `sent` and `accepted` statuses)

---

## Status Enum

```javascript
status: {
  type: String,
  enum: [
    'draft',           // Admin building/editing the COE
    'approved',        // Admin finished, client can see it
    'pending_pay',     // Client accepted terms, payment processing
    'paid',            // Payment received, seats booked, COE confirmed
    'rejected',        // Client rejected the COE
    'expired',         // COE offer expired
    'completed',       // All events executed
    'cancelled'        // COE cancelled at any stage
  ],
  default: 'draft',
  index: true
}
```

---

## Valid Status Transitions

```javascript
const validTransitions = {
  'draft': ['approved', 'cancelled'],
  'approved': ['pending_pay', 'paid', 'rejected', 'expired', 'cancelled'],
  'pending_pay': ['paid', 'rejected', 'expired', 'cancelled'],
  'paid': ['completed', 'cancelled'],
  'rejected': ['draft'],           // Can restart if rejected
  'expired': ['draft'],            // Can restart if expired
  'completed': [],                 // Terminal state
  'cancelled': []                  // Terminal state
};
```

**Note:** The `approved` → `paid` transition is allowed to support direct payment completion. While the typical flow goes through `pending_pay`, payment can complete directly from `approved` status in certain scenarios (e.g., when payment processing completes before the status transition to `pending_pay` occurs, or when using direct payment methods).

---

## Status Flow Diagram

```
                    ┌─────────┐
                    │  DRAFT  │ ← Initial state (admin building)
                    └────┬────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ↓              ↓              ↓
    ┌───────────┐  ┌───────────┐  ┌───────────┐
    │ APPROVED  │  │ CANCELLED │  │ (stays in │
    │           │  │           │  │   draft)  │
    └─────┬─────┘  └───────────┘  └───────────┘
          │                        (terminal)
          │
          ├──────────────────────┬──────────────────────┬──────────────────────┐
          ↓                      ↓                      ↓                      ↓
    ┌──────────────┐      ┌──────────┐        ┌──────────┐        ┌──────────┐
    │ PENDING_PAY  │      │ REJECTED │        │ EXPIRED  │        │CANCELLED │
    │              │      │          │        │          │        │          │
    └──────┬───────┘      └────┬─────┘        └────┬─────┘        └──────────┘
           │                   │                    │                (terminal)
           │                   │                    │
           │                   └────────────────────┴──────────┐
           │                                                   │
           │                                                   ↓
           │                                            ┌──────────┐
           │                                            │  DRAFT   │ ← Can restart
           │                                            │(restart) │
           │                                            └──────────┘
           │
           ├──────────────────────┬──────────────────────┬──────────────────────┐
           ↓                      ↓                      ↓                      ↓
      ┌─────────┐          ┌──────────┐        ┌──────────┐        ┌──────────┐
      │  PAID   │          │ REJECTED │        │ EXPIRED  │        │CANCELLED │
      │         │          │          │        │          │        │          │
      └────┬────┘          └────┬─────┘        └────┬─────┘        └──────────┘
           │                    │                    │                (terminal)
           │                    │                    │
           │                    └────────────────────┴──────────┐
           │                                                   │
           │                                                   ↓
           │                                            ┌──────────┐
           │                                            │  DRAFT   │
           │                                            └──────────┘
           │
           ├────────────────────────────────────────────────┐
           │                                                │
           ↓                                                ↓
    ┌──────────────┐                              ┌──────────┐
    │  COMPLETED   │                              │CANCELLED │
    │              │                              │          │
    └──────────────┘                              └──────────┘
    (terminal)                                    (terminal)
```

---

## Status Details

### 1. DRAFT

**Description:** Initial state when COE is being created and edited by admin.

**Key Characteristics:**
- Admin is building/editing the COE
- Events and seats can be added/removed
- Pricing can be adjusted
- Not yet visible to client (unless client is the creator)

**Who Can Edit:**
- Admin (always)
- Client (if `ENABLE_CLIENT_COE_EDITING` feature flag is enabled)

**Valid Transitions:**
- → `approved` (admin approves the COE)
- → `cancelled` (admin cancels during creation)

**Side Effects:**
- None

---

### 2. APPROVED

**Description:** Admin has finished building the COE and it's ready for client review.

**Key Characteristics:**
- Admin has completed building the COE
- COE is visible to the client
- Client can review and decide to proceed or reject
- Sets `approved_date` timestamp

**Who Can Edit:**
- Admin (can still make changes before client sees it)
- Client (read-only view, can accept/reject)

**Valid Transitions:**
- → `pending_pay` (client accepts and initiates payment)
- → `rejected` (client rejects the COE)
- → `expired` (offer expires due to time limit)
- → `cancelled` (admin cancels after approval)

**Side Effects:**
- Sets `approved_date` to current timestamp

---

### 3. PENDING_PAY

**Description:** Client has accepted the COE terms and payment is being processed.

**Key Characteristics:**
- Client has accepted the COE
- Payment intent has been created
- Payment is in processing state
- Sets `pending_pay_date` timestamp

**Who Can Edit:**
- Admin (can cancel if needed)
- Client (can cancel payment)

**Valid Transitions:**
- → `paid` (payment successfully received)
- → `rejected` (client cancels during payment)
- → `expired` (payment processing expired)
- → `cancelled` (admin or client cancels payment)

**Side Effects:**
- Sets `pending_pay_date` to current timestamp

---

### 4. PAID

**Description:** Payment has been received and confirmed. COE is locked in and ready for execution.

**Key Characteristics:**
- Payment successfully received
- Seats are booked and locked
- COE is confirmed and cannot be easily changed
- Sets `paid_date` and `accepted_date` (for backward compatibility) timestamps
- Seats status changes to `booked`

**Who Can Edit:**
- Admin (limited - mainly for adjustments)
- Client (read-only)

**Valid Transitions:**
- → `completed` (all events have been executed)
- → `cancelled` (refund scenario - requires special handling)

**Side Effects:**
- Sets `paid_date` to current timestamp
- Sets `accepted_date` to current timestamp (for backward compatibility)
- Updates seat statuses to `booked` in both COE `selected_seats` array and Event seats
- Updates `payment_status` field to `'paid'`

---

### 5. REJECTED

**Description:** Client has rejected the COE.

**Key Characteristics:**
- Client explicitly rejected the COE
- Seats are released back to available inventory
- COE can be restarted from draft if needed

**Who Can Edit:**
- Admin (can restart by moving to `draft`)

**Valid Transitions:**
- → `draft` (admin can restart the COE)

**Side Effects:**
- Releases seats (status → `available` or `released`)
- Clears booking references
- Seats become available for other COEs

---

### 6. EXPIRED

**Description:** COE offer has expired (time limit reached).

**Key Characteristics:**
- Offer expired due to time limit
- Seats are released back to available inventory
- COE can be restarted from draft if needed

**Who Can Edit:**
- Admin (can restart by moving to `draft`)

**Valid Transitions:**
- → `draft` (admin can restart the COE)

**Side Effects:**
- Releases seats (status → `available` or `released`)
- Clears booking references
- Seats become available for other COEs

---

### 7. COMPLETED (Terminal)

**Description:** All events in the COE have been executed.

**Key Characteristics:**
- All events have been completed
- Final state - no further transitions
- COE lifecycle is complete

**Who Can Edit:**
- Admin (read-only)

**Valid Transitions:**
- None (terminal state)

**Side Effects:**
- None

---

### 8. CANCELLED (Terminal)

**Description:** COE was cancelled at any stage.

**Key Characteristics:**
- Can be cancelled from any status (except `completed`)
- Seats are released back to available inventory
- Final state - no further transitions
- Refund may be required if payment was made

**Who Can Edit:**
- Admin (read-only)

**Valid Transitions:**
- None (terminal state)

**Side Effects:**
- Releases seats (status → `available` or `released`)
- Clears booking references
- May trigger refund process if status was `paid`

---

## Typical Flows

### Happy Path (Standard Flow)
```
DRAFT → APPROVED → PENDING_PAY → PAID → COMPLETED
```

**Steps:**
1. Admin creates COE → `draft`
2. Admin approves COE → `approved`
3. Client accepts and initiates payment → `pending_pay`
4. Payment received → `paid`
5. Events executed → `completed`

---

### Client Rejects Flow
```
APPROVED → REJECTED → DRAFT (restart)
```

**Steps:**
1. Admin approves COE → `approved`
2. Client rejects → `rejected`
3. Admin can restart → `draft`

---

### Expired Offer Flow
```
APPROVED → EXPIRED → DRAFT (restart)
```

**Steps:**
1. Admin approves COE → `approved`
2. Offer expires → `expired`
3. Admin can restart → `draft`

---

### Payment Cancelled Flow
```
PENDING_PAY → CANCELLED
```

**Steps:**
1. Client initiates payment → `pending_pay`
2. Payment cancelled → `cancelled`

---

### Refund Flow
```
PAID → CANCELLED (with refund)
```

**Steps:**
1. Payment received → `paid`
2. Refund required → `cancelled`
3. Refund processed through payment system

---

## Date Fields

The following date fields are automatically set when transitioning to specific statuses:

| Status | Date Field | Description |
|--------|-----------|-------------|
| `approved` | `approved_date` | When admin approved the COE |
| `pending_pay` | `pending_pay_date` | When client initiated payment |
| `paid` | `paid_date` | When payment was received |
| `paid` | `accepted_date` | When payment was received (backward compatibility) |

**Note:** `accepted_date` is set to the same value as `paid_date` for backward compatibility with existing code that may reference this field.

---

## Payment Status vs COE Status

**Important:** COE has two separate status tracking systems:

### 1. COE Status (`status` field)
Tracks the business workflow and lifecycle of the COE.

### 2. Payment Status (`payment_status` field)
Tracks payment details separately:
- `'unpaid'` - No payment received
- `'paid'` - Full payment received

**Relationship:**
- When COE `status` becomes `paid`, the `payment_status` is also set to `'paid'`
- **Payment Model:** Only full payment is supported - no deposit/final payment split
- COE `status` drives the workflow, while `payment_status` tracks financial state

**Note:** Partial payments (deposit + final payment) are not currently supported. All payments are full payments only.

---

## Seat Status Management

Seat statuses change based on COE status transitions:

### When COE Status = `paid`:
- Seats in `selected_seats` array → status becomes `'booked'`
- Event seats referenced by the COE → status becomes `'booked'`
- Booking references are set

### When COE Status = `rejected`, `expired`, or `cancelled`:
- Seats are released → status becomes `'available'` or `'released'`
- Booking references are cleared
- Seats become available for other COEs

---

## Status Change Permissions Matrix

This matrix defines who can change COE status from one state to another:

| From Status | To Status | Admin | Client | Notes |
|-------------|-----------|:-----:|:------:|-------|
| `draft` | `approved` | ✅ | ❌ | Admin approves the COE |
| `draft` | `cancelled` | ✅ | ✅ | Both can cancel during creation (if client is creator and editing enabled) |
| `approved` | `pending_pay` | ❌ | ✅ | Client accepts and initiates payment |
| `approved` | `rejected` | ❌ | ✅ | Client rejects the COE |
| `approved` | `expired` | ✅ | ❌ | Admin or system sets expired |
| `approved` | `cancelled` | ✅ | ❌ | Admin cancels |
| `pending_pay` | `paid` | ❌ | ❌ | Automatic (payment service) |
| `pending_pay` | `rejected` | ❌ | ✅ | Client cancels payment |
| `pending_pay` | `expired` | ✅ | ❌ | Admin or system sets expired |
| `pending_pay` | `cancelled` | ✅ | ✅ | Either can cancel payment |
| `paid` | `completed` | ✅ | ❌ | Admin marks as completed |
| `paid` | `cancelled` | ✅ | ❌ | Admin cancels (requires refund) |
| `rejected` | `draft` | ✅ | ❌ | Admin restarts COE |
| `expired` | `draft` | ✅ | ❌ | Admin restarts COE |

### Permission Notes:
- **Clients** can only perform actions on COEs where they are the `client_id` (the assigned client purchasing the COE)
- **Participants** (in `participants` array) do NOT have status change permissions - only the assigned client does
- **Runners** do NOT have status change permissions - they can only view assigned COEs
- **Automatic transitions** (like `pending_pay` → `paid`) are handled by the payment service, not by users

---

## Business Validation Rules

Before allowing status transitions, the following business rules must be validated:

### Transition to `pending_pay`:
- ✅ COE status must be `approved`
- ✅ Payment method must be configured/available (client must have payment method)
- ✅ COE total must be greater than 0
- ✅ COE must belong to the requesting client

### Transition to `paid`:
- ✅ COE status must be `pending_pay`
- ✅ Payment amount must match COE total exactly (full payment only)
- ✅ Payment must be successfully processed and confirmed
- ✅ Seats must be available (re-validated at payment time)

### Transition to `approved`:
- ✅ COE must have at least one event (COEs are always created with events)
- ✅ COE must have at least one selected seat (COEs are always created with seats)
- ✅ Only admin can approve

### Transition to `cancelled` from `paid`:
- ✅ Refund process must be initiated if payment was made
- ✅ Seats must be released
- ✅ Admin only (requires refund handling)

### General Rules:
- All COEs are created with events and seats (no empty COEs)
- Only full payment is supported (no deposit/final payment split)
- Status transitions must follow the `validTransitions` matrix
- Only the assigned client (COE `client_id`) can perform client actions
- Participants in the `participants` array are informational only and do not affect status flow

---

## Status Change History / Audit Trail (Placeholder)

**Status:** 🔴 Not Implemented - To be implemented in future phase

### Requirements

Every status change must be logged with:
- **Who** changed it (`changed_by` - User ID)
- **When** it was changed (`changed_at` - Timestamp)
- **What** changed (`previous_status` → `new_status`)
- **Why** it changed (optional `change_reason` or context)

### Status Change History Schema (Placeholder)

```javascript
{
  coe_id: ObjectId (ref: 'COE'),
  previous_status: String,
  new_status: String,
  changed_by: ObjectId (ref: 'User'),
  changed_at: Date,
  change_reason: String (optional),
  change_source: String, // 'manual', 'automatic', 'payment', 'system'
  metadata: {
    // Additional context (payment_id, error details, etc.)
  }
}
```

### Implementation Requirements (Placeholder)

1. **Status Change History Model**
   - Create `COEStatusHistory` model/schema
   - Store all status changes with full audit trail
   - Index by `coe_id` and `changed_at` for efficient queries

2. **History Logging**
   - Log status change in `coeService.updateCOEStatus()`
   - Log automatic transitions (payment → `paid`)
   - Log rollback operations
   - Include error context when status change fails

3. **History Retrieval**
   - API endpoint: `GET /v1/coes/:id/status-history`
   - Return chronological list of all status changes
   - Include user details (who changed it)
   - Include timestamps and reasons

4. **History Display**
   - Show status change timeline in COE detail view
   - Display who changed status and when
   - Show previous status → new status transitions

### Use Cases

- **Debugging:** Track down why a COE is in unexpected state
- **Compliance:** Audit trail for financial transactions
- **Support:** Understand COE lifecycle for customer support
- **Analytics:** Analyze status transition patterns

---

## Error Handling & Recovery

### Error Handling Strategy

When a status change fails or encounters errors:

1. **Comprehensive Logging**
   - Log all errors to server logs with full context:
     - COE ID
     - Current status
     - Attempted new status
     - User ID attempting change
     - Error message and stack trace
     - Timestamp
     - Request ID/correlation ID

2. **User-Friendly Error Messages**
   - Return appropriate HTTP status codes
   - Provide clear error messages to users (no technical details)
   - Include actionable guidance when possible

3. **Transaction Safety**
   - Use database transactions where appropriate
   - Ensure atomicity - either all changes succeed or none
   - Avoid partial state updates

### Retry Capability

**Status changes can be retried** in most cases:
- ✅ `draft` → `approved` (can retry)
- ✅ `approved` → `pending_pay` (can retry)
- ✅ `pending_pay` → `paid` (can retry - payment retry logic)
- ⚠️ `paid` → `cancelled` (requires refund, see special handling)

### Special Handling: Retrying `paid` → `cancelled`

When cancelling a paid COE:
1. **Initiate Refund Process** - Process refund through payment service
2. **If refund fails** - COE remains in `paid` status, user informed
3. **If refund succeeds** - Proceed with cancellation
4. **Log refund status** - Track refund success/failure in audit log

### Rollback Capability

**Status changes can be rolled back** in the following scenarios:

#### Rollback Scenarios:

| From Status | To Status | Can Rollback? | Rollback Action |
|-------------|-----------|---------------|-----------------|
| `approved` | `draft` | ✅ Yes | Admin can revert to draft |
| `pending_pay` | `approved` | ✅ Yes | Cancel payment, revert to approved |
| `paid` | `pending_pay` | ⚠️ Special | Requires refund, then can revert |
| `rejected` | `draft` | ✅ Yes | Admin restarts COE (this is the normal flow) |
| `expired` | `draft` | ✅ Yes | Admin restarts COE (this is the normal flow) |
| `cancelled` | Previous | ❌ No | Terminal state, cannot rollback |
| `completed` | Previous | ❌ No | Terminal state, cannot rollback |

#### Rollback Implementation (Placeholder)

```javascript
// Rollback to previous status
PUT /v1/coes/:id/status/rollback

// Returns COE with previous status restored
// Logs rollback in status history
// Requires admin permission
```

### Seat Booking Failure Handling

**Scenario:** Status transitions to `paid` but seat booking fails

**Handling:**
1. **Prevent Status Change** - Do not transition to `paid` if seat booking fails
2. **Rollback Payment** - If payment was processed, initiate refund
3. **Notify Users** - Send push notifications (when implemented) to:
   - **Client:** "Payment received but seat booking failed. Refund processed. Please try again."
   - **Admin:** "Seat booking failed for COE {coe_name}. Payment refunded."
4. **Log Error** - Comprehensive error logging with:
   - COE ID
   - Payment ID
   - Failed seat IDs
   - Error details
   - Refund transaction ID (if applicable)
5. **Maintain Status** - Keep COE in `pending_pay` status
6. **Allow Retry** - Client can retry payment after seats become available

**Status:** 🔴 Push notifications for seat booking failures not yet implemented (placeholder)

---

## Status Change Rollback

**Status:** 🔴 Not Fully Implemented - Partial implementation exists (rejected/expired → draft)

### Current Rollback Support

Currently supported rollbacks:
- ✅ `rejected` → `draft` (admin can restart COE)
- ✅ `expired` → `draft` (admin can restart COE)

### Planned Rollback Support (Placeholder)

The following rollback scenarios should be supported:

1. **`approved` → `draft`**
   - Admin can revert approved COE back to draft for editing
   - Client hasn't seen it yet or admin wants to make changes
   - No side effects (COE wasn't visible to client yet)

2. **`pending_pay` → `approved`**
   - Payment cancelled before completion
   - Revert to approved status
   - Client can try payment again later

3. **`paid` → `pending_pay` (with refund)**
   - Requires refund processing
   - Only admin can do this
   - Seats are released
   - Refund must be successful before rollback

### Rollback API Endpoint (Placeholder)

```
PUT /v1/coes/:id/status/rollback
```

**Request Body:**
```json
{
  "target_status": "draft",
  "reason": "Needs additional changes"
}
```

**Validation:**
- Must be a valid rollback path
- Admin only
- May require refund if rolling back from `paid`
- Logs rollback in status history

### Rollback vs Normal Transition

**Rollback** is different from normal status transitions:
- Rollback implies "undoing" a previous change
- Rollback requires admin permission
- Rollback should be logged with special flag
- Rollback may involve refunds (for paid COEs)

---

## Multi-Client COE and Participants

### Participants vs Assigned Client

**Important Distinction:**
- **Assigned Client (`client_id`)**: The client purchasing the COE - has full permissions
- **Participants (`participants` array)**: Additional clients added to the COE - informational only

### Status Change Permissions

| Role | Status Change Permissions | Can View COE | Can Edit COE |
|------|--------------------------|--------------|--------------|
| **Assigned Client** | Can change status (approved → pending_pay, approved → rejected, pending_pay → cancelled) | ✅ Yes | ✅ If editing enabled |
| **Participants** | ❌ No status change permissions | ✅ Yes (read-only) | ❌ No |
| **Admin** | ✅ Full status change permissions | ✅ Yes | ✅ Yes |
| **Runner** | ❌ No status change permissions | ✅ Yes (assigned COEs only, read-only) | ❌ No |

### Notification Recipients

**Status Change Notifications:**
- **Client:** Only the assigned client (`client_id`) receives notifications
- **Participants:** Do NOT receive status change notifications
- **Admin:** Always receives relevant notifications
- **Runner:** Receives notifications if assigned to the COE (when runner notifications are implemented)

**Note:** Participants are informational only - they don't affect the COE status flow, payment flow, or receive notifications about status changes.

---

## Implementation Notes

### Status Validation
- All status transitions must be validated against `validTransitions`
- Invalid transitions should throw an error: `"Invalid status transition from {current} to {new}"`
- Terminal states (`completed`, `cancelled`) cannot transition to any other status
- Business validation rules must pass before allowing transition

### Backward Compatibility
- `accepted_date` field is still set when status becomes `paid` for backward compatibility
- Code that references `accepted_date` will continue to work
- The `accepted` status has been removed - use `paid` instead

### Migration from Old Statuses
- **Removed statuses:** `sent`, `accepted`
- **New statuses:** `pending_pay`, `paid`
- Existing COEs with `sent` status should be migrated to `approved` or `pending_pay` based on context
- Existing COEs with `accepted` status should be migrated to `paid`

---

## API Endpoints

### Status Update Endpoint
```
PUT /v1/coes/:id/status
```

**Request Body:**
```json
{
  "status": "approved"
}
```

**Validation:**
- Status must be valid enum value
- Transition must be valid according to `validTransitions`
- Admin only (for manual status updates)

### Payment Status Updates
Payment status is automatically updated by the payment service when payments are processed. See `services/paymentService.js` → `updateCOEPaymentStatus()`.

**Payment Completion Status Transitions:**
- When payment completes, the COE status transitions from `approved` or `pending_pay` to `paid`
- The payment service automatically handles both scenarios:
  - `pending_pay` → `paid` (standard flow when payment intent was created)
  - `approved` → `paid` (direct payment completion, e.g., when payment completes before status transition)
- Both transitions are supported in the `validTransitions` matrix to ensure reliable payment processing

---

## Automatic Status Transitions (Future Implementation)

**Status:** 🔴 Not Implemented - To be implemented in future phase

### Planned Automatic Transitions

1. **Expiration Handler (Cron Job)**
   - Check for expired COEs periodically
   - Transition `approved` or `pending_pay` → `expired` based on expiration rules
   - Implementation: TBD (time-based expiration logic to be defined)

2. **Auto-Completion**
   - Currently: Manual admin action required to mark COE as `completed`
   - Future consideration: Auto-complete when all events are completed
   - **Note:** Not currently planned - manual completion provides better control

### Expiration Logic (Placeholder)

Expiration mechanism to be defined:
- Expiration date/time field (`expires_at`?)
- Expiration trigger (time-based? manual?)
- Cron job schedule for checking expiration
- Notification when expiration occurs

---

## Status Change Webhooks / Events (Future Implementation)

**Status:** 🔴 Not Implemented - May be needed in future for external integrations

### Planned Webhook System (Placeholder)

Status changes may trigger webhooks for:
- External system integrations
- Third-party service notifications
- Custom business logic hooks

### Webhook Events (Placeholder)

Potential webhook events:
- `coe.status.approved`
- `coe.status.pending_pay`
- `coe.status.paid`
- `coe.status.rejected`
- `coe.status.expired`
- `coe.status.completed`
- `coe.status.cancelled`

### Implementation (Placeholder)

- Webhook configuration per COE or system-wide
- Webhook payload structure
- Retry logic for failed webhooks
- Webhook security (signatures, authentication)

---

## Testing Scenarios

### Status Transition Test Cases

#### 1. Happy Path Tests
- ✅ `draft` → `approved` → `pending_pay` → `paid` → `completed`
- ✅ Verify all date fields are set correctly
- ✅ Verify seat statuses change to `booked` at `paid`
- ✅ Verify notifications are sent (when implemented)

#### 2. Client Rejection Tests
- ✅ `approved` → `rejected`
- ✅ Verify seats are released
- ✅ Verify `rejected` → `draft` rollback works
- ✅ Verify notifications are sent (when implemented)

#### 3. Payment Flow Tests
- ✅ `approved` → `pending_pay` (client initiates payment)
- ✅ `pending_pay` → `paid` (payment successful)
- ✅ Verify payment amount matches COE total
- ✅ Verify payment method validation
- ✅ `pending_pay` → `rejected` (client cancels payment)
- ✅ `pending_pay` → `cancelled` (payment cancelled)

#### 4. Admin Cancellation Tests
- ✅ `draft` → `cancelled`
- ✅ `approved` → `cancelled`
- ✅ `pending_pay` → `cancelled`
- ✅ `paid` → `cancelled` (verify refund process)
- ✅ Verify seats are released on cancellation

#### 5. Rollback Tests
- ✅ `approved` → `draft` (admin rollback)
- ✅ `pending_pay` → `approved` (payment cancellation rollback)
- ✅ `rejected` → `draft` (restart COE)
- ✅ `expired` → `draft` (restart COE)
- ✅ Verify rollback is logged in status history (when implemented)

#### 6. Permission Tests
- ✅ Client can only change status on their own COEs
- ✅ Admin can change status on any COE
- ✅ Participants cannot change status
- ✅ Runner cannot change status
- ✅ Invalid role attempts are rejected with 403

#### 7. Business Validation Tests
- ✅ Cannot transition to `pending_pay` without payment method
- ✅ Cannot transition to `paid` if payment amount doesn't match total
- ✅ Cannot transition to `paid` if seats are unavailable
- ✅ Invalid status transitions are rejected

#### 8. Error Handling Tests
- ✅ Status change failure logs comprehensive error
- ✅ User receives appropriate error message
- ✅ Partial state updates are prevented (transaction safety)
- ✅ Seat booking failure handling (refund + notification)
- ✅ Retry capability after error

#### 9. Edge Cases
- ✅ Status change while COE is being edited (concurrent updates)
- ✅ Status change after COE deletion attempt
- ✅ Status change with invalid COE ID
- ✅ Status change with expired authentication token
- ✅ Status change during payment processing

#### 10. Multi-Client COE Tests
- ✅ Only assigned client can change status
- ✅ Participants can view but not change status
- ✅ Participants do not receive notifications
- ✅ Runner receives notifications only if assigned (when implemented)

### Integration Test Scenarios

1. **End-to-End Payment Flow**
   - Create COE → Approve → Client initiates payment → Payment processed → Status becomes `paid`
   - Verify all side effects (seat booking, notifications, date fields)

2. **Error Recovery Flow**
   - Payment succeeds but seat booking fails → Refund processed → Status remains `pending_pay`
   - Verify error notifications (when implemented)

3. **Rollback Flow**
   - Admin cancels paid COE → Refund processed → Status becomes `cancelled` → Seats released

### Performance Test Scenarios

- Bulk status updates (multiple COEs)
- Concurrent status changes on same COE
- Status change with large COE data (many events/seats)

---

## Push Notifications (Future Implementation)

This section defines the push notification requirements for COE status changes. These notifications will be implemented in a future phase to keep clients and admins informed of COE lifecycle events.

### Notification Triggers

Push notifications should be sent when COE status changes to the following states:

| Status | Notify Client | Notify Admin | Notify Runner | Notification Message (Placeholder) |
|--------|---------------|--------------|---------------|-----------------------------------|
| `approved` | ✅ Yes | ❌ No | ✅ Yes (if assigned) | Client: "Your experience proposal is ready for review"<br>Runner: "COE assigned: {coe_name}" |
| `pending_pay` | ❌ No | ✅ Yes | ❌ No | Admin: "Client has initiated payment for COE: {coe_name}" |
| `paid` | ✅ Yes | ✅ Yes | ✅ Yes (if assigned) | Client: "Payment confirmed! Your experience is locked in"<br>Admin: "Payment received for COE: {coe_name}"<br>Runner: "COE confirmed: {coe_name}" |
| `rejected` | ❌ No | ✅ Yes | ❌ No | Admin: "Client has rejected COE: {coe_name}" |
| `expired` | ✅ Yes | ✅ Yes | ✅ Yes (if assigned) | Client: "Your experience offer has expired"<br>Admin: "COE offer expired: {coe_name}"<br>Runner: "COE expired: {coe_name}" |
| `completed` | ✅ Yes | ✅ Yes | ✅ Yes (if assigned) | Client: "Your experience has been completed! We hope you enjoyed it."<br>Admin: "COE completed: {coe_name}"<br>Runner: "COE completed: {coe_name}" |
| `cancelled` | ✅ Yes | ✅ Yes | ✅ Yes (if assigned) | Client: "Your experience has been cancelled"<br>Admin: "COE cancelled: {coe_name}"<br>Runner: "COE cancelled: {coe_name}" |

**Notes:**
- **Client:** Only the assigned client (`client_id`) receives notifications - participants do not
- **Runner:** Receives notifications only if assigned to the COE (COE-level or event-level assignment)
- Status transitions from `draft` are internal admin operations and typically don't require notifications

### Notification Content Structure (Placeholder)

Each notification should include:

```javascript
{
  type: 'coe_status_change',
  coe_id: 'ObjectId',
  coe_name: 'String',
  previous_status: 'String',
  new_status: 'String',
  status_change_date: 'Date',
  client_id: 'ObjectId',
  admin_id: 'ObjectId',
  message: 'String',
  priority: 'low' | 'medium' | 'high',
  action_url: 'String (optional)', // Deep link to COE detail page
  metadata: {
    payment_amount: 'Number (if applicable)',
    payment_type: 'String (if applicable)',
    rejection_reason: 'String (if rejected)',
    expiration_reason: 'String (if expired)'
  }
}
```

### Deep Linking and Navigation (Placeholder)

**Critical Requirement:** All push notifications must support deep linking. When a user clicks/taps on a notification, the mobile app must:

1. **Open the relevant screen** - Navigate to the appropriate screen based on notification type
2. **Display the correct data** - Show the specific COE or relevant data referenced in the notification
3. **Handle app state** - Work correctly whether the app is:
   - Closed (app opens and navigates)
   - In background (app comes to foreground and navigates)
   - Already open (navigates within the app)

#### Deep Link URL Format (Placeholder)

The `action_url` field in notifications should follow this format:

```javascript
// COE Detail Screen
"the1://coe/:coeId"

// COE List Screen (filtered by status if needed)
"the1://coes?status=approved"

// Payment Screen (if payment-related notification)
"the1://coe/:coeId/payment"

// Notification Center
"the1://notifications"

// Client COEs (for admin notifications about a specific client)
"the1://client/:clientId/coes"
```

#### Navigation Mapping by Status (Placeholder)

| Status | Notification Type | Deep Link | Target Screen | Data to Display |
|--------|------------------|-----------|---------------|-----------------|
| `approved` | Client receives COE ready | `the1://coe/:coeId` | COE Detail Screen | Specific COE with all events/seats |
| `pending_pay` | Admin receives payment initiated | `the1://coe/:coeId` | COE Detail Screen (Admin view) | Specific COE with payment info |
| `paid` | Client/Admin receives payment confirmed | `the1://coe/:coeId` | COE Detail Screen | Specific COE with payment confirmation |
| `rejected` | Admin receives rejection | `the1://coe/:coeId` | COE Detail Screen (Admin view) | Specific COE with rejection reason |
| `expired` | Client/Admin receives expiration | `the1://coe/:coeId` | COE Detail Screen | Specific COE with expiration info |
| `completed` | Client/Admin receives completion | `the1://coe/:coeId` | COE Detail Screen | Specific COE marked as completed |
| `cancelled` | Client/Admin receives cancellation | `the1://coe/:coeId` | COE Detail Screen | Specific COE with cancellation details |

#### Implementation Requirements (Placeholder)

1. **Deep Link Handler**
   - Parse `action_url` from notification payload
   - Extract route parameters (coeId, clientId, etc.)
   - Navigate to appropriate screen using Expo Router

2. **Data Loading**
   - Fetch COE data if navigating to COE detail screen
   - Ensure data is loaded before screen renders
   - Handle loading states gracefully
   - Handle errors (e.g., COE not found, user doesn't have access)

3. **Navigation Stack**
   - Maintain proper navigation stack
   - Allow user to navigate back normally
   - Handle edge cases (user navigates away before data loads)

4. **Authentication Check**
   - Verify user is authenticated before navigating
   - Redirect to login if needed, then navigate after login
   - Ensure user has permission to view the data

5. **State Management**
   - Update app state (e.g., mark notification as read)
   - Refresh relevant data after navigation
   - Update notification badges/counts

#### Example Implementation Flow (Placeholder)

**Scenario:** Client receives notification "Your experience proposal is ready for review" (status: `approved`)

```javascript
// Notification payload received
{
  type: 'coe_status_change',
  coe_id: '507f1f77bcf86cd799439011',
  coe_name: 'Las Vegas VIP Weekend',
  new_status: 'approved',
  action_url: 'the1://coe/507f1f77bcf86cd799439011',
  message: 'Your experience proposal is ready for review'
}

// User taps notification
// App receives notification tap event
// Deep link handler extracts route: 'coe/507f1f77bcf86cd799439011'

// Navigation logic (pseudo-code)
1. Check if user is authenticated → Yes, continue
2. Parse route: { screen: 'coe-detail', params: { coeId: '507f1f77bcf86cd799439011' } }
3. Navigate to: router.push('/coe-detail?coeId=507f1f77bcf86cd799439011')
4. COE Detail Screen loads:
   - Show loading indicator
   - Fetch COE data: GET /v1/coes/507f1f77bcf86cd799439011
   - Verify user has access (client_id matches)
   - Render COE details (events, seats, pricing, etc.)
   - Mark notification as read
   - Update notification badge count
```

#### Special Cases (Placeholder)

**COE Not Found or Access Denied:**
- Show error message: "This experience is no longer available"
- Optionally navigate to COE list screen
- Log error for debugging

**App Closed:**
- App opens to splash/loading screen
- Deep link handler processes notification
- Navigates to appropriate screen after app initialization

**User Not Authenticated:**
- Redirect to login screen
- Store deep link intent
- After successful login, navigate to stored deep link

**COE Deleted/Cancelled:**
- Show appropriate message: "This experience has been cancelled"
- Optionally navigate to COE list or home screen

**Status:** 🔴 Not Implemented - Deep linking system not yet built

---

### Notification Delivery Channels (Placeholder)

Notifications should be delivered through multiple channels:

1. **Push Notifications** (Mobile App)
   - Real-time push via Expo/Firebase/APNs
   - Platform: iOS and Android
   - Status: 🔴 Not Implemented

2. **In-App Notifications** (Mobile App)
   - Notification badge on relevant screens
   - Notification center/history
   - Status: 🔴 Not Implemented

3. **Email Notifications** (Optional)
   - Email digest or real-time emails
   - Status: 🔴 Not Implemented (Email service exists but not integrated)

4. **SMS Notifications** (Optional, Future)
   - For critical status changes
   - Status: 🔴 Not Implemented

### Notification Timing

- **Real-time:** For critical status changes (`paid`, `completed`, `cancelled`)
- **Batched:** For non-critical status changes (can be batched and sent periodically)
- **Business Hours:** Consider business hours for non-urgent notifications

### Client Notification Preferences (Placeholder)

Clients should be able to configure notification preferences:

```javascript
{
  user_id: 'ObjectId',
  notification_preferences: {
    coe_approved: { push: true, email: false, sms: false },
    coe_paid: { push: true, email: true, sms: false },
    coe_completed: { push: true, email: true, sms: false },
    coe_cancelled: { push: true, email: true, sms: true },
    coe_expired: { push: false, email: true, sms: false }
  }
}
```

**Status:** 🔴 Not Implemented - Preferences system not yet built

### Admin Notification Preferences (Placeholder)

Admins should be able to configure notification preferences:

```javascript
{
  user_id: 'ObjectId',
  admin_notification_preferences: {
    client_payment_initiated: { push: true, email: false },
    client_payment_received: { push: true, email: true },
    client_rejected: { push: true, email: true },
    coe_expired: { push: false, email: true }
  }
}
```

**Status:** 🔴 Not Implemented - Preferences system not yet built

### Implementation Checklist (Future)

- [ ] Set up push notification service (Expo/Firebase/APNs)
- [ ] Create notification preference models/schema
- [ ] Implement notification preference API endpoints
- [ ] Create notification service/utility
- [ ] Integrate notification triggers into COE status update flow
- [ ] **Implement deep linking system** (Expo Linking configuration)
- [ ] **Create deep link handler/router** (parse action_url and navigate)
- [ ] **Implement navigation logic for each notification type**
- [ ] **Handle edge cases** (app closed, not authenticated, COE not found)
- [ ] **Add data loading** (fetch COE data before screen render)
- [ ] **Test deep linking** (all notification types, all app states)
- [ ] Add notification badges to mobile app UI
- [ ] Create notification center/history screen
- [ ] Implement email notification integration (optional)
- [ ] Add SMS notification support (optional, future)
- [ ] Create admin notification dashboard
- [ ] Add notification testing and monitoring
- [ ] Document notification API endpoints

### Notification Service Integration Points

Notifications should be triggered from:

1. **`coeService.updateCOEStatus()`** - Main status update function
   - Trigger notifications after successful status transition
   - Include both client and admin notifications based on status

2. **`paymentService.updateCOEPaymentStatus()`** - Payment completion
   - Trigger notifications when status changes to `paid`
   - Include payment details in notification metadata

3. **Cron Job for Expired COEs** - Automated expiration
   - Check for expired COEs periodically
   - Trigger `expired` status notifications

### Notification Message Templates (Placeholder)

#### Client Messages

**COE Approved:**
```
"Your experience proposal '{coe_name}' is ready for review. View details and proceed with payment."
```

**Payment Received (Paid):**
```
"Payment confirmed! Your experience '{coe_name}' is locked in. Get ready for an amazing time!"
```

**COE Completed:**
```
"Your experience '{coe_name}' has been completed! We hope you had an amazing time. Thank you for choosing THE1."
```

**COE Cancelled:**
```
"Your experience '{coe_name}' has been cancelled. Please contact support if you have any questions."
```

**COE Expired:**
```
"Your experience offer '{coe_name}' has expired. Contact your concierge to create a new proposal."
```

#### Admin Messages

**Payment Initiated:**
```
"Client {client_name} has initiated payment for COE: {coe_name}"
```

**Payment Received:**
```
"Payment of ${amount} received from {client_name} for COE: {coe_name}"
```

**Client Rejected:**
```
"Client {client_name} has rejected COE: {coe_name}"
```

**COE Expired:**
```
"COE offer has expired: {coe_name} for client {client_name}"
```

**COE Completed:**
```
"COE completed successfully: {coe_name} for client {client_name}"
```

**COE Cancelled:**
```
"COE cancelled: {coe_name} for client {client_name}"
```

#### Runner Messages (Placeholder)

**COE Assigned (Approved):**
```
"COE assigned to you: {coe_name} for client {client_name}"
```

**COE Confirmed (Paid):**
```
"COE confirmed: {coe_name} - Prepare for execution"
```

**COE Cancelled:**
```
"COE cancelled: {coe_name} - Assignment removed"
```

**COE Expired:**
```
"COE expired: {coe_name} - Assignment removed"
```

**COE Completed:**
```
"COE completed: {coe_name} - Great work!"
```

**Note:** Runner notifications only sent if runner is assigned to the COE (COE-level or event-level assignment).

### Related Files/Components (Future)

**Backend:**
- `services/notificationService.js` - Notification service (to be created)
- `models/NotificationPreference.js` - User notification preferences (to be created)
- `routes/notifications.js` - Notification API endpoints (to be created)

**Mobile App:**
- `mobile/src/navigation/DeepLinkHandler.js` - Deep link handler/router (to be created)
- `mobile/src/utils/notificationUtils.js` - Notification parsing and navigation utilities (to be created)
- `mobile/src/screens/NotificationCenter.js` - Notification center screen (to be created)
- `mobile/src/components/NotificationBadge.js` - Notification badge component (to be created)
- `mobile/app.json` - Expo Linking configuration (to be updated)

---

## Related Documentation

- [COE Specification](./architecture/coe-specification.md) - Complete COE data model
- [Payment System](../payment/PAYMENT-SYSTEM-COMPLETE.md) - Payment processing details
- [Feature Flags](./FEATURE-FLAGS.md) - Client COE creation/editing controls

---

## Changelog

### Version 2.2 (December 2025)
- **Updated:** `validTransitions` - Added `approved` → `paid` transition to support direct payment completion
- **Updated:** Payment Status Updates section - Clarified that payment completion can transition from both `approved` and `pending_pay` to `paid`
- **Added:** Mobile App Improvements - Automatic refresh of COE list when screen comes into focus after payment completion
- **Added:** Mobile App Actions - Approve and Cancel buttons added to COE detail screen for status management

### Version 2.1 (January 2025)
- **Added:** Status Change Permissions Matrix - detailed matrix of who can change from what status to what status
- **Added:** Business Validation Rules - rules for status transitions (payment method required, payment amount matching, etc.)
- **Added:** Status Change History / Audit Trail section (placeholder for future implementation)
- **Added:** Error Handling & Recovery section - comprehensive error handling, retry capability, rollback, seat booking failure handling
- **Added:** Status Change Rollback section - current and planned rollback scenarios
- **Added:** Multi-Client COE and Participants section - clarifies participants vs assigned client permissions
- **Added:** Automatic Status Transitions section (placeholder for future implementation)
- **Added:** Status Change Webhooks / Events section (placeholder for future implementation)
- **Added:** Testing Scenarios section - comprehensive test cases for status transitions
- **Updated:** Payment Status section - clarified only full payment is supported (no deposit/final payment split)
- **Updated:** Push Notifications section - added runner notifications column and runner message templates
- **Updated:** Notification triggers table - includes runner notifications when assigned

### Version 2.0 (January 2025)
- **Removed:** `sent` status (redundant - admin creating COE already makes it visible)
- **Removed:** `accepted` status (redundant with `paid` - payment = acceptance)
- **Added:** `pending_pay` status (tracks payment processing state)
- **Renamed:** `accepted` → `paid` (payment received = COE accepted)
- Simplified flow from 8 statuses to 8 statuses (replaced 2, added 1 net result)

### Version 1.0 (Original)
- Initial status flow with `draft`, `approved`, `sent`, `accepted`, `rejected`, `expired`, `completed`, `cancelled`


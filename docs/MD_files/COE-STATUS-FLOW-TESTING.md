# COE Status Flow - Testing Guide

This document outlines what you'll be able to test once the COE Status Flow documentation is fully implemented.

---

## ✅ Core Status Transitions (To Be Implemented)

Once implemented, you'll be able to test all status transitions defined in the documentation:

### Happy Path Flow
```
draft → approved → pending_pay → paid → completed
```

**Test Cases:**
1. ✅ Admin creates COE → status is `draft`
2. ✅ Admin approves COE → status changes to `approved`
3. ✅ Client accepts COE and initiates payment → status changes to `pending_pay`
4. ✅ Payment succeeds → status automatically changes to `paid`
5. ✅ Admin marks COE as completed → status changes to `completed`
6. ✅ Verify all date fields are set correctly (`approved_date`, `pending_pay_date`, `paid_date`)
7. ✅ Verify seats become `booked` when status reaches `paid`

### Client Rejection Flow
```
approved → rejected → draft (restart)
```

**Test Cases:**
1. ✅ Client rejects approved COE → status changes to `rejected`
2. ✅ Seats are released (status becomes `available`)
3. ✅ Admin can restart by changing status back to `draft`
4. ✅ COE can be edited and approved again

### Payment Cancellation Flow
```
pending_pay → cancelled OR pending_pay → rejected
```

**Test Cases:**
1. ✅ Client cancels payment → status changes to `cancelled` or `rejected`
2. ✅ Seats are released
3. ✅ Payment can be retried

### Admin Cancellation Flow
```
draft → cancelled
approved → cancelled
pending_pay → cancelled
paid → cancelled (with refund)
```

**Test Cases:**
1. ✅ Admin can cancel at any stage (except `completed`)
2. ✅ Cancellation from `paid` triggers refund process
3. ✅ Seats are released on cancellation
4. ✅ Refund status is logged

---

## ✅ Status Change Permissions (To Be Implemented)

### Admin Permissions
**Test Cases:**
1. ✅ Admin can change status: `draft` → `approved`
2. ✅ Admin can change status: `approved` → `cancelled`
3. ✅ Admin can change status: `pending_pay` → `cancelled`
4. ✅ Admin can change status: `paid` → `completed`
5. ✅ Admin can change status: `paid` → `cancelled` (with refund)
6. ✅ Admin can change status: `rejected` → `draft` (restart)
7. ✅ Admin can change status: `expired` → `draft` (restart)

### Client Permissions
**Test Cases:**
1. ✅ Client can change status: `approved` → `pending_pay` (initiate payment)
2. ✅ Client can change status: `approved` → `rejected` (reject COE)
3. ✅ Client can change status: `pending_pay` → `rejected` (cancel payment)
4. ✅ Client can change status: `pending_pay` → `cancelled` (cancel payment)
5. ✅ Client can change status: `draft` → `cancelled` (if client created it and editing enabled)
6. ❌ Client **cannot** change status: `draft` → `approved` (admin only)
7. ❌ Client **cannot** change status: `paid` → `completed` (admin only)
8. ❌ Client **cannot** change status on COEs that don't belong to them (403 error)

### Permission Denial Tests
**Test Cases:**
1. ✅ Client trying to approve their own COE → 403 error
2. ✅ Client trying to change status of another client's COE → 403 error
3. ✅ Participant trying to change status → 403 error (only assigned client can)
4. ✅ Runner trying to change status → 403 error (read-only access)

---

## ✅ Business Validation Rules (To Be Implemented)

### Transition to `pending_pay`
**Test Cases:**
1. ✅ Can transition if COE status is `approved` → Success
2. ❌ Cannot transition if COE status is not `approved` → Error
3. ❌ Cannot transition if client doesn't have payment method configured → Error
4. ❌ Cannot transition if COE total is 0 → Error
5. ❌ Cannot transition if client is not the COE owner → 403 error

### Transition to `paid`
**Test Cases:**
1. ✅ Can transition if COE status is `pending_pay` → Success (automatic)
2. ✅ Can transition if payment amount matches COE total exactly → Success
3. ❌ Cannot transition if payment amount doesn't match COE total → Error
4. ❌ Cannot transition if seats are no longer available → Error + refund

### Transition to `approved`
**Test Cases:**
1. ✅ Admin can approve if COE has events and seats → Success
2. ❌ Cannot approve if COE has no events → Error (though this shouldn't happen)
3. ❌ Cannot approve if COE has no selected seats → Error (though this shouldn't happen)
4. ❌ Client cannot approve → 403 error

### Transition to `cancelled` from `paid`
**Test Cases:**
1. ✅ Admin can cancel paid COE → Refund process initiated
2. ✅ Seats are released after cancellation
3. ✅ Refund status is tracked
4. ❌ Client cannot cancel paid COE → 403 error

---

## ✅ Status Transition Validation (To Be Implemented)

### Valid Transitions
**Test Cases:**
1. ✅ All valid transitions from the `validTransitions` matrix work correctly
2. ✅ Invalid transitions are rejected with error: "Invalid status transition from {current} to {new}"
3. ✅ Terminal states (`completed`, `cancelled`) cannot transition to any other status

### Invalid Transition Tests
**Test Cases:**
1. ❌ `draft` → `paid` → Error (must go through `approved` and `pending_pay`)
2. ❌ `approved` → `completed` → Error (must go through `pending_pay` and `paid`)
3. ❌ `completed` → `draft` → Error (terminal state)
4. ❌ `cancelled` → `approved` → Error (terminal state)

---

## ✅ Side Effects of Status Changes (To Be Implemented)

### Seat Status Changes
**Test Cases:**
1. ✅ When status becomes `paid` → All selected seats become `booked`
2. ✅ When status becomes `rejected` → All seats are released (`available`)
3. ✅ When status becomes `expired` → All seats are released (`available`)
4. ✅ When status becomes `cancelled` → All seats are released (`available`)
5. ✅ Released seats become available for other COEs

### Date Field Updates
**Test Cases:**
1. ✅ `approved_date` is set when status becomes `approved`
2. ✅ `pending_pay_date` is set when status becomes `pending_pay`
3. ✅ `paid_date` is set when status becomes `paid`
4. ✅ `accepted_date` is set when status becomes `paid` (backward compatibility)

### Payment Status Updates
**Test Cases:**
1. ✅ `payment_status` becomes `'paid'` when COE status becomes `paid`
2. ✅ `total_paid` field is updated correctly

---

## ✅ Error Handling & Recovery (To Be Implemented)

### Error Logging
**Test Cases:**
1. ✅ Status change failures are logged with full context:
   - COE ID
   - Current status
   - Attempted new status
   - User ID
   - Error message and stack trace
   - Timestamp
   - Request ID

### User-Friendly Error Messages
**Test Cases:**
1. ✅ Users receive clear error messages (no technical details)
2. ✅ Appropriate HTTP status codes are returned (400, 403, 500)
3. ✅ Error messages include actionable guidance when possible

### Retry Capability
**Test Cases:**
1. ✅ Failed `draft` → `approved` transitions can be retried
2. ✅ Failed `approved` → `pending_pay` transitions can be retried
3. ✅ Failed payment → `paid` transitions can be retried (payment retry logic)
4. ⚠️ `paid` → `cancelled` retry requires refund handling

### Seat Booking Failure Handling
**Test Cases:**
1. ✅ If seat booking fails when transitioning to `paid`:
   - Status does NOT change to `paid`
   - Payment is refunded (if processed)
   - Client receives error notification (when notifications implemented)
   - Admin receives error notification (when notifications implemented)
   - Error is logged comprehensively
   - COE remains in `pending_pay` status
   - Client can retry payment

---

## ✅ Rollback Capability (Partially Implemented)

### Current Rollback Support
**Test Cases:**
1. ✅ `rejected` → `draft` (admin restart) → Works
2. ✅ `expired` → `draft` (admin restart) → Works

### Planned Rollback Support (To Be Implemented)
**Test Cases:**
1. 🔄 `approved` → `draft` (admin revert) → To be implemented
2. 🔄 `pending_pay` → `approved` (cancel payment) → To be implemented
3. 🔄 `paid` → `pending_pay` (with refund) → To be implemented (requires refund)

---

## 🔴 Status Change History / Audit Trail (Not Implemented - Placeholder)

**Cannot test until implemented:**
- Status change history logging
- `GET /v1/coes/:id/status-history` endpoint
- Status change timeline display
- Audit trail queries

**Future Test Cases:**
1. ✅ Every status change is logged with:
   - Who changed it (`changed_by`)
   - When it changed (`changed_at`)
   - Previous status → New status
   - Optional reason/context
2. ✅ History can be retrieved via API
3. ✅ History displays correctly in COE detail view

---

## 🔴 Push Notifications (Not Implemented - Placeholder)

**Cannot test until implemented:**
- Push notifications
- Notification preferences
- Deep linking from notifications
- In-app notification center

**Future Test Cases:**
1. ✅ Client receives notification when COE is `approved`
2. ✅ Admin receives notification when client initiates payment (`pending_pay`)
3. ✅ Client and admin receive notification when payment succeeds (`paid`)
4. ✅ Admin receives notification when client rejects COE
5. ✅ Client and admin receive notification when COE expires
6. ✅ Client and admin receive notification when COE is completed
7. ✅ Client and admin receive notification when COE is cancelled
8. ✅ Runner receives notification when assigned to COE (if runner assigned)
9. ✅ Clicking notification opens correct screen with correct data (deep linking)
10. ✅ Notification preferences are respected

---

## 🔴 Automatic Status Transitions (Not Implemented - Placeholder)

**Cannot test until implemented:**
- Expiration cron job
- Auto-expiration logic

**Future Test Cases:**
1. ✅ Approved COEs expire after time limit → Status changes to `expired`
2. ✅ Pending payment COEs expire after time limit → Status changes to `expired`
3. ✅ Expired COEs release seats automatically
4. ✅ Expiration triggers notifications (when notifications implemented)

---

## 🔴 Webhooks / Events (Not Implemented - Placeholder)

**Cannot test until implemented:**
- Webhook system
- Event triggers for external systems

**Future Test Cases:**
1. ✅ Status changes trigger webhooks
2. ✅ Webhook payloads are correctly formatted
3. ✅ Webhook retry logic works
4. ✅ Webhook security (signatures, authentication)

---

## ✅ Multi-Client COE and Participants (To Be Implemented)

### Participant Permissions
**Test Cases:**
1. ✅ Participants can VIEW COE (read-only)
2. ❌ Participants CANNOT change status → 403 error
3. ❌ Participants do NOT receive status change notifications
4. ✅ Only assigned client (`client_id`) can perform status changes

### Assigned Client Permissions
**Test Cases:**
1. ✅ Assigned client can perform all client-level status changes
2. ✅ Assigned client receives all status change notifications (when notifications implemented)
3. ✅ Assigned client can edit COE (if editing enabled via feature flag)

---

## ✅ Payment Flow (Partially Implemented)

**Test Cases:**
1. ✅ Client initiates payment → Status changes to `pending_pay`
2. ✅ Payment succeeds → Status automatically changes to `paid`
3. ✅ Payment amount must match COE total exactly (full payment only)
4. ✅ Partial payments are NOT supported
5. ✅ `payment_status` field is updated correctly
6. ✅ Seats are booked when payment succeeds

---

## 📋 Testing Summary

### ✅ Fully Testable Once Implemented:
- All status transitions (happy path and edge cases)
- Permission matrix (admin, client, participant, runner)
- Business validation rules
- Status transition validation
- Side effects (seat status, date fields, payment status)
- Error handling and recovery
- Retry capability
- Seat booking failure handling
- Rollback (partial - some scenarios to be implemented)
- Multi-client COE and participants

### 🔴 Not Testable (Placeholders for Future):
- Status change history / audit trail
- Push notifications
- Deep linking from notifications
- Automatic status transitions (expiration)
- Webhooks / events

### ⚠️ Current Status:
**Important:** The current codebase still uses the OLD status flow (`sent`, `accepted`). Once the documentation is implemented, the code will be updated to use the NEW simplified flow (`pending_pay`, `paid`). Until then, you can test the OLD flow, but it won't match the documented behavior.

---

## Next Steps for Implementation

1. **Update `coeService.updateCOEStatus()`** to use new status flow (`pending_pay`, `paid` instead of `sent`, `accepted`)
2. **Update `validTransitions` matrix** to match documentation
3. **Add business validation rules** for status transitions
4. **Implement comprehensive error handling** with logging
5. **Add rollback endpoints** for status changes
6. **Update payment service** to use new status flow
7. **Add status change history** logging (future)
8. **Implement push notifications** (future)
9. **Add expiration cron job** (future)

---

**Last Updated:** January 2025  
**Status:** Testing guide for documented COE status flow


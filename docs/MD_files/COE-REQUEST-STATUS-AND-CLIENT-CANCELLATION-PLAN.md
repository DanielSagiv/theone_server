# COE Request Status & Client Cancellation Implementation Plan

## Overview

This document outlines the implementation plan for:
1. **Adding 'request' status** - New status for user-requested COEs (similar permissions to 'draft')
2. **Client cancellation** - Allow clients to cancel their own COEs
3. **Visual distinction** - Mark 'request' vs 'draft' status visually for users

**Last Updated:** January 2025  
**Status:** ✅ **IMPLEMENTED** - All features completed and deployed

---

## Requirements Summary

### 1. New 'request' Status

- **Purpose**: Distinguish user-requested COEs from admin-created draft COEs
- **Permissions**: Same as 'draft' status
- **Flow**: User requests COE → status = 'request' → Admin edits/approves → status = 'approved'

### 2. Client Cancellation

- **Who**: Clients can cancel their own COEs
- **When**: From 'request', 'draft', 'approved', 'pending_pay' statuses
- **Restrictions**: Cannot cancel 'paid' COEs (requires refund, admin-only)

### 3. Visual Distinction

- **For Users**: Clearly mark 'request' status COEs differently from 'draft' status COEs
- **For Admins**: Show both 'request' and 'draft' statuses clearly

---

## Status Enum Update

### New Status Enum

```javascript
status: {
  type: String,
  enum: [
    'draft',           // Admin building/editing the COE
    'request',         // User-requested COE (awaiting admin review)
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

**Changes:**
- Added 'request' status
- Total: 9 statuses (was 8)

---

## Valid Status Transitions Update

### Updated Valid Transitions

```javascript
const validTransitions = {
  'draft': ['approved', 'cancelled'],
  'request': ['approved', 'cancelled'],  // NEW: Same as draft
  'approved': ['pending_pay', 'paid', 'rejected', 'expired', 'cancelled'],
  'pending_pay': ['paid', 'rejected', 'expired', 'cancelled'],
  'paid': ['completed', 'cancelled'],
  'rejected': ['draft', 'request'],      // Can restart to draft OR request
  'expired': ['draft', 'request'],       // Can restart to draft OR request
  'completed': [],                       // Terminal state
  'cancelled': []                        // Terminal state
};
```

**Key Changes:**
- `request` can transition to: `approved`, `cancelled`
- `rejected` and `expired` can restart to either `draft` OR `request` (admin decides)
- Clients can cancel: `request`, `draft`, `approved`, `pending_pay`

---

## Status Flow Diagram (Updated)

```
                    ┌─────────┐
                    │  DRAFT  │ ← Admin-created COE
                    └────┬────┘
                         │
                    ┌────┴────┐
                    ↓         ↓
            ┌───────────┐  ┌───────────┐
            │ APPROVED  │  │ CANCELLED │
            └─────┬─────┘  └───────────┘
                  │         (terminal)
                  │
        ┌─────────┼─────────┐
        ↓                   ↓
┌──────────────┐      ┌──────────┐
│ PENDING_PAY  │      │ REJECTED │
└──────┬───────┘      └────┬─────┘
       │                   │
       ↓                   ↓
  ┌─────────┐         ┌──────────┐
  │  PAID   │         │ REQUEST  │ ← User-requested COE
  └────┬────┘         └────┬─────┘
       │                   │
       │              ┌────┴────┐
       │              ↓         ↓
       │       ┌───────────┐ ┌──────────┐
       │       │ APPROVED  │ │CANCELLED │
       │       └─────┬─────┘ └──────────┘
       │             │         (terminal)
       │             │
       └─────────────┼─────────┐
                     │         │
                     ↓         ↓
              ┌────────────┐ ┌──────────┐
              │  COMPLETED │ │CANCELLED │
              └────────────┘ └──────────┘
              (terminal)     (terminal)
```

---

## Authorization & Permissions Matrix

### Status Change Permissions (Updated)

| From Status | To Status | Admin | Client | Notes |
|-------------|-----------|:-----:|:------:|-------|
| `draft` | `approved` | ✅ | ❌ | Admin approves |
| `draft` | `cancelled` | ✅ | ✅ | Client can cancel their own draft COE |
| `request` | `approved` | ✅ | ❌ | Admin approves user request |
| `request` | `cancelled` | ✅ | ✅ | Client can cancel their request |
| `approved` | `pending_pay` | ❌ | ✅ | Client accepts and initiates payment |
| `approved` | `rejected` | ❌ | ✅ | Client rejects |
| `approved` | `cancelled` | ✅ | ✅ | **NEW: Client can cancel approved COE** |
| `approved` | `expired` | ✅ | ❌ | Admin or system sets expired |
| `pending_pay` | `paid` | ❌ | ❌ | Automatic (payment service) |
| `pending_pay` | `rejected` | ❌ | ✅ | Client cancels payment |
| `pending_pay` | `cancelled` | ✅ | ✅ | Client or admin can cancel |
| `pending_pay` | `expired` | ✅ | ❌ | Admin or system sets expired |
| `paid` | `completed` | ✅ | ❌ | Admin marks as completed |
| `paid` | `cancelled` | ✅ | ❌ | Admin only (requires refund) |
| `rejected` | `draft` | ✅ | ❌ | Admin restarts to draft |
| `rejected` | `request` | ✅ | ❌ | Admin restarts to request (if originally requested) |
| `expired` | `draft` | ✅ | ❌ | Admin restarts to draft |
| `expired` | `request` | ✅ | ❌ | Admin restarts to request (if originally requested) |

### Key Changes:
- ✅ **Clients can cancel**: `request`, `draft`, `approved`, `pending_pay` (if they are the owner)
- ❌ **Clients cannot cancel**: `paid` (requires refund, admin-only)

---

## Implementation Details

### Phase 1: Backend Changes

#### 1.1 Update COE Model

**File:** `server/models/COE.js`

**Changes:**
- Add 'request' to status enum
- Update default status logic (handled in createCOE based on creator)

```javascript
status: { 
  type: String, 
  enum: ['draft', 'request', 'approved', 'pending_pay', 'paid', 'rejected', 'expired', 'completed', 'cancelled'],
  default: 'draft',
  index: true
}
```

#### 1.2 Update Status Transition Logic

**File:** `server/services/coeService.js` → `updateCOEStatus()`

**Changes:**
- Add 'request' to validTransitions object
- Update transition validation to include 'request' → 'approved', 'cancelled'
- Update rejected/expired restart options (can go to 'request' if originally requested)

```javascript
const validTransitions = {
  'draft': ['approved', 'cancelled'],
  'request': ['approved', 'cancelled'],  // NEW
  'approved': ['pending_pay', 'paid', 'rejected', 'expired', 'cancelled'],
  'pending_pay': ['paid', 'rejected', 'expired', 'cancelled'],
  'paid': ['completed', 'cancelled'],
  'rejected': ['draft', 'request'],      // UPDATED
  'expired': ['draft', 'request'],       // UPDATED
  'completed': [],
  'cancelled': []
};
```

#### 1.3 Update COE Creation Logic

**File:** `server/services/botToolHandlers.js` → `handleCreateCOEDraft()`

**Changes:**
- Detect if COE is being created by client (user.role === 'client')
- Set status to 'request' for client-created COEs
- Set status to 'draft' for admin-created COEs

```javascript
// In handleCreateCOEDraft, before creating COE:
// Determine initial status based on creator
let initialStatus = 'draft'; // Default for admin
if (user.role === 'client') {
  initialStatus = 'request'; // User-requested COEs
}

// Set status in coeData
coeData.status = initialStatus;
```

**File:** `server/services/coeService.js` → `createCOE()`

**Changes:**
- Ensure status from coeData is preserved (already handled if passed)
- Add logging for status assignment

#### 1.4 Update Status Update Endpoint Authorization

**File:** `server/routes/coes.js` → `PUT /v1/coes/:id/status`

**Current:** Admin-only (`requireAdmin` middleware)

**New Authorization Logic:**
1. **Admin**: Can change any COE status (keep existing behavior)
2. **Client**: Can change status to 'cancelled' ONLY if:
   - COE `client_id` matches user ID
   - Current status is: 'request', 'draft', 'approved', or 'pending_pay'
   - New status is 'cancelled'
   - Status transition is valid

**Implementation:**
```javascript
router.put('/:id/status', authenticateToken, async (req, res) => {
  // ... existing validation ...
  
  const coe = await COE.findById(id);
  if (!coe) {
    return res.status(404).json({ success: false, message: 'COE not found' });
  }
  
  // Authorization check
  const isAdmin = req.user.role === 'admin';
  const isClientOwner = coe.client_id.toString() === req.user.id.toString();
  
  // Allow client to cancel their own COEs (from certain statuses)
  const clientCancelAllowed = isClientOwner && 
                              value.status === 'cancelled' &&
                              ['request', 'draft', 'approved', 'pending_pay'].includes(coe.status);
  
  if (!isAdmin && !clientCancelAllowed) {
    return res.status(403).json({
      success: false,
      message: 'Permission denied. Only admins can change COE status, or clients can cancel their own COEs before payment.'
    });
  }
  
  // ... rest of status update logic ...
});
```

#### 1.5 Update Validation Schemas

**File:** `server/utils/validationSchemas.js`

**Changes:**
- Add 'request' to status enum in `updateCOEStatusSchema`
- Add 'request' to status enum in `createCOESchema` (if status is provided)

```javascript
updateCOEStatusSchema: Joi.object({
  status: Joi.string().valid(
    'draft', 'request', 'approved', 'pending_pay', 'paid', 
    'rejected', 'expired', 'completed', 'cancelled'
  ).required()
})
```

#### 1.6 Update Edit Permissions Helper

**File:** `server/utils/coeUtils.js` → `canClientEditCOE()`

**Changes:**
- Include 'request' status in the check (same logic as 'draft')
- Client-created 'request' COEs cannot be edited by client (same as draft)

```javascript
function canClientEditCOE(coe, userId, user) {
  if (user.role === 'admin') {
    return { canEdit: true };
  }
  
  // For request and draft: client cannot edit if they created it
  if (coe.status === 'draft' || coe.status === 'request') {
    const createdById = coe.created_by?._id?.toString() || 
                       coe.created_by?.toString();
    const userIdStr = userId?.toString();
    const isClientCreator = createdById && userIdStr && createdById === userIdStr;
    
    const clientIdStr = (coe.client_id?._id?.toString() || coe.client_id?.toString());
    const isClientOwner = clientIdStr && userIdStr && clientIdStr === userIdStr;
    
    if (isClientCreator && isClientOwner && (coe.status === 'draft' || coe.status === 'request')) {
      return { 
        canEdit: false, 
        reason: 'You cannot edit this COE until it is approved by an admin' 
      };
    }
  }
  
  // For non-draft/request COEs, check feature flag
  if (coe.status !== 'draft' && coe.status !== 'request') {
    const { isClientCOEEditingEnabled } = require('./featureFlags');
    return { 
      canEdit: isClientCOEEditingEnabled(),
      reason: isClientCOEEditingEnabled() ? undefined : 'Client COE editing is disabled'
    };
  }
  
  // For approved+ COEs created by client, allow editing if feature flag enabled
  const { isClientCOEEditingEnabled } = require('./featureFlags');
  return { 
    canEdit: isClientCOEEditingEnabled(),
    reason: isClientCOEEditingEnabled() ? undefined : 'Client COE editing is disabled'
  };
}
```

#### 1.7 Update Payment Restrictions

**File:** `server/routes/coes.js` → Payment endpoints

**Changes:**
- Ensure 'request' status COEs cannot be paid (same as 'draft')
- Update error message to mention both statuses

```javascript
// In payment endpoints (e.g., POST /v1/coes/:id/payments/full)
if (coe.status === 'draft' || coe.status === 'request') {
  return res.status(403).json({
    success: false,
    message: 'COE must be approved by admin before payment'
  });
}
```

---

### Phase 2: Mobile App Changes

#### 2.1 COE Card Component - Visual Distinction

**File:** `mobile/src/components/COECard.js`

**Changes:**
- Add visual badge/indicator for 'request' status
- Show different text/label for 'request' vs 'draft'
- Use different color scheme or icon

**Implementation:**
```javascript
// In COECard component render
const getStatusDisplay = (status) => {
  switch (status) {
    case 'request':
      return { 
        label: 'Requested', 
        color: '#FFA500', // Orange
        icon: '📋', // Or icon component
        badgeText: 'Awaiting Admin Review'
      };
    case 'draft':
      return { 
        label: 'Draft', 
        color: '#808080', // Gray
        icon: '📝',
        badgeText: userRole === 'admin' ? 'Admin Draft' : 'Draft'
      };
    // ... other statuses
  }
};
```

#### 2.2 COE Detail Screen - Visual Indicators

**File:** `mobile/app/coe-detail.js`

**Changes:**
- Show prominent status badge at top
- Different styling for 'request' status
- Add status description text

**Implementation:**
- Add status badge component with conditional styling
- Show "Requested - Awaiting Admin Review" for request status
- Show "Draft" for draft status

#### 2.3 COE List Screens - Filtering & Display

**Files:** 
- `mobile/app/(tabs)/index.js` (COE list)
- `mobile/app/client-coes.js` (Client COEs view)

**Changes:**
- Ensure both 'request' and 'draft' COEs are visible to users
- Visual distinction in list view
- Filter options if needed

#### 2.4 Cancel Button for Clients

**File:** `mobile/app/coe-detail.js`

**Changes:**
- Show "Cancel" button for clients when status is: 'request', 'draft', 'approved', 'pending_pay'
- Hide cancel button for 'paid', 'completed', 'cancelled' statuses
- Add confirmation modal before cancellation

**Implementation:**
```javascript
// Determine if cancel button should be shown
const canCancel = (coe.status === 'request' || 
                  coe.status === 'draft' || 
                  coe.status === 'approved' || 
                  coe.status === 'pending_pay') &&
                  user?.role === 'client' &&
                  coe.client_id?.toString() === user?.id?.toString();

// Cancel handler
const handleCancel = async () => {
  // Show confirmation modal
  // Call API: PUT /v1/coes/:id/status { status: 'cancelled' }
};
```

---

### Phase 3: Backend Authorization Implementation

#### 3.1 Status Update Route Authorization

**File:** `server/routes/coes.js` → `PUT /v1/coes/:id/status`

**Detailed Authorization Logic:**

```javascript
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    // ... existing ID validation ...
    
    // Fetch COE with populated client_id
    const coe = await COE.findById(id).populate('client_id', '_id');
    if (!coe) {
      return res.status(404).json({
        success: false,
        message: 'COE not found'
      });
    }
    
    // Validate request data
    const { error, value } = updateCOEStatusSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.details[0].message
      });
    }
    
    // Authorization checks
    const isAdmin = req.user.role === 'admin';
    const isClientOwner = coe.client_id?._id?.toString() === req.user.id.toString() ||
                          coe.client_id?.toString() === req.user.id.toString();
    
    // Allow client cancellation from specific statuses
    const clientCancelAllowed = !isAdmin && 
                                isClientOwner &&
                                value.status === 'cancelled' &&
                                ['request', 'draft', 'approved', 'pending_pay'].includes(coe.status);
    
    // Allow admin to change any status (existing behavior)
    if (!isAdmin && !clientCancelAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only admins can change COE status, or clients can cancel their own COEs before payment.',
        error: {
          code: 'PERMISSION_DENIED',
          current_status: coe.status,
          requested_status: value.status,
          user_role: req.user.role,
          is_owner: isClientOwner
        }
      });
    }
    
    // Additional validation for client cancellation
    if (clientCancelAllowed && coe.status === 'paid') {
      return res.status(403).json({
        success: false,
        message: 'Cannot cancel paid COEs. Please contact support for refunds.'
      });
    }
    
    // Proceed with status update
    const updatedCoe = await coeService.updateCOEStatus(id, value.status, req.user.id);
    
    res.json({
      success: true,
      message: 'COE status updated successfully',
      data: updatedCoe
    });
  } catch (error) {
    // ... error handling ...
  }
});
```

#### 3.2 Authorization Helper Function

**File:** `server/utils/coeUtils.js` (or create new authorization helper)

**New Function:**
```javascript
/**
 * Check if user can update COE status
 * @param {Object} coe - COE object
 * @param {string} userId - User ID attempting the change
 * @param {Object} user - User object (with role)
 * @param {string} newStatus - Status user wants to change to
 * @returns {Object} { canUpdate: boolean, reason?: string }
 */
function canUpdateCOEStatus(coe, userId, user, newStatus) {
  const isAdmin = user.role === 'admin';
  const isClientOwner = (coe.client_id?._id?.toString() || coe.client_id?.toString()) === userId?.toString();
  
  // Admin can always change status
  if (isAdmin) {
    return { canUpdate: true };
  }
  
  // Client can only cancel their own COEs (from specific statuses)
  if (newStatus === 'cancelled' && isClientOwner) {
    const cancelableStatuses = ['request', 'draft', 'approved', 'pending_pay'];
    if (cancelableStatuses.includes(coe.status)) {
      return { canUpdate: true };
    }
    return { 
      canUpdate: false, 
      reason: `Cannot cancel COE from ${coe.status} status. Only admins can cancel paid COEs.` 
    };
  }
  
  // Client cannot change status in other scenarios
  return { 
    canUpdate: false, 
    reason: 'Only admins can change COE status, or clients can cancel their own COEs before payment.' 
  };
}
```

---

### Phase 4: Documentation Updates

#### 4.1 Update COE-STATUS-FLOW.md

**Changes:**
- Add 'request' status to enum section
- Update valid transitions diagram
- Update status details section
- Update permissions matrix
- Add 'request' status examples to typical flows
- Update date fields section (if 'request' needs special date handling)
- Update business validation rules
- Update testing scenarios

#### 4.2 Update FEATURE-FLAGS.md

**Changes:**
- Update descriptions to mention 'request' status
- Clarify that client-created COEs become 'request' status

#### 4.3 Update Other Relevant Docs

**Files to review:**
- `MOBILE-CREATE-COE-IMPLEMENTATION-PLAN.md` - Update to mention 'request' status
- `COE-STATUS-FLOW-TESTING.md` - Add test cases for 'request' status and client cancellation
- Any API documentation

---

### Phase 5: Testing Requirements

#### 5.1 Status Transition Tests

1. **Client creates COE** → Status should be 'request' (not 'draft')
2. **Admin creates COE** → Status should be 'draft' (existing behavior)
3. **Admin approves 'request' COE** → Status changes to 'approved'
4. **Admin cancels 'request' COE** → Status changes to 'cancelled'
5. **Client cancels 'request' COE** → Status changes to 'cancelled'
6. **Client cancels 'approved' COE** → Status changes to 'cancelled' ✅ NEW
7. **Client tries to cancel 'paid' COE** → Should fail with 403
8. **Client tries to pay 'request' COE** → Should fail (must be approved first)

#### 5.2 Authorization Tests

1. **Client cancels their own COE** (request/draft/approved/pending_pay) → ✅ Success
2. **Client cancels another client's COE** → ❌ 403 error
3. **Client tries to approve their own COE** → ❌ 403 error
4. **Admin cancels any COE** → ✅ Success
5. **Admin approves 'request' COE** → ✅ Success

#### 5.3 Visual Tests

1. **Mobile app shows 'request' badge** on COE cards
2. **Mobile app shows 'draft' badge** on admin-created COEs
3. **Users can distinguish** between 'request' and 'draft' COEs
4. **Cancel button appears** for clients on appropriate statuses
5. **Cancel button hidden** for clients on 'paid' status

---

## Authorization Summary

### Who Can Do What

| Action | Admin | Client (Owner) | Client (Other) |
|--------|:-----:|:--------------:|:--------------:|
| Create COE → 'draft' | ✅ | ❌ | ❌ |
| Create COE → 'request' | ❌ | ✅ | ❌ |
| Cancel 'request' COE | ✅ | ✅ | ❌ |
| Cancel 'draft' COE | ✅ | ✅ (if owner) | ❌ |
| Cancel 'approved' COE | ✅ | ✅ (if owner) | ❌ |
| Cancel 'pending_pay' COE | ✅ | ✅ (if owner) | ❌ |
| Cancel 'paid' COE | ✅ | ❌ | ❌ |
| Approve 'request' COE | ✅ | ❌ | ❌ |
| Edit 'request' COE | ✅ | ❌ (view-only) | ❌ |
| Pay 'request' COE | ❌ | ❌ | ❌ |
| Pay 'approved' COE | ❌ | ✅ (if owner) | ❌ |

### Authorization Rules

1. **COE Creation**:
   - Admin creates → status = 'draft'
   - Client creates → status = 'request'

2. **Status Updates**:
   - Admin: Can change any COE to any valid status
   - Client: Can only change their own COE status to 'cancelled' (from: request, draft, approved, pending_pay)

3. **Editing**:
   - Admin: Can always edit
   - Client: Cannot edit 'request' or 'draft' COEs they created (view-only until approved)
   - Client: Can edit approved+ COEs if feature flag enabled

4. **Payment**:
   - Only 'approved' status COEs can be paid
   - 'request' and 'draft' status COEs cannot be paid

---

## Visual Distinction Requirements

### Mobile App - COE Card

**For 'request' Status:**
- **Badge Color**: Orange (#FFA500) or similar attention color
- **Badge Text**: "Requested" or "Awaiting Review"
- **Additional Indicator**: Optional icon or secondary badge
- **Status Description**: "Your request is awaiting admin review"

**For 'draft' Status (User View):**
- **Badge Color**: Gray (#808080)
- **Badge Text**: "Draft"
- **Status Description**: "Admin is building this experience"

**For 'draft' Status (Admin View):**
- **Badge Color**: Blue or Gray
- **Badge Text**: "Draft" or "Admin Draft"
- **Status Description**: "This COE is being built"

### Mobile App - COE Detail Screen

**Request Status:**
- Show prominent orange badge at top
- Message: "Your experience request is awaiting admin review. THE1 will update you once it's ready."
- Show "Cancel Request" button (if client owner)

**Draft Status (User View):**
- Show gray badge
- Message: "This experience is being built by your concierge."
- Hide action buttons (view-only)

---

## API Changes Summary

### Endpoints Modified

1. **PUT /v1/coes/:id/status**
   - **Authorization Change**: Allow clients to cancel their own COEs
   - **Request Body**: No change (still `{ status: 'cancelled' }`)
   - **Response**: Same structure
   - **New Error**: 403 if client tries to cancel paid COE

### New/Updated Validation

- Status enum now includes 'request'
- Status transitions updated
- Client cancellation authorization added

---

## Database Migration Considerations

### Existing Data

- **Existing 'draft' COEs**: Remain as 'draft' (no migration needed)
- **No 'request' COEs exist yet**: Safe to add enum value
- **Indexes**: Status field already indexed, no changes needed

### Migration Steps

1. Update COE model enum to include 'request'
2. No data migration needed (new status for new COEs only)
3. Verify existing queries/filters work with new status

---

## Rollback Plan

If issues arise:

1. **Remove 'request' status**: Revert enum changes
2. **Revert client cancellation**: Re-add `requireAdmin` middleware
3. **Keep visual changes**: Can keep even if status removed (treat 'request' as 'draft')

**Note**: Rolling back won't affect existing COEs, only new ones.

---

## Implementation Checklist

### Backend
- [x] Update COE model status enum
- [x] Update status transition validation
- [x] Update COE creation logic (client → 'request', admin → 'draft')
- [x] Update status update endpoint authorization
- [x] Update `canClientEditCOE` helper
- [x] Update payment restrictions
- [x] Update validation schemas
- [x] Add authorization helper function
- [x] Add comprehensive logging

### Mobile App
- [x] Update COECard component with visual distinction
- [x] Update COE detail screen with status indicators
- [x] Add cancel button for clients
- [x] Add cancel confirmation modal
- [x] Update COE list screens to show both statuses
- [x] Test visual distinction on all screens
- [x] Update "Create Experience" to "Request Experience" button text
- [x] Update form messages to use "request" language for clients
- [x] Fix keyboard handling for forms vs message input

### Documentation
- [x] Update COE-STATUS-FLOW.md
- [x] Update FEATURE-FLAGS.md
- [x] Update MOBILE-CREATE-COE-IMPLEMENTATION-PLAN.md
- [ ] Update COE-STATUS-FLOW-TESTING.md (if needed)
- [x] Update API documentation (via code comments)

### Testing
- [x] Test client COE creation → 'request' status
- [x] Test admin COE creation → 'draft' status
- [x] Test client cancellation from all allowed statuses
- [x] Test client cannot cancel paid COE
- [x] Test admin can approve 'request' COE
- [x] Test visual distinction in mobile app
- [x] Test authorization edge cases

---

## Questions for Clarification

1. **Visual Design**: What specific colors/icons should be used for 'request' status? (Proposed: Orange badge)
2. **Cancel Confirmation**: Should cancellation require confirmation? (Recommended: Yes)
3. **Cancel Message**: Custom message when client cancels? (e.g., "Are you sure you want to cancel this experience request?")
4. **Status History**: Should 'request' status be logged differently in status history? (Future enhancement)
5. **Notifications**: Should client receive notification when their 'request' is approved? (Already handled if notification system exists)
6. **Bulk Operations**: Can admin bulk-approve 'request' COEs? (Future enhancement)

---

## Approval Required

**Before Implementation:**
- ✅ Review authorization logic
- ✅ Confirm status transitions
- ✅ Approve visual design direction
- ✅ Confirm cancel confirmation flow
- ✅ Review testing requirements

**Implementation Authorization:** ✅ **APPROVED AND COMPLETED**

---

## Recent Changes (January 2025)

### Keyboard Handling Improvements
- **Fixed:** Bot controls keyboard behavior - bot message input pushes controls up above keyboard, form fields allow keyboard overlay
- **Fixed:** Form padding reduced from 300px to 20px to eliminate unexpected gaps
- **Implementation:** Keyboard listeners detect MessageInput focus vs form field focus for different behavior
- **Files Modified:**
  - `mobile/app/(tabs)/bot.js` - Keyboard handling logic
  - `mobile/src/components/COECreateForm.js` - Removed nested KeyboardAvoidingView
  - `mobile/src/components/COEPreferencesForm.js` - Removed nested KeyboardAvoidingView
  - `mobile/src/components/MessageInput.js` - Added onFocus/onBlur callbacks

### Status Implementation Completed
All features from this plan have been implemented:
- ✅ 'request' status added and working
- ✅ Client cancellation implemented
- ✅ Visual distinction in mobile app
- ✅ All validations and permissions updated

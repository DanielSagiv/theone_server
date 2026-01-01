# Duplicate Notification Investigation Report

**Date:** 2024-12-19  
**Issue:** Users receive 2 duplicate notifications for every 1 message sent  
**Status:** 🔍 Investigation Complete - Root Cause Identified

---

## Issue Description

For every message sent in a COE thread, users receive **2 identical notifications** instead of 1. The actual message appears correctly in the message thread (only once), but the notification alert is duplicated.

---

## Investigation Findings

### 1. Notification Creation Flow

**Location:** `server/services/messagingService.js`

**Flow:**
1. Message is created and saved (line 268-276)
2. Message sender is populated (line 279)
3. COE participants are retrieved (line 282)
4. Loop through participants and create notifications (lines 287-301)

**Code Reference:**
```287:301:server/services/messagingService.js
for (const participantId of participants) {
  try {
    await notificationService.createAndSendNotification(participantId, 'coe_message', {
      coe_id: coeId,
      message_id: message._id,
      sender_id: message.sender_id, // ⚠️ POTENTIAL ISSUE
      coe: { name: coe.name },
      sender_name: message.sender_name,
      message_preview: messagePreview
    });
  } catch (error) {
    console.error(`[MessagingService] Failed to send notification to ${participantId}:`, error);
    // Continue with other participants even if one fails
  }
}
```

---

### 2. Participant Collection Logic

**Location:** `server/services/messagingService.js` - `getCOEParticipants()` function

**Analysis:**
- Uses `Set` to prevent duplicate user IDs ✅
- Collects participants from:
  1. `coe.client_id`
  2. `coe.admin_id`
  3. `coe.runner_assignment.runner_id` (COE-level)
  4. `coe.events[].runner_assignment.runner_id` (event-level)
  5. `coe.participants[].user_id` (participants array)

**Code Reference:**
```138:178:server/services/messagingService.js
function getCOEParticipants(coe, excludeUserId = null) {
  const participants = new Set();
  const excludeIdStr = excludeUserId ? excludeUserId.toString() : null;

  // Add client
  if (coe.client_id && coe.client_id.toString() !== excludeIdStr) {
    participants.add(coe.client_id.toString());
  }

  // Add admin
  if (coe.admin_id && coe.admin_id.toString() !== excludeIdStr) {
    participants.add(coe.admin_id.toString());
  }

  // Add runner (COE-level)
  if (coe.runner_assignment?.runner_id && 
      coe.runner_assignment.runner_id.toString() !== excludeIdStr) {
    participants.add(coe.runner_assignment.runner_id.toString());
  }

  // Add runners (event-level)
  if (coe.events && Array.isArray(coe.events)) {
    for (const event of coe.events) {
      if (event.runner_assignment?.runner_id &&
          event.runner_assignment.runner_id.toString() !== excludeIdStr) {
        participants.add(event.runner_assignment.runner_id.toString());
      }
    }
  }

  // Add participants
  if (coe.participants && Array.isArray(coe.participants)) {
    for (const participant of coe.participants) {
      if (participant.user_id && participant.user_id.toString() !== excludeIdStr) {
        participants.add(participant.user_id.toString());
      }
    }
  }

  return Array.from(participants);
}
```

**Assessment:** ✅ The `Set` should prevent duplicate user IDs in the participants array.

---

### 3. Potential Root Causes

#### 🔴 **ROOT CAUSE #1: Populated Object vs ObjectId Mismatch**

**Issue:** On line 292, `message.sender_id` is a **populated Mongoose object**, not an ObjectId.

**Code:**
```279:292:server/services/messagingService.js
// Populate sender for response
await message.populate('sender_id', 'firstName lastName avatarUrl');

// ... later ...

sender_id: message.sender_id, // ⚠️ This is a populated object, not an ObjectId!
```

**Problem:** When `message.sender_id` is passed as a populated object, it might be:
1. Stored incorrectly in the notification `data.sender_id` field
2. Causing issues when comparing or querying
3. Potentially triggering duplicate creation logic

**Expected:** Should pass `message.sender_id._id` or `userId` (the original sender ID).

---

#### 🟡 **ROOT CAUSE #2: No Duplicate Prevention in Notification Model**

**Issue:** The `Notification` model has **no unique index** to prevent duplicate notifications.

**Current Indexes:**
```82:84:server/models/Notification.js
notificationSchema.index({ user_id: 1, read: 1 });
notificationSchema.index({ user_id: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
```

**Missing:** No unique compound index on `(user_id, type, message_id)` or similar.

**Impact:** If `createAndSendNotification` is called twice (due to retry, race condition, or bug), both notifications will be saved.

---

#### 🟡 **ROOT CAUSE #3: No Idempotency Check in createNotification**

**Issue:** The `createNotification` function doesn't check if a notification already exists before creating a new one.

**Code:**
```190:218:server/services/notificationService.js
async function createNotification(userId, type, data) {
  try {
    const content = generateNotificationContent(type, data);
    const actionUrl = generateDeepLink(type, data);

    const notification = new Notification({
      user_id: userId,
      type,
      title: content.title,
      body: content.body,
      data: {
        coe_id: data.coe_id,
        message_id: data.message_id,
        payment_id: data.payment_id,
        sender_id: data.sender_id,
        action: type,
        action_url: actionUrl
      },
      read: false,
      sent: false
    });

    await notification.save(); // ⚠️ No check for existing notification
    return notification;
  } catch (error) {
    console.error('[NotificationService] Error creating notification:', error);
    throw error;
  }
}
```

**Impact:** If called twice for the same message, two notifications will be created.

---

#### 🟡 **ROOT CAUSE #4: Potential Double Call from Route Handler**

**Investigation:** Checked `routes/messaging.js` - the route handler calls `sendCOEMessage` **once** ✅

**Code:**
```76:80:server/routes/messaging.js
const message = await messagingService.sendCOEMessage(
  req.params.coeId,
  req.user._id,
  value.content
);
```

**Assessment:** ✅ Route handler is correct - only calls service once.

---

### 4. Most Likely Root Cause

**🔴 ROOT CAUSE #1** is the most likely culprit:

**The Problem:**
1. `message.sender_id` is populated on line 279
2. The populated object is passed to `createAndSendNotification` on line 292
3. When stored in `notification.data.sender_id`, it might be stored as an object instead of ObjectId
4. This could cause:
   - Database inconsistencies
   - Query issues
   - Potential duplicate detection failures

**Evidence:**
- The code passes `message.sender_id` (populated object) instead of `userId` (the original sender ID)
- This is inconsistent with how other IDs are passed (e.g., `coeId`, `message._id` are ObjectIds)

---

## Recommended Fixes

### Fix #1: Pass ObjectId Instead of Populated Object (HIGH PRIORITY)

**Change:**
```javascript
// BEFORE (line 292):
sender_id: message.sender_id, // Populated object

// AFTER:
sender_id: userId, // Use the original sender ID (ObjectId)
```

**Or:**
```javascript
sender_id: message.sender_id._id || message.sender_id, // Handle both cases
```

---

### Fix #2: Add Duplicate Prevention Check (MEDIUM PRIORITY)

**Add to `createNotification` function:**
```javascript
async function createNotification(userId, type, data) {
  try {
    // Check for existing notification (idempotency)
    if (data.message_id) {
      const existing = await Notification.findOne({
        user_id: userId,
        type: type,
        'data.message_id': data.message_id
      });
      
      if (existing) {
        console.log('[NotificationService] Duplicate notification prevented:', {
          userId,
          type,
          message_id: data.message_id
        });
        return existing; // Return existing instead of creating new
      }
    }
    
    // ... rest of function
  }
}
```

---

### Fix #3: Add Unique Index to Notification Model (MEDIUM PRIORITY)

**Add to `Notification` model:**
```javascript
// Prevent duplicate notifications for the same message
notificationSchema.index(
  { user_id: 1, type: 1, 'data.message_id': 1 },
  { unique: true, sparse: true } // sparse: only enforce when message_id exists
);
```

**Note:** This would require a migration and might fail if duplicates already exist.

---

## Testing Recommendations

1. **Check Database:**
   ```javascript
   // Query for duplicate notifications
   db.notifications.aggregate([
     {
       $match: {
         type: 'coe_message',
         'data.message_id': { $exists: true }
       }
     },
     {
       $group: {
         _id: {
           user_id: '$user_id',
           message_id: '$data.message_id'
         },
         count: { $sum: 1 },
         notifications: { $push: '$_id' }
       }
     },
     {
       $match: { count: { $gt: 1 } }
     }
   ])
   ```

2. **Add Logging:**
   - Log when `createAndSendNotification` is called
   - Log the participants array
   - Log when notifications are created
   - Check for duplicate calls

3. **Test Scenarios:**
   - Send message as client
   - Send message as admin
   - Send message as runner
   - Send message as participant
   - Check notification count for each recipient

---

## Summary

**Primary Issue:** `message.sender_id` is passed as a populated object instead of ObjectId, which may cause storage/query issues.

**Secondary Issues:**
- No duplicate prevention in notification creation
- No unique index to prevent duplicates at database level

**Recommended Action:** Fix the `sender_id` parameter first (Fix #1), then add duplicate prevention (Fix #2).

---

## Next Steps

1. ✅ Investigation complete
2. ⏳ Await user confirmation before implementing fixes
3. ⏳ Implement Fix #1 (sender_id ObjectId)
4. ⏳ Implement Fix #2 (duplicate prevention check)
5. ⏳ Test and verify


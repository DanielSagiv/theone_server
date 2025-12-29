# Messaging Thread & Push Notifications Feature
## The1 Platform - Combined Implementation Plan

**Status**: 📋 Planning  
**Version**: 1.0  
**Last Updated**: December 2025  
**Priority**: P1 (High, but not blocking MVP)

---

## Overview

This document outlines the implementation plan for **Messaging Thread** and **Push Notifications** features, implemented together as a unified system. These features are bundled because they share infrastructure, provide natural integration, and deliver better user experience when implemented together.

---

## Executive Summary

### Features

1. **Messaging Thread** - COE-scoped messaging system allowing clients, admins, and runners to communicate about specific COEs
2. **Push Notifications** - Real-time notifications for COE status changes and new messages

### Key Decisions

- ✅ **Bundled Implementation**: Both features implemented together for efficiency
- ✅ **Mobile**: Expo Notifications (not Firebase SDK directly)
- ✅ **Backend**: Firebase Admin SDK for sending notifications via FCM/APNs
- ✅ **Architecture**: Unified notification system serving both features

### Why Bundle Together?

1. **Natural Integration**: Messaging threads need notifications for new messages
2. **Shared Infrastructure**: Both require push token management, FCM/APNs, deep linking
3. **Better UX**: Unified notification center for all notifications
4. **Implementation Efficiency**: ~30-40% time savings vs separate implementations
5. **Maintenance**: Single system to maintain instead of two

---

## Current State Analysis

### Existing Implementation

#### Backend
- ❌ **No Messaging System** - No COE-scoped messaging endpoints
- ❌ **No Push Notifications** - No notification infrastructure
- ✅ **Bot Conversation** - User-scoped chat (not COE-scoped)
- ✅ **Email Service** - AWS SES integration exists (`utils/emailService.js`)

#### Mobile App
- ❌ **No Messaging Screens** - No COE messaging UI
- ❌ **No Push Notifications** - No notification handling
- ✅ **Bot Chat Screen** - General bot conversation exists
- ✅ **Expo Setup** - Expo ~54.0.0 configured

### MVP Specification Requirements

| Feature | MVP Status | Current Status | Priority |
|---------|------------|----------------|----------|
| Messaging Thread | Required (P1) | ❌ Not implemented | P1 |
| Push Notifications | Required (P1) | ❌ Not implemented | P1 |

---

## Architecture Overview

### Technology Stack

**Mobile (Expo):**
- `expo-notifications` - Push notification handling
- Expo manages FCM (Android) and APNs (iOS) automatically
- No Firebase SDK needed on mobile

**Backend (Node.js):**
- `firebase-admin` - Send notifications via FCM
- FCM handles Android directly and forwards to APNs for iOS
- MongoDB for notification and message storage

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Mobile App (Expo)                         │
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐        │
│  │ Messaging Screen │         │ Notification      │        │
│  │ (COE-scoped)     │         │ Handler           │        │
│  └────────┬─────────┘         └────────┬─────────┘        │
│           │                             │                   │
│           └─────────────┬───────────────┘                   │
│                         │                                    │
│                  expo-notifications                          │
│                         │                                    │
│  Gets push token (FCM/APNs)                                 │
│  Registers with backend                                      │
│  Receives notifications                                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          │ HTTP API
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    Backend Server                            │
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐        │
│  │ Messaging        │         │ Notification     │        │
│  │ Service          │         │ Service          │        │
│  └────────┬─────────┘         └────────┬─────────┘        │
│           │                             │                   │
│           └─────────────┬───────────────┘                   │
│                         │                                    │
│                  firebase-admin                              │
│                         │                                    │
│  Sends via FCM (Android + iOS)                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          │ FCM/APNs
                          │
┌─────────────────────────▼───────────────────────────────────┐
│              Firebase Cloud Messaging (FCM)                 │
│                                                              │
│  Android: Direct delivery                                   │
│  iOS: Forwards to APNs                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature 1: Messaging Thread

### Overview

COE-scoped messaging system allowing users (clients, admins, runners) to communicate about specific COEs. Each COE has its own conversation thread.

### Requirements

1. **COE-Scoped Conversations**
   - Each COE has its own message thread
   - All participants can view and send messages
   - Message history persists per COE

2. **Participants**
   - Client (COE owner)
   - Admin (COE creator/manager)
   - Runner (if assigned to COE)
   - Participants (if multi-client COE)

3. **Features**
   - Send text messages
   - View message history
   - Read receipts (optional - Phase 2)
   - Message timestamps
   - Unread message count

### Data Model

**Message Model** (`models/Message.js`):

```javascript
{
  _id: ObjectId,
  coe_id: {
    type: ObjectId,
    ref: 'COE',
    required: true,
    index: true
  },
  sender_id: {
    type: ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sender_role: {
    type: String,
    enum: ['admin', 'client', 'runner'],
    required: true
  },
  sender_name: String, // Denormalized for quick display
  content: {
    type: String,
    required: true,
    maxlength: 2000
  },
  read_by: [{
    user_id: {
      type: ObjectId,
      ref: 'User'
    },
    read_at: {
      type: Date,
      default: Date.now
    }
  }],
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  }
}
```

**Indexes:**
- `coe_id + created_at` - For message history queries
- `sender_id` - For user message queries
- `coe_id + read_by.user_id` - For unread count queries

### API Endpoints

#### 1. Get COE Messages

**Endpoint**: `GET /v1/messaging/coe/:coeId`

**Description**: Get all messages for a specific COE

**Query Parameters**:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Messages per page (default: 50, max: 100)

**Authentication**: Required

**Authorization**: User must be participant in COE (client, admin, runner, or participant)

**Response**:
```javascript
{
  success: true,
  data: {
    messages: [
      {
        _id: "message_id",
        coe_id: "coe_id",
        sender_id: {
          _id: "user_id",
          firstName: "John",
          lastName: "Doe",
          avatarUrl: "https://..."
        },
        sender_role: "client",
        content: "Can we change the date?",
        read_by: [
          {
            user_id: "user_id",
            read_at: "2025-12-28T10:00:00Z"
          }
        ],
        created_at: "2025-12-28T09:00:00Z"
      }
    ],
    pagination: {
      total: 25,
      page: 1,
      limit: 50,
      total_pages: 1
    },
    unread_count: 3
  }
}
```

#### 2. Send Message

**Endpoint**: `POST /v1/messaging/coe/:coeId`

**Description**: Send a message to COE thread

**Request Body**:
```javascript
{
  content: "Can we change the date for Event 2?"
}
```

**Validation**:
- `content`: Required, string, min 1, max 2000 characters

**Authentication**: Required

**Authorization**: User must be participant in COE

**Response**:
```javascript
{
  success: true,
  data: {
    message: {
      _id: "message_id",
      coe_id: "coe_id",
      sender_id: {...},
      sender_role: "client",
      content: "Can we change the date for Event 2?",
      read_by: [],
      created_at: "2025-12-28T10:00:00Z"
    }
  }
}
```

**Side Effects**:
- Creates notification for all other participants
- Updates unread counts

#### 3. Mark Message as Read

**Endpoint**: `PUT /v1/messaging/:messageId/read`

**Description**: Mark a specific message as read

**Authentication**: Required

**Response**:
```javascript
{
  success: true,
  data: {
    message: {
      _id: "message_id",
      read_by: [
        {
          user_id: "current_user_id",
          read_at: "2025-12-28T10:05:00Z"
        }
      ]
    }
  }
}
```

#### 4. Get Unread Count

**Endpoint**: `GET /v1/messaging/coe/:coeId/unread`

**Description**: Get unread message count for current user

**Authentication**: Required

**Response**:
```javascript
{
  success: true,
  data: {
    unread_count: 3
  }
}
```

### Service Functions

**File**: `services/messagingService.js`

```javascript
/**
 * Get messages for a COE
 * @param {string} coeId - COE ID
 * @param {string} userId - Current user ID
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} Messages with pagination
 */
async function getCOEMessages(coeId, userId, pagination = {}) {
  // 1. Verify user has access to COE
  // 2. Query messages for COE
  // 3. Populate sender information
  // 4. Calculate unread count for user
  // 5. Return paginated results
}

/**
 * Send message to COE thread
 * @param {string} coeId - COE ID
 * @param {string} userId - Sender user ID
 * @param {string} content - Message content
 * @returns {Promise<Object>} Created message
 */
async function sendCOEMessage(coeId, userId, content) {
  // 1. Verify user has access to COE
  // 2. Get user role (admin/client/runner)
  // 3. Create message document
  // 4. Get all COE participants
  // 5. Create notifications for other participants
  // 6. Return created message
}

/**
 * Mark message as read
 * @param {string} messageId - Message ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated message
 */
async function markMessageAsRead(messageId, userId) {
  // 1. Find message
  // 2. Check if already read by user
  // 3. Add user to read_by array if not present
  // 4. Return updated message
}

/**
 * Get unread message count for user in COE
 * @param {string} coeId - COE ID
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
async function getUnreadCount(coeId, userId) {
  // 1. Get all messages for COE
  // 2. Count messages not in user's read_by array
  // 3. Return count
}

/**
 * Verify user has access to COE messaging
 * @param {string} coeId - COE ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if user has access
 */
async function verifyCOEAccess(coeId, userId) {
  // Check if user is:
  // - COE client (client_id)
  // - COE admin (admin_id)
  // - Assigned runner (runner_assignment.runner_id)
  // - Participant (participants array)
}
```

---

## Feature 2: Push Notifications

### Overview

Real-time push notifications for COE status changes and new messages. Notifications are delivered via Firebase Cloud Messaging (FCM) for Android and Apple Push Notification service (APNs) for iOS.

### Technology Decision: Expo Notifications + Firebase Admin

**Why Expo Notifications (not Firebase SDK)?**
- ✅ Works seamlessly with Expo
- ✅ Handles FCM (Android) and APNs (iOS) automatically
- ✅ No native code changes required
- ✅ Works in Expo Go for development
- ✅ Simple API for permissions and token management

**Why Firebase Admin SDK (backend)?**
- ✅ Official Firebase SDK for server-side
- ✅ Handles FCM for Android
- ✅ Can forward to APNs for iOS
- ✅ Reliable delivery
- ✅ Good documentation

### Requirements

1. **Notification Types**
   - COE status changes (approved, paid, completed, etc.)
   - New messages in COE threads
   - Payment received
   - Runner assignment
   - COE expiration

2. **Features**
   - Push token registration
   - Notification delivery
   - Deep linking to relevant screens
   - Notification history
   - Read/unread status
   - Notification preferences (optional - Phase 2)

### Data Model

**Notification Model** (`models/Notification.js`):

```javascript
{
  _id: ObjectId,
  user_id: {
    type: ObjectId,
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
    coe_id: ObjectId,
    message_id: ObjectId, // For messaging notifications
    payment_id: ObjectId, // For payment notifications
    action: String, // Deep link action
    action_url: String // Deep link URL
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
  read_at: Date,
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  }
}
```

**User Model Update** (`models/User.js`):

Add push token fields:
```javascript
push_tokens: [{
  token: {
    type: String,
    required: true,
    unique: true
  },
  platform: {
    type: String,
    enum: ['ios', 'android'],
    required: true
  },
  device_id: String, // Optional: for multi-device support
  registered_at: {
    type: Date,
    default: Date.now
  },
  last_used_at: Date
}]
```

**Indexes:**
- `user_id + read` - For unread notifications query
- `user_id + created_at` - For notification history
- `type + created_at` - For notification analytics

### API Endpoints

#### 1. Register Push Token

**Endpoint**: `POST /v1/users/push-token`

**Description**: Register device push token for notifications

**Request Body**:
```javascript
{
  token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  platform: "ios" // or "android"
}
```

**Authentication**: Required

**Response**:
```javascript
{
  success: true,
  message: "Push token registered successfully"
}
```

**Implementation**:
- Add token to user's `push_tokens` array
- If token exists, update `last_used_at`
- Support multiple devices per user

#### 2. Remove Push Token

**Endpoint**: `DELETE /v1/users/push-token`

**Description**: Remove push token (e.g., on logout)

**Request Body**:
```javascript
{
  token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

**Authentication**: Required

**Response**:
```javascript
{
  success: true,
  message: "Push token removed successfully"
}
```

#### 3. Get Notifications

**Endpoint**: `GET /v1/notifications`

**Description**: Get user's notification history

**Query Parameters**:
- `read` (optional): Filter by read status (true/false)
- `type` (optional): Filter by notification type
- `page` (optional): Page number (default: 1)
- `limit` (optional): Notifications per page (default: 20, max: 100)

**Authentication**: Required

**Response**:
```javascript
{
  success: true,
  data: {
    notifications: [
      {
        _id: "notification_id",
        type: "coe_approved",
        title: "Experience Approved",
        body: "Your experience 'Premium Package' has been approved",
        data: {
          coe_id: "coe_id",
          action: "view_coe",
          action_url: "the1://coe-detail?coeId=coe_id"
        },
        read: false,
        created_at: "2025-12-28T10:00:00Z"
      }
    ],
    pagination: {
      total: 50,
      page: 1,
      limit: 20,
      total_pages: 3
    },
    unread_count: 15
  }
}
```

#### 4. Mark Notification as Read

**Endpoint**: `PUT /v1/notifications/:notificationId/read`

**Description**: Mark notification as read

**Authentication**: Required

**Response**:
```javascript
{
  success: true,
  data: {
    notification: {
      _id: "notification_id",
      read: true,
      read_at: "2025-12-28T10:05:00Z"
    }
  }
}
```

#### 5. Mark All as Read

**Endpoint**: `PUT /v1/notifications/read-all`

**Description**: Mark all user's notifications as read

**Authentication**: Required

**Response**:
```javascript
{
  success: true,
  message: "All notifications marked as read"
}
```

#### 6. Get Unread Count

**Endpoint**: `GET /v1/notifications/unread-count`

**Description**: Get unread notification count

**Authentication**: Required

**Response**:
```javascript
{
  success: true,
  data: {
    unread_count: 15
  }
}
```

### Service Functions

**File**: `services/notificationService.js`

```javascript
const admin = require('firebase-admin');

/**
 * Initialize Firebase Admin (call once at startup)
 */
function initializeFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
      })
    });
  }
}

/**
 * Send push notification to user
 * @param {string} userId - User ID
 * @param {Object} notification - Notification data
 * @returns {Promise<Object>} Send result
 */
async function sendPushNotification(userId, notification) {
  // 1. Get user's push tokens
  // 2. Create notification document in database
  // 3. Send via FCM to all user's devices
  // 4. Update notification document with sent status
  // 5. Return result
}

/**
 * Create notification document
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {Object} data - Notification data
 * @returns {Promise<Object>} Created notification
 */
async function createNotification(userId, type, data) {
  // 1. Generate title and body based on type
  // 2. Create notification document
  // 3. Return notification
}

/**
 * Get user notifications
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} Notifications with pagination
 */
async function getUserNotifications(userId, filters = {}, pagination = {}) {
  // 1. Build query with filters
  // 2. Get paginated notifications
  // 3. Calculate unread count
  // 4. Return results
}

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated notification
 */
async function markAsRead(notificationId, userId) {
  // 1. Find notification
  // 2. Verify user owns notification
  // 3. Update read status
  // 4. Return updated notification
}

/**
 * Get unread notification count
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
async function getUnreadCount(userId) {
  // 1. Count unread notifications for user
  // 2. Return count
}

/**
 * Generate notification title and body
 * @param {string} type - Notification type
 * @param {Object} data - Notification data (COE, message, etc.)
 * @returns {Object} { title, body }
 */
function generateNotificationContent(type, data) {
  // Generate title and body based on type and data
  // Return formatted strings
}
```

### Notification Types & Content

| Type | Title | Body | Deep Link |
|------|-------|------|-----------|
| `coe_sent` | Experience Sent | "Your experience '{COE name}' has been sent for review" | `the1://coe-detail?coeId={id}` |
| `coe_approved` | Experience Approved | "Your experience '{COE name}' has been approved" | `the1://coe-detail?coeId={id}` |
| `coe_accepted` | Experience Accepted | "{Client name} accepted the experience '{COE name}'" | `the1://coe-detail?coeId={id}` |
| `coe_rejected` | Experience Rejected | "{Client name} rejected the experience '{COE name}'" | `the1://coe-detail?coeId={id}` |
| `coe_paid` | Payment Received | "Payment received for experience '{COE name}'" | `the1://coe-detail?coeId={id}` |
| `coe_completed` | Experience Completed | "Your experience '{COE name}' has been completed" | `the1://coe-detail?coeId={id}` |
| `coe_cancelled` | Experience Cancelled | "Experience '{COE name}' has been cancelled" | `the1://coe-detail?coeId={id}` |
| `coe_expired` | Experience Expired | "Experience '{COE name}' has expired" | `the1://coes` |
| `coe_message` | New Message | "{Sender name}: {Message preview}" | `the1://coe-messages?coeId={id}` |
| `payment_received` | Payment Received | "Payment of ${amount} received" | `the1://payment-detail?paymentId={id}` |
| `payment_failed` | Payment Failed | "Payment failed for experience '{COE name}'" | `the1://payment?coeId={id}` |
| `runner_assigned` | Runner Assigned | "You've been assigned as runner for '{COE name}'" | `the1://coe-detail?coeId={id}` |

---

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Goal**: Set up core infrastructure for notifications

#### Backend Tasks

1. **Create Notification Model** (2 hours)
   - Create `models/Notification.js`
   - Add indexes
   - Add validation

2. **Update User Model** (1 hour)
   - Add `push_tokens` array field
   - Add indexes

3. **Firebase Admin Setup** (2 hours)
   - Install `firebase-admin`
   - Create Firebase project
   - Configure service account
   - Add environment variables
   - Initialize Firebase Admin

4. **Notification Service** (4 hours)
   - Create `services/notificationService.js`
   - Implement `initializeFirebase()`
   - Implement `sendPushNotification()`
   - Implement `createNotification()`
   - Implement `getUserNotifications()`
   - Implement `markAsRead()`
   - Implement `getUnreadCount()`

5. **Push Token Endpoints** (3 hours)
   - `POST /v1/users/push-token` - Register token
   - `DELETE /v1/users/push-token` - Remove token
   - Add validation schemas

6. **Notification Endpoints** (4 hours)
   - `GET /v1/notifications` - Get notifications
   - `PUT /v1/notifications/:id/read` - Mark as read
   - `PUT /v1/notifications/read-all` - Mark all as read
   - `GET /v1/notifications/unread-count` - Get unread count

#### Mobile Tasks

1. **Install Expo Notifications** (1 hour)
   ```bash
   npx expo install expo-notifications
   ```

2. **Request Permissions** (2 hours)
   - Request notification permissions on app start
   - Handle permission states (granted, denied, etc.)

3. **Get Push Token** (2 hours)
   - Get Expo push token
   - Handle token refresh
   - Register token with backend on login

4. **Remove Token on Logout** (1 hour)
   - Remove token from backend on logout

5. **Handle Notification Receipt** (3 hours)
   - Listen for incoming notifications
   - Display notifications
   - Handle notification tap (deep linking)

**Total Backend**: ~16 hours  
**Total Mobile**: ~9 hours  
**Phase 1 Total**: ~25 hours (3-4 days)

---

### Phase 2: COE Status Notifications (Week 2-3)

**Goal**: Send notifications on COE status changes

#### Backend Tasks

1. **Integrate with COE Service** (4 hours)
   - Add notification triggers to `coeService.js`
   - Trigger on status changes: `approved`, `accepted`, `rejected`, `paid`, `completed`, `cancelled`, `expired`
   - Determine notification recipients (client, admin, runner)

2. **Notification Content Generation** (2 hours)
   - Create notification templates for each COE status
   - Generate deep links for each status type
   - Include COE name and relevant details

3. **Payment Notifications** (2 hours)
   - Trigger notifications on payment success/failure
   - Integrate with `paymentService.js`

4. **Runner Assignment Notifications** (2 hours)
   - Trigger notifications when runner is assigned
   - Notify runner and admin

#### Mobile Tasks

1. **Deep Link Handling** (4 hours)
   - Implement deep link routing
   - Handle COE detail deep links
   - Handle payment deep links
   - Handle COE list deep links

2. **Notification Badge** (2 hours)
   - Add unread count badge to navigation
   - Update badge on notification receipt
   - Update badge on notification read

**Total Backend**: ~10 hours  
**Total Mobile**: ~6 hours  
**Phase 2 Total**: ~16 hours (2 days)

---

### Phase 3: Messaging Thread (Week 3-4)

**Goal**: Implement COE-scoped messaging

#### Backend Tasks

1. **Create Message Model** (2 hours)
   - Create `models/Message.js`
   - Add indexes
   - Add validation

2. **Messaging Service** (6 hours)
   - Create `services/messagingService.js`
   - Implement `getCOEMessages()`
   - Implement `sendCOEMessage()`
   - Implement `markMessageAsRead()`
   - Implement `getUnreadCount()`
   - Implement `verifyCOEAccess()`

3. **Messaging Endpoints** (4 hours)
   - `GET /v1/messaging/coe/:coeId` - Get messages
   - `POST /v1/messaging/coe/:coeId` - Send message
   - `PUT /v1/messaging/:messageId/read` - Mark as read
   - `GET /v1/messaging/coe/:coeId/unread` - Get unread count

4. **Message Notifications** (3 hours)
   - Trigger notifications on new messages
   - Notify all COE participants except sender
   - Include message preview in notification

#### Mobile Tasks

1. **Messaging Screen** (8 hours)
   - Create `app/coe-messages.js`
   - Display message list
   - Message input component
   - Pull-to-refresh
   - Auto-scroll to bottom
   - Message timestamps
   - Sender avatars

2. **Integration with COE Detail** (2 hours)
   - Add "Messages" button to COE detail screen
   - Navigate to messaging screen
   - Show unread message badge

3. **Message Notifications** (3 hours)
   - Handle message notification deep links
   - Navigate to messaging screen on tap
   - Mark message as read when viewed

**Total Backend**: ~15 hours  
**Total Mobile**: ~13 hours  
**Phase 3 Total**: ~28 hours (3-4 days)

---

### Phase 4: Notification Center (Week 4-5)

**Goal**: Unified notification center UI

#### Mobile Tasks

1. **Notification List Screen** (6 hours)
   - Create `app/notifications.js`
   - Display notification list
   - Group by date
   - Filter by type
   - Pull-to-refresh
   - Mark as read on tap

2. **Notification Badge Component** (2 hours)
   - Reusable badge component
   - Update across all screens
   - Animate on change

3. **Notification Preferences** (4 hours, Optional)
   - Settings screen for notification preferences
   - Toggle notification types
   - Save preferences to backend

**Total Mobile**: ~12 hours (Optional: +4 hours)  
**Phase 4 Total**: ~12 hours (1-2 days)

---

## Environment Variables

### Backend (.env)

```bash
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com

# Optional: Firebase Database URL (if using Realtime Database)
FIREBASE_DATABASE_URL=https://your-project.firebaseio.com
```

### Mobile (app.json)

```json
{
  "expo": {
    "plugins": [
      [
        "expo-notifications",
        {
          "icon": "./assets/notification-icon.png",
          "color": "#FFD700",
          "sounds": ["./assets/notification-sound.wav"]
        }
      ]
    ]
  }
}
```

---

## Dependencies

### Backend

```json
{
  "firebase-admin": "^12.0.0"
}
```

**Installation**:
```bash
npm install firebase-admin
```

### Mobile

```json
{
  "expo-notifications": "~0.28.0"
}
```

**Installation**:
```bash
npx expo install expo-notifications
```

---

## Testing Plan

### Backend Tests

1. **Notification Service**
   - ✅ Send push notification successfully
   - ✅ Handle invalid push tokens
   - ✅ Create notification document
   - ✅ Get user notifications with filters
   - ✅ Mark notification as read
   - ✅ Get unread count

2. **Push Token Management**
   - ✅ Register push token
   - ✅ Update existing token
   - ✅ Remove push token
   - ✅ Handle multiple devices

3. **Messaging Service**
   - ✅ Get COE messages
   - ✅ Send message
   - ✅ Verify COE access
   - ✅ Mark message as read
   - ✅ Get unread count

4. **Integration Tests**
   - ✅ COE status change triggers notification
   - ✅ New message triggers notification
   - ✅ Payment triggers notification
   - ✅ Runner assignment triggers notification

### Mobile Tests

1. **Push Notifications**
   - ✅ Request permissions
   - ✅ Get push token
   - ✅ Register token with backend
   - ✅ Receive notification
   - ✅ Handle notification tap (deep link)
   - ✅ Remove token on logout

2. **Messaging**
   - ✅ Load message history
   - ✅ Send message
   - ✅ Receive new message
   - ✅ Mark message as read
   - ✅ Display unread count

3. **Notification Center**
   - ✅ Display notification list
   - ✅ Mark notification as read
   - ✅ Deep link navigation
   - ✅ Notification badge updates

---

## File Structure

### New Files

```
server/
├── models/
│   ├── Notification.js          # NEW - Notification model
│   └── Message.js               # NEW - Message model
├── services/
│   ├── notificationService.js   # NEW - Notification service
│   └── messagingService.js      # NEW - Messaging service
├── routes/
│   ├── notifications.js          # NEW - Notification endpoints
│   └── messaging.js              # NEW - Messaging endpoints
└── .env                          # UPDATE - Add Firebase config

mobile/
├── app/
│   ├── notifications.js          # NEW - Notification center screen
│   └── coe-messages.js          # NEW - COE messaging screen
├── src/
│   └── utils/
│       └── notificationUtils.js  # NEW - Notification utilities
└── app.json                      # UPDATE - Add expo-notifications plugin
```

### Updated Files

```
server/
├── models/
│   └── User.js                   # UPDATE - Add push_tokens field
├── services/
│   ├── coeService.js             # UPDATE - Add notification triggers
│   └── paymentService.js         # UPDATE - Add notification triggers
└── server.js                      # UPDATE - Initialize Firebase Admin

mobile/
├── app/
│   ├── _layout.js                # UPDATE - Add notification routes
│   ├── (tabs)/
│   │   └── index.js              # UPDATE - Add notification badge
│   └── coe-detail.js             # UPDATE - Add messages button
└── src/
    └── navigation/
        └── AuthContext.js        # UPDATE - Register push token on login
```

---

## Deep Linking

### URL Schemes

All deep links use the `the1://` scheme:

- `the1://coe-detail?coeId={id}` - Open COE detail screen
- `the1://coe-messages?coeId={id}` - Open COE messages screen
- `the1://payment-detail?paymentId={id}` - Open payment detail screen
- `the1://payment?coeId={id}` - Open payment screen
- `the1://coes` - Open COE list screen
- `the1://notifications` - Open notification center

### Implementation

**Mobile** (`app/_layout.js`):
```javascript
import * as Linking from 'expo-linking';

// Handle deep links
Linking.addEventListener('url', (event) => {
  const { path, queryParams } = Linking.parse(event.url);
  // Route to appropriate screen based on path
});
```

---

## Security Considerations

1. **Push Token Security**
   - Tokens stored encrypted in database
   - Tokens removed on logout
   - Validate token format before storing

2. **Message Access Control**
   - Verify user has access to COE before sending/viewing messages
   - Only COE participants can message

3. **Notification Access Control**
   - Users can only view their own notifications
   - Validate user ownership before marking as read

4. **Firebase Security**
   - Service account key stored in environment variables
   - Never commit Firebase credentials to git
   - Use least privilege IAM roles

---

## Performance Considerations

1. **Notification Batching**
   - Batch multiple notifications when possible
   - Rate limit notification sending

2. **Message Pagination**
   - Implement pagination for message history
   - Load messages on demand

3. **Unread Count Optimization**
   - Cache unread counts
   - Update counts incrementally

4. **Push Token Management**
   - Clean up invalid tokens
   - Handle token refresh automatically

---

## Future Enhancements

### Phase 2 Features

1. **Read Receipts**
   - Show who read messages
   - Read status indicators

2. **Message Attachments**
   - Support image/file attachments
   - Upload to S3

3. **Typing Indicators**
   - Show when user is typing
   - Real-time updates via WebSocket

4. **Notification Preferences**
   - User-configurable notification settings
   - Per-notification-type preferences

5. **Email Notifications**
   - Send email for important notifications
   - Digest emails for multiple notifications

6. **SMS Notifications** (Optional)
   - SMS for critical notifications
   - Twilio integration

---

## Related Documentation

- [Mobile App Implementation Plan](./MOBILE-APP-IMPLEMENTATION-PLAN.md) - Overall mobile app plan
- [COE Status Flow](./COE-STATUS-FLOW.md) - COE status transitions
- [MVP vs Implementation Differences](./MVP-vs-IMPLEMENTATION-DIFF.md) - Feature gaps
- [Email Service Specification](./email/email-service-specification.md) - Email service details

---

## Changelog

### Version 1.0 (December 2025)
- Initial feature specification
- Combined Messaging Thread + Push Notifications plan
- Expo Notifications + Firebase Admin architecture decision
- Complete implementation plan with phases
- API endpoint specifications
- Mobile screen designs

---

**Document Status**: Ready for Implementation  
**Estimated Total Time**: 4-5 weeks  
**Priority**: P1 (High, but not blocking MVP)


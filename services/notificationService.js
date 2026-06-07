const admin = require('firebase-admin');
const mongoose = require('mongoose');
const { Expo } = require('expo-server-sdk');
const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Normalize recipient id when persisting notifications (consistent ObjectId in Mongo).
 * @param {unknown} userId
 * @returns {unknown}
 */
function normalizeRecipientUserIdForWrite(userId) {
  if (userId == null) return userId;
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  const s = String(userId);
  if (mongoose.Types.ObjectId.isValid(s) && new mongoose.Types.ObjectId(s).toString() === s) {
    return new mongoose.Types.ObjectId(s);
  }
  return userId;
}

/**
 * Match notifications for this user (ObjectId or legacy string `user_id` in DB).
 * @param {unknown} userId
 * @returns {Record<string, unknown>}
 */
function recipientUserIdQuery(userId) {
  if (userId == null) return { user_id: userId };
  const s = String(userId);
  if (mongoose.Types.ObjectId.isValid(s) && new mongoose.Types.ObjectId(s).toString() === s) {
    const oid = new mongoose.Types.ObjectId(s);
    return { $or: [{ user_id: oid }, { user_id: s }] };
  }
  return { user_id: userId };
}

/**
 * Combine recipient match with additional AND conditions.
 * @param {unknown} userId
 * @param {Record<string, unknown>} extra
 * @returns {Record<string, unknown>}
 */
function notificationQueryForUser(userId, extra = {}) {
  const rec = recipientUserIdQuery(userId);
  if (!extra || Object.keys(extra).length === 0) {
    return rec;
  }
  if (rec.$or) {
    return { $and: [rec, extra] };
  }
  return { ...rec, ...extra };
}

/**
 * Notification Service
 * @description Handles push notifications and notification management
 */

let firebaseInitialized = false;
let expoClient = null;

/**
 * Initialize Expo Push Notification client
 */
function initializeExpo() {
  try {
    expoClient = new Expo();
    console.log('[NotificationService] Expo Push Notification client initialized');
  } catch (error) {
    console.error('[NotificationService] Failed to initialize Expo client:', error.message);
    expoClient = null;
  }
}

/**
 * Initialize Firebase Admin (call once at startup)
 * @description Sets up Firebase Admin SDK for sending push notifications
 */
function initializeFirebase() {
  try {
    if (!admin.apps.length && !firebaseInitialized) {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

      if (!projectId || !privateKey || !clientEmail) {
        console.warn('[NotificationService] Firebase credentials not configured. Push notifications will be disabled.');
        firebaseInitialized = false;
        return;
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey,
          clientEmail
        })
      });

      firebaseInitialized = true;
      console.log('[NotificationService] Firebase Admin initialized successfully');
      console.log('[NotificationService] Firebase Project ID:', projectId);
      console.log('[NotificationService] Firebase Client Email:', clientEmail);
    }
  } catch (error) {
    console.error('[NotificationService] Failed to initialize Firebase:', error.message);
    firebaseInitialized = false;
  }
}

/**
 * Generate notification title and body based on type and data
 * @param {string} type - Notification type
 * @param {Object} data - Notification data (COE, message, etc.)
 * @returns {Object} { title, body }
 */
function generateNotificationContent(type, data) {
  const coeName = data.coe?.name || data.coe_name || 'your experience';
  const senderName = data.sender_name || 'Someone';
  const amount = data.amount ? `$${data.amount.toFixed(2)}` : '';
  const messagePreview = data.message_preview || '';
  const revisionCase = data.revision_case || data.case_type || null;
  const revisionDeadlineHours =
    typeof data.revision_deadline_hours === 'number' ? data.revision_deadline_hours : null;
  const creditAmount =
    typeof data.credit_amount === 'number' ? data.credit_amount : null;

  const templates = {
    coe_sent: {
      title: 'Experience Sent',
      body: `Your experience '${coeName}' has been sent for review`
    },
    coe_requested: {
      title: 'New Experience Request',
      body: `${senderName} has requested an experience '${coeName}'. Review and approve.`
    },
    coe_approved: {
      title: 'Experience Approved',
      body: `Your experience '${coeName}' has been approved`
    },
    coe_accepted: {
      title: 'Experience Accepted',
      body: data.is_admin 
        ? `${senderName} accepted the experience '${coeName}'`
        : `You accepted the experience '${coeName}'`
    },
    coe_rejected: {
      title: 'Experience Rejected',
      body: data.is_admin
        ? `${senderName} rejected the experience '${coeName}'`
        : `You rejected the experience '${coeName}'`
    },
    coe_paid: {
      title: 'Payment Received',
      body: `Payment received for experience '${coeName}'`
    },
    coe_completed: {
      title: 'Experience Completed',
      body: `Your experience '${coeName}' has been completed`
    },
    coe_cancelled: {
      title: 'Experience Cancelled',
      body: `Experience '${coeName}' has been cancelled`
    },
    coe_expired: {
      title: 'Experience Expired',
      body: `Experience '${coeName}' has expired`
    },
    coe_revision_submitted: {
      title: revisionCase === 'full_decreased'
        ? 'Credit Available'
        : 'Experience Updated',
      body: (() => {
        const timerText =
          revisionDeadlineHours != null && revisionDeadlineHours > 0
            ? `You have ${revisionDeadlineHours} hours to accept.`
            : '';

        switch (revisionCase) {
          case 'deposit_increased':
            return `Your experience '${coeName}' cost increased. Please accept and pay the required deposit difference. ${timerText}`.trim();
          case 'deposit_decreased':
            return `Good news: your experience '${coeName}' is now cheaper. Please accept the updated changes. ${timerText}`.trim();
          case 'full_increased':
            return `Your experience '${coeName}' cost increased. Please accept and pay the required difference. ${timerText}`.trim();
          case 'full_decreased': {
            const creditText = creditAmount != null ? `$${creditAmount.toFixed(2)}` : 'a credit';
            return `Good news: your experience '${coeName}' is now cheaper. You have ${creditText} available as credit. Please accept to apply it. ${timerText}`.trim();
          }
          default:
            return `Your experience '${coeName}' has been updated. Please accept the changes.${timerText ? ' ' + timerText : ''}`.trim();
        }
      })()
    },
    coe_revision_reverted: {
      title: 'Revision Expired',
      body: `Your experience '${coeName}' revision window expired and was reverted to the last paid version.`
    },
    coe_message: {
      title: 'New Message',
      body: messagePreview 
        ? `${senderName}: ${messagePreview}`
        : `${senderName} sent a message in '${coeName}'`
    },
    payment_received: {
      title: 'Payment Received',
      body: amount 
        ? `Payment of ${amount} received`
        : 'Payment received successfully'
    },
    payment_failed: {
      title: 'Payment Failed',
      body: `Payment failed for experience '${coeName}'`
    },
    runner_assigned: {
      title: 'Runner Assigned',
      body: `You've been assigned as runner for '${coeName}'`
    },
    runner_updated: {
      title: 'Runner Updated',
      body: `Runner assignment updated for '${coeName}'`
    },
    seat_section_unavailable: {
      title: 'Seat section no longer available',
      body: data.message || (data.previous_total != null && data.new_total != null
        ? `No available tables in the selected section for some events. Amount reduced. Contact The1 for a different section. Total updated from $${Number(data.previous_total).toFixed(2)} to $${Number(data.new_total).toFixed(2)}. You can complete payment with the new amount.`
        : `Selected section is no longer available for some events in '${coeName}'. Amount was reduced. Contact The1 for a different seat section.`)
    },
    proposal_group_ready: {
      title: (() => {
        const n = Number(data.proposal_count);
        if (!Number.isFinite(n) || n < 1) return 'New proposals ready';
        return n === 1 ? '1 new proposal' : `${n} new proposals`;
      })(),
      body: 'Tap to review and choose your experience.'
    },
    admin_new_client_signup: {
      title: 'New client pending approval',
      body: `${senderName} signed up and is waiting for The1 approval.`
    }
  };

  return templates[type] || {
    title: 'Notification',
    body: 'You have a new notification'
  };
}

/**
 * Generate deep link URL for notification
 * @param {string} type - Notification type
 * @param {Object} data - Notification data
 * @returns {string} Deep link URL
 */
function generateDeepLink(type, data) {
  const baseUrl = 'the1://';

  if (type === 'proposal_group_ready' && data.proposal_group_id) {
    return `${baseUrl}coes?proposalGroupId=${encodeURIComponent(String(data.proposal_group_id))}`;
  }
  
  if (data.coe_id) {
    const coeId = data.coe_id.toString();
    
    switch (type) {
      case 'coe_message':
        return `${baseUrl}coe-messages?coeId=${coeId}`;
      case 'coe_sent':
      case 'coe_requested':
      case 'coe_approved':
      case 'coe_accepted':
      case 'coe_rejected':
      case 'coe_paid':
      case 'coe_completed':
      case 'coe_cancelled':
      case 'runner_assigned':
      case 'runner_updated':
        return `${baseUrl}coe-detail?coeId=${coeId}`;
      case 'coe_expired':
        return `${baseUrl}coes`;
      case 'payment_received':
      case 'payment_failed':
        if (data.payment_id) {
          return `${baseUrl}payment-detail?paymentId=${data.payment_id}`;
        }
        return `${baseUrl}coe-detail?coeId=${coeId}`;
      case 'seat_section_unavailable':
        return `${baseUrl}coe-detail?coeId=${coeId}`;
      case 'coe_revision_submitted':
        return `${baseUrl}coe-detail?coeId=${coeId}`;
      case 'coe_revision_reverted':
        return `${baseUrl}coe-detail?coeId=${coeId}`;
      default:
        return `${baseUrl}coe-detail?coeId=${coeId}`;
    }
  }
  
  return `${baseUrl}notifications`;
}

/**
 * Create notification document in database
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {Object} data - Notification data
 * @returns {Promise<Object>} Created notification
 */
async function createNotification(userId, type, data) {
  try {
    userId = normalizeRecipientUserIdForWrite(userId) ?? userId;

    // Check for existing notification to prevent duplicates (idempotency)
    
    // For coe_requested notifications, check for existing notification with same COE
    if (type === 'coe_requested' && data.coe_id) {
      const mongoose = require('mongoose');
      let coeIdStr = null;
      
      // Extract ObjectId string from various formats
      if (data.coe_id && data.coe_id.toString) {
        coeIdStr = data.coe_id.toString();
      } else if (typeof data.coe_id === 'string') {
        coeIdStr = data.coe_id;
      } else if (data.coe_id && data.coe_id._id) {
        // Handle populated object
        coeIdStr = data.coe_id._id.toString();
      }
      
      if (coeIdStr && mongoose.Types.ObjectId.isValid(coeIdStr)) {
        // Query using both ObjectId and string to catch any format
        const coeIdObj = new mongoose.Types.ObjectId(coeIdStr);
        
        const existing = await Notification.findOne({
          user_id: userId,
          type: type,
          $or: [
            { 'data.coe_id': coeIdObj },
            { 'data.coe_id': coeIdStr }
          ]
        });
        
        if (existing) {
          console.log('[NotificationService] ✅ Duplicate coe_requested notification prevented:', {
            userId: userId?.toString(),
            type,
            coe_id: coeIdStr,
            existing_notification_id: existing._id?.toString(),
            existing_created_at: existing.createdAt
          });
          existing._wasExisting = true;
          return existing;
        }
        
        console.log('[NotificationService] 📝 Creating new coe_requested notification (no duplicate found):', {
          userId: userId?.toString(),
          type,
          coe_id: coeIdStr
        });
      } else {
        console.warn('[NotificationService] ⚠️ Invalid coe_id format, skipping duplicate check:', {
          userId: userId?.toString(),
          coe_id: data.coe_id,
          coe_id_type: typeof data.coe_id
        });
      }
    }
    
    // Check for message notifications to avoid blocking other notification types
    if (type === 'coe_message' && data.message_id) {
      // Normalize message_id to string for consistent comparison
      const mongoose = require('mongoose');
      let messageIdStr = null;
      
      // Extract ObjectId string from various formats
      if (data.message_id && data.message_id.toString) {
        messageIdStr = data.message_id.toString();
      } else if (typeof data.message_id === 'string') {
        messageIdStr = data.message_id;
      } else if (data.message_id && data.message_id._id) {
        // Handle populated object
        messageIdStr = data.message_id._id.toString();
      }
      
      if (messageIdStr && mongoose.Types.ObjectId.isValid(messageIdStr)) {
        // Query using both ObjectId and string to catch any format
        const messageIdObj = new mongoose.Types.ObjectId(messageIdStr);
        
        const existing = await Notification.findOne({
          user_id: userId,
          type: type,
          $or: [
            { 'data.message_id': messageIdObj },
            { 'data.message_id': messageIdStr }
          ]
        });
        
        if (existing) {
          console.log('[NotificationService] ✅ Duplicate notification prevented:', {
            userId: userId?.toString(),
            type,
            message_id: messageIdStr,
            existing_notification_id: existing._id?.toString(),
            existing_created_at: existing.createdAt
          });
          existing._wasExisting = true;
          return existing;
        }
        
        // Log when creating new notification for debugging
        console.log('[NotificationService] 📝 Creating new notification (no duplicate found):', {
          userId: userId?.toString(),
          type,
          message_id: messageIdStr
        });
      } else {
        console.warn('[NotificationService] ⚠️ Invalid message_id format, skipping duplicate check:', {
          userId: userId?.toString(),
          message_id: data.message_id,
          message_id_type: typeof data.message_id
        });
      }
    }

    const content = generateNotificationContent(type, data);
    const actionUrl = generateDeepLink(type, data);

    // For coe_requested notifications, use findOneAndUpdate with upsert for atomic duplicate prevention
    if (type === 'coe_requested' && data.coe_id) {
      const mongoose = require('mongoose');
      let coeIdForQuery = data.coe_id;
      
      // Normalize coe_id
      if (coeIdForQuery && coeIdForQuery.toString) {
        coeIdForQuery = coeIdForQuery.toString();
      } else if (typeof coeIdForQuery === 'string') {
        // Already a string
      } else if (coeIdForQuery && coeIdForQuery._id) {
        coeIdForQuery = coeIdForQuery._id.toString();
      }
      
      if (coeIdForQuery && mongoose.Types.ObjectId.isValid(coeIdForQuery)) {
        const coeIdObj = new mongoose.Types.ObjectId(coeIdForQuery);
        
        // Use findOneAndUpdate with upsert for atomic operation
        // This ensures only one notification is created even in race conditions
        const notificationData = {
          user_id: userId,
          type,
          title: content.title,
          body: content.body,
          data: {
            coe_id: coeIdObj,
            message_id: data.message_id,
            payment_id: data.payment_id,
            sender_id: data.sender_id,
            action: type,
            action_url: actionUrl
          },
          read: false,
          sent: false
        };
        
        // Check if notification already exists first
        const existing = await Notification.findOne({
          user_id: userId,
          type: type,
          'data.coe_id': { $in: [coeIdObj, coeIdForQuery] }
        });
        
        if (existing) {
          console.log('[NotificationService] ✅ Duplicate coe_requested notification found (returning existing):', {
            userId: userId?.toString(),
            type,
            coe_id: coeIdForQuery,
            existing_notification_id: existing._id?.toString()
          });
          existing._wasExisting = true;
          return existing;
        }
        
        // Create new notification using findOneAndUpdate with upsert for atomicity
        const notification = await Notification.findOneAndUpdate(
          {
            user_id: userId,
            type: type,
            'data.coe_id': coeIdObj
          },
          {
            $setOnInsert: notificationData
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
          }
        );
        
        console.log('[NotificationService] 📝 Created/updated coe_requested notification:', {
          userId: userId?.toString(),
          type,
          coe_id: coeIdForQuery,
          notification_id: notification._id?.toString(),
          was_created: !existing
        });
        
        return notification;
      }
    }

    // For message notifications, use findOneAndUpdate with upsert for atomic duplicate prevention
    if (type === 'coe_message' && data.message_id) {
      const mongoose = require('mongoose');
      let messageIdForQuery = data.message_id;
      
      // Normalize message_id
      if (messageIdForQuery && messageIdForQuery.toString) {
        messageIdForQuery = messageIdForQuery.toString();
      } else if (typeof messageIdForQuery === 'string') {
        // Already a string
      } else if (messageIdForQuery && messageIdForQuery._id) {
        messageIdForQuery = messageIdForQuery._id.toString();
      }
      
      if (messageIdForQuery && mongoose.Types.ObjectId.isValid(messageIdForQuery)) {
        const messageIdObj = new mongoose.Types.ObjectId(messageIdForQuery);
        
        // Use findOneAndUpdate with upsert for atomic operation
        // This ensures only one notification is created even in race conditions
        const notificationData = {
          user_id: userId,
          type,
          title: content.title,
          body: content.body,
          data: {
            coe_id: data.coe_id,
            message_id: messageIdObj,
            payment_id: data.payment_id,
            sender_id: data.sender_id,
            action: type,
            action_url: actionUrl
          },
          read: false,
          sent: false
        };
        
        // Check if notification already exists first
        const existing = await Notification.findOne({
          user_id: userId,
          type: type,
          'data.message_id': { $in: [messageIdObj, messageIdForQuery] }
        });
        
        if (existing) {
          console.log('[NotificationService] ✅ Found existing notification (skipping create and push):', {
            notification_id: existing._id?.toString(),
            user_id: userId?.toString(),
            type,
            message_id: messageIdForQuery,
            created_at: existing.createdAt
          });
          // Mark that this is an existing notification (not new)
          existing._wasExisting = true;
          return existing;
        }
        
        // Create new notification
        const result = await Notification.create(notificationData);
        
        console.log('[NotificationService] ✅ Created new notification:', {
          notification_id: result._id?.toString(),
          user_id: userId?.toString(),
          type,
          message_id: messageIdForQuery
        });
        return result;
      }
    }

    if (type === 'proposal_group_ready' && data.proposal_group_id) {
      const gid = String(data.proposal_group_id);
      await Notification.deleteMany({
        user_id: userId,
        type: 'proposal_group_ready',
        'data.proposal_group_id': gid
      });
    }

    // For other notification types, use regular save
    const notification = new Notification({
      user_id: userId,
      type,
      title: content.title,
      body: content.body,
      data: {
        coe_id: data.coe_id,
        message_id: data.message_id,
        payment_id: data.payment_id,
        sender_id: data.sender_id, // Store sender_id for avatar display
        action: type,
        action_url: actionUrl,
        proposal_group_id: data.proposal_group_id,
        proposal_count: data.proposal_count
      },
      read: false,
      sent: false
    });

    try {
      const savedNotification = await notification.save();
      console.log('[NotificationService] ✅ Notification saved successfully:', {
        notification_id: savedNotification._id?.toString(),
        user_id: userId?.toString(),
        type,
        message_id: data.message_id?.toString()
      });
      return savedNotification;
    } catch (saveError) {
      // Handle duplicate key error (E11000) from unique index
      if (saveError.code === 11000 || saveError.code === 11001 || saveError.message?.includes('duplicate key')) {
        console.log('[NotificationService] ✅ Duplicate prevented by unique index:', {
          userId: userId?.toString(),
          type,
          message_id: data.message_id?.toString(),
          error_code: saveError.code,
          error_message: saveError.message
        });
        
        // Find and return the existing notification
        // Try multiple query formats to find the existing one
        const mongoose = require('mongoose');
        let messageIdForQuery = data.message_id;
        
        if (messageIdForQuery && messageIdForQuery.toString) {
          messageIdForQuery = messageIdForQuery.toString();
        }
        
        let existing = null;
        if (messageIdForQuery && mongoose.Types.ObjectId.isValid(messageIdForQuery)) {
          const messageIdObj = new mongoose.Types.ObjectId(messageIdForQuery);
          existing = await Notification.findOne({
            user_id: userId,
            type: type,
            $or: [
              { 'data.message_id': messageIdObj },
              { 'data.message_id': messageIdForQuery }
            ]
          });
        }
        
        if (existing) {
          console.log('[NotificationService] ✅ Returning existing notification:', {
            existing_id: existing._id?.toString()
          });
          existing._wasExisting = true;
          return existing;
        } else {
          console.warn('[NotificationService] ⚠️ Duplicate error but existing notification not found, retrying create...');
          // If we can't find existing, it might be a race condition - retry the query check
          throw saveError;
        }
      }
      
      // Re-throw if it's not a duplicate error
      console.error('[NotificationService] ❌ Error saving notification:', {
        error_code: saveError.code,
        error_message: saveError.message,
        userId: userId?.toString(),
        type
      });
      throw saveError;
    }
  } catch (error) {
    console.error('[NotificationService] Error creating notification:', error);
    throw error;
  }
}

/**
 * Build Firebase / Expo push `data` payload from a persisted notification document.
 * @param {import('mongoose').Document} notification - Notification mongoose doc
 * @returns {Record<string, string>}
 */
function buildPushDataFromNotification(notification) {
  const d = notification.data || {};
  const out = {
    type: String(notification.type),
    notification_id: notification._id.toString()
  };
  if (d.action_url) out.action_url = d.action_url;
  if (d.coe_id != null && d.coe_id !== '') out.coe_id = d.coe_id.toString();
  if (d.message_id != null && d.message_id !== '') out.message_id = d.message_id.toString();
  if (d.payment_id != null && d.payment_id !== '') out.payment_id = d.payment_id.toString();
  if (d.proposal_group_id) out.proposal_group_id = String(d.proposal_group_id);
  if (d.proposal_count != null && Number.isFinite(Number(d.proposal_count))) {
    out.proposal_count = String(d.proposal_count);
  }
  return out;
}

/**
 * Build a single Expo push message with THE1 branding and dynamic badge.
 * @param {string} token
 * @param {Object} notification
 * @param {number} badgeCount
 * @returns {Object}
 */
function buildExpoPushMessage(token, notification, badgeCount) {
  const badge = Math.max(0, Number(badgeCount) || 0);
  return {
    to: token,
    sound: 'default',
    title: notification.title,
    body: notification.body,
    data: buildPushDataFromNotification(notification),
    badge,
    priority: 'high',
    android: {
      channelId: 'default',
      color: '#D4AF37',
      priority: 'high',
      sound: 'default',
      vibrate: [0, 250, 250, 250],
    },
    ios: {
      sound: 'default',
      badge,
    },
  };
}

/**
 * Notify every active live admin (same query as signup admin alerts).
 * @param {string} type - Notification type
 * @param {Object} data - Notification payload
 * @returns {Promise<Array<{adminId: string, result: Object}>>}
 */
async function notifyAllLiveAdmins(type, data) {
  const adminUsers = await User.find({
    role: 'admin',
    isActive: true,
    entity_status: 'live',
  }).select('_id');

  if (!adminUsers || adminUsers.length === 0) {
    console.warn('[NotificationService] notifyAllLiveAdmins: no live admins found');
    return [];
  }

  const results = await Promise.all(
    adminUsers.map(async (adminUser) => {
      const adminId = adminUser._id.toString();
      const result = await createAndSendNotification(adminId, type, data);
      return { adminId, result };
    }),
  );

  return results;
}

/**
 * Send push notification to user via FCM
 * @param {string} userId - User ID
 * @param {Object} notification - Notification document
 * @returns {Promise<Object>} Send result
 */
async function sendPushNotification(userId, notification) {
  try {
    // Expo push does not require Firebase; native FCM/APNs branches guard separately.
    const uid = normalizeRecipientUserIdForWrite(userId) ?? userId;
    const user = await User.findById(uid);
    
    // Enhanced diagnostic logging to understand why tokens aren't found
    if (!user) {
      console.error(`[NotificationService] ❌ User not found for userId: ${uid} (type: ${typeof uid})`);
      return { success: false, reason: 'user_not_found' };
    }
    
    console.log(`[NotificationService] 🔍 User found: ${user._id}, checking push_tokens:`, {
      user_found: true,
      push_tokens_exists: user.push_tokens !== undefined,
      push_tokens_is_array: Array.isArray(user.push_tokens),
      push_tokens_length: user.push_tokens?.length || 0,
      push_tokens_value: user.push_tokens ? JSON.stringify(user.push_tokens.map(t => ({
        token_preview: t.token?.substring(0, 30) + '...',
        platform: t.platform
      }))) : 'null/undefined'
    });
    
    if (!user.push_tokens || user.push_tokens.length === 0) {
      console.log(`[NotificationService] ⚠️ No push tokens found for user ${uid}`);
      return { success: false, reason: 'no_push_tokens' };
    }
    
    console.log(`[NotificationService] User has ${user.push_tokens.length} push token(s):`, {
      user_id: uid?.toString(),
      token_count: user.push_tokens.length,
      tokens: user.push_tokens.map(t => ({
        token_preview: t.token?.substring(0, 20) + '...',
        type: t.token?.startsWith('ExponentPushToken[') ? 'expo' : 'fcm',
        last_used: t.last_used_at
      }))
    });

    const badgeCount = await getUnreadCount(uid);

    // Prepare FCM/APNs message template
    const message = {
      notification: {
        title: notification.title,
        body: notification.body
      },
      data: buildPushDataFromNotification(notification),
      android: {
        priority: 'high'
      },
      apns: {
        headers: {
          'apns-priority': '10'
        },
        payload: {
          aps: {
            sound: 'default',
            badge: badgeCount
          }
        }
      }
    };

    const results = [];
    const expoTokens = [];
    const iosApnsTokens = [];
    const androidFcmTokens = [];
    const seenTokens = new Set();

    for (const tokenData of user.push_tokens) {
      const token = tokenData.token;
      const platform = tokenData.platform;

      if (seenTokens.has(token)) {
        console.warn(`[NotificationService] ⚠️ Skipping duplicate push token: ${token.substring(0, 20)}...`);
        continue;
      }
      seenTokens.add(token);

      if (token.startsWith('ExponentPushToken[')) {
        expoTokens.push({ token, tokenData });
      } else if (platform === 'ios') {
        iosApnsTokens.push({ token, tokenData });
      } else {
        androidFcmTokens.push({ token, tokenData });
      }
    }

    // One delivery channel per platform: iOS Expo only; Android FCM preferred over Expo
    const iosExpoTokens = expoTokens.filter(({ tokenData }) => tokenData.platform !== 'android');
    const androidExpoTokens = expoTokens.filter(({ tokenData }) => tokenData.platform === 'android');
    const hasIosExpo = iosExpoTokens.length > 0;
    const useAndroidFcm = androidFcmTokens.length > 0;
    const expoTokensToSend = [
      ...iosExpoTokens,
      ...(useAndroidFcm ? [] : androidExpoTokens),
    ];

    if (hasIosExpo && iosApnsTokens.length > 0) {
      const staleApns = new Set(iosApnsTokens.map(({ token }) => token));
      user.push_tokens = user.push_tokens.filter((t) => !staleApns.has(t.token));
      console.log('[NotificationService] Pruned stale iOS APNs tokens (Expo iOS active):', {
        removed: staleApns.size,
        user_id: uid?.toString(),
      });
    }

    console.log('[NotificationService] Push routing:', {
      original_count: user.push_tokens.length,
      ios_expo: iosExpoTokens.length,
      android_expo: androidExpoTokens.length,
      expo_to_send: expoTokensToSend.length,
      ios_apns: iosApnsTokens.length,
      android_fcm: androidFcmTokens.length,
      skip_ios_apns: hasIosExpo,
      skip_android_expo: useAndroidFcm,
      badge: badgeCount,
    });

    // Send Expo push notifications via Expo API
    if (expoTokensToSend.length > 0) {
      if (!expoClient) {
        initializeExpo();
      }
      
      if (expoClient) {
        try {
          const expoMessages = expoTokensToSend.map(({ token }) =>
            buildExpoPushMessage(token, notification, badgeCount),
          );
          
          // Send via Expo API (chunks messages automatically)
          // First attempt: try sending all tokens together
          const chunks = expoClient.chunkPushNotifications(expoMessages);
          const tickets = [];
          let hasProjectConflict = false;
          let projectGroups = null;
          
          for (const chunk of chunks) {
            try {
              const ticketChunk = await expoClient.sendPushNotificationsAsync(chunk);
              tickets.push(...ticketChunk);
            } catch (error) {
              console.error('[NotificationService] Error sending Expo chunk:', error);
              
              // Check if error is due to different Expo projects
              // Try multiple ways to access error properties (error structure may vary)
              let errorCode, errorDetails, errorMessage;
              
              try {
                errorCode = error.code || error.error?.code;
                errorDetails = error.details || error.error?.details;
                errorMessage = error.message || String(error);
              } catch (e) {
                // If accessing properties fails, try string conversion
                errorMessage = String(error);
                errorCode = null;
                errorDetails = null;
              }
              
              // Check for project conflict error - multiple detection methods
              const hasConflictCode = errorCode === 'PUSH_TOO_MANY_EXPERIENCE_IDS';
              const hasConflictMessage = errorMessage && (
                errorMessage.includes('same project') || 
                errorMessage.includes('conflicting tokens') ||
                errorMessage.includes('PUSH_TOO_MANY_EXPERIENCE_IDS')
              );
              const hasDetails = errorDetails && typeof errorDetails === 'object' && Object.keys(errorDetails).length > 0;
              
              // Debug logging for project conflict errors
              if (hasConflictCode || hasConflictMessage) {
                console.log('[NotificationService] Debug - Project conflict detected:', {
                  hasCode: !!error.code,
                  code: error.code,
                  errorCode: errorCode,
                  hasDetails: !!error.details,
                  errorDetails: errorDetails,
                  detailsType: error.details ? typeof error.details : 'none',
                  detailsKeys: error.details ? Object.keys(error.details) : null,
                  message: errorMessage ? errorMessage.substring(0, 150) : 'no message'
                });
              }
              
              // If we have conflict indicators AND details, treat as project conflict
              if ((hasConflictCode || hasConflictMessage) && hasDetails) {
                hasProjectConflict = true;
                projectGroups = errorDetails || error.details;
                console.log('[NotificationService] ✅ Detected Expo tokens from different projects, will send separately:', projectGroups ? Object.keys(projectGroups) : 'no groups');
                // Don't add error tickets - we'll retry by project
                break;
              } else {
                // Other errors - add error tickets
                console.log('[NotificationService] Not a project conflict error, adding error tickets');
                tickets.push(...chunk.map(() => ({ status: 'error', message: errorMessage })));
              }
            }
          }
          
          // If we have project conflicts, send tokens grouped by project
          if (hasProjectConflict && projectGroups) {
            console.log('[NotificationService] Sending Expo tokens grouped by project...');
            
            // Group tokens by project based on error details
            const tokensByProject = {};
            const ungroupedTokens = [];
            
            // First, identify which tokens belong to which project
            for (const { token, tokenData } of expoTokensToSend) {
              let found = false;
              for (const [projectId, projectTokens] of Object.entries(projectGroups)) {
                if (projectTokens.includes(token)) {
                  if (!tokensByProject[projectId]) {
                    tokensByProject[projectId] = [];
                  }
                  tokensByProject[projectId].push({ token, tokenData });
                  found = true;
                  break;
                }
              }
              if (!found) {
                ungroupedTokens.push({ token, tokenData });
              }
            }

            for (const [projectId, projectTokenList] of Object.entries(tokensByProject)) {
              try {
                console.log(`[NotificationService] Sending ${projectTokenList.length} token(s) for project ${projectId}`);
                const projectMessages = projectTokenList.map(({ token }) =>
                  buildExpoPushMessage(token, notification, badgeCount),
                );
                
                const projectChunks = expoClient.chunkPushNotifications(projectMessages);
                const projectTickets = [];
                
                for (const chunk of projectChunks) {
                  try {
                    const ticketChunk = await expoClient.sendPushNotificationsAsync(chunk);
                    projectTickets.push(...ticketChunk);
                  } catch (chunkError) {
                    console.error(`[NotificationService] Error sending chunk for project ${projectId}:`, chunkError.message);
                    projectTickets.push(...chunk.map(() => ({ status: 'error', message: chunkError.message })));
                  }
                }
                
                // Process results for this project
                for (let i = 0; i < projectTokenList.length; i++) {
                  const ticket = projectTickets[i];
                  const { token, tokenData } = projectTokenList[i];
                  
                  if (ticket && ticket.status === 'ok') {
                    results.push({ token, success: true, messageId: ticket.id, method: 'expo' });
                    tokenData.last_used_at = new Date();
                  } else {
                    const error = ticket?.message || ticket?.details?.error || 'Unknown error';
                    console.error(`[NotificationService] Failed to send Expo token ${token} (project ${projectId}):`, error);
                    
                    // If token is invalid, remove it
                    if (error.includes('Invalid') || error.includes('not registered') || error.includes('DeviceNotRegistered')) {
                      user.push_tokens = user.push_tokens.filter(t => t.token !== token);
                      results.push({ token, success: false, reason: 'invalid_token', method: 'expo' });
                    } else {
                      results.push({ token, success: false, reason: error, method: 'expo' });
                    }
                  }
                }
              } catch (projectError) {
                console.error(`[NotificationService] Error sending notifications for project ${projectId}:`, projectError.message);
                projectTokenList.forEach(({ token }) => {
                  results.push({ token, success: false, reason: projectError.message, method: 'expo' });
                });
              }
            }
            
            // Handle ungrouped tokens (try to send them individually)
            for (const { token, tokenData } of ungroupedTokens) {
              try {
                const singleMessage = buildExpoPushMessage(token, notification, badgeCount);
                const ticket = await expoClient.sendPushNotificationsAsync([singleMessage]);
                if (ticket[0] && ticket[0].status === 'ok') {
                  results.push({ token, success: true, messageId: ticket[0].id, method: 'expo' });
                  tokenData.last_used_at = new Date();
                } else {
                  const error = ticket[0]?.message || 'Unknown error';
                  console.error(`[NotificationService] Failed to send ungrouped Expo token ${token}:`, error);
                  if (error.includes('Invalid') || error.includes('not registered')) {
                    user.push_tokens = user.push_tokens.filter(t => t.token !== token);
                    results.push({ token, success: false, reason: 'invalid_token', method: 'expo' });
                  } else {
                    results.push({ token, success: false, reason: error, method: 'expo' });
                  }
                }
              } catch (tokenError) {
                console.error(`[NotificationService] Error sending ungrouped token ${token}:`, tokenError.message);
                if (tokenError.message.includes('Invalid') || tokenError.message.includes('not registered')) {
                  user.push_tokens = user.push_tokens.filter(t => t.token !== token);
                  results.push({ token, success: false, reason: 'invalid_token', method: 'expo' });
                } else {
                  results.push({ token, success: false, reason: tokenError.message, method: 'expo' });
                }
              }
            }
          } else {
            for (let i = 0; i < expoTokensToSend.length; i++) {
              const ticket = tickets[i];
              const { token, tokenData } = expoTokensToSend[i];
              
              if (ticket && ticket.status === 'ok') {
                results.push({ token, success: true, messageId: ticket.id, method: 'expo' });
                tokenData.last_used_at = new Date();
              } else {
                const error = ticket?.message || ticket?.details?.error || 'Unknown error';
                console.error(`[NotificationService] Failed to send Expo token ${token}:`, error);
                
                // If token is invalid, remove it
                if (error.includes('Invalid') || error.includes('not registered') || error.includes('DeviceNotRegistered')) {
                  user.push_tokens = user.push_tokens.filter(t => t.token !== token);
                  results.push({ token, success: false, reason: 'invalid_token', method: 'expo' });
                } else {
                  results.push({ token, success: false, reason: error, method: 'expo' });
                }
              }
            }
          }
        } catch (error) {
          console.error('[NotificationService] Error sending Expo notifications:', error);
          expoTokensToSend.forEach(({ token }) => {
            results.push({ token, success: false, reason: error.message, method: 'expo' });
          });
        }
      } else {
        console.warn('[NotificationService] Expo client not initialized, skipping Expo tokens');
        expoTokensToSend.forEach(({ token }) => {
          results.push({ token, success: false, reason: 'expo_client_not_initialized', method: 'expo' });
        });
      }
    }

    // iOS native APNs only when no Expo iOS token (legacy builds)
    const iosApnsToSend = hasIosExpo ? [] : iosApnsTokens;
    for (const { token, tokenData } of iosApnsToSend) {
      try {
        if (!firebaseInitialized) {
          results.push({ token, success: false, reason: 'firebase_not_initialized', method: 'apns' });
          continue;
        }

        // Firebase Admin SDK can send to iOS using APNs tokens
        // The message already has apns configuration, Firebase will route it correctly
        const messageToSend = {
          ...message,
          token: token,
          // Ensure APNs configuration is present for iOS
          apns: {
            ...message.apns,
            headers: {
              'apns-priority': '10',
              'apns-push-type': 'alert'
            }
          }
        };
        
        console.log(`[NotificationService] 📤 Sending iOS APNs notification:`, {
          token_preview: token.substring(0, 30) + '...',
          token_length: token.length,
          has_apns_config: !!messageToSend.apns,
          project_id: process.env.FIREBASE_PROJECT_ID
        });
        
        const result = await admin.messaging().send(messageToSend);

        results.push({ token, success: true, messageId: result, method: 'apns' });
        
        // Update last_used_at
        tokenData.last_used_at = new Date();
      } catch (error) {
        console.error(`[NotificationService] Failed to send iOS APNs token ${token.substring(0, 20)}...`);
        console.error(`[NotificationService] Error details:`, {
          message: error.message,
          code: error.code,
          errorInfo: error.errorInfo,
          stack: error.stack?.substring(0, 200)
        });
        
        // Check if error is due to APNs not being configured in Firebase
        // When APNs is not configured, Firebase tries to treat APNs tokens as FCM tokens
        const isApnsConfigError = error.message?.includes('FCM') && error.message?.includes('not a valid');
        
        if (isApnsConfigError) {
          console.error(`[NotificationService] ⚠️ CRITICAL: Firebase APNs not configured!`);
          console.error(`[NotificationService] Error indicates Firebase is treating APNs token as FCM token.`);
          console.error(`[NotificationService] This means APNs Authentication Key is not uploaded to Firebase Console.`);
          console.error(`[NotificationService] Token is VALID - not removing. Configure APNs in Firebase Console.`);
          console.error(`[NotificationService] Current Firebase Project: ${process.env.FIREBASE_PROJECT_ID}`);
          console.error(`[NotificationService] Verify APNs keys at: https://console.firebase.google.com/project/${process.env.FIREBASE_PROJECT_ID}/settings/cloudmessaging`);
          results.push({ token, success: false, reason: 'apns_not_configured', method: 'apns' });
          // Don't remove token - it's valid, just can't be sent because APNs isn't configured
        } else if (error.code === 'messaging/invalid-registration-token' || 
                   error.code === 'messaging/registration-token-not-registered') {
          // These are actual invalid token errors (not configuration issues)
          console.log(`[NotificationService] Removing invalid iOS APNs token: ${token.substring(0, 20)}...`);
          user.push_tokens = user.push_tokens.filter(t => t.token !== token);
          results.push({ token, success: false, reason: 'invalid_token', method: 'apns' });
        } else if (error.message?.includes('not a valid') || error.message?.includes('Invalid')) {
          // Generic "not valid" error - could be token or config issue
          // If it mentions FCM, it's likely APNs config issue, otherwise might be invalid token
          if (error.message?.includes('FCM')) {
            console.error(`[NotificationService] ⚠️ Likely APNs configuration issue (FCM mentioned). Not removing token.`);
            results.push({ token, success: false, reason: 'apns_not_configured', method: 'apns' });
          } else {
            console.log(`[NotificationService] Removing invalid iOS APNs token: ${token.substring(0, 20)}...`);
            user.push_tokens = user.push_tokens.filter(t => t.token !== token);
            results.push({ token, success: false, reason: 'invalid_token', method: 'apns' });
          }
        } else {
          results.push({ token, success: false, reason: error.message, method: 'apns' });
        }
      }
    }
    
    const androidFcmToSend = useAndroidFcm ? androidFcmTokens : [];
    for (const { token, tokenData } of androidFcmToSend) {
      try {
        if (!firebaseInitialized) {
          results.push({ token, success: false, reason: 'firebase_not_initialized', method: 'fcm' });
          continue;
        }

        const result = await admin.messaging().send({
          ...message,
          token: token
        });

        results.push({ token, success: true, messageId: result, method: 'fcm' });
        
        // Update last_used_at
        tokenData.last_used_at = new Date();
      } catch (error) {
        console.error(`[NotificationService] Failed to send FCM token ${token.substring(0, 20)}...:`, error.message);
        
        // If token is invalid, remove it
        if (error.code === 'messaging/invalid-registration-token' || 
            error.code === 'messaging/registration-token-not-registered' ||
            error.message?.includes('not a valid FCM registration token')) {
          console.log(`[NotificationService] Removing invalid FCM token: ${token.substring(0, 20)}...`);
          user.push_tokens = user.push_tokens.filter(t => t.token !== token);
          results.push({ token, success: false, reason: 'invalid_token', method: 'fcm' });
        } else {
          results.push({ token, success: false, reason: error.message, method: 'fcm' });
        }
      }
    }

    // Save user if tokens were removed
    if (user.isModified('push_tokens')) {
      await user.save();
    }

    // Update notification as sent
    notification.sent = true;
    notification.sent_at = new Date();
    await notification.save();

    const successCount = results.filter(r => r.success).length;
    return {
      success: successCount > 0,
      sent_count: successCount,
      total_count: results.length,
      results
    };
  } catch (error) {
    console.error('[NotificationService] Error sending push notification:', error);
    throw error;
  }
}

/**
 * Create and send notification to user
 * @param {string} userId - User ID
 * @param {string} type - Notification type
 * @param {Object} data - Notification data
 * @returns {Promise<Object>} Created notification and send result
 */
async function createAndSendNotification(userId, type, data) {
  const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  try {
    console.log(`[NotificationService] [${callId}] [${new Date().toISOString()}] createAndSendNotification called:`, {
      user_id: userId?.toString(),
      type,
      message_id: data.message_id?.toString(),
      coe_id: data.coe_id?.toString()
    });
    
    // Create notification document (or get existing)
    const notification = await createNotification(userId, type, data);
    
    console.log(`[NotificationService] [${callId}] Notification created/retrieved:`, {
      notification_id: notification._id?.toString(),
      was_existing: notification._wasExisting,
      created_at: notification.createdAt
    });
    
    // Only send push notification if this is a NEW notification
    // If it was an existing notification, don't send push again (prevents duplicate alerts)
    let sendResult = null;
    if (!notification._wasExisting) {
      console.log(`[NotificationService] [${callId}] Sending push notification for NEW notification:`, {
        notification_id: notification._id?.toString(),
        user_id: userId?.toString()
      });
      sendResult = await sendPushNotification(userId, notification);
      console.log(`[NotificationService] [${callId}] Push notification sent:`, {
        success: sendResult?.success,
        sent_count: sendResult?.sent_count
      });
    } else {
      console.log(`[NotificationService] [${callId}] ⚠️ SKIPPING push notification (notification already exists):`, {
        notification_id: notification._id?.toString(),
        user_id: userId?.toString(),
        created_at: notification.createdAt
      });
      sendResult = { success: false, reason: 'notification_already_exists' };
    }
    
    // Remove the internal flag before returning
    delete notification._wasExisting;
    
    const duration = Date.now() - startTime;
    console.log(`[NotificationService] [${callId}] Completed in ${duration}ms:`, {
      notification_id: notification._id?.toString(),
      push_sent: !notification._wasExisting,
      duration_ms: duration
    });
    
    return {
      notification,
      sendResult
    };
  } catch (error) {
    console.error(`[NotificationService] [${callId}] Error creating and sending notification:`, {
      error: error.message,
      stack: error.stack,
      duration_ms: Date.now() - startTime
    });
    throw error;
  }
}

/**
 * Get user notifications with filters and pagination
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options { read, type }
 * @param {Object} pagination - Pagination options { page, limit }
 * @returns {Promise<Object>} Notifications with pagination and `unread_count` scoped to the same filters as the list (plus `read: false`).
 */
async function getUserNotifications(userId, filters = {}, pagination = {}, isAdmin = false) {
  try {
    const { read, type, startDate, endDate } = filters;
    const page = parseInt(pagination.page) || 1;
    const limit = Math.min(parseInt(pagination.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Build query (ObjectId or legacy string `user_id` on stored documents)
    const extraConditions = {};
    if (read !== undefined) {
      extraConditions.read = read === 'true' || read === true;
    }
    if (type) {
      if (type.includes(',')) {
        const types = type.split(',').map(t => t.trim()).filter(t => t);
        extraConditions.type = { $in: types };
      } else {
        extraConditions.type = type;
      }
    }
    if (startDate || endDate) {
      extraConditions.createdAt = {};
      if (startDate) {
        extraConditions.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setDate(end.getDate() + 1);
        extraConditions.createdAt.$lt = end;
      }
    }

    const query = notificationQueryForUser(userId, extraConditions);

    // Get notifications
    // Use createdAt (camelCase) since timestamps: true creates createdAt, not created_at
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('data.coe_id', isAdmin ? 'name status' : 'name')
      .populate('data.message_id', 'content')
      .populate('data.payment_id', 'amount currency')
      .populate('data.sender_id', 'firstName lastName avatarUrl');
    
    // For admin users, fetch fresh COE status to ensure it's up-to-date
    if (isAdmin) {
      const COE = require('../models/COE');
      for (const notification of notifications) {
        if (notification.data?.coe_id && notification.type?.startsWith('coe_')) {
          try {
            // Extract COE ID - handle both populated object and ObjectId/string
            let coeId = null;
            if (notification.data.coe_id._id) {
              coeId = notification.data.coe_id._id;
            } else if (notification.data.coe_id instanceof mongoose.Types.ObjectId) {
              coeId = notification.data.coe_id;
            } else if (typeof notification.data.coe_id === 'string') {
              coeId = notification.data.coe_id;
            } else {
              coeId = notification.data.coe_id;
            }
            
            if (coeId) {
              const freshCoe = await COE.findById(coeId).select('name status').lean();
              if (freshCoe) {
                // Update populated COE with fresh status
                if (notification.data.coe_id && typeof notification.data.coe_id === 'object') {
                  if (notification.data.coe_id._doc) {
                    notification.data.coe_id._doc.status = freshCoe.status;
                  }
                  notification.data.coe_id.status = freshCoe.status;
                }
              }
            }
          } catch (fetchError) {
            console.error('[NotificationService] Error fetching fresh COE status:', fetchError);
            // Continue with existing populated data if fetch fails
          }
        }
      }
    }

    // Remove duplicates based on notification ID (defensive check)
    const seenIds = new Set();
    const uniqueNotifications = notifications.filter(notif => {
      const id = notif._id.toString();
      if (seenIds.has(id)) {
        console.warn('[NotificationService] ⚠️ Duplicate notification found in query results:', {
          notification_id: id,
          user_id: userId?.toString(),
          type: notif.type,
          message_id: notif.data?.message_id?.toString()
        });
        return false;
      }
      seenIds.add(id);
      return true;
    });

    // Log if duplicates were found
    if (notifications.length !== uniqueNotifications.length) {
      console.warn('[NotificationService] ⚠️ Removed duplicate notifications from query results:', {
        original_count: notifications.length,
        unique_count: uniqueNotifications.length,
        removed: notifications.length - uniqueNotifications.length
      });
    }

    // Get total count
    const total = await Notification.countDocuments(query);

    // Unread count must match the same scope as the list (type / date / read filters).
    // Previously this always counted all unread types, so e.g. "Messages" showed an empty list
    // while the header still showed unread from `coe_requested` or other types.
    const unreadQuery = notificationQueryForUser(userId, {
      ...extraConditions,
      read: false
    });
    const unreadCount = await Notification.countDocuments(unreadQuery);

    return {
      notifications: uniqueNotifications,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      },
      unread_count: unreadCount
    };
  } catch (error) {
    console.error('[NotificationService] Error getting user notifications:', error);
    throw error;
  }
}

/**
 * Mark notification as read
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated notification
 */
async function markAsRead(notificationId, userId) {
  try {
    const notification = await Notification.findOne(
      notificationQueryForUser(userId, { _id: notificationId })
    );

    if (!notification) {
      throw new Error('Notification not found');
    }

    if (!notification.read) {
      notification.read = true;
      notification.read_at = new Date();
      await notification.save();
    }

    return notification;
  } catch (error) {
    console.error('[NotificationService] Error marking notification as read:', error);
    throw error;
  }
}

/**
 * Mark all user notifications as read
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Update result
 */
async function markAllAsRead(userId) {
  try {
    const result = await Notification.updateMany(
      notificationQueryForUser(userId, { read: false }),
      { 
        $set: { 
          read: true,
          read_at: new Date()
        }
      }
    );

    return {
      modified_count: result.modifiedCount
    };
  } catch (error) {
    console.error('[NotificationService] Error marking all as read:', error);
    throw error;
  }
}

/**
 * Get unread notification count
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
async function getUnreadCount(userId) {
  try {
    const count = await Notification.countDocuments(
      notificationQueryForUser(userId, { read: false })
    );

    return count;
  } catch (error) {
    console.error('[NotificationService] Error getting unread count:', error);
    throw error;
  }
}

/**
 * Mark notification as unread
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated notification
 */
async function markAsUnread(notificationId, userId) {
  try {
    const notification = await Notification.findOne(
      notificationQueryForUser(userId, { _id: notificationId })
    );

    if (!notification) {
      throw new Error('Notification not found');
    }

    if (notification.read) {
      notification.read = false;
      notification.read_at = null;
      await notification.save();
    }

    return notification;
  } catch (error) {
    console.error('[NotificationService] Error marking notification as unread:', error);
    throw error;
  }
}

/**
 * Delete notification
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Deleted notification
 */
async function deleteNotification(notificationId, userId) {
  try {
    const notification = await Notification.findOneAndDelete(
      notificationQueryForUser(userId, { _id: notificationId })
    );

    if (!notification) {
      throw new Error('Notification not found');
    }

    return notification;
  } catch (error) {
    console.error('[NotificationService] Error deleting notification:', error);
    throw error;
  }
}

/**
 * Delete all read notifications for user
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Delete result
 */
async function deleteAllRead(userId) {
  try {
    const result = await Notification.deleteMany(
      notificationQueryForUser(userId, { read: true })
    );

    return {
      deletedCount: result.deletedCount
    };
  } catch (error) {
    console.error('[NotificationService] Error deleting all read notifications:', error);
    throw error;
  }
}

module.exports = {
  initializeFirebase,
  initializeExpo,
  createNotification,
  sendPushNotification,
  createAndSendNotification,
  notifyAllLiveAdmins,
  getUserNotifications,
  markAsRead,
  markAsUnread,
  markAllAsRead,
  getUnreadCount,
  deleteNotification,
  deleteAllRead,
  generateNotificationContent,
  generateDeepLink
};


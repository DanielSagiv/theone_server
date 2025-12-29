const admin = require('firebase-admin');
const { Expo } = require('expo-server-sdk');
const Notification = require('../models/Notification');
const User = require('../models/User');

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

  const templates = {
    coe_sent: {
      title: 'Experience Sent',
      body: `Your experience '${coeName}' has been sent for review`
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
  
  if (data.coe_id) {
    const coeId = data.coe_id.toString();
    
    switch (type) {
      case 'coe_message':
        return `${baseUrl}coe-messages?coeId=${coeId}`;
      case 'coe_sent':
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
        action: type,
        action_url: actionUrl
      },
      read: false,
      sent: false
    });

    await notification.save();
    return notification;
  } catch (error) {
    console.error('[NotificationService] Error creating notification:', error);
    throw error;
  }
}

/**
 * Send push notification to user via FCM
 * @param {string} userId - User ID
 * @param {Object} notification - Notification document
 * @returns {Promise<Object>} Send result
 */
async function sendPushNotification(userId, notification) {
  try {
    if (!firebaseInitialized) {
      console.warn('[NotificationService] Firebase not initialized, skipping push notification');
      return { success: false, reason: 'firebase_not_initialized' };
    }

    // Get user's push tokens
    const user = await User.findById(userId);
    if (!user || !user.push_tokens || user.push_tokens.length === 0) {
      console.log(`[NotificationService] No push tokens found for user ${userId}`);
      return { success: false, reason: 'no_push_tokens' };
    }

    // Prepare FCM message
    const message = {
      notification: {
        title: notification.title,
        body: notification.body
      },
      data: {
        type: notification.type,
        notification_id: notification._id.toString(),
        ...(notification.data.action_url && { action_url: notification.data.action_url }),
        ...(notification.data.coe_id && { coe_id: notification.data.coe_id.toString() }),
        ...(notification.data.message_id && { message_id: notification.data.message_id.toString() }),
        ...(notification.data.payment_id && { payment_id: notification.data.payment_id.toString() })
      },
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
            badge: 1
          }
        }
      }
    };

    // Send to all user's devices
    const results = [];
    const expoTokens = [];
    const fcmTokens = [];
    
    // Separate Expo tokens from FCM tokens
    for (const tokenData of user.push_tokens) {
      if (tokenData.token.startsWith('ExponentPushToken[')) {
        expoTokens.push({
          token: tokenData.token,
          tokenData: tokenData
        });
      } else {
        fcmTokens.push({
          token: tokenData.token,
          tokenData: tokenData
        });
      }
    }
    
    // Send Expo push notifications via Expo API
    if (expoTokens.length > 0) {
      if (!expoClient) {
        initializeExpo();
      }
      
      if (expoClient) {
        try {
          // Prepare Expo messages
          const expoMessages = expoTokens.map(({ token }) => ({
            to: token,
            sound: 'default',
            title: notification.title,
            body: notification.body,
            data: {
              type: notification.type,
              notification_id: notification._id.toString(),
              ...(notification.data.action_url && { action_url: notification.data.action_url }),
              ...(notification.data.coe_id && { coe_id: notification.data.coe_id.toString() }),
              ...(notification.data.message_id && { message_id: notification.data.message_id.toString() }),
              ...(notification.data.payment_id && { payment_id: notification.data.payment_id.toString() })
            },
            badge: 1,
            priority: 'high'
          }));
          
          // Send via Expo API (chunks messages automatically)
          const chunks = expoClient.chunkPushNotifications(expoMessages);
          const tickets = [];
          
          for (const chunk of chunks) {
            try {
              const ticketChunk = await expoClient.sendPushNotificationsAsync(chunk);
              tickets.push(...ticketChunk);
            } catch (error) {
              console.error('[NotificationService] Error sending Expo chunk:', error);
              // Add error tickets for this chunk
              tickets.push(...chunk.map(() => ({ status: 'error', message: error.message })));
            }
          }
          
          // Process results
          for (let i = 0; i < expoTokens.length; i++) {
            const ticket = tickets[i];
            const { token, tokenData } = expoTokens[i];
            
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
        } catch (error) {
          console.error('[NotificationService] Error sending Expo notifications:', error);
          expoTokens.forEach(({ token }) => {
            results.push({ token, success: false, reason: error.message, method: 'expo' });
          });
        }
      } else {
        console.warn('[NotificationService] Expo client not initialized, skipping Expo tokens');
        expoTokens.forEach(({ token }) => {
          results.push({ token, success: false, reason: 'expo_client_not_initialized', method: 'expo' });
        });
      }
    }
    
    // Send FCM push notifications via Firebase Admin SDK
    for (const { token, tokenData } of fcmTokens) {
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
        console.error(`[NotificationService] Failed to send FCM token ${token}:`, error.message);
        
        // If token is invalid, remove it
        if (error.code === 'messaging/invalid-registration-token' || 
            error.code === 'messaging/registration-token-not-registered') {
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
  try {
    // Create notification document
    const notification = await createNotification(userId, type, data);
    
    // Send push notification
    const sendResult = await sendPushNotification(userId, notification);
    
    return {
      notification,
      sendResult
    };
  } catch (error) {
    console.error('[NotificationService] Error creating and sending notification:', error);
    throw error;
  }
}

/**
 * Get user notifications with filters and pagination
 * @param {string} userId - User ID
 * @param {Object} filters - Filter options { read, type }
 * @param {Object} pagination - Pagination options { page, limit }
 * @returns {Promise<Object>} Notifications with pagination
 */
async function getUserNotifications(userId, filters = {}, pagination = {}) {
  try {
    const { read, type } = filters;
    const page = parseInt(pagination.page) || 1;
    const limit = Math.min(parseInt(pagination.limit) || 20, 100);
    const skip = (page - 1) * limit;

    // Build query
    const query = { user_id: userId };
    if (read !== undefined) {
      query.read = read === 'true' || read === true;
    }
    if (type) {
      query.type = type;
    }

    // Get notifications
    const notifications = await Notification.find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('data.coe_id', 'name')
      .populate('data.message_id', 'content')
      .populate('data.payment_id', 'amount currency');

    // Get total count
    const total = await Notification.countDocuments(query);

    // Get unread count
    const unreadCount = await Notification.countDocuments({ user_id: userId, read: false });

    return {
      notifications,
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
    const notification = await Notification.findOne({
      _id: notificationId,
      user_id: userId
    });

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
      { user_id: userId, read: false },
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
    const count = await Notification.countDocuments({
      user_id: userId,
      read: false
    });

    return count;
  } catch (error) {
    console.error('[NotificationService] Error getting unread count:', error);
    throw error;
  }
}

module.exports = {
  initializeFirebase,
  initializeExpo,
  createNotification,
  sendPushNotification,
  createAndSendNotification,
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  generateNotificationContent,
  generateDeepLink
};


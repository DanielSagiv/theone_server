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
    // Check for existing notification to prevent duplicates (idempotency)
    // Only check for message notifications to avoid blocking other notification types
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
          return existing; // Return existing notification instead of creating duplicate
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
        action_url: actionUrl
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
    
    // Enhanced diagnostic logging to understand why tokens aren't found
    if (!user) {
      console.error(`[NotificationService] ❌ User not found for userId: ${userId} (type: ${typeof userId})`);
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
      console.log(`[NotificationService] ⚠️ No push tokens found for user ${userId}`);
      return { success: false, reason: 'no_push_tokens' };
    }
    
    console.log(`[NotificationService] User has ${user.push_tokens.length} push token(s):`, {
      user_id: userId?.toString(),
      token_count: user.push_tokens.length,
      tokens: user.push_tokens.map(t => ({
        token_preview: t.token?.substring(0, 20) + '...',
        type: t.token?.startsWith('ExponentPushToken[') ? 'expo' : 'fcm',
        last_used: t.last_used_at
      }))
    });

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
    const iosApnsTokens = [];
    const androidFcmTokens = [];
    
    // Track unique tokens to prevent duplicates
    const seenTokens = new Set();
    
    // Separate tokens by type: Expo, iOS APNs, Android FCM
    for (const tokenData of user.push_tokens) {
      const token = tokenData.token;
      const platform = tokenData.platform;
      
      // Skip if we've already seen this exact token
      if (seenTokens.has(token)) {
        console.warn(`[NotificationService] ⚠️ Skipping duplicate push token: ${token.substring(0, 20)}...`);
        continue;
      }
      seenTokens.add(token);
      
      if (token.startsWith('ExponentPushToken[')) {
        expoTokens.push({
          token: token,
          tokenData: tokenData
        });
      } else if (platform === 'ios') {
        // iOS APNs tokens (long hex strings) - send via Firebase APNs gateway
        iosApnsTokens.push({
          token: token,
          tokenData: tokenData
        });
      } else {
        // Android FCM tokens
        androidFcmTokens.push({
          token: token,
          tokenData: tokenData
        });
      }
    }
    
    console.log(`[NotificationService] Deduplicated push tokens:`, {
      original_count: user.push_tokens.length,
      unique_expo_tokens: expoTokens.length,
      unique_ios_apns_tokens: iosApnsTokens.length,
      unique_android_fcm_tokens: androidFcmTokens.length,
      total_unique: expoTokens.length + iosApnsTokens.length + androidFcmTokens.length
    });
    
    // Send Expo push notifications via Expo API
    if (expoTokens.length > 0) {
      if (!expoClient) {
        initializeExpo();
      }
      
      if (expoClient) {
        try {
          // Prepare Expo messages with THE1 branding
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
            priority: 'high',
            // Android-specific styling (THE1 branding)
            android: {
              channelId: 'default',
              color: '#D4AF37', // THE1 gold color
              priority: 'high',
              sound: 'default',
              vibrate: [0, 250, 250, 250],
            },
            // iOS-specific styling
            ios: {
              sound: 'default',
              badge: 1,
            }
          }));
          
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
            for (const { token, tokenData } of expoTokens) {
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
                // Token not in error details - might be valid, try to send separately
                ungroupedTokens.push({ token, tokenData });
              }
            }
            
            // Send each project group separately
            for (const [projectId, projectTokenList] of Object.entries(tokensByProject)) {
              try {
                console.log(`[NotificationService] Sending ${projectTokenList.length} token(s) for project ${projectId}`);
                const projectMessages = projectTokenList.map(({ token }) => ({
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
                    badge: 1,
                  }
                }));
                
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
                const message = {
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
                    badge: 1,
                  }
                };
                
                const ticket = await expoClient.sendPushNotificationsAsync([message]);
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
            // No project conflict - process results normally
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
    
    // Send iOS APNs tokens via Firebase Admin SDK (Firebase routes to Apple APNs)
    for (const { token, tokenData } of iosApnsTokens) {
      try {
        if (!firebaseInitialized) {
          results.push({ token, success: false, reason: 'firebase_not_initialized', method: 'apns' });
          continue;
        }

        // Firebase Admin SDK can send to iOS using APNs tokens
        // The message already has apns configuration, Firebase will route it correctly
        const result = await admin.messaging().send({
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
        });

        results.push({ token, success: true, messageId: result, method: 'apns' });
        
        // Update last_used_at
        tokenData.last_used_at = new Date();
      } catch (error) {
        console.error(`[NotificationService] Failed to send iOS APNs token ${token.substring(0, 20)}...:`, error.message);
        
        // Check if error is due to APNs not being configured in Firebase
        // When APNs is not configured, Firebase tries to treat APNs tokens as FCM tokens
        const isApnsConfigError = error.message?.includes('FCM') && error.message?.includes('not a valid');
        
        if (isApnsConfigError) {
          console.error(`[NotificationService] ⚠️ CRITICAL: Firebase APNs not configured!`);
          console.error(`[NotificationService] Error indicates Firebase is treating APNs token as FCM token.`);
          console.error(`[NotificationService] This means APNs Authentication Key is not uploaded to Firebase Console.`);
          console.error(`[NotificationService] Token is VALID - not removing. Configure APNs in Firebase Console.`);
          console.error(`[NotificationService] See: https://console.firebase.google.com/project/the1-d23f4/settings/cloudmessaging`);
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
    
    // Send Android FCM tokens via Firebase Admin SDK
    for (const { token, tokenData } of androidFcmTokens) {
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
      // Support comma-separated types (e.g., "coe_approved,coe_paid,coe_completed")
      if (type.includes(',')) {
        const types = type.split(',').map(t => t.trim()).filter(t => t);
        query.type = { $in: types };
      } else {
        query.type = type;
      }
    }

    // Get notifications
    // Use createdAt (camelCase) since timestamps: true creates createdAt, not created_at
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('data.coe_id', 'name')
      .populate('data.message_id', 'content')
      .populate('data.payment_id', 'amount currency')
      .populate('data.sender_id', 'firstName lastName avatarUrl');

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

    // Get unread count
    const unreadCount = await Notification.countDocuments({ user_id: userId, read: false });

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

/**
 * Mark notification as unread
 * @param {string} notificationId - Notification ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated notification
 */
async function markAsUnread(notificationId, userId) {
  try {
    const notification = await Notification.findOne({
      _id: notificationId,
      user_id: userId
    });

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
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      user_id: userId
    });

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
    const result = await Notification.deleteMany({
      user_id: userId,
      read: true
    });

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


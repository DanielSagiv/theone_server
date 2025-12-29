const Message = require('../models/Message');
const COE = require('../models/COE');
const User = require('../models/User');
const notificationService = require('./notificationService');

/**
 * Messaging Service
 * @description Handles COE-scoped messaging functionality
 */

/**
 * Verify user has access to COE messaging
 * @param {string} coeId - COE ID
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if user has access
 */
async function verifyCOEAccess(coeId, userId) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      return false;
    }

    // Check if user is COE client
    if (coe.client_id.toString() === userId.toString()) {
      return true;
    }

    // Check if user is COE admin
    if (coe.admin_id.toString() === userId.toString()) {
      return true;
    }

    // Check if user is assigned runner (COE-level)
    if (coe.runner_assignment?.runner_id?.toString() === userId.toString()) {
      return true;
    }

    // Check if user is assigned runner (event-level)
    if (coe.events && Array.isArray(coe.events)) {
      for (const event of coe.events) {
        if (event.runner_assignment?.runner_id?.toString() === userId.toString()) {
          return true;
        }
      }
    }

    // Check if user is participant
    if (coe.participants && Array.isArray(coe.participants)) {
      for (const participant of coe.participants) {
        if (participant.user_id?.toString() === userId.toString()) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('[MessagingService] Error verifying COE access:', error);
    return false;
  }
}

/**
 * Get user role in COE
 * @param {Object} coe - COE object
 * @param {string} userId - User ID
 * @returns {string} User role ('admin', 'client', 'runner', or null)
 */
function getUserRoleInCOE(coe, userId) {
  const userIdStr = userId.toString();

  if (coe.admin_id?.toString() === userIdStr) {
    return 'admin';
  }

  if (coe.client_id?.toString() === userIdStr) {
    return 'client';
  }

  if (coe.runner_assignment?.runner_id?.toString() === userIdStr) {
    return 'runner';
  }

  if (coe.events && Array.isArray(coe.events)) {
    for (const event of coe.events) {
      if (event.runner_assignment?.runner_id?.toString() === userIdStr) {
        return 'runner';
      }
    }
  }

  return null;
}

/**
 * Get all COE participants (for notifications)
 * @param {Object} coe - COE object
 * @param {string} excludeUserId - User ID to exclude from list
 * @returns {Array} Array of user IDs
 */
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

/**
 * Get messages for a COE
 * @param {string} coeId - COE ID
 * @param {string} userId - Current user ID
 * @param {Object} pagination - Pagination options { page, limit }
 * @returns {Promise<Object>} Messages with pagination
 */
async function getCOEMessages(coeId, userId, pagination = {}) {
  try {
    // Verify access
    const hasAccess = await verifyCOEAccess(coeId, userId);
    if (!hasAccess) {
      throw new Error('Access denied to COE messages');
    }

    const page = parseInt(pagination.page) || 1;
    const limit = Math.min(parseInt(pagination.limit) || 50, 100);
    const skip = (page - 1) * limit;

    // Get messages
    const messages = await Message.find({ coe_id: coeId })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sender_id', 'firstName lastName avatarUrl')
      .populate('read_by.user_id', 'firstName lastName');

    // Get total count
    const total = await Message.countDocuments({ coe_id: coeId });

    // Calculate unread count for current user
    const unreadCount = await Message.countDocuments({
      coe_id: coeId,
      'read_by.user_id': { $ne: userId }
    });

    // Reverse to show oldest first (for display)
    messages.reverse();

    return {
      messages,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit)
      },
      unread_count: unreadCount
    };
  } catch (error) {
    console.error('[MessagingService] Error getting COE messages:', error);
    throw error;
  }
}

/**
 * Send message to COE thread
 * @param {string} coeId - COE ID
 * @param {string} userId - Sender user ID
 * @param {string} content - Message content
 * @returns {Promise<Object>} Created message
 */
async function sendCOEMessage(coeId, userId, content) {
  try {
    // Verify access
    const hasAccess = await verifyCOEAccess(coeId, userId);
    if (!hasAccess) {
      throw new Error('Access denied to COE messages');
    }

    // Get COE and user
    const coe = await COE.findById(coeId);
    if (!coe) {
      throw new Error('COE not found');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Get user role
    const senderRole = getUserRoleInCOE(coe, userId);
    if (!senderRole) {
      throw new Error('User role not found in COE');
    }

    // Create message
    const message = new Message({
      coe_id: coeId,
      sender_id: userId,
      sender_role: senderRole,
      sender_name: `${user.firstName} ${user.lastName}`.trim(),
      content: content.trim()
    });

    await message.save();

    // Populate sender for response
    await message.populate('sender_id', 'firstName lastName avatarUrl');

    // Get all COE participants (excluding sender)
    const participants = getCOEParticipants(coe, userId);

    // Create notifications for all participants
    const messagePreview = content.length > 50 ? content.substring(0, 50) + '...' : content;
    
    for (const participantId of participants) {
      try {
        await notificationService.createAndSendNotification(participantId, 'coe_message', {
          coe_id: coeId,
          message_id: message._id,
          coe: { name: coe.name },
          sender_name: message.sender_name,
          message_preview: messagePreview
        });
      } catch (error) {
        console.error(`[MessagingService] Failed to send notification to ${participantId}:`, error);
        // Continue with other participants even if one fails
      }
    }

    return message;
  } catch (error) {
    console.error('[MessagingService] Error sending COE message:', error);
    throw error;
  }
}

/**
 * Mark message as read
 * @param {string} messageId - Message ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated message
 */
async function markMessageAsRead(messageId, userId) {
  try {
    const message = await Message.findById(messageId);
    
    if (!message) {
      throw new Error('Message not found');
    }

    // Verify user has access to COE
    const hasAccess = await verifyCOEAccess(message.coe_id, userId);
    if (!hasAccess) {
      throw new Error('Access denied to message');
    }

    // Check if already read
    const alreadyRead = message.read_by.some(
      read => read.user_id.toString() === userId.toString()
    );

    if (!alreadyRead) {
      message.read_by.push({
        user_id: userId,
        read_at: new Date()
      });
      await message.save();
    }

    // Populate for response
    await message.populate('sender_id', 'firstName lastName avatarUrl');
    await message.populate('read_by.user_id', 'firstName lastName');

    return message;
  } catch (error) {
    console.error('[MessagingService] Error marking message as read:', error);
    throw error;
  }
}

/**
 * Get unread message count for user in COE
 * @param {string} coeId - COE ID
 * @param {string} userId - User ID
 * @returns {Promise<number>} Unread count
 */
async function getUnreadCount(coeId, userId) {
  try {
    // Verify access
    const hasAccess = await verifyCOEAccess(coeId, userId);
    if (!hasAccess) {
      return 0;
    }

    // Count messages not read by user
    const count = await Message.countDocuments({
      coe_id: coeId,
      'read_by.user_id': { $ne: userId }
    });

    return count;
  } catch (error) {
    console.error('[MessagingService] Error getting unread count:', error);
    throw error;
  }
}

module.exports = {
  verifyCOEAccess,
  getUserRoleInCOE,
  getCOEParticipants,
  getCOEMessages,
  sendCOEMessage,
  markMessageAsRead,
  getUnreadCount
};


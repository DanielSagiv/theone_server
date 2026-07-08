const mongoose = require('mongoose');

/**
 * Check if client can edit a COE
 * Clients cannot edit COEs they created until admin approves
 * @param {Object} coe - COE object (with created_by populated or as ID)
 * @param {string} userId - User ID of current user
 * @param {Object} user - User object with role property
 * @returns {Object} { canEdit: boolean, reason?: string }
 */
function canClientEditCOE(coe, userId, user) {
  // Admin can always edit
  if (user.role === 'admin') {
    return { canEdit: true };
  }
  
  // For request and draft statuses: check if client created it
  if (coe.status === 'draft' || coe.status === 'request') {
    // Handle both populated and non-populated created_by
    const createdById = coe.created_by?._id?.toString() || 
                       coe.created_by?.toString() || 
                       (coe.created_by instanceof mongoose.Types.ObjectId ? coe.created_by.toString() : coe.created_by);
    const userIdStr = userId?.toString() || userId;
    const isClientCreator = createdById && userIdStr && createdById === userIdStr;
    
    const clientIdStr = (coe.client_id?._id?.toString() || coe.client_id?.toString());
    const isClientOwner = clientIdStr && userIdStr && clientIdStr === userIdStr;
    
    // If client created the draft/request COE, block editing until approved
    if (isClientCreator && isClientOwner) {
      return { 
        canEdit: false, 
        reason: 'You cannot edit this experience until it is approved by an admin' 
      };
    }
    
    // For draft/request COEs not created by client (e.g., admin-created), use feature flag
    const { isClientCOEEditingEnabled } = require('./featureFlags');
    return { 
      canEdit: isClientCOEEditingEnabled(),
      reason: isClientCOEEditingEnabled() ? undefined : 'Client experience editing is disabled'
    };
  }
  
  // For non-draft/request COEs, use existing feature flag logic
  const { isClientCOEEditingEnabled } = require('./featureFlags');
  return { 
    canEdit: isClientCOEEditingEnabled(),
    reason: isClientCOEEditingEnabled() ? undefined : 'Client experience editing is disabled'
  };
}

/**
 * Client may edit their own COE while it remains in request status (awaiting admin review).
 * @param {Object} coe
 * @param {string} userId
 * @param {Object} user
 * @returns {{ canEdit: boolean, reason?: string }}
 */
function canClientEditOwnRequest(coe, userId, user) {
  if (!coe || (user.role != null && String(user.role).toLowerCase() !== 'client')) {
    return { canEdit: false, reason: 'Client only' };
  }
  if (coe.status !== 'request') {
    return {
      canEdit: false,
      reason: 'Request can only be edited while status is request',
    };
  }
  const userIdStr = userId?.toString() || userId;
  const clientIdStr =
    coe.client_id?._id?.toString() || coe.client_id?.toString();
  if (!clientIdStr || !userIdStr || clientIdStr !== userIdStr) {
    return { canEdit: false, reason: 'You can only edit your own requests' };
  }
  return { canEdit: true };
}

module.exports = {
  canClientEditCOE,
  canClientEditOwnRequest,
};

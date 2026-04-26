const COEHistory = require('../models/COEHistory');
const COE = require('../models/COE');

/**
 * COE History Service
 * @description Centralized service for logging and retrieving COE change incidents
 */

/**
 * Build a basic incident payload
 * @param {Object} params
 * @returns {Object}
 */
function buildIncidentPayload({
  coe,
  coeId,
  userId,
  userRole,
  title,
  changes = [],
  metadata = {}
}) {
  const coe_id = coe?._id || coeId;
  if (!coe_id) {
    throw new Error('[coeHistoryService] Missing coe_id for incident log');
  }

  return {
    coe_id,
    changed_by: userId,
    changed_by_role: userRole || 'system',
    current_status: coe?.status,
    title,
    changes,
    metadata
  };
}

/**
 * Log a COE incident
 * @param {Object} params
 * @returns {Promise<void>}
 */
async function logIncident(params) {
  try {
    let coeDoc = params.coe;
    if (!coeDoc && params.coeId) {
      coeDoc = await COE.findById(params.coeId).select('status');
    }

    const payload = buildIncidentPayload({
      ...params,
      coe: coeDoc
    });

    await COEHistory.create({
      ...payload,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('[coeHistoryService] Failed to log incident:', {
      message: error.message,
      stack: error.stack
    });
    // Best-effort: do not throw
  }
}

/**
 * Get history incidents for a COE
 * @param {string} coeId
 * @param {Object} options
 * @returns {Promise<Array>}
 */
async function getHistoryForCOE(coeId, { limit = 100, offset = 0 } = {}) {
  try {
    const query = COEHistory.find({ coe_id: coeId })
      .sort({ timestamp: -1 })
      .skip(offset)
      .limit(limit)
      .populate('changed_by', 'firstName lastName email role');

    const incidents = await query.exec();

    return incidents.map((incident) => {
      const changedBy = incident.changed_by || {};
      const nameParts = [changedBy.firstName, changedBy.lastName].filter(Boolean);
      const displayName =
        nameParts.length > 0 ? nameParts.join(' ') : changedBy.email || 'System';

      return {
        id: incident._id.toString(),
        timestamp: incident.timestamp || incident.createdAt,
        changed_by: {
          id: changedBy._id ? changedBy._id.toString() : null,
          name: displayName,
          role: incident.changed_by_role || changedBy.role || 'system'
        },
        current_status: incident.current_status,
        title: incident.title,
        changes: incident.changes || []
      };
    });
  } catch (error) {
    console.error('[coeHistoryService] Failed to get history for COE:', {
      coeId,
      message: error.message
    });
    throw error;
  }
}

module.exports = {
  logIncident,
  getHistoryForCOE
};


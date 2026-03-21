/**
 * Admin-only dashboard utilities (test / dev tooling).
 * @description Secured CLEAN operations for selected Mongo collections.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const BotConversation = require('../models/BotConversation');
const Message = require('../models/Message');
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const COE = require('../models/COE');
const coeService = require('../services/coeService');

/** Hard-coded tools password (dashboard Tools tab); validate on every request. */
const TOOLS_CLEAN_PASSWORD = 'sagsag';

const ALLOWED_COLLECTIONS = [
  'botconversations',
  'messages',
  'notifications',
  'payments',
  'coes'
];

/**
 * POST /v1/admin/tools/clean
 * Wipe one collection, or delete all COEs via coeService.deleteCOE (same as COE trash).
 * @body {string} toolsPassword
 * @body {string} collection - one of ALLOWED_COLLECTIONS
 */
router.post('/clean', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { toolsPassword, collection } = req.body || {};

    if (typeof toolsPassword !== 'string' || toolsPassword !== TOOLS_CLEAN_PASSWORD) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or missing tools password'
      });
    }

    if (!collection || typeof collection !== 'string' || !ALLOWED_COLLECTIONS.includes(collection)) {
      return res.status(400).json({
        success: false,
        message: `Invalid collection. Allowed: ${ALLOWED_COLLECTIONS.join(', ')}`
      });
    }

    if (collection === 'coes') {
      const ids = await COE.find({}).select('_id').lean();
      let deletedCount = 0;
      const failed = [];

      for (const row of ids) {
        const id = row._id?.toString();
        if (!id) continue;
        try {
          await coeService.deleteCOE(id);
          deletedCount += 1;
        } catch (err) {
          failed.push({
            id,
            error: err.message || 'Delete failed'
          });
        }
      }

      return res.json({
        success: true,
        collection: 'coes',
        deletedCount,
        failed,
        failedCount: failed.length,
        message:
          failed.length === 0
            ? `Deleted ${deletedCount} experience(s) using standard delete logic.`
            : `Deleted ${deletedCount} experience(s); ${failed.length} could not be deleted (see failed).`
      });
    }

    let result;
    switch (collection) {
      case 'botconversations':
        result = await BotConversation.deleteMany({});
        break;
      case 'messages':
        result = await Message.deleteMany({});
        break;
      case 'notifications':
        result = await Notification.deleteMany({});
        break;
      case 'payments':
        result = await Payment.deleteMany({});
        break;
      default:
        return res.status(400).json({ success: false, message: 'Unhandled collection' });
    }

    const deletedCount = result.deletedCount ?? 0;
    return res.json({
      success: true,
      collection,
      deletedCount,
      message: `Removed ${deletedCount} document(s) from ${collection}.`
    });
  } catch (error) {
    console.error('[adminTools] /clean error:', error);
    return res.status(500).json({
      success: false,
      message: 'Clean operation failed',
      error: error.message || 'Unknown error'
    });
  }
});

module.exports = router;

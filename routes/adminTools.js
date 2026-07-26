/**
 * Admin-only dashboard utilities (test / dev tooling).
 * @description Secured CLEAN operations and section-image AI tools.
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
const sectionImageAiService = require('../services/sectionImageAiService');

/** Hard-coded tools password (dashboard Tools tab); validate on every request. */
const TOOLS_CLEAN_PASSWORD = 'sagsag';

const ALLOWED_COLLECTIONS = [
  'botconversations',
  'messages',
  'notifications',
  'payments',
  'coes'
];

/** Special value: run CLEAN for every entry in ALLOWED_COLLECTIONS in order. */
const CLEAN_ALL_TOKEN = 'all';

/**
 * Execute CLEAN for one collection; returns a result object (no HTTP response).
 * @param {string} collection - one of ALLOWED_COLLECTIONS
 * @returns {Promise<object>}
 */
async function performCleanCollection(collection) {
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

    return {
      success: true,
      collection: 'coes',
      deletedCount,
      failed,
      failedCount: failed.length,
      message:
        failed.length === 0
          ? `Deleted ${deletedCount} experience(s) using standard delete logic.`
          : `Deleted ${deletedCount} experience(s); ${failed.length} could not be deleted (see failed).`
    };
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
      throw new Error(`Unhandled collection: ${collection}`);
  }

  const deletedCount = result.deletedCount ?? 0;
  return {
    success: true,
    collection,
    deletedCount,
    message: `Removed ${deletedCount} document(s) from ${collection}.`
  };
}

/**
 * POST /v1/admin/tools/clean
 * Wipe one collection, or delete all COEs via coeService.deleteCOE (same as COE trash).
 * @body {string} toolsPassword
 * @body {string} collection - one of ALLOWED_COLLECTIONS, or "all" to run each in order
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

    const isAll = collection === CLEAN_ALL_TOKEN;
    if (
      !collection ||
      typeof collection !== 'string' ||
      (!isAll && !ALLOWED_COLLECTIONS.includes(collection))
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid collection. Allowed: ${ALLOWED_COLLECTIONS.join(', ')}, or "${CLEAN_ALL_TOKEN}" for all`
      });
    }

    if (isAll) {
      const results = [];
      for (const name of ALLOWED_COLLECTIONS) {
        try {
          const part = await performCleanCollection(name);
          results.push(part);
        } catch (err) {
          console.error(`[adminTools] /clean all failed at ${name}:`, err);
          results.push({
            success: false,
            collection: name,
            message: err.message || 'Clean failed',
            error: err.message || 'Unknown error'
          });
        }
      }
      const allOk = results.every(r => r.success !== false);
      const summary = results
        .map(r => `${r.collection}: ${r.message || r.error || 'done'}`)
        .join(' | ');
      return res.json({
        success: allOk,
        all: true,
        results,
        message: allOk
          ? `CLEAN all completed (${ALLOWED_COLLECTIONS.length} collections). ${summary}`
          : `CLEAN all finished with errors. ${summary}`
      });
    }

    const payload = await performCleanCollection(collection);
    return res.json(payload);
  } catch (error) {
    console.error('[adminTools] /clean error:', error);
    return res.status(500).json({
      success: false,
      message: 'Clean operation failed',
      error: error.message || 'Unknown error'
    });
  }
});

/**
 * GET /v1/admin/tools/section-images?locationId=
 * List seat/section image media for one location.
 */
router.get('/section-images', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const locationId = req.query?.locationId;
    const data = await sectionImageAiService.listLocationSectionImages(locationId);
    return res.json({ success: true, data });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('[adminTools] GET /section-images error:', error.message);
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to list section images',
      error: error.message || 'Unknown error',
    });
  }
});

/**
 * POST /v1/admin/tools/section-images/process
 * AI-edit: either seat media from DB, or a local image (sourceBase64, preview only).
 * @body {string} [locationId]
 * @body {string} [seatCode]
 * @body {number} [mediaIndex]
 * @body {string} [sourceBase64] local image (raw base64 or data URL)
 * @body {string} [mime]
 * @body {string} [extraPrompt] optional note appended to the fixed base prompt
 */
router.post('/section-images/process', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { locationId, seatCode, mediaIndex, sourceBase64, mime, extraPrompt } =
      req.body || {};
    const hasLocal = Boolean(String(sourceBase64 || '').trim());
    const hasSeat =
      Boolean(locationId) && Boolean(seatCode) && mediaIndex != null;

    if (!hasLocal && !hasSeat) {
      return res.status(400).json({
        success: false,
        message:
          'Provide sourceBase64 (local image) or locationId, seatCode, and mediaIndex',
      });
    }

    const result = hasLocal
      ? await sectionImageAiService.processLocalSectionImage({
          sourceBase64,
          mime,
          extraPrompt,
        })
      : await sectionImageAiService.processSectionImage({
          locationId,
          seatCode,
          mediaIndex: Number(mediaIndex),
          extraPrompt,
        });
    return res.json({ success: true, data: result });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('[adminTools] POST /section-images/process error:', error.message);
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to process section image',
      error: error.message || 'Unknown error',
    });
  }
});

/**
 * POST /v1/admin/tools/section-images/apply
 * Upload processed image to S3 and replace the seat media slot.
 * @body {string} locationId
 * @body {string} seatCode
 * @body {number} mediaIndex
 * @body {string} previewBase64
 * @body {string} [mime]
 */
router.post('/section-images/apply', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { locationId, seatCode, mediaIndex, previewBase64, mime } = req.body || {};
    if (!locationId || !seatCode || mediaIndex == null || !previewBase64) {
      return res.status(400).json({
        success: false,
        message: 'locationId, seatCode, mediaIndex, and previewBase64 are required',
      });
    }
    const userId = req.user?._id || req.user?.id || 'admin';
    const media = await sectionImageAiService.applyProcessedSectionImage({
      locationId,
      seatCode,
      mediaIndex: Number(mediaIndex),
      previewBase64,
      mime,
      userId: String(userId),
    });
    return res.json({ success: true, data: { media } });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error('[adminTools] POST /section-images/apply error:', error.message);
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to apply section image',
      error: error.message || 'Unknown error',
    });
  }
});

module.exports = router;

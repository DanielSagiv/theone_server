const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { runTaoGroupImport } = require('../services/taoGroupImportService');

const router = express.Router();

/**
 * POST /v1/tao/import
 * @description Import events and venues from Tao Group events page. Creates/updates Location and Event records.
 */
router.post('/import', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = req.user._id;
    console.log('[Tao import] POST /v1/tao/import: start', { userId });
    const { summary, data } = await runTaoGroupImport(userId);
    console.log('[Tao import] POST /v1/tao/import: done', { summary });

    res.json({
      success: true,
      message: 'Tao Group import completed',
      summary: {
        venuesCreated: summary.venuesCreated,
        venuesUpdated: summary.venuesUpdated,
        eventsCreated: summary.eventsCreated,
        eventsUpdated: summary.eventsUpdated,
        failed: summary.failed,
        errors: summary.errors
      },
      data
    });
  } catch (error) {
    console.error('Tao Group import error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({
      success: false,
      error: {
        code: 'TAO_IMPORT_FAILED',
        message: 'Failed to import from Tao Group',
        details: error.message
      }
    });
  }
});

module.exports = router;

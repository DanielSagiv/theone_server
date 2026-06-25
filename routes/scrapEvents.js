const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { fetchLivLasVegasEventsPreview } = require('../services/scrapEvents/livLasVegasScraperService');

const router = express.Router();

/**
 * GET /v1/scrap-events/liv/events
 * @description Preview LIV Las Vegas events from venue listing (no database writes).
 */
router.get('/liv/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('[scrap-events] GET /liv/events: start', { userId: req.user?._id });
    const payload = await fetchLivLasVegasEventsPreview();

    if (payload.browserError) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'SCRAP_BROWSER_UNAVAILABLE',
          message: 'Could not load LIV events page in headless browser',
          details: payload.browserError,
        },
        sourceUrl: payload.sourceUrl,
        warnings: payload.warnings,
      });
    }

    res.json({
      success: true,
      sourceUrl: payload.sourceUrl,
      scrapedAt: payload.scrapedAt,
      count: payload.count,
      events: payload.events,
      warnings: payload.warnings,
    });
  } catch (error) {
    console.error('[scrap-events] GET /liv/events error:', {
      error: error.message,
      timestamp: new Date().toISOString(),
    });
    res.status(500).json({
      success: false,
      error: {
        code: 'LIV_SCRAPE_FAILED',
        message: 'Failed to fetch LIV live events',
        details: error.message,
      },
    });
  }
});

module.exports = router;

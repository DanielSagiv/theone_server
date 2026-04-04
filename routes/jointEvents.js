/**
 * Admin routes: joint / shared-table event allocation (jointevent plan).
 */
const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const jointEventService = require('../services/jointEventService');

/**
 * GET /v1/admin/events/:eventId/joint-sections
 * List sections on an event that have at least one available seat.
 */
router.get('/events/:eventId/joint-sections', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const data = await jointEventService.listJointSectionOptions(req.params.eventId);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[jointEvents] joint-sections:', error.message);
    return res.status(400).json({
      success: false,
      error: { message: error.message || 'Failed to list sections' },
    });
  }
});

/**
 * POST /v1/admin/joint-events
 * Body: { event_id, section_category, clients: [{ client_id, share_percent }] }
 */
router.post('/joint-events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { event_id, section_category, clients } = req.body || {};
    const data = await jointEventService.createJointEventAllocation({
      adminUserId: req.user._id.toString(),
      eventId: event_id,
      sectionCategory: section_category,
      clients,
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('[jointEvents] create:', error.message);
    return res.status(400).json({
      success: false,
      error: { message: error.message || 'Failed to create joint event' },
    });
  }
});

module.exports = router;

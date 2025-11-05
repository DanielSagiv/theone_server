const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { importVenuesFromGXN, importEventsFromGXN } = require('../services/gxnImportService');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

/**
 * POST /v1/gxn/import/venues
 * @description Import venues from gxn_res.json file into Location records
 */
router.post('/import/venues', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Read gxn_res.json
    const filePath = path.join(__dirname, '../gxn_res.json');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const gxnData = JSON.parse(fileContent);
    
    // Import venues
    const results = await importVenuesFromGXN(gxnData, req.user._id);
    
    res.json({
      success: true,
      message: 'Venue import completed',
      data: results,
      summary: {
        total: results.success.length + results.failed.length + results.skipped.length,
        imported: results.success.length,
        failed: results.failed.length,
        skipped: results.skipped.length
      }
    });
    
  } catch (error) {
    console.error('GXN venue import error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({
      success: false,
      error: {
        code: 'GXN_IMPORT_FAILED',
        message: 'Failed to import venues from GXN',
        details: error.message
      }
    });
  }
});

/**
 * POST /v1/gxn/import/events
 * @description Import events from gxn_res.json schedules into Event records
 */
router.post('/import/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Read gxn_res.json
    const filePath = path.join(__dirname, '../gxn_res.json');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const gxnData = JSON.parse(fileContent);
    
    // Import events
    const results = await importEventsFromGXN(gxnData, req.user._id);
    
    res.json({
      success: true,
      message: 'Event import completed',
      data: results,
      summary: {
        total: results.success.length + results.failed.length + results.skipped.length,
        imported: results.success.length,
        failed: results.failed.length,
        skipped: results.skipped.length
      }
    });
    
  } catch (error) {
    console.error('GXN event import error:', { error: error.message, timestamp: new Date().toISOString() });
    res.status(500).json({
      success: false,
      error: {
        code: 'GXN_EVENT_IMPORT_FAILED',
        message: 'Failed to import events from GXN',
        details: error.message
      }
    });
  }
});

module.exports = router;


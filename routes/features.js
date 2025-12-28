const express = require('express');
const router = express.Router();
const { isClientCOECreationEnabled, isClientCOEEditingEnabled } = require('../utils/featureFlags');

/**
 * GET /v1/features/flags
 * Get feature flags (public endpoint, no auth required)
 * Returns feature flags that affect client-side behavior
 */
router.get('/flags', (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        enableClientCOECreation: isClientCOECreationEnabled(),
        enableClientCOEEditing: isClientCOEEditingEnabled()
      }
    });
  } catch (error) {
    console.error('Error getting feature flags:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get feature flags'
    });
  }
});

module.exports = router;


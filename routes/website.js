const express = require('express');
const router = express.Router();
const path = require('path');

/**
 * GET /website
 * Serve the main website page
 */
router.get('/', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/index.html'));
  } catch (error) {
    console.error('Error serving website index:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/experience
 * Serve the experience page
 */
router.get('/experience', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/experience.html'));
  } catch (error) {
    console.error('Error serving experience page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/membership
 * Serve the membership page
 */
router.get('/membership', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/membership.html'));
  } catch (error) {
    console.error('Error serving membership page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/vision
 * Serve the vision page
 */
router.get('/vision', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/vision.html'));
  } catch (error) {
    console.error('Error serving vision page:', error);
    res.status(500).send('Error loading page');
  }
});

module.exports = router;


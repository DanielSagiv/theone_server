const express = require('express');
const router = express.Router();
const path = require('path');
const { requireWebsitePasswordAuth } = require('../middleware/websitePasswordProtection');

/**
 * POST /website/login
 * Handle password authentication for website access
 * The middleware will process the password and redirect if correct
 */
router.post('/login', requireWebsitePasswordAuth, (req, res) => {
  // If we reach here, user is authenticated, redirect to home
  res.redirect('/website');
});

/**
 * GET /website/login
 * Show login page
 * The middleware will show login form if not authenticated
 */
router.get('/login', requireWebsitePasswordAuth, (req, res) => {
  // If we reach here, user is authenticated, redirect to home
  res.redirect('/website');
});

/**
 * GET /website
 * Serve the main website page (password protected)
 */
router.get('/', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/index.html'));
  } catch (error) {
    console.error('Error serving website index:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/experience
 * Serve the experience page (password protected)
 */
router.get('/experience', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/experience.html'));
  } catch (error) {
    console.error('Error serving experience page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/membership
 * Serve the membership page (password protected)
 */
router.get('/membership', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/membership.html'));
  } catch (error) {
    console.error('Error serving membership page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/vision
 * Serve the vision page (password protected)
 */
router.get('/vision', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/vision.html'));
  } catch (error) {
    console.error('Error serving vision page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/contact
 * Serve the contact page (password protected)
 */
router.get('/contact', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/contact.html'));
  } catch (error) {
    console.error('Error serving contact page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/terms
 * Serve the terms and conditions page (password protected)
 */
router.get('/terms', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/terms.html'));
  } catch (error) {
    console.error('Error serving terms page:', error);
    res.status(500).send('Error loading page');
  }
});

/**
 * GET /website/privacy
 * Serve the privacy policy page (password protected)
 */
router.get('/privacy', requireWebsitePasswordAuth, (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../website/privacy.html'));
  } catch (error) {
    console.error('Error serving privacy page:', error);
    res.status(500).send('Error loading page');
  }
});

module.exports = router;


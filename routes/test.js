const express = require('express');
const router = express.Router();
const path = require('path');

/**
 * GET /test/login
 * Display login form for testing
 */
router.get('/login', (req, res) => {
  res.render('test/login', {
    title: 'The1 Platform - Login Test',
    error: null,
    success: null
  });
});

/**
 * GET /test/signup
 * Display signup form for testing
 */
router.get('/signup', (req, res) => {
  res.render('test/signup', {
    title: 'The1 Platform - Sign Up',
    error: null,
    success: null
  });
});

/**
 * GET /test/verify-email
 * Display email verification page
 */
router.get('/verify-email', (req, res) => {
  res.render('test/verify-email', {
    title: 'Verify Email - The1 Platform'
  });
});

/**
 * GET /test/dashboard
 * Display user dashboard with API testing tools
 */
router.get('/dashboard', (req, res) => {
  res.render('test/dashboard', {
    title: 'The1 Platform - API Test Dashboard',
    user: null,
    token: null
  });
});

/**
 * GET /test/gxn-sample
 * Display a static GXN inventoryinfo sample viewer (no external calls)
 */
// Removed deprecated gxn-sample route

// Venues-only viewer
router.get('/gxn-venues', (req, res) => {
  res.render('test/gxn-venues', {
    title: 'GXN Venues'
  });
});

/**
 * GET /test/gxn-res.json
 * Serve static GXN sample JSON from project root
 */
router.get('/gxn-res.json', (req, res) => {
  const filePath = path.resolve(process.cwd(), 'gxn_res.json');
  res.sendFile(filePath);
});

/**
 * GET /test/users
 * Display user management testing interface
 */
router.get('/users', (req, res) => {
  res.render('test/users', {
    title: 'The1 Platform - User Management Test',
    users: [],
    error: null
  });
});

/**
 * GET /test/sessions
 * Display session management testing interface
 */
router.get('/sessions', (req, res) => {
  res.render('test/sessions', {
    title: 'The1 Platform - Session Management Test',
    sessions: [],
    error: null
  });
});

module.exports = router;

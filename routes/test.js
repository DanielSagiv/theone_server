const express = require('express');
const router = express.Router();

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

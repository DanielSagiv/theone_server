const express = require('express');
const Joi = require('joi');
const jwt = require('jsonwebtoken');

const router = express.Router();

const clientLogSchema = Joi.object({
  event: Joi.string().trim().min(1).max(120).required(),
  level: Joi.string().valid('info', 'warn', 'error').default('info'),
  message: Joi.string().trim().max(500).allow(''),
  data: Joi.object().unknown(true).default({}),
  platform: Joi.string().trim().max(32).allow('', null),
  appVersion: Joi.string().trim().max(32).allow('', null),
  clientTimestamp: Joi.string().trim().max(64).allow('', null),
}).unknown(false);

/**
 * Resolve optional user id from Bearer JWT (no session lookup — logging only).
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function optionalUserIdFromAuth(req) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token || !process.env.JWT_SECRET) {
      return null;
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded?.userId ? String(decoded.userId) : null;
  } catch (_) {
    return null;
  }
}

/**
 * POST /v1/client-logs
 * Accept mobile client diagnostics; emit structured log for CloudWatch.
 */
router.post('/', async (req, res) => {
  try {
    const {error, value} = clientLogSchema.validate(req.body, {abortEarly: true});
    if (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: error.details[0].message,
        },
      });
    }

    const userId = optionalUserIdFromAuth(req);
    const entry = {
      source: 'mobile_client',
      event: value.event,
      level: value.level,
      message: value.message || value.event,
      platform: value.platform || null,
      appVersion: value.appVersion || null,
      clientTimestamp: value.clientTimestamp || null,
      userId,
      data: value.data,
      serverTimestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || null,
    };

    const line = `[MOBILE_CLIENT] ${JSON.stringify(entry)}`;
    if (value.level === 'error') {
      console.error(line);
    } else if (value.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    return res.status(202).json({success: true});
  } catch (err) {
    console.error('[MOBILE_CLIENT] ingest_error', {
      message: err?.message || String(err),
      timestamp: new Date().toISOString(),
    });
    return res.status(500).json({
      success: false,
      error: {
        code: 'CLIENT_LOG_FAILED',
        message: 'Failed to record client log',
      },
    });
  }
});

module.exports = router;

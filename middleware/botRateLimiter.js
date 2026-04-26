/**
 * Bot Rate Limiting Middleware
 * @description Rate limiting for bot endpoints to prevent abuse and manage costs
 * 
 * Uses in-memory storage for simplicity. For production, consider Redis-based rate limiting.
 */

const BotUsageLog = require('../models/BotUsageLog');

// In-memory rate limit store (for production, use Redis)
const rateLimitStore = new Map();

// Rate limit configuration
const RATE_LIMITS = {
  user_per_hour: parseInt(process.env.RATE_LIMIT_USER_PER_HOUR) || 100,
  user_per_day: parseInt(process.env.RATE_LIMIT_USER_PER_DAY) || 1000,
  ip_per_hour: parseInt(process.env.RATE_LIMIT_IP_PER_HOUR) || 200,
  tool_per_hour: parseInt(process.env.RATE_LIMIT_TOOL_PER_HOUR) || 10
};

/**
 * Clean up expired entries from rate limit store
 */
function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.expiresAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

// Clean up every 5 minutes
setInterval(cleanupRateLimitStore, 5 * 60 * 1000);

/**
 * Check rate limit for a key
 * @param {string} key - Rate limit key
 * @param {number} maxRequests - Maximum requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {Object} { allowed: boolean, remaining: number, resetAt: Date }
 */
function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.expiresAt < now) {
    // Create new entry
    rateLimitStore.set(key, {
      count: 1,
      expiresAt: now + windowMs,
      resetAt: new Date(now + windowMs)
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: new Date(now + windowMs)
    };
  }

  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt
    };
  }

  // Increment count
  entry.count++;
  rateLimitStore.set(key, entry);

  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt
  };
}

/**
 * Per-user rate limit middleware
 */
function userRateLimit(req, res, next) {
  if (!req.user || !req.user._id) {
    return next(); // Skip if no user (shouldn't happen with authenticateToken)
  }

  const key = `user:${req.user._id.toString()}`;
  const hourLimit = checkRateLimit(key, RATE_LIMITS.user_per_hour, 60 * 60 * 1000);

  if (!hourLimit.allowed) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Maximum ${RATE_LIMITS.user_per_hour} requests per hour.`,
        category: 'service',
        retryable: true,
        resetAt: hourLimit.resetAt
      }
    });
  }

  // Check daily limit
  const dayKey = `user:day:${req.user._id.toString()}:${new Date().toISOString().split('T')[0]}`;
  const dayLimit = checkRateLimit(dayKey, RATE_LIMITS.user_per_day, 24 * 60 * 60 * 1000);

  if (!dayLimit.allowed) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Daily rate limit exceeded. Maximum ${RATE_LIMITS.user_per_day} requests per day.`,
        category: 'service',
        retryable: true,
        resetAt: dayLimit.resetAt
      }
    });
  }

  // Add rate limit headers
  res.set({
    'X-RateLimit-Limit': RATE_LIMITS.user_per_hour,
    'X-RateLimit-Remaining': hourLimit.remaining,
    'X-RateLimit-Reset': hourLimit.resetAt.getTime()
  });

  next();
}

/**
 * Per-IP rate limit middleware
 */
function ipRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const key = `ip:${ip}`;
  const limit = checkRateLimit(key, RATE_LIMITS.ip_per_hour, 60 * 60 * 1000);

  if (!limit.allowed) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `IP rate limit exceeded. Maximum ${RATE_LIMITS.ip_per_hour} requests per hour.`,
        category: 'service',
        retryable: true,
        resetAt: limit.resetAt
      }
    });
  }

  res.set({
    'X-RateLimit-Limit-IP': RATE_LIMITS.ip_per_hour,
    'X-RateLimit-Remaining-IP': limit.remaining,
    'X-RateLimit-Reset-IP': limit.resetAt.getTime()
  });

  next();
}

/**
 * Check cost limits for user
 * @param {string} userId - User ID
 * @returns {Promise<{ allowed: boolean, dailyCost: number, limit: number }>}
 */
async function checkCostLimit(userId) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const dailyCost = await BotUsageLog.getUserCost(userId, startOfDay, endOfDay);
  const costLimit = parseFloat(process.env.OPENAI_COST_ALERT_USER_DAILY) || 50;

  return {
    allowed: dailyCost < costLimit,
    dailyCost: dailyCost,
    limit: costLimit
  };
}

/**
 * Cost limit middleware (warns but doesn't block)
 */
async function costLimitCheck(req, res, next) {
  if (!req.user || !req.user._id) {
    return next();
  }

  try {
    const costCheck = await checkCostLimit(req.user._id.toString());
    
    if (!costCheck.allowed) {
      // Log warning but don't block (admin can review)
      console.warn(`User ${req.user._id} exceeded daily cost limit: $${costCheck.dailyCost.toFixed(2)} / $${costCheck.limit}`);
      // Could send alert to admin here
    }

    // Add cost info to response headers
    res.set({
      'X-Cost-Today': costCheck.dailyCost.toFixed(2),
      'X-Cost-Limit': costCheck.limit.toFixed(2)
    });
  } catch (error) {
    console.error('Error checking cost limit:', error);
    // Don't fail the request if cost check fails
  }

  next();
}

module.exports = {
  userRateLimit,
  ipRateLimit,
  costLimitCheck,
  checkCostLimit,
  RATE_LIMITS
};


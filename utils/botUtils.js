const crypto = require('crypto');

/** ttt
 * Bot Utility Functions
 * @description Shared utilities for bot operations including correlation IDs, error taxonomy, and cost tracking
 */

/**text
 * Generate a correlation ID for request tracing
 * @returns {string} Correlation ID
 */
function generateCorrelationId() {
  return crypto.randomUUID();
}

/**
 * Standard error taxonomy
 */
const ErrorCodes = {
  // Validation errors
  INVALID_DATE_FORMAT: 'INVALID_DATE_FORMAT',
  INVALID_PARAMETERS: 'INVALID_PARAMETERS',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  
  // Permission errors
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Service errors
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  
  // Network errors
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  
  // Conversation errors
  MISSING_CONTEXT: 'MISSING_CONTEXT',
  INVALID_TOOL_CALL: 'INVALID_TOOL_CALL',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Cost errors
  COST_LIMIT_EXCEEDED: 'COST_LIMIT_EXCEEDED',
  
  // Idempotency
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION'
};

const ErrorCategories = {
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  SERVICE: 'service',
  NETWORK: 'network',
  CONVERSATION: 'conversation'
};

/**
 * Create standardized error response
 * @param {string} code - Error code
 * @param {string} message - User-friendly message
 * @param {string} category - Error category
 * @param {boolean} retryable - Whether error is retryable
 * @param {Object} fieldErrors - Field-level errors
 * @param {Object} context - Additional context
 * @returns {Object} Standardized error object
 */
function createError(code, message, category = ErrorCategories.SERVICE, retryable = false, fieldErrors = null, context = {}) {
  const error = {
    code,
    message,
    category,
    retryable,
    context
  };

  if (fieldErrors) {
    error.field_errors = fieldErrors;
  }

  return error;
}

/**
 * Map error code to category
 * @param {string} code - Error code
 * @returns {string} Error category
 */
function getErrorCategory(code) {
  if (code.startsWith('INVALID_') || code.startsWith('MISSING_')) {
    return ErrorCategories.VALIDATION;
  }
  if (code.includes('PERMISSION') || code.includes('UNAUTHORIZED')) {
    return ErrorCategories.PERMISSION;
  }
  if (code.includes('NETWORK') || code.includes('TIMEOUT') || code.includes('CONNECTION')) {
    return ErrorCategories.NETWORK;
  }
  if (code.includes('CONTEXT') || code.includes('TOOL')) {
    return ErrorCategories.CONVERSATION;
  }
  return ErrorCategories.SERVICE;
}

/**
 * Determine if error is retryable
 * @param {string} code - Error code
 * @returns {boolean} True if retryable
 */
function isRetryableError(code) {
  const retryableCodes = [
    ErrorCodes.NETWORK_TIMEOUT,
    ErrorCodes.CONNECTION_ERROR,
    ErrorCodes.SERVICE_UNAVAILABLE,
    ErrorCodes.EXTERNAL_API_ERROR
  ];
  return retryableCodes.includes(code);
}

/**
 * Calculate OpenAI cost based on model and tokens
 * @param {string} model - OpenAI model name
 * @param {number} tokensInput - Input tokens
 * @param {number} tokensOutput - Output tokens
 * @returns {number} Cost in USD
 */
function calculateOpenAICost(model, tokensInput, tokensOutput) {
  // Pricing per 1M tokens (as of 2024)
  const pricing = {
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
  };

  const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
  const inputCost = (tokensInput / 1_000_000) * modelPricing.input;
  const outputCost = (tokensOutput / 1_000_000) * modelPricing.output;
  
  return inputCost + outputCost;
}

/**
 * Sanitize parameters for logging (remove sensitive data)
 * @param {Object} params - Parameters object
 * @returns {Object} Sanitized parameters
 */
function sanitizeParamsForLogging(params) {
  if (!params || typeof params !== 'object') return params;
  
  const sensitiveFields = ['password', 'token', 'api_key', 'secret', 'credit_card', 'ssn'];
  const sanitized = { ...params };
  
  for (const key in sanitized) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeParamsForLogging(sanitized[key]);
    }
  }
  
  return sanitized;
}

module.exports = {
  generateCorrelationId,
  ErrorCodes,
  ErrorCategories,
  createError,
  getErrorCategory,
  isRetryableError,
  calculateOpenAICost,
  sanitizeParamsForLogging
};


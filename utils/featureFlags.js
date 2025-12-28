/**
 * Feature flag utility
 * Centralized feature flag checks for the application
 */

/**
 * Check if client COE creation is enabled
 * Clients can create their own COEs when enabled
 * @returns {boolean} True if clients can create COEs
 */
function isClientCOECreationEnabled() {
  return process.env.ENABLE_CLIENT_COE_CREATION === 'true';
}

/**
 * Check if client COE editing is enabled
 * Clients can edit their own COEs when enabled
 * @returns {boolean} True if clients can edit COEs
 */
function isClientCOEEditingEnabled() {
  return process.env.ENABLE_CLIENT_COE_EDITING === 'true';
}

module.exports = {
  isClientCOECreationEnabled,
  isClientCOEEditingEnabled
};


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

/**
 * Admin joint-event / shared-table flow (mobile Search Events + API).
 * @returns {boolean}
 */
function isJointEventAdminEnabled() {
  return process.env.ENABLE_JOINT_EVENT_ADMIN === 'true';
}

/**
 * When true (default), historically gated client signup approval.
 * Self-signup always uses pendingApproval now (see authService.registerUser).
 * Kept for any callers / ops docs; prefer not using VERIFY_USER=false for signup.
 * @returns {boolean}
 */
function isClientRegistrationApprovalRequired() {
  return process.env.VERIFY_USER !== 'false';
}

module.exports = {
  isClientCOECreationEnabled,
  isClientCOEEditingEnabled,
  isJointEventAdminEnabled,
  isClientRegistrationApprovalRequired,
};


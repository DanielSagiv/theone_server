/**
 * Figma-aligned transactional email layout (dark card shell).
 */

const layout = require('./layout');
const escape = require('./escape');
const tokens = require('./tokens');

module.exports = {
  ...layout,
  escapeHtml: escape.escapeHtml,
  escapeHtmlAttr: escape.escapeHtmlAttr,
  tokens,
};

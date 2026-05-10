/**
 * Escape text for safe insertion into HTML email bodies.
 * @param {string} s Raw string
 * @returns {string} Escaped string
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape for use inside double-quoted HTML attributes.
 * @param {string} s Raw string
 * @returns {string} Escaped string
 */
function escapeHtmlAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

module.exports = { escapeHtml, escapeHtmlAttr };

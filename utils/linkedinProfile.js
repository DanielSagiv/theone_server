/**
 * Normalize / validate a LinkedIn profile value for storage.
 * Empty is allowed. Values without a scheme get https:// when they look like LinkedIn.
 */

/**
 * @param {unknown} raw
 * @returns {string|null} Canonical URL, '' if empty, null if invalid
 */
function normalizeLinkedInProfileUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return '';
  }

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate.replace(/^\/+/, '')}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    const slug = trimmed.replace(/^@/, '').replace(/^\/+/, '');
    if (/^[a-zA-Z0-9][a-zA-Z0-9\-_%]{1,99}$/.test(slug)) {
      return `https://www.linkedin.com/in/${slug}`;
    }
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) {
    return null;
  }

  return parsed.href;
}

/**
 * @param {unknown} raw
 * @returns {boolean}
 */
function isLinkedInProfileUrl(raw) {
  return normalizeLinkedInProfileUrl(raw) !== null;
}

module.exports = {
  normalizeLinkedInProfileUrl,
  isLinkedInProfileUrl,
};

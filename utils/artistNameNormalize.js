/**
 * Normalize artist / event name strings for catalog lookup and matching.
 * @param {string} name
 * @returns {string}
 */
function normalizeArtistKey(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

module.exports = {
  normalizeArtistKey,
};

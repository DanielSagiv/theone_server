/**
 * Resolve effective party size for a COE event line (per-event override or COE default).
 */

/**
 * @param {object|null|undefined} coeEvent - COE.events[] row
 * @param {object|null|undefined} coe - COE document or plain object
 * @returns {number|null}
 */
function getEffectiveCoeEventPartySize(coeEvent, coe) {
  const fromEvent = Number(coeEvent?.party_size);
  if (Number.isFinite(fromEvent) && fromEvent >= 1) {
    return Math.floor(fromEvent);
  }
  const ord = coe?.original_request_data || {};
  const prefs = coe?.preferences || {};
  const fromOrd = Number(ord.party_size);
  if (Number.isFinite(fromOrd) && fromOrd >= 1) {
    return Math.floor(fromOrd);
  }
  const fromPrefs = Number(
    prefs.party_size != null ? prefs.party_size : prefs.partySize,
  );
  if (Number.isFinite(fromPrefs) && fromPrefs >= 1) {
    return Math.floor(fromPrefs);
  }
  return null;
}

/**
 * Normalize optional party_size from request body / tool params.
 * @param {unknown} raw
 * @returns {number|null}
 */
function normalizeOptionalPartySize(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

module.exports = {
  getEffectiveCoeEventPartySize,
  normalizeOptionalPartySize,
};

/**
 * Encore Beach Club (day) + Encore Beach Club At Night → THE1 location mapping.
 * Single Wynn Social calendar; route by venue label / event-code site id.
 */

const DEFAULT_DAY_LOCATION_ID = '6a3bbb42dbdace6b54541a99';
const DEFAULT_NIGHT_LOCATION_ID = '6a60c3cd319f57ebc37b700b';
const DEFAULT_LISTING_URL = 'https://www.wynnsocial.com/events/';

/** UrVenue site ids embedded in EVE codes (EVE{siteId}000{YYYYMMDD}). */
const ENCORE_DAY_SITE_ID = '1103';
const ENCORE_NIGHT_SITE_ID = '1163';

/**
 * @returns {{
 *   dayLocationId: string,
 *   nightLocationId: string,
 *   listingUrl: string,
 * }}
 */
function getEncoreBeachVenueConfig() {
  return {
    dayLocationId: process.env.ENCORE_DAY_LOCATION_ID || DEFAULT_DAY_LOCATION_ID,
    nightLocationId: process.env.ENCORE_NIGHT_LOCATION_ID || DEFAULT_NIGHT_LOCATION_ID,
    listingUrl: process.env.ENCORE_EVENTS_LISTING_URL || DEFAULT_LISTING_URL,
  };
}

/**
 * @param {string|null|undefined} scope
 * @returns {'daylife'|'nightlife'|'both'}
 */
function normalizeEncoreScope(scope) {
  const s = String(scope || 'both').trim().toLowerCase();
  if (s === 'daylife' || s === 'day' || s === 'nightlife' || s === 'night') {
    return s === 'day' ? 'daylife' : s === 'night' ? 'nightlife' : s;
  }
  if (s === 'both') return 'both';
  return 'both';
}

/**
 * Infer day vs night from UrVenue event code when listing venue text is missing.
 * @param {string|null|undefined} eventCode
 * @returns {'day_club'|'night_club'|null}
 */
function inferEncoreVenueTypeFromEventCode(eventCode) {
  const code = String(eventCode || '').toUpperCase();
  if (!code.startsWith('EVE')) return null;
  if (code.includes(ENCORE_NIGHT_SITE_ID)) return 'night_club';
  if (code.includes(ENCORE_DAY_SITE_ID)) return 'day_club';
  return null;
}

/**
 * Resolve THE1 location from listing row (venue text + event code). Never from UI scope alone.
 * @param {{ venueName?: string, venueType?: string, eventCode?: string, eventId?: string }} row
 * @returns {{ locationId: string, type: string, venueName: string, category: string, venueType: string }}
 */
function resolveEncoreVenue(row) {
  const cfg = getEncoreBeachVenueConfig();
  const venueText = String(row?.venueName || '').trim();
  const fromCode = inferEncoreVenueTypeFromEventCode(row?.eventCode || row?.eventId);
  const isNight =
    /encore\s*beach\s*club\s*at\s*night/i.test(venueText) ||
    row?.venueType === 'night_club' ||
    fromCode === 'night_club';
  const isDay =
    (!isNight && /^encore\s*beach\s*club$/i.test(venueText)) ||
    row?.venueType === 'day_club' ||
    fromCode === 'day_club';

  if (isNight || (!isDay && fromCode === 'night_club')) {
    return {
      locationId: cfg.nightLocationId,
      type: 'night_club',
      venueName: 'Encore Beach Club At Night',
      category: 'Nightlife',
      venueType: 'night_club',
    };
  }

  return {
    locationId: cfg.dayLocationId,
    type: 'day_club',
    venueName: 'Encore Beach Club',
    category: 'Daylife',
    venueType: 'day_club',
  };
}

/**
 * @param {string} venueName
 * @returns {boolean}
 */
function isEncoreListingVenue(venueName) {
  const v = String(venueName || '').trim();
  if (/wynn\s*field\s*club/i.test(v)) return false;
  if (/\bxs\b/i.test(v) && /night/i.test(v)) return false;
  return /encore\s*beach\s*club/i.test(v);
}

module.exports = {
  getEncoreBeachVenueConfig,
  normalizeEncoreScope,
  inferEncoreVenueTypeFromEventCode,
  resolveEncoreVenue,
  isEncoreListingVenue,
  DEFAULT_DAY_LOCATION_ID,
  DEFAULT_NIGHT_LOCATION_ID,
  DEFAULT_LISTING_URL,
  ENCORE_DAY_SITE_ID,
  ENCORE_NIGHT_SITE_ID,
};

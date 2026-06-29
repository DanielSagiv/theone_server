/**
 * OMNIA Night Club + Omnia DayClub (Booketing / UrVenue) → THE1 location mapping.
 */

const DEFAULT_NIGHT_LOCATION_ID = '6a26ff4254364f05884f74ce';
const DEFAULT_NIGHT_LISTING_URL =
  'https://booketing.com/microsite/house/events/61/1089/omnia';

const DEFAULT_DAY_LOCATION_ID = '6a35172263c07e4f7521d24b';
const DEFAULT_DAY_LISTING_URL =
  'https://booketing.com/microsite/house/events/61/40911541686/omnia-dayclub';

/**
 * @returns {{ locationId: string, listingUrl: string, venueName: string, type: string, category: string }}
 */
function getOmniaNightConfig() {
  return {
    locationId: process.env.OMNIA_LOCATION_ID || DEFAULT_NIGHT_LOCATION_ID,
    listingUrl: process.env.OMNIA_EVENTS_LISTING_URL || DEFAULT_NIGHT_LISTING_URL,
    venueName: 'OMNIA',
    type: 'night_club',
    category: 'Nightlife',
  };
}

/**
 * @returns {{ locationId: string, listingUrl: string, venueName: string, type: string, category: string }}
 */
function getOmniaDayConfig() {
  return {
    locationId: process.env.OMNIA_DAY_LOCATION_ID || DEFAULT_DAY_LOCATION_ID,
    listingUrl: process.env.OMNIA_DAY_EVENTS_LISTING_URL || DEFAULT_DAY_LISTING_URL,
    venueName: 'Omnia DayClub',
    type: 'day_club',
    category: 'Daylife',
  };
}

/** @deprecated Use getOmniaNightConfig */
function getOmniaVenueConfig() {
  return getOmniaNightConfig();
}

/** Booketing microsite id embedded in EVE codes (day vs night calendars). */
const OMNIA_DAY_BOOKETING_SITE_ID = '40911541686';
const OMNIA_NIGHT_BOOKETING_SITE_ID = '1089';

/**
 * Infer night vs dayclub from Booketing event code (most reliable routing signal).
 * @param {string|null|undefined} eventCode
 * @returns {'night_club'|'day_club'|null}
 */
function inferOmniaVenueTypeFromEventCode(eventCode) {
  const code = String(eventCode || '').toUpperCase();
  if (!code.startsWith('EVE')) return null;
  if (code.includes(OMNIA_DAY_BOOKETING_SITE_ID)) return 'day_club';
  if (code.includes(OMNIA_NIGHT_BOOKETING_SITE_ID)) return 'night_club';
  return null;
}

/**
 * Normalize listing scope query param.
 * @param {string|null|undefined} scope
 * @returns {'nightlife'|'daylife'|'both'}
 */
function normalizeOmniaScope(scope) {
  const s = String(scope || 'nightlife').trim().toLowerCase();
  if (s === 'daylife' || s === 'both') return s;
  return 'nightlife';
}

/**
 * Resolve THE1 location from an OMNIA listing row (category-driven, like LIV).
 * @param {object|null|undefined} listingEvent
 * @returns {{ locationId: string, listingUrl: string, venueName: string, type: string, category: string, venueType: 'night_club'|'day_club' }}
 */
function resolveOmniaVenue(listingEvent) {
  const fromEventCode = inferOmniaVenueTypeFromEventCode(listingEvent?.eventCode);
  const category = String(listingEvent?.category || '').trim();
  const venueType = listingEvent?.venueType || listingEvent?.type;
  const isDay =
    fromEventCode === 'day_club' ||
    venueType === 'day_club' ||
    /daylife/i.test(category) ||
    /omnia\s*day/i.test(String(listingEvent?.venueName || ''));

  if (isDay) {
    const cfg = getOmniaDayConfig();
    return { ...cfg, venueType: 'day_club' };
  }

  const cfg = getOmniaNightConfig();
  return { ...cfg, venueType: 'night_club' };
}

/**
 * Configs to scrape for a given scope.
 * @param {'nightlife'|'daylife'|'both'} scope
 * @returns {Array<{ locationId: string, listingUrl: string, venueName: string, type: string, category: string, venueType: 'night_club'|'day_club' }>}
 */
function getOmniaConfigsForScope(scope) {
  const normalized = normalizeOmniaScope(scope);
  if (normalized === 'both') {
    return [
      { ...getOmniaNightConfig(), venueType: 'night_club' },
      { ...getOmniaDayConfig(), venueType: 'day_club' },
    ];
  }
  if (normalized === 'daylife') {
    return [{ ...getOmniaDayConfig(), venueType: 'day_club' }];
  }
  return [{ ...getOmniaNightConfig(), venueType: 'night_club' }];
}

module.exports = {
  getOmniaVenueConfig,
  getOmniaNightConfig,
  getOmniaDayConfig,
  inferOmniaVenueTypeFromEventCode,
  normalizeOmniaScope,
  resolveOmniaVenue,
  getOmniaConfigsForScope,
  DEFAULT_LOCATION_ID: DEFAULT_NIGHT_LOCATION_ID,
  DEFAULT_LISTING_URL: DEFAULT_NIGHT_LISTING_URL,
  DEFAULT_DAY_LOCATION_ID,
  DEFAULT_DAY_LISTING_URL,
};

/**
 * Hakkasan Las Vegas (Booketing / UrVenue) → THE1 location mapping.
 */

const DEFAULT_LOCATION_ID = '6a3bd15f2c7e0f72e498b8a1';
const DEFAULT_LISTING_URL =
  'https://booketing.com/microsite/house/events/61/1085/hakkasan-las-vegas';

/** Booketing microsite id embedded in Hakkasan EVE codes. */
const HAKKASAN_BOOKETING_SITE_ID = '1085';

/**
 * @returns {{ locationId: string, listingUrl: string, venueName: string, type: string, category: string }}
 */
function getHakkasanVenueConfig() {
  return {
    locationId: process.env.HAKKASAN_LOCATION_ID || DEFAULT_LOCATION_ID,
    listingUrl: process.env.HAKKASAN_EVENTS_LISTING_URL || DEFAULT_LISTING_URL,
    venueName: 'Hakkasan Las Vegas',
    type: 'night_club',
    category: 'Nightlife',
  };
}

/**
 * Whether an EVE code belongs to Hakkasan Booketing calendar.
 * @param {string|null|undefined} eventCode
 * @returns {boolean}
 */
function inferHakkasanFromEventCode(eventCode) {
  const code = String(eventCode || '').toUpperCase();
  return code.startsWith('EVE') && code.includes(HAKKASAN_BOOKETING_SITE_ID);
}

module.exports = {
  getHakkasanVenueConfig,
  inferHakkasanFromEventCode,
  DEFAULT_LOCATION_ID,
  DEFAULT_LISTING_URL,
  HAKKASAN_BOOKETING_SITE_ID,
};

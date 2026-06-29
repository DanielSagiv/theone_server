/**
 * TAO Beach (Booketing / UrVenue) → THE1 location mapping.
 */

const DEFAULT_LOCATION_ID = '6a3aba3c092d0d12566c49a1';
const DEFAULT_LISTING_URL =
  'https://booketing.com/microsite/house/events/61/1113/tao-beach';

/** Booketing microsite id embedded in TAO Beach EVE codes. */
const TAO_BEACH_BOOKETING_SITE_ID = '1113';

/**
 * @returns {{ locationId: string, listingUrl: string, venueName: string, type: string, category: string }}
 */
function getTaoBeachVenueConfig() {
  return {
    locationId: process.env.TAO_BEACH_LOCATION_ID || DEFAULT_LOCATION_ID,
    listingUrl: process.env.TAO_BEACH_EVENTS_LISTING_URL || DEFAULT_LISTING_URL,
    venueName: 'TAO Beach',
    type: 'day_club',
    category: 'Daylife',
  };
}

/**
 * Whether an EVE code belongs to TAO Beach Booketing calendar.
 * @param {string|null|undefined} eventCode
 * @returns {boolean}
 */
function inferTaoBeachFromEventCode(eventCode) {
  const code = String(eventCode || '').toUpperCase();
  return code.startsWith('EVE') && code.includes(TAO_BEACH_BOOKETING_SITE_ID);
}

module.exports = {
  getTaoBeachVenueConfig,
  inferTaoBeachFromEventCode,
  DEFAULT_LOCATION_ID,
  DEFAULT_LISTING_URL,
  TAO_BEACH_BOOKETING_SITE_ID,
};

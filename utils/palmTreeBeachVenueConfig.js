/**
 * Palm Tree Beach (Booketing / UrVenue) → THE1 location mapping.
 */

const DEFAULT_LOCATION_ID = '6a3aca44bdbdad91c9fd0ee5';
const DEFAULT_LISTING_URL =
  'https://booketing.com/microsite/house/events/61/1117/palm-tree-beach-club';

/** Booketing microsite id embedded in Palm Tree Beach EVE codes. */
const PALM_TREE_BEACH_BOOKETING_SITE_ID = '1117';

/**
 * @returns {{ locationId: string, listingUrl: string, venueName: string, type: string, category: string }}
 */
function getPalmTreeBeachVenueConfig() {
  return {
    locationId: process.env.PALM_TREE_BEACH_LOCATION_ID || DEFAULT_LOCATION_ID,
    listingUrl: process.env.PALM_TREE_BEACH_EVENTS_LISTING_URL || DEFAULT_LISTING_URL,
    venueName: 'Palm Tree Beach',
    type: 'day_club',
    category: 'Daylife',
  };
}

/**
 * Whether an EVE code belongs to Palm Tree Beach Booketing calendar.
 * @param {string|null|undefined} eventCode
 * @returns {boolean}
 */
function inferPalmTreeBeachFromEventCode(eventCode) {
  const code = String(eventCode || '').toUpperCase();
  return code.startsWith('EVE') && code.includes(PALM_TREE_BEACH_BOOKETING_SITE_ID);
}

module.exports = {
  getPalmTreeBeachVenueConfig,
  inferPalmTreeBeachFromEventCode,
  DEFAULT_LOCATION_ID,
  DEFAULT_LISTING_URL,
  PALM_TREE_BEACH_BOOKETING_SITE_ID,
};

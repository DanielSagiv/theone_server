/**
 * Marquee Dayclub (Booketing / UrVenue) → THE1 location mapping.
 */

const DEFAULT_LOCATION_ID = '6a3ae2f9b7e4c059eb79880e';
const DEFAULT_LISTING_URL =
  'https://booketing.com/microsite/house/events/61/1109/marquee-dayclub';

/** Booketing microsite id embedded in Marquee Dayclub EVE codes. */
const MARQUEE_DAYCLUB_BOOKETING_SITE_ID = '1109';

/**
 * @returns {{ locationId: string, listingUrl: string, venueName: string, type: string, category: string }}
 */
function getMarqueeDayclubVenueConfig() {
  return {
    locationId: process.env.MARQUEE_DAYCLUB_LOCATION_ID || DEFAULT_LOCATION_ID,
    listingUrl: process.env.MARQUEE_DAYCLUB_EVENTS_LISTING_URL || DEFAULT_LISTING_URL,
    venueName: 'Marquee Dayclub',
    type: 'day_club',
    category: 'Daylife',
  };
}

/**
 * Whether an EVE code belongs to Marquee Dayclub Booketing calendar.
 * @param {string|null|undefined} eventCode
 * @returns {boolean}
 */
function inferMarqueeDayclubFromEventCode(eventCode) {
  const code = String(eventCode || '').toUpperCase();
  return code.startsWith('EVE') && code.includes(MARQUEE_DAYCLUB_BOOKETING_SITE_ID);
}

module.exports = {
  getMarqueeDayclubVenueConfig,
  inferMarqueeDayclubFromEventCode,
  DEFAULT_LOCATION_ID,
  DEFAULT_LISTING_URL,
  MARQUEE_DAYCLUB_BOOKETING_SITE_ID,
};

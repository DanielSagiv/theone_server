/**
 * Marquee Nightclub (Tao Group / taogroup.com) → THE1 location mapping.
 */

const DEFAULT_LOCATION_ID = '6a3bc1894bf82ca19711bbbd';
const DEFAULT_LISTING_URL =
  'https://taogroup.com/venues/marquee-nightclub-las-vegas/events/';

/**
 * @returns {{ locationId: string, listingUrl: string, venueName: string, type: string, category: string }}
 */
function getMarqueeNightclubVenueConfig() {
  return {
    locationId: process.env.MARQUEE_NIGHTCLUB_LOCATION_ID || DEFAULT_LOCATION_ID,
    listingUrl: process.env.MARQUEE_NIGHTCLUB_EVENTS_LISTING_URL || DEFAULT_LISTING_URL,
    venueName: 'Marquee Nightclub',
    type: 'night_club',
    category: 'Nightlife',
  };
}

module.exports = {
  getMarqueeNightclubVenueConfig,
  DEFAULT_LOCATION_ID,
  DEFAULT_LISTING_URL,
};

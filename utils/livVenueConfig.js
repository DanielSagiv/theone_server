/**
 * LIV Las Vegas venue → THE1 location mapping (env-driven for stage/prod).
 */

const DEFAULT_NIGHT_LOCATION_ID = '69d947ac8ae9a8c036318759';
const DEFAULT_BEACH_LOCATION_ID = '69d9143e8ae9a8c036317fb7';

/**
 * @returns {{ nightLocationId: string, beachLocationId: string, venueLocationMap: object[] }}
 */
function getLivVenueConfig() {
  const nightLocationId = process.env.LIV_NIGHT_LOCATION_ID || DEFAULT_NIGHT_LOCATION_ID;
  const beachLocationId = process.env.LIV_BEACH_LOCATION_ID || DEFAULT_BEACH_LOCATION_ID;

  const venueLocationMap = [
    {
      venueMatch: /liv\s*las\s*vegas|liv\s*nightclub/i,
      categoryMatch: /nightlife/i,
      locationId: nightLocationId,
      type: 'night_club',
    },
    {
      venueMatch: /liv\s*beach/i,
      categoryMatch: /daylife/i,
      locationId: beachLocationId,
      type: 'day_club',
    },
  ];

  return { nightLocationId, beachLocationId, venueLocationMap };
}

/**
 * Normalize listing scope query param.
 * @param {string|null|undefined} scope
 * @returns {'nightlife'|'daylife'|'both'}
 */
function normalizeLivScope(scope) {
  const s = String(scope || 'nightlife').trim().toLowerCase();
  if (s === 'daylife' || s === 'both') return s;
  return 'nightlife';
}

module.exports = {
  getLivVenueConfig,
  normalizeLivScope,
  DEFAULT_NIGHT_LOCATION_ID,
  DEFAULT_BEACH_LOCATION_ID,
};

/**
 * Remap scraped inventory seatCode to match a target location's seat codes (local vs stage/prod naming).
 */
const {
  LIV_BEACH_LEGACY_SHORT_CODES,
} = require('./livLasVegasEventDetailScraperService');

/**
 * @param {string} name
 * @returns {string}
 */
function displayNameToCategorySlug(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * @param {string} seatCode
 * @param {string} [venueKey]
 * @returns {{ code: string, the1Category: string|null }|null}
 */
function resolveLegacySeatAlias(seatCode, venueKey) {
  if (venueKey !== 'liv') return null;
  const raw = LIV_BEACH_LEGACY_SHORT_CODES[seatCode];
  if (!raw) return null;
  if (typeof raw === 'string') return { code: raw, the1Category: null };
  return { code: raw.code, the1Category: raw.the1Category || null };
}

/**
 * Find a location seat that corresponds to a scraped inventory item.
 * @param {object} item
 * @param {object[]} locationSeats
 * @param {{ venueKey?: string }} [options]
 * @returns {object|null}
 */
function findLocationSeatForInventoryItem(item, locationSeats, options = {}) {
  const seats = locationSeats || [];
  const code = item?.seatCode ? String(item.seatCode).trim() : '';
  if (!code) return null;

  const exact = seats.find((s) => s.code === code);
  if (exact) return exact;

  const lower = code.toLowerCase();
  const ci = seats.find((s) => String(s.code || '').toLowerCase() === lower);
  if (ci) return ci;

  const byLabel = seats.find((s) => String(s.label || '').trim().toLowerCase() === lower);
  if (byLabel) return byLabel;

  const slug = displayNameToCategorySlug(code);
  if (slug) {
    const byCat = seats.find(
      (s) => s.category === slug || s.the1Category === slug
    );
    if (byCat) return byCat;
  }

  if (item.the1Category) {
    const byItemCat = seats.find(
      (s) => s.category === item.the1Category || s.the1Category === item.the1Category
    );
    if (byItemCat) return byItemCat;
  }

  const legacy = resolveLegacySeatAlias(code, options.venueKey);
  if (legacy) {
    const byLegacy = seats.find((s) => {
      if (s.code !== legacy.code) return false;
      if (legacy.the1Category) {
        return s.category === legacy.the1Category || s.the1Category === legacy.the1Category;
      }
      return true;
    });
    if (byLegacy) return byLegacy;
    return seats.find((s) => s.code === legacy.code) || null;
  }

  return null;
}

/**
 * Rewrite inventory seatCode/the1Category to match target location seats before pricing apply.
 * @param {object[]} inventoryItems
 * @param {object[]} locationSeats
 * @param {{ venueKey?: string }} [options]
 * @returns {object[]}
 */
function remapInventoryItemsForLocationSeats(inventoryItems, locationSeats, options = {}) {
  return (inventoryItems || []).map((item) => {
    if (!item?.seatCode) return item;
    const seat = findLocationSeatForInventoryItem(item, locationSeats, options);
    if (!seat) return item;
    if (seat.code === item.seatCode && !item.the1Category) return item;
    return {
      ...item,
      seatCode: seat.code,
      the1Category: item.the1Category || seat.category || seat.the1Category || null,
    };
  });
}

module.exports = {
  displayNameToCategorySlug,
  resolveLegacySeatAlias,
  findLocationSeatForInventoryItem,
  remapInventoryItemsForLocationSeats,
};

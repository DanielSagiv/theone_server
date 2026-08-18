const mongoose = require('mongoose');
const COE = require('../../models/COE');
const { venueCatalogMinSpendFromInventoryItem } = require('./urvenueInventoryDom');

/**
 * Parse YYYYMMDD from UrVenue / Booketing event code (e.g. EVE108900020260718).
 * @param {string} eventCode
 * @returns {string|null} ISO date YYYY-MM-DD
 */
function parseIsoDateFromUrvenueEventCode(eventCode) {
  if (!eventCode || typeof eventCode !== 'string') return null;
  const match = eventCode.match(/(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return `${y}-${m}-${d}`;
}

/**
 * Parse and validate YYYY-MM-DD date query param.
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
function parseScrapDateQueryParam(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return s;
}

/**
 * Validate optional fromDate/toDate query pair.
 * @param {string|null|undefined} fromDate
 * @param {string|null|undefined} toDate
 * @param {string} invalidCode - error.code when validation fails
 * @returns {{ active: boolean, fromDate: string|null, toDate: string|null }}
 */
function validateScrapDateRangeQuery(fromDate, toDate, invalidCode = 'SCRAP_INVALID_DATE_RANGE') {
  const hasFrom = fromDate != null && String(fromDate).trim() !== '';
  const hasTo = toDate != null && String(toDate).trim() !== '';

  if (!hasFrom && !hasTo) {
    return { active: false, fromDate: null, toDate: null };
  }

  if (hasFrom !== hasTo) {
    const err = new Error('Both fromDate and toDate are required for date range filtering');
    err.code = invalidCode;
    throw err;
  }

  const from = parseScrapDateQueryParam(fromDate);
  const to = parseScrapDateQueryParam(toDate);
  if (!from || !to) {
    const err = new Error('fromDate and toDate must be valid YYYY-MM-DD dates');
    err.code = invalidCode;
    throw err;
  }
  if (from > to) {
    const err = new Error('fromDate must be on or before toDate');
    err.code = invalidCode;
    throw err;
  }

  return { active: true, fromDate: from, toDate: to };
}

/**
 * Filter listing rows by isoDate inclusive range.
 * @param {object[]} events
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @returns {object[]}
 */
function filterScrapEventsByDateRange(events, fromDate, toDate) {
  const rows = Array.isArray(events) ? events : [];
  if (!fromDate || !toDate) return rows;
  return rows.filter((row) => {
    const d = row.isoDate;
    if (!d) return false;
    return d >= fromDate && d <= toDate;
  });
}

/**
 * Find COEs that reference any of the given THE1 event IDs.
 * @param {string[]} eventIds
 * @returns {Promise<Map<string, { coeId: string, coeName: string, status: string }>>}
 */
async function findCoesReferencingEventIds(eventIds) {
  const ids = [...new Set((eventIds || []).filter(Boolean))];
  const result = new Map();
  if (ids.length === 0) return result;

  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (objectIds.length === 0) return result;

  const coes = await COE.find({
    $or: [
      { 'events.event_id': { $in: objectIds } },
      { 'selected_seats.event_id': { $in: objectIds } },
      { 'pricing_breakdown.events.event_id': { $in: objectIds } },
      { 'seat_upgrade_offers.event_id': { $in: objectIds } },
    ],
  })
    .select(
      '_id name status events.event_id selected_seats.event_id pricing_breakdown.events.event_id seat_upgrade_offers.event_id'
    )
    .lean();

  coes.forEach((coe) => {
    const coeInfo = {
      coeId: String(coe._id),
      coeName: coe.name || 'COE',
      status: coe.status || 'unknown',
    };
    const referenced = new Set();
    (coe.events || []).forEach((e) => {
      if (e?.event_id) referenced.add(String(e.event_id));
    });
    (coe.selected_seats || []).forEach((s) => {
      if (s?.event_id) referenced.add(String(s.event_id));
    });
    (coe.pricing_breakdown?.events || []).forEach((e) => {
      if (e?.event_id) referenced.add(String(e.event_id));
    });
    (coe.seat_upgrade_offers || []).forEach((o) => {
      if (o?.event_id) referenced.add(String(o.event_id));
    });
    referenced.forEach((eventId) => {
      if (!result.has(eventId)) {
        result.set(eventId, coeInfo);
      }
    });
  });

  return result;
}

/**
 * Match scraped inventory item to an inherited location seat.
 * @param {object} seat
 * @param {object} item
 * @returns {boolean}
 */
function inventoryItemMatchesSeat(seat, item) {
  if (!item?.seatCode || item.seatCode !== seat.code) return false;
  if (item.the1Category) {
    return seat.the1Category === item.the1Category || seat.category === item.the1Category;
  }
  return true;
}

/**
 * Apply scraped inventory min spends onto inherited event seats.
 * @param {object[]} seats
 * @param {object[]} inventoryItems
 * @param {string} [priceChangeReason]
 * @returns {{ seats: object[], warnings: string[] }}
 */
function applyInventoryToSeats(seats, inventoryItems, priceChangeReason = 'scrap import') {
  const warnings = [];
  const usedItems = new Set();

  const updated = (seats || []).map((seat) => {
    const itemIndex = (inventoryItems || []).findIndex(
      (item, idx) => !usedItems.has(idx) && inventoryItemMatchesSeat(seat, item)
    );
    if (itemIndex < 0) {
      return seat;
    }
    const scraped = inventoryItems[itemIndex];
    usedItems.add(itemIndex);
    const venueCatalog = venueCatalogMinSpendFromInventoryItem(scraped);
    if (venueCatalog == null) {
      return seat;
    }
    return {
      ...seat,
      event_min_spend: venueCatalog,
      event_price: venueCatalog,
      price_change_reason: priceChangeReason,
    };
  });

  const scrapedCodes = new Set(
    (inventoryItems || []).filter((i) => i.seatCode).map((i) => i.seatCode)
  );
  const seatCodes = new Set((seats || []).map((s) => s.code));
  scrapedCodes.forEach((code) => {
    if (!seatCodes.has(code)) {
      warnings.push(`Scraped table mapped to "${code}" but no matching location seat`);
    }
  });
  seatCodes.forEach((code) => {
    const hasScraped = (inventoryItems || []).some((i) => i.seatCode === code);
    if (!hasScraped) {
      warnings.push(`Location seat "${code}" had no scraped inventory on detail page`);
    }
  });

  return { seats: updated, warnings };
}

/**
 * Fail fast when scraped inventory exists but no seat received catalog pricing.
 * @param {object[]} seats
 * @param {object[]} inventoryItems
 * @param {string} priceChangeReason
 * @param {string} [errorCode]
 */
function assertScrapInventoryPricingApplied(
  seats,
  inventoryItems,
  priceChangeReason,
  errorCode = 'SCRAP_PRICING_NOT_APPLIED'
) {
  const pricedItems = (inventoryItems || []).filter(
    (item) => venueCatalogMinSpendFromInventoryItem(item) != null
  );
  if (pricedItems.length === 0) return;

  const appliedCount = (seats || []).filter(
    (seat) => seat.price_change_reason === priceChangeReason
  ).length;
  if (appliedCount === 0) {
    const err = new Error(
      `Scraped ${pricedItems.length} TABLES tier(s) but none matched location seats — check venueType and seat map`
    );
    err.code = errorCode;
    throw err;
  }
}

/**
 * Attach canRemove / removeBlockedReason for already-imported scrap rows.
 * @param {object[]} importedRows
 * @returns {Promise<object[]>}
 */
async function attachScrapRemoveEligibility(importedRows) {
  const rows = Array.isArray(importedRows) ? importedRows : [];
  if (rows.length === 0) return rows;

  const eventIds = rows.map((r) => r.the1EventId).filter(Boolean);
  const coeByEventId = await findCoesReferencingEventIds(eventIds);

  return rows.map((row) => {
    const coeUse = coeByEventId.get(row.the1EventId);
    if (coeUse) {
      return {
        ...row,
        canRemove: false,
        removeBlockedReason: `Used in COE "${coeUse.coeName}" (${coeUse.status})`,
      };
    }
    return {
      ...row,
      canRemove: true,
      removeBlockedReason: null,
    };
  });
}

/**
 * Return YYYY-MM for current and next calendar month (server local time).
 * @param {Date} [refDate]
 * @returns {{ currentYm: string, nextYm: string }}
 */
function getCurrentAndNextCalendarMonths(refDate = new Date()) {
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  const currentYm = `${y}-${String(m + 1).padStart(2, '0')}`;
  const nextRef = new Date(y, m + 1, 1);
  const nextYm = `${nextRef.getFullYear()}-${String(nextRef.getMonth() + 1).padStart(2, '0')}`;
  return { currentYm, nextYm };
}

/**
 * Whether isoDate YYYY-MM-DD falls in either of two YYYY-MM months.
 * @param {string|null} isoDate
 * @param {string} ym1 - YYYY-MM
 * @param {string} ym2 - YYYY-MM
 * @returns {boolean}
 */
function isoDateInCalendarMonths(isoDate, ym1, ym2) {
  if (!isoDate || isoDate.length < 7) return false;
  const ym = isoDate.slice(0, 7);
  return ym === ym1 || ym === ym2;
}

/** Default venue calendar for scrap import (Las Vegas listings). */
const SCRAP_LISTING_DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Today as YYYY-MM-DD in a venue timezone (for upcoming-only import filter).
 * @param {Date} [refDate]
 * @param {string} [timezone]
 * @returns {string}
 */
function getScrapListingTodayIso(refDate = new Date(), timezone = SCRAP_LISTING_DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(refDate);
}

/**
 * Whether a listing row's isoDate is strictly before today (venue calendar).
 * @param {string|null|undefined} isoDate
 * @param {string} [todayIso]
 * @returns {boolean}
 */
function isScrapEventInPast(isoDate, todayIso = getScrapListingTodayIso()) {
  if (!isoDate || typeof isoDate !== 'string') return true;
  return isoDate < todayIso;
}

/**
 * Keep listing rows on or after today (venue calendar). Rows without isoDate are excluded.
 * @param {object[]} events
 * @param {string} [todayIso]
 * @returns {object[]}
 */
function filterScrapEventsNotInPast(events, todayIso = getScrapListingTodayIso()) {
  const rows = Array.isArray(events) ? events : [];
  return rows.filter((row) => {
    const d = row?.isoDate;
    return typeof d === 'string' && d.length >= 10 && d >= todayIso;
  });
}

/**
 * Reject prepare-import when listing event date is in the past.
 * @param {object} listingEvent
 * @param {string} errorCode
 * @throws {Error}
 */
function assertScrapListingEventNotInPast(listingEvent, errorCode = 'SCRAP_EVENT_IN_PAST') {
  const isoDate = listingEvent?.isoDate;
  const todayIso = getScrapListingTodayIso();
  if (isScrapEventInPast(isoDate, todayIso)) {
    const label = isoDate || 'unknown date';
    const err = new Error(
      `Past events cannot be imported (event date ${label} is before ${todayIso})`
    );
    err.code = errorCode;
    throw err;
  }
}

/** Scrap-event imports omit venue-site description (often Booketing/Tao boilerplate). */
const SCRAP_IMPORT_EVENT_DESCRIPTION = '';

/**
 * Whether scrap import uses the 4-step Create Event wizard (draft). Default: auto-create active.
 * @returns {boolean}
 */
function isScrapEventsImportWizardEnabled() {
  return process.env.SCRAP_EVENTS_IMPORT_WIZARD === 'true';
}

/**
 * Event status for scrap-import prefill: draft when wizard enabled, active otherwise.
 * @returns {'draft'|'active'}
 */
function getScrapImportEventStatus() {
  return isScrapEventsImportWizardEnabled() ? 'draft' : 'active';
}

/**
 * Strip targetPlatform from prepare-import body. Stage/Prod skip local duplicate check.
 * @param {object} body
 * @returns {{ listingEvent: object, skipLocalAlreadyImported: boolean, targetPlatform: string }}
 */
function parseScrapPrepareImportOptions(body) {
  const raw = body && typeof body === 'object' ? { ...body } : {};
  const targetPlatform = String(raw.targetPlatform || '').trim().toLowerCase();
  delete raw.targetPlatform;
  const skipLocalAlreadyImported = targetPlatform === 'stage' || targetPlatform === 'prod';
  return { listingEvent: raw, skipLocalAlreadyImported, targetPlatform };
}

module.exports = {
  parseIsoDateFromUrvenueEventCode,
  parseScrapDateQueryParam,
  validateScrapDateRangeQuery,
  filterScrapEventsByDateRange,
  findCoesReferencingEventIds,
  inventoryItemMatchesSeat,
  applyInventoryToSeats,
  assertScrapInventoryPricingApplied,
  attachScrapRemoveEligibility,
  getCurrentAndNextCalendarMonths,
  isoDateInCalendarMonths,
  venueCatalogMinSpendFromInventoryItem,
  SCRAP_LISTING_DEFAULT_TIMEZONE,
  getScrapListingTodayIso,
  isScrapEventInPast,
  filterScrapEventsNotInPast,
  assertScrapListingEventNotInPast,
  SCRAP_IMPORT_EVENT_DESCRIPTION,
  isScrapEventsImportWizardEnabled,
  getScrapImportEventStatus,
  parseScrapPrepareImportOptions,
};

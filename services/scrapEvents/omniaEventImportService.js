const Event = require('../../models/Event');
const Location = require('../../models/Location');
const { inheritSeatsFromLocation } = require('../locationEventService');
const { fetchOmniaEventDetailInventory, normalizeTableName, resolveOmniaSeatMapping } = require('./omniaEventDetailScraperService');
const { resolveVenueTimezone, wallClockInVenueTzToUtcDate } = require('../../utils/venueTimezone');
const { resolveOmniaVenue, normalizeOmniaScope, inferOmniaVenueTypeFromEventCode } = require('../../utils/omniaVenueConfig');
const {
  parseScrapDateQueryParam,
  validateScrapDateRangeQuery,
  filterScrapEventsByDateRange,
  findCoesReferencingEventIds,
  applyInventoryToSeats,
  assertScrapInventoryPricingApplied,
  attachScrapRemoveEligibility,
  filterScrapEventsNotInPast,
  assertScrapListingEventNotInPast,
  SCRAP_IMPORT_EVENT_DESCRIPTION,
  getScrapImportEventStatus,
} = require('./scrapEventsShared');

const LOG_PREFIX = '[OMNIA import]';

/**
 * Parse Booketing start time like "10:30pm" to 24h HH:mm.
 * @param {string} timeStr
 * @returns {string|null}
 */
function parseOmniaStartTimeTo24h(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const m = timeStr.trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = (m[3] || '').toLowerCase();
  if (ampm === 'pm' && hh < 12) hh += 12;
  if (ampm === 'am' && hh === 12) hh = 0;
  return `${String(hh).padStart(2, '0')}:${mm}`;
}

/**
 * Build datetime-local string from iso date and time display.
 * @param {string} isoDate
 * @param {string} startTime
 * @param {'night_club'|'day_club'} [venueType]
 * @returns {string|null}
 */
function buildStartDatetimeLocal(isoDate, startTime, venueType = 'night_club') {
  if (!isoDate) return null;
  const defaultTime = venueType === 'day_club' ? '11:00' : '22:00';
  const time24 = parseOmniaStartTimeTo24h(startTime) || defaultTime;
  return `${isoDate}T${time24}`;
}

/**
 * Whether a listing row is importable for OMNIA.
 * @param {object} listingEvent
 * @returns {boolean}
 */
function isOmniaImportableRow(listingEvent) {
  return Boolean(listingEvent && listingEvent.eventCode && !listingEvent.isCustomPromo);
}

/**
 * Whether row matches listing scope (night / day / both).
 * @param {object} listingEvent
 * @param {string} [scope]
 * @returns {boolean}
 */
function isOmniaImportableRowForScope(listingEvent, scope) {
  if (!isOmniaImportableRow(listingEvent)) return false;
  const s = normalizeOmniaScope(scope);
  const isDay =
    listingEvent.venueType === 'day_club' ||
    listingEvent.type === 'day_club' ||
    /daylife/i.test(String(listingEvent.category || ''));
  if (s === 'daylife') return isDay;
  if (s === 'nightlife') return !isDay;
  return true;
}

/** @param {string|null|undefined} value @returns {string|null} */
function parseOmniaDateQueryParam(value) {
  return parseScrapDateQueryParam(value);
}

/** @param {string|null|undefined} fromDate @param {string|null|undefined} toDate */
function validateOmniaDateRangeQuery(fromDate, toDate) {
  return validateScrapDateRangeQuery(fromDate, toDate, 'OMNIA_INVALID_DATE_RANGE');
}

/** @param {object[]} events @param {string} fromDate @param {string} toDate */
function filterOmniaEventsByDateRange(events, fromDate, toDate) {
  return filterScrapEventsByDateRange(events, fromDate, toDate);
}

/** @param {object[]} events */
function filterOmniaEventsNotInPast(events) {
  return filterScrapEventsNotInPast(events);
}

/**
 * Ensure scraped inventory rows carry seatCode for applyInventory (day/night map).
 * @param {object[]} items
 * @param {'night_club'|'day_club'} venueType
 * @returns {object[]}
 */
function enrichOmniaInventorySeatCodes(items, venueType) {
  return (items || []).map((item) => {
    if (item.seatCode) return item;
    const key = item.sectionKey || normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveOmniaSeatMapping(key, venueType);
    return { ...item, seatCode, the1Category };
  });
}

/**
 * Partition scraped listing rows by import status vs THE1 events (bulk omniaEventCode lookup).
 * @param {object[]} events
 * @param {{ scope?: string }} [options]
 * @returns {Promise<{ newEvents: object[], alreadyImported: object[], skipped: object[], stats: object }>}
 */
async function partitionOmniaEventsByImportStatus(events, options = {}) {
  const scope = normalizeOmniaScope(options.scope);
  const allRows = Array.isArray(events) ? events : [];
  const importable = [];
  const skipped = [];

  allRows.forEach((row) => {
    if (isOmniaImportableRowForScope(row, scope)) {
      importable.push(row);
    } else {
      skipped.push(row);
    }
  });

  const codes = importable.map((r) => r.eventCode).filter(Boolean);
  const existingRows =
    codes.length > 0
      ? await Event.find({ omniaEventCode: { $in: codes } }).select('omniaEventCode name').lean()
      : [];
  const existingByCode = new Map(existingRows.map((e) => [e.omniaEventCode, e]));

  const newEvents = [];
  const alreadyImported = [];

  importable.forEach((row) => {
    const existing = existingByCode.get(row.eventCode);
    if (existing) {
      alreadyImported.push({
        ...row,
        alreadyImported: true,
        the1EventId: String(existing._id),
        the1EventName: existing.name,
      });
    } else {
      newEvents.push({ ...row, alreadyImported: false });
    }
  });

  const alreadyImportedWithEligibility = await attachScrapRemoveEligibility(alreadyImported);

  const stats = {
    totalScraped: allRows.length,
    importableTotal: importable.length,
    newCount: newEvents.length,
    alreadyImportedCount: alreadyImportedWithEligibility.length,
    skippedCount: skipped.length,
  };

  return { newEvents, alreadyImported: alreadyImportedWithEligibility, skipped, stats };
}

/**
 * Prepare create-event prefill from OMNIA listing row (detail scrape + location mapping).
 * @param {object} listingEvent
 * @returns {Promise<object>}
 */
async function prepareOmniaEventImport(listingEvent) {
  const warnings = [];
  const { locationId, type, venueType } = resolveOmniaVenue(listingEvent);

  const omniaEventCode = listingEvent.eventCode;
  if (!omniaEventCode) {
    const err = new Error('Missing OMNIA event code');
    err.code = 'OMNIA_MISSING_EVENT_CODE';
    throw err;
  }

  if (!isOmniaImportableRow(listingEvent)) {
    const err = new Error('This OMNIA row cannot be imported as a bookable event');
    err.code = 'OMNIA_NOT_IMPORTABLE';
    throw err;
  }

  assertScrapListingEventNotInPast(listingEvent, 'OMNIA_EVENT_IN_PAST');

  const existing = await Event.findOne({ omniaEventCode }).select('_id name').lean();
  if (existing) {
    return {
      alreadyImported: true,
      eventId: String(existing._id),
      eventName: existing.name,
      omniaEventCode,
    };
  }

  const location = await Location.findById(locationId);
  if (!location) {
    const err = new Error(`OMNIA location not found: ${locationId}`);
    err.code = 'OMNIA_LOCATION_NOT_FOUND';
    throw err;
  }

  const detailUrl = ensureOmniaEventCodeOnDetailUrl(
    listingEvent.detailUrl || listingEvent.bookUrl,
    omniaEventCode
  );
  if (!detailUrl) {
    const err = new Error('Missing OMNIA event detail URL');
    err.code = 'OMNIA_MISSING_DETAIL_URL';
    throw err;
  }

  const detail = await fetchOmniaEventDetailInventory(detailUrl, { venueType });
  if (detail.browserError) {
    const err = new Error(`Could not scrape OMNIA detail page: ${detail.browserError}`);
    err.code = 'OMNIA_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (detail.warnings?.length) warnings.push(...detail.warnings);

  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No TABLES inventory found on OMNIA detail page');
    err.code = 'OMNIA_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichOmniaInventorySeatCodes(detail.items, venueType);

  const inheritance = await inheritSeatsFromLocation(locationId, {
    name: listingEvent.name,
    type,
  });

  const { seats, warnings: seatWarnings } = applyInventoryToSeats(
    inheritance.seats,
    inventoryItems,
    'OMNIA scrap import'
  );
  if (seatWarnings.length) warnings.push(...seatWarnings);

  assertScrapInventoryPricingApplied(
    seats,
    inventoryItems,
    'OMNIA scrap import',
    'OMNIA_PRICING_NOT_APPLIED'
  );

  const locationMediaBySeatId = new Map(
    (location.seats || []).map((seat) => [
      String(seat._id),
      (seat.media || []).map((m) => (m && typeof m.toObject === 'function' ? m.toObject() : { ...m })),
    ])
  );

  const seatsForClient = seats.map((s) => ({
    ...s,
    seat_id: s.seat_id ? String(s.seat_id) : s.seat_id,
    media: locationMediaBySeatId.get(String(s.seat_id)) || [],
  }));
  const unitsForClient = (inheritance.units || []).map((u) => ({
    ...u,
    unit_id: u.unit_id ? String(u.unit_id) : u.unit_id,
  }));

  const timezone = resolveVenueTimezone(location);
  const defaultDayTime = venueType === 'day_club' ? '11:00' : '22:00';
  const startDatetimeLocal =
    buildStartDatetimeLocal(listingEvent.isoDate, listingEvent.startTime, venueType) ||
    (listingEvent.isoDate ? `${listingEvent.isoDate}T${defaultDayTime}` : null);
  const startDatetime = startDatetimeLocal
    ? wallClockInVenueTzToUtcDate(startDatetimeLocal, timezone)
    : listingEvent.isoDate
      ? new Date(`${listingEvent.isoDate}T${defaultDayTime}:00`)
      : new Date();

  const minSpends = (inventoryItems || [])
    .map((i) => i.minSpend)
    .filter((n) => typeof n === 'number' && n > 0);
  const basePrice = minSpends.length ? Math.min(...minSpends) : 0;

  const media = listingEvent.imageUrl
    ? [{ type: 'image', url: listingEvent.imageUrl, order: 0 }]
    : [];

  const notes = [
    'Imported from OMNIA Booketing listing.',
    `omniaEventCode: ${omniaEventCode}`,
    detailUrl ? `Source: ${detailUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const prefill = {
    name: listingEvent.name || 'Event',
    description: SCRAP_IMPORT_EVENT_DESCRIPTION,
    type,
    location_id: locationId,
    start_datetime: startDatetime.toISOString(),
    start_datetime_local: startDatetimeLocal,
    timezone,
    base_price: basePrice,
    currency: 'USD',
    price_tier: 1,
    status: getScrapImportEventStatus(),
    notes,
    policies: '',
    media,
    omniaEventCode,
    seats: seatsForClient,
    units: unitsForClient,
    detailUrl,
    scrapedInventory: inventoryItems,
  };

  console.log(`${LOG_PREFIX} prepareOmniaEventImport: "${prefill.name}" -> location ${location.name}`);

  return {
    alreadyImported: false,
    prefill,
    warnings,
    omniaEventCode,
  };
}

/**
 * Undo an OMNIA import by deleting the THE1 event (when not referenced in COEs or booked).
 * @param {string} omniaEventCode
 * @returns {Promise<{ omniaEventCode: string, deletedEventId: string, message: string }>}
 */
async function undoOmniaEventImport(omniaEventCode) {
  const code = (omniaEventCode || '').trim();
  if (!code) {
    const err = new Error('Missing OMNIA event code');
    err.code = 'OMNIA_MISSING_EVENT_CODE';
    throw err;
  }

  const event = await Event.findOne({ omniaEventCode: code });
  if (!event) {
    const err = new Error(`No THE1 event found for omniaEventCode ${code}`);
    err.code = 'OMNIA_EVENT_NOT_FOUND';
    throw err;
  }

  const eventId = String(event._id);
  const coeByEventId = await findCoesReferencingEventIds([eventId]);
  if (coeByEventId.has(eventId)) {
    const coeUse = coeByEventId.get(eventId);
    const err = new Error(`Cannot remove: used in COE "${coeUse.coeName}" (${coeUse.status})`);
    err.code = 'OMNIA_EVENT_IN_COE_USE';
    throw err;
  }

  const hasBookings =
    (event.seats || []).some((seat) => seat.status === 'booked') ||
    (event.units || []).some((unit) => unit.status === 'booked');

  if (hasBookings) {
    const err = new Error('Cannot remove event with existing bookings');
    err.code = 'EVENT_HAS_BOOKINGS';
    throw err;
  }

  await Event.findByIdAndDelete(event._id);

  console.log(`${LOG_PREFIX} undoOmniaEventImport: deleted event ${eventId} (${code})`);

  return {
    omniaEventCode: code,
    deletedEventId: eventId,
    message: 'OMNIA import undone; event removed from THE1',
  };
}

/**
 * Ensure Booketing detail URL includes eventcode (required for TABLES inventory).
 * @param {string|null|undefined} detailUrl
 * @param {string|null|undefined} omniaEventCode
 * @returns {string|null}
 */
function ensureOmniaEventCodeOnDetailUrl(detailUrl, omniaEventCode) {
  const url = (detailUrl || '').trim();
  const code = (omniaEventCode || '').trim();
  if (!url) return null;
  if (!code || /[?&]eventcode=/i.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}eventcode=${encodeURIComponent(code)}`;
}

/**
 * Extract Booketing detail URL stored in event notes during OMNIA import.
 * @param {string|null|undefined} notes
 * @returns {string|null}
 */
function extractOmniaDetailUrlFromNotes(notes) {
  if (!notes) return null;
  const match = String(notes).match(/Source:\s*(https?:\/\/\S+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Resolve scrape URL for an OMNIA event (notes + eventcode fallback).
 * @param {string|null|undefined} notes
 * @param {string} omniaEventCode
 * @returns {string|null}
 */
function resolveOmniaDetailUrl(notes, omniaEventCode) {
  const fromNotes = extractOmniaDetailUrlFromNotes(notes);
  return ensureOmniaEventCodeOnDetailUrl(fromNotes, omniaEventCode);
}

/**
 * Re-scrape Booketing TABLES pricing onto an existing OMNIA-imported event.
 * Skips booked/held seats. Does not change event metadata beyond base_price.
 * @param {string} omniaEventCode
 * @returns {Promise<object>}
 */
async function resyncOmniaEventPricing(omniaEventCode) {
  const code = (omniaEventCode || '').trim();
  if (!code) {
    const err = new Error('Missing OMNIA event code');
    err.code = 'OMNIA_MISSING_EVENT_CODE';
    throw err;
  }

  const event = await Event.findOne({ omniaEventCode: code });
  if (!event) {
    const err = new Error(`No THE1 event found for omniaEventCode ${code}`);
    err.code = 'OMNIA_EVENT_NOT_FOUND';
    throw err;
  }

  const detailUrl = resolveOmniaDetailUrl(event.notes, code);
  if (!detailUrl) {
    const err = new Error('No Booketing source URL on event notes');
    err.code = 'OMNIA_MISSING_DETAIL_URL';
    throw err;
  }

  const resyncVenueType =
    inferOmniaVenueTypeFromEventCode(code) ||
    (event.type === 'day_club' ? 'day_club' : 'night_club');
  const detail = await fetchOmniaEventDetailInventory(detailUrl, { venueType: resyncVenueType });
  if (detail.browserError) {
    const err = new Error(`Could not scrape OMNIA detail page: ${detail.browserError}`);
    err.code = 'OMNIA_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No TABLES inventory found on OMNIA detail page');
    err.code = 'OMNIA_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichOmniaInventorySeatCodes(detail.items, resyncVenueType);
  const warnings = [...(detail.warnings || [])];
  const plainSeats = (event.seats || []).map((s) =>
    s && typeof s.toObject === 'function' ? s.toObject() : { ...s }
  );
  const { seats: appliedSeats, warnings: seatWarnings } = applyInventoryToSeats(
    plainSeats,
    inventoryItems,
    'OMNIA scrap import'
  );
  if (seatWarnings.length) warnings.push(...seatWarnings);

  const appliedByCode = new Map(appliedSeats.map((s) => [s.code, s]));
  let updatedSeatCount = 0;

  (event.seats || []).forEach((seat) => {
    if (seat.status === 'booked' || seat.status === 'held') return;
    const applied = appliedByCode.get(seat.code);
    if (applied?.price_change_reason === 'OMNIA scrap import') {
      seat.event_price = applied.event_price;
      seat.event_min_spend = applied.event_min_spend;
      seat.price_change_reason = applied.price_change_reason;
      updatedSeatCount += 1;
    }
  });

  const minSpends = inventoryItems
    .map((i) => i.minSpend)
    .filter((n) => typeof n === 'number' && n > 0);
  if (minSpends.length) {
    event.base_price = Math.min(...minSpends);
  }

  event.markModified('seats');
  await event.save();

  console.log(
    `${LOG_PREFIX} resyncOmniaEventPricing: "${event.name}" (${code}) updated ${updatedSeatCount} seat(s)`
  );

  return {
    omniaEventCode: code,
    eventId: String(event._id),
    eventName: event.name,
    base_price: event.base_price,
    updatedSeatCount,
    warnings,
    message: 'OMNIA venue catalog pricing refreshed from Booketing',
  };
}

module.exports = {
  prepareOmniaEventImport,
  undoOmniaEventImport,
  resyncOmniaEventPricing,
  extractOmniaDetailUrlFromNotes,
  ensureOmniaEventCodeOnDetailUrl,
  resolveOmniaDetailUrl,
  partitionOmniaEventsByImportStatus,
  isOmniaImportableRow,
  parseOmniaDateQueryParam,
  validateOmniaDateRangeQuery,
  filterOmniaEventsByDateRange,
  filterOmniaEventsNotInPast,
  findCoesReferencingEventIds,
};

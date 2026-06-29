const Event = require('../../models/Event');
const Location = require('../../models/Location');
const { inheritSeatsFromLocation } = require('../locationEventService');
const { fetchLivEventDetailInventory } = require('./livLasVegasEventDetailScraperService');
const { resolveVenueTimezone, wallClockInVenueTzToUtcDate } = require('../../utils/venueTimezone');
const { getLivVenueConfig, normalizeLivScope } = require('../../utils/livVenueConfig');
const {
  parseScrapDateQueryParam,
  validateScrapDateRangeQuery,
  filterScrapEventsByDateRange,
  findCoesReferencingEventIds,
  applyInventoryToSeats: applySharedInventoryToSeats,
  attachScrapRemoveEligibility,
  filterScrapEventsNotInPast,
  assertScrapListingEventNotInPast,
} = require('./scrapEventsShared');

const LOG_PREFIX = '[LIV import]';

/**
 * Parse LIV start time like "10:30pm" to 24h HH:mm.
 * @param {string} timeStr
 * @returns {string|null}
 */
function parseLivStartTimeTo24h(timeStr) {
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
 * Build datetime-local string from iso date and LIV time display.
 * @param {string} isoDate - YYYY-MM-DD
 * @param {string} startTime - e.g. 10:30pm
 * @returns {string|null}
 */
function buildStartDatetimeLocal(isoDate, startTime) {
  if (!isoDate) return null;
  const time24 = parseLivStartTimeTo24h(startTime) || '22:00';
  return `${isoDate}T${time24}`;
}

/**
 * Resolve THE1 location for scraped LIV listing row (venue + category only).
 * @param {object} listingEvent
 * @returns {{ locationId: string, type: string }|null}
 */
function resolveLivLocation(listingEvent) {
  const venue = (listingEvent.venueName || '').trim();
  const category = (listingEvent.category || '').trim();
  const { venueLocationMap } = getLivVenueConfig();

  for (const entry of venueLocationMap) {
    if (entry.venueMatch.test(venue) && entry.categoryMatch.test(category)) {
      return { locationId: entry.locationId, type: entry.type };
    }
  }

  return null;
}

/**
 * Whether a listing row is importable as LIV Night club (Nightlife EVE only).
 * @param {object} listingEvent
 * @returns {boolean}
 */
function isLivNightImportableRow(listingEvent) {
  if (!listingEvent || listingEvent.isCustomPromo || !listingEvent.eventCode) {
    return false;
  }
  return resolveLivLocation(listingEvent)?.type === 'night_club';
}

/**
 * Whether a listing row is importable as LIV Beach club (Daylife EVE only).
 * @param {object} listingEvent
 * @returns {boolean}
 */
function isLivBeachImportableRow(listingEvent) {
  if (!listingEvent || listingEvent.isCustomPromo || !listingEvent.eventCode) {
    return false;
  }
  return resolveLivLocation(listingEvent)?.type === 'day_club';
}

/**
 * Whether row is importable for the given listing scope.
 * @param {object} listingEvent
 * @param {string} [scope]
 * @returns {boolean}
 */
function isLivImportableRow(listingEvent, scope) {
  const s = normalizeLivScope(scope);
  if (s === 'nightlife') return isLivNightImportableRow(listingEvent);
  if (s === 'daylife') return isLivBeachImportableRow(listingEvent);
  return isLivNightImportableRow(listingEvent) || isLivBeachImportableRow(listingEvent);
}

/** @param {string|null|undefined} value @returns {string|null} */
function parseLivDateQueryParam(value) {
  return parseScrapDateQueryParam(value);
}

/** @param {string|null|undefined} fromDate @param {string|null|undefined} toDate */
function validateLivDateRangeQuery(fromDate, toDate) {
  return validateScrapDateRangeQuery(fromDate, toDate, 'LIV_INVALID_DATE_RANGE');
}

/** @param {object[]} events @param {string} fromDate @param {string} toDate */
function filterLivEventsByDateRange(events, fromDate, toDate) {
  return filterScrapEventsByDateRange(events, fromDate, toDate);
}

/** @param {object[]} events */
function filterLivEventsNotInPast(events) {
  return filterScrapEventsNotInPast(events);
}

/**
 * Attach canRemove / removeBlockedReason for already-imported LIV rows.
 * @param {object[]} importedRows
 * @returns {Promise<object[]>}
 */
async function attachLivRemoveEligibility(importedRows) {
  return attachScrapRemoveEligibility(importedRows);
}

/**
 * Partition scraped listing rows by import status vs THE1 events (bulk livEventCode lookup).
 * @param {object[]} events - preview DTOs from listing scraper
 * @param {{ scope?: string }} [options]
 * @returns {Promise<{ newEvents: object[], alreadyImported: object[], skipped: object[], stats: object }>}
 */
async function partitionLivEventsByImportStatus(events, options = {}) {
  const scope = normalizeLivScope(options.scope);
  const allRows = Array.isArray(events) ? events : [];
  const importable = [];
  const skipped = [];

  allRows.forEach((row) => {
    if (isLivImportableRow(row, scope)) {
      importable.push(row);
    } else {
      skipped.push(row);
    }
  });

  const codes = importable.map((r) => r.eventCode).filter(Boolean);
  const existingRows =
    codes.length > 0
      ? await Event.find({ livEventCode: { $in: codes } }).select('livEventCode name').lean()
      : [];
  const existingByCode = new Map(existingRows.map((e) => [e.livEventCode, e]));

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

  const alreadyImportedWithEligibility = await attachLivRemoveEligibility(alreadyImported);

  const stats = {
    totalScraped: allRows.length,
    importableTotal: importable.length,
    newCount: newEvents.length,
    alreadyImportedCount: alreadyImportedWithEligibility.length,
    skippedCount: skipped.length,
    scope,
  };

  return { newEvents, alreadyImported: alreadyImportedWithEligibility, skipped, stats };
}

/**
 * Apply scraped inventory min spends onto inherited event seats.
 * @param {object[]} seats
 * @param {object[]} inventoryItems
 * @returns {{ seats: object[], warnings: string[] }}
 */
function applyInventoryToSeats(seats, inventoryItems) {
  return applySharedInventoryToSeats(seats, inventoryItems, 'LIV scrap import');
}

/**
 * Prepare create-event prefill from LIV listing row (detail scrape + location mapping).
 * @param {object} listingEvent - preview DTO from listing scraper
 * @returns {Promise<object>}
 */
async function prepareLivEventImport(listingEvent) {
  const warnings = [];

  if (listingEvent.isCustomPromo) {
    const err = new Error('Custom promo events cannot be imported as bookable events');
    err.code = 'LIV_CUSTOM_PROMO';
    throw err;
  }

  const livEventCode = listingEvent.eventCode;
  if (!livEventCode) {
    const err = new Error('Missing LIV event code');
    err.code = 'LIV_MISSING_EVENT_CODE';
    throw err;
  }

  if (!isLivImportableRow(listingEvent, 'both')) {
    const err = new Error(
      `LIV import not supported for venue "${listingEvent.venueName}" (${listingEvent.category})`
    );
    err.code = 'LIV_NOT_IMPORTABLE';
    throw err;
  }

  assertScrapListingEventNotInPast(listingEvent, 'LIV_EVENT_IN_PAST');

  const existing = await Event.findOne({ livEventCode }).select('_id name').lean();
  if (existing) {
    return {
      alreadyImported: true,
      eventId: String(existing._id),
      eventName: existing.name,
      livEventCode,
    };
  }

  const locationRef = resolveLivLocation(listingEvent);
  if (!locationRef) {
    const err = new Error(
      `No THE1 location mapped for venue "${listingEvent.venueName}" (${listingEvent.category})`
    );
    err.code = 'LIV_LOCATION_UNMAPPED';
    throw err;
  }

  const location = await Location.findById(locationRef.locationId);
  if (!location) {
    const err = new Error(`Mapped location not found: ${locationRef.locationId}`);
    err.code = 'LIV_LOCATION_NOT_FOUND';
    throw err;
  }

  const detailUrl = listingEvent.detailUrl || listingEvent.bookUrl;
  if (!detailUrl) {
    const err = new Error('Missing LIV event detail URL');
    err.code = 'LIV_MISSING_DETAIL_URL';
    throw err;
  }

  const detail = await fetchLivEventDetailInventory(detailUrl, {
    venueType: locationRef.type,
  });
  if (detail.browserError) {
    const err = new Error(`Could not scrape LIV detail page: ${detail.browserError}`);
    err.code = 'LIV_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (detail.warnings?.length) warnings.push(...detail.warnings);

  const inheritance = await inheritSeatsFromLocation(locationRef.locationId, {
    name: listingEvent.name,
    type: locationRef.type,
  });

  const { seats, warnings: seatWarnings } = applyInventoryToSeats(
    inheritance.seats,
    detail.items
  );
  if (seatWarnings.length) warnings.push(...seatWarnings);

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
  const defaultTime = locationRef.type === 'day_club' ? '11:30' : '22:00';
  const startDatetimeLocal =
    buildStartDatetimeLocal(listingEvent.isoDate, listingEvent.startTime) ||
    (listingEvent.isoDate ? `${listingEvent.isoDate}T${defaultTime}` : null);
  const startDatetime = startDatetimeLocal
    ? wallClockInVenueTzToUtcDate(startDatetimeLocal, timezone)
    : listingEvent.isoDate
      ? new Date(`${listingEvent.isoDate}T${defaultTime}:00`)
      : new Date();

  const minSpends = (detail.items || [])
    .map((i) => i.minSpend)
    .filter((n) => typeof n === 'number' && n > 0);
  const basePrice = minSpends.length ? Math.min(...minSpends) : 0;

  const media = listingEvent.imageUrl
    ? [{ type: 'image', url: listingEvent.imageUrl, order: 0 }]
    : [];

  const notes = [
    `Imported from LIV listing.`,
    `livEventCode: ${livEventCode}`,
    detailUrl ? `Source: ${detailUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const prefill = {
    name: listingEvent.name || 'Event',
    description: detail.description || listingEvent.name || '',
    type: locationRef.type,
    location_id: locationRef.locationId,
    start_datetime: startDatetime.toISOString(),
    start_datetime_local: startDatetimeLocal,
    timezone,
    base_price: basePrice,
    currency: 'USD',
    price_tier: 1,
    status: 'draft',
    notes,
    policies: '',
    media,
    livEventCode,
    seats: seatsForClient,
    units: unitsForClient,
    detailUrl,
    scrapedInventory: detail.items,
  };

  console.log(`${LOG_PREFIX} prepareLivEventImport: "${prefill.name}" -> location ${location.name}`);

  return {
    alreadyImported: false,
    prefill,
    warnings,
    livEventCode,
  };
}

/**
 * Undo a LIV import by deleting the THE1 event (when not referenced in COEs or booked).
 * @param {string} livEventCode
 * @returns {Promise<{ livEventCode: string, deletedEventId: string, message: string }>}
 */
async function undoLivEventImport(livEventCode) {
  const code = (livEventCode || '').trim();
  if (!code) {
    const err = new Error('Missing LIV event code');
    err.code = 'LIV_MISSING_EVENT_CODE';
    throw err;
  }

  const event = await Event.findOne({ livEventCode: code });
  if (!event) {
    const err = new Error(`No THE1 event found for livEventCode ${code}`);
    err.code = 'LIV_EVENT_NOT_FOUND';
    throw err;
  }

  const eventId = String(event._id);
  const coeByEventId = await findCoesReferencingEventIds([eventId]);
  if (coeByEventId.has(eventId)) {
    const coeUse = coeByEventId.get(eventId);
    const err = new Error(`Cannot remove: used in COE "${coeUse.coeName}" (${coeUse.status})`);
    err.code = 'LIV_EVENT_IN_COE_USE';
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

  console.log(`${LOG_PREFIX} undoLivEventImport: deleted event ${eventId} (${code})`);

  return {
    livEventCode: code,
    deletedEventId: eventId,
    message: 'LIV import undone; event removed from THE1',
  };
}

function getLivVenueLocationMap() {
  return getLivVenueConfig().venueLocationMap;
}

module.exports = {
  prepareLivEventImport,
  undoLivEventImport,
  resolveLivLocation,
  applyInventoryToSeats,
  isLivNightImportableRow,
  isLivBeachImportableRow,
  isLivImportableRow,
  partitionLivEventsByImportStatus,
  findCoesReferencingEventIds,
  attachLivRemoveEligibility,
  parseLivDateQueryParam,
  validateLivDateRangeQuery,
  filterLivEventsByDateRange,
  filterLivEventsNotInPast,
  getLivVenueLocationMap,
  LIV_VENUE_LOCATION_MAP: getLivVenueLocationMap(),
};

/**
 * Encore Beach Club scrap import — prepare / undo / resync (day + night locations).
 */
const Event = require('../../models/Event');
const Location = require('../../models/Location');
const { inheritSeatsFromLocation } = require('../locationEventService');
const {
  fetchEncoreBeachEventDetailInventory,
  normalizeTableName,
  resolveEncoreSeatMapping,
} = require('./encoreBeachEventDetailScraperService');
const { resolveVenueTimezone, wallClockInVenueTzToUtcDate } = require('../../utils/venueTimezone');
const {
  resolveEncoreVenue,
  normalizeEncoreScope,
  getEncoreBeachVenueConfig,
} = require('../../utils/encoreBeachVenueConfig');
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
const {
  findAlreadyImportedForScrap,
  enrichPartitionWithIdentityDedupe,
} = require('./scrapImportDedupe');

const LOG_PREFIX = '[Encore Beach import]';
const PRICE_CHANGE_REASON = 'Encore Beach scrap import';

/**
 * @param {string} timeStr
 * @returns {string|null}
 */
function parseEncoreStartTimeTo24h(timeStr) {
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
 * @param {string} isoDate
 * @param {string} startTime
 * @param {'night_club'|'day_club'} [venueType]
 * @returns {string|null}
 */
function buildStartDatetimeLocal(isoDate, startTime, venueType = 'day_club') {
  if (!isoDate) return null;
  const defaultTime = venueType === 'night_club' ? '22:00' : '11:00';
  const time24 = parseEncoreStartTimeTo24h(startTime) || defaultTime;
  return `${isoDate}T${time24}`;
}

/**
 * @param {object} listingEvent
 * @returns {boolean}
 */
function isEncoreImportableRow(listingEvent) {
  return Boolean(
    listingEvent &&
      (listingEvent.eventId || listingEvent.eventCode) &&
      !listingEvent.isCustomPromo
  );
}

/**
 * @param {object} listingEvent
 * @param {string} [scope]
 * @returns {boolean}
 */
function isEncoreImportableRowForScope(listingEvent, scope) {
  if (!isEncoreImportableRow(listingEvent)) return false;
  const s = normalizeEncoreScope(scope);
  const resolved = resolveEncoreVenue(listingEvent);
  if (s === 'daylife') return resolved.venueType === 'day_club';
  if (s === 'nightlife') return resolved.venueType === 'night_club';
  return true;
}

/** @param {string|null|undefined} value @returns {string|null} */
function parseEncoreDateQueryParam(value) {
  return parseScrapDateQueryParam(value);
}

/** @param {string|null|undefined} fromDate @param {string|null|undefined} toDate */
function validateEncoreDateRangeQuery(fromDate, toDate) {
  return validateScrapDateRangeQuery(fromDate, toDate, 'ENCORE_INVALID_DATE_RANGE');
}

/** @param {object[]} events @param {string} fromDate @param {string} toDate */
function filterEncoreEventsByDateRange(events, fromDate, toDate) {
  return filterScrapEventsByDateRange(events, fromDate, toDate);
}

/** @param {object[]} events */
function filterEncoreEventsNotInPast(events) {
  return filterScrapEventsNotInPast(events);
}

/**
 * @param {object[]} items
 * @returns {object[]}
 */
function enrichEncoreInventorySeatCodes(items) {
  return (items || []).map((item) => {
    if (item.seatCode) return item;
    const key = item.sectionKey || normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveEncoreSeatMapping(key);
    return { ...item, seatCode, the1Category };
  });
}

/**
 * @param {object[]} events
 * @param {{ scope?: string }} [options]
 */
async function partitionEncoreEventsByImportStatus(events, options = {}) {
  const scope = normalizeEncoreScope(options.scope);
  const allRows = Array.isArray(events) ? events : [];
  const importable = [];
  const skipped = [];

  allRows.forEach((row) => {
    if (isEncoreImportableRowForScope(row, scope)) {
      importable.push(row);
    } else if (isEncoreImportableRow(row)) {
      skipped.push({ ...row, skippedReason: `Out of scope (${scope})` });
    } else {
      skipped.push({
        ...row,
        skippedReason: row.skippedReason || 'Not importable',
      });
    }
  });

  const ids = importable
    .map((r) => r.eventId || r.eventCode)
    .filter(Boolean)
    .map(String);
  const existingRows =
    ids.length > 0
      ? await Event.find({ encoreEventId: { $in: ids } })
          .select('encoreEventId name')
          .lean()
      : [];
  const existingById = new Map(existingRows.map((e) => [e.encoreEventId, e]));

  const newEvents = [];
  const alreadyImported = [];

  importable.forEach((row) => {
    const code = String(row.eventId || row.eventCode);
    const existing = existingById.get(code);
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

  const enriched = await enrichPartitionWithIdentityDedupe(
    newEvents,
    alreadyImported,
    async (row) => {
      try {
        return String(resolveEncoreVenue(row).locationId);
      } catch (_) {
        return null;
      }
    }
  );

  const alreadyImportedWithEligibility = await attachScrapRemoveEligibility(
    enriched.alreadyImported
  );

  return {
    newEvents: enriched.newEvents,
    alreadyImported: alreadyImportedWithEligibility,
    skipped,
    stats: {
      totalScraped: allRows.length,
      importableTotal: importable.length,
      newCount: enriched.newEvents.length,
      alreadyImportedCount: alreadyImportedWithEligibility.length,
      skippedCount: skipped.length,
    },
  };
}

/**
 * @param {object} listingEvent
 */
async function prepareEncoreBeachImport(listingEvent) {
  const warnings = [];
  const encoreEventId = String(listingEvent.eventId || listingEvent.eventCode || '').trim();
  const resolved = resolveEncoreVenue(listingEvent);
  const { locationId, type, venueName, venueType } = resolved;
  const cfg = getEncoreBeachVenueConfig();

  if (!encoreEventId) {
    const err = new Error('Missing Encore event id');
    err.code = 'ENCORE_MISSING_EVENT_ID';
    throw err;
  }

  if (!isEncoreImportableRow(listingEvent)) {
    const err = new Error(listingEvent.skippedReason || 'This Encore row cannot be imported');
    err.code = 'ENCORE_NOT_IMPORTABLE';
    throw err;
  }

  assertScrapListingEventNotInPast(listingEvent, 'ENCORE_EVENT_IN_PAST');

  const existing = await findAlreadyImportedForScrap({
    externalField: 'encoreEventId',
    externalCode: encoreEventId,
    locationId,
    isoDate: listingEvent.isoDate,
    name: listingEvent.name,
  });
  if (existing) {
    return {
      alreadyImported: true,
      eventId: String(existing._id),
      eventName: existing.name,
      encoreEventId,
    };
  }

  const location = await Location.findById(locationId);
  if (!location) {
    const err = new Error(`Encore location not found: ${locationId} (${venueName})`);
    err.code = 'ENCORE_LOCATION_NOT_FOUND';
    throw err;
  }

  // Mis-route guard: night tiles must not use day location id
  if (venueType === 'night_club' && String(locationId) === String(cfg.dayLocationId)) {
    const err = new Error('Night event resolved to day location_id; aborting import');
    err.code = 'ENCORE_VENUE_MISROUTE';
    throw err;
  }
  if (venueType === 'day_club' && String(locationId) === String(cfg.nightLocationId)) {
    const err = new Error('Day event resolved to night location_id; aborting import');
    err.code = 'ENCORE_VENUE_MISROUTE';
    throw err;
  }

  const detail = await fetchEncoreBeachEventDetailInventory(listingEvent);
  if (detail.browserError) {
    const err = new Error(`Could not scrape Encore SEATING tab: ${detail.browserError}`);
    err.code = 'ENCORE_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (detail.warnings?.length) warnings.push(...detail.warnings);

  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No SEATING inventory found for Encore event');
    err.code = 'ENCORE_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichEncoreInventorySeatCodes(detail.items);
  const inheritance = await inheritSeatsFromLocation(locationId, {
    name: listingEvent.name,
    type,
  });

  const { seats, warnings: seatWarnings } = applyInventoryToSeats(
    inheritance.seats,
    inventoryItems,
    PRICE_CHANGE_REASON
  );
  if (seatWarnings.length) warnings.push(...seatWarnings);

  assertScrapInventoryPricingApplied(
    seats,
    inventoryItems,
    PRICE_CHANGE_REASON,
    'ENCORE_PRICING_NOT_APPLIED'
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
  const defaultTime = venueType === 'night_club' ? '22:00' : '11:00';
  const startDatetimeLocal =
    buildStartDatetimeLocal(listingEvent.isoDate, listingEvent.startTime, venueType) ||
    (listingEvent.isoDate ? `${listingEvent.isoDate}T${defaultTime}` : null);
  const startDatetime = startDatetimeLocal
    ? wallClockInVenueTzToUtcDate(startDatetimeLocal, timezone)
    : listingEvent.isoDate
      ? new Date(`${listingEvent.isoDate}T${defaultTime}:00`)
      : new Date();

  const minSpends = (inventoryItems || [])
    .map((i) => i.minSpend)
    .filter((n) => typeof n === 'number' && n > 0);
  const basePrice = minSpends.length ? Math.min(...minSpends) : 0;

  const imageUrl = listingEvent.imageUrl || '';
  const media = imageUrl ? [{ type: 'image', url: imageUrl, order: 0 }] : [];

  const notes = [
    'Imported from Encore Beach Club wynnsocial.com listing.',
    `encoreEventId: ${encoreEventId}`,
    `venue: ${venueName}`,
    cfg.listingUrl ? `Source: ${cfg.listingUrl}` : null,
    listingEvent.detailUrl ? `Detail: ${listingEvent.detailUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const prefill = {
    name: detail.metadata?.name || listingEvent.name || 'Event',
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
    encoreEventId,
    seats: seatsForClient,
    units: unitsForClient,
    listingUrl: cfg.listingUrl,
    detailUrl: listingEvent.detailUrl,
    scrapedInventory: inventoryItems,
    venueName,
  };

  console.log(
    `${LOG_PREFIX} prepareEncoreBeachImport: "${prefill.name}" -> ${venueName} (${locationId})`
  );

  return {
    alreadyImported: false,
    prefill,
    warnings,
    encoreEventId,
  };
}

/**
 * @param {string} encoreEventId
 */
async function undoEncoreBeachImport(encoreEventId) {
  const id = (encoreEventId || '').trim();
  if (!id) {
    const err = new Error('Missing Encore event id');
    err.code = 'ENCORE_MISSING_EVENT_ID';
    throw err;
  }

  const event = await Event.findOne({ encoreEventId: id });
  if (!event) {
    const err = new Error(`No THE1 event found for encoreEventId ${id}`);
    err.code = 'ENCORE_EVENT_NOT_FOUND';
    throw err;
  }

  const eventId = String(event._id);
  const coeByEventId = await findCoesReferencingEventIds([eventId]);
  if (coeByEventId.has(eventId)) {
    const coeUse = coeByEventId.get(eventId);
    const err = new Error(`Cannot remove: used in COE "${coeUse.coeName}" (${coeUse.status})`);
    err.code = 'ENCORE_EVENT_IN_COE_USE';
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

  console.log(`${LOG_PREFIX} undoEncoreBeachImport: deleted event ${eventId} (${id})`);

  return {
    encoreEventId: id,
    deletedEventId: eventId,
    message: 'Encore Beach import undone; event removed from THE1',
  };
}

/**
 * @param {string} encoreEventId
 */
async function resyncEncoreBeachEventPricing(encoreEventId) {
  const id = (encoreEventId || '').trim();
  if (!id) {
    const err = new Error('Missing Encore event id');
    err.code = 'ENCORE_MISSING_EVENT_ID';
    throw err;
  }

  const event = await Event.findOne({ encoreEventId: id });
  if (!event) {
    const err = new Error(`No THE1 event found for encoreEventId ${id}`);
    err.code = 'ENCORE_EVENT_NOT_FOUND';
    throw err;
  }

  const listingEvent = {
    eventId: id,
    eventCode: id,
    name: event.name,
    detailUrl: (event.notes || '').match(/Detail:\s*(https?:\/\/\S+)/i)?.[1] || null,
    venueName: event.type === 'night_club' ? 'Encore Beach Club At Night' : 'Encore Beach Club',
    venueType: event.type === 'night_club' ? 'night_club' : 'day_club',
    isoDate: null,
  };

  const detail = await fetchEncoreBeachEventDetailInventory(listingEvent);
  if (detail.browserError) {
    const err = new Error(`Could not scrape Encore SEATING tab: ${detail.browserError}`);
    err.code = 'ENCORE_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No SEATING inventory found for Encore event');
    err.code = 'ENCORE_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichEncoreInventorySeatCodes(detail.items);
  const warnings = [...(detail.warnings || [])];
  const plainSeats = (event.seats || []).map((s) =>
    s && typeof s.toObject === 'function' ? s.toObject() : { ...s }
  );
  const { seats: appliedSeats, warnings: seatWarnings } = applyInventoryToSeats(
    plainSeats,
    inventoryItems,
    PRICE_CHANGE_REASON
  );
  if (seatWarnings.length) warnings.push(...seatWarnings);

  const appliedByCode = new Map(appliedSeats.map((s) => [s.code, s]));
  let updatedSeatCount = 0;

  (event.seats || []).forEach((seat) => {
    if (seat.status === 'booked' || seat.status === 'held') return;
    const applied = appliedByCode.get(seat.code);
    if (applied?.price_change_reason === PRICE_CHANGE_REASON) {
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

  return {
    encoreEventId: id,
    eventId: String(event._id),
    eventName: event.name,
    base_price: event.base_price,
    updatedSeatCount,
    warnings,
    message: 'Encore Beach venue catalog pricing refreshed from wynnsocial.com',
  };
}

module.exports = {
  prepareEncoreBeachImport,
  undoEncoreBeachImport,
  resyncEncoreBeachEventPricing,
  partitionEncoreEventsByImportStatus,
  isEncoreImportableRow,
  isEncoreImportableRowForScope,
  parseEncoreDateQueryParam,
  validateEncoreDateRangeQuery,
  filterEncoreEventsByDateRange,
  filterEncoreEventsNotInPast,
  enrichEncoreInventorySeatCodes,
  buildStartDatetimeLocal,
};

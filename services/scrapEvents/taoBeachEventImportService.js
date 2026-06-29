const Event = require('../../models/Event');
const Location = require('../../models/Location');
const { inheritSeatsFromLocation } = require('../locationEventService');
const {
  fetchTaoBeachEventDetailInventory,
  normalizeTableName,
  resolveTaoBeachSeatMapping,
} = require('./taoBeachEventDetailScraperService');
const { isTaoBeachGenericBookRow } = require('./taoBeachScraperService');
const { resolveVenueTimezone, wallClockInVenueTzToUtcDate } = require('../../utils/venueTimezone');
const { getTaoBeachVenueConfig, inferTaoBeachFromEventCode } = require('../../utils/taoBeachVenueConfig');
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

const LOG_PREFIX = '[TAO Beach import]';
const PRICE_CHANGE_REASON = 'TAO Beach scrap import';

function parseTaoBeachStartTimeTo24h(timeStr) {
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

function buildStartDatetimeLocal(isoDate, startTime) {
  if (!isoDate) return null;
  const time24 = parseTaoBeachStartTimeTo24h(startTime) || '11:00';
  return `${isoDate}T${time24}`;
}

function isTaoBeachImportableRow(listingEvent) {
  if (!listingEvent || !listingEvent.eventCode || listingEvent.isCustomPromo) return false;
  if (
    listingEvent.isGenericBookRow ||
    isTaoBeachGenericBookRow(listingEvent.name, {
      href: listingEvent.bookUrl || listingEvent.detailUrl,
      hasNameEl: listingEvent.hasNameEl,
    })
  ) {
    return false;
  }
  return inferTaoBeachFromEventCode(listingEvent.eventCode);
}

function parseTaoBeachDateQueryParam(value) {
  return parseScrapDateQueryParam(value);
}

function validateTaoBeachDateRangeQuery(fromDate, toDate) {
  return validateScrapDateRangeQuery(fromDate, toDate, 'TAO_BEACH_INVALID_DATE_RANGE');
}

function filterTaoBeachEventsByDateRange(events, fromDate, toDate) {
  return filterScrapEventsByDateRange(events, fromDate, toDate);
}

function filterTaoBeachEventsNotInPast(events) {
  return filterScrapEventsNotInPast(events);
}

function enrichTaoBeachInventorySeatCodes(items) {
  return (items || []).map((item) => {
    if (item.seatCode) return item;
    const key = item.sectionKey || normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveTaoBeachSeatMapping(key);
    return { ...item, seatCode, the1Category };
  });
}

async function partitionTaoBeachEventsByImportStatus(events) {
  const allRows = Array.isArray(events) ? events : [];
  const importable = [];
  const skipped = [];

  allRows.forEach((row) => {
    if (isTaoBeachImportableRow(row)) {
      importable.push(row);
    } else {
      skipped.push(row);
    }
  });

  const codes = importable.map((r) => r.eventCode).filter(Boolean);
  const existingRows =
    codes.length > 0
      ? await Event.find({ taoBeachEventCode: { $in: codes } }).select('taoBeachEventCode name').lean()
      : [];
  const existingByCode = new Map(existingRows.map((e) => [e.taoBeachEventCode, e]));

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

  return {
    newEvents,
    alreadyImported: alreadyImportedWithEligibility,
    skipped,
    stats: {
      totalScraped: allRows.length,
      importableTotal: importable.length,
      newCount: newEvents.length,
      alreadyImportedCount: alreadyImportedWithEligibility.length,
      skippedCount: skipped.length,
    },
  };
}

function ensureTaoBeachEventCodeOnDetailUrl(detailUrl, taoBeachEventCode) {
  const url = (detailUrl || '').trim();
  const code = (taoBeachEventCode || '').trim();
  if (!url) return null;
  if (!code || /[?&]eventcode=/i.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}eventcode=${encodeURIComponent(code)}`;
}

function extractTaoBeachDetailUrlFromNotes(notes) {
  if (!notes) return null;
  const match = String(notes).match(/Source:\s*(https?:\/\/\S+)/i);
  return match ? match[1].trim() : null;
}

function resolveTaoBeachDetailUrl(notes, taoBeachEventCode) {
  const fromNotes = extractTaoBeachDetailUrlFromNotes(notes);
  return ensureTaoBeachEventCodeOnDetailUrl(fromNotes, taoBeachEventCode);
}

async function prepareTaoBeachEventImport(listingEvent) {
  const warnings = [];
  const { locationId, type, venueName } = getTaoBeachVenueConfig();
  const taoBeachEventCode = listingEvent.eventCode;

  if (!taoBeachEventCode) {
    const err = new Error('Missing TAO Beach event code');
    err.code = 'TAO_BEACH_MISSING_EVENT_CODE';
    throw err;
  }

  if (!isTaoBeachImportableRow(listingEvent)) {
    const err = new Error(
      listingEvent.isGenericBookRow ||
        isTaoBeachGenericBookRow(listingEvent.name, {
          href: listingEvent.bookUrl || listingEvent.detailUrl,
          hasNameEl: listingEvent.hasNameEl,
        })
        ? 'Generic Book placeholder days are not supported in v1'
        : 'This TAO Beach row cannot be imported as a bookable event'
    );
    err.code = 'TAO_BEACH_NOT_IMPORTABLE';
    throw err;
  }

  assertScrapListingEventNotInPast(listingEvent, 'TAO_BEACH_EVENT_IN_PAST');

  const existing = await Event.findOne({ taoBeachEventCode }).select('_id name').lean();
  if (existing) {
    return {
      alreadyImported: true,
      eventId: String(existing._id),
      eventName: existing.name,
      taoBeachEventCode,
    };
  }

  const location = await Location.findById(locationId);
  if (!location) {
    const err = new Error(`TAO Beach location not found: ${locationId}`);
    err.code = 'TAO_BEACH_LOCATION_NOT_FOUND';
    throw err;
  }

  const detailUrl = ensureTaoBeachEventCodeOnDetailUrl(
    listingEvent.detailUrl || listingEvent.bookUrl,
    taoBeachEventCode
  );
  if (!detailUrl) {
    const err = new Error('Missing TAO Beach event detail URL');
    err.code = 'TAO_BEACH_MISSING_DETAIL_URL';
    throw err;
  }

  const detail = await fetchTaoBeachEventDetailInventory(detailUrl);
  if (detail.browserError) {
    const err = new Error(`Could not scrape TAO Beach detail page: ${detail.browserError}`);
    err.code = 'TAO_BEACH_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (detail.warnings?.length) warnings.push(...detail.warnings);

  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No TABLES inventory found on TAO Beach detail page');
    err.code = 'TAO_BEACH_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichTaoBeachInventorySeatCodes(detail.items);
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
    'TAO_BEACH_PRICING_NOT_APPLIED'
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
  const startDatetimeLocal =
    buildStartDatetimeLocal(listingEvent.isoDate, listingEvent.startTime) ||
    (listingEvent.isoDate ? `${listingEvent.isoDate}T11:00` : null);
  const startDatetime = startDatetimeLocal
    ? wallClockInVenueTzToUtcDate(startDatetimeLocal, timezone)
    : listingEvent.isoDate
      ? new Date(`${listingEvent.isoDate}T11:00:00`)
      : new Date();

  const minSpends = (inventoryItems || [])
    .map((i) => i.minSpend)
    .filter((n) => typeof n === 'number' && n > 0);
  const basePrice = minSpends.length ? Math.min(...minSpends) : 0;

  const media = listingEvent.imageUrl
    ? [{ type: 'image', url: listingEvent.imageUrl, order: 0 }]
    : [];

  const notes = [
    'Imported from TAO Beach Booketing listing.',
    `taoBeachEventCode: ${taoBeachEventCode}`,
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
    taoBeachEventCode,
    seats: seatsForClient,
    units: unitsForClient,
    detailUrl,
    scrapedInventory: inventoryItems,
    venueName,
  };

  console.log(`${LOG_PREFIX} prepareTaoBeachEventImport: "${prefill.name}" -> location ${location.name}`);

  return {
    alreadyImported: false,
    prefill,
    warnings,
    taoBeachEventCode,
  };
}

async function undoTaoBeachEventImport(taoBeachEventCode) {
  const code = (taoBeachEventCode || '').trim();
  if (!code) {
    const err = new Error('Missing TAO Beach event code');
    err.code = 'TAO_BEACH_MISSING_EVENT_CODE';
    throw err;
  }

  const event = await Event.findOne({ taoBeachEventCode: code });
  if (!event) {
    const err = new Error(`No THE1 event found for taoBeachEventCode ${code}`);
    err.code = 'TAO_BEACH_EVENT_NOT_FOUND';
    throw err;
  }

  const eventId = String(event._id);
  const coeByEventId = await findCoesReferencingEventIds([eventId]);
  if (coeByEventId.has(eventId)) {
    const coeUse = coeByEventId.get(eventId);
    const err = new Error(`Cannot remove: used in COE "${coeUse.coeName}" (${coeUse.status})`);
    err.code = 'TAO_BEACH_EVENT_IN_COE_USE';
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

  return {
    taoBeachEventCode: code,
    deletedEventId: eventId,
    message: 'TAO Beach import undone; event removed from THE1',
  };
}

async function resyncTaoBeachEventPricing(taoBeachEventCode) {
  const code = (taoBeachEventCode || '').trim();
  if (!code) {
    const err = new Error('Missing TAO Beach event code');
    err.code = 'TAO_BEACH_MISSING_EVENT_CODE';
    throw err;
  }

  const event = await Event.findOne({ taoBeachEventCode: code });
  if (!event) {
    const err = new Error(`No THE1 event found for taoBeachEventCode ${code}`);
    err.code = 'TAO_BEACH_EVENT_NOT_FOUND';
    throw err;
  }

  const detailUrl = resolveTaoBeachDetailUrl(event.notes, code);
  if (!detailUrl) {
    const err = new Error('No Booketing source URL on event notes');
    err.code = 'TAO_BEACH_MISSING_DETAIL_URL';
    throw err;
  }

  const detail = await fetchTaoBeachEventDetailInventory(detailUrl);
  if (detail.browserError) {
    const err = new Error(`Could not scrape TAO Beach detail page: ${detail.browserError}`);
    err.code = 'TAO_BEACH_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No TABLES inventory found on TAO Beach detail page');
    err.code = 'TAO_BEACH_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichTaoBeachInventorySeatCodes(detail.items);
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
    taoBeachEventCode: code,
    eventId: String(event._id),
    eventName: event.name,
    base_price: event.base_price,
    updatedSeatCount,
    warnings,
    message: 'TAO Beach venue catalog pricing refreshed from Booketing',
  };
}

module.exports = {
  prepareTaoBeachEventImport,
  undoTaoBeachEventImport,
  resyncTaoBeachEventPricing,
  ensureTaoBeachEventCodeOnDetailUrl,
  extractTaoBeachDetailUrlFromNotes,
  resolveTaoBeachDetailUrl,
  partitionTaoBeachEventsByImportStatus,
  isTaoBeachImportableRow,
  parseTaoBeachDateQueryParam,
  validateTaoBeachDateRangeQuery,
  filterTaoBeachEventsByDateRange,
  filterTaoBeachEventsNotInPast,
};

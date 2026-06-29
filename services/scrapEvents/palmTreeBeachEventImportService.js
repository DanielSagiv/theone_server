const Event = require('../../models/Event');
const Location = require('../../models/Location');
const { inheritSeatsFromLocation } = require('../locationEventService');
const {
  fetchPalmTreeBeachEventDetailInventory,
  normalizeTableName,
  resolvePalmTreeBeachSeatMapping,
} = require('./palmTreeBeachEventDetailScraperService');
const { ensurePalmTreeBeachEventCodeOnDetailUrl } = require('./palmTreeBeachScraperService');
const { resolveVenueTimezone, wallClockInVenueTzToUtcDate } = require('../../utils/venueTimezone');
const {
  getPalmTreeBeachVenueConfig,
  inferPalmTreeBeachFromEventCode,
} = require('../../utils/palmTreeBeachVenueConfig');
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
} = require('./scrapEventsShared');

const LOG_PREFIX = '[Palm Tree Beach import]';
const PRICE_CHANGE_REASON = 'Palm Tree Beach scrap import';

function parsePalmTreeBeachStartTimeTo24h(timeStr) {
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
  const time24 = parsePalmTreeBeachStartTimeTo24h(startTime) || '11:00';
  return `${isoDate}T${time24}`;
}

function isPalmTreeBeachImportableRow(listingEvent) {
  if (!listingEvent || !listingEvent.eventCode || listingEvent.isCustomPromo) return false;
  return inferPalmTreeBeachFromEventCode(listingEvent.eventCode);
}

function parsePalmTreeBeachDateQueryParam(value) {
  return parseScrapDateQueryParam(value);
}

function validatePalmTreeBeachDateRangeQuery(fromDate, toDate) {
  return validateScrapDateRangeQuery(fromDate, toDate, 'PALM_TREE_BEACH_INVALID_DATE_RANGE');
}

function filterPalmTreeBeachEventsByDateRange(events, fromDate, toDate) {
  return filterScrapEventsByDateRange(events, fromDate, toDate);
}

function filterPalmTreeBeachEventsNotInPast(events) {
  return filterScrapEventsNotInPast(events);
}

function enrichPalmTreeBeachInventorySeatCodes(items) {
  return (items || []).map((item) => {
    if (item.seatCode) return item;
    const key = item.sectionKey || normalizeTableName(item.name);
    const { seatCode, the1Category } = resolvePalmTreeBeachSeatMapping(key);
    return { ...item, seatCode, the1Category };
  });
}

async function partitionPalmTreeBeachEventsByImportStatus(events) {
  const allRows = Array.isArray(events) ? events : [];
  const importable = [];
  const skipped = [];

  allRows.forEach((row) => {
    if (isPalmTreeBeachImportableRow(row)) {
      importable.push(row);
    } else {
      skipped.push(row);
    }
  });

  const codes = importable.map((r) => r.eventCode).filter(Boolean);
  const existingRows =
    codes.length > 0
      ? await Event.find({ palmTreeBeachEventCode: { $in: codes } }).select('palmTreeBeachEventCode name').lean()
      : [];
  const existingByCode = new Map(existingRows.map((e) => [e.palmTreeBeachEventCode, e]));

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

function extractPalmTreeBeachDetailUrlFromNotes(notes) {
  if (!notes) return null;
  const match = String(notes).match(/Source:\s*(https?:\/\/\S+)/i);
  return match ? match[1].trim() : null;
}

function resolvePalmTreeBeachDetailUrl(notes, palmTreeBeachEventCode) {
  const fromNotes = extractPalmTreeBeachDetailUrlFromNotes(notes);
  return ensurePalmTreeBeachEventCodeOnDetailUrl(fromNotes, palmTreeBeachEventCode);
}

async function preparePalmTreeBeachImport(listingEvent) {
  const warnings = [];
  const { locationId, type, venueName } = getPalmTreeBeachVenueConfig();
  const palmTreeBeachEventCode = listingEvent.eventCode;

  if (!palmTreeBeachEventCode) {
    const err = new Error('Missing Palm Tree Beach event code');
    err.code = 'PALM_TREE_BEACH_MISSING_EVENT_CODE';
    throw err;
  }

  if (!isPalmTreeBeachImportableRow(listingEvent)) {
    const err = new Error('This Palm Tree Beach row cannot be imported as a bookable event');
    err.code = 'PALM_TREE_BEACH_NOT_IMPORTABLE';
    throw err;
  }

  assertScrapListingEventNotInPast(listingEvent, 'PALM_TREE_BEACH_EVENT_IN_PAST');

  const existing = await Event.findOne({ palmTreeBeachEventCode }).select('_id name').lean();
  if (existing) {
    return {
      alreadyImported: true,
      eventId: String(existing._id),
      eventName: existing.name,
      palmTreeBeachEventCode,
    };
  }

  const location = await Location.findById(locationId);
  if (!location) {
    const err = new Error(`Palm Tree Beach location not found: ${locationId}`);
    err.code = 'PALM_TREE_BEACH_LOCATION_NOT_FOUND';
    throw err;
  }

  const detailUrl = ensurePalmTreeBeachEventCodeOnDetailUrl(
    listingEvent.detailUrl || listingEvent.bookUrl,
    palmTreeBeachEventCode
  );
  if (!detailUrl) {
    const err = new Error('Missing Palm Tree Beach event detail URL');
    err.code = 'PALM_TREE_BEACH_MISSING_DETAIL_URL';
    throw err;
  }

  const detail = await fetchPalmTreeBeachEventDetailInventory(detailUrl);
  if (detail.browserError) {
    const err = new Error(`Could not scrape Palm Tree Beach detail page: ${detail.browserError}`);
    err.code = 'PALM_TREE_BEACH_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (detail.warnings?.length) warnings.push(...detail.warnings);

  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No TABLES inventory found on Palm Tree Beach detail page');
    err.code = 'PALM_TREE_BEACH_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichPalmTreeBeachInventorySeatCodes(detail.items);
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
    'PALM_TREE_BEACH_PRICING_NOT_APPLIED'
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
    'Imported from Palm Tree Beach Booketing listing.',
    `palmTreeBeachEventCode: ${palmTreeBeachEventCode}`,
    detailUrl ? `Source: ${detailUrl}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const prefill = {
    name: listingEvent.name || 'Event',
    description: detail.description || listingEvent.name || '',
    type,
    location_id: locationId,
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
    palmTreeBeachEventCode,
    seats: seatsForClient,
    units: unitsForClient,
    detailUrl,
    scrapedInventory: inventoryItems,
    venueName,
  };

  console.log(`${LOG_PREFIX} preparePalmTreeBeachImport: "${prefill.name}" -> location ${location.name}`);

  return {
    alreadyImported: false,
    prefill,
    warnings,
    palmTreeBeachEventCode,
  };
}

async function undoPalmTreeBeachImport(palmTreeBeachEventCode) {
  const code = (palmTreeBeachEventCode || '').trim();
  if (!code) {
    const err = new Error('Missing Palm Tree Beach event code');
    err.code = 'PALM_TREE_BEACH_MISSING_EVENT_CODE';
    throw err;
  }

  const event = await Event.findOne({ palmTreeBeachEventCode: code });
  if (!event) {
    const err = new Error(`No THE1 event found for palmTreeBeachEventCode ${code}`);
    err.code = 'PALM_TREE_BEACH_EVENT_NOT_FOUND';
    throw err;
  }

  const eventId = String(event._id);
  const coeByEventId = await findCoesReferencingEventIds([eventId]);
  if (coeByEventId.has(eventId)) {
    const coeUse = coeByEventId.get(eventId);
    const err = new Error(`Cannot remove: used in COE "${coeUse.coeName}" (${coeUse.status})`);
    err.code = 'PALM_TREE_BEACH_EVENT_IN_COE_USE';
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
    palmTreeBeachEventCode: code,
    deletedEventId: eventId,
    message: 'Palm Tree Beach import undone; event removed from THE1',
  };
}

async function resyncPalmTreeBeachEventPricing(palmTreeBeachEventCode) {
  const code = (palmTreeBeachEventCode || '').trim();
  if (!code) {
    const err = new Error('Missing Palm Tree Beach event code');
    err.code = 'PALM_TREE_BEACH_MISSING_EVENT_CODE';
    throw err;
  }

  const event = await Event.findOne({ palmTreeBeachEventCode: code });
  if (!event) {
    const err = new Error(`No THE1 event found for palmTreeBeachEventCode ${code}`);
    err.code = 'PALM_TREE_BEACH_EVENT_NOT_FOUND';
    throw err;
  }

  const detailUrl = resolvePalmTreeBeachDetailUrl(event.notes, code);
  if (!detailUrl) {
    const err = new Error('No Booketing source URL on event notes');
    err.code = 'PALM_TREE_BEACH_MISSING_DETAIL_URL';
    throw err;
  }

  const detail = await fetchPalmTreeBeachEventDetailInventory(detailUrl);
  if (detail.browserError) {
    const err = new Error(`Could not scrape Palm Tree Beach detail page: ${detail.browserError}`);
    err.code = 'PALM_TREE_BEACH_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No TABLES inventory found on Palm Tree Beach detail page');
    err.code = 'PALM_TREE_BEACH_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichPalmTreeBeachInventorySeatCodes(detail.items);
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
    palmTreeBeachEventCode: code,
    eventId: String(event._id),
    eventName: event.name,
    base_price: event.base_price,
    updatedSeatCount,
    warnings,
    message: 'Palm Tree Beach venue catalog pricing refreshed from Booketing',
  };
}

module.exports = {
  preparePalmTreeBeachImport,
  undoPalmTreeBeachImport,
  resyncPalmTreeBeachEventPricing,
  resolvePalmTreeBeachDetailUrl,
  extractPalmTreeBeachDetailUrlFromNotes,
  partitionPalmTreeBeachEventsByImportStatus,
  isPalmTreeBeachImportableRow,
  parsePalmTreeBeachDateQueryParam,
  validatePalmTreeBeachDateRangeQuery,
  filterPalmTreeBeachEventsByDateRange,
  filterPalmTreeBeachEventsNotInPast,
};

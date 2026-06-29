const Event = require('../../models/Event');
const Location = require('../../models/Location');
const { inheritSeatsFromLocation } = require('../locationEventService');
const {
  fetchMarqueeNightclubEventDetailInventory,
  normalizeTableName,
  resolveMarqueeNightclubSeatMapping,
} = require('./marqueeNightclubEventDetailScraperService');
const { isoDateFromEventName } = require('./marqueeNightclubScraperService');
const { resolveVenueTimezone, wallClockInVenueTzToUtcDate } = require('../../utils/venueTimezone');
const { getMarqueeNightclubVenueConfig } = require('../../utils/marqueeNightclubVenueConfig');
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

const LOG_PREFIX = '[Marquee Nightclub import]';
const PRICE_CHANGE_REASON = 'Marquee Nightclub scrap import';

function parseMarqueeNightclubStartTimeTo24h(timeStr) {
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

function isoDateFromMetadata(metadata, listingEvent) {
  if (metadata?.start_datetime) {
    const d = new Date(metadata.start_datetime);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  return listingEvent.isoDate || isoDateFromEventName(listingEvent.name) || null;
}

function buildStartDatetimeLocal(isoDate, startTime) {
  if (!isoDate) return null;
  const time24 = parseMarqueeNightclubStartTimeTo24h(startTime) || '22:00';
  return `${isoDate}T${time24}`;
}

function isMarqueeNightclubImportableRow(listingEvent) {
  if (!listingEvent || !listingEvent.eventId || listingEvent.isCustomPromo) return false;
  if (listingEvent.hasVipReservations === false) return false;
  return true;
}

function parseMarqueeNightclubDateQueryParam(value) {
  return parseScrapDateQueryParam(value);
}

function validateMarqueeNightclubDateRangeQuery(fromDate, toDate) {
  return validateScrapDateRangeQuery(fromDate, toDate, 'MARQUEE_NIGHTCLUB_INVALID_DATE_RANGE');
}

function filterMarqueeNightclubEventsByDateRange(events, fromDate, toDate) {
  return filterScrapEventsByDateRange(events, fromDate, toDate);
}

function filterMarqueeNightclubEventsNotInPast(events) {
  return filterScrapEventsNotInPast(events);
}

function enrichMarqueeNightclubInventorySeatCodes(items) {
  return (items || []).map((item) => {
    if (item.seatCode) return item;
    const key = item.sectionKey || normalizeTableName(item.name);
    const { seatCode, the1Category } = resolveMarqueeNightclubSeatMapping(key);
    return { ...item, seatCode, the1Category };
  });
}

async function partitionMarqueeNightclubEventsByImportStatus(events) {
  const allRows = Array.isArray(events) ? events : [];
  const importable = [];
  const skipped = [];

  allRows.forEach((row) => {
    if (isMarqueeNightclubImportableRow(row)) {
      importable.push(row);
    } else {
      skipped.push({
        ...row,
        skippedReason: row.skippedReason || 'No VIP Reservations / not importable',
      });
    }
  });

  const ids = importable.map((r) => r.eventId).filter(Boolean);
  const existingRows =
    ids.length > 0
      ? await Event.find({ marqueeNightclubEventId: { $in: ids } })
          .select('marqueeNightclubEventId name')
          .lean()
      : [];
  const existingById = new Map(existingRows.map((e) => [e.marqueeNightclubEventId, e]));

  const newEvents = [];
  const alreadyImported = [];

  importable.forEach((row) => {
    const existing = existingById.get(row.eventId);
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

function extractMarqueeNightclubListingUrlFromNotes(notes) {
  if (!notes) return null;
  const match = String(notes).match(/Source:\s*(https?:\/\/\S+)/i);
  return match ? match[1].trim() : null;
}

function resolveMarqueeNightclubListingUrl(notes) {
  const fromNotes = extractMarqueeNightclubListingUrlFromNotes(notes);
  if (fromNotes) return fromNotes;
  return getMarqueeNightclubVenueConfig().listingUrl;
}

async function prepareMarqueeNightclubImport(listingEvent) {
  const warnings = [];
  const { locationId, type, venueName, listingUrl } = getMarqueeNightclubVenueConfig();
  const marqueeNightclubEventId = listingEvent.eventId;

  if (!marqueeNightclubEventId) {
    const err = new Error('Missing Marquee Nightclub event id');
    err.code = 'MARQUEE_NIGHTCLUB_MISSING_EVENT_ID';
    throw err;
  }

  if (!isMarqueeNightclubImportableRow(listingEvent)) {
    const err = new Error(
      listingEvent.skippedReason ||
        'This Marquee Nightclub row cannot be imported (no VIP Reservations)'
    );
    err.code = 'MARQUEE_NIGHTCLUB_NOT_IMPORTABLE';
    throw err;
  }

  assertScrapListingEventNotInPast(listingEvent, 'MARQUEE_NIGHTCLUB_EVENT_IN_PAST');

  const existing = await Event.findOne({ marqueeNightclubEventId }).select('_id name').lean();
  if (existing) {
    return {
      alreadyImported: true,
      eventId: String(existing._id),
      eventName: existing.name,
      marqueeNightclubEventId,
    };
  }

  const location = await Location.findById(locationId);
  if (!location) {
    const err = new Error(`Marquee Nightclub location not found: ${locationId}`);
    err.code = 'MARQUEE_NIGHTCLUB_LOCATION_NOT_FOUND';
    throw err;
  }

  const detail = await fetchMarqueeNightclubEventDetailInventory(listingEvent);
  if (detail.browserError) {
    const err = new Error(`Could not scrape Marquee Nightclub VIP flow: ${detail.browserError}`);
    err.code = 'MARQUEE_NIGHTCLUB_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (detail.warnings?.length) warnings.push(...detail.warnings);

  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No TABLES inventory found for Marquee Nightclub event');
    err.code = 'MARQUEE_NIGHTCLUB_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichMarqueeNightclubInventorySeatCodes(detail.items);
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
    'MARQUEE_NIGHTCLUB_PRICING_NOT_APPLIED'
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
  const isoDate = isoDateFromMetadata(detail.metadata, listingEvent);
  const startDatetimeLocal =
    buildStartDatetimeLocal(isoDate, listingEvent.startTime) ||
    (isoDate ? `${isoDate}T22:00` : null);
  const startDatetime = startDatetimeLocal
    ? wallClockInVenueTzToUtcDate(startDatetimeLocal, timezone)
    : isoDate
      ? new Date(`${isoDate}T22:00:00`)
      : new Date();

  const minSpends = (inventoryItems || [])
    .map((i) => i.minSpend)
    .filter((n) => typeof n === 'number' && n > 0);
  const basePrice = minSpends.length ? Math.min(...minSpends) : 0;

  const imageUrl = listingEvent.imageUrl || detail.metadata?.image || '';
  const media = imageUrl ? [{ type: 'image', url: imageUrl, order: 0 }] : [];

  const notes = [
    'Imported from Marquee Nightclub taogroup.com listing.',
    `marqueeNightclubEventId: ${marqueeNightclubEventId}`,
    listingUrl ? `Source: ${listingUrl}` : null,
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
    marqueeNightclubEventId,
    seats: seatsForClient,
    units: unitsForClient,
    listingUrl,
    detailUrl: listingEvent.detailUrl,
    scrapedInventory: inventoryItems,
    venueName,
  };

  console.log(`${LOG_PREFIX} prepareMarqueeNightclubImport: "${prefill.name}" -> location ${location.name}`);

  return {
    alreadyImported: false,
    prefill,
    warnings,
    marqueeNightclubEventId,
  };
}

async function undoMarqueeNightclubImport(marqueeNightclubEventId) {
  const id = (marqueeNightclubEventId || '').trim();
  if (!id) {
    const err = new Error('Missing Marquee Nightclub event id');
    err.code = 'MARQUEE_NIGHTCLUB_MISSING_EVENT_ID';
    throw err;
  }

  const event = await Event.findOne({ marqueeNightclubEventId: id });
  if (!event) {
    const err = new Error(`No THE1 event found for marqueeNightclubEventId ${id}`);
    err.code = 'MARQUEE_NIGHTCLUB_EVENT_NOT_FOUND';
    throw err;
  }

  const eventId = String(event._id);
  const coeByEventId = await findCoesReferencingEventIds([eventId]);
  if (coeByEventId.has(eventId)) {
    const coeUse = coeByEventId.get(eventId);
    const err = new Error(`Cannot remove: used in COE "${coeUse.coeName}" (${coeUse.status})`);
    err.code = 'MARQUEE_NIGHTCLUB_EVENT_IN_COE_USE';
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
    marqueeNightclubEventId: id,
    deletedEventId: eventId,
    message: 'Marquee Nightclub import undone; event removed from THE1',
  };
}

async function resyncMarqueeNightclubEventPricing(marqueeNightclubEventId) {
  const id = (marqueeNightclubEventId || '').trim();
  if (!id) {
    const err = new Error('Missing Marquee Nightclub event id');
    err.code = 'MARQUEE_NIGHTCLUB_MISSING_EVENT_ID';
    throw err;
  }

  const event = await Event.findOne({ marqueeNightclubEventId: id });
  if (!event) {
    const err = new Error(`No THE1 event found for marqueeNightclubEventId ${id}`);
    err.code = 'MARQUEE_NIGHTCLUB_EVENT_NOT_FOUND';
    throw err;
  }

  const listingEvent = {
    eventId: id,
    name: event.name,
    detailUrl: (event.notes || '').match(/Detail:\s*(https?:\/\/\S+)/i)?.[1] || null,
    isoDate: null,
    hasVipReservations: true,
  };

  const detail = await fetchMarqueeNightclubEventDetailInventory(listingEvent);
  if (detail.browserError) {
    const err = new Error(`Could not scrape Marquee Nightclub VIP flow: ${detail.browserError}`);
    err.code = 'MARQUEE_NIGHTCLUB_DETAIL_SCRAPE_FAILED';
    throw err;
  }
  if (!Array.isArray(detail.items) || detail.items.length === 0) {
    const err = new Error('No TABLES inventory found for Marquee Nightclub event');
    err.code = 'MARQUEE_NIGHTCLUB_EMPTY_INVENTORY';
    throw err;
  }

  const inventoryItems = enrichMarqueeNightclubInventorySeatCodes(detail.items);
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
    marqueeNightclubEventId: id,
    eventId: String(event._id),
    eventName: event.name,
    base_price: event.base_price,
    updatedSeatCount,
    warnings,
    message: 'Marquee Nightclub venue catalog pricing refreshed from taogroup.com',
  };
}

module.exports = {
  prepareMarqueeNightclubImport,
  undoMarqueeNightclubImport,
  resyncMarqueeNightclubEventPricing,
  resolveMarqueeNightclubListingUrl,
  extractMarqueeNightclubListingUrlFromNotes,
  partitionMarqueeNightclubEventsByImportStatus,
  isMarqueeNightclubImportableRow,
  parseMarqueeNightclubDateQueryParam,
  validateMarqueeNightclubDateRangeQuery,
  filterMarqueeNightclubEventsByDateRange,
  filterMarqueeNightclubEventsNotInPast,
};

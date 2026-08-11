/**
 * Scrap import commit/partition for Local DB or remote Stage/Prod API.
 */
const axios = require('axios');
const FormData = require('form-data');
const Event = require('../../models/Event');
const Location = require('../../models/Location');
const { applyInventoryToSeats, assertScrapInventoryPricingApplied } = require('./scrapEventsShared');
const { resolveEncoreVenue } = require('../../utils/encoreBeachVenueConfig');
const { resolveOmniaVenue } = require('../../utils/omniaVenueConfig');
const { resolveLivLocation } = require('./livLasVegasEventImportService');
const { getHakkasanVenueConfig } = require('../../utils/hakkasanVenueConfig');
const { getTaoBeachVenueConfig } = require('../../utils/taoBeachVenueConfig');
const { getPalmTreeBeachVenueConfig } = require('../../utils/palmTreeBeachVenueConfig');
const { getMarqueeDayclubVenueConfig } = require('../../utils/marqueeDayclubVenueConfig');
const { getMarqueeNightclubVenueConfig } = require('../../utils/marqueeNightclubVenueConfig');
const {
  normalizeScrapImportPlatform,
  scrapImportPlatformRequest,
} = require('./scrapImportPlatformClient');
const {
  findExistingEventByScrapIdentity,
  lookupEventIdentitiesLocal,
} = require('./scrapImportDedupe');

const LOG_PREFIX = '[scrap-import-commit]';

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** @type {Record<string, { field: string, priceReason: string }>} */
const VENUE_EXTERNAL_FIELDS = {
  liv: { field: 'livEventCode', priceReason: 'LIV scrap import' },
  omnia: { field: 'omniaEventCode', priceReason: 'OMNIA scrap import' },
  hakkasan: { field: 'hakkasanEventCode', priceReason: 'Hakkasan scrap import' },
  taoBeach: { field: 'taoBeachEventCode', priceReason: 'TAO Beach scrap import' },
  palmTreeBeach: { field: 'palmTreeBeachEventCode', priceReason: 'Palm Tree Beach scrap import' },
  marqueeDayclub: { field: 'marqueeDayclubEventCode', priceReason: 'Marquee Dayclub scrap import' },
  marqueeNightclub: { field: 'marqueeNightclubEventId', priceReason: 'Marquee Nightclub scrap import' },
  encoreBeach: { field: 'encoreEventId', priceReason: 'Encore Beach scrap import' },
};

const ALLOWED_LOOKUP_FIELDS = new Set(Object.values(VENUE_EXTERNAL_FIELDS).map((v) => v.field));

/**
 * @param {string} venueKey
 * @returns {{ field: string, priceReason: string }}
 */
function getVenueExternalMeta(venueKey) {
  const meta = VENUE_EXTERNAL_FIELDS[venueKey];
  if (!meta) {
    const err = new Error(`Unknown venueKey: ${venueKey}`);
    err.code = 'SCRAP_UNKNOWN_VENUE_KEY';
    throw err;
  }
  return meta;
}

/**
 * @param {string} venueKey
 * @param {object} listingEvent
 * @param {object} [prefill]
 * @returns {{ venueName: string, type: string, nameAliases: string[] }}
 */
function resolveTargetLocationMeta(venueKey, listingEvent, prefill) {
  /** @type {{ venueName: string, type: string, nameAliases: string[] }} */
  let result;

  if (venueKey === 'encoreBeach') {
    const r = resolveEncoreVenue(listingEvent || prefill || {});
    result = {
      venueName: r.venueName,
      type: r.type,
      nameAliases: [r.venueName],
    };
  } else if (venueKey === 'omnia') {
    const r = resolveOmniaVenue(listingEvent || prefill || {});
    const isDay = r.venueType === 'day_club' || r.type === 'day_club';
    result = {
      venueName: isDay ? 'OMNIA Dayclub' : 'OMNIA Nightclub',
      type: r.type,
      nameAliases: isDay
        ? ['OMNIA Dayclub', 'Omnia DayClub', 'OMNIA Day Club']
        : ['OMNIA Nightclub', 'OMNIA', 'OMNIA Night Club'],
    };
  } else if (venueKey === 'liv') {
    const r = resolveLivLocation(listingEvent || {});
    if (!r) {
      const err = new Error('Could not resolve LIV location from listing row');
      err.code = 'LIV_LOCATION_UNMAPPED';
      throw err;
    }
    const isDay = r.type === 'day_club';
    result = {
      venueName: isDay ? 'LIV Beach' : 'LIV',
      type: r.type,
      nameAliases: isDay
        ? ['LIV Beach', 'LIV LAS VEGAS Beach club']
        : ['LIV', 'LIV LAS VEGAS Night club'],
    };
  } else if (venueKey === 'hakkasan') {
    const c = getHakkasanVenueConfig();
    result = {
      venueName: 'Hakkasan Nightclub',
      type: c.type,
      nameAliases: ['Hakkasan Nightclub', 'Hakkasan Las Vegas', 'Hakkasan'],
    };
  } else if (venueKey === 'taoBeach') {
    const c = getTaoBeachVenueConfig();
    result = { venueName: 'TAO Beach', type: c.type, nameAliases: ['TAO Beach'] };
  } else if (venueKey === 'palmTreeBeach') {
    const c = getPalmTreeBeachVenueConfig();
    result = {
      venueName: 'Palm Tree Beach Club',
      type: c.type,
      nameAliases: ['Palm Tree Beach Club', 'Palm Tree Beach'],
    };
  } else if (venueKey === 'marqueeDayclub') {
    const c = getMarqueeDayclubVenueConfig();
    result = {
      venueName: 'Marquee Dayclub',
      type: c.type,
      nameAliases: ['Marquee Dayclub'],
    };
  } else if (venueKey === 'marqueeNightclub') {
    const c = getMarqueeNightclubVenueConfig();
    result = {
      venueName: 'Marquee Nightclub',
      type: c.type,
      nameAliases: ['Marquee Nightclub'],
    };
  } else {
    const err = new Error(`Unknown venueKey: ${venueKey}`);
    err.code = 'SCRAP_UNKNOWN_VENUE_KEY';
    throw err;
  }

  if (prefill?.venueName) {
    result.nameAliases = [...new Set([prefill.venueName, ...result.nameAliases])];
  }
  if (prefill?.type) result.type = prefill.type;
  return result;
}

/**
 * @param {object} listingEvent
 * @param {string} venueKey
 * @param {object} [prefill]
 * @returns {string|null}
 */
function extractExternalCode(listingEvent, venueKey, prefill) {
  const { field } = getVenueExternalMeta(venueKey);
  if (prefill?.[field]) return String(prefill[field]).trim();
  if (listingEvent?.[field]) return String(listingEvent[field]).trim();
  if (venueKey === 'marqueeNightclub' || venueKey === 'encoreBeach') {
    return String(listingEvent?.eventId || listingEvent?.eventCode || '').trim() || null;
  }
  return String(listingEvent?.eventCode || listingEvent?.eventId || '').trim() || null;
}

/**
 * Local DB lookup of existing external ids.
 * @param {string} field
 * @param {string[]} codes
 * @returns {Promise<{ code: string, eventId: string, name: string }[]>}
 */
async function lookupExternalIdsLocal(field, codes) {
  if (!ALLOWED_LOOKUP_FIELDS.has(field)) {
    const err = new Error(`Unsupported external id field: ${field}`);
    err.code = 'SCRAP_INVALID_LOOKUP_FIELD';
    throw err;
  }
  const list = (codes || []).map((c) => String(c).trim()).filter(Boolean);
  if (!list.length) return [];

  const rows = await Event.find({ [field]: { $in: list } })
    .select(`${field} name`)
    .lean();

  return rows.map((e) => ({
    code: String(e[field]),
    eventId: String(e._id),
    name: e.name || '',
  }));
}

/**
 * @param {'stage'|'prod'} platform
 * @param {string} token
 * @param {string} field
 * @param {string[]} codes
 * @returns {Promise<{ code: string, eventId: string, name: string }[]>}
 */
async function lookupExternalIdsRemote(platform, token, field, codes) {
  const res = await scrapImportPlatformRequest(
    platform,
    token,
    'POST',
    '/scrap-events/lookup-external-ids',
    { field, codes }
  );
  if (!res.ok) {
    // Target may not have lookup yet — fall back to empty (treat as new)
    if (res.status === 404) {
      console.warn(`${LOG_PREFIX} lookup-external-ids not deployed on ${platform}; treating all as new`);
      return [];
    }
    const err = new Error(res.data?.error?.message || `Remote lookup failed (${res.status})`);
    err.code = res.data?.error?.code || 'SCRAP_REMOTE_LOOKUP_FAILED';
    throw err;
  }
  return Array.isArray(res.data?.existing) ? res.data.existing : [];
}

/**
 * @param {'stage'|'prod'} platform
 * @param {string} token
 * @param {Array<{ key: string, locationId?: string, venueName?: string, nameAliases?: string[], isoDate?: string, name?: string }>} items
 * @returns {Promise<Array<{ key: string, eventId: string, name: string }>>}
 */
async function lookupEventIdentitiesRemote(platform, token, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const res = await scrapImportPlatformRequest(
    platform,
    token,
    'POST',
    '/scrap-events/lookup-event-identities',
    { items: list }
  );
  if (!res.ok) {
    if (res.status === 404) {
      console.warn(
        `${LOG_PREFIX} lookup-event-identities not deployed on ${platform}; identity dedupe skipped`
      );
      return [];
    }
    const err = new Error(res.data?.error?.message || `Remote identity lookup failed (${res.status})`);
    err.code = res.data?.error?.code || 'SCRAP_REMOTE_IDENTITY_LOOKUP_FAILED';
    throw err;
  }
  return Array.isArray(res.data?.existing) ? res.data.existing : [];
}

/**
 * Stable partition/identity key for a listing row.
 * @param {string} venueKey
 * @param {object} row
 * @returns {string}
 */
function scrapRowIdentityKey(venueKey, row) {
  const code = extractExternalCode(row, venueKey, null);
  if (code) return code;
  const iso = String(row?.isoDate || '').trim();
  const name = String(row?.name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${iso}|${name}`;
}

/**
 * Build identity lookup items for listing rows still marked new after external-id split.
 * @param {string} venueKey
 * @param {object[]} rows
 * @returns {object[]}
 */
function buildIdentityLookupItems(venueKey, rows) {
  return (rows || [])
    .map((row) => {
      const locMeta = resolveTargetLocationMeta(venueKey, row, null);
      return {
        key: scrapRowIdentityKey(venueKey, row),
        venueName: locMeta.venueName,
        nameAliases: locMeta.nameAliases || [],
        isoDate: row?.isoDate,
        name: row?.name,
      };
    })
    .filter((item) => item.isoDate && item.name && item.key);
}

/**
 * @param {string} platform
 * @param {string|null} token
 * @param {string} venueKey
 * @param {string[]} codes
 * @param {object[]} [rows] - optional listing rows for identity enrich
 */
async function partitionAgainstPlatform(platform, token, venueKey, codes, rows = null) {
  const p = normalizeScrapImportPlatform(platform);
  const { field } = getVenueExternalMeta(venueKey);
  const list = (codes || []).map((c) => String(c).trim()).filter(Boolean);

  let existing;
  if (p === 'local') {
    existing = await lookupExternalIdsLocal(field, list);
  } else {
    if (!token) {
      const err = new Error(`Connect to ${p} before partitioning`);
      err.code = 'SCRAP_PLATFORM_TOKEN_REQUIRED';
      throw err;
    }
    existing = await lookupExternalIdsRemote(p, token, field, list);
  }

  const byCode = new Map(existing.map((e) => [e.code, e]));
  let newCodes = list.filter((c) => !byCode.has(c));
  let alreadyImportedCodes = list.filter((c) => byCode.has(c));
  let identityExisting = [];

  const rowList = Array.isArray(rows) ? rows : [];
  if (rowList.length) {
    const candidateRows = rowList.filter((row) => {
      const code = extractExternalCode(row, venueKey, null);
      return !code || !byCode.has(code);
    });
    const identityItems = buildIdentityLookupItems(venueKey, candidateRows);
    if (identityItems.length) {
      if (p === 'local') {
        identityExisting = await lookupEventIdentitiesLocal(identityItems);
      } else {
        identityExisting = await lookupEventIdentitiesRemote(p, token, identityItems);
      }
      identityExisting.forEach((hit) => {
        const matchingRow = candidateRows.find(
          (row) => scrapRowIdentityKey(venueKey, row) === hit.key
        );
        const code = matchingRow ? extractExternalCode(matchingRow, venueKey, null) : null;
        if (code && !byCode.has(code)) {
          byCode.set(code, { code, eventId: hit.eventId, name: hit.name });
          existing.push({ code, eventId: hit.eventId, name: hit.name });
        }
      });
      newCodes = list.filter((c) => !byCode.has(c));
      alreadyImportedCodes = list.filter((c) => byCode.has(c));
    }
  }

  return {
    field,
    existing,
    existingByCode: Object.fromEntries(byCode),
    identityExisting,
    newCodes,
    alreadyImportedCodes,
  };
}

/**
 * Build event seats from a location document + scraped inventory.
 * @param {object} location
 * @param {object[]} inventoryItems
 * @param {string} priceReason
 */
function buildSeatsFromLocationAndInventory(location, inventoryItems, priceReason) {
  const baseSeats = (location.seats || []).map((seat) => {
    const s = seat && typeof seat.toObject === 'function' ? seat.toObject() : { ...seat };
    const id = s._id;
    return {
      seat_id: id ? String(id) : id,
      code: s.code,
      label: s.label,
      category: s.category,
      section: s.section,
      capacity: s.capacity,
      min_spend: s.minSpendUSD,
      price_tier: s.priceTier,
      event_price: s.minSpendUSD,
      event_min_spend: s.minSpendUSD,
      status: 'available',
      map_anchor: s.mapAnchor,
      polygon: s.polygon,
      media: (s.media || []).map((m) =>
        m && typeof m.toObject === 'function' ? m.toObject() : { ...m }
      ),
      gxnItemCode: s.gxnItemCode,
      gxnMasterItemCode: s.gxnMasterItemCode,
    };
  });

  const units = (location.units || []).map((unit) => {
    const u = unit && typeof unit.toObject === 'function' ? unit.toObject() : { ...unit };
    return {
      unit_id: u._id ? String(u._id) : u._id,
      code: u.code,
      kind: u.kind,
      beds: u.beds,
      occupancy: u.occupancy,
      view: u.view,
      smoking: u.smoking,
      floor: u.floor,
      min_price: u.minPriceUSD,
      event_price: u.minPriceUSD,
      status: 'available',
      media: [],
    };
  });

  const { seats, warnings } = applyInventoryToSeats(baseSeats, inventoryItems || [], priceReason);
  assertScrapInventoryPricingApplied(seats, inventoryItems || [], priceReason, 'SCRAP_PRICING_NOT_APPLIED');

  return { seats, units, warnings };
}

/**
 * @param {string} imageUrl
 * @returns {Promise<{ buffer: Buffer, contentType: string, filename: string }|null>}
 */
async function downloadFlyerImage(imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 25 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const contentType = res.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
        ? 'webp'
        : 'jpg';
    return {
      buffer: Buffer.from(res.data),
      contentType,
      filename: `scrap-flyer.${ext}`,
    };
  } catch (err) {
    console.warn(`${LOG_PREFIX} flyer download failed:`, err.message || err);
    return null;
  }
}

/**
 * @param {'stage'|'prod'} platform
 * @param {string} token
 * @param {{ buffer: Buffer, contentType: string, filename: string }} file
 * @returns {Promise<object>}
 */
async function uploadFlyerToRemote(platform, token, file) {
  const form = new FormData();
  form.append('asset', file.buffer, {
    filename: file.filename,
    contentType: file.contentType,
  });
  const res = await scrapImportPlatformRequest(
    platform,
    token,
    'POST',
    '/events/media/upload',
    null,
    { formData: form, timeoutMs: 120000 }
  );
  if (!res.ok) {
    const err = new Error(res.data?.error?.message || `Media upload failed (${res.status})`);
    err.code = res.data?.error?.code || 'SCRAP_REMOTE_MEDIA_UPLOAD_FAILED';
    throw err;
  }
  return res.data?.data || res.data;
}

/**
 * @param {'stage'|'prod'} platform
 * @param {string} token
 * @param {string} venueName
 * @param {string[]} [aliases]
 * @returns {Promise<object>}
 */
async function findRemoteLocationByName(platform, token, venueName, aliases = []) {
  const candidates = [...new Set([venueName, ...(aliases || [])])]
    .map((n) => String(n || '').trim().toLowerCase())
    .filter(Boolean);
  if (!candidates.length) {
    const err = new Error('Missing venue name for location match');
    err.code = 'SCRAP_LOCATION_NAME_MISSING';
    throw err;
  }

  let page = 1;
  const limit = 100;
  let pages = 1;
  while (page <= pages && page <= 20) {
    const res = await scrapImportPlatformRequest(
      platform,
      token,
      'GET',
      `/locations?page=${page}&limit=${limit}`
    );
    if (!res.ok) {
      const err = new Error(res.data?.error?.message || `Locations list failed (${res.status})`);
      err.code = 'SCRAP_REMOTE_LOCATIONS_FAILED';
      throw err;
    }
    const rows = Array.isArray(res.data?.data) ? res.data.data : [];
    const match = rows.find((loc) =>
      candidates.includes(String(loc.name || '').trim().toLowerCase())
    );
    if (match) {
      const detail = await scrapImportPlatformRequest(
        platform,
        token,
        'GET',
        `/locations/${match._id || match.id}`
      );
      if (detail.ok && detail.data?.data) return detail.data.data;
      return match;
    }
    pages = res.data?.pagination?.pages || 1;
    page += 1;
  }

  const err = new Error(
    `Location not found on ${platform}: tried ${candidates.join(' | ')}`
  );
  err.code = 'SCRAP_REMOTE_LOCATION_NOT_FOUND';
  throw err;
}

/**
 * @param {object} prefill
 * @param {object} listingEvent
 * @param {string} venueKey
 * @param {object} location
 * @param {object[]} seats
 * @param {object[]} units
 * @param {object[]} media
 */
function buildEventCreatePayload(prefill, listingEvent, venueKey, location, seats, units, media) {
  const { field } = getVenueExternalMeta(venueKey);
  const externalCode = extractExternalCode(listingEvent, venueKey, prefill);
  const locationId = String(location._id || location.id);
  const type = prefill?.type || location.type || 'night_club';

  const payload = {
    name: (prefill?.name || listingEvent?.name || 'Event').trim(),
    description: prefill?.description || '',
    type,
    location_id: locationId,
    start_datetime: prefill?.start_datetime,
    timezone: prefill?.timezone || location.timezone || 'America/Los_Angeles',
    base_price: prefill?.base_price != null ? Number(prefill.base_price) : 0,
    currency: prefill?.currency || 'USD',
    price_tier: prefill?.price_tier != null ? Number(prefill.price_tier) : 1,
    policies: prefill?.policies || '',
    notes: prefill?.notes || '',
    media: Array.isArray(media) ? media : [],
    status: prefill?.status || 'active',
    seats,
    units,
  };

  if (externalCode) payload[field] = externalCode;
  return payload;
}

/**
 * Commit scraped prefill to local Mongo (same process DB).
 * @param {object} args
 */
async function commitImportLocal({ venueKey, listingEvent, prefill }) {
  const { field, priceReason } = getVenueExternalMeta(venueKey);
  const code = extractExternalCode(listingEvent, venueKey, prefill);
  if (code) {
    const existing = await Event.findOne({ [field]: code }).select('_id name').lean();
    if (existing) {
      return {
        alreadyImported: true,
        eventId: String(existing._id),
        eventName: existing.name,
        [field]: code,
        created: existing,
      };
    }
  }

  const locMeta = resolveTargetLocationMeta(venueKey, listingEvent, prefill);
  const location =
    (prefill?.location_id && (await Location.findById(prefill.location_id))) ||
    (await Location.findOne({
      name: {
        $in: locMeta.nameAliases.length ? locMeta.nameAliases : [locMeta.venueName],
      },
    })) ||
    (await Location.findOne({ name: new RegExp(`^${escapeRegex(locMeta.venueName)}$`, 'i') }));

  if (!location) {
    const err = new Error(`Local location not found: ${locMeta.venueName}`);
    err.code = 'SCRAP_LOCAL_LOCATION_NOT_FOUND';
    throw err;
  }

  const isoDate =
    listingEvent?.isoDate ||
    (typeof prefill?.start_datetime_local === 'string'
      ? prefill.start_datetime_local.slice(0, 10)
      : null) ||
    (typeof prefill?.start_datetime === 'string' ? prefill.start_datetime.slice(0, 10) : null);
  const eventName = prefill?.name || listingEvent?.name;
  const byIdentity = await findExistingEventByScrapIdentity({
    locationId: String(location._id),
    isoDate,
    name: eventName,
    timezone: prefill?.timezone || location.timezone,
  });
  if (byIdentity) {
    return {
      alreadyImported: true,
      eventId: String(byIdentity._id),
      eventName: byIdentity.name,
      [field]: code,
      created: byIdentity,
      matchReason: 'identity',
    };
  }

  const inventory = prefill?.scrapedInventory || [];
  const { seats, units, warnings } = buildSeatsFromLocationAndInventory(
    location,
    inventory,
    priceReason
  );

  let media = Array.isArray(prefill?.media) ? [...prefill.media] : [];
  // Local: keep external flyer URLs (same as prior behavior). Optional re-host skipped for local.

  const eventData = buildEventCreatePayload(
    prefill,
    listingEvent,
    venueKey,
    location,
    seats,
    units,
    media
  );

  const totalCapacity =
    seats.reduce((sum, s) => sum + (s.capacity || 0), 0) +
    units.reduce((sum, u) => sum + (u.occupancy || 0), 0);

  const event = await Event.create({
    ...eventData,
    total_capacity: totalCapacity,
    total_available: totalCapacity,
    total_booked: 0,
    total_revenue: 0,
    views: 0,
  });

  console.log(`${LOG_PREFIX} local create: ${event.name} (${event._id})`);

  return {
    alreadyImported: false,
    eventId: String(event._id),
    eventName: event.name,
    [field]: code,
    created: event.toObject ? event.toObject() : event,
    warnings,
  };
}

/**
 * Commit scraped prefill to Stage/Prod via remote API (remap location/seats, re-host flyer).
 * @param {object} args
 */
async function commitImportRemote({ platform, token, venueKey, listingEvent, prefill }) {
  const p = normalizeScrapImportPlatform(platform);
  if (p === 'local') {
    return commitImportLocal({ venueKey, listingEvent, prefill });
  }
  if (!token) {
    const err = new Error(`Connect to ${p} before committing`);
    err.code = 'SCRAP_PLATFORM_TOKEN_REQUIRED';
    throw err;
  }

  const { field, priceReason } = getVenueExternalMeta(venueKey);
  const code = extractExternalCode(listingEvent, venueKey, prefill);

  if (code) {
    const existing = await lookupExternalIdsRemote(p, token, field, [code]);
    if (existing.length) {
      return {
        alreadyImported: true,
        eventId: existing[0].eventId,
        eventName: existing[0].name,
        [field]: code,
        created: existing[0],
      };
    }
  }

  const locMeta = resolveTargetLocationMeta(venueKey, listingEvent, prefill);
  const location = await findRemoteLocationByName(
    p,
    token,
    locMeta.venueName,
    locMeta.nameAliases
  );

  const isoDate =
    listingEvent?.isoDate ||
    (typeof prefill?.start_datetime_local === 'string'
      ? prefill.start_datetime_local.slice(0, 10)
      : null) ||
    (typeof prefill?.start_datetime === 'string' ? prefill.start_datetime.slice(0, 10) : null);
  const eventName = prefill?.name || listingEvent?.name;
  const identityKey = code || `${isoDate || ''}|${eventName || ''}`;
  const identityHits = await lookupEventIdentitiesRemote(p, token, [
    {
      key: identityKey,
      locationId: String(location._id || location.id || ''),
      venueName: locMeta.venueName,
      nameAliases: locMeta.nameAliases,
      isoDate,
      name: eventName,
    },
  ]);
  if (identityHits.length) {
    return {
      alreadyImported: true,
      eventId: identityHits[0].eventId,
      eventName: identityHits[0].name,
      [field]: code,
      created: identityHits[0],
      matchReason: 'identity',
    };
  }

  const inventory = prefill?.scrapedInventory || [];
  if (!inventory.length) {
    const err = new Error('Prefill missing scrapedInventory for remote seat remap');
    err.code = 'SCRAP_MISSING_INVENTORY';
    throw err;
  }

  const { seats, units, warnings } = buildSeatsFromLocationAndInventory(
    location,
    inventory,
    priceReason
  );

  let media = Array.isArray(prefill?.media) ? [...prefill.media] : [];
  const flyerUrl = media[0]?.url;
  if (flyerUrl && !/the1-media-uploads/i.test(flyerUrl)) {
    const file = await downloadFlyerImage(flyerUrl);
    if (file) {
      const uploaded = await uploadFlyerToRemote(p, token, file);
      const url = uploaded?.url || uploaded?.data?.url;
      if (url) {
        media = [{ type: 'image', url, order: 0, ...(uploaded.width ? { width: uploaded.width } : {}) }];
      }
    }
  }

  const eventData = buildEventCreatePayload(
    { ...prefill, type: locMeta.type || prefill?.type },
    listingEvent,
    venueKey,
    location,
    seats,
    units,
    media
  );

  const res = await scrapImportPlatformRequest(p, token, 'POST', '/events', eventData);
  if (!res.ok) {
    const err = new Error(res.data?.error?.message || `Event create failed (${res.status})`);
    err.code = res.data?.error?.code || 'SCRAP_REMOTE_CREATE_FAILED';
    err.details = res.data?.error;
    throw err;
  }

  const created = res.data?.data || res.data;
  console.log(`${LOG_PREFIX} remote create on ${p}: ${created?.name || eventData.name}`);

  return {
    alreadyImported: false,
    eventId: String(created?._id || created?.id || ''),
    eventName: created?.name || eventData.name,
    [field]: code,
    created,
    warnings,
  };
}

/**
 * @param {object} args
 */
async function commitScrapImport({ platform, token, venueKey, listingEvent, prefill }) {
  const p = normalizeScrapImportPlatform(platform);
  if (p === 'local') {
    return commitImportLocal({ venueKey, listingEvent, prefill });
  }
  return commitImportRemote({ platform: p, token, venueKey, listingEvent, prefill });
}

module.exports = {
  VENUE_EXTERNAL_FIELDS,
  ALLOWED_LOOKUP_FIELDS,
  getVenueExternalMeta,
  resolveTargetLocationMeta,
  extractExternalCode,
  scrapRowIdentityKey,
  lookupExternalIdsLocal,
  lookupExternalIdsRemote,
  lookupEventIdentitiesRemote,
  buildIdentityLookupItems,
  partitionAgainstPlatform,
  commitScrapImport,
  buildSeatsFromLocationAndInventory,
};

/**
 * Scrap-import duplicate detection: external id + location/date/name identity.
 */
const Event = require('../../models/Event');
const Location = require('../../models/Location');
const { wallClockInVenueTzToUtcDate } = require('../../utils/venueTimezone');

const DEFAULT_SCRAP_IDENTITY_TZ = 'America/Los_Angeles';

/**
 * Normalize event name for identity matching.
 * @param {string|null|undefined} name
 * @returns {string}
 */
function normalizeScrapEventName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Escape a string for use inside a RegExp.
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * UTC bounds for a venue-local calendar day [start, end).
 * @param {string|null|undefined} isoDate - YYYY-MM-DD
 * @param {string|null|undefined} timezone - IANA
 * @returns {{ start: Date, end: Date }|null}
 */
function scrapEventDayBoundsUtc(isoDate, timezone) {
  const day = String(isoDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const tz =
    timezone && String(timezone).trim() ? String(timezone).trim() : DEFAULT_SCRAP_IDENTITY_TZ;

  const start = wallClockInVenueTzToUtcDate(`${day}T00:00`, tz);
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextIso = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  const end = wallClockInVenueTzToUtcDate(`${nextIso}T00:00`, tz);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }
  return { start, end };
}

/**
 * Find existing THE1 event by location + calendar date + normalized name.
 * @param {{ locationId: string, isoDate?: string, name?: string, timezone?: string }} args
 * @returns {Promise<{ _id: *, name: string }|null>}
 */
async function findExistingEventByScrapIdentity(args) {
  const locationId = args?.locationId ? String(args.locationId).trim() : '';
  const targetName = normalizeScrapEventName(args?.name);
  const bounds = scrapEventDayBoundsUtc(args?.isoDate, args?.timezone);
  if (!locationId || !targetName || !bounds) return null;

  const candidates = await Event.find({
    location_id: locationId,
    start_datetime: { $gte: bounds.start, $lt: bounds.end },
  })
    .select('_id name')
    .lean();

  return (
    candidates.find((ev) => normalizeScrapEventName(ev.name) === targetName) || null
  );
}

/**
 * External-id then identity lookup (local Mongo).
 * @param {{
 *   externalField?: string,
 *   externalCode?: string|null,
 *   locationId?: string|null,
 *   isoDate?: string|null,
 *   name?: string|null,
 *   timezone?: string|null,
 * }} args
 * @returns {Promise<{ _id: *, name: string, matchReason: 'external_id'|'identity' }|null>}
 */
async function findAlreadyImportedForScrap(args) {
  const field = args?.externalField ? String(args.externalField).trim() : '';
  const code = args?.externalCode != null ? String(args.externalCode).trim() : '';

  if (field && code) {
    const byCode = await Event.findOne({ [field]: code }).select('_id name').lean();
    if (byCode) {
      return { ...byCode, matchReason: 'external_id' };
    }
  }

  const byIdentity = await findExistingEventByScrapIdentity({
    locationId: args?.locationId,
    isoDate: args?.isoDate,
    name: args?.name,
    timezone: args?.timezone,
  });
  if (byIdentity) {
    return { ...byIdentity, matchReason: 'identity' };
  }
  return null;
}

/**
 * Resolve location id from explicit id or venue name / aliases.
 * @param {{ locationId?: string, venueName?: string, nameAliases?: string[] }} item
 * @returns {Promise<string|null>}
 */
async function resolveLocationIdForIdentityItem(item) {
  if (item?.locationId) return String(item.locationId).trim() || null;
  const names = [];
  if (item?.venueName) names.push(String(item.venueName).trim());
  if (Array.isArray(item?.nameAliases)) {
    item.nameAliases.forEach((n) => {
      const s = String(n || '').trim();
      if (s) names.push(s);
    });
  }
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return null;

  const byExact = await Location.findOne({ name: { $in: unique } }).select('_id').lean();
  if (byExact) return String(byExact._id);

  for (const n of unique) {
    const loc = await Location.findOne({
      name: new RegExp(`^${escapeRegex(n)}$`, 'i'),
    })
      .select('_id')
      .lean();
    if (loc) return String(loc._id);
  }
  return null;
}

/**
 * Batch identity lookup (local Mongo).
 * @param {Array<{ key: string, locationId?: string, venueName?: string, nameAliases?: string[], isoDate?: string, name?: string, timezone?: string }>} items
 * @returns {Promise<Array<{ key: string, eventId: string, name: string }>>}
 */
async function lookupEventIdentitiesLocal(items) {
  const list = Array.isArray(items) ? items : [];
  const existing = [];
  for (const item of list) {
    const key = item?.key != null ? String(item.key) : '';
    if (!key) continue;
    const locationId = await resolveLocationIdForIdentityItem(item);
    if (!locationId) continue;
    const found = await findExistingEventByScrapIdentity({
      locationId,
      isoDate: item.isoDate,
      name: item.name,
      timezone: item.timezone,
    });
    if (found) {
      existing.push({
        key,
        eventId: String(found._id),
        name: found.name || '',
      });
    }
  }
  return existing;
}

/**
 * After code-based partition, move identity duplicates from new → alreadyImported.
 * @param {object[]} newEvents
 * @param {object[]} alreadyImported
 * @param {(row: object) => string|null|Promise<string|null>} resolveLocationId
 * @param {{ timezone?: string }} [options]
 * @returns {Promise<{ newEvents: object[], alreadyImported: object[] }>}
 */
async function enrichPartitionWithIdentityDedupe(
  newEvents,
  alreadyImported,
  resolveLocationId,
  options = {}
) {
  const timezone = options.timezone || DEFAULT_SCRAP_IDENTITY_TZ;
  const stillNew = [];
  const extraImported = [];

  for (const row of newEvents || []) {
    let locationId = null;
    try {
      locationId = await resolveLocationId(row);
    } catch (_) {
      locationId = null;
    }
    if (!locationId || !row?.isoDate || !row?.name) {
      stillNew.push(row);
      continue;
    }
    const found = await findExistingEventByScrapIdentity({
      locationId,
      isoDate: row.isoDate,
      name: row.name,
      timezone,
    });
    if (found) {
      extraImported.push({
        ...row,
        alreadyImported: true,
        the1EventId: String(found._id),
        the1EventName: found.name,
      });
    } else {
      stillNew.push(row);
    }
  }

  const mergedImported = [...(alreadyImported || []), ...extraImported];
  return { newEvents: stillNew, alreadyImported: mergedImported };
}

module.exports = {
  DEFAULT_SCRAP_IDENTITY_TZ,
  normalizeScrapEventName,
  escapeRegex,
  scrapEventDayBoundsUtc,
  findExistingEventByScrapIdentity,
  findAlreadyImportedForScrap,
  resolveLocationIdForIdentityItem,
  lookupEventIdentitiesLocal,
  enrichPartitionWithIdentityDedupe,
};

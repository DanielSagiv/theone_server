/**
 * Resolve venue IANA timezone from Location document or loose fields.
 */

/** @type {Record<string, string>} */
const CITY_TO_IANA = {
  'las vegas': 'America/Los_Angeles',
  lv: 'America/Los_Angeles',
  miami: 'America/New_York',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  london: 'Europe/London',
  paris: 'Europe/Paris',
};

/**
 * @param {string|null|undefined} city
 * @returns {string|null}
 */
function resolveIanaFromCity(city) {
  if (!city || typeof city !== 'string') {
    return null;
  }
  const key = city.trim().toLowerCase().split(',')[0].trim();
  return CITY_TO_IANA[key] || null;
}

/**
 * @param {object|null|undefined} locationOrFields
 * @param {string} [locationOrFields.timezone]
 * @param {{ city?: string }} [locationOrFields.address]
 * @returns {string}
 */
function resolveVenueTimezone(locationOrFields) {
  if (!locationOrFields || typeof locationOrFields !== 'object') {
    return 'UTC';
  }
  const direct = locationOrFields.timezone;
  if (direct && String(direct).trim() && String(direct).trim() !== 'UTC') {
    return String(direct).trim();
  }
  const fromCity = resolveIanaFromCity(locationOrFields.address?.city);
  if (fromCity) {
    return fromCity;
  }
  if (direct && String(direct).trim()) {
    return String(direct).trim();
  }
  return 'UTC';
}

/**
 * Interpret datetime-local wall clock in venue TZ as UTC Date.
 * @param {string} localValue - YYYY-MM-DDTHH:mm
 * @param {string} timeZone - IANA
 * @returns {Date}
 */
function wallClockInVenueTzToUtcDate(localValue, timeZone) {
  if (!localValue) {
    return new Date();
  }
  const tz = timeZone && String(timeZone).trim() ? String(timeZone).trim() : 'UTC';
  const [datePart, timePart] = localValue.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);

  if (tz === 'UTC') {
    return new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  }

  let candidate = Date.UTC(y, m - 1, d, hh, mm, 0);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidate))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, parseInt(p.value, 10)])
    );
    if (
      parts.year === y &&
      parts.month === m &&
      parts.day === d &&
      parts.hour === hh &&
      parts.minute === mm
    ) {
      return new Date(candidate);
    }
    const diffMinutes =
      (y - parts.year) * 525600 +
      (m - parts.month) * 43200 +
      (d - parts.day) * 1440 +
      (hh - parts.hour) * 60 +
      (mm - parts.minute);
    candidate += diffMinutes * 60 * 1000;
  }
  return new Date(candidate);
}

module.exports = {
  CITY_TO_IANA,
  resolveIanaFromCity,
  resolveVenueTimezone,
  wallClockInVenueTzToUtcDate,
};

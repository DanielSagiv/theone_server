/**
 * Calendar-date-only helpers for COE trip windows (no meaningful clock time).
 * Stored as noon UTC so the calendar day is stable across viewer timezones.
 */

const NOON_UTC_SUFFIX = 'T12:00:00.000Z';
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Extract YYYY-MM-DD from a Date using UTC calendar parts.
 * @param {Date} date
 * @returns {string|null}
 */
function formatCalendarDateYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse trip calendar input to noon UTC Date.
 * Accepts YYYY-MM-DD, ISO strings (uses date part only), or Date.
 * @param {string|Date|null|undefined} input
 * @returns {Date|null}
 */
function parseCalendarDateInput(input) {
  if (input == null || input === '') {
    return null;
  }

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      return null;
    }
    const ymd = formatCalendarDateYmd(input);
    return ymd ? new Date(`${ymd}${NOON_UTC_SUFFIX}`) : null;
  }

  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const datePart = trimmed.includes('T') ? trimmed.split('T')[0] : trimmed;
  const match = datePart.match(YMD_RE);
  if (!match) {
    const fallback = new Date(trimmed);
    if (Number.isNaN(fallback.getTime())) {
      return null;
    }
    const ymd = formatCalendarDateYmd(fallback);
    return ymd ? new Date(`${ymd}${NOON_UTC_SUFFIX}`) : null;
  }

  const [, y, m, d] = match;
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(`${y}-${m}-${d}${NOON_UTC_SUFFIX}`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  if (
    parsed.getUTCFullYear() !== Number(y) ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/**
 * Normalize COE start/end pair; end defaults to start when missing.
 * @param {string|Date|null|undefined} startInput
 * @param {string|Date|null|undefined} endInput
 * @returns {{ startDate: Date, endDate: Date }}
 * @throws {Error} When start is invalid or end precedes start
 */
function normalizeCoeDatePair(startInput, endInput) {
  const startDate = parseCalendarDateInput(startInput);
  if (!startDate) {
    throw new Error('Invalid start date');
  }

  let endDate = endInput != null && endInput !== ''
    ? parseCalendarDateInput(endInput)
    : startDate;
  if (!endDate) {
    throw new Error('Invalid end date');
  }

  if (endDate.getTime() < startDate.getTime()) {
    throw new Error('Start date must be before or equal to end date');
  }

  return { startDate, endDate };
}

/**
 * Sync original_request_data.requested_dates with top-level COE dates.
 * @param {object|null|undefined} originalRequestData
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {object}
 */
function syncRequestedDates(originalRequestData, startDate, endDate) {
  const base =
    originalRequestData && typeof originalRequestData === 'object'
      ? { ...originalRequestData }
      : {};
  return {
    ...base,
    requested_dates: {
      ...(base.requested_dates && typeof base.requested_dates === 'object'
        ? base.requested_dates
        : {}),
      start_date: startDate,
      end_date: endDate,
    },
  };
}

/**
 * Normalize top-level COE dates and sync requested_dates on a payload.
 * @param {object} payload
 * @param {{ start_date?: Date|string, end_date?: Date|string }} [existing] - for partial updates
 * @returns {object}
 */
function applyCoeCalendarDates(payload, existing = {}) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const out = { ...payload };
  const hasStart = out.start_date != null && out.start_date !== '';
  const hasEnd = out.end_date != null && out.end_date !== '';
  if (!hasStart && !hasEnd) {
    return out;
  }
  const startInput = hasStart ? out.start_date : existing.start_date;
  const endInput = hasEnd ? out.end_date : existing.end_date;
  const { startDate, endDate } = normalizeCoeDatePair(startInput, endInput);
  out.start_date = startDate;
  out.end_date = endDate;
  out.original_request_data = syncRequestedDates(
    out.original_request_data,
    startDate,
    endDate,
  );
  return out;
}

module.exports = {
  NOON_UTC_SUFFIX,
  formatCalendarDateYmd,
  parseCalendarDateInput,
  normalizeCoeDatePair,
  syncRequestedDates,
  applyCoeCalendarDates,
};

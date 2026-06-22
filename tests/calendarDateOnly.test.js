/**
 * Calendar-date-only COE helpers.
 * Run: node tests/calendarDateOnly.test.js
 */
const assert = require('assert');
const {
  formatCalendarDateYmd,
  parseCalendarDateInput,
  normalizeCoeDatePair,
  syncRequestedDates,
  applyCoeCalendarDates,
} = require('../utils/calendarDateOnly');

function testParseYmd() {
  const d = parseCalendarDateInput('2025-06-19');
  assert.strictEqual(d.toISOString(), '2025-06-19T12:00:00.000Z');
}

function testParseIsoUsesDatePartOnly() {
  const d = parseCalendarDateInput('2025-06-19T00:00:00.000Z');
  assert.strictEqual(d.toISOString(), '2025-06-19T12:00:00.000Z');
}

function testParseMidnightUtcDoesNotShiftDay() {
  const d = parseCalendarDateInput('2025-06-19T00:00:00.000Z');
  assert.strictEqual(formatCalendarDateYmd(d), '2025-06-19');
}

function testFormatYmdFromDate() {
  const d = new Date('2025-06-21T12:00:00.000Z');
  assert.strictEqual(formatCalendarDateYmd(d), '2025-06-21');
}

function testNormalizePair() {
  const { startDate, endDate } = normalizeCoeDatePair('2025-06-19', '2025-06-21');
  assert.strictEqual(startDate.toISOString(), '2025-06-19T12:00:00.000Z');
  assert.strictEqual(endDate.toISOString(), '2025-06-21T12:00:00.000Z');
}

function testNormalizePairEndDefaultsToStart() {
  const { startDate, endDate } = normalizeCoeDatePair('2025-06-19', null);
  assert.strictEqual(startDate.toISOString(), endDate.toISOString());
}

function testNormalizePairRejectsInvalidRange() {
  assert.throws(
    () => normalizeCoeDatePair('2025-06-21', '2025-06-19'),
    /Start date must be before or equal to end date/,
  );
}

function testSyncRequestedDates() {
  const start = parseCalendarDateInput('2025-06-19');
  const end = parseCalendarDateInput('2025-06-21');
  const merged = syncRequestedDates({ city: 'Las Vegas' }, start, end);
  assert.strictEqual(merged.city, 'Las Vegas');
  assert.strictEqual(merged.requested_dates.start_date.toISOString(), start.toISOString());
  assert.strictEqual(merged.requested_dates.end_date.toISOString(), end.toISOString());
}

function testApplyCoeCalendarDates() {
  const out = applyCoeCalendarDates({
    start_date: '2025-06-19T00:00:00.000Z',
    end_date: '2025-06-21',
    original_request_data: { city: 'Las Vegas' },
  });
  assert.strictEqual(out.start_date.toISOString(), '2025-06-19T12:00:00.000Z');
  assert.strictEqual(out.end_date.toISOString(), '2025-06-21T12:00:00.000Z');
  assert.strictEqual(
    out.original_request_data.requested_dates.start_date.toISOString(),
    '2025-06-19T12:00:00.000Z',
  );
}

function run() {
  testParseYmd();
  testParseIsoUsesDatePartOnly();
  testParseMidnightUtcDoesNotShiftDay();
  testFormatYmdFromDate();
  testNormalizePair();
  testNormalizePairEndDefaultsToStart();
  testNormalizePairRejectsInvalidRange();
  testSyncRequestedDates();
  testApplyCoeCalendarDates();
  console.log('calendarDateOnly.test.js: all passed');
}

run();

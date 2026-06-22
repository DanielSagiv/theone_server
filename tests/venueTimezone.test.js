/**
 * Venue timezone helpers.
 * Run: node tests/venueTimezone.test.js
 */
const assert = require('assert');
const {
  resolveVenueTimezone,
  wallClockInVenueTzToUtcDate,
} = require('../utils/venueTimezone');

function testCityFallback() {
  const tz = resolveVenueTimezone({
    address: { city: 'Las Vegas' },
  });
  assert.strictEqual(tz, 'America/Los_Angeles');
}

function testWallClockVegas() {
  const d = wallClockInVenueTzToUtcDate(
    '2026-06-24T22:30',
    'America/Los_Angeles',
  );
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  assert.strictEqual(parts, '10:30 PM');
}

function run() {
  testCityFallback();
  testWallClockVegas();
  console.log('venueTimezone.test.js: all passed');
}

run();

/**
 * Debug script: reproduces COE creation flow with manual event selection
 * using the exact request data from the "Unable to Create Experience" scenario.
 * Run from server dir: node scripts/debug-coe-seat-selection.js
 * Writes NDJSON to .cursor/debug-5f9384.log for analysis.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'debug-coe-seat-selection-5f9384.log');
const SESSION_ID = '5f9384';

function writeLog(data) {
  const line = JSON.stringify({ sessionId: SESSION_ID, ...data, timestamp: Date.now() }) + '\n';
  try { fs.appendFileSync(LOG_PATH, line); } catch (_) {}
}

async function main() {
  const mongoUri = process.env.DB_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Missing DB_URI or MONGODB_URI');
    process.exit(1);
  }

  writeLog({ location: 'debug-coe-seat-selection.js:start', message: 'Script started', data: { eventId: '69a832181c9786d0302171ba', preferredCategory: 'upper_dance', budget: 10000, party_size: 5 } });

  await mongoose.connect(mongoUri);

  const Event = require('../models/Event');
  const { selectSeatsByBudgetAndCapacity } = require('../services/botAutoFillService');

  const eventId = '69a832181c9786d0302171ba';
  const event = await Event.findById(eventId).populate('location_id', 'seats');

  if (!event) {
    writeLog({ location: 'debug-coe-seat-selection.js:fetch', message: 'Event not found', data: { eventId } });
    console.error('Event not found:', eventId);
    await mongoose.connection.close();
    process.exit(1);
  }

  const eventSeatsCount = event.seats?.length || 0;
  const categories = [...new Set((event.seats || []).map(s => s.category || 'General'))];
  const upperDanceSeats = (event.seats || []).filter(s => (s.category || 'General') === 'upper_dance');
  const availableUpperDance = upperDanceSeats.filter(s => s.status === 'available');
  const locationSeatsCount = event.location_id?.seats?.length ?? 0;

  writeLog({
    location: 'debug-coe-seat-selection.js:event',
    message: 'Event loaded',
    data: {
      eventId: event._id?.toString(),
      eventName: event.name,
      eventSeatsCount,
      locationSeatsCount,
      categories,
      upperDanceSeatsCount: upperDanceSeats.length,
      availableUpperDanceCount: availableUpperDance.length,
      upperDancePrices: availableUpperDance.slice(0, 5).map(s => ({ code: s.code, capacity: s.capacity, event_price: s.event_price || s.min_spend }))
    },
    hypothesisId: 'H3'
  });

  const preferences = {
    city: 'Las Vegas',
    budget_range: { max: 10000 },
    party_size: 5,
    seat_preferences: 'This and that',
    specific_preferences: 'We are celebrating a graduation'
  };

  writeLog({
    location: 'debug-coe-seat-selection.js:prefs',
    message: 'Preferences passed to selectSeatsByBudgetAndCapacity',
    data: { preferences, budgetArg: 10000, preferredCategory: 'upper_dance' },
    hypothesisId: 'H1'
  });

  const result = await selectSeatsByBudgetAndCapacity(event, preferences, 10000, 'upper_dance');
  const seats = Array.isArray(result) ? result : (result.seats || []);
  const diagnostics = Array.isArray(result) ? null : (result.diagnostics || null);

  writeLog({
    location: 'debug-coe-seat-selection.js:result',
    message: 'selectSeatsByBudgetAndCapacity result',
    data: {
      seatsCount: seats.length,
      primary_reason: diagnostics?.primary_reason ?? null,
      filtering_stages: diagnostics?.filtering_stages ?? null,
      details: diagnostics?.details ?? null
    },
    hypothesisId: 'H1,H2,H3,H4,H5'
  });

  console.log('Event seats:', eventSeatsCount, '| Categories:', categories.join(', '));
  console.log('Upper_dance seats:', upperDanceSeats.length, 'available:', availableUpperDance.length);
  console.log('Result seats:', seats.length);
  if (diagnostics) {
    console.log('Primary reason:', diagnostics.primary_reason);
    console.log('Filtering stages:', JSON.stringify(diagnostics.filtering_stages, null, 2));
    if (diagnostics.details) console.log('Details:', JSON.stringify(diagnostics.details, null, 2));
  }

  await mongoose.connection.close();
  console.log('Logs written to', LOG_PATH);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  writeLog({ location: 'debug-coe-seat-selection.js:error', message: 'Script error', data: { error: e.message, stack: e.stack } });
  process.exit(1);
});

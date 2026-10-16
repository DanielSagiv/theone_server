/**
 * ONE-OFF: Reprice Guy Flechter's Oct 8–13 2026 THE1 proposal on prod to total 20175.
 * Changes negotiated seat prices only. Does not touch other COEs or platform pricing.
 *
 * Usage (from server/):
 *   node scripts/oneOffGuyFlechterOct2026Total20175.js
 *   node scripts/oneOffGuyFlechterOct2026Total20175.js --confirm-prod
 */

require('dotenv').config();
const mongoose = require('mongoose');
const COE = require('../models/COE');
const { applyPricingFromSelectedSeats } = require('../services/coeService');

const LOG = '[oneOffGuyFlechterOct2026Total20175]';
const COE_ID = '6acc41aad6f549feee84765f';
const HOST_ID = '6ac60546d6f549feee843aa0';
const CLIENT_ID = '6a4d2c2c6565357965234207';
const THE1_FEE_PERCENT = 13.5;
const EXPECTED_TOTAL = 20175;

/** event_id -> negotiated price */
const PRICE_BY_EVENT = {
  '6ac1f3460e977a86ff1ea27c': 2147, // Max Styler, LIV, Stage
  '6ac752ccd6f549feee8458b5': 2142, // Beltran, LIV Beach, Stage Cabana
  '6ac1f3af0e977a86ff1ea34c': 2142, // Dom Dolla, LIV, DJ Table Backstage
  '6abeb13d0e977a86ff1e9248': 2139, // Kygo, Palm Tree Beach Club, Dj Hideaway
  '6abeb3690e977a86ff1e9469': 2142, // DJ Pauly D, OMNIA, Main Room Dance Floor
  '6ac1f4900e977a86ff1ea50b': 2142, // Prospa, LIV, Stage
};

const EXPECTED_SEAT = {
  '6ac1f3460e977a86ff1ea27c': 'Stage',
  '6ac752ccd6f549feee8458b5': 'Stage Cabana',
  '6ac1f3af0e977a86ff1ea34c': 'DJ Table Backstage',
  '6abeb13d0e977a86ff1e9248': 'Dj Hideaway',
  '6abeb3690e977a86ff1e9469': 'Main Room Dance Floor',
  '6ac1f4900e977a86ff1ea50b': 'Stage',
};

/**
 * @returns {string}
 */
function resolveProdMongoUri() {
  const explicit = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) return explicit;
  const stageish =
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    process.env.STAGE_MONGODB_URI ||
    process.env.STAGE_DB_URI ||
    null;
  if (!stageish) {
    throw new Error('Set PROD_MONGODB_URI or DB_URI with /the1-stage to derive the1-PROD');
  }
  if (!/\/the1-stage(\?|$)/i.test(stageish)) {
    throw new Error(
      'Cannot derive prod URI: stage URI must contain /the1-stage, or set PROD_MONGODB_URI'
    );
  }
  return stageish.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function idString(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value._id != null) return String(value._id);
  return String(value);
}

/**
 * @param {object} coe
 */
function assertTargetCoe(coe) {
  if (!coe) throw new Error(`COE ${COE_ID} not found`);
  if (!String(coe.name || '').includes('Guy Flechter')) {
    throw new Error(`Refusing COE name "${coe.name}"`);
  }
  if (idString(coe.client_id) !== CLIENT_ID) {
    throw new Error(`Refusing client ${idString(coe.client_id)}`);
  }
  if (idString(coe.the1_experience_host_id) !== HOST_ID) {
    throw new Error(`Refusing host ${idString(coe.the1_experience_host_id)}`);
  }
  if (coe.status !== 'approved' || coe.payment_status !== 'unpaid') {
    throw new Error(`Refusing status ${coe.status} / ${coe.payment_status}`);
  }
  if (coe.is_the1_experience_host === true) {
    throw new Error('Refusing THE1 host document');
  }
  const seats = Array.isArray(coe.selected_seats) ? coe.selected_seats : [];
  if (seats.length !== 6) {
    throw new Error(`Expected 6 seats, found ${seats.length}`);
  }
  const seen = new Set();
  for (const seat of seats) {
    const eventId = idString(seat.event_id);
    if (!Object.prototype.hasOwnProperty.call(PRICE_BY_EVENT, eventId)) {
      throw new Error(`Unexpected event ${eventId}`);
    }
    if (seen.has(eventId)) throw new Error(`Duplicate event ${eventId}`);
    seen.add(eventId);
    if (seat.seat_code !== EXPECTED_SEAT[eventId]) {
      throw new Error(`Seat code mismatch for ${eventId}: ${seat.seat_code}`);
    }
    if (seat.is_simple_joint !== true) {
      throw new Error(`Seat ${eventId} is not a simple joint`);
    }
    if (Number(seat.the1_fee_percent) !== THE1_FEE_PERCENT) {
      throw new Error(`Fee percent for ${eventId} is ${seat.the1_fee_percent}`);
    }
  }
  if (seen.size !== 6) throw new Error('Missing expected events');
}

/**
 * @param {object} coe
 */
function applyNegotiatedPrices(coe) {
  for (const seat of coe.selected_seats) {
    const eventId = idString(seat.event_id);
    const price = PRICE_BY_EVENT[eventId];
    seat.event_price = price;
    seat.base_price = price;
    seat.negotiated_min_spend_usd = price;
  }
  coe.markModified('selected_seats');
}

/**
 * @param {object} coe
 */
function assertTotals(coe) {
  const fb = coe.fee_breakdown || {};
  const checks = [
    ['subtotal', coe.subtotal, 12854],
    ['taxes', coe.taxes, 1227.24],
    ['fees', coe.fees, 6093.76],
    ['total', coe.total, EXPECTED_TOTAL],
    ['gratuity_total', fb.gratuity_total, 1970.91],
    ['venue_admin_fee_total', fb.venue_admin_fee_total, 1799.56],
    ['sales_tax_total', fb.sales_tax_total, 1227.24],
    ['the1_fee_total', fb.the1_fee_total, 1735.29],
    ['processing_fee_total', fb.processing_fee_total, 588],
  ];
  const mismatches = checks.filter(([, actual, expected]) => actual !== expected);
  if (mismatches.length) {
    throw new Error(
      `Totals mismatch: ${mismatches
        .map(([name, actual, expected]) => `${name}=${actual} expected ${expected}`)
        .join('; ')}`
    );
  }
}

async function main() {
  const confirmProd = process.argv.slice(2).includes('--confirm-prod');
  const uri = resolveProdMongoUri();
  const dbName = (String(uri).match(/\/([^/?]+)(\?|$)/) || [])[1] || '';
  if (dbName !== 'the1-PROD') {
    throw new Error(`Refusing database "${dbName}"`);
  }

  await mongoose.connect(uri);
  const coe = await COE.findById(COE_ID);
  assertTargetCoe(coe);

  const before = {
    total: coe.total,
    subtotal: coe.subtotal,
    prices: coe.selected_seats.map(seat => ({
      event_id: idString(seat.event_id),
      seat_code: seat.seat_code,
      event_price: seat.event_price,
    })),
  };

  applyNegotiatedPrices(coe);
  await applyPricingFromSelectedSeats(coe);
  assertTotals(coe);
  coe.deposit_required = EXPECTED_TOTAL;

  console.log(LOG, {
    confirmProd,
    before,
    after: {
      subtotal: coe.subtotal,
      taxes: coe.taxes,
      fees: coe.fees,
      total: coe.total,
      deposit_required: coe.deposit_required,
      deposit_percent: coe.deposit_percent,
      fee_breakdown: coe.fee_breakdown,
      catalog_total: coe.catalog_total,
      prices: coe.selected_seats.map(seat => ({
        event_id: idString(seat.event_id),
        seat_code: seat.seat_code,
        event_price: seat.event_price,
        the1_fee_percent: seat.the1_fee_percent,
        simple_joint_original_price: seat.simple_joint_original_price,
      })),
    },
  });

  if (!confirmProd) {
    console.log(LOG, 'dry run — not saved. Re-run with --confirm-prod');
    await mongoose.disconnect();
    return;
  }

  await coe.save();
  const saved = await COE.findById(COE_ID).lean();
  if (!saved || saved.total !== EXPECTED_TOTAL) {
    throw new Error(`Save check failed, total=${saved && saved.total}`);
  }
  console.log(LOG, 'saved', { id: COE_ID, total: saved.total });
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error(LOG, err.message);
  try {
    await mongoose.disconnect();
  } catch (_e) {
    /* ignore */
  }
  process.exit(1);
});

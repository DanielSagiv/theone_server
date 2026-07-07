/**
 * Venue-based COE pricing (MS → VF → ST on MS+VF → fees per venue).
 * Run: node tests/computePricingTotalsFromSelectedSeats.test.js
 */
const assert = require('assert');
const {
  computePricingTotalsFromVenueGroups,
  computeVenuePricingTotals,
  buildVenueGroupsFromSelectedSeats,
  getCatalogBaseForSeat,
  getNegotiatedBaseForSeat,
  resolveThe1FeePercentForSeat,
  getCoeTaxRate,
} = require('../services/coeService');

const LOC_A = {
  _id: 'loc_a',
  adminFeePercent: 14,
  salesTaxPercent: 8.38,
  gratuityPercent: 15,
};

const LOC_B = {
  _id: 'loc_b',
  adminFeePercent: 10,
  salesTaxPercent: 8,
  gratuityPercent: 15,
};

const ENCORE_BEACH = {
  _id: 'encore_beach',
  adminFeePercent: 15,
  gratuityPercent: 15,
  salesTaxPercent: 8.375,
};

function testSingleVenueExample() {
  const the1FeeSum = 3000 * 0.25;
  const r = computePricingTotalsFromVenueGroups([
    { ms: 3000, location: LOC_A, the1FeeSum },
  ]);

  assert.strictEqual(r.subtotal, 3000);
  assert.strictEqual(r.fee_breakdown.venue_admin_fee_total, 420);
  assert.strictEqual(r.fee_breakdown.sales_tax_total, 286.6);
  assert.strictEqual(r.fee_breakdown.gratuity_total, 450);
  assert.strictEqual(r.fee_breakdown.the1_fee_total, 750);
  assert.strictEqual(r.fee_breakdown.processing_fee_total, 147.2);
  assert.strictEqual(r.taxes, 286.6);
  assert.strictEqual(r.fees, 1767.2);
  assert.strictEqual(r.total, 5053.8);
}

function testMultiVenueSum() {
  const r = computePricingTotalsFromVenueGroups([
    {
      ms: 2000,
      location: LOC_B,
      the1FeeSum: 2000 * 0.2,
    },
    {
      ms: 1000,
      location: LOC_A,
      the1FeeSum: 1000 * 0.25,
    },
  ]);

  assert.strictEqual(r.subtotal, 3000);
  assert.strictEqual(r.fee_breakdown.venue_admin_fee_total, 340);
  assert.strictEqual(r.fee_breakdown.sales_tax_total, 271.53);
  assert.strictEqual(r.fee_breakdown.gratuity_total, 450);
  assert.strictEqual(r.fee_breakdown.the1_fee_total, 650);
  assert.strictEqual(r.fee_breakdown.processing_fee_total, 141.35);
  assert.strictEqual(r.total, 4852.88);
}

function testMixedThe1PercentSameVenue() {
  const eventId = 'evt1';
  const eventMap = new Map([[eventId, { location_id: LOC_A }]]);
  const seats = [
    { event_id: eventId, event_price: 2000, the1_fee_percent: 20 },
    { event_id: eventId, event_price: 1000, the1_fee_percent: 25 },
  ];
  const groups = buildVenueGroupsFromSelectedSeats(
    seats,
    eventMap,
    getNegotiatedBaseForSeat,
  );

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].ms, 3000);
  assert.strictEqual(groups[0].the1FeeSum, 650);

  const r = computePricingTotalsFromVenueGroups(groups);
  assert.strictEqual(r.fee_breakdown.the1_fee_total, 650);
}

function testNoLocationFallback() {
  const prev = process.env.COE_TAX_RATE;
  delete process.env.COE_TAX_RATE;

  try {
    const rate = getCoeTaxRate();
    assert.strictEqual(rate, 0.3);

    const r = computePricingTotalsFromVenueGroups([
      { ms: 1000, location: null, the1FeeSum: 200 },
    ]);

    assert.strictEqual(r.subtotal, 1000);
    assert.strictEqual(r.taxes, 300);
    assert.strictEqual(r.fee_breakdown.venue_admin_fee_total, 0);
    assert.strictEqual(r.fee_breakdown.gratuity_total, 0);
    assert.strictEqual(r.fee_breakdown.the1_fee_total, 200);
    assert.strictEqual(r.fee_breakdown.processing_fee_total, 45);
    assert.strictEqual(r.total, 1545);
  } finally {
    if (prev !== undefined) {
      process.env.COE_TAX_RATE = prev;
    } else {
      delete process.env.COE_TAX_RATE;
    }
  }
}

function testCatalogBaseGrouping() {
  const eventId = 'evt1';
  const eventMap = new Map([[eventId, { location_id: LOC_A }]]);
  const seats = [
    {
      event_id: eventId,
      event_price: 3000,
      venue_catalog_price: 4000,
      the1_fee_percent: 25,
    },
  ];
  const groups = buildVenueGroupsFromSelectedSeats(
    seats,
    eventMap,
    getCatalogBaseForSeat,
  );

  assert.strictEqual(groups[0].ms, 4000);
  assert.strictEqual(groups[0].the1FeeSum, 1000);

  const r = computePricingTotalsFromVenueGroups(groups);
  assert.strictEqual(r.subtotal, 4000);
  assert.strictEqual(r.fee_breakdown.venue_admin_fee_total, 560);
  assert.strictEqual(r.fee_breakdown.sales_tax_total, 382.13);
  assert.strictEqual(r.fee_breakdown.processing_fee_total, 196.26);
  assert.strictEqual(r.total, 6738.39);
}

function testEncoreBeachEightThousandMinSpend() {
  const r = computePricingTotalsFromVenueGroups([
    { ms: 8000, location: ENCORE_BEACH, the1FeeSum: 8000 * 0.15 },
  ]);

  assert.strictEqual(r.subtotal, 8000);
  assert.strictEqual(r.fee_breakdown.venue_admin_fee_total, 1200);
  assert.strictEqual(r.fee_breakdown.gratuity_total, 1200);
  assert.strictEqual(r.fee_breakdown.sales_tax_total, 770.5);
  assert.strictEqual(r.fee_breakdown.the1_fee_total, 1200);
  assert.strictEqual(r.fee_breakdown.processing_fee_total, 371.12);
  assert.strictEqual(r.total, 12741.62);
}

function testVenuePricingHelperStFormula() {
  const v = computeVenuePricingTotals(3000, LOC_A, 750);
  assert.strictEqual(Math.round(v.vf * 100) / 100, 420);
  assert.strictEqual(Math.round(v.st * 100) / 100, 286.6);
  assert.strictEqual(Math.round(v.processing * 100) / 100, 147.2);
}

function testDefaultThe1FeePercent() {
  assert.strictEqual(resolveThe1FeePercentForSeat({}), 20);
  assert.strictEqual(resolveThe1FeePercentForSeat({ the1_fee_percent: 25 }), 25);
}

function testDepositIsTwentyPercentOfTotal() {
  const r = computePricingTotalsFromVenueGroups([
    { ms: 3000, location: LOC_A, the1FeeSum: 750 },
  ]);
  const deposit = Math.round(r.total * 0.2 * 100) / 100;
  assert.strictEqual(deposit, 1010.76);
}

try {
  testSingleVenueExample();
  testMultiVenueSum();
  testMixedThe1PercentSameVenue();
  testNoLocationFallback();
  testCatalogBaseGrouping();
  testEncoreBeachEightThousandMinSpend();
  testVenuePricingHelperStFormula();
  testDefaultThe1FeePercent();
  testDepositIsTwentyPercentOfTotal();
  console.log('computePricingTotalsFromSelectedSeats: all passed');
} catch (e) {
  console.error(e);
  process.exit(1);
}

/**
 * On-spot min spend: booked event_price wins over stale Event catalog backfill.
 * Run: node tests/adhocPaymentMinSpend.test.js
 */
const assert = require('assert');
const {
  resolveMinSpendForEvent,
  getMinSpendUsed,
  computeMinSpendSplit,
} = require('../services/adhocPaymentService');

const EVENT_ID = '64b0000000000000000000aa';

function makeCoe(seatOverrides = {}, tracker = []) {
  return {
    selected_seats: [
      {
        event_id: EVENT_ID,
        event_price: 3000,
        base_price: 3000,
        venue_catalog_price: 5000,
        venue_min_spend_usd: 5000,
        negotiated_min_spend_usd: 5000,
        ...seatOverrides,
      },
    ],
    on_spot_min_spend_used: tracker,
  };
}

function testBookedPriceBeatsStaleCatalogBackfill() {
  const coe = makeCoe();
  const r = resolveMinSpendForEvent(coe, EVENT_ID);
  assert.strictEqual(r.venue_usd, 5000);
  assert.strictEqual(r.negotiated_usd, 3000);
  assert.strictEqual(r.effective_usd, 3000);

  const used = getMinSpendUsed(coe, EVENT_ID);
  assert.strictEqual(used, 0);
  const remaining = Math.max(0, r.effective_usd - used);
  assert.strictEqual(remaining, 3000);
}

function testFallbackWithoutEventPrice() {
  const coe = makeCoe({
    event_price: null,
    base_price: 4500,
    venue_catalog_price: null,
    venue_min_spend_usd: 5000,
    negotiated_min_spend_usd: 5000,
  });
  const r = resolveMinSpendForEvent(coe, EVENT_ID);
  assert.strictEqual(r.venue_usd, 5000);
  assert.strictEqual(r.negotiated_usd, 4500);
  assert.strictEqual(r.effective_usd, 4500);
}

function testFallbackToCatalogWhenNoBookedFields() {
  const coe = makeCoe({
    event_price: null,
    base_price: null,
    negotiated_min_spend_usd: null,
    venue_catalog_price: 5000,
    venue_min_spend_usd: 4000,
  });
  const r = resolveMinSpendForEvent(coe, EVENT_ID);
  assert.strictEqual(r.venue_usd, 5000);
  assert.strictEqual(r.effective_usd, 5000);
}

function testUsedReducesRemainingAndSplit() {
  const coe = makeCoe({}, [
    { event_id: EVENT_ID, absorbed: 800 },
  ]);
  const r = resolveMinSpendForEvent(coe, EVENT_ID);
  const used = getMinSpendUsed(coe, EVENT_ID);
  assert.strictEqual(used, 800);
  const remaining = Math.max(0, r.effective_usd - used);
  assert.strictEqual(remaining, 2200);

  const split = computeMinSpendSplit(remaining, 1000);
  assert.strictEqual(split.absorbed, 1000);
  assert.strictEqual(split.cardBase, 0);

  const split2 = computeMinSpendSplit(remaining, 3000);
  assert.strictEqual(split2.absorbed, 2200);
  assert.strictEqual(split2.cardBase, 800);
}

function testSimpleJointCatalogPrefersOriginalPrice() {
  const coe = makeCoe({
    venue_catalog_price: null,
    simple_joint_original_price: 6000,
    venue_min_spend_usd: 5000,
    event_price: 3200,
  });
  const r = resolveMinSpendForEvent(coe, EVENT_ID);
  assert.strictEqual(r.venue_usd, 6000);
  assert.strictEqual(r.effective_usd, 3200);
}

function testEventPriceBeatsStaleBasePriceAndCatalog() {
  const coe = makeCoe({
    event_price: 3000,
    base_price: 5000,
    venue_catalog_price: 5000,
    venue_min_spend_usd: 5000,
    negotiated_min_spend_usd: 5000,
  });
  const r = resolveMinSpendForEvent(coe, EVENT_ID);
  assert.strictEqual(r.venue_usd, 5000);
  assert.strictEqual(r.negotiated_usd, 3000);
  assert.strictEqual(r.effective_usd, 3000);

  const remaining = Math.max(0, r.effective_usd - getMinSpendUsed(coe, EVENT_ID));
  assert.strictEqual(remaining, 3000);

  const split = computeMinSpendSplit(remaining, 4000);
  assert.strictEqual(split.absorbed, 3000);
  assert.strictEqual(split.cardBase, 1000);
}

function testMissingEventReturnsNulls() {
  const coe = makeCoe();
  const r = resolveMinSpendForEvent(coe, '64b0000000000000000000bb');
  assert.strictEqual(r.venue_usd, null);
  assert.strictEqual(r.negotiated_usd, null);
  assert.strictEqual(r.effective_usd, null);
}

function run() {
  testBookedPriceBeatsStaleCatalogBackfill();
  testFallbackWithoutEventPrice();
  testFallbackToCatalogWhenNoBookedFields();
  testUsedReducesRemainingAndSplit();
  testSimpleJointCatalogPrefersOriginalPrice();
  testEventPriceBeatsStaleBasePriceAndCatalog();
  testMissingEventReturnsNulls();
  console.log('adhocPaymentMinSpend.test.js: all passed');
}

run();

/**
 * On-spot min spend: booked event_price wins over stale Event catalog backfill.
 * Run: node tests/adhocPaymentMinSpend.test.js
 */
const assert = require('assert');
const {
  resolveMinSpendForEvent,
  getMinSpendUsed,
  computeMinSpendSplit,
  remainingMinSpendForSplit,
  parseApplyToBalance,
  resolveApplyToBalanceForCharge,
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

function testApplyToBalanceFalseChargesFullBase() {
  const coe = makeCoe();
  assert.strictEqual(parseApplyToBalance(undefined), true);
  assert.strictEqual(parseApplyToBalance(true), true);
  assert.strictEqual(parseApplyToBalance(false), false);
  assert.strictEqual(parseApplyToBalance('false'), false);
  assert.strictEqual(parseApplyToBalance(undefined, 1), false);
  assert.strictEqual(parseApplyToBalance(true, '1'), false);
  assert.strictEqual(parseApplyToBalance(undefined, true), false);

  const remainingOn = remainingMinSpendForSplit(coe, EVENT_ID, true);
  assert.strictEqual(remainingOn, 3000);
  const splitOn = computeMinSpendSplit(remainingOn, 1000);
  assert.strictEqual(splitOn.absorbed, 1000);
  assert.strictEqual(splitOn.cardBase, 0);

  const remainingOff = remainingMinSpendForSplit(coe, EVENT_ID, false);
  assert.strictEqual(remainingOff, 0);
  const splitOff = computeMinSpendSplit(remainingOff, 1000);
  assert.strictEqual(splitOff.absorbed, 0);
  assert.strictEqual(splitOff.cardBase, 1000);

  const remainingOmitted = remainingMinSpendForSplit(coe, EVENT_ID);
  assert.strictEqual(remainingOmitted, 3000);
}

function testThe1EventNeverAppliesToBalance() {
  const the1 = Object.assign(makeCoe(), { is_the1_event: true });
  assert.strictEqual(resolveApplyToBalanceForCharge(the1, true), false);
  assert.strictEqual(resolveApplyToBalanceForCharge(the1, true, undefined), false);
  const remaining = remainingMinSpendForSplit(
    the1,
    EVENT_ID,
    resolveApplyToBalanceForCharge(the1, true),
  );
  assert.strictEqual(remaining, 0);
  const split = computeMinSpendSplit(remaining, 1000);
  assert.strictEqual(split.absorbed, 0);
  assert.strictEqual(split.cardBase, 1000);

  const viaRequest = Object.assign(makeCoe(), {
    is_the1_event: false,
    original_request_data: { is_the1_event: true },
  });
  assert.strictEqual(resolveApplyToBalanceForCharge(viaRequest, true), false);

  const normal = makeCoe();
  assert.strictEqual(resolveApplyToBalanceForCharge(normal, true), true);
  assert.strictEqual(remainingMinSpendForSplit(normal, EVENT_ID, true), 3000);
}

function run() {
  testBookedPriceBeatsStaleCatalogBackfill();
  testFallbackWithoutEventPrice();
  testFallbackToCatalogWhenNoBookedFields();
  testUsedReducesRemainingAndSplit();
  testSimpleJointCatalogPrefersOriginalPrice();
  testEventPriceBeatsStaleBasePriceAndCatalog();
  testMissingEventReturnsNulls();
  testApplyToBalanceFalseChargesFullBase();
  testThe1EventNeverAppliesToBalance();
  console.log('adhocPaymentMinSpend.test.js: all passed');
}

run();

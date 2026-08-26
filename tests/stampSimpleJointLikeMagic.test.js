/**
 * THE1 experience auto-tags seats as simple joint (same as THE1 magic Joint).
 * Run: node tests/stampSimpleJointLikeMagic.test.js
 */
const assert = require('assert');
const {
  stampSimpleJointLikeMagic,
  isThe1EventCoe,
} = require('../services/coeService');

function testBookedPriceKeptCatalogAsOriginal() {
  const row = {
    event_price: 3000,
    base_price: 3000,
    venue_catalog_price: 5000,
  };
  const catalogSeat = {event_price: 5000, base_price: 5000};
  const changed = stampSimpleJointLikeMagic(row, catalogSeat);
  assert.strictEqual(changed, true);
  assert.strictEqual(row.is_simple_joint, true);
  assert.strictEqual(row.simple_joint_original_price, 5000);
  assert.strictEqual(row.event_price, 3000);
  assert.strictEqual(row.base_price, 3000);
}

function testSkipSharedTableAllocation() {
  const row = {
    event_price: 3000,
    base_price: 3000,
    is_joint_allocation: true,
  };
  const changed = stampSimpleJointLikeMagic(row, {
    event_price: 5000,
    base_price: 5000,
  });
  assert.strictEqual(changed, false);
  assert.strictEqual(row.is_simple_joint, undefined);
  assert.strictEqual(row.event_price, 3000);
}

function testSkipSharedTableGroupId() {
  const row = {
    event_price: 3000,
    joint_event_group_id: '64b0000000000000000000cc',
  };
  const changed = stampSimpleJointLikeMagic(row, {event_price: 5000});
  assert.strictEqual(changed, false);
  assert.strictEqual(row.is_simple_joint, undefined);
}

function testSkipAlreadyJoint() {
  const row = {
    is_simple_joint: true,
    simple_joint_original_price: 1000,
    event_price: 800,
    base_price: 800,
  };
  const changed = stampSimpleJointLikeMagic(row, {
    event_price: 5000,
    base_price: 5000,
  });
  assert.strictEqual(changed, false);
  assert.strictEqual(row.simple_joint_original_price, 1000);
  assert.strictEqual(row.event_price, 800);
}

function testIsThe1EventCoe() {
  assert.strictEqual(isThe1EventCoe({is_the1_event: true}), true);
  assert.strictEqual(
    isThe1EventCoe({original_request_data: {is_the1_event: true}}),
    true,
  );
  assert.strictEqual(isThe1EventCoe({is_the1_event: false}), false);
  assert.strictEqual(isThe1EventCoe(null), false);
}

function run() {
  testBookedPriceKeptCatalogAsOriginal();
  testSkipSharedTableAllocation();
  testSkipSharedTableGroupId();
  testSkipAlreadyJoint();
  testIsThe1EventCoe();
  console.log('stampSimpleJointLikeMagic.test.js: all passed');
}

run();

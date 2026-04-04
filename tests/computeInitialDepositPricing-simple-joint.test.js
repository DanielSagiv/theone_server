/**
 * Node assert tests for simpleJoint + multi-client joint deposit split.
 * Run: node tests/computeInitialDepositPricing-simple-joint.test.js
 */
const assert = require('assert');
const {
  computeInitialDepositPricing,
  isJointAllocationSeat,
  isFullDepositSeatRow,
} = require('../services/paymentService');

function testSimpleJointPlusNonJointTwoPercent() {
  const coe = {
    deposit_percent: 2,
    subtotal: 2600,
    taxes: 0,
    fees: 0,
    total: 2600,
    selected_seats: [
      {
        is_simple_joint: true,
        event_price: 600,
        simple_joint_original_price: 1000,
      },
      { event_price: 2000 },
    ],
  };
  const p = computeInitialDepositPricing(coe);
  assert.strictEqual(p.usesSeatSplit, true);
  assert.strictEqual(p.subtotalPreTax, 640, '600 + 2% of 2000');
}

function testMultiClientJointRowStillFullDeposit() {
  const coe = {
    deposit_percent: 20,
    subtotal: 1000,
    taxes: 300,
    fees: 0,
    total: 1300,
    selected_seats: [
      { is_joint_allocation: true, event_price: 400 },
      { event_price: 600 },
    ],
  };
  const p = computeInitialDepositPricing(coe);
  assert.strictEqual(p.subtotalPreTax, 520, '400 + 20% of 600');
  assert.strictEqual(p.usesSeatSplit, true);
}

function testIsFullDepositSeatRow() {
  assert.strictEqual(isFullDepositSeatRow({ is_simple_joint: true }), true);
  assert.strictEqual(isFullDepositSeatRow({ is_joint_allocation: true }), true);
  assert.strictEqual(
    isFullDepositSeatRow({ joint_event_group_id: 'uuid' }),
    true,
  );
  assert.strictEqual(isFullDepositSeatRow({ event_price: 100 }), false);
  assert.strictEqual(isJointAllocationSeat({ is_simple_joint: true }), false);
}

function smokeJointEventServiceExports() {
  const jointEventService = require('../services/jointEventService');
  assert.strictEqual(
    typeof jointEventService.createJointEventAllocation,
    'function',
  );
  assert.strictEqual(typeof jointEventService.listJointSectionOptions, 'function');
}

try {
  testSimpleJointPlusNonJointTwoPercent();
  testMultiClientJointRowStillFullDeposit();
  testIsFullDepositSeatRow();
  smokeJointEventServiceExports();
  console.log('computeInitialDepositPricing-simple-joint: all passed');
} catch (e) {
  console.error(e);
  process.exit(1);
}

/**
 * THE1 Experience host/child helpers (no DB).
 * Run: node tests/the1Experience.test.js
 */
const assert = require('assert');
const {
  pickHostEventsAndSeats,
  applyBuyInsToSeats,
  formatHostSummary,
  applyHostPartySizeDeltas,
  mergePartySizeDeltas,
  partySizeByEventFromLines,
} = require('../services/the1ExperienceService');
const {
  isThe1ExperienceHost,
  isThe1ExperienceChild,
  assertThe1ExperienceHostNotPayable,
} = require('../utils/the1Experience');
const { resolveApplyToBalanceForCharge, computeMinSpendSplit } = require('../services/adhocPaymentService');

const E1 = '64b0000000000000000000aa';
const E2 = '64b0000000000000000000bb';

function makeHost() {
  return {
    is_the1_experience_host: true,
    total: 3000,
    adhoc_collected_total: 0,
    events: [
      { event_id: E1, event_date: new Date(), event_time: '21:00', sequence: 1, party_size: 8 },
      { event_id: E2, event_date: new Date(), event_time: '22:00', sequence: 2, party_size: 6 },
    ],
    selected_seats: [
      {
        event_id: E1,
        seat_id: '64b0000000000000000000c1',
        seat_code: 'T1',
        capacity: 4,
        event_price: 1500,
        base_price: 1500,
        available_from: new Date(),
        available_until: new Date(),
      },
      {
        event_id: E2,
        seat_id: '64b0000000000000000000c2',
        seat_code: 'T2',
        capacity: 4,
        event_price: 1500,
        base_price: 1500,
        available_from: new Date(),
        available_until: new Date(),
      },
    ],
  };
}

function testPickSubsetAndBuyIn() {
  const host = makeHost();
  const picked = pickHostEventsAndSeats(host, [
    { event_id: E1, buy_in: 1000, party_size: 2 },
  ]);
  assert.strictEqual(picked.eventIds.size, 1);
  assert.strictEqual(picked.events.length, 1);
  assert.strictEqual(picked.seats.length, 1);
  const stamped = applyBuyInsToSeats(picked.seats, picked.buyInByEvent);
  assert.strictEqual(stamped[0].event_price, 1000);
  assert.strictEqual(stamped[0].is_simple_joint, true);
  assert.strictEqual(stamped[0].simple_joint_original_price, 1500);
}

function testRejectEventNotOnHost() {
  const host = makeHost();
  assert.throws(
    () =>
      pickHostEventsAndSeats(host, [
          { event_id: '64b0000000000000000000ff', buy_in: 100, party_size: 2 },
      ]),
    /subset/,
  );
}

function testSummaryBuyInVsTableCost() {
  const host = makeHost();
  const summary = formatHostSummary(host, [
    {
      _id: '64b0000000000000000000d1',
      client_id: {
        _id: '64b0000000000000000000e1',
        firstName: 'Dan',
        lastName: 'A',
        email: 'dan@example.com',
        avatarUrl: 'https://img.example/dan.jpg',
        avatar_thumb_url: 'https://img.example/dan-t.jpg',
      },
      total: 1000,
      total_paid: 1000,
      adhoc_collected_total: 0,
      payment_status: 'paid',
      status: 'paid',
      selected_seats: [{ event_id: E1, event_price: 1000 }],
    },
  ]);
  assert.strictEqual(summary.table_cost, 3000);
  assert.strictEqual(summary.table_price, 3000);
  assert.strictEqual(summary.buy_in_collected, 1000);
  assert.strictEqual(summary.buy_in_assigned, 1000);
  assert.strictEqual(summary.client_count, 1);
  assert.strictEqual(summary.clients[0].amount_paid, 1000);
  assert.strictEqual(summary.clients[0].firstName, 'Dan');
  assert.strictEqual(summary.clients[0].lastName, 'A');
  assert.strictEqual(summary.clients[0].name, 'Dan A');
  assert.strictEqual(summary.clients[0].email, 'dan@example.com');
  assert.strictEqual(summary.clients[0].avatarUrl, 'https://img.example/dan.jpg');
  assert.strictEqual(summary.clients[0].avatar_thumb_url, 'https://img.example/dan-t.jpg');
  assert.strictEqual(summary.clients[0].event_lines.length, 1);
  assert.strictEqual(summary.clients[0].event_lines[0].event_id, E1);
  assert.strictEqual(summary.clients[0].event_lines[0].buy_in, 1000);
}

function testHostFlags() {
  assert.strictEqual(isThe1ExperienceHost({ is_the1_experience_host: true }), true);
  assert.strictEqual(isThe1ExperienceChild({ the1_experience_host_id: E1 }), true);
  assert.throws(
    () => assertThe1ExperienceHostNotPayable({ is_the1_experience_host: true }),
    /cannot be paid/,
  );
}

function testChildOnSpotCanApplyToHostBalance() {
  const child = {
    is_the1_event: true,
    the1_experience_host_id: E1,
  };
  assert.strictEqual(resolveApplyToBalanceForCharge(child, true), true);
  const oneToOne = { is_the1_event: true };
  assert.strictEqual(resolveApplyToBalanceForCharge(oneToOne, true), false);
}

function testHostTableOverageHasCardBase() {
  const over = computeMinSpendSplit(100, 150);
  assert.strictEqual(over.absorbed, 100);
  assert.strictEqual(over.cardBase, 50);
  const covered = computeMinSpendSplit(200, 150);
  assert.strictEqual(covered.absorbed, 150);
  assert.strictEqual(covered.cardBase, 0);
}

function testCreateHostSchemaAllowsMissingClientId() {
  const { createCOESchema } = require('../utils/validationSchemas');
  const admin = '68cfd487e2766dbc14fd4c74';
  const body = {
    name: 'THE1 Experience',
    description: 'THE1 Experience',
    status: 'draft',
    is_the1_experience_host: true,
    admin_id: admin,
    start_date: '2026-08-28',
    end_date: '2026-08-31',
    currency: 'USD',
  };
  const host = createCOESchema.validate(body);
  assert.strictEqual(host.error, undefined);
  const missingFlag = createCOESchema.validate({ ...body, is_the1_experience_host: undefined });
  assert.match(String(missingFlag.error?.details?.[0]?.message || ''), /client_id/);
}

function testHostPromptSkipsClientId() {
  const { extractPreferencesFromFormSubmission } = require('../services/botPreferenceService');
  const parsed = extractPreferencesFromFormSubmission(
    [
      'Build my experience with the following preferences:',
      'THE1 Experience host: yes',
      'Admin create mode: draft',
      'Start date: 2026-08-28',
      'End date: 2026-08-31',
      'City: Las Vegas, Nevada',
      'Selected event IDs: 64b0000000000000000000aa',
    ].join('\n'),
  );
  assert.strictEqual(parsed.valid, true);
  assert.strictEqual(parsed.raw.is_the1_experience_host, true);
  assert.strictEqual(parsed.raw.client_id, undefined);
}

function testUpdateClientSchemaOmitsClientId() {
  const { updateThe1ExperienceClientSchema } = require('../utils/validationSchemas');
  const ok = updateThe1ExperienceClientSchema.validate({
    events: [{ event_id: E1, buy_in: 500, party_size: 2 }],
    deposit_percent: 20,
  });
  assert.strictEqual(ok.error, undefined);
  const missing = updateThe1ExperienceClientSchema.validate({ events: [] });
  assert.ok(missing.error);
}

function testAddClientSchemaRequiresPartySize() {
  const { addThe1ExperienceClientsSchema } = require('../utils/validationSchemas');
  const ok = addThe1ExperienceClientsSchema.validate({
    client_id: '64b0000000000000000000cc',
    events: [{ event_id: E1, buy_in: 500, party_size: 3 }],
  });
  assert.strictEqual(ok.error, undefined);
  const missing = addThe1ExperienceClientsSchema.validate({
    client_id: '64b0000000000000000000cc',
    events: [{ event_id: E1, buy_in: 500 }],
  });
  assert.ok(missing.error);
}

function testHostPartySizeSubtractRestoreAndReject() {
  const host = makeHost();
  applyHostPartySizeDeltas(
    host,
    mergePartySizeDeltas(new Map(), new Map([[E1, 3]])),
  );
  assert.strictEqual(host.events[0].party_size, 5);
  applyHostPartySizeDeltas(
    host,
    mergePartySizeDeltas(new Map([[E1, 3]]), new Map()),
  );
  assert.strictEqual(host.events[0].party_size, 8);

  assert.throws(
    () =>
      applyHostPartySizeDeltas(
        host,
        mergePartySizeDeltas(new Map(), new Map([[E1, 9]])),
      ),
    /exceeds remaining/,
  );

  const missing = {
    is_the1_experience_host: true,
    events: [{ event_id: E1, sequence: 1 }],
  };
  assert.throws(
    () =>
      applyHostPartySizeDeltas(
        missing,
        mergePartySizeDeltas(new Map(), new Map([[E1, 1]])),
      ),
    /exceeds remaining/,
  );

  applyHostPartySizeDeltas(
    host,
    mergePartySizeDeltas(new Map(), new Map([[E1, 8]])),
  );
  assert.strictEqual(host.events[0].party_size, 0);

  const fromChild = partySizeByEventFromLines([
    { event_id: E1, party_size: 2 },
    { event_id: E2, party_size: 1 },
  ]);
  assert.strictEqual(fromChild.get(E1), 2);
  assert.strictEqual(fromChild.get(E2), 1);
}

function run() {
  testPickSubsetAndBuyIn();
  testRejectEventNotOnHost();
  testSummaryBuyInVsTableCost();
  testHostFlags();
  testChildOnSpotCanApplyToHostBalance();
  testHostTableOverageHasCardBase();
  testCreateHostSchemaAllowsMissingClientId();
  testHostPromptSkipsClientId();
  testUpdateClientSchemaOmitsClientId();
  testAddClientSchemaRequiresPartySize();
  testHostPartySizeSubtractRestoreAndReject();
  console.log('the1Experience.test.js: all passed');
}

run();

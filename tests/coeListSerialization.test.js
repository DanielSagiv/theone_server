/**
 * COE list serialization helpers for GET /coes/my.
 * Run: node tests/coeListSerialization.test.js
 */
const assert = require('assert');
const {
  serializeCoeForList,
  trimMediaForList,
  trimPopulatedEventForList,
  trimSelectedSeatForList,
} = require('../utils/coeListSerialization');

function testTrimMediaForList() {
  const media = [
    { type: 'video', url: 'https://x/v.mp4' },
    {
      type: 'image',
      url: 'https://x/full.jpg',
      thumb_url: 'https://x/thumb.jpg',
      list_thumb_url: 'https://x/list.jpg',
      width: 100,
      height: 50,
    },
    { type: 'image', url: 'https://x/extra.jpg' },
  ];
  const out = trimMediaForList(media);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].url, 'https://x/full.jpg');
  assert.strictEqual(out[0].list_thumb_url, 'https://x/list.jpg');
}

function testTrimPopulatedEventForList() {
  const event = {
    _id: 'ev1',
    name: 'Night Show',
    description: 'Long description',
    start_datetime: '2026-08-01T22:00:00.000Z',
    timezone: 'America/Los_Angeles',
    type: 'night_club',
    media: [{ type: 'image', url: 'https://x/a.jpg' }],
    performers: [{ name: 'DJ', perfcode: 'dj', links: [{ url: 'https://dj.com' }] }],
    location_id: {
      _id: 'loc1',
      name: 'OMNIA',
      address: { line1: 'secret' },
      seats: [{ code: 'VIP' }],
    },
    seats: [
      {
        _id: 's1',
        seat_id: 's1',
        code: 'T1',
        category: 'table',
        section: 'Main',
        event_min_spend: 5000,
      },
    ],
  };
  const out = trimPopulatedEventForList(event);
  assert.strictEqual(out.name, 'Night Show');
  assert.strictEqual(out.description, undefined);
  assert.strictEqual(out.location_id.name, 'OMNIA');
  assert.strictEqual(out.location_id.address, undefined);
  assert.strictEqual(out.location_id.seats, undefined);
  assert.strictEqual(out.seats.length, 1);
  assert.strictEqual(out.seats[0].code, 'T1');
  assert.strictEqual(out.performers[0].links[0].url, 'https://dj.com');
}

function testTrimSelectedSeatForList() {
  const seat = {
    event_id: 'ev1',
    seat_id: 's1',
    seat_code: 'T1',
    category: 'table',
    section: 'Main',
    event_price: 4000,
    base_price: 3500,
    event_min_spend: 5000,
    min_spend: 4500,
    is_simple_joint: true,
    simple_joint_original_price: 6000,
    venue_catalog_price: 7000,
    is_joint_allocation: false,
    extra_debug_field: 'drop-me',
  };
  const out = trimSelectedSeatForList(seat);
  assert.strictEqual(out.seat_code, 'T1');
  assert.strictEqual(out.venue_catalog_price, 7000);
  assert.strictEqual(out.extra_debug_field, undefined);
}

function testSerializeCoeForList() {
  const doc = {
    _id: 'coe1',
    status: 'approved',
    name: 'Vegas Trip',
    description: 'EJS subtitle',
    total: 12000,
    runner_assignment: { runner_id: { firstName: 'R', lastName: 'U' } },
    events: [
      {
        event_id: {
          _id: 'ev1',
          name: 'Show',
          start_datetime: '2026-08-01T22:00:00.000Z',
          timezone: 'America/Los_Angeles',
          type: 'night_club',
          media: [{ type: 'image', url: 'https://x/a.jpg' }],
          performers: [],
          location_id: { _id: 'loc1', name: 'OMNIA', geo: { lat: 1 } },
          seats: [],
        },
      },
    ],
    selected_seats: [
      { event_id: 'ev1', seat_code: 'T1', event_price: 4000 },
    ],
    proposal_group_id: '  grp-1 ',
    proposal_label: ' 2 ',
  };
  const out = serializeCoeForList(doc);
  assert.strictEqual(out.description, 'EJS subtitle');
  assert.strictEqual(out.runner_assignment.runner_id.firstName, 'R');
  assert.strictEqual(out.proposal_group_id, 'grp-1');
  assert.strictEqual(out.proposal_label, '2');
  assert.strictEqual(out.events[0].event_id.location_id.geo, undefined);
  assert.strictEqual(out.selected_seats[0].seat_code, 'T1');
}

function run() {
  testTrimMediaForList();
  testTrimPopulatedEventForList();
  testTrimSelectedSeatForList();
  testSerializeCoeForList();
  console.log('coeListSerialization.test.js: all passed');
}

run();

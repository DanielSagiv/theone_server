/**
 * LIV listing scraper — new lvw cards vs legacy EVE codes.
 * Run: node tests/livLasVegasScraperService.test.js
 */
const assert = require('assert');
const {
  parseIsoDateFromEventCode,
  parseEventCodeFromHref,
  normalizeLivEvent,
} = require('../services/scrapEvents/livLasVegasScraperService');
const {
  isLivNightImportableRow,
  isLivBeachImportableRow,
  applyInventoryToSeats: applyLivInventoryToSeats,
} = require('../services/scrapEvents/livLasVegasEventImportService');

assert.strictEqual(
  parseEventCodeFromHref('https://www.livnightclub.com/las-vegas/event/EVE-SUP7FH/matroda/'),
  'EVE-SUP7FH'
);
assert.strictEqual(parseIsoDateFromEventCode('EVE121488100020260626'), '2026-06-26');
assert.strictEqual(
  parseEventCodeFromHref('https://www.livnightclub.com/las-vegas/event/EVE121488100020260626/x/'),
  'EVE121488100020260626'
);

const night = normalizeLivEvent({
  code: 'EVE-SUP7FH',
  href: 'https://www.livnightclub.com/las-vegas/event/EVE-SUP7FH/matroda/',
  name: 'Matroda',
  venue: 'LIV Las Vegas',
  cat: 'Nightlife',
  time: '10:30pm',
  isoDate: '2026-10-02',
  img: 'https://example.com/flyer.jpg',
});
assert.strictEqual(night.isoDate, '2026-10-02');
assert.strictEqual(night.eventCode, 'EVE-SUP7FH');
assert.strictEqual(isLivNightImportableRow(night), true);
assert.strictEqual(isLivBeachImportableRow(night), false);

const beach = normalizeLivEvent({
  code: 'EVE-OJEAXA',
  href: 'https://www.livnightclub.com/las-vegas/event/EVE-OJEAXA/sam-feldt/',
  name: 'Sam Feldt',
  venue: 'LIV Beach',
  cat: 'Daylife',
  time: '11:30am',
  isoDate: '2026-10-02',
});
assert.strictEqual(isLivBeachImportableRow(beach), true);
assert.strictEqual(isLivNightImportableRow(beach), false);

const {
  parseLivAreaCardInventoryFromRaw,
} = require('../services/scrapEvents/livLasVegasEventDetailScraperService');
const { applyInventoryToSeats } = require('../services/scrapEvents/scrapEventsShared');

const stageCard = parseLivAreaCardInventoryFromRaw({
  name: 'Stage',
  spendText: '$8,000',
  guestsText: '10',
});
assert.strictEqual(stageCard.minSpend, 8000);
assert.strictEqual(stageCard.capacity, 10);

const danceCard = parseLivAreaCardInventoryFromRaw({
  name: 'Dance Floor',
  spendText: '$6,000',
  guestsText: '12',
});
const mappedDance = {
  ...danceCard,
  seatCode: 'df',
  sectionKey: 'dance floor',
};
const applied = applyInventoryToSeats(
  [{ code: 'Dance Floordf', category: 'dance_floor', event_price: 1000 }],
  [mappedDance]
);
assert.strictEqual(applied.seats[0].event_min_spend, 6000);

const stageMapped = {
  name: 'Stage',
  seatCode: 'Stage',
  minSpend: 8000,
};
const nightSeats = [
  { code: 'Stage', category: 'stage', event_price: 1000 },
  { code: 'DJ Table Backstage', category: 'DJ_Table_Backstage', event_price: 1000 },
  { code: 'Dance Floordf', category: 'dance_floor', event_price: 1000 },
];
const nightApplied = applyLivInventoryToSeats(nightSeats, [stageMapped]);
const nightByCode = Object.fromEntries(nightApplied.seats.map((s) => [s.code, s]));
assert.strictEqual(nightByCode.Stage.event_price, 8000);
assert.strictEqual(nightByCode['DJ Table Backstage'].event_price, 8000);
assert.strictEqual(nightByCode['DJ Table Backstage'].event_min_spend, 8000);
assert.strictEqual(nightByCode['DJ Table Backstage'].price_change_reason, 'LIV scrap import');
assert.strictEqual(nightByCode['Dance Floordf'].event_price, 1000);
assert.ok(
  !nightApplied.warnings.includes(
    'Location seat "DJ Table Backstage" had no scraped inventory on detail page'
  )
);

const beachSeats = [
  { code: 'Stage Cabana', category: 'stage_cabana', event_price: 1000 },
  { code: 'Dance Floor', category: 'dance_floor', event_price: 1000 },
];
const beachApplied = applyLivInventoryToSeats(beachSeats, [
  { name: 'Stage Cabana', seatCode: 'Stage Cabana', minSpend: 5000 },
]);
const beachByCode = Object.fromEntries(beachApplied.seats.map((s) => [s.code, s]));
assert.strictEqual(beachByCode['Stage Cabana'].event_price, 5000);
assert.strictEqual(beachByCode['Dance Floor'].event_price, 1000);
assert.strictEqual(beachApplied.seats.length, 2);

console.log('livLasVegasScraperService.test.js: ok');

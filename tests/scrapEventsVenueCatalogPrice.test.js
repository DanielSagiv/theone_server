/**
 * Venue catalog price from UrVenue Minimum Spend (scrap events).
 * Run: node tests/scrapEventsVenueCatalogPrice.test.js
 */
const assert = require('assert');
const {
  parseUrvenueMinimumSpendFromItemText,
  parseUrvenuePayNowFromItemText,
  venueCatalogMinSpendFromInventoryItem,
  parseUrvenueInventoryItemFromRaw,
} = require('../services/scrapEvents/urvenueInventoryDom');
const {
  applyInventoryToSeats,
  parseScrapPrepareImportOptions,
} = require('../services/scrapEvents/scrapEventsShared');
const {
  remapInventoryItemsForLocationSeats,
} = require('../services/scrapEvents/scrapInventorySeatRemap');
const {
  ensureOmniaEventCodeOnDetailUrl,
  resolveOmniaDetailUrl,
} = require('../services/scrapEvents/omniaEventImportService');
const {
  ensureHakkasanEventCodeOnDetailUrl,
  resolveHakkasanDetailUrl,
} = require('../services/scrapEvents/hakkasanEventImportService');
const {
  normalizeTableName: normalizeOmniaTableName,
  resolveOmniaSeatMapping,
} = require('../services/scrapEvents/omniaEventDetailScraperService');
const {
  normalizeTableName: normalizeHakkasanTableName,
  resolveHakkasanSeatMapping,
} = require('../services/scrapEvents/hakkasanEventDetailScraperService');
const {
  normalizeOmniaScope,
  resolveOmniaVenue,
  getOmniaConfigsForScope,
  inferOmniaVenueTypeFromEventCode,
} = require('../utils/omniaVenueConfig');
const { inferHakkasanFromEventCode } = require('../utils/hakkasanVenueConfig');
const { inferTaoBeachFromEventCode } = require('../utils/taoBeachVenueConfig');
const {
  ensureTaoBeachEventCodeOnDetailUrl,
  resolveTaoBeachDetailUrl,
} = require('../services/scrapEvents/taoBeachEventImportService');
const {
  normalizeTableName: normalizeTaoBeachTableName,
  resolveTaoBeachSeatMapping,
} = require('../services/scrapEvents/taoBeachEventDetailScraperService');
const {
  isTaoBeachGenericBookRow,
  isGenericBookHref,
} = require('../services/scrapEvents/taoBeachScraperService');
const { inferPalmTreeBeachFromEventCode } = require('../utils/palmTreeBeachVenueConfig');
const { resolvePalmTreeBeachDetailUrl } = require('../services/scrapEvents/palmTreeBeachEventImportService');
const {
  ensurePalmTreeBeachEventCodeOnDetailUrl,
  buildPalmTreeBeachEventDetailUrl,
} = require('../services/scrapEvents/palmTreeBeachScraperService');
const {
  normalizeTableName: normalizePalmTreeBeachTableName,
  mapPalmTreeBeachTableToSeatCode,
  resolvePalmTreeBeachSeatMapping,
} = require('../services/scrapEvents/palmTreeBeachEventDetailScraperService');
const { inferMarqueeDayclubFromEventCode } = require('../utils/marqueeDayclubVenueConfig');
const { resolveMarqueeDayclubDetailUrl } = require('../services/scrapEvents/marqueeDayclubEventImportService');
const {
  ensureMarqueeDayclubEventCodeOnDetailUrl,
  buildMarqueeDayclubEventDetailUrl,
} = require('../services/scrapEvents/marqueeDayclubScraperService');
const {
  normalizeTableName: normalizeMarqueeDayclubTableName,
  mapMarqueeDayclubTableToSeatCode,
  resolveMarqueeDayclubSeatMapping,
} = require('../services/scrapEvents/marqueeDayclubEventDetailScraperService');
const {
  normalizeTableName: normalizeMarqueeNightclubTableName,
  mapMarqueeNightclubTableToSeatCode,
  resolveMarqueeNightclubSeatMapping,
  sanitizeMarqueeNightclubDescription,
} = require('../services/scrapEvents/marqueeNightclubEventDetailScraperService');
const { isoDateFromEventName, isoDateFromTaoSlug, isoDateFromListingDateDisplay } = require('../services/scrapEvents/marqueeNightclubScraperService');
const {
  normalizeTableName: normalizeEncoreTableName,
  mapEncoreTableToSeatCode,
  resolveEncoreSeatMapping,
} = require('../services/scrapEvents/encoreBeachEventDetailScraperService');
const {
  resolveEncoreVenue,
  normalizeEncoreScope,
  inferEncoreVenueTypeFromEventCode,
  isEncoreListingVenue,
} = require('../utils/encoreBeachVenueConfig');
const {
  normalizeScrapEventName,
  scrapEventDayBoundsUtc,
} = require('../services/scrapEvents/scrapImportDedupe');
const { assertScrapInventoryPricingApplied } = require('../services/scrapEvents/scrapEventsShared');

const SAMPLE_OMNIA_TEXT = `Main Room Dance Floor
12
Arrive by 12:00am
Main Room Dance Floor Table More Info.
Pay Now 1,200.00
Minimum Spend
6,000.00
Book
*Pricing based on 12 guests`;

function testParseMinimumSpend() {
  assert.strictEqual(parseUrvenueMinimumSpendFromItemText('Minimum Spend 6,000.00'), 6000);
  assert.strictEqual(parseUrvenueMinimumSpendFromItemText('Minimum Spend $3,000.00'), 3000);
  assert.strictEqual(parseUrvenueMinimumSpendFromItemText('Minimum Spend\n$2,500.00'), 2500);
  assert.strictEqual(parseUrvenueMinimumSpendFromItemText(SAMPLE_OMNIA_TEXT), 6000);
  assert.strictEqual(parseUrvenueMinimumSpendFromItemText('Pay Now 1,200.00'), null);
  assert.strictEqual(parseUrvenueMinimumSpendFromItemText('F&B Minimum* $4,500.00'), 4500);
  assert.strictEqual(parseUrvenueMinimumSpendFromItemText('F&B Minimum\n$2,000'), 2000);
}

function testPayNowNotUsedForCatalog() {
  assert.strictEqual(parseUrvenuePayNowFromItemText(SAMPLE_OMNIA_TEXT), 1200);
  const item = parseUrvenueInventoryItemFromRaw(
    { innerText: SAMPLE_OMNIA_TEXT, nameFromSelector: '' },
    { nameStyle: 'omnia' }
  );
  assert.ok(item);
  assert.strictEqual(item.minSpend, 6000);
  assert.strictEqual(item.payNow, 1200);
  assert.strictEqual(venueCatalogMinSpendFromInventoryItem(item), 6000);
  assert.notStrictEqual(venueCatalogMinSpendFromInventoryItem(item), item.payNow);
}

function testMissingMinimumSpendSkipped() {
  const item = parseUrvenueInventoryItemFromRaw(
    { innerText: 'Stage Table Pay Now 500.00 Book', nameFromSelector: 'Stage' },
    { nameStyle: 'liv' }
  );
  assert.strictEqual(item, null);
}

function testApplyInventoryPreservesLocationMinSpend() {
  const seats = [
    { code: 'df', min_spend: 1000, event_price: 1000, event_min_spend: 1000 },
  ];
  const inventory = [{ seatCode: 'df', minSpend: 6000 }];
  const { seats: updated } = applyInventoryToSeats(seats, inventory, 'OMNIA scrap import');
  assert.strictEqual(updated[0].event_price, 6000);
  assert.strictEqual(updated[0].event_min_spend, 6000);
  assert.strictEqual(updated[0].min_spend, 1000);
  assert.strictEqual(updated[0].price_change_reason, 'OMNIA scrap import');
}

function testApplyInventoryUnmatchedSeatUnchanged() {
  const seats = [{ code: 'df', min_spend: 1000, event_price: 1000 }];
  const { seats: updated } = applyInventoryToSeats(seats, [], 'LIV scrap import');
  assert.strictEqual(updated[0].event_price, 1000);
  assert.strictEqual(updated[0].min_spend, 1000);
}

function testFilterScrapEventsNotInPast() {
  const {
    filterScrapEventsNotInPast,
    getScrapListingTodayIso,
    isScrapEventInPast,
  } = require('../services/scrapEvents/scrapEventsShared');
  const today = getScrapListingTodayIso(new Date('2026-06-09T12:00:00'));
  assert.strictEqual(today, '2026-06-09');
  assert.strictEqual(isScrapEventInPast('2026-06-08', today), true);
  assert.strictEqual(isScrapEventInPast('2026-06-09', today), false);
  const rows = [
    { eventCode: 'EVE1', isoDate: '2026-06-08' },
    { eventCode: 'EVE2', isoDate: '2026-06-09' },
    { eventCode: 'EVE3', isoDate: '2026-06-10' },
    { eventCode: 'EVE4' },
  ];
  const upcoming = filterScrapEventsNotInPast(rows, today);
  assert.deepStrictEqual(upcoming.map((r) => r.eventCode), ['EVE2', 'EVE3']);
}

function testOmniaBalconySmallMapsToBalconySmall() {
  const key = normalizeOmniaTableName('Main Room Balcony Small 10 Arrive by 12:00am Small Balcony');
  const { seatCode } = resolveOmniaSeatMapping(key, 'night_club');
  assert.strictEqual(seatCode, 'Main Room Balcony Small');
}

function testOmniaDayclubTableMappings() {
  const premiumKey = normalizeOmniaTableName('Premium Villa 15 Arrive by 11:00am');
  assert.strictEqual(resolveOmniaSeatMapping(premiumKey, 'day_club').seatCode, 'Premium Villa');

  const premiumDayKey = normalizeOmniaTableName('Premium Villa 15 11:00am');
  assert.strictEqual(resolveOmniaSeatMapping(premiumDayKey, 'day_club').seatCode, 'Premium Villa');

  const cabanaKey = normalizeOmniaTableName('Stage Cabana 12 Arrive by 11:00am');
  assert.strictEqual(resolveOmniaSeatMapping(cabanaKey, 'day_club').seatCode, 'Stage Cabana');

  const cabanaDayKey = normalizeOmniaTableName('Stage Cabana 12 11:00am');
  assert.strictEqual(resolveOmniaSeatMapping(cabanaDayKey, 'day_club').seatCode, 'Stage Cabana');

  const couchKey = normalizeOmniaTableName('Poolside Couch 10 Arrive by 11:00am');
  assert.strictEqual(resolveOmniaSeatMapping(couchKey, 'day_club').seatCode, 'Poolside Couch');

  const couchDayKey = normalizeOmniaTableName('Poolside Couch 10 11:00am');
  assert.strictEqual(resolveOmniaSeatMapping(couchDayKey, 'day_club').seatCode, 'Poolside Couch');
}

function testOmniaVenueConfigScope() {
  assert.strictEqual(normalizeOmniaScope('daylife'), 'daylife');
  assert.strictEqual(normalizeOmniaScope('both'), 'both');
  assert.strictEqual(normalizeOmniaScope(undefined), 'nightlife');

  assert.strictEqual(
    inferOmniaVenueTypeFromEventCode('EVE4091154168600020260703'),
    'day_club'
  );
  assert.strictEqual(inferOmniaVenueTypeFromEventCode('EVE108900020260710'), 'night_club');

  const dayVenue = resolveOmniaVenue({
    eventCode: 'EVE4091154168600020260703',
    category: 'Nightlife',
  });
  assert.strictEqual(dayVenue.type, 'day_club');
  assert.strictEqual(dayVenue.venueType, 'day_club');

  const nightVenue = resolveOmniaVenue({ category: 'Nightlife', eventCode: 'EVE108900020260710' });
  assert.strictEqual(nightVenue.type, 'night_club');

  assert.strictEqual(getOmniaConfigsForScope('both').length, 2);
  assert.strictEqual(getOmniaConfigsForScope('daylife').length, 1);
}

function testOmniaDayclubInventoryApply() {
  const seats = [
    { code: 'Premium Villa', event_price: 1000, event_min_spend: 1000 },
    { code: 'Poolside Couch', event_price: 1000, event_min_spend: 1000 },
  ];
  const items = [
    {
      name: 'Premium Villa 15 Arrive by 11:00am',
      minSpend: 3000,
      seatCode: 'Premium Villa',
    },
    {
      name: 'Poolside Couch 10 Arrive by 11:00am',
      minSpend: 750,
      seatCode: 'Poolside Couch',
    },
  ];
  const { seats: applied } = applyInventoryToSeats(seats, items, 'OMNIA scrap import');
  assert.strictEqual(applied[0].event_price, 3000);
  assert.strictEqual(applied[1].event_price, 750);
  assert.doesNotThrow(() =>
    assertScrapInventoryPricingApplied(applied, items, 'OMNIA scrap import')
  );
}

function testOmniaDetailUrlAppendsEventCode() {
  const base = 'https://booketing.com/microsite/house/event/61/1089/ti-sto';
  const withCode = ensureOmniaEventCodeOnDetailUrl(base, 'EVE108900020260710');
  assert.strictEqual(withCode, `${base}?eventcode=EVE108900020260710`);
  const notes = `Imported from OMNIA.\nSource: ${base}`;
  const resolved = resolveOmniaDetailUrl(notes, 'EVE108900020260710');
  assert.strictEqual(resolved, `${base}?eventcode=EVE108900020260710`);
}

function testHakkasanSeatMapNormalization() {
  const ownersKey = normalizeHakkasanTableName('Main Room Owners 15 Arrive by 12:00am');
  assert.strictEqual(resolveHakkasanSeatMapping(ownersKey).seatCode, 'Main Room Owners');

  const stageKey = normalizeHakkasanTableName('Main Room Stage 12 Arrive by 12:00am');
  assert.strictEqual(resolveHakkasanSeatMapping(stageKey).seatCode, 'Main Room Stage');

  const lowerDfKey = normalizeHakkasanTableName('Main Room Lower Dance Floor 10 Arrive by 12:00am');
  assert.strictEqual(resolveHakkasanSeatMapping(lowerDfKey).seatCode, 'Main Room Lower Dance Floor');

  const upperDfKey = normalizeHakkasanTableName('Main Room Upper Dancefloor 8 Arrive by 12:00am');
  assert.strictEqual(resolveHakkasanSeatMapping(upperDfKey).seatCode, 'Main Room Upper Dancefloor');

  const mezzKey = normalizeHakkasanTableName('Mezzanine Skybox 6 Arrive by 12:00am');
  assert.strictEqual(resolveHakkasanSeatMapping(mezzKey).seatCode, 'Mezzanine Skybox');
}

function testHakkasanInventoryApply() {
  const seats = [
    { code: 'Main Room Owners', event_price: 1000, event_min_spend: 1000 },
    { code: 'Main Room Stage', event_price: 1000, event_min_spend: 1000 },
    { code: 'Main Room Lower Dance Floor', event_price: 1000, event_min_spend: 1000 },
  ];
  const items = [
    {
      name: 'Main Room Owners 15 Arrive by 12:00am',
      minSpend: 4000,
      seatCode: 'Main Room Owners',
    },
    {
      name: 'Main Room Stage 12 Arrive by 12:00am',
      minSpend: 3500,
      seatCode: 'Main Room Stage',
    },
    {
      name: 'Main Room Lower Dance Floor 10 Arrive by 12:00am',
      minSpend: 3000,
      seatCode: 'Main Room Lower Dance Floor',
    },
  ];
  const { seats: applied } = applyInventoryToSeats(seats, items, 'Hakkasan scrap import');
  assert.strictEqual(applied[0].event_price, 4000);
  assert.strictEqual(applied[1].event_price, 3500);
  assert.strictEqual(applied[2].event_price, 3000);
  assert.doesNotThrow(() =>
    assertScrapInventoryPricingApplied(applied, items, 'Hakkasan scrap import')
  );
}

function testHakkasanEventCodeInference() {
  assert.strictEqual(inferHakkasanFromEventCode('EVE108500020260702'), true);
  assert.strictEqual(inferHakkasanFromEventCode('EVE108900020260710'), false);
  assert.strictEqual(inferHakkasanFromEventCode(''), false);
}

function testHakkasanDetailUrlAppendsEventCode() {
  const base = 'https://booketing.com/microsite/house/event/61/1085/laidback-luke';
  const withCode = ensureHakkasanEventCodeOnDetailUrl(base, 'EVE108500020260702');
  assert.strictEqual(withCode, `${base}?eventcode=EVE108500020260702`);
  const notes = `Imported from Hakkasan.\nSource: ${base}`;
  const resolved = resolveHakkasanDetailUrl(notes, 'EVE108500020260702');
  assert.strictEqual(resolved, `${base}?eventcode=EVE108500020260702`);
}

function testTaoBeachSeatMapNormalization() {
  const bungalowKey = normalizeTaoBeachTableName('Bungalow 15 11:00am');
  assert.strictEqual(resolveTaoBeachSeatMapping(bungalowKey).seatCode, 'Bungalow');

  const lotusKey = normalizeTaoBeachTableName('Lotus Cabana 10 Arrive by 11:00am');
  assert.strictEqual(resolveTaoBeachSeatMapping(lotusKey).seatCode, 'Lotus Cabana');

  const primeKey = normalizeTaoBeachTableName('Prime Daybed 6 11:00am');
  assert.strictEqual(resolveTaoBeachSeatMapping(primeKey).seatCode, 'Prime Daybed');

  const terraceKey = normalizeTaoBeachTableName('Terrace Table 4 Arrive by 11:00am');
  assert.strictEqual(resolveTaoBeachSeatMapping(terraceKey).seatCode, 'Terrace Table');
}

function testTaoBeachInventoryApply() {
  const seats = [
    { code: 'Bungalow', event_price: 1000, event_min_spend: 1000 },
    { code: 'Prime Daybed', event_price: 1000, event_min_spend: 1000 },
    { code: 'Daybed', event_price: 1000, event_min_spend: 1000 },
  ];
  const items = [
    { name: 'Bungalow 15 11:00am', minSpend: 5000, seatCode: 'Bungalow' },
    { name: 'Prime Daybed 6 11:00am', minSpend: 2000, seatCode: 'Prime Daybed' },
    { name: 'Daybed 6 11:00am', minSpend: 1500, seatCode: 'Daybed' },
  ];
  const { seats: applied } = applyInventoryToSeats(seats, items, 'TAO Beach scrap import');
  assert.strictEqual(applied[0].event_price, 5000);
  assert.strictEqual(applied[1].event_price, 2000);
  assert.strictEqual(applied[2].event_price, 1500);
  assert.doesNotThrow(() =>
    assertScrapInventoryPricingApplied(applied, items, 'TAO Beach scrap import')
  );
}

function testTaoBeachEventCodeInference() {
  assert.strictEqual(inferTaoBeachFromEventCode('EVE111300020260710'), true);
  assert.strictEqual(inferTaoBeachFromEventCode('EVE108500020260702'), false);
  assert.strictEqual(inferTaoBeachFromEventCode(''), false);
}

function testTaoBeachDetailUrlAppendsEventCode() {
  const base = 'https://booketing.com/microsite/house/event/61/1113/jonas-blue';
  const withCode = ensureTaoBeachEventCodeOnDetailUrl(base, 'EVE111300020260710');
  assert.strictEqual(withCode, `${base}?eventcode=EVE111300020260710`);
  const notes = `Imported from TAO Beach.\nSource: ${base}`;
  const resolved = resolveTaoBeachDetailUrl(notes, 'EVE111300020260710');
  assert.strictEqual(resolved, `${base}?eventcode=EVE111300020260710`);
}

function testTaoBeachGenericBookRowFilter() {
  assert.strictEqual(isTaoBeachGenericBookRow('Book', { href: '/microsite/house/event/61/1113/?eventcode=EVE111300020260629' }), true);
  assert.strictEqual(isTaoBeachGenericBookRow('Jonas Blue', { href: '/microsite/house/event/61/1113/jonas-blue?eventcode=EVE111300020260710', hasNameEl: true }), false);
  assert.strictEqual(isGenericBookHref('/microsite/house/event/61/1113/?eventcode=EVE111300020260629'), true);
  assert.strictEqual(isGenericBookHref('/microsite/house/event/61/1113/jonas-blue?eventcode=EVE111300020260710'), false);
}

function testPalmTreeBeachSeatMapNormalization() {
  const premiumKey = normalizePalmTreeBeachTableName('Premium Beach Villa 15 11:00am');
  assert.strictEqual(mapPalmTreeBeachTableToSeatCode(premiumKey).seatCode, 'Premium Beach Villa');

  const villaKey = normalizePalmTreeBeachTableName('Beach Villa 15 Arrive by 11:00am');
  assert.strictEqual(resolvePalmTreeBeachSeatMapping(villaKey).seatCode, 'Beach Villa');

  const coastalKey = normalizePalmTreeBeachTableName('Coastal Cabana 12 11:00am');
  assert.strictEqual(resolvePalmTreeBeachSeatMapping(coastalKey).seatCode, 'Coastal Cabana');

  const cabanaKey = normalizePalmTreeBeachTableName('Cabana 12 Arrive by 11:00am');
  assert.strictEqual(resolvePalmTreeBeachSeatMapping(cabanaKey).seatCode, 'Cabana');

  const seasideKey = normalizePalmTreeBeachTableName('Seaside Tables 10 11:00am');
  assert.strictEqual(resolvePalmTreeBeachSeatMapping(seasideKey).seatCode, 'Seaside Tables');

  const oceanKey = normalizePalmTreeBeachTableName('Ocean Bed 6 Arrive by 11:00am');
  assert.strictEqual(resolvePalmTreeBeachSeatMapping(oceanKey).seatCode, 'Ocean Bed');
}

function testPalmTreeBeachInventoryApply() {
  const seats = [
    { code: 'Premium Beach Villa', event_price: 1000, event_min_spend: 1000 },
    { code: 'Beach Villa', event_price: 1000, event_min_spend: 1000 },
    { code: 'Ocean Bed', event_price: 1000, event_min_spend: 1000 },
  ];
  const items = [
    { name: 'Premium Beach Villa 15 11:00am', minSpend: 5000, seatCode: 'Premium Beach Villa' },
    { name: 'Beach Villa 15 11:00am', minSpend: 4000, seatCode: 'Beach Villa' },
    { name: 'Ocean Bed 6 11:00am', minSpend: 1500, seatCode: 'Ocean Bed' },
  ];
  const { seats: applied } = applyInventoryToSeats(seats, items, 'Palm Tree Beach scrap import');
  assert.strictEqual(applied[0].event_price, 5000);
  assert.strictEqual(applied[1].event_price, 4000);
  assert.strictEqual(applied[2].event_price, 1500);
  assert.doesNotThrow(() =>
    assertScrapInventoryPricingApplied(applied, items, 'Palm Tree Beach scrap import')
  );
}

function testPalmTreeBeachEventCodeInference() {
  assert.strictEqual(inferPalmTreeBeachFromEventCode('EVE111700020260711'), true);
  assert.strictEqual(inferPalmTreeBeachFromEventCode('EVE111300020260710'), false);
  assert.strictEqual(inferPalmTreeBeachFromEventCode(''), false);
}

function testPalmTreeBeachDetailUrlAppendsEventCode() {
  const base = 'https://booketing.com/microsite/house/event/61/1117/tiesto';
  const withCode = ensurePalmTreeBeachEventCodeOnDetailUrl(base, 'EVE111700020260711');
  assert.strictEqual(withCode, `${base}?eventcode=EVE111700020260711`);
  assert.strictEqual(
    buildPalmTreeBeachEventDetailUrl(base, 'EVE111700020260711'),
    `${base}?eventcode=EVE111700020260711`
  );
  const notes = `Imported from Palm Tree Beach.\nSource: ${base}`;
  const resolved = resolvePalmTreeBeachDetailUrl(notes, 'EVE111700020260711');
  assert.strictEqual(resolved, `${base}?eventcode=EVE111700020260711`);
}

function testMarqueeDayclubSeatMapNormalization() {
  const grandCabanaKey = normalizeMarqueeDayclubTableName('Grand Cabana 12 11:00am');
  assert.strictEqual(mapMarqueeDayclubTableToSeatCode(grandCabanaKey).seatCode, 'Grand Cabana');

  const cabanaKey = normalizeMarqueeDayclubTableName('Cabana 8 Arrive by 11:00am');
  assert.strictEqual(resolveMarqueeDayclubSeatMapping(cabanaKey).seatCode, 'Cabana');

  const primeDaybedKey = normalizeMarqueeDayclubTableName('Prime Daybed 6 11:00am');
  assert.strictEqual(resolveMarqueeDayclubSeatMapping(primeDaybedKey).seatCode, 'Prime Daybed');

  const daybedKey = normalizeMarqueeDayclubTableName('Daybed 4 11:00am');
  assert.strictEqual(resolveMarqueeDayclubSeatMapping(daybedKey).seatCode, 'Daybed');

  const primeCabanaKey = normalizeMarqueeDayclubTableName('Prime Cabana 10 Arrive by 11:00am');
  assert.strictEqual(resolveMarqueeDayclubSeatMapping(primeCabanaKey).seatCode, 'Prime Cabana');
}

function testMarqueeDayclubInventoryApply() {
  const seats = [
    { code: 'Grand Cabana', event_price: 1000, event_min_spend: 1000 },
    { code: 'Cabana', event_price: 1000, event_min_spend: 1000 },
    { code: 'Prime Daybed', event_price: 1000, event_min_spend: 1000 },
    { code: 'Daybed', event_price: 1000, event_min_spend: 1000 },
  ];
  const items = [
    { name: 'Grand Cabana 12 11:00am', minSpend: 8000, seatCode: 'Grand Cabana' },
    { name: 'Cabana 8 11:00am', minSpend: 5000, seatCode: 'Cabana' },
    { name: 'Prime Daybed 6 11:00am', minSpend: 3000, seatCode: 'Prime Daybed' },
    { name: 'Daybed 4 11:00am', minSpend: 1500, seatCode: 'Daybed' },
  ];
  const { seats: applied } = applyInventoryToSeats(seats, items, 'Marquee Dayclub scrap import');
  assert.strictEqual(applied[0].event_price, 8000);
  assert.strictEqual(applied[1].event_price, 5000);
  assert.strictEqual(applied[2].event_price, 3000);
  assert.strictEqual(applied[3].event_price, 1500);
  assert.doesNotThrow(() =>
    assertScrapInventoryPricingApplied(applied, items, 'Marquee Dayclub scrap import')
  );
}

function testMarqueeDayclubEventCodeInference() {
  assert.strictEqual(inferMarqueeDayclubFromEventCode('EVE110900020260711'), true);
  assert.strictEqual(inferMarqueeDayclubFromEventCode('EVE111700020260711'), false);
  assert.strictEqual(inferMarqueeDayclubFromEventCode(''), false);
}

function testMarqueeDayclubDetailUrlAppendsEventCode() {
  const base = 'https://booketing.com/microsite/house/event/61/1109/dj-pauly-d';
  const withCode = ensureMarqueeDayclubEventCodeOnDetailUrl(base, 'EVE110900020260711');
  assert.strictEqual(withCode, `${base}?eventcode=EVE110900020260711`);
  assert.strictEqual(
    buildMarqueeDayclubEventDetailUrl(base, 'EVE110900020260711'),
    `${base}?eventcode=EVE110900020260711`
  );
  const notes = `Imported from Marquee Dayclub.\nSource: ${base}`;
  const resolved = resolveMarqueeDayclubDetailUrl(notes, 'EVE110900020260711');
  assert.strictEqual(resolved, `${base}?eventcode=EVE110900020260711`);
}

function testMarqueeNightclubSeatMapNormalization() {
  const fullUpperKey = normalizeMarqueeNightclubTableName('Full Upper Dance Floor 12 guests');
  assert.strictEqual(resolveMarqueeNightclubSeatMapping(fullUpperKey).seatCode, 'Full Upper Dance Floor');

  const upperKey = normalizeMarqueeNightclubTableName('Upper Dance Floor 8');
  assert.strictEqual(resolveMarqueeNightclubSeatMapping(upperKey).seatCode, 'Upper Dance Floor');

  const danceKey = normalizeMarqueeNightclubTableName('Dance Floor 10');
  assert.strictEqual(mapMarqueeNightclubTableToSeatCode(danceKey).seatCode, 'Dance Floor');

  const thirdTierKey = normalizeMarqueeNightclubTableName('Third Tier Main Room 6');
  assert.strictEqual(resolveMarqueeNightclubSeatMapping(thirdTierKey).seatCode, 'Third Tier Main Room');

  const cloudKey = normalizeMarqueeNightclubTableName('Cloud 4');
  assert.strictEqual(resolveMarqueeNightclubSeatMapping(cloudKey).seatCode, 'Cloud');
}

function testMarqueeNightclubInventoryApply() {
  const seats = [
    { code: 'Full Upper Dance Floor', event_price: 1000, event_min_spend: 1000 },
    { code: 'Upper Dance Floor', event_price: 1000, event_min_spend: 1000 },
    { code: 'Dance Floor', event_price: 1000, event_min_spend: 1000 },
    { code: 'Cloud', event_price: 1000, event_min_spend: 1000 },
  ];
  const items = [
    { name: 'Full Upper Dance Floor 12', minSpend: 10000, seatCode: 'Full Upper Dance Floor' },
    { name: 'Upper Dance Floor 8', minSpend: 6000, seatCode: 'Upper Dance Floor' },
    { name: 'Dance Floor 10', minSpend: 4000, seatCode: 'Dance Floor' },
    { name: 'Cloud 4', minSpend: 2500, seatCode: 'Cloud' },
  ];
  const { seats: applied } = applyInventoryToSeats(seats, items, 'Marquee Nightclub scrap import');
  assert.strictEqual(applied[0].event_price, 10000);
  assert.strictEqual(applied[1].event_price, 6000);
  assert.strictEqual(applied[2].event_price, 4000);
  assert.strictEqual(applied[3].event_price, 2500);
  assert.doesNotThrow(() =>
    assertScrapInventoryPricingApplied(applied, items, 'Marquee Nightclub scrap import')
  );
}

function testMarqueeNightclubIsoDateFromEventName() {
  assert.strictEqual(isoDateFromEventName('7/3/2026 - DJ Pauly D'), '2026-07-03');
  assert.strictEqual(isoDateFromEventName('DJ Pauly D'), null);
}

function testMarqueeNightclubIsoDateFromTaoSlug() {
  assert.strictEqual(
    isoDateFromTaoSlug('6-29-2026-marquee-mondays-marquee-nightclub'),
    '2026-06-29'
  );
  assert.strictEqual(isoDateFromTaoSlug('7-1-2026-lowkey-in-the-library-marquee-nightclub'), '2026-07-01');
  assert.strictEqual(isoDateFromTaoSlug('invalid-slug'), null);
}

function testMarqueeNightclubIsoDateFromListingDateDisplay() {
  assert.strictEqual(isoDateFromListingDateDisplay('Mon, Jun 29 2026'), '2026-06-29');
  assert.strictEqual(isoDateFromListingDateDisplay('Wed, Jul 1 2026'), '2026-07-01');
  assert.strictEqual(isoDateFromListingDateDisplay(''), null);
}

function testMarqueeNightclubDescriptionSanitize() {
  const boilerplate =
    'Need help? We want your experience to be remarkable. Our Concierge team is available. Please call 702-850-2757.';
  assert.strictEqual(sanitizeMarqueeNightclubDescription(boilerplate), '');
  assert.strictEqual(sanitizeMarqueeNightclubDescription('DJ Pauly D birthday weekend'), 'DJ Pauly D birthday weekend');
}

function testEncoreSeatMapNormalization() {
  assert.strictEqual(
    resolveEncoreSeatMapping(normalizeEncoreTableName('Dancefloor')).seatCode,
    'Dance Floor Water Couch'
  );
  assert.strictEqual(
    resolveEncoreSeatMapping(normalizeEncoreTableName('Center L Couch Section')).seatCode,
    'Center L Couch'
  );
  assert.strictEqual(
    mapEncoreTableToSeatCode(normalizeEncoreTableName('Daybed 6')).seatCode,
    'Daybed'
  );
  assert.strictEqual(
    resolveEncoreSeatMapping(normalizeEncoreTableName('Small Backstage Section')).seatCode,
    'Backstage Section'
  );
  assert.strictEqual(
    resolveEncoreSeatMapping(normalizeEncoreTableName('Large Backstage Section')).seatCode,
    'Large Backstage Section'
  );
}

function testEncoreVenueRouting() {
  assert.strictEqual(normalizeEncoreScope('day'), 'daylife');
  assert.strictEqual(normalizeEncoreScope('night'), 'nightlife');
  assert.strictEqual(inferEncoreVenueTypeFromEventCode('EVE110300020260814'), 'day_club');
  assert.strictEqual(inferEncoreVenueTypeFromEventCode('EVE116300020260814'), 'night_club');
  assert.ok(isEncoreListingVenue('Encore Beach Club'));
  assert.ok(isEncoreListingVenue('Encore Beach Club At Night'));
  assert.ok(!isEncoreListingVenue('XS Nightclub'));
  assert.ok(!isEncoreListingVenue('Wynn Field Club'));

  const day = resolveEncoreVenue({ venueName: 'Encore Beach Club', eventCode: 'EVE110300020260814' });
  assert.strictEqual(day.venueName, 'Encore Beach Club');
  assert.strictEqual(day.venueType, 'day_club');
  assert.strictEqual(day.type, 'day_club');

  const night = resolveEncoreVenue({
    venueName: 'Encore Beach Club At Night',
    eventCode: 'EVE116300020260814',
  });
  assert.strictEqual(night.venueName, 'Encore Beach Club At Night');
  assert.strictEqual(night.venueType, 'night_club');
  assert.notStrictEqual(night.locationId, day.locationId);
}

function testEncoreInventoryApply() {
  const seats = [
    { code: 'Dance Floor Water Couch', event_price: 1000, event_min_spend: 1000 },
    { code: 'Center L Couch', event_price: 1000, event_min_spend: 1000 },
    { code: 'Daybed', event_price: 1000, event_min_spend: 1000 },
  ];
  const items = [
    { name: 'Dancefloor', minSpend: 5000, seatCode: 'Dance Floor Water Couch' },
    { name: 'Center L Couch Section', minSpend: 3500, seatCode: 'Center L Couch' },
    { name: 'Daybed', minSpend: 2000, seatCode: 'Daybed' },
  ];
  const { seats: applied } = applyInventoryToSeats(seats, items, 'Encore Beach scrap import');
  assert.strictEqual(applied[0].event_price, 5000);
  assert.strictEqual(applied[1].event_price, 3500);
  assert.strictEqual(applied[2].event_price, 2000);
  assert.doesNotThrow(() =>
    assertScrapInventoryPricingApplied(applied, items, 'Encore Beach scrap import')
  );
}

function testParseScrapPrepareImportOptions() {
  const local = parseScrapPrepareImportOptions({ eventCode: 'E1', targetPlatform: 'local' });
  assert.strictEqual(local.skipLocalAlreadyImported, false);
  assert.strictEqual(local.listingEvent.eventCode, 'E1');
  assert.strictEqual(local.listingEvent.targetPlatform, undefined);

  const stage = parseScrapPrepareImportOptions({ eventCode: 'E1', targetPlatform: 'stage' });
  assert.strictEqual(stage.skipLocalAlreadyImported, true);
  assert.strictEqual(stage.targetPlatform, 'stage');

  const prod = parseScrapPrepareImportOptions({ eventCode: 'E1', targetPlatform: 'PROD' });
  assert.strictEqual(prod.skipLocalAlreadyImported, true);

  const missing = parseScrapPrepareImportOptions({ eventCode: 'E1' });
  assert.strictEqual(missing.skipLocalAlreadyImported, false);
}

function testLivBeachInventoryRemapForLegacyShortCodes() {
  const stageSeats = [
    { code: 'bv', category: 'beach_villa', label: 'Beach Villa' },
    { code: 'sc', category: 'stage_cabana', label: 'Stage Cabana' },
    { code: 'bc', category: 'beach_cabana', label: 'Beach Cabana' },
    { code: 'bc', category: 'beach_couch', label: 'Beach Couch' },
    { code: 'df', category: 'dance_floor', label: 'Dance Floor' },
  ];
  const inventory = [
    { name: 'Beach Villa', minSpend: 5000, seatCode: 'Beach Villa' },
    { name: 'Stage Cabana', minSpend: 3000, seatCode: 'Stage Cabana' },
    { name: 'Beach Cabana', minSpend: 2500, seatCode: 'Beach Cabana', the1Category: 'beach_cabana' },
    { name: 'Beach Couch', minSpend: 1500, seatCode: 'Beach Couch', the1Category: 'beach_couch' },
    { name: 'Dance Floor', minSpend: 1200, seatCode: 'Dance Floor' },
  ];
  const remapped = remapInventoryItemsForLocationSeats(inventory, stageSeats, { venueKey: 'liv' });
  assert.strictEqual(remapped[0].seatCode, 'bv');
  assert.strictEqual(remapped[1].seatCode, 'sc');
  assert.strictEqual(remapped[2].seatCode, 'bc');
  assert.strictEqual(remapped[2].the1Category, 'beach_cabana');
  assert.strictEqual(remapped[3].seatCode, 'bc');
  assert.strictEqual(remapped[3].the1Category, 'beach_couch');
  assert.strictEqual(remapped[4].seatCode, 'df');

  const { seats } = applyInventoryToSeats(
    stageSeats.map((s) => ({ ...s, event_price: 1000, event_min_spend: 1000 })),
    remapped,
    'LIV scrap import'
  );
  const priced = seats.filter((s) => s.price_change_reason === 'LIV scrap import');
  assert.strictEqual(priced.length, 5);
}

function testScrapIdentityNormalizeAndDayBounds() {
  assert.strictEqual(normalizeScrapEventName('  Gryffin   Live  '), 'gryffin live');
  assert.strictEqual(normalizeScrapEventName(''), '');

  const bounds = scrapEventDayBoundsUtc('2026-08-14', 'America/Los_Angeles');
  assert.ok(bounds);
  assert.ok(bounds.start instanceof Date);
  assert.ok(bounds.end instanceof Date);
  assert.ok(bounds.end.getTime() > bounds.start.getTime());
  // ~24h in LA (DST-aware: 23 or 24 or 25 hours)
  const hours = (bounds.end - bounds.start) / (1000 * 60 * 60);
  assert.ok(hours >= 23 && hours <= 25);

  assert.strictEqual(scrapEventDayBoundsUtc('bad', 'America/Los_Angeles'), null);
  assert.strictEqual(scrapEventDayBoundsUtc(null, 'America/Los_Angeles'), null);
}

function run() {
  testParseMinimumSpend();
  testPayNowNotUsedForCatalog();
  testMissingMinimumSpendSkipped();
  testApplyInventoryPreservesLocationMinSpend();
  testApplyInventoryUnmatchedSeatUnchanged();
  testFilterScrapEventsNotInPast();
  testOmniaBalconySmallMapsToBalconySmall();
  testOmniaDayclubTableMappings();
  testOmniaVenueConfigScope();
  testOmniaDayclubInventoryApply();
  testOmniaDetailUrlAppendsEventCode();
  testHakkasanSeatMapNormalization();
  testHakkasanInventoryApply();
  testHakkasanEventCodeInference();
  testHakkasanDetailUrlAppendsEventCode();
  testTaoBeachSeatMapNormalization();
  testTaoBeachInventoryApply();
  testTaoBeachEventCodeInference();
  testTaoBeachDetailUrlAppendsEventCode();
  testTaoBeachGenericBookRowFilter();
  testPalmTreeBeachSeatMapNormalization();
  testPalmTreeBeachInventoryApply();
  testPalmTreeBeachEventCodeInference();
  testPalmTreeBeachDetailUrlAppendsEventCode();
  testMarqueeDayclubSeatMapNormalization();
  testMarqueeDayclubInventoryApply();
  testMarqueeDayclubEventCodeInference();
  testMarqueeDayclubDetailUrlAppendsEventCode();
  testMarqueeNightclubSeatMapNormalization();
  testMarqueeNightclubInventoryApply();
  testMarqueeNightclubIsoDateFromEventName();
  testMarqueeNightclubIsoDateFromTaoSlug();
  testMarqueeNightclubIsoDateFromListingDateDisplay();
  testMarqueeNightclubDescriptionSanitize();
  testEncoreSeatMapNormalization();
  testEncoreVenueRouting();
  testEncoreInventoryApply();
  testScrapIdentityNormalizeAndDayBounds();
  testParseScrapPrepareImportOptions();
  testLivBeachInventoryRemapForLegacyShortCodes();
  console.log('scrapEventsVenueCatalogPrice.test.js: all passed');
}

run();

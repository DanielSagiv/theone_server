/**
 * Read-only: compare Encore Beach Club day + night seat codes between stage and prod.
 *
 * Usage:
 *   STAGE_MONGODB_URI=... PROD_MONGODB_URI=... node scripts/verify-encore-beach-location-parity.js
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const {
  DEFAULT_DAY_LOCATION_ID,
  DEFAULT_NIGHT_LOCATION_ID,
} = require('../utils/encoreBeachVenueConfig');

const LOG = '[verify-encore-beach-location-parity]';

const EXPECTED_SEAT_CODES = [
  'Backstage Section',
  'Beach Couch',
  'Center L Couch',
  'Center Pool Lily Pad',
  'Dance Floor Section',
  'Dance Floor Water Couch',
  'Daybed',
  'Gaming Section',
  'L Couch',
  'Large Backstage Section',
  'Lily Pad',
  'Lower Bungalow',
  'Lower Cabana',
  'Medium Backstage Section',
  'Patio Section',
  'Water Couch',
].sort();

/**
 * @param {import('mongodb').Db} db
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function loadLocation(db, id) {
  return db.collection('locations').findOne({ _id: new ObjectId(id) });
}

/**
 * @param {object|null} doc
 * @returns {string[]}
 */
function seatCodes(doc) {
  return (doc?.seats || []).map((s) => s.code).filter(Boolean).sort();
}

/**
 * @param {string} label
 * @param {string[]} actual
 * @returns {boolean}
 */
function checkExpected(label, actual) {
  const missing = EXPECTED_SEAT_CODES.filter((c) => !actual.includes(c));
  const extra = actual.filter((c) => !EXPECTED_SEAT_CODES.includes(c));
  if (!missing.length && !extra.length) {
    console.log(`${LOG} ${label}: seat codes match expected (${actual.length} codes)`);
    return true;
  }
  if (missing.length) console.error(`${LOG} ${label}: missing codes:`, missing);
  if (extra.length) console.error(`${LOG} ${label}: extra codes:`, extra);
  return false;
}

async function main() {
  const stageUri = process.env.STAGE_MONGODB_URI;
  const prodUri = process.env.PROD_MONGODB_URI;
  const dayId = process.env.ENCORE_DAY_LOCATION_ID || DEFAULT_DAY_LOCATION_ID;
  const nightId = process.env.ENCORE_NIGHT_LOCATION_ID || DEFAULT_NIGHT_LOCATION_ID;

  if (!stageUri || !prodUri) {
    console.error(`${LOG} Set STAGE_MONGODB_URI and PROD_MONGODB_URI`);
    process.exit(1);
  }

  const stageClient = new MongoClient(stageUri);
  const prodClient = new MongoClient(prodUri);

  try {
    await stageClient.connect();
    await prodClient.connect();
    const stageDb = stageClient.db();
    const prodDb = prodClient.db();

    let ok = true;
    for (const [label, id] of [
      ['day', dayId],
      ['night', nightId],
    ]) {
      const stageLoc = await loadLocation(stageDb, id);
      const prodLoc = await loadLocation(prodDb, id);
      if (!stageLoc) {
        console.error(`${LOG} stage missing ${label} location ${id}`);
        ok = false;
        continue;
      }
      if (!prodLoc) {
        console.error(`${LOG} prod missing ${label} location ${id}`);
        ok = false;
        continue;
      }
      console.log(
        `${LOG} ${label}: stage="${stageLoc.name}" prod="${prodLoc.name}" id=${id}`
      );
      ok = checkExpected(`stage ${label}`, seatCodes(stageLoc)) && ok;
      ok = checkExpected(`prod ${label}`, seatCodes(prodLoc)) && ok;
    }

    process.exit(ok ? 0 : 1);
  } finally {
    await stageClient.close().catch(() => {});
    await prodClient.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err.message || err);
  process.exit(1);
});

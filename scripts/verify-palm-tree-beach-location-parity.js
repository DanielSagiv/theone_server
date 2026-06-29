/**
 * Read-only: compare Palm Tree Beach seat codes between stage and prod.
 *
 * Usage:
 *   STAGE_MONGODB_URI=... PROD_MONGODB_URI=... node scripts/verify-palm-tree-beach-location-parity.js
 *
 * Optional:
 *   PALM_TREE_BEACH_LOCATION_ID=...
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const { DEFAULT_LOCATION_ID } = require('../utils/palmTreeBeachVenueConfig');

const LOG = '[verify-palm-tree-beach-location-parity]';

const EXPECTED_SEAT_CODES = [
  'Premium Beach Villa',
  'Beach Villa',
  'Coastal Cabana',
  'Cabana',
  'Seaside Tables',
  'Shore Table',
  'Boardwalk Table',
  'Ocean Bed',
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
  const locationId = process.env.PALM_TREE_BEACH_LOCATION_ID || DEFAULT_LOCATION_ID;

  if (!stageUri || !prodUri) {
    console.error(`${LOG} Set STAGE_MONGODB_URI and PROD_MONGODB_URI`);
    process.exit(1);
  }

  const stageClient = new MongoClient(stageUri);
  const prodClient = new MongoClient(prodUri);

  try {
    await stageClient.connect();
    await prodClient.connect();

    const stageLoc = await loadLocation(stageClient.db(), locationId);
    const prodLoc = await loadLocation(prodClient.db(), locationId);

    if (!stageLoc) {
      console.error(`${LOG} Stage location not found: ${locationId}`);
      process.exit(1);
    }
    if (!prodLoc) {
      console.error(`${LOG} Prod location not found: ${locationId}`);
      process.exit(1);
    }

    const stageCodes = seatCodes(stageLoc);
    const prodCodes = seatCodes(prodLoc);

    console.log(`${LOG} Location: ${stageLoc.name || 'Palm Tree Beach'} (${locationId})`);

    let ok = checkExpected('stage', stageCodes);
    ok = checkExpected('prod', prodCodes) && ok;

    const onlyStage = stageCodes.filter((c) => !prodCodes.includes(c));
    const onlyProd = prodCodes.filter((c) => !stageCodes.includes(c));
    if (!onlyStage.length && !onlyProd.length) {
      console.log(`${LOG} stage vs prod: seat codes match`);
    } else {
      if (onlyStage.length) console.error(`${LOG} only on stage:`, onlyStage);
      if (onlyProd.length) console.error(`${LOG} only on prod:`, onlyProd);
      ok = false;
    }

    process.exit(ok ? 0 : 1);
  } finally {
    await stageClient.close().catch(() => {});
    await prodClient.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`${LOG} error:`, err.message);
  process.exit(1);
});

/**
 * Read-only: compare OMNIA Night + Omnia DayClub seat codes between stage and prod.
 *
 * Usage:
 *   STAGE_MONGODB_URI=... PROD_MONGODB_URI=... node scripts/verify-omnia-location-parity.js
 *
 * Optional:
 *   OMNIA_LOCATION_ID=...
 *   OMNIA_DAY_LOCATION_ID=...
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const {
  DEFAULT_LOCATION_ID,
  DEFAULT_DAY_LOCATION_ID,
} = require('../utils/omniaVenueConfig');

const LOG = '[verify-omnia-location-parity]';

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
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
function diffCodes(label, a, b) {
  const onlyA = a.filter((c) => !b.includes(c));
  const onlyB = b.filter((c) => !a.includes(c));
  if (!onlyA.length && !onlyB.length) {
    console.log(`${LOG} ${label}: seat codes match (${a.length} codes)`);
    return true;
  }
  console.warn(`${LOG} ${label}: MISMATCH`);
  if (onlyA.length) console.warn(`  only stage: ${onlyA.join(', ')}`);
  if (onlyB.length) console.warn(`  only prod:  ${onlyB.join(', ')}`);
  return false;
}

/**
 * @param {import('mongodb').Db} stageDb
 * @param {import('mongodb').Db} prodDb
 * @param {string} locationId
 * @param {string} label
 * @returns {Promise<boolean>}
 */
async function verifyOneLocation(stageDb, prodDb, locationId, label) {
  const stageDoc = await loadLocation(stageDb, locationId);
  const prodDoc = await loadLocation(prodDb, locationId);
  if (!stageDoc) {
    console.warn(`${LOG} ${label}: missing on stage (${locationId})`);
    return false;
  }
  if (!prodDoc) {
    console.warn(`${LOG} ${label}: missing on prod (${locationId})`);
    return false;
  }
  console.log(`${LOG} ${label}: stage="${stageDoc.name}" prod="${prodDoc.name}" id=${locationId}`);
  return diffCodes(label, seatCodes(stageDoc), seatCodes(prodDoc));
}

async function main() {
  const stageUri = process.env.STAGE_MONGODB_URI || process.env.DB_URI;
  const prodUri = process.env.PROD_MONGODB_URI;
  if (!stageUri || !prodUri) {
    console.error(`${LOG} Set STAGE_MONGODB_URI (or DB_URI) and PROD_MONGODB_URI`);
    process.exit(1);
  }

  const nightLocationId = process.env.OMNIA_LOCATION_ID || DEFAULT_LOCATION_ID;
  const dayLocationId = process.env.OMNIA_DAY_LOCATION_ID || DEFAULT_DAY_LOCATION_ID;

  const stageClient = new MongoClient(stageUri);
  const prodClient = new MongoClient(prodUri);
  let ok = true;

  try {
    await stageClient.connect();
    await prodClient.connect();
    const stageDb = stageClient.db();
    const prodDb = prodClient.db();

    if (!(await verifyOneLocation(stageDb, prodDb, nightLocationId, 'OMNIA Night Club'))) {
      ok = false;
    }
    if (!(await verifyOneLocation(stageDb, prodDb, dayLocationId, 'Omnia DayClub'))) {
      ok = false;
    }
  } finally {
    await stageClient.close().catch(() => {});
    await prodClient.close().catch(() => {});
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(LOG, err.message);
  process.exit(1);
});

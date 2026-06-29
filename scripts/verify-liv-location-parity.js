/**
 * Read-only: compare LIV Night + Beach location seat codes between stage and prod.
 *
 * Usage:
 *   STAGE_MONGODB_URI=... PROD_MONGODB_URI=... node scripts/verify-liv-location-parity.js
 *
 * Optional:
 *   LIV_NIGHT_LOCATION_ID=...
 *   LIV_BEACH_LOCATION_ID=...
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const {
  DEFAULT_NIGHT_LOCATION_ID,
  DEFAULT_BEACH_LOCATION_ID,
} = require('../utils/livVenueConfig');

const LOG = '[verify-liv-location-parity]';

const TARGETS = [
  { key: 'night', envId: 'LIV_NIGHT_LOCATION_ID', defaultId: DEFAULT_NIGHT_LOCATION_ID, label: 'LIV Night club' },
  { key: 'beach', envId: 'LIV_BEACH_LOCATION_ID', defaultId: DEFAULT_BEACH_LOCATION_ID, label: 'LIV Beach club' },
];

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

async function main() {
  const stageUri = process.env.STAGE_MONGODB_URI || process.env.DB_URI;
  const prodUri = process.env.PROD_MONGODB_URI;
  if (!stageUri || !prodUri) {
    console.error(`${LOG} Set STAGE_MONGODB_URI (or DB_URI) and PROD_MONGODB_URI`);
    process.exit(1);
  }

  const stageClient = new MongoClient(stageUri);
  const prodClient = new MongoClient(prodUri);
  let ok = true;

  try {
    await stageClient.connect();
    await prodClient.connect();
    const stageDb = stageClient.db();
    const prodDb = prodClient.db();

    for (const t of TARGETS) {
      const id = process.env[t.envId] || t.defaultId;
      const stageDoc = await loadLocation(stageDb, id);
      const prodDoc = await loadLocation(prodDb, id);
      if (!stageDoc) {
        console.warn(`${LOG} ${t.label}: missing on stage (${id})`);
        ok = false;
        continue;
      }
      if (!prodDoc) {
        console.warn(`${LOG} ${t.label}: missing on prod (${id})`);
        ok = false;
        continue;
      }
      console.log(`${LOG} ${t.label}: stage="${stageDoc.name}" prod="${prodDoc.name}" id=${id}`);
      if (!diffCodes(t.label, seatCodes(stageDoc), seatCodes(prodDoc))) ok = false;
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

/**
 * Idempotent: add Premium Villa + Stage Cabana to Omnia DayClub on stage and prod.
 *
 * Usage:
 *   STAGE_MONGODB_URI=... PROD_MONGODB_URI=... node scripts/sync-omnia-dayclub-seats.js
 *
 * Optional:
 *   OMNIA_DAY_LOCATION_ID=6a35172263c07e4f7521d24b
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const LOG = '[sync-omnia-dayclub-seats]';
const DEFAULT_DAY_LOCATION_ID = '6a35172263c07e4f7521d24b';

/** Seats to add when missing (Booketing TABLES alignment). */
const SEATS_TO_ADD = [
  {
    code: 'Premium Villa',
    label: '',
    category: 'premium_beach_villa',
    the1Category: 'Premium Villa',
    section: '',
    capacity: 15,
    minSpendUSD: 1000,
    priceTier: 1,
    qualityScore: 5,
    polygon: [],
    media: [],
    sentiment: [],
  },
  {
    code: 'Stage Cabana',
    label: '',
    category: 'stage_cabana',
    the1Category: 'Stage Cabana',
    section: '',
    capacity: 12,
    minSpendUSD: 1000,
    priceTier: 1,
    qualityScore: 5,
    polygon: [],
    media: [],
    sentiment: [],
  },
];

/**
 * Ensure every seat has an _id (Mongoose auto-generates on save; raw $push does not).
 * @param {import('mongodb').Db} db
 * @param {string} locationId
 * @param {string} envLabel
 * @returns {Promise<number>} count of seats repaired
 */
async function repairSeatIds(db, locationId, envLabel) {
  const col = db.collection('locations');
  const doc = await col.findOne({ _id: new ObjectId(locationId) });
  if (!doc?.seats?.length) return 0;

  let repaired = 0;
  const seats = doc.seats.map((seat) => {
    if (seat._id) return seat;
    repaired += 1;
    return { ...seat, _id: new ObjectId() };
  });

  if (repaired > 0) {
    await col.updateOne({ _id: new ObjectId(locationId) }, { $set: { seats } });
    console.log(`${LOG} ${envLabel}: repaired ${repaired} seat(s) missing _id on "${doc.name}"`);
  }
  return repaired;
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} locationId
 * @param {string} envLabel
 * @returns {Promise<boolean>}
 */
async function syncLocation(db, locationId, envLabel) {
  const col = db.collection('locations');
  const doc = await col.findOne({ _id: new ObjectId(locationId) });
  if (!doc) {
    console.warn(`${LOG} ${envLabel}: location not found (${locationId})`);
    return false;
  }

  await repairSeatIds(db, locationId, envLabel);

  const refreshed = await col.findOne({ _id: new ObjectId(locationId) });
  const existingCodes = new Set((refreshed?.seats || []).map((s) => s.code));
  const toPush = SEATS_TO_ADD.map((s) => ({ ...s, _id: new ObjectId() })).filter(
    (s) => !existingCodes.has(s.code)
  );

  if (toPush.length === 0) {
    console.log(
      `${LOG} ${envLabel}: "${refreshed.name}" already has all target seats (${[...existingCodes].sort().join(', ')})`
    );
    return true;
  }

  await col.updateOne(
    { _id: new ObjectId(locationId) },
    { $push: { seats: { $each: toPush } } }
  );

  const updated = await col.findOne({ _id: new ObjectId(locationId) });
  const codes = (updated?.seats || []).map((s) => s.code).sort();
  console.log(`${LOG} ${envLabel}: added ${toPush.map((s) => s.code).join(', ')} to "${refreshed.name}"`);
  console.log(`${LOG} ${envLabel}: seat codes now (${codes.length}): ${codes.join(', ')}`);
  return true;
}

async function main() {
  const stageUri = process.env.STAGE_MONGODB_URI || process.env.DB_URI;
  const prodUri = process.env.PROD_MONGODB_URI;
  const locationId = process.env.OMNIA_DAY_LOCATION_ID || DEFAULT_DAY_LOCATION_ID;

  if (!stageUri) {
    console.error(`${LOG} Set STAGE_MONGODB_URI or DB_URI`);
    process.exit(1);
  }

  let ok = true;
  const stageClient = new MongoClient(stageUri);
  await stageClient.connect();
  try {
    if (!(await syncLocation(stageClient.db(), locationId, 'stage'))) ok = false;
  } finally {
    await stageClient.close().catch(() => {});
  }

  if (prodUri) {
    const prodClient = new MongoClient(prodUri);
    await prodClient.connect();
    try {
      if (!(await syncLocation(prodClient.db(), locationId, 'prod'))) ok = false;
    } finally {
      await prodClient.close().catch(() => {});
    }
  } else {
    console.warn(`${LOG} PROD_MONGODB_URI not set — skipped prod sync`);
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(LOG, err.message);
  process.exit(1);
});

/**
 * Recover Encore "Backstage Section" seats removed by removeEncoreBackstageSectionProd.js.
 *
 * Usage (from server/):
 *   node scripts/recoverEncoreBackstageSectionProd.js --backup=scripts/backups/<file>.json
 *   node scripts/recoverEncoreBackstageSectionProd.js --backup=... --confirm-prod
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const LOG = '[recoverEncoreBackstageSectionProd]';

/**
 * @returns {{ confirmProd: boolean, backupPath: string }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let backupPath = '';
  for (const arg of argv) {
    if (arg.startsWith('--backup=')) {
      backupPath = arg.slice('--backup='.length).trim();
    }
  }
  return {
    confirmProd: argv.includes('--confirm-prod'),
    backupPath,
  };
}

/**
 * @returns {string}
 */
function resolveProdMongoUri() {
  const explicit = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) return explicit;
  const stageish =
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    process.env.STAGE_MONGODB_URI ||
    process.env.STAGE_DB_URI ||
    null;
  if (!stageish) {
    throw new Error('Set PROD_MONGODB_URI or DB_URI with /the1-stage to derive the1-PROD');
  }
  if (!/\/the1-stage(\?|$)/i.test(stageish)) {
    throw new Error(
      'Cannot derive prod URI: stage URI must contain /the1-stage, or set PROD_MONGODB_URI'
    );
  }
  return stageish.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * @param {string} uri
 * @returns {string}
 */
function dbNameFromUri(uri) {
  const m = String(uri).match(/\/([^/?]+)(\?|$)/);
  return m ? m[1] : '';
}

/**
 * Rehydrate ObjectIds inside a seat document from backup JSON.
 * @param {object} seat
 * @returns {object}
 */
function reviveSeat(seat) {
  const s = JSON.parse(JSON.stringify(seat));
  if (s._id && typeof s._id === 'string') {
    s._id = new ObjectId(s._id);
  } else if (s._id && s._id.$oid) {
    s._id = new ObjectId(s._id.$oid);
  }
  if (s.seat_id && typeof s.seat_id === 'string') {
    s.seat_id = new ObjectId(s.seat_id);
  } else if (s.seat_id && s.seat_id.$oid) {
    s.seat_id = new ObjectId(s.seat_id.$oid);
  }
  return s;
}

async function main() {
  const { confirmProd, backupPath } = parseArgs();
  if (!backupPath) {
    throw new Error('Required: --backup=scripts/backups/<encore-backstage-section-prod-...>.json');
  }
  const abs = path.isAbsolute(backupPath)
    ? backupPath
    : path.join(process.cwd(), backupPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Backup file not found: ${abs}`);
  }

  const backup = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (backup.seatCode !== 'Backstage Section') {
    throw new Error(`Unexpected backup seatCode: ${backup.seatCode}`);
  }

  const uri = resolveProdMongoUri();
  const dbName = dbNameFromUri(uri);
  if (!/PROD/i.test(dbName)) {
    throw new Error(`Refusing: db name "${dbName}" does not look like prod`);
  }

  console.log(`${LOG} db=${dbName} confirmProd=${confirmProd}`);
  console.log(`${LOG} backup=${abs}`);
  console.log(
    `${LOG} will restore ${backup.locationSeats?.length || 0} location seat(s), ${backup.eventSeats?.length || 0} event seat row(s)`
  );

  if (!confirmProd) {
    console.log(`${LOG} DRY RUN — no writes. Re-run with --confirm-prod to apply.`);
    (backup.locationSeats || []).forEach((row) => {
      console.log(`  location ${row.locationName} (${row.locationId}) seat ${row.seat?._id}`);
    });
    (backup.eventSeats || []).forEach((row) => {
      console.log(`  event ${row.eventName} (${row.eventId}) seats=${row.seats?.length}`);
    });
    return;
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  try {
    for (const row of backup.locationSeats || []) {
      const seat = reviveSeat(row.seat);
      const locId = new ObjectId(row.locationId);
      const existing = await db.collection('locations').findOne(
        { _id: locId, 'seats.code': 'Backstage Section' },
        { projection: { _id: 1 } }
      );
      if (existing) {
        console.warn(
          `${LOG} location ${row.locationName}: "${seat.code}" already present — skip`
        );
        continue;
      }
      const res = await db.collection('locations').updateOne(
        { _id: locId },
        { $push: { seats: seat } }
      );
      console.log(
        `${LOG} location ${row.locationName}: matched=${res.matchedCount} modified=${res.modifiedCount}`
      );
    }

    for (const row of backup.eventSeats || []) {
      const evId = new ObjectId(row.eventId);
      const existing = await db.collection('events').findOne(
        { _id: evId, 'seats.code': 'Backstage Section' },
        { projection: { _id: 1 } }
      );
      if (existing) {
        console.warn(
          `${LOG} event ${row.eventName}: "${row.seats?.[0]?.code}" already present — skip`
        );
        continue;
      }
      const seats = (row.seats || []).map(reviveSeat);
      const res = await db.collection('events').updateOne(
        { _id: evId },
        { $push: { seats: { $each: seats } } }
      );
      console.log(
        `${LOG} event ${row.eventName} (${row.eventId}): matched=${res.matchedCount} modified=${res.modifiedCount}`
      );
    }

    console.log(`${LOG} DONE recover from ${abs}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`${LOG} FATAL:`, err.message || err);
  process.exit(1);
});

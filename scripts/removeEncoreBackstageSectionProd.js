/**
 * ONE-OFF PROD: Remove Encore "Backstage Section" seat from Day + Night locations
 * and matching Event.seats rows. Writes a JSON backup for recovery.
 *
 * Does NOT remove Large Backstage Section or Medium Backstage Section.
 *
 * Usage (from server/):
 *   # Inspect + write backup only (no deletes)
 *   node scripts/removeEncoreBackstageSectionProd.js
 *
 *   # Apply deletes (requires explicit flag; refuses non-PROD db name)
 *   node scripts/removeEncoreBackstageSectionProd.js --confirm-prod
 *
 * Recover:
 *   node scripts/recoverEncoreBackstageSectionProd.js --backup=scripts/backups/<file>.json --confirm-prod
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const {
  DEFAULT_DAY_LOCATION_ID,
  DEFAULT_NIGHT_LOCATION_ID,
} = require('../utils/encoreBeachVenueConfig');

const LOG = '[removeEncoreBackstageSectionProd]';
const SEAT_CODE = 'Backstage Section';
const SEAT_CATEGORY = 'backstage_section';

/**
 * @returns {{ confirmProd: boolean }}
 */
function parseArgs() {
  return { confirmProd: process.argv.slice(2).includes('--confirm-prod') };
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
 * @param {object} seat
 * @returns {boolean}
 */
function isTargetSeat(seat) {
  const code = String(seat?.code || '').trim();
  return code === SEAT_CODE;
}

async function main() {
  const { confirmProd } = parseArgs();
  const uri = resolveProdMongoUri();
  const dbName = dbNameFromUri(uri);
  if (!/PROD/i.test(dbName)) {
    throw new Error(`Refusing: db name "${dbName}" does not look like prod (expected *PROD*)`);
  }

  const dayId = process.env.ENCORE_DAY_LOCATION_ID || DEFAULT_DAY_LOCATION_ID;
  const nightId = process.env.ENCORE_NIGHT_LOCATION_ID || DEFAULT_NIGHT_LOCATION_ID;
  const locationIds = [dayId, nightId].map((id) => new ObjectId(String(id)));

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  try {
    console.log(`${LOG} db=${dbName} confirmProd=${confirmProd}`);
    console.log(`${LOG} locations day=${dayId} night=${nightId}`);
    console.log(`${LOG} target seat code="${SEAT_CODE}"`);

    const locations = await db
      .collection('locations')
      .find({ _id: { $in: locationIds } })
      .project({ name: 1, seats: 1 })
      .toArray();

    if (locations.length !== 2) {
      throw new Error(
        `Expected 2 Encore locations, found ${locations.length}: ${locations.map((l) => l.name).join(', ')}`
      );
    }

    /** @type {Array<{ locationId: string, locationName: string, seat: object }>} */
    const locationSeatBackups = [];
    const seatObjectIds = [];

    for (const loc of locations) {
      const matches = (loc.seats || []).filter(isTargetSeat);
      if (matches.length === 0) {
        console.warn(`${LOG} location "${loc.name}" (${loc._id}): no "${SEAT_CODE}" seat`);
        continue;
      }
      if (matches.length > 1) {
        throw new Error(
          `Location "${loc.name}" has ${matches.length} seats named "${SEAT_CODE}" — aborting`
        );
      }
      const seat = matches[0];
      locationSeatBackups.push({
        locationId: String(loc._id),
        locationName: loc.name || '',
        seat: JSON.parse(JSON.stringify(seat)),
      });
      if (seat._id) seatObjectIds.push(seat._id);
      console.log(
        `${LOG} location "${loc.name}": will remove seat _id=${seat._id} code=${seat.code} category=${seat.category}`
      );
    }

    if (!locationSeatBackups.length) {
      console.log(`${LOG} nothing to remove on locations; exiting`);
      return;
    }

    // Preflight COE refs
    const seatIdStrs = seatObjectIds.map((id) => String(id));
    const coeHitFilter = {
      $or: [
        { 'selected_seats.seat_id': { $in: seatObjectIds } },
        { 'selected_seats.seat_code': SEAT_CODE },
        {
          'selected_seats.category': {
            $in: [SEAT_CATEGORY, SEAT_CODE, 'Backstage Section'],
          },
        },
        { 'events.selected_seats.seat_id': { $in: seatObjectIds } },
        { 'events.selected_seats.seat_code': SEAT_CODE },
        { 'upgrade_requests.current_seat_id': { $in: seatObjectIds } },
        { 'upgrade_requests.target_seat_id': { $in: seatObjectIds } },
        { 'seat_upgrades.current_seat_id': { $in: seatObjectIds } },
        { 'seat_upgrades.target_seat_id': { $in: seatObjectIds } },
      ],
    };

    const coeHits = await db
      .collection('coes')
      .find(coeHitFilter)
      .project({ _id: 1, name: 1, status: 1 })
      .limit(50)
      .toArray();

    const activeCoeHits = coeHits.filter(
      (c) => String(c.status || '').toLowerCase() !== 'deleted'
    );
    const deletedCoeHits = coeHits.filter(
      (c) => String(c.status || '').toLowerCase() === 'deleted'
    );

    if (deletedCoeHits.length) {
      console.warn(
        `${LOG} COE preflight: ${deletedCoeHits.length} soft-deleted COE(s) still reference this seat (ok to proceed):`
      );
      deletedCoeHits.forEach((c) =>
        console.warn(`  - ${c._id} name=${c.name || ''} status=${c.status || ''}`)
      );
    }

    if (activeCoeHits.length) {
      console.error(
        `${LOG} ABORT: ${activeCoeHits.length} active COE(s) still reference this seat:`
      );
      activeCoeHits.forEach((c) =>
        console.error(`  - ${c._id} name=${c.name || ''} status=${c.status || ''}`)
      );
      throw new Error('Active COE references remain — delete/reassign those COEs first');
    }
    console.log(`${LOG} COE preflight: OK (0 active hits)`);

    // Also scan for seat_id as string (legacy) — ignore soft-deleted
    const coeStringHits = await db
      .collection('coes')
      .countDocuments({
        status: { $ne: 'deleted' },
        $or: [
          { 'selected_seats.seat_id': { $in: seatIdStrs } },
          { 'selected_seats.seat_code': SEAT_CODE },
        ],
      });
    if (coeStringHits > 0) {
      throw new Error(`COE string-id preflight found ${coeStringHits} active hit(s) — aborting`);
    }

    // Events that embed this seat (by location + code, or seat_id)
    const eventFilter = {
      location_id: { $in: locationIds },
      'seats.code': SEAT_CODE,
    };

    const events = await db
      .collection('events')
      .find(eventFilter)
      .project({ _id: 1, name: 1, location_id: 1, seats: 1, start_datetime: 1 })
      .toArray();

    /** @type {Array<{ eventId: string, eventName: string, locationId: string, seats: object[] }>} */
    const eventSeatBackups = [];
    for (const ev of events) {
      // Only backup exact Backstage Section by code — leave Large/Medium alone
      const toRemove = (ev.seats || []).filter(isTargetSeat);
      if (!toRemove.length) continue;
      eventSeatBackups.push({
        eventId: String(ev._id),
        eventName: ev.name || '',
        locationId: String(ev.location_id || ''),
        seats: JSON.parse(JSON.stringify(toRemove)),
      });
    }

    console.log(
      `${LOG} events with "${SEAT_CODE}" seat: ${eventSeatBackups.length}`
    );

    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(
      backupDir,
      `encore-backstage-section-prod-${stamp}.json`
    );
    const backupPayload = {
      createdAt: new Date().toISOString(),
      dbName,
      seatCode: SEAT_CODE,
      seatCategory: SEAT_CATEGORY,
      locationIds: [dayId, nightId],
      locationSeats: locationSeatBackups,
      eventSeats: eventSeatBackups,
    };
    fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2), 'utf8');
    console.log(`${LOG} backup written: ${backupPath}`);

    if (!confirmProd) {
      console.log(`${LOG} DRY RUN — no deletes. Re-run with --confirm-prod to apply.`);
      console.log(
        `${LOG} recover later: node scripts/recoverEncoreBackstageSectionProd.js --backup=${backupPath} --confirm-prod`
      );
      return;
    }

    // Apply location $pull
    for (const row of locationSeatBackups) {
      const res = await db.collection('locations').updateOne(
        { _id: new ObjectId(row.locationId) },
        { $pull: { seats: { code: SEAT_CODE } } }
      );
      console.log(
        `${LOG} location ${row.locationName}: matched=${res.matchedCount} modified=${res.modifiedCount}`
      );
    }

    // Apply event $pull by code (scoped to Encore locations)
    const eventPull = await db.collection('events').updateMany(
      { location_id: { $in: locationIds } },
      { $pull: { seats: { code: SEAT_CODE } } }
    );
    console.log(
      `${LOG} events pull: matched=${eventPull.matchedCount} modified=${eventPull.modifiedCount}`
    );

    console.log(`${LOG} DONE. Backup: ${backupPath}`);
    console.log(
      `${LOG} recover: node scripts/recoverEncoreBackstageSectionProd.js --backup=${backupPath} --confirm-prod`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`${LOG} FATAL:`, err.message || err);
  process.exit(1);
});

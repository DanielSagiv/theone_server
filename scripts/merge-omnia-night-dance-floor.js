/**
 * Idempotent: copy OMNIA Nightclub "Dance Floor" media onto "Main Room Dance Floor",
 * then remove "Dance Floor" from that location and its events (stage + prod).
 *
 * Does NOT touch OMNIA Dayclub or any other venue.
 *
 * Usage (from server/):
 *   node scripts/merge-omnia-night-dance-floor.js
 *   node scripts/merge-omnia-night-dance-floor.js --confirm-stage
 *   node scripts/merge-omnia-night-dance-floor.js --confirm-prod
 *   node scripts/merge-omnia-night-dance-floor.js --confirm-stage --confirm-prod
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { DEFAULT_LOCATION_ID } = require('../utils/omniaVenueConfig');

const LOG = '[merge-omnia-night-dance-floor]';
const DF_CODE = 'Dance Floor';
const MRDF_CODE = 'Main Room Dance Floor';
const MRDF_CATEGORY = 'main_room_dance_floor_short';
const MRDF_THE1 = 'Main Room Dance Floor';
const EXPECTED_LOCATION_NAME = /omnia\s*nightclub/i;

/**
 * @returns {{ confirmStage: boolean, confirmProd: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    confirmStage: args.includes('--confirm-stage'),
    confirmProd: args.includes('--confirm-prod'),
  };
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
 * @returns {string}
 */
function resolveStageMongoUri() {
  const uri =
    process.env.STAGE_MONGODB_URI ||
    process.env.STAGE_DB_URI ||
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    null;
  if (!uri) {
    throw new Error('Set STAGE_MONGODB_URI or DB_URI');
  }
  return uri;
}

/**
 * @param {string} stageUri
 * @returns {string}
 */
function resolveProdMongoUri(stageUri) {
  const explicit = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) return explicit;
  if (!/\/the1-stage(\?|$)/i.test(stageUri)) {
    throw new Error(
      'Cannot derive prod URI: stage URI must contain /the1-stage, or set PROD_MONGODB_URI'
    );
  }
  return stageUri.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * @param {object} seat
 * @param {string} code
 * @returns {boolean}
 */
function seatCodeIs(seat, code) {
  return String(seat?.code || '').trim() === code;
}

/**
 * @param {object} value
 * @returns {object}
 */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} id
 * @returns {Array<import('mongodb').ObjectId|string>}
 */
function idVariants(id) {
  if (!id) return [];
  const str = String(id);
  const out = [str];
  if (ObjectId.isValid(str) && String(new ObjectId(str)) === str) {
    out.push(new ObjectId(str));
  }
  return out;
}

/**
 * @param {object} db
 * @param {Array<import('mongodb').ObjectId|string>} seatIds
 */
async function assertNoActiveCoeHits(db, seatIds) {
  const variants = [];
  for (const id of seatIds) {
    variants.push(...idVariants(id));
  }
  if (!variants.length) {
    console.log(`${LOG} COE preflight: no seat ids to check`);
    return;
  }

  const filter = {
    status: { $ne: 'deleted' },
    $or: [
      { 'selected_seats.seat_id': { $in: variants } },
      { 'events.selected_seats.seat_id': { $in: variants } },
      { 'upgrade_requests.current_seat_id': { $in: variants } },
      { 'upgrade_requests.target_seat_id': { $in: variants } },
      { 'seat_upgrades.current_seat_id': { $in: variants } },
      { 'seat_upgrades.target_seat_id': { $in: variants } },
    ],
  };

  const hits = await db
    .collection('coes')
    .find(filter)
    .project({ _id: 1, name: 1, status: 1 })
    .limit(20)
    .toArray();

  if (hits.length) {
    hits.forEach((c) =>
      console.error(`  - ${c._id} name=${c.name || ''} status=${c.status || ''}`)
    );
    throw new Error(
      `ABORT: ${hits.length} active COE(s) still reference an OMNIA Nightclub Dance Floor seat id`
    );
  }
  console.log(`${LOG} COE preflight: OK (0 active hits)`);
}

/**
 * @param {object[]} seats
 * @param {object[]} mediaClone
 * @param {string} mrdfLocationSeatId
 * @returns {{ seats: object[], pulledDf: object[], renamedDf: object|null, updatedMrdf: boolean }}
 */
function transformEventSeats(seats, mediaClone, mrdfLocationSeatId) {
  const list = Array.isArray(seats) ? seats : [];
  const dfSeats = list.filter((s) => seatCodeIs(s, DF_CODE));
  const mrSeats = list.filter((s) => seatCodeIs(s, MRDF_CODE));
  if (dfSeats.length > 1) {
    throw new Error(`Event has ${dfSeats.length} "${DF_CODE}" seats — aborting`);
  }
  if (mrSeats.length > 1) {
    throw new Error(`Event has ${mrSeats.length} "${MRDF_CODE}" seats — aborting`);
  }

  const hasMedia = Array.isArray(mediaClone) && mediaClone.length > 0;

  if (mrSeats.length) {
    let updatedMrdf = false;
    const next = list
      .filter((s) => !seatCodeIs(s, DF_CODE))
      .map((s) => {
        if (!seatCodeIs(s, MRDF_CODE) || !hasMedia) return s;
        updatedMrdf = true;
        return { ...s, media: cloneJson(mediaClone) };
      });
    return {
      seats: next,
      pulledDf: dfSeats,
      renamedDf: null,
      updatedMrdf,
    };
  }

  if (dfSeats.length) {
    const renamed = {
      ...dfSeats[0],
      code: MRDF_CODE,
      category: MRDF_CATEGORY,
      the1Category: MRDF_THE1,
      location_seat_id: mrdfLocationSeatId || dfSeats[0].location_seat_id,
    };
    if (hasMedia) renamed.media = cloneJson(mediaClone);
    const next = list.map((s) => (seatCodeIs(s, DF_CODE) ? renamed : s));
    return {
      seats: next,
      pulledDf: [],
      renamedDf: dfSeats[0],
      updatedMrdf: true,
    };
  }

  return { seats: list, pulledDf: [], renamedDf: null, updatedMrdf: false };
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} envLabel
 * @param {boolean} confirm
 * @param {string} locationId
 */
async function processDb(db, envLabel, confirm, locationId) {
  const nightId = new ObjectId(String(locationId));
  const loc = await db.collection('locations').findOne({ _id: nightId });
  if (!loc) {
    throw new Error(`${envLabel}: location ${locationId} not found`);
  }
  if (!EXPECTED_LOCATION_NAME.test(String(loc.name || ''))) {
    throw new Error(
      `${envLabel}: refusing location name "${loc.name || ''}" (expected OMNIA Nightclub)`
    );
  }

  const seats = loc.seats || [];
  const dfMatches = seats.filter((s) => seatCodeIs(s, DF_CODE));
  const mrMatches = seats.filter((s) => seatCodeIs(s, MRDF_CODE));
  if (dfMatches.length > 1) {
    throw new Error(
      `${envLabel}: location has ${dfMatches.length} "${DF_CODE}" seats — aborting`
    );
  }
  if (mrMatches.length !== 1) {
    throw new Error(
      `${envLabel}: expected 1 "${MRDF_CODE}" seat, found ${mrMatches.length}`
    );
  }

  const dfSeat = dfMatches[0] || null;
  const mrSeat = mrMatches[0];
  const mediaClone = dfSeat
    ? cloneJson(dfSeat.media || [])
    : cloneJson(mrSeat.media || []);
  if (dfSeat && (!Array.isArray(dfSeat.media) || !dfSeat.media.length)) {
    throw new Error(`${envLabel}: "${DF_CODE}" has no media to copy`);
  }

  const events = await db
    .collection('events')
    .find({
      location_id: nightId,
      $or: [{ 'seats.code': DF_CODE }, { 'seats.code': MRDF_CODE }],
    })
    .project({ _id: 1, name: 1, location_id: 1, seats: 1, start_datetime: 1 })
    .toArray();

  const eventPlans = events.map((ev) => {
    const result = transformEventSeats(
      ev.seats || [],
      mediaClone,
      mrSeat._id ? String(mrSeat._id) : ''
    );
    return {
      eventId: String(ev._id),
      eventName: ev.name || '',
      start: ev.start_datetime || null,
      originalSeats: cloneJson(ev.seats || []),
      nextSeats: result.seats,
      pulledDf: cloneJson(result.pulledDf),
      renamedDf: result.renamedDf ? cloneJson(result.renamedDf) : null,
      updatedMrdf: result.updatedMrdf,
      changed: JSON.stringify(ev.seats || []) !== JSON.stringify(result.seats),
    };
  });

  const pullSeatIds = [];
  if (dfSeat?._id) pullSeatIds.push(dfSeat._id);
  for (const plan of eventPlans) {
    for (const seat of plan.pulledDf) {
      if (seat._id) pullSeatIds.push(seat._id);
    }
  }
  await assertNoActiveCoeHits(db, pullSeatIds);

  const backupDir = path.join(__dirname, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(
    backupDir,
    `omnia-night-dance-floor-${envLabel}-${stamp}.json`
  );
  const backupPayload = {
    createdAt: new Date().toISOString(),
    envLabel,
    dbName: db.databaseName,
    locationId: String(loc._id),
    locationName: loc.name || '',
    danceFloorSeat: dfSeat ? cloneJson(dfSeat) : null,
    mainRoomDanceFloorSeat: cloneJson(mrSeat),
    mediaCopied: mediaClone,
    events: eventPlans.map((p) => ({
      eventId: p.eventId,
      eventName: p.eventName,
      start: p.start,
      pulledDf: p.pulledDf,
      renamedDf: p.renamedDf,
      originalSeats: p.originalSeats,
    })),
  };
  fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2), 'utf8');
  console.log(`${LOG} ${envLabel}: backup written ${backupPath}`);
  console.log(
    `${LOG} ${envLabel}: location="${loc.name}" seats=${seats.length} df=${dfSeat ? 'present' : 'already gone'} mrdf=${mrSeat._id}`
  );
  console.log(
    `${LOG} ${envLabel}: events=${eventPlans.length} pull=${eventPlans.filter((p) => p.pulledDf.length).length} rename=${eventPlans.filter((p) => p.renamedDf).length} mediaUpdate=${eventPlans.filter((p) => p.updatedMrdf).length}`
  );

  if (!confirm) {
    console.log(`${LOG} ${envLabel}: DRY RUN — no writes. Re-run with --confirm-${envLabel}`);
    return { backupPath, applied: false };
  }

  if (dfSeat) {
    const mediaRes = await db.collection('locations').updateOne(
      { _id: nightId, 'seats.code': MRDF_CODE },
      { $set: { 'seats.$.media': mediaClone } }
    );
    const pullRes = await db.collection('locations').updateOne(
      { _id: nightId },
      { $pull: { seats: { code: DF_CODE } } }
    );
    console.log(
      `${LOG} ${envLabel}: location media matched=${mediaRes.matchedCount} modified=${mediaRes.modifiedCount}; pull matched=${pullRes.matchedCount} modified=${pullRes.modifiedCount}`
    );
  } else {
    console.log(`${LOG} ${envLabel}: location already has no "${DF_CODE}" — skip location write`);
  }

  let eventWrites = 0;
  for (const plan of eventPlans) {
    if (!plan.changed) continue;
    const res = await db.collection('events').updateOne(
      { _id: new ObjectId(plan.eventId) },
      { $set: { seats: plan.nextSeats } }
    );
    eventWrites += res.modifiedCount;
  }
  console.log(`${LOG} ${envLabel}: events modified=${eventWrites}`);
  console.log(`${LOG} ${envLabel}: DONE. Backup: ${backupPath}`);
  return { backupPath, applied: true };
}

async function main() {
  const { confirmStage, confirmProd } = parseArgs();
  const locationId = process.env.OMNIA_LOCATION_ID || DEFAULT_LOCATION_ID;
  const stageUri = resolveStageMongoUri();
  const prodUri = resolveProdMongoUri(stageUri);

  const targets = [
    { envLabel: 'stage', uri: stageUri, confirm: confirmStage, expect: /stage/i },
    { envLabel: 'prod', uri: prodUri, confirm: confirmProd, expect: /PROD/i },
  ];

  for (const target of targets) {
    const dbName = dbNameFromUri(target.uri);
    if (!target.expect.test(dbName)) {
      throw new Error(
        `Refusing ${target.envLabel}: db name "${dbName}" does not match ${target.expect}`
      );
    }
    const client = new MongoClient(target.uri);
    await client.connect();
    try {
      const db = client.db(dbName);
      console.log(`${LOG} --- ${target.envLabel} db=${dbName} confirm=${target.confirm} ---`);
      await processDb(db, target.envLabel, target.confirm, locationId);
    } finally {
      await client.close();
    }
  }
}

main().catch((err) => {
  console.error(`${LOG} FATAL:`, err.message || err);
  process.exit(1);
});

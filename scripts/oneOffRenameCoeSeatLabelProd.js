/**
 * ONE-OFF: Rename display section on a single prod COE from Beach Couch → (upgraded) Beach Villa.
 *
 * Target COE: 6a4d22f86565357965232f78
 * Updates only selected_seats[].category / .section for matching Beach Couch rows.
 * Does not change seat_id, seat_code, prices, totals, or payment fields.
 *
 * Usage (from server/):
 *   # Inspect only (safe; no write)
 *   PROD_MONGODB_URI="mongodb+srv://.../the1-PROD?..." \
 *     node scripts/oneOffRenameCoeSeatLabelProd.js
 *
 *   # Or derive prod URI from stage (the1-stage → the1-PROD):
 *   DB_URI="mongodb+srv://.../the1-stage?..." \
 *     node scripts/oneOffRenameCoeSeatLabelProd.js
 *
 *   # Apply write (requires explicit flag + prod DB name):
 *   PROD_MONGODB_URI="..." \
 *     node scripts/oneOffRenameCoeSeatLabelProd.js --confirm-prod
 *
 * Do not run against stage. App upgrade flows are unchanged — display-only label fix.
 */

require('dotenv').config();
const {MongoClient, ObjectId} = require('mongodb');

const LOG = '[oneOffRenameCoeSeatLabelProd]';
const COE_ID = '6a4d22f86565357965232f78';
const NEW_LABEL = '(upgraded) Beach Villa';
const MATCH_RE = /beach[\s_]*couch/i;

/**
 * @returns {{ confirmProd: boolean }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    confirmProd: argv.includes('--confirm-prod'),
  };
}

/**
 * Resolve prod Mongo URI (explicit PROD_* or the1-stage → the1-PROD).
 * @returns {string}
 */
function resolveProdMongoUri() {
  const explicit =
    process.env.PROD_MONGODB_URI ||
    process.env.PROD_DB_URI ||
    null;
  if (explicit) {
    return explicit;
  }
  const stageish =
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    process.env.STAGE_MONGODB_URI ||
    process.env.STAGE_DB_URI ||
    null;
  if (!stageish) {
    throw new Error(
      'Set PROD_MONGODB_URI (preferred) or DB_URI/STAGE_MONGODB_URI with /the1-stage to derive the1-PROD',
    );
  }
  if (!/\/the1-stage(\?|$)/i.test(stageish)) {
    throw new Error(
      'Cannot derive prod URI: stage URI must contain /the1-stage, or set PROD_MONGODB_URI',
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
 * @param {unknown} value
 * @returns {boolean}
 */
function labelLooksLikeBeachCouch(value) {
  if (value == null) return false;
  return MATCH_RE.test(String(value));
}

/**
 * @param {object} seat
 * @returns {boolean}
 */
function seatMatchesBeachCouch(seat) {
  if (!seat || typeof seat !== 'object') return false;
  return (
    labelLooksLikeBeachCouch(seat.category) ||
    labelLooksLikeBeachCouch(seat.section) ||
    labelLooksLikeBeachCouch(seat.section_name) ||
    labelLooksLikeBeachCouch(seat.seat_code)
  );
}

/**
 * @param {object} seat
 * @returns {object}
 */
function summarizeSeat(seat) {
  return {
    seat_id: seat.seat_id != null ? String(seat.seat_id) : null,
    seat_code: seat.seat_code ?? null,
    category: seat.category ?? null,
    section: seat.section ?? null,
    event_price: seat.event_price ?? null,
    base_price: seat.base_price ?? null,
  };
}

async function main() {
  const {confirmProd} = parseArgs();
  const uri = resolveProdMongoUri();
  const dbName = dbNameFromUri(uri);

  console.log(`${LOG} db=${dbName} coeId=${COE_ID} confirmProd=${confirmProd}`);

  if (!/prod/i.test(dbName)) {
    console.error(
      `${LOG} Refusing to run: database name "${dbName}" does not look like prod (expected name containing "PROD").`,
    );
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const coes = db.collection('coes');

    const coe = await coes.findOne(
      {_id: new ObjectId(COE_ID)},
      {
        projection: {
          name: 1,
          status: 1,
          payment_status: 1,
          total: 1,
          selected_seats: 1,
        },
      },
    );

    if (!coe) {
      console.error(`${LOG} COE not found: ${COE_ID}`);
      process.exit(1);
    }

    const seats = Array.isArray(coe.selected_seats) ? coe.selected_seats : [];
    console.log(`${LOG} Loaded COE`, {
      name: coe.name,
      status: coe.status,
      payment_status: coe.payment_status,
      total: coe.total,
      selected_seats_count: seats.length,
      seats: seats.map(summarizeSeat),
    });

    const matchIndexes = [];
    seats.forEach((seat, idx) => {
      if (seatMatchesBeachCouch(seat)) {
        matchIndexes.push(idx);
      }
    });

    if (matchIndexes.length === 0) {
      console.error(
        `${LOG} No selected_seats matched Beach Couch (category/section/seat_code). Aborting.`,
      );
      process.exit(1);
    }

    console.log(`${LOG} Matching seat indexes:`, matchIndexes);
    matchIndexes.forEach(idx => {
      console.log(`${LOG} BEFORE[${idx}]`, summarizeSeat(seats[idx]));
    });

    if (!confirmProd) {
      console.log(
        `${LOG} Dry run only. Re-run with --confirm-prod to write:\n` +
          `  category/section → "${NEW_LABEL}" on matched seats only.`,
      );
      return;
    }

    const updatedSeats = seats.map((seat, idx) => {
      if (!matchIndexes.includes(idx)) {
        return seat;
      }
      return {
        ...seat,
        category: NEW_LABEL,
        section: NEW_LABEL,
      };
    });

    const result = await coes.updateOne(
      {_id: new ObjectId(COE_ID)},
      {$set: {selected_seats: updatedSeats}},
    );

    console.log(`${LOG} updateOne`, {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });

    const after = await coes.findOne(
      {_id: new ObjectId(COE_ID)},
      {projection: {selected_seats: 1, total: 1, payment_status: 1}},
    );
    const afterSeats = Array.isArray(after?.selected_seats) ? after.selected_seats : [];
    matchIndexes.forEach(idx => {
      console.log(`${LOG} AFTER[${idx}]`, summarizeSeat(afterSeats[idx]));
    });
    console.log(`${LOG} Unchanged payment/total check`, {
      payment_status: after?.payment_status,
      total: after?.total,
    });
    console.log(`${LOG} Done.`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(`${LOG} Fatal:`, err);
  process.exit(1);
});

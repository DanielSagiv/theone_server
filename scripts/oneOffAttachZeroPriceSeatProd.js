/**
 * ONE-OFF: Attach a selected_seats row for the $0 Layton Giordani event on one prod COE
 * so mobile can show the chosen section.
 *
 * Target COE: 6a6c97b1ce6d894fe16b4291
 * Target event: 6a6a3637d87e7c29eccb13e4 (Layton Giordani)
 * Default category: DJ_Table_Backstage
 *
 * Does not change COE totals, fee_breakdown, payment fields, or event inventory status.
 *
 * Usage (from server/):
 *   node scripts/oneOffAttachZeroPriceSeatProd.js
 *   node scripts/oneOffAttachZeroPriceSeatProd.js --confirm-prod
 *   node scripts/oneOffAttachZeroPriceSeatProd.js --category=premium_balcony --confirm-prod
 */

require('dotenv').config();
const {MongoClient, ObjectId} = require('mongodb');

const LOG = '[oneOffAttachZeroPriceSeatProd]';
const COE_ID = '6a6c97b1ce6d894fe16b4291';
const EVENT_ID = '6a6a3637d87e7c29eccb13e4';
const DEFAULT_CATEGORY = 'DJ_Table_Backstage';

/**
 * @returns {{ confirmProd: boolean, category: string }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let category = DEFAULT_CATEGORY;
  for (const arg of argv) {
    if (arg.startsWith('--category=')) {
      category = arg.slice('--category='.length).trim() || DEFAULT_CATEGORY;
    }
  }
  return {
    confirmProd: argv.includes('--confirm-prod'),
    category,
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
 * Prefer available inventory seat in category; else any matching category.
 * @param {object[]} seats
 * @param {string} category
 * @returns {object|null}
 */
function pickInventorySeat(seats, category) {
  const cat = String(category || '').trim();
  if (!cat || !Array.isArray(seats)) return null;
  const matches = seats.filter(
    s => String(s?.category || s?.section || '').trim() === cat,
  );
  if (matches.length === 0) return null;
  return (
    matches.find(s => s.status === 'available') ||
    matches[0] ||
    null
  );
}

/**
 * @param {object} seat
 * @returns {object}
 */
function summarizeSeat(seat) {
  return {
    event_id: seat.event_id != null ? String(seat.event_id) : null,
    seat_id: seat.seat_id != null ? String(seat.seat_id) : null,
    seat_code: seat.seat_code ?? null,
    category: seat.category ?? null,
    event_price: seat.event_price ?? null,
    base_price: seat.base_price ?? null,
    venue_catalog_price: seat.venue_catalog_price ?? null,
    status: seat.status ?? null,
  };
}

async function main() {
  const {confirmProd, category} = parseArgs();
  const uri = resolveProdMongoUri();
  const dbName = dbNameFromUri(uri);

  console.log(
    `${LOG} db=${dbName} coeId=${COE_ID} eventId=${EVENT_ID} category=${category} confirmProd=${confirmProd}`,
  );

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
    const events = db.collection('events');

    const coeId = new ObjectId(COE_ID);
    const eventId = new ObjectId(EVENT_ID);

    const coe = await coes.findOne(
      {_id: coeId},
      {
        projection: {
          name: 1,
          status: 1,
          payment_status: 1,
          subtotal: 1,
          total: 1,
          fees: 1,
          fee_breakdown: 1,
          events: 1,
          selected_seats: 1,
        },
      },
    );

    if (!coe) {
      console.error(`${LOG} COE not found: ${COE_ID}`);
      process.exit(1);
    }

    const seats = Array.isArray(coe.selected_seats) ? coe.selected_seats : [];
    const existingForEvent = seats.filter(
      s => String(s?.event_id) === EVENT_ID,
    );

    console.log(`${LOG} Loaded COE`, {
      name: coe.name,
      status: coe.status,
      payment_status: coe.payment_status,
      subtotal: coe.subtotal,
      total: coe.total,
      fees: coe.fees,
      selected_seats_count: seats.length,
      existing_for_target_event: existingForEvent.map(summarizeSeat),
    });

    if (existingForEvent.length > 0) {
      console.error(
        `${LOG} selected_seats already exist for event ${EVENT_ID}. Aborting (idempotent).`,
      );
      process.exit(1);
    }

    const coeEvent = (coe.events || []).find(
      e => String(e?.event_id) === EVENT_ID,
    );
    if (!coeEvent) {
      console.error(
        `${LOG} COE events[] does not include event ${EVENT_ID}. Aborting.`,
      );
      process.exit(1);
    }

    const eventDoc = await events.findOne(
      {_id: eventId},
      {projection: {name: 1, seats: 1, start_datetime: 1, end_datetime: 1}},
    );
    if (!eventDoc) {
      console.error(`${LOG} Event not found: ${EVENT_ID}`);
      process.exit(1);
    }

    const invSeat = pickInventorySeat(eventDoc.seats || [], category);
    if (!invSeat) {
      const cats = [
        ...new Set(
          (eventDoc.seats || []).map(s => s.category || s.section || 'General'),
        ),
      ];
      console.error(
        `${LOG} No inventory seat with category "${category}". Available: ${cats.join(', ')}`,
      );
      process.exit(1);
    }

    const catalogPrice =
      Number(invSeat.event_price) ||
      Number(invSeat.min_spend) ||
      0;

    const newSeat = {
      event_id: eventId,
      seat_id: invSeat._id,
      seat_code: invSeat.code || category,
      category: invSeat.category || category,
      capacity: invSeat.capacity || 1,
      base_price: 0,
      event_price: 0,
      venue_catalog_price: catalogPrice,
      available_from: eventDoc.start_datetime || null,
      available_until: eventDoc.end_datetime || eventDoc.start_datetime || null,
      status: 'selected',
    };

    console.log(`${LOG} Will attach`, {
      event_name: eventDoc.name,
      inventory_status: invSeat.status,
      inventory_seat_id: String(invSeat._id),
      row: summarizeSeat(newSeat),
    });
    console.log(`${LOG} Totals will remain unchanged`, {
      subtotal: coe.subtotal,
      total: coe.total,
      fees: coe.fees,
    });

    if (!confirmProd) {
      console.log(
        `${LOG} Dry run only. Re-run with --confirm-prod to $push this selected_seats row.`,
      );
      return;
    }

    const result = await coes.updateOne(
      {
        _id: coeId,
        // Guard: still no seat for this event at write time
        selected_seats: {
          $not: {$elemMatch: {event_id: eventId}},
        },
      },
      {$push: {selected_seats: newSeat}},
    );

    console.log(`${LOG} updateOne`, {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });

    if (result.matchedCount === 0) {
      console.error(
        `${LOG} Update matched 0 docs (seat may have been added concurrently). Aborting.`,
      );
      process.exit(1);
    }

    const after = await coes.findOne(
      {_id: coeId},
      {
        projection: {
          selected_seats: 1,
          subtotal: 1,
          total: 1,
          fees: 1,
          payment_status: 1,
        },
      },
    );
    const afterForEvent = (after?.selected_seats || []).filter(
      s => String(s?.event_id) === EVENT_ID,
    );
    console.log(`${LOG} AFTER seats for event`, afterForEvent.map(summarizeSeat));
    console.log(`${LOG} Unchanged payment/total check`, {
      payment_status: after?.payment_status,
      subtotal: after?.subtotal,
      total: after?.total,
      fees: after?.fees,
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

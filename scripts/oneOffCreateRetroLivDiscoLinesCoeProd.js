/**
 * ONE-OFF: Retro-create a paid cash COE on prod for Luke Reiser.
 *
 * DiscoLines @ LIV Nightclub, Fri Sep 4 2026, DJ Table Back Stage, $1,300 cash.
 * Does not hold/book event inventory, send email/push, or charge GOAT.
 *
 * Usage (from server/):
 *   node scripts/oneOffCreateRetroLivDiscoLinesCoeProd.js
 *   node scripts/oneOffCreateRetroLivDiscoLinesCoeProd.js --confirm-prod
 */

require('dotenv').config();
const {MongoClient, ObjectId} = require('mongodb');

const LOG = '[oneOffCreateRetroLivDiscoLinesCoeProd]';
const CLIENT_EMAIL = 'lukereiser@gmail.com';
const EVENT_NIGHT_YMD = '2026-09-04';
const CASH_TOTAL = 1300;
const DISPLAY_CATEGORY = 'DJ Table Back Stage';
const PREFERRED_CATEGORY = 'DJ_Table_Backstage';
const CREATION_NOTES = 'retro cash DiscoLines LIV 2026-09-04';

/**
 * @returns {{ confirmProd: boolean }}
 */
function parseArgs() {
  return {
    confirmProd: process.argv.slice(2).includes('--confirm-prod'),
  };
}

/**
 * Resolve prod Mongo URI (explicit PROD_* or the1-stage → the1-PROD).
 * @returns {string}
 */
function resolveProdMongoUri() {
  const explicit =
    process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
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
 * Vegas night of 2026-09-04 spans UTC Sep 4–5.
 * @returns {{ start: Date, end: Date }}
 */
function eventSearchWindow() {
  return {
    start: new Date('2026-09-04T00:00:00.000Z'),
    end: new Date('2026-09-05T18:00:00.000Z'),
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {object} loc
 * @returns {boolean}
 */
function isLivNightclub(loc) {
  const name = norm(loc?.name);
  if (!name) return false;
  if (/\bbeach\b/.test(name)) return false;
  return (
    name === 'liv' ||
    name === 'liv nightclub' ||
    name === 'liv night club' ||
    /(^|\s)liv(\s|$)/.test(name)
  );
}

/**
 * @param {object} event
 * @returns {boolean}
 */
function isDiscoLinesEvent(event) {
  const name = norm(event?.name);
  return (
    name.includes('discolines') ||
    name.includes('disco lines') ||
    name.includes('disco line')
  );
}

/**
 * @param {object} seat
 * @returns {number}
 */
function seatMatchScore(seat) {
  const category = String(seat?.category || '').trim();
  const blob = norm(
    [seat?.category, seat?.section, seat?.code, seat?.label].join(' '),
  );
  if (category === PREFERRED_CATEGORY) return 100;
  const hasDjTable = /\bdj\b/.test(blob) && /\btable\b/.test(blob);
  const hasBackstage = /\bback\s*stage\b/.test(blob) || /\bbackstage\b/.test(blob);
  if (hasDjTable && hasBackstage) return 90;
  if (blob.includes('dj table backstage') || blob.includes('dj table back stage')) {
    return 90;
  }
  if (hasBackstage && hasDjTable) return 80;
  return 0;
}

/**
 * @param {object[]} seats
 * @returns {object|null}
 */
function pickDjTableBackstageSeat(seats) {
  if (!Array.isArray(seats) || seats.length === 0) return null;
  const ranked = seats
    .map(s => ({seat: s, score: seatMatchScore(s)}))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.seat || null;
}

/**
 * @param {object} seat
 * @returns {object}
 */
function summarizeInventorySeat(seat) {
  if (!seat) return null;
  return {
    seat_id: seat._id != null ? String(seat._id) : null,
    code: seat.code ?? null,
    label: seat.label ?? null,
    category: seat.category ?? null,
    section: seat.section ?? null,
    status: seat.status ?? null,
    capacity: seat.capacity ?? null,
    event_price: seat.event_price ?? null,
    min_spend: seat.min_spend ?? null,
    event_min_spend: seat.event_min_spend ?? null,
  };
}

/**
 * @param {Date|string|null|undefined} dt
 * @returns {string}
 */
function eventTimeHHmm(dt) {
  const d = dt instanceof Date ? dt : dt ? new Date(dt) : null;
  if (!d || Number.isNaN(d.getTime())) return '00:00';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function main() {
  const {confirmProd} = parseArgs();
  const uri = resolveProdMongoUri();
  const dbName = dbNameFromUri(uri);

  console.log(`${LOG} db=${dbName} confirmProd=${confirmProd}`);

  if (!/prod/i.test(dbName)) {
    console.error(
      `${LOG} Refusing to run: database name "${dbName}" does not look like prod.`,
    );
    process.exit(1);
  }

  const mongo = new MongoClient(uri);
  try {
    await mongo.connect();
    const db = mongo.db(dbName);
    const users = db.collection('users');
    const locations = db.collection('locations');
    const events = db.collection('events');
    const coes = db.collection('coes');
    const payments = db.collection('payments');

    const clientUser = await users.findOne(
      {email: CLIENT_EMAIL},
      {
        projection: {
          email: 1,
          firstName: 1,
          lastName: 1,
          role: 1,
          entity_status: 1,
          isActive: 1,
        },
      },
    );
    if (!clientUser) {
      console.error(`${LOG} User not found: ${CLIENT_EMAIL}`);
      process.exit(1);
    }
    console.log(`${LOG} Client`, {
      id: String(clientUser._id),
      email: clientUser.email,
      name: `${clientUser.firstName || ''} ${clientUser.lastName || ''}`.trim(),
      role: clientUser.role,
      entity_status: clientUser.entity_status,
      isActive: clientUser.isActive,
    });

    const admin = await users.findOne(
      {role: 'admin', isActive: true},
      {projection: {email: 1, firstName: 1, lastName: 1, role: 1, isActive: 1}},
    );
    if (!admin) {
      console.error(`${LOG} No active admin found`);
      process.exit(1);
    }
    console.log(`${LOG} Admin`, {
      id: String(admin._id),
      email: admin.email,
    });

    const livCandidates = await locations
      .find(
        {name: {$regex: /liv/i}},
        {projection: {name: 1, type: 1, 'address.city': 1}},
      )
      .toArray();
    const livNight = livCandidates.filter(isLivNightclub);
    console.log(
      `${LOG} LIV location candidates`,
      livCandidates.map(l => ({
        id: String(l._id),
        name: l.name,
        type: l.type,
        city: l.address?.city,
        nightclub: isLivNightclub(l),
      })),
    );
    if (livNight.length === 0) {
      console.error(`${LOG} LIV Nightclub location not found (Beach excluded)`);
      process.exit(1);
    }
    const livLocation = livNight[0];
    if (livNight.length > 1) {
      console.log(
        `${LOG} Multiple LIV nightclub locations; using first`,
        String(livLocation._id),
        livLocation.name,
      );
    }

    const window = eventSearchWindow();
    const nightEvents = await events
      .find(
        {
          location_id: livLocation._id,
          start_datetime: {$gte: window.start, $lte: window.end},
        },
        {
          projection: {
            name: 1,
            start_datetime: 1,
            end_datetime: 1,
            status: 1,
            type: 1,
            seats: 1,
            location_id: 1,
          },
        },
      )
      .toArray();

    console.log(
      `${LOG} LIV events in window`,
      nightEvents.map(e => ({
        id: String(e._id),
        name: e.name,
        start: e.start_datetime,
        status: e.status,
        disco: isDiscoLinesEvent(e),
      })),
    );

    const discoEvents = nightEvents.filter(isDiscoLinesEvent);
    if (discoEvents.length === 0) {
      console.error(
        `${LOG} DiscoLines event not found at LIV Nightclub in ${EVENT_NIGHT_YMD} window. Aborting (will not invent an event).`,
      );
      process.exit(1);
    }
    const eventDoc = discoEvents[0];
    if (discoEvents.length > 1) {
      console.log(
        `${LOG} Multiple DiscoLines matches; using first`,
        String(eventDoc._id),
        eventDoc.name,
      );
    }

    const invSeat = pickDjTableBackstageSeat(eventDoc.seats || []);
    if (!invSeat) {
      const cats = [
        ...new Set(
          (eventDoc.seats || []).map(
            s => `${s.category || ''} | ${s.code || ''} | ${s.label || ''}`,
          ),
        ),
      ];
      console.error(
        `${LOG} No DJ Table Back Stage seat on event. Inventory:`,
        cats,
      );
      process.exit(1);
    }

    const existingCoe = await coes.findOne(
      {
        client_id: clientUser._id,
        'events.event_id': eventDoc._id,
        status: {$nin: ['deleted', 'cancelled']},
      },
      {projection: {name: 1, status: 1, payment_status: 1, total: 1}},
    );
    if (existingCoe) {
      console.error(`${LOG} COE already exists for this client+event (idempotent abort)`, {
        coeId: String(existingCoe._id),
        name: existingCoe.name,
        status: existingCoe.status,
        payment_status: existingCoe.payment_status,
        total: existingCoe.total,
      });
      process.exit(1);
    }

    const startDate = new Date(`${EVENT_NIGHT_YMD}T12:00:00.000Z`);
    const endDate = new Date(`${EVENT_NIGHT_YMD}T12:00:00.000Z`);
    const availFrom = eventDoc.start_datetime || startDate;
    const availUntil = eventDoc.end_datetime || eventDoc.start_datetime || endDate;
    const catalogPrice =
      Number(invSeat.event_min_spend) ||
      Number(invSeat.min_spend) ||
      Number(invSeat.event_price) ||
      null;
    const clientName =
      `${clientUser.firstName || ''} ${clientUser.lastName || ''}`.trim() ||
      clientUser.email;
    const coeName = `${clientName} experience, Sep 4`;

    const planned = {
      client_id: String(clientUser._id),
      admin_id: String(admin._id),
      event_id: String(eventDoc._id),
      event_name: eventDoc.name,
      event_start: eventDoc.start_datetime,
      location: {id: String(livLocation._id), name: livLocation.name},
      seat: summarizeInventorySeat(invSeat),
      display_category: DISPLAY_CATEGORY,
      cash_total: CASH_TOTAL,
      start_date: startDate,
      end_date: endDate,
      coe_name: coeName,
    };
    console.log(`${LOG} Planned COE`, JSON.stringify(planned, null, 2));

    if (!confirmProd) {
      console.log(
        `${LOG} Dry run only. Re-run with --confirm-prod to insert COE + cash payment.`,
      );
      return;
    }

    const now = new Date();
    const coeId = new ObjectId();
    const paymentId = new ObjectId();
    const eventLineId = new ObjectId();

    const selectedSeat = {
      event_id: eventDoc._id,
      seat_id: invSeat._id,
      seat_code: invSeat.code || DISPLAY_CATEGORY,
      category: DISPLAY_CATEGORY,
      capacity: invSeat.capacity >= 1 ? invSeat.capacity : 1,
      base_price: CASH_TOTAL,
      event_price: CASH_TOTAL,
      venue_catalog_price: catalogPrice != null ? catalogPrice : undefined,
      venue_min_spend_usd:
        Number(invSeat.min_spend) > 0 ? Number(invSeat.min_spend) : undefined,
      negotiated_min_spend_usd:
        Number(invSeat.event_min_spend) > 0
          ? Number(invSeat.event_min_spend)
          : undefined,
      available_from: availFrom,
      available_until: availUntil,
      status: 'selected',
    };

    const eventLine = {
      _id: eventLineId,
      coe_id: coeId,
      event_id: eventDoc._id,
      event_date: eventDoc.start_datetime || startDate,
      event_time: eventTimeHHmm(eventDoc.start_datetime),
      base_price: CASH_TOTAL,
      quantity: 1,
      total_price: CASH_TOTAL,
      status: 'completed',
      notes: '',
      client_notes: '',
      sequence: 1,
      created_at: now,
      updated_at: now,
    };

    const coeDoc = {
      _id: coeId,
      name: coeName,
      description: coeName,
      status: 'paid',
      created_method: 'manual',
      created_by: admin._id,
      creation_notes: CREATION_NOTES,
      client_id: clientUser._id,
      admin_id: admin._id,
      currency: 'USD',
      subtotal: CASH_TOTAL,
      taxes: 0,
      fees: 0,
      fee_breakdown: {
        gratuity_total: 0,
        venue_admin_fee_total: 0,
        sales_tax_total: 0,
        the1_fee_total: 0,
        processing_fee_total: 0,
      },
      total: CASH_TOTAL,
      catalog_total: catalogPrice != null ? catalogPrice : CASH_TOTAL,
      deposit_required: 0,
      deposit_paid: CASH_TOTAL,
      payment_status: 'paid',
      payment_id: paymentId,
      payment_date: now,
      payment_amount: CASH_TOTAL,
      total_paid: CASH_TOTAL,
      paid_date: now,
      approved_date: now,
      request_date: now,
      start_date: startDate,
      end_date: endDate,
      events: [eventLine],
      selected_seats: [selectedSeat],
      is_the1_event: false,
      is_the1_experience_host: false,
      createdAt: now,
      updatedAt: now,
    };

    const paymentDoc = {
      _id: paymentId,
      coe_id: coeId,
      event_id: eventDoc._id,
      user_id: clientUser._id,
      amount: CASH_TOTAL,
      currency: 'USD',
      payment_type: 'full_payment',
      payment_channel: 'cash',
      recorded_by_admin_id: admin._id,
      created_by_admin_id: admin._id,
      cash_note: CREATION_NOTES,
      finance_sync_status: 'pending',
      status: 'completed',
      description: `${coeName} — cash (retro)`,
      completed_at: now,
      createdAt: now,
      updatedAt: now,
    };

    await coes.insertOne(coeDoc);
    await payments.insertOne(paymentDoc);

    console.log(`${LOG} Inserted`, {
      coeId: String(coeId),
      paymentId: String(paymentId),
      eventId: String(eventDoc._id),
      seatId: String(invSeat._id),
      seatCode: selectedSeat.seat_code,
      category: selectedSeat.category,
      total: CASH_TOTAL,
      payment_channel: 'cash',
    });
    console.log(`${LOG} Done.`);
  } finally {
    await mongo.close();
  }
}

main().catch(err => {
  console.error(`${LOG} Fatal:`, err);
  process.exit(1);
});

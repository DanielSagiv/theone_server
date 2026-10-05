/**
 * Add Palm Tree Beach Club seat "Dj Hideaway" with S3 image on stage + prod,
 * and append it onto existing Palm Tree events that lack the seat.
 *
 * Usage (from server/):
 *   node scripts/add-palm-tree-dj-hideaway.js --use-env-uris --dry-run
 *   node scripts/add-palm-tree-dj-hideaway.js --use-env-uris --confirm
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { uploadMediaWithMetadata } = require('../utils/mediaUploadHelpers');

const LOG = '[add-palm-tree-dj-hideaway]';
const LOCATION_ID = '6a3aca44bdbdad91c9fd0ee5';
const SEAT_CODE = 'Dj Hideaway';
const SEAT_CATEGORY = 'dj_hideaway';
const SEAT_THE1 = 'Dj Hideaway';
const EXPECTED_LOCATION_NAME = /palm\s*tree\s*beach/i;
const IMAGE_PATH =
  '/Users/sagivdaniel/.cursor/projects/Users-sagivdaniel-Documents-THEONE/assets/Dj_Hideaway-2ff8a3b9-86ab-4ec9-809b-883569cbceda.jpg';

const NEW_SEAT_ID = new ObjectId();

/**
 * @returns {{ dryRun: boolean, confirm: boolean, useEnvUris: boolean }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes('--dry-run'),
    confirm: argv.includes('--confirm'),
    useEnvUris: argv.includes('--use-env-uris'),
  };
}

/**
 * @param {'stage'|'prod'} target
 * @returns {string}
 */
function resolveMongoUri(target) {
  if (target === 'stage') {
    const uri =
      process.env.STAGE_MONGODB_URI ||
      process.env.STAGE_DB_URI ||
      process.env.DB_URI ||
      process.env.MONGODB_URI ||
      process.env.MONGO_URI;
    if (!uri) throw new Error('Stage URI missing');
    return uri;
  }
  const explicit = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) return explicit;
  const stageUri = resolveMongoUri('stage');
  if (!stageUri.includes('the1-stage')) {
    throw new Error('Prod URI missing and could not derive from stage');
  }
  return stageUri.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * @returns {Promise<object>}
 */
async function uploadSectionMedia() {
  const buffer = fs.readFileSync(IMAGE_PATH);
  const file = {
    buffer,
    mimetype: 'image/jpeg',
    originalname: path.basename(IMAGE_PATH),
    size: buffer.length,
  };
  const userId = 'palm-tree-section';
  const media = await uploadMediaWithMetadata(file, `locations/${userId}`, userId);
  return {
    type: 'image',
    url: media.url,
    order: 0,
    width: media.width,
    height: media.height,
    byte_size: media.byte_size,
    thumb_url: media.thumb_url,
    list_thumb_url: media.list_thumb_url,
  };
}

/**
 * @param {object} mediaItem
 * @returns {object}
 */
function buildLocationSeat(mediaItem) {
  return {
    _id: NEW_SEAT_ID,
    code: SEAT_CODE,
    category: SEAT_CATEGORY,
    the1Category: SEAT_THE1,
    capacity: 10,
    minSpendUSD: 1000,
    qualityScore: 5,
    polygon: [],
    media: [mediaItem],
    sentiment: [],
  };
}

/**
 * @param {import('mongodb').ObjectId} locationSeatId
 * @param {object} mediaItem
 * @returns {object}
 */
function buildEventSeat(locationSeatId, mediaItem) {
  return {
    _id: new ObjectId(),
    seat_id: locationSeatId,
    code: SEAT_CODE,
    category: SEAT_CATEGORY,
    capacity: 10,
    min_spend: 1000,
    event_price: 1000,
    event_min_spend: 1000,
    price_change_reason: '',
    status: 'available',
    merged_coe_ids: [],
    polygon: [],
    media: [mediaItem],
  };
}

/**
 * @param {string} uri
 * @param {string} label
 * @param {object} mediaItem
 * @param {object} newSeat
 * @param {boolean} dryRun
 */
async function upsertSeatAndEvents(uri, label, mediaItem, newSeat, dryRun) {
  const safe = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`\n${LOG} ${label}: connecting ${safe}`);
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const locCol = db.collection('locations');
  const eventCol = db.collection('events');
  const _id = new ObjectId(LOCATION_ID);

  try {
    const loc = await locCol.findOne({ _id }, { projection: { name: 1, seats: 1 } });
    if (!loc) {
      throw new Error(`${label}: location ${LOCATION_ID} not found`);
    }
    if (!EXPECTED_LOCATION_NAME.test(String(loc.name || ''))) {
      throw new Error(
        `${label}: refusing location name "${loc.name || ''}" (expected Palm Tree Beach Club)`
      );
    }

    const idx = (loc.seats || []).findIndex(
      (s) => s.category === SEAT_CATEGORY || s.code === SEAT_CODE
    );

    let locationSeatId = newSeat._id;
    if (idx >= 0) {
      const existing = loc.seats[idx];
      locationSeatId = existing._id;
      console.log(
        `${LOG} ${label}: ${dryRun ? 'DRY' : 'UPDATE'} existing seat ${existing._id} on "${loc.name}"`
      );
      if (!dryRun) {
        const res = await locCol.updateOne(
          { _id, 'seats._id': existing._id },
          {
            $set: {
              'seats.$.code': SEAT_CODE,
              'seats.$.category': SEAT_CATEGORY,
              'seats.$.the1Category': SEAT_THE1,
              'seats.$.capacity': 10,
              'seats.$.minSpendUSD': 1000,
              'seats.$.media': [mediaItem],
              updatedAt: new Date(),
            },
          }
        );
        console.log(`${LOG} ${label}: location modified=${res.modifiedCount}`);
      }
    } else {
      console.log(
        `${LOG} ${label}: ${dryRun ? 'DRY' : 'PUSH'} new seat on "${loc.name}" seats=${(loc.seats || []).length} -> +1`
      );
      if (!dryRun) {
        const res = await locCol.updateOne(
          { _id },
          { $push: { seats: newSeat }, $set: { updatedAt: new Date() } }
        );
        console.log(`${LOG} ${label}: location modified=${res.modifiedCount}`);
      }
    }

    const events = await eventCol
      .find({ location_id: _id })
      .project({ _id: 1, name: 1, seats: 1 })
      .toArray();
    const missing = events.filter(
      (ev) => !(ev.seats || []).some((s) => String(s.code || '').trim() === SEAT_CODE)
    );
    console.log(
      `${LOG} ${label}: events=${events.length} missing "${SEAT_CODE}"=${missing.length}`
    );
    missing.forEach((ev) =>
      console.log(`  - ${ev._id} ${ev.name || ''} seats=${(ev.seats || []).length}`)
    );

    if (!dryRun) {
      let modified = 0;
      for (const ev of missing) {
        const eventSeat = buildEventSeat(locationSeatId, mediaItem);
        const res = await eventCol.updateOne(
          { _id: ev._id, 'seats.code': { $ne: SEAT_CODE } },
          { $push: { seats: eventSeat } }
        );
        modified += res.modifiedCount;
      }
      console.log(`${LOG} ${label}: events modified=${modified}`);
    }
  } finally {
    await client.close();
  }
}

async function main() {
  const args = parseArgs();
  if (!args.useEnvUris) {
    console.error(`${LOG} Pass --use-env-uris`);
    process.exit(1);
  }
  if (!args.dryRun && !args.confirm) {
    console.error(`${LOG} Pass --dry-run or --confirm`);
    process.exit(1);
  }
  if (args.dryRun && args.confirm) {
    console.error(`${LOG} Use only one of --dry-run / --confirm`);
    process.exit(1);
  }
  if (!fs.existsSync(IMAGE_PATH)) {
    throw new Error(`Image not found: ${IMAGE_PATH}`);
  }

  console.log(`${LOG} Palm Tree Beach Club ${LOCATION_ID}`);
  console.log(`${LOG} seat: ${SEAT_CODE} / ${SEAT_CATEGORY} capacity=10`);
  console.log(`${LOG} image: ${IMAGE_PATH}`);

  let mediaItem;
  if (args.dryRun) {
    mediaItem = { type: 'image', url: 'https://example.invalid/dry-run.jpg', order: 0 };
    console.log(`${LOG} dry-run: skip S3 upload`);
  } else {
    mediaItem = await uploadSectionMedia();
    console.log(`${LOG} uploaded: ${mediaItem.url}`);
  }

  const newSeat = buildLocationSeat(mediaItem);
  await upsertSeatAndEvents(resolveMongoUri('stage'), 'STAGE', mediaItem, newSeat, args.dryRun);
  await upsertSeatAndEvents(resolveMongoUri('prod'), 'PROD', mediaItem, newSeat, args.dryRun);
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err);
  process.exit(1);
});

/**
 * Add Palm Tree Beach Club seat "Driftwood Den" with S3 image on stage + prod.
 *
 * Usage (from server/):
 *   node scripts/add-palm-tree-driftwood-den.js --use-env-uris --dry-run
 *   node scripts/add-palm-tree-driftwood-den.js --use-env-uris --confirm
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { uploadMediaWithMetadata } = require('../utils/mediaUploadHelpers');

const LOG = '[add-palm-tree-driftwood-den]';
const LOCATION_ID = '6a3aca44bdbdad91c9fd0ee5';
const SEAT_CODE = 'Driftwood Den';
const SEAT_CATEGORY = 'driftwood_den';
const SEAT_THE1 = 'Driftwood Den';
const IMAGE_PATH =
  '/Users/sagivdaniel/.cursor/projects/Users-sagivdaniel-Documents-THEONE-server/assets/pmd-98b5749f-6576-4a05-819d-43382231e9f9.png';

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
function buildSeat(mediaItem) {
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
 * @param {string} uri
 * @param {string} label
 * @param {object} mediaItem
 * @param {object} newSeat
 * @param {boolean} dryRun
 */
async function upsertSeat(uri, label, mediaItem, newSeat, dryRun) {
  const safe = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`\n${LOG} ${label}: connecting ${safe}`);
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db().collection('locations');
  const _id = new ObjectId(LOCATION_ID);
  const loc = await col.findOne({ _id }, { projection: { name: 1, seats: 1 } });
  if (!loc) {
    console.error(`${LOG} ${label}: location ${LOCATION_ID} not found`);
    await client.close();
    process.exit(1);
  }

  const idx = (loc.seats || []).findIndex(
    (s) => s.category === SEAT_CATEGORY || s.code === SEAT_CODE,
  );

  if (idx >= 0) {
    const existing = loc.seats[idx];
    console.log(
      `${LOG} ${label}: ${dryRun ? 'DRY' : 'UPDATE'} existing seat ${existing._id} on "${loc.name}"`,
    );
    if (!dryRun) {
      const res = await col.updateOne(
        { _id, 'seats._id': existing._id },
        {
          $set: {
            'seats.$.code': SEAT_CODE,
            'seats.$.category': SEAT_CATEGORY,
            'seats.$.the1Category': SEAT_THE1,
            'seats.$.capacity': 10,
            'seats.$.media': [mediaItem],
            updatedAt: new Date(),
          },
        },
      );
      console.log(`${LOG} ${label}: modified=${res.modifiedCount}`);
    }
  } else {
    console.log(
      `${LOG} ${label}: ${dryRun ? 'DRY' : 'PUSH'} new seat on "${loc.name}" seats=${(loc.seats || []).length} -> +1`,
    );
    if (!dryRun) {
      const res = await col.updateOne(
        { _id },
        { $push: { seats: newSeat }, $set: { updatedAt: new Date() } },
      );
      console.log(`${LOG} ${label}: modified=${res.modifiedCount}`);
    }
  }

  await client.close();
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

  const newSeat = buildSeat(mediaItem);
  await upsertSeat(resolveMongoUri('stage'), 'STAGE', mediaItem, newSeat, args.dryRun);
  await upsertSeat(resolveMongoUri('prod'), 'PROD', mediaItem, newSeat, args.dryRun);
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err);
  process.exit(1);
});

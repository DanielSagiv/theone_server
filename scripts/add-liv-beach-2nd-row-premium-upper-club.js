/**
 * Add LIV Beach seat "2nd Row Premium Upper Club" with S3 section image on stage + prod.
 *
 * Usage (from server/):
 *   node scripts/add-liv-beach-2nd-row-premium-upper-club.js --use-env-uris --dry-run
 *   node scripts/add-liv-beach-2nd-row-premium-upper-club.js --use-env-uris --confirm
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { uploadMediaWithMetadata } = require('../utils/mediaUploadHelpers');

const LOG = '[add-liv-beach-2nd-row-premium-upper-club]';
const LIV_BEACH_ID = '69d9143e8ae9a8c036317fb7';
const SEAT_CODE = '2nd Row Premium Upper Club';
const SEAT_CATEGORY = '2nd_row_premium_upper_club';
const SEAT_THE1 = '2nd Row Premium Upper Club';
const IMAGE_PATH =
  '/Users/sagivdaniel/.cursor/projects/Users-sagivdaniel-Documents-THEONE-server/assets/WhatsApp_Image_2026-07-23_at_10.04.45-c424944b-9697-4f27-a6d7-8dbc0c5dd6f8.png';

/** Shared across stage + prod for seat _id parity. */
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
  // File is JPEG bytes despite .png extension
  const file = {
    buffer,
    mimetype: 'image/jpeg',
    originalname: path.basename(IMAGE_PATH),
    size: buffer.length,
  };
  const userId = 'liv-beach-section';
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
    capacity: 8,
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
 * @param {object} seat
 * @param {boolean} dryRun
 */
async function pushSeat(uri, label, seat, dryRun) {
  const safe = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`\n${LOG} ${label}: connecting ${safe}`);
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db().collection('locations');
  const _id = new ObjectId(LIV_BEACH_ID);
  const loc = await col.findOne({ _id }, { projection: { name: 1, seats: 1 } });
  if (!loc) {
    console.error(`${LOG} ${label}: LIV Beach ${LIV_BEACH_ID} not found`);
    await client.close();
    process.exit(1);
  }
  const existing = (loc.seats || []).find(
    (s) => s.category === SEAT_CATEGORY || s.code === SEAT_CODE,
  );
  if (existing) {
    console.log(
      `${LOG} ${label}: already has seat "${existing.code}" (${existing._id}) — skip`,
    );
    await client.close();
    return;
  }

  console.log(
    `${LOG} ${label}: ${dryRun ? 'DRY' : 'PUSH'} "${loc.name}" seats=${(loc.seats || []).length} -> +1`,
  );
  if (!dryRun) {
    const res = await col.updateOne(
      { _id },
      { $push: { seats: seat }, $set: { updatedAt: new Date() } },
    );
    console.log(`${LOG} ${label}: modified=${res.modifiedCount}`);
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

  console.log(`${LOG} new seat _id: ${NEW_SEAT_ID}`);
  console.log(`${LOG} image: ${IMAGE_PATH}`);

  let mediaItem;
  if (args.dryRun) {
    mediaItem = {
      type: 'image',
      url: 'https://example.invalid/dry-run.jpg',
      order: 0,
    };
    console.log(`${LOG} dry-run: skip S3 upload`);
  } else {
    mediaItem = await uploadSectionMedia();
    console.log(`${LOG} uploaded: ${mediaItem.url}`);
    if (mediaItem.list_thumb_url) console.log(`${LOG} list_thumb: ${mediaItem.list_thumb_url}`);
  }

  const seat = buildSeat(mediaItem);
  await pushSeat(resolveMongoUri('stage'), 'STAGE', seat, args.dryRun);
  await pushSeat(resolveMongoUri('prod'), 'PROD', seat, args.dryRun);
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err);
  process.exit(1);
});

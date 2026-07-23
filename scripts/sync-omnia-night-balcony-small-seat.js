/**
 * Idempotent: add Main Room Balcony Small to Omnia Night Club on stage and prod,
 * with seat media uploaded from the provided image.
 *
 * Usage:
 *   STAGE_MONGODB_URI=... PROD_MONGODB_URI=... node scripts/sync-omnia-night-balcony-small-seat.js
 *
 * Optional:
 *   OMNIA_LOCATION_ID=6a26ff4254364f05884f74ce
 *   BALCONY_SMALL_IMAGE=/path/to/image.png
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { uploadMediaWithMetadata } = require('../utils/mediaUploadHelpers');

const LOG = '[sync-omnia-night-balcony-small-seat]';
const DEFAULT_NIGHT_LOCATION_ID = '6a26ff4254364f05884f74ce';
const SEAT_CODE = 'Main Room Balcony Small';
const SEAT_CATEGORY = 'main_room_balcony_small';
const SEAT_THE1 = 'Main Room Balcony Small';
const DEFAULT_CAPACITY = 10;

const DEFAULT_IMAGE = path.join(
  process.env.HOME || '',
  '.cursor/projects/Users-sagivdaniel-Documents-VertiGo-vertiGo/assets/royalF-0d14e522-b03e-4553-b43d-e2ba0f21dd7d.png'
);

const LOCAL_REF_DIR = path.join(
  process.env.HOME || '',
  'Desktop/THE1/clubs/xs club/omnia/balcony small'
);

/**
 * @param {string} imagePath
 * @param {string} locationUserId
 * @returns {Promise<object>}
 */
async function uploadSeatImage(imagePath, locationUserId) {
  const buffer = fs.readFileSync(imagePath);
  const mime = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const file = {
    buffer,
    mimetype: mime,
    originalname: path.basename(imagePath),
    size: buffer.length,
  };
  const uploaded = await uploadMediaWithMetadata(
    file,
    `locations/${locationUserId || 'omnia'}`,
    String(locationUserId || 'omnia')
  );
  return {
    type: uploaded.type,
    url: uploaded.url,
    thumb_url: uploaded.thumb_url,
    list_thumb_url: uploaded.list_thumb_url,
    width: uploaded.width,
    height: uploaded.height,
    byte_size: uploaded.byte_size,
    order: 0,
    caption: SEAT_THE1,
  };
}

function copyLocalReference(imagePath) {
  try {
    fs.mkdirSync(LOCAL_REF_DIR, { recursive: true });
    const dest = path.join(LOCAL_REF_DIR, path.basename(imagePath));
    fs.copyFileSync(imagePath, dest);
    console.log(`${LOG} copied local reference → ${dest}`);
  } catch (e) {
    console.warn(`${LOG} local reference copy failed: ${e.message}`);
  }
}

/**
 * Defaults from existing Balcony Large on the same location when present.
 * @param {object[]} seats
 */
function defaultsFromBalconyLarge(seats) {
  const large = (seats || []).find((s) => s.code === 'Main Room Balcony Large');
  return {
    minSpendUSD: large?.minSpendUSD ?? 1000,
    priceTier: large?.priceTier ?? 1,
    qualityScore: large?.qualityScore ?? 5,
    section: large?.section ?? '',
  };
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} locationId
 * @param {string} envLabel
 * @param {object} mediaAsset
 * @returns {Promise<boolean>}
 */
async function syncLocation(db, locationId, envLabel, mediaAsset) {
  const col = db.collection('locations');
  const doc = await col.findOne({ _id: new ObjectId(locationId) });
  if (!doc) {
    console.warn(`${LOG} ${envLabel}: location not found (${locationId})`);
    return false;
  }

  const seats = doc.seats || [];
  const existing = seats.find((s) => s.code === SEAT_CODE);

  if (existing) {
    const hasMedia = Array.isArray(existing.media) && existing.media.length > 0;
    if (hasMedia) {
      console.log(
        `${LOG} ${envLabel}: "${doc.name}" already has "${SEAT_CODE}" with media — skip`
      );
      return true;
    }
    if (!mediaAsset) {
      console.warn(`${LOG} ${envLabel}: seat exists but no media to attach`);
      return true;
    }
    await col.updateOne(
      { _id: new ObjectId(locationId), 'seats.code': SEAT_CODE },
      {
        $set: {
          'seats.$.media': [mediaAsset],
          'seats.$.category': SEAT_CATEGORY,
          'seats.$.the1Category': SEAT_THE1,
        },
      }
    );
    console.log(`${LOG} ${envLabel}: attached media to existing "${SEAT_CODE}" on "${doc.name}"`);
    return true;
  }

  const defaults = defaultsFromBalconyLarge(seats);
  const seat = {
    _id: new ObjectId(),
    code: SEAT_CODE,
    label: '',
    category: SEAT_CATEGORY,
    the1Category: SEAT_THE1,
    section: defaults.section,
    capacity: DEFAULT_CAPACITY,
    minSpendUSD: defaults.minSpendUSD,
    priceTier: defaults.priceTier,
    qualityScore: defaults.qualityScore,
    polygon: [],
    media: mediaAsset ? [mediaAsset] : [],
    sentiment: [],
  };

  await col.updateOne({ _id: new ObjectId(locationId) }, { $push: { seats: seat } });
  console.log(`${LOG} ${envLabel}: added "${SEAT_CODE}" to "${doc.name}"`);
  return true;
}

async function main() {
  const stageUri = process.env.STAGE_MONGODB_URI || process.env.DB_URI;
  const prodUri = process.env.PROD_MONGODB_URI;
  const locationId = process.env.OMNIA_LOCATION_ID || DEFAULT_NIGHT_LOCATION_ID;
  const imagePath = process.env.BALCONY_SMALL_IMAGE || DEFAULT_IMAGE;

  if (!stageUri) {
    console.error(`${LOG} Set STAGE_MONGODB_URI or DB_URI`);
    process.exit(1);
  }
  if (!fs.existsSync(imagePath)) {
    console.error(`${LOG} Image not found: ${imagePath}`);
    process.exit(1);
  }

  copyLocalReference(imagePath);

  // Resolve location owner for S3 key prefix (from stage doc if available)
  const stageClient = new MongoClient(stageUri);
  await stageClient.connect();
  let locationUserId = 'omnia';
  let mediaAsset = null;
  try {
    const stageDoc = await stageClient
      .db()
      .collection('locations')
      .findOne({ _id: new ObjectId(locationId) }, { projection: { userId: 1, ownerId: 1, createdBy: 1 } });
    locationUserId = String(
      stageDoc?.userId || stageDoc?.ownerId || stageDoc?.createdBy || 'omnia'
    );
    mediaAsset = await uploadSeatImage(imagePath, locationUserId);
    console.log(`${LOG} uploaded media: ${mediaAsset.url}`);
  } finally {
    // keep client open for sync below
  }

  let ok = true;
  try {
    if (!(await syncLocation(stageClient.db(), locationId, 'stage', mediaAsset))) ok = false;
  } finally {
    await stageClient.close().catch(() => {});
  }

  if (prodUri) {
    const prodClient = new MongoClient(prodUri);
    await prodClient.connect();
    try {
      if (!(await syncLocation(prodClient.db(), locationId, 'prod', mediaAsset))) ok = false;
    } finally {
      await prodClient.close().catch(() => {});
    }
  } else {
    console.warn(`${LOG} PROD_MONGODB_URI not set — skipped prod sync`);
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(LOG, err);
  process.exit(1);
});

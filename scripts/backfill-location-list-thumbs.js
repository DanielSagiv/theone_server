/**
 * Backfill `list_thumb_url` (~240px JPEG) for all Location embedded image media
 * (venue media, seat media, unit media). Uploads to S3; prefers downloading
 * existing `thumb_url` when present to avoid pulling full originals.
 *
 * Usage: `node scripts/backfill-location-list-thumbs.js`
 *
 * Requires `DB_URI` or `MONGODB_URI` in `.env` (same as other server scripts).
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Location = require('../models/Location');
const { enrichLocationImageFields } = require('../utils/ensureImageMetadata');

async function main() {
  const mongoUri = process.env.DB_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('[backfill-location-list-thumbs] Missing DB_URI or MONGODB_URI in environment.');
    process.exit(1);
  }

  console.log('[backfill-location-list-thumbs] connecting...');
  await mongoose.connect(mongoUri);

  const stats = { locationsUpdated: 0, errors: 0 };

  try {
    for await (const loc of Location.find({}).cursor()) {
      try {
        if (await enrichLocationImageFields(loc)) {
          stats.locationsUpdated += 1;
          loc.markModified('media');
          loc.markModified('seats');
          loc.markModified('units');
          await loc.save();
        }
      } catch (e) {
        stats.errors += 1;
        console.warn('[backfill-location-list-thumbs] location', loc._id, e.message);
      }
    }
    console.log('[backfill-location-list-thumbs] done', stats);
  } finally {
    await mongoose.connection.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

/**
 * One-shot backfill: width, height, byte_size, thumb_url for legacy media and avatars.
 * Usage: node scripts/backfill-image-metadata.js [--dry-run]
 *
 * Uses DB_URI or MONGODB_URI from .env (same fallbacks as other scripts).
 * Processes documents sequentially to limit load on MongoDB and image origins.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Location = require('../models/Location');
const Event = require('../models/Event');
const User = require('../models/User');
const COE = require('../models/COE');
const {
  enrichLocationImageFields,
  enrichEventImageFields,
  enrichUserAvatarFields,
  enrichCOESeatUpgradeMedia
} = require('../utils/ensureImageMetadata');

function parseArgs() {
  const argv = process.argv.slice(2);
  return { dryRun: argv.includes('--dry-run') };
}

async function main() {
  const { dryRun } = parseArgs();
  const mongoUri =
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    'mongodb+srv://sagiv:madonna@cluster0.et5fx.mongodb.net/kairo?retryWrites=true&w=majority';

  console.log('[backfill-image-metadata] connecting...', dryRun ? '(dry-run)' : '');
  await mongoose.connect(mongoUri);

  const stats = { locations: 0, events: 0, users: 0, coes: 0, errors: 0 };

  try {
    for await (const loc of Location.find({}).cursor()) {
      try {
        if (await enrichLocationImageFields(loc)) {
          stats.locations += 1;
          if (!dryRun) {
            loc.markModified('media');
            loc.markModified('seats');
            loc.markModified('units');
            await loc.save();
          }
        }
      } catch (e) {
        stats.errors += 1;
        console.warn('[backfill] location', loc._id, e.message);
      }
    }

    for await (const ev of Event.find({}).cursor()) {
      try {
        if (await enrichEventImageFields(ev)) {
          stats.events += 1;
          if (!dryRun) {
            ev.markModified('media');
            ev.markModified('seats');
            ev.markModified('units');
            await ev.save();
          }
        }
      } catch (e) {
        stats.errors += 1;
        console.warn('[backfill] event', ev._id, e.message);
      }
    }

    for await (const user of User.find({
      avatarUrl: { $exists: true, $nin: [null, ''] }
    }).cursor()) {
      try {
        const patch = {
          avatarUrl: user.avatarUrl,
          avatar_width: user.avatar_width,
          avatar_height: user.avatar_height,
          avatar_byte_size: user.avatar_byte_size,
          avatar_thumb_url: user.avatar_thumb_url
        };
        if (await enrichUserAvatarFields(patch)) {
          stats.users += 1;
          if (!dryRun) {
            await User.updateOne({ _id: user._id }, { $set: patch });
          }
        }
      } catch (e) {
        stats.errors += 1;
        console.warn('[backfill] user', user._id, e.message);
      }
    }

    for await (const coe of COE.find({
      seat_upgrade_offers: { $exists: true, $not: { $size: 0 } }
    }).cursor()) {
      try {
        if (await enrichCOESeatUpgradeMedia(coe)) {
          stats.coes += 1;
          if (!dryRun) {
            coe.markModified('seat_upgrade_offers');
            await coe.save();
          }
        }
      } catch (e) {
        stats.errors += 1;
        console.warn('[backfill] coe', coe._id, e.message);
      }
    }

    console.log('[backfill-image-metadata] done', { ...stats, dryRun });
  } finally {
    await mongoose.connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

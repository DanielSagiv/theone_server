/**
 * Seed / upsert LIV Beach VenueMenu from data/liv-beach-menu.json.
 *
 * Usage (from server/):
 *   node scripts/seed-liv-beach-menu.js
 *   node scripts/seed-liv-beach-menu.js --dry-run
 *
 * Uses DB_URI from .env (fallback MONGODB_URI).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Location = require('../models/Location');
const VenueMenu = require('../models/VenueMenu');

const LOG = '[seed-liv-beach-menu]';
const LIV_BEACH_ID = '69d9143e8ae9a8c036317fb7';

/**
 * @returns {{ dryRun: boolean }}
 */
function parseArgs() {
  return { dryRun: process.argv.includes('--dry-run') };
}

/**
 * Load seed JSON payload.
 * @returns {object}
 */
function loadSeedJson() {
  const filePath = path.join(__dirname, '..', 'data', 'liv-beach-menu.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing seed file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Resolve LIV Beach location document.
 * @returns {Promise<object>}
 */
async function findLivBeach() {
  let loc = await Location.findById(LIV_BEACH_ID).select('_id name type').lean();
  if (loc) {
    return loc;
  }
  loc = await Location.findOne({ name: /^LIV Beach$/i }).select('_id name type').lean();
  if (loc) {
    return loc;
  }
  throw new Error('LIV Beach location not found (id or name)');
}

/**
 * Main seed entry.
 */
async function main() {
  const { dryRun } = parseArgs();
  const uri = process.env.DB_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error(`${LOG} Missing DB_URI (or MONGODB_URI)`);
    process.exit(1);
  }

  const seed = loadSeedJson();
  await mongoose.connect(uri);
  console.log(`${LOG} connected`);

  try {
    const location = await findLivBeach();
    console.log(`${LOG} location=${location._id} name=${location.name}`);

    const update = {
      location_id: location._id,
      title: seed.title || `${location.name} Menu`,
      status: seed.status || 'active',
      currency: seed.currency || 'USD',
      sourcePdfUrl: seed.sourcePdfUrl || '/menus/liv-beach-menu.pdf',
      notes: seed.notes || '',
      sections: Array.isArray(seed.sections) ? seed.sections : [],
    };

    console.log(
      `${LOG} sections=${update.sections.length} dryRun=${dryRun}`,
    );

    if (dryRun) {
      console.log(`${LOG} dry-run complete (no writes)`);
      return;
    }

    const menu = await VenueMenu.findOneAndUpdate(
      { location_id: location._id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    console.log(
      `${LOG} upserted menu=${menu._id} sections=${menu.sections?.length || 0}`,
    );
  } finally {
    await mongoose.disconnect();
    console.log(`${LOG} disconnected`);
  }
}

main().catch(err => {
  console.error(`${LOG} failed:`, err);
  process.exit(1);
});

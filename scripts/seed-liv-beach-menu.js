/**
 * Seed / upsert LIV Beach VenueMenu from data/liv-beach-menu.json.
 *
 * Prefer scripts/seed-venue-menus.js (includes LIV + other venues with --env).
 * This script remains for LIV-only runs.
 *
 * Usage (from server/):
 *   node scripts/seed-liv-beach-menu.js --dry-run
 *   node scripts/seed-liv-beach-menu.js --env=stage
 *   node scripts/seed-liv-beach-menu.js --env=prod
 *   node scripts/seed-liv-beach-menu.js --env=both
 *
 * Env:
 *   stage: STAGE_MONGODB_URI | DB_URI | MONGODB_URI
 *   prod:  PROD_MONGODB_URI | derived (the1-stage → the1-PROD)
 */

require('dotenv').config();
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Location = require('../models/Location');
const VenueMenu = require('../models/VenueMenu');

const LOG = '[seed-liv-beach-menu]';
const LIV_BEACH_ID = '69d9143e8ae9a8c036317fb7';

dns.setServers(['8.8.8.8', '1.1.1.1']);

/**
 * @returns {{ dryRun: boolean, envs: Array<'stage'|'prod'> }}
 */
function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  const envArg = process.argv.find(a => a.startsWith('--env='));
  const envRaw = envArg ? envArg.slice('--env='.length).trim().toLowerCase() : 'stage';
  /** @type {Array<'stage'|'prod'>} */
  let envs = ['stage'];
  if (envRaw === 'stage') envs = ['stage'];
  else if (envRaw === 'prod') envs = ['prod'];
  else if (envRaw === 'both') envs = ['stage', 'prod'];
  else throw new Error(`Invalid --env=${envRaw} (use stage|prod|both)`);
  return { dryRun, envs };
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
    if (!uri) {
      throw new Error('Stage URI missing (STAGE_MONGODB_URI, DB_URI, or MONGODB_URI)');
    }
    return uri;
  }
  const explicit = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) return explicit;
  const stageUri = resolveMongoUri('stage');
  if (!/\/the1-stage(\?|$)/i.test(stageUri)) {
    throw new Error(
      'Prod URI missing and could not derive from stage (expected /the1-stage)',
    );
  }
  return stageUri.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
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
 * Seed LIV Beach menu against one target.
 * @param {'stage'|'prod'} target
 * @param {boolean} dryRun
 * @returns {Promise<object>}
 */
async function seedAgainst(target, dryRun) {
  const uri = resolveMongoUri(target);
  const redacted = uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
  const seed = loadSeedJson();
  await mongoose.connect(uri);
  console.log(`${LOG} connected target=${target} uri=${redacted}`);

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

    console.log(`${LOG} sections=${update.sections.length} dryRun=${dryRun}`);

    if (dryRun) {
      console.log(`${LOG} dry-run complete (no writes)`);
      return {
        target,
        dryRun: true,
        locationId: String(location._id),
        locationName: location.name,
        sections: update.sections.length,
      };
    }

    const menu = await VenueMenu.findOneAndUpdate(
      { location_id: location._id },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    console.log(
      `${LOG} upserted menu=${menu._id} sections=${menu.sections?.length || 0}`,
    );
    return {
      target,
      menuId: String(menu._id),
      locationId: String(location._id),
      locationName: location.name,
      sections: menu.sections?.length || 0,
    };
  } finally {
    await mongoose.disconnect();
    console.log(`${LOG} disconnected target=${target}`);
  }
}

/**
 * Main seed entry.
 */
async function main() {
  const { dryRun, envs } = parseArgs();
  const results = {};
  for (const target of envs) {
    results[target] = await seedAgainst(target, dryRun);
  }
  console.log(`${LOG} summary:`, JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(`${LOG} failed:`, err);
  process.exit(1);
});

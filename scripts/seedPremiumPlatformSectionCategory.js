/**
 * Seed Category "Premium Platform Section" (value: premium_platform_section)
 * into the location seat-category catalog on stage + prod.
 *
 * Does not modify locations, events, or COEs. Existing seats stay unchanged.
 * Create/Update Location Category picker still uses constants/locationSeatCategories.js
 * (must include the same value). THE1 category datalist also reads this catalog.
 *
 * Usage (from server/):
 *   node scripts/seedPremiumPlatformSectionCategory.js --dry-run
 *   node scripts/seedPremiumPlatformSectionCategory.js --confirm
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { LOCATION_SEAT_CATEGORY_CATALOG_COLLECTION } = require('../constants/locationSeatCategories');

const LOG = '[seedPremiumPlatformSectionCategory]';
const VALUE = 'premium_platform_section';
const LABEL = 'Premium Platform Section';

/**
 * @returns {{ dryRun: boolean, confirm: boolean }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes('--dry-run'),
    confirm: argv.includes('--confirm'),
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
  if (!/\/the1-stage(\?|$)/i.test(stageUri)) {
    throw new Error('Prod URI missing and could not derive from stage');
  }
  return stageUri.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
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
 * @param {string} uri
 * @param {string} label
 * @param {boolean} dryRun
 */
async function seedTarget(uri, label, dryRun) {
  const dbName = dbNameFromUri(uri);
  const safe = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`\n${LOG} ${label}: db=${dbName} ${safe}`);

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const col = client.db(dbName).collection(LOCATION_SEAT_CATEGORY_CATALOG_COLLECTION);
    const existing = await col.findOne({ value: VALUE });
    if (existing) {
      console.log(`${LOG} ${label}: already present label="${existing.label}" — skip`);
      return;
    }
    if (dryRun) {
      console.log(`${LOG} ${label}: DRY RUN would insert value=${VALUE} label="${LABEL}"`);
      return;
    }
    const now = new Date();
    await col.updateOne(
      { value: VALUE },
      {
        $set: {
          value: VALUE,
          label: LABEL,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    console.log(`${LOG} ${label}: upserted value=${VALUE} label="${LABEL}"`);
  } finally {
    await client.close();
  }
}

async function main() {
  const { dryRun, confirm } = parseArgs();
  if (!dryRun && !confirm) {
    throw new Error('Pass --dry-run or --confirm');
  }
  if (confirm && dryRun) {
    throw new Error('Use either --dry-run or --confirm, not both');
  }

  const stageUri = resolveMongoUri('stage');
  const prodUri = resolveMongoUri('prod');
  const prodDb = dbNameFromUri(prodUri);
  if (confirm && !/PROD/i.test(prodDb)) {
    throw new Error(`Refusing prod write: db name "${prodDb}" does not look like prod`);
  }

  await seedTarget(stageUri, 'stage', dryRun);
  await seedTarget(prodUri, 'prod', dryRun);
  console.log(`\n${LOG} DONE dryRun=${dryRun}`);
}

main().catch((err) => {
  console.error(`${LOG} FATAL:`, err.message || err);
  process.exit(1);
});

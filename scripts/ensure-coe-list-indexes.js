/**
 * Ensure COE list indexes used by GET /v1/coes/my.
 *
 * Usage (from server/):
 *   node scripts/ensure-coe-list-indexes.js --env stage
 *   node scripts/ensure-coe-list-indexes.js --env prod
 *   node scripts/ensure-coe-list-indexes.js --env both
 *
 * Env (first match wins per target):
 *   stage: STAGE_MONGODB_URI | DB_URI (must contain the1-stage) | MONGODB_URI | MONGO_URI
 *   prod:  PROD_MONGODB_URI | derived from stage URI (the1-stage -> the1-PROD)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const COE = require('../models/COE');

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

  const explicit =
    process.env.PROD_MONGODB_URI ||
    process.env.PROD_DB_URI ||
    null;
  if (explicit) {
    return explicit;
  }

  const stageUri = resolveMongoUri('stage');
  if (!stageUri.includes('the1-stage')) {
    throw new Error(
      'Prod URI missing and could not derive from stage (expected DB_URI containing the1-stage)',
    );
  }
  return stageUri.replace(/\/the1-stage(\?|$)/, '/the1-PROD$1');
}

/**
 * @param {string} uri
 * @param {'stage'|'prod'} label
 */
async function ensureIndexesForUri(uri, label) {
  const safeLabel = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`[ensure-coe-list-indexes] connecting (${label}): ${safeLabel}`);

  await mongoose.connect(uri);
  const created = await COE.createIndexes();
  console.log(`[ensure-coe-list-indexes] ${label} createIndexes:`, created);

  const indexes = await COE.collection.indexes();
  const listKeys = [
    'client_id_1_status_1_end_date_-1_createdAt_-1',
    'admin_id_1_status_1_end_date_-1_createdAt_-1',
    'runner_assignment.runner_id_1_status_1_end_date_-1_createdAt_-1',
    'participants.user_id_1_status_1_end_date_-1_createdAt_-1',
    'status_1_end_date_-1_createdAt_-1',
  ];
  console.log(`[ensure-coe-list-indexes] ${label} current indexes:`);
  indexes.forEach((idx) => {
    console.log(`- ${idx.name}: ${JSON.stringify(idx.key)}`);
  });
  const missing = listKeys.filter(
    (name) => !indexes.some((idx) => idx.name === name),
  );
  if (missing.length > 0) {
    console.warn(`[ensure-coe-list-indexes] ${label} missing expected indexes:`, missing);
  } else {
    console.log(`[ensure-coe-list-indexes] ${label} all list indexes present`);
  }

  await mongoose.disconnect();
}

/**
 * @returns {'stage'|'prod'|'both'}
 */
function parseEnvArg() {
  const idx = process.argv.indexOf('--env');
  const value = idx >= 0 ? String(process.argv[idx + 1] || '').toLowerCase() : 'both';
  if (value === 'stage' || value === 'prod' || value === 'both') {
    return value;
  }
  throw new Error('Usage: node scripts/ensure-coe-list-indexes.js --env stage|prod|both');
}

async function main() {
  const envArg = parseEnvArg();
  if (envArg === 'stage' || envArg === 'both') {
    await ensureIndexesForUri(resolveMongoUri('stage'), 'stage');
  }
  if (envArg === 'prod' || envArg === 'both') {
    await ensureIndexesForUri(resolveMongoUri('prod'), 'prod');
  }
  console.log('[ensure-coe-list-indexes] done');
}

main().catch((err) => {
  console.error('[ensure-coe-list-indexes] failed:', err.message || err);
  process.exitCode = 1;
});

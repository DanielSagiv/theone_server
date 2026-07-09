/**
 * Backfill fixedProcFee on all Location documents.
 * Run from server dir:
 *   node scripts/backfill-location-fixed-proc-fee.js --env=stage
 *   node scripts/backfill-location-fixed-proc-fee.js --env=prod
 *   node scripts/backfill-location-fixed-proc-fee.js --env=local
 * Add --dry-run to preview without writing.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Location = require('../models/Location');

const DEFAULT_FIXED_PROC_FEE = 0;

/**
 * Resolve Mongo URI from --env flag.
 * @param {string} envName
 * @returns {string}
 */
function resolveMongoUri(envName) {
  if (envName === 'stage') {
    const uri = process.env.STAGE_MONGODB_URI || process.env.STAGE_DB_URI;
    if (!uri) throw new Error('Missing STAGE_MONGODB_URI or STAGE_DB_URI');
    return uri;
  }
  if (envName === 'prod') {
    const uri = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI;
    if (!uri) throw new Error('Missing PROD_MONGODB_URI or PROD_DB_URI');
    return uri;
  }
  const uri = process.env.DB_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing DB_URI or MONGODB_URI');
  return uri;
}

/**
 * Parse CLI args.
 * @returns {{ env: string, dryRun: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  let env = 'local';
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length).trim() || 'local';
    }
  }
  return { env, dryRun };
}

async function main() {
  const { env, dryRun } = parseArgs();
  const mongoUri = resolveMongoUri(env);

  console.log('[backfill-location-fixed-proc-fee]', {
    env,
    dryRun,
    fixedProcFee: DEFAULT_FIXED_PROC_FEE,
    uriHost: mongoUri.replace(/\/\/[^@]+@/, '//***@'),
  });

  await mongoose.connect(mongoUri);

  const filter = {};
  const count = await Location.countDocuments(filter);

  if (dryRun) {
    console.log(`[dry-run] Would update ${count} location(s) with fixedProcFee=${DEFAULT_FIXED_PROC_FEE}`);
    await mongoose.connection.close();
    process.exit(0);
  }

  const result = await Location.updateMany(filter, {
    $set: { fixedProcFee: DEFAULT_FIXED_PROC_FEE },
  });

  console.log('[backfill-location-fixed-proc-fee] done', {
    matched: result.matchedCount ?? result.n,
    modified: result.modifiedCount ?? result.nModified,
    total: count,
  });

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill-location-fixed-proc-fee] failed:', err.message || err);
  process.exit(1);
});

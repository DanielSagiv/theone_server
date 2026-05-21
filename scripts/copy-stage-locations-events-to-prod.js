/**
 * Copy specific locations and events from stage MongoDB into production (upsert by _id).
 *
 * Usage (from server/):
 *   STAGE_MONGODB_URI="mongodb+srv://..." PROD_MONGODB_URI="mongodb+srv://..." \
 *     node scripts/copy-stage-locations-events-to-prod.js
 *
 * Dry run (no writes):
 *   STAGE_MONGODB_URI="..." PROD_MONGODB_URI="..." \
 *     node scripts/copy-stage-locations-events-to-prod.js --dry-run
 *
 * Requires full connection strings including database name (e.g. .../the1-stage?...).
 * Prod on Atlas may be `the1-PROD` (case-sensitive) — not `the1-prod`.
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

/** @type {string[]} */
const LOCATION_IDS = [
  '69d9143e8ae9a8c036317fb7',
  '69d947ac8ae9a8c036318759',
  '69d958a68ae9a8c036318ff0',
];

/** @type {string[]} */
const EVENT_IDS = [
  '69d914bc8ae9a8c0363181f1',
  '69d949ff8ae9a8c036318a08',
];

const COLLECTION_LOCATIONS = 'locations';
const COLLECTION_EVENTS = 'events';

/**
 * @returns {{ dryRun: boolean }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  return { dryRun: argv.includes('--dry-run') };
}

/**
 * @param {string} label
 * @returns {string}
 */
function requireUri(label) {
  const uri = process.env[label];
  if (!uri || !String(uri).trim()) {
    console.error(
      `Missing ${label}. Set stage and prod MongoDB URIs in the environment (not committed).`,
    );
    process.exit(1);
  }
  return String(uri).trim();
}

/**
 * @param {string} id
 * @returns {import('mongodb').ObjectId}
 */
function toObjectId(id) {
  if (!ObjectId.isValid(id)) {
    throw new Error(`Invalid ObjectId: ${id}`);
  }
  return new ObjectId(id);
}

/**
 * Upsert documents by _id from stage into prod.
 * @param {import('mongodb').Db} stageDb
 * @param {import('mongodb').Db} prodDb
 * @param {string} collectionName
 * @param {string[]} ids
 * @param {boolean} dryRun
 * @returns {Promise<{ found: number, missing: string[], written: number }>}
 */
async function copyByIds(stageDb, prodDb, collectionName, ids, dryRun) {
  const stageCol = stageDb.collection(collectionName);
  const prodCol = prodDb.collection(collectionName);
  const missing = [];
  let found = 0;
  let written = 0;

  for (const idStr of ids) {
    const _id = toObjectId(idStr);
    const doc = await stageCol.findOne({ _id });
    if (!doc) {
      missing.push(idStr);
      console.warn(`[${collectionName}] not found on stage: ${idStr}`);
      continue;
    }
    found += 1;
    const name =
      doc.name ||
      doc.title ||
      doc.venue_name ||
      doc.slug ||
      '(no name field)';
    if (dryRun) {
      console.log(
        `[dry-run] ${collectionName} ${_id} "${name}" -> would upsert to prod`,
      );
      continue;
    }
    const result = await prodCol.replaceOne({ _id }, doc, { upsert: true });
    written += 1;
    console.log(
      `[${collectionName}] ${_id} "${name}" -> prod (${result.upsertedCount ? 'inserted' : 'replaced'})`,
    );
  }

  return { found, missing, written };
}

/**
 * Entry: connect stage + prod, copy locations then events.
 */
async function main() {
  const { dryRun } = parseArgs();
  const stageUri = requireUri('STAGE_MONGODB_URI');
  const prodUri = requireUri('PROD_MONGODB_URI');

  const stageClient = new MongoClient(stageUri);
  const prodClient = new MongoClient(prodUri);

  console.log(
    '[copy-stage-locations-events-to-prod]',
    dryRun ? 'DRY RUN' : 'LIVE',
  );
  console.log('Locations:', LOCATION_IDS.join(', '));
  console.log('Events:', EVENT_IDS.join(', '));

  try {
    await stageClient.connect();
    await prodClient.connect();
    const stageDb = stageClient.db();
    const prodDb = prodClient.db();
    console.log('Stage DB:', stageDb.databaseName);
    console.log('Prod DB:', prodDb.databaseName);

    const locStats = await copyByIds(
      stageDb,
      prodDb,
      COLLECTION_LOCATIONS,
      LOCATION_IDS,
      dryRun,
    );
    const eventStats = await copyByIds(
      stageDb,
      prodDb,
      COLLECTION_EVENTS,
      EVENT_IDS,
      dryRun,
    );

    console.log('\nSummary');
    console.log(
      `locations: found ${locStats.found}/${LOCATION_IDS.length}, written ${locStats.written}, missing ${locStats.missing.length}`,
    );
    console.log(
      `events: found ${eventStats.found}/${EVENT_IDS.length}, written ${eventStats.written}, missing ${eventStats.missing.length}`,
    );
    if (locStats.missing.length || eventStats.missing.length) {
      process.exitCode = 1;
    }
  } finally {
    await stageClient.close();
    await prodClient.close();
  }
}

main().catch(err => {
  console.error('[copy-stage-locations-events-to-prod] failed:', err.message);
  process.exit(1);
});

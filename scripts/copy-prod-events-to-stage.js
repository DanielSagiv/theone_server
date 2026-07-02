/**
 * Copy specific events from production MongoDB into stage (upsert by _id).
 * Prod is read-only. Stage is the only write target. Nothing is deleted on either env.
 *
 * Usage (from server/):
 *
 *   # 1) Preview (no writes)
 *   node scripts/copy-prod-events-to-stage.js --use-env-uris --dry-run
 *
 *   # 2) Apply (backs up affected stage docs first)
 *   node scripts/copy-prod-events-to-stage.js --use-env-uris --confirm \
 *     --backup-dir ./backups/stage-events-before-prod-sync-$(date +%Y%m%d)
 *
 * Explicit URIs (full connection string including DB name):
 *   STAGE_MONGODB_URI="mongodb+srv://.../the1-stage?..." \
 *   PROD_MONGODB_URI="mongodb+srv://.../the1-PROD?..." \
 *     node scripts/copy-prod-events-to-stage.js --dry-run
 *
 * Safety:
 *   - Source DB name must look like prod (the1-PROD / the1-prod).
 *   - Target DB name must look like stage (the1-stage).
 *   - Refuses if source and target database names match.
 *   - Live writes require --confirm (and optional --backup-dir).
 *   - Only the EVENT_IDS below are read from prod and written to stage.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

/** Events to copy from prod -> stage (by _id). */
const EVENT_IDS = [
  '6a457ec59106899a54c002af',
  '6a457e869106899a54c000b5',
  '6a457df89106899a54bffdc4',
];

const COLLECTION_EVENTS = 'events';
const LOG = '[copy-prod-events-to-stage]';

/**
 * @returns {{ dryRun: boolean, confirm: boolean, useEnvUris: boolean, backupDir: string|null }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let backupDir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--backup-dir' && argv[i + 1]) {
      backupDir = argv[i + 1];
      i += 1;
    }
  }
  return {
    dryRun: argv.includes('--dry-run'),
    confirm: argv.includes('--confirm'),
    useEnvUris: argv.includes('--use-env-uris'),
    backupDir,
  };
}

/**
 * @param {string} label
 * @returns {string}
 */
function requireUri(label) {
  const uri = process.env[label];
  if (!uri || !String(uri).trim()) {
    console.error(`${LOG} Missing ${label}. Set it in the environment (not committed).`);
    process.exit(1);
  }
  return String(uri).trim();
}

/**
 * Derive stage + prod URIs from local DB_URI (the1-stage -> the1-PROD).
 */
function applyUrisFromLocalEnv() {
  const stageUri = process.env.DB_URI || process.env.MONGODB_URI || process.env.STAGE_MONGODB_URI || '';
  if (!stageUri.includes('the1-stage')) {
    console.error(
      `${LOG} --use-env-uris requires DB_URI (or MONGODB_URI) containing the1-stage`,
    );
    process.exit(1);
  }
  const prodUri = stageUri.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
  if (prodUri === stageUri) {
    console.error(`${LOG} Could not derive prod URI from stage DB_URI`);
    process.exit(1);
  }
  process.env.STAGE_MONGODB_URI = stageUri;
  process.env.PROD_MONGODB_URI = prodUri;
  console.log(`${LOG} stage DB: the1-stage (from local env)`);
  console.log(`${LOG} prod DB: the1-PROD (derived)`);
}

/**
 * @param {string} dbName
 * @returns {'prod'|'stage'|null}
 */
function classifyDbName(dbName) {
  const n = (dbName || '').toLowerCase();
  if (n.includes('prod')) return 'prod';
  if (n.includes('stage')) return 'stage';
  return null;
}

/**
 * @param {string} uri
 * @returns {string}
 */
function dbNameFromUri(uri) {
  try {
    const withoutQuery = uri.split('?')[0];
    const segment = withoutQuery.split('/').pop() || '';
    return decodeURIComponent(segment);
  } catch {
    return '';
  }
}

/**
 * @param {import('mongodb').Db} prodDb
 * @param {import('mongodb').Db} stageDb
 */
function assertSafeEndpoints(prodDb, stageDb) {
  const prodName = prodDb.databaseName;
  const stageName = stageDb.databaseName;

  if (prodName === stageName) {
    throw new Error(`Refusing to run: prod and stage database names are identical (${prodName})`);
  }
  if (classifyDbName(prodName) !== 'prod') {
    throw new Error(`Source does not look like prod DB: "${prodName}"`);
  }
  if (classifyDbName(stageName) !== 'stage') {
    throw new Error(`Target does not look like stage DB: "${stageName}"`);
  }
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
 * @param {object} doc
 * @returns {string}
 */
function docLabel(doc) {
  return doc.name || doc.title || doc.venue_name || doc.slug || doc._id.toString();
}

/**
 * Backup stage event docs that will be overwritten (matched prod _id).
 * @param {import('mongodb').Db} stageDb
 * @param {import('mongodb').ObjectId[]} ids
 * @param {string} backupDir
 */
async function backupStageEvents(stageDb, ids, backupDir) {
  const stageCol = stageDb.collection(COLLECTION_EVENTS);
  const existing = await stageCol.find({ _id: { $in: ids } }).toArray();
  fs.mkdirSync(backupDir, { recursive: true });
  const filePath = path.join(backupDir, 'stage-events-before-prod-sync.json');
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        backedUpAt: new Date().toISOString(),
        count: existing.length,
        events: existing,
      },
      null,
      2,
    ),
  );
  console.log(`${LOG} backed up ${existing.length} existing stage event(s) -> ${filePath}`);
  return filePath;
}

/**
 * Copy the requested prod events to stage by _id upsert.
 * @param {import('mongodb').Db} prodDb
 * @param {import('mongodb').Db} stageDb
 * @param {boolean} dryRun
 * @returns {Promise<{ found: number, missing: string[], inserted: number, replaced: number }>}
 */
async function copyEvents(prodDb, stageDb, dryRun) {
  const prodCol = prodDb.collection(COLLECTION_EVENTS);
  const stageCol = stageDb.collection(COLLECTION_EVENTS);

  const missing = [];
  let found = 0;
  let inserted = 0;
  let replaced = 0;

  for (const idStr of EVENT_IDS) {
    const _id = toObjectId(idStr);
    const doc = await prodCol.findOne({ _id });
    if (!doc) {
      missing.push(idStr);
      console.warn(`${LOG} not found on prod: ${idStr}`);
      continue;
    }
    found += 1;
    const label = docLabel(doc);

    if (dryRun) {
      const exists = await stageCol.findOne({ _id }, { projection: { _id: 1, name: 1 } });
      console.log(`[dry-run] ${_id} "${label}" -> would ${exists ? 'replace' : 'insert'} on stage`);
      if (exists) replaced += 1;
      else inserted += 1;
      continue;
    }

    const result = await stageCol.replaceOne({ _id }, doc, { upsert: true });
    if (result.upsertedCount) inserted += 1;
    else if (result.modifiedCount || result.matchedCount) replaced += 1;
    console.log(`${LOG} ${_id} "${label}" -> stage (${result.upsertedCount ? 'inserted' : 'replaced'})`);
  }

  return { found, missing, inserted, replaced };
}

/**
 * Entry point.
 */
async function main() {
  const { dryRun, confirm, useEnvUris, backupDir } = parseArgs();

  if (useEnvUris) {
    applyUrisFromLocalEnv();
  }

  const stageUri = requireUri('STAGE_MONGODB_URI');
  const prodUri = requireUri('PROD_MONGODB_URI');

  if (!dryRun && !confirm) {
    console.error(`${LOG} Live run requires --confirm. Run --dry-run first to preview.`);
    process.exit(1);
  }
  if (dryRun && confirm) {
    console.error(`${LOG} Use either --dry-run or --confirm, not both.`);
    process.exit(1);
  }

  console.log(LOG, dryRun ? 'DRY RUN' : 'LIVE (stage writes only)');
  console.log(`${LOG} events: ${EVENT_IDS.join(', ')}`);
  console.log(`${LOG} stage URI db hint: ${dbNameFromUri(stageUri)}`);
  console.log(`${LOG} prod URI db hint: ${dbNameFromUri(prodUri)}`);

  const prodClient = new MongoClient(prodUri, { readPreference: 'primary' });
  const stageClient = new MongoClient(stageUri);

  try {
    await prodClient.connect();
    await stageClient.connect();

    const prodDb = prodClient.db();
    const stageDb = stageClient.db();

    assertSafeEndpoints(prodDb, stageDb);
    console.log(`${LOG} source (read-only): ${prodDb.databaseName}`);
    console.log(`${LOG} target (writes): ${stageDb.databaseName}`);

    if (!dryRun) {
      const ids = EVENT_IDS.map(toObjectId);
      const dir =
        backupDir ||
        path.join(
          process.cwd(),
          'backups',
          `stage-events-before-prod-sync-${new Date().toISOString().slice(0, 10)}`,
        );
      await backupStageEvents(stageDb, ids, dir);
    }

    const stats = await copyEvents(prodDb, stageDb, dryRun);

    console.log('\nSummary');
    console.log(`events requested: ${EVENT_IDS.length}`);
    console.log(`found on prod: ${stats.found}`);
    console.log(`missing on prod: ${stats.missing.length}${stats.missing.length ? ` (${stats.missing.join(', ')})` : ''}`);
    console.log(`would insert / inserted: ${stats.inserted}`);
    console.log(`would replace / replaced: ${stats.replaced}`);
    console.log(`${LOG} prod DB was not modified`);

    if (stats.missing.length) {
      process.exitCode = 1;
    }
  } finally {
    await prodClient.close();
    await stageClient.close();
  }
}

main().catch((err) => {
  console.error(`${LOG} failed:`, err.message);
  process.exit(1);
});

/**
 * Copy all future prod events (and their locations) into stage.
 * Prod is read-only. Stage is the only write target. Nothing is deleted.
 *
 * Usage (from server/):
 *   node scripts/copy-future-prod-events-to-stage.js --use-env-uris --dry-run
 *   node scripts/copy-future-prod-events-to-stage.js --use-env-uris --confirm
 *
 * Future = start_datetime >= now, status not deleted/cancelled.
 * Upserts by _id. Backs up overlapping stage docs before live writes.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {MongoClient} = require('mongodb');

const LOG = '[copy-future-prod-events-to-stage]';

/**
 * @returns {{ dryRun: boolean, confirm: boolean, useEnvUris: boolean }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes('--dry-run'),
    confirm: argv.includes('--confirm'),
    useEnvUris: argv.includes('--use-env-uris'),
  };
}

/**
 * @param {string} label
 * @returns {string}
 */
function requireUri(label) {
  const uri = process.env[label];
  if (!uri || !String(uri).trim()) {
    console.error(`${LOG} Missing ${label}`);
    process.exit(1);
  }
  return String(uri).trim();
}

/**
 * Derive stage + prod URIs from local DB_URI (the1-stage -> the1-PROD).
 */
function applyUrisFromLocalEnv() {
  const stageUri =
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    process.env.STAGE_MONGODB_URI ||
    '';
  if (!stageUri.includes('the1-stage')) {
    console.error(
      `${LOG} --use-env-uris requires DB_URI containing the1-stage`,
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
 * @param {import('mongodb').Db} prodDb
 * @param {import('mongodb').Db} stageDb
 */
function assertSafeEndpoints(prodDb, stageDb) {
  const prodName = prodDb.databaseName;
  const stageName = stageDb.databaseName;
  if (prodName === stageName) {
    throw new Error(
      `Refusing: prod and stage database names are identical (${prodName})`,
    );
  }
  if (classifyDbName(prodName) !== 'prod') {
    throw new Error(`Source does not look like prod DB: "${prodName}"`);
  }
  if (classifyDbName(stageName) !== 'stage') {
    throw new Error(`Target does not look like stage DB: "${stageName}"`);
  }
}

/**
 * @param {object} doc
 * @returns {string}
 */
function docLabel(doc) {
  return doc.name || doc.title || doc.slug || String(doc._id);
}

/**
 * Entry point.
 */
async function main() {
  const {dryRun, confirm, useEnvUris} = parseArgs();
  if (useEnvUris) {
    applyUrisFromLocalEnv();
  }
  if (!dryRun && !confirm) {
    console.error(`${LOG} Live run requires --confirm. Run --dry-run first.`);
    process.exit(1);
  }
  if (dryRun && confirm) {
    console.error(`${LOG} Use either --dry-run or --confirm, not both.`);
    process.exit(1);
  }

  const stageUri = requireUri('STAGE_MONGODB_URI');
  const prodUri = requireUri('PROD_MONGODB_URI');
  const now = new Date();

  console.log(LOG, dryRun ? 'DRY RUN' : 'LIVE (stage writes only)');
  console.log(`${LOG} cutoff: start_datetime >= ${now.toISOString()}`);

  const prodClient = new MongoClient(prodUri, {readPreference: 'primary'});
  const stageClient = new MongoClient(stageUri);

  try {
    await prodClient.connect();
    await stageClient.connect();
    const prodDb = prodClient.db();
    const stageDb = stageClient.db();
    assertSafeEndpoints(prodDb, stageDb);
    console.log(`${LOG} source (read-only): ${prodDb.databaseName}`);
    console.log(`${LOG} target (writes): ${stageDb.databaseName}`);

    const filter = {
      start_datetime: {$gte: now},
      status: {$nin: ['deleted', 'cancelled', 'canceled']},
    };
    const events = await prodDb.collection('events').find(filter).toArray();
    console.log(`${LOG} future events on prod: ${events.length}`);

    const locOidMap = new Map();
    for (const e of events) {
      if (e.location_id != null) {
        locOidMap.set(String(e.location_id), e.location_id);
      }
    }
    const locOids = [...locOidMap.values()];
    const locations = locOids.length
      ? await prodDb
          .collection('locations')
          .find({_id: {$in: locOids}})
          .toArray()
      : [];
    console.log(`${LOG} referenced locations on prod: ${locations.length}`);

    let wouldInsertE = 0;
    let wouldReplaceE = 0;
    let wouldInsertL = 0;
    let wouldReplaceL = 0;

    for (const loc of locations) {
      const exists = await stageDb
        .collection('locations')
        .findOne({_id: loc._id}, {projection: {_id: 1}});
      console.log(
        `  location ${loc._id} "${docLabel(loc)}" -> ${exists ? 'replace' : 'insert'}`,
      );
      if (exists) wouldReplaceL += 1;
      else wouldInsertL += 1;
    }
    for (const ev of events) {
      const exists = await stageDb
        .collection('events')
        .findOne({_id: ev._id}, {projection: {_id: 1}});
      const when =
        ev.start_datetime instanceof Date
          ? ev.start_datetime.toISOString()
          : String(ev.start_datetime || '');
      console.log(
        `  event ${ev._id} "${docLabel(ev)}" ${when} -> ${exists ? 'replace' : 'insert'}`,
      );
      if (exists) wouldReplaceE += 1;
      else wouldInsertE += 1;
    }

    if (dryRun) {
      console.log('\nSummary (dry-run)');
      console.log(`locations insert/replace: ${wouldInsertL}/${wouldReplaceL}`);
      console.log(`events insert/replace: ${wouldInsertE}/${wouldReplaceE}`);
      console.log(`${LOG} no writes performed; prod unchanged`);
      return;
    }

    const backupDir = path.join(
      process.cwd(),
      'backups',
      `stage-future-events-from-prod-${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}`,
    );
    fs.mkdirSync(backupDir, {recursive: true});
    const stageEventsBackup = await stageDb
      .collection('events')
      .find({_id: {$in: events.map((e) => e._id)}})
      .toArray();
    const stageLocsBackup = await stageDb
      .collection('locations')
      .find({_id: {$in: locations.map((l) => l._id)}})
      .toArray();
    fs.writeFileSync(
      path.join(backupDir, 'stage-events-before.json'),
      JSON.stringify(
        {
          backedUpAt: new Date().toISOString(),
          count: stageEventsBackup.length,
          events: stageEventsBackup,
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(backupDir, 'stage-locations-before.json'),
      JSON.stringify(
        {
          backedUpAt: new Date().toISOString(),
          count: stageLocsBackup.length,
          locations: stageLocsBackup,
        },
        null,
        2,
      ),
    );
    console.log(`${LOG} backup -> ${backupDir}`);

    let insertedL = 0;
    let replacedL = 0;
    let insertedE = 0;
    let replacedE = 0;

    for (const loc of locations) {
      const r = await stageDb
        .collection('locations')
        .replaceOne({_id: loc._id}, loc, {upsert: true});
      if (r.upsertedCount) insertedL += 1;
      else replacedL += 1;
    }
    for (const ev of events) {
      const r = await stageDb
        .collection('events')
        .replaceOne({_id: ev._id}, ev, {upsert: true});
      if (r.upsertedCount) insertedE += 1;
      else replacedE += 1;
    }

    console.log('\nSummary (live)');
    console.log(`locations inserted/replaced: ${insertedL}/${replacedL}`);
    console.log(`events inserted/replaced: ${insertedE}/${replacedE}`);
    console.log(`${LOG} prod was not modified`);
  } finally {
    await prodClient.close().catch(() => {});
    await stageClient.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`${LOG} failed:`, err.message);
  process.exit(1);
});

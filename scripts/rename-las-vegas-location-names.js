/**
 * Rename Las Vegas venue location.name on stage and/or prod to the canonical list.
 * Matches by _id so stage/prod spelling drift is fine. No deletes; name-only updates.
 *
 * Usage (from server/):
 *   node scripts/rename-las-vegas-location-names.js --use-env-uris --dry-run
 *   node scripts/rename-las-vegas-location-names.js --use-env-uris --confirm
 *   node scripts/rename-las-vegas-location-names.js --use-env-uris --env stage --confirm
 *   node scripts/rename-las-vegas-location-names.js --use-env-uris --env prod --confirm
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const LOG = '[rename-las-vegas-location-names]';
const COLLECTION = 'locations';

/** Canonical names by location _id (same ids on stage + prod). */
const RENAMES_BY_ID = [
  { id: '6a35172263c07e4f7521d24b', target: 'OMNIA Dayclub' },
  { id: '6a26ff4254364f05884f74ce', target: 'OMNIA Nightclub' },
  { id: '69d947ac8ae9a8c036318759', target: 'LIV' },
  { id: '69d9143e8ae9a8c036317fb7', target: 'LIV Beach' },
  { id: '69d958a68ae9a8c036318ff0', target: 'XS Nightclub' },
  { id: '6a3bbb42dbdace6b54541a99', target: 'Encore Beach Club' },
  { id: '6a3bc1894bf82ca19711bbbd', target: 'Marquee Nightclub' },
  { id: '6a3ae2f9b7e4c059eb79880e', target: 'Marquee Dayclub' },
  { id: '6a3aca44bdbdad91c9fd0ee5', target: 'Palm Tree Beach Club' },
  { id: '6a3aba3c092d0d12566c49a1', target: 'TAO Beach' },
  { id: '6a3bd15f2c7e0f72e498b8a1', target: 'Hakkasan Nightclub' },
];

/**
 * @returns {{ dryRun: boolean, confirm: boolean, useEnvUris: boolean, env: 'both'|'stage'|'prod' }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  let env = 'both';
  const envIdx = argv.indexOf('--env');
  if (envIdx >= 0 && argv[envIdx + 1]) {
    env = String(argv[envIdx + 1]).toLowerCase();
  }
  if (!['both', 'stage', 'prod'].includes(env)) {
    console.error(`${LOG} --env must be both|stage|prod`);
    process.exit(1);
  }
  return {
    dryRun: argv.includes('--dry-run'),
    confirm: argv.includes('--confirm'),
    useEnvUris: argv.includes('--use-env-uris'),
    env,
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
    if (!uri) {
      throw new Error('Stage URI missing (STAGE_MONGODB_URI, DB_URI, or MONGODB_URI)');
    }
    return uri;
  }

  const explicit = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) return explicit;

  const stageUri = resolveMongoUri('stage');
  if (!stageUri.includes('the1-stage')) {
    throw new Error('Prod URI missing and could not derive from stage (expected the1-stage)');
  }
  return stageUri.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * @param {string} uri
 * @param {'stage'|'prod'} label
 * @param {boolean} dryRun
 */
async function runForUri(uri, label, dryRun) {
  const safe = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`\n${LOG} ${label}: connecting ${safe}`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  console.log(`${LOG} ${label}: db=${db.databaseName}`);

  const col = db.collection(COLLECTION);
  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const row of RENAMES_BY_ID) {
    const _id = new ObjectId(row.id);
    const doc = await col.findOne({ _id }, { projection: { name: 1 } });
    if (!doc) {
      console.log(`${LOG} ${label}: MISSING ${_id} → would set "${row.target}"`);
      missing += 1;
      continue;
    }
    if (doc.name === row.target) {
      console.log(`${LOG} ${label}: OK   "${doc.name}" (already)`);
      skipped += 1;
      continue;
    }
    console.log(`${LOG} ${label}: ${dryRun ? 'DRY' : 'SET'} "${doc.name}" → "${row.target}" (${row.id})`);
    if (!dryRun) {
      const res = await col.updateOne({ _id }, { $set: { name: row.target } });
      if (res.modifiedCount !== 1) {
        console.warn(`${LOG} ${label}: unexpected modifiedCount=${res.modifiedCount} for ${row.id}`);
      }
    }
    updated += 1;
  }

  console.log(
    `${LOG} ${label}: ${dryRun ? 'dry-run' : 'applied'} updated=${updated} already=${skipped} missing=${missing}`,
  );
  await client.close();
}

async function main() {
  const args = parseArgs();
  if (!args.useEnvUris) {
    console.error(`${LOG} Pass --use-env-uris (uses STAGE/PROD or DB_URI → the1-PROD)`);
    process.exit(1);
  }
  if (!args.dryRun && !args.confirm) {
    console.error(`${LOG} Pass --dry-run or --confirm`);
    process.exit(1);
  }
  if (args.dryRun && args.confirm) {
    console.error(`${LOG} Use only one of --dry-run / --confirm`);
    process.exit(1);
  }

  const targets =
    args.env === 'both' ? ['stage', 'prod'] : args.env === 'stage' ? ['stage'] : ['prod'];

  for (const t of targets) {
    await runForUri(resolveMongoUri(t), t.toUpperCase(), args.dryRun);
  }

  console.log(
    `\n${LOG} Note: target list includes "Encore Beach Club At Night" but no matching location _id exists on stage/prod (only Encore Beach Club day_club).`,
  );
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err);
  process.exit(1);
});

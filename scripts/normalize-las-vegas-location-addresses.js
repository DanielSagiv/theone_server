/**
 * Normalize every location address to city Las Vegas + state Nevada (stage and/or prod).
 * Fixes duplicate CityPicker rows (e.g. "Las Vegas" vs "Las Vegas, Nevada").
 *
 * Usage (from server/):
 *   node scripts/normalize-las-vegas-location-addresses.js --use-env-uris --dry-run
 *   node scripts/normalize-las-vegas-location-addresses.js --use-env-uris --confirm
 *   node scripts/normalize-las-vegas-location-addresses.js --use-env-uris --env stage --confirm
 *   node scripts/normalize-las-vegas-location-addresses.js --use-env-uris --confirm \
 *     --backup-dir ./backups/lv-address-normalize-$(date +%Y%m%d)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const LOG = '[normalize-las-vegas-location-addresses]';
const COLLECTION = 'locations';
const CANONICAL_CITY = 'Las Vegas';
const CANONICAL_STATE = 'Nevada';

/**
 * @returns {{ dryRun: boolean, confirm: boolean, useEnvUris: boolean, env: 'both'|'stage'|'prod', backupDir: string|null }}
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
    env,
    backupDir,
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
 * Describe current address fields for logging.
 * @param {object|null|undefined} address
 * @returns {string}
 */
function formatAddress(address) {
  const city = address?.city ?? '';
  const state = address?.state ?? '';
  return `city="${city}" state="${state || '(empty)'}"`;
}

/**
 * Aggregate distinct city/state pairs (active locations only) like the API.
 * @param {import('mongodb').Collection} col
 * @returns {Promise<Array<{city: string, state: string|null, display: string, count: number}>>}
 */
async function distinctCityStatePairs(col) {
  const results = await col
    .aggregate([
      { $match: { status: 'active', 'address.city': { $exists: true, $ne: null, $ne: '' } } },
      {
        $project: {
          city: { $trim: { input: '$address.city' } },
          state: {
            $cond: [
              { $and: [{ $ne: ['$address.state', null] }, { $ne: ['$address.state', ''] }] },
              { $trim: { input: '$address.state' } },
              null,
            ],
          },
        },
      },
      { $group: { _id: { city: '$city', state: '$state' }, count: { $sum: 1 } } },
      {
        $project: {
          _id: 0,
          city: '$_id.city',
          state: '$_id.state',
          count: 1,
        },
      },
    ])
    .toArray();

  return (results || [])
    .map(r => ({
      city: r.city,
      state: r.state,
      display: r.state ? `${r.city}, ${r.state}` : r.city,
      count: r.count,
    }))
    .sort((a, b) => a.display.localeCompare(b.display));
}

/**
 * @param {string} uri
 * @param {string} label
 * @param {{ dryRun: boolean, backupDir: string|null }} opts
 */
async function runForUri(uri, label, opts) {
  const { dryRun, backupDir } = opts;
  const safe = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`\n${LOG} ${label}: connecting ${safe}`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  console.log(`${LOG} ${label}: db=${db.databaseName}`);

  const col = db.collection(COLLECTION);
  const beforePairs = await distinctCityStatePairs(col);
  console.log(`${LOG} ${label}: active city/state pairs BEFORE (${beforePairs.length}):`);
  for (const p of beforePairs) {
    console.log(`  - ${p.display} (${p.count} location(s))`);
  }

  const docs = await col
    .find({}, { projection: { name: 1, status: 1, address: 1 } })
    .sort({ name: 1 })
    .toArray();

  const toUpdate = docs.filter(doc => {
    const city = String(doc.address?.city ?? '').trim();
    const state = String(doc.address?.state ?? '').trim();
    return city !== CANONICAL_CITY || state !== CANONICAL_STATE;
  });

  console.log(`${LOG} ${label}: total locations=${docs.length}, need update=${toUpdate.length}`);

  for (const doc of toUpdate) {
    console.log(
      `${LOG} ${label}: ${dryRun ? 'DRY' : 'SET'} "${doc.name}" (${doc._id}) ${formatAddress(doc.address)} → city="${CANONICAL_CITY}" state="${CANONICAL_STATE}"`,
    );
  }

  if (!dryRun && toUpdate.length > 0) {
    if (backupDir) {
      const dir = path.resolve(backupDir, label.toLowerCase());
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `locations-before-${Date.now()}.json`);
      const backupDocs = await col
        .find({ _id: { $in: toUpdate.map(d => d._id) } })
        .toArray();
      fs.writeFileSync(file, JSON.stringify(backupDocs, null, 2));
      console.log(`${LOG} ${label}: backup written ${file} (${backupDocs.length} docs)`);
    }

    const res = await col.updateMany(
      { _id: { $in: toUpdate.map(d => d._id) } },
      {
        $set: {
          'address.city': CANONICAL_CITY,
          'address.state': CANONICAL_STATE,
        },
      },
    );
    console.log(
      `${LOG} ${label}: updateMany matched=${res.matchedCount} modified=${res.modifiedCount}`,
    );
  }

  if (dryRun) {
    console.log(
      `${LOG} ${label}: active city/state pairs AFTER (projected): Las Vegas, Nevada (${docs.length} location(s))`,
    );
  } else {
    const afterPairs = await distinctCityStatePairs(col);
    console.log(`${LOG} ${label}: active city/state pairs AFTER (${afterPairs.length}):`);
    for (const p of afterPairs) {
      console.log(`  - ${p.display} (${p.count} location(s))`);
    }
  }

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
    await runForUri(resolveMongoUri(t), t.toUpperCase(), {
      dryRun: args.dryRun,
      backupDir: args.backupDir,
    });
  }
}

main().catch(err => {
  console.error(`${LOG} fatal:`, err);
  process.exit(1);
});

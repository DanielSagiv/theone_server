/**
 * Clone Encore Beach Club into "Encore Beach Club At Night" on stage and/or prod.
 * Source: location _id 6a3bbb42dbdace6b54541a99. Same payload except name + new ids.
 * Uses one shared new location _id on both envs for stage/prod parity.
 *
 * Usage (from server/):
 *   node scripts/clone-encore-beach-at-night.js --use-env-uris --dry-run
 *   node scripts/clone-encore-beach-at-night.js --use-env-uris --confirm
 */

require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

const LOG = '[clone-encore-beach-at-night]';
const SOURCE_ID = '6a3bbb42dbdace6b54541a99';
const NEW_NAME = 'Encore Beach Club At Night';
/** Shared across stage + prod so location ids stay aligned. */
const NEW_LOCATION_ID = new ObjectId();

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
    if (!uri) throw new Error('Stage URI missing');
    return uri;
  }
  const explicit = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) return explicit;
  const stageUri = resolveMongoUri('stage');
  if (!stageUri.includes('the1-stage')) {
    throw new Error('Prod URI missing and could not derive from stage');
  }
  return stageUri.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * Deep-clone source location; new location + seat ObjectIds; name only change.
 * @param {object} source
 * @returns {object}
 */
function buildClone(source) {
  const now = new Date();
  const clone = JSON.parse(JSON.stringify(source));
  delete clone.__v;
  clone._id = NEW_LOCATION_ID;
  clone.name = NEW_NAME;
  clone.createdAt = now;
  clone.updatedAt = now;
  if (Array.isArray(clone.seats)) {
    clone.seats = clone.seats.map((seat) => {
      const s = { ...seat, _id: new ObjectId() };
      return s;
    });
  }
  return clone;
}

/**
 * Rehydrate ObjectId fields after JSON round-trip for insert.
 * @param {object} doc
 * @returns {object}
 */
function hydrateIds(doc) {
  const out = { ...doc };
  out._id = new ObjectId(String(doc._id));
  if (doc.createdBy) out.createdBy = new ObjectId(String(doc.createdBy));
  if (doc.updatedBy) out.updatedBy = new ObjectId(String(doc.updatedBy));
  if (Array.isArray(doc.seats)) {
    out.seats = doc.seats.map((seat) => ({
      ...seat,
      _id: new ObjectId(String(seat._id)),
    }));
  }
  if (doc.createdAt) out.createdAt = new Date(doc.createdAt);
  if (doc.updatedAt) out.updatedAt = new Date(doc.updatedAt);
  return out;
}

/**
 * @param {string} uri
 * @param {'stage'|'prod'} label
 * @param {boolean} dryRun
 * @param {object|null} sharedClone  when set, insert this instead of rebuilding (parity)
 */
async function runForUri(uri, label, dryRun, sharedClone) {
  const safe = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`\n${LOG} ${label}: connecting ${safe}`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const col = db.collection('locations');

  const existingByName = await col.findOne({ name: NEW_NAME }, { projection: { _id: 1, name: 1 } });
  if (existingByName) {
    console.log(
      `${LOG} ${label}: already exists name="${NEW_NAME}" id=${existingByName._id} — skip`,
    );
    await client.close();
    return sharedClone;
  }

  const existingById = await col.findOne({ _id: NEW_LOCATION_ID }, { projection: { _id: 1, name: 1 } });
  if (existingById) {
    console.log(
      `${LOG} ${label}: already exists _id=${NEW_LOCATION_ID} name="${existingById.name}" — skip`,
    );
    await client.close();
    return sharedClone;
  }

  const source = await col.findOne({ _id: new ObjectId(SOURCE_ID) });
  if (!source) {
    console.error(`${LOG} ${label}: source ${SOURCE_ID} not found`);
    await client.close();
    process.exit(1);
  }

  const cloneDoc = sharedClone || hydrateIds(buildClone(source));
  console.log(
    `${LOG} ${label}: ${dryRun ? 'DRY' : 'INSERT'} "${source.name}" → "${NEW_NAME}" newId=${cloneDoc._id} seats=${(cloneDoc.seats || []).length} type=${cloneDoc.type}`,
  );

  if (!dryRun) {
    await col.insertOne(cloneDoc);
    console.log(`${LOG} ${label}: inserted ok`);
  }

  await client.close();
  return cloneDoc;
}

async function main() {
  const args = parseArgs();
  if (!args.useEnvUris) {
    console.error(`${LOG} Pass --use-env-uris`);
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

  console.log(`${LOG} new location _id (shared): ${NEW_LOCATION_ID}`);
  console.log(`${LOG} source: ${SOURCE_ID} → name "${NEW_NAME}"`);

  const targets =
    args.env === 'both' ? ['stage', 'prod'] : args.env === 'stage' ? ['stage'] : ['prod'];

  // Prefer prod as template when cloning both (user cited prod); else first target.
  const templateTarget = targets.includes('prod') ? 'prod' : targets[0];
  const templateUri = resolveMongoUri(templateTarget);
  const templateClient = new MongoClient(templateUri);
  await templateClient.connect();
  const templateSource = await templateClient
    .db()
    .collection('locations')
    .findOne({ _id: new ObjectId(SOURCE_ID) });
  await templateClient.close();
  if (!templateSource) {
    console.error(`${LOG} template source missing on ${templateTarget}`);
    process.exit(1);
  }
  const sharedClone = hydrateIds(buildClone(templateSource));

  for (const t of targets) {
    await runForUri(resolveMongoUri(t), t.toUpperCase(), args.dryRun, sharedClone);
  }
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err);
  process.exit(1);
});

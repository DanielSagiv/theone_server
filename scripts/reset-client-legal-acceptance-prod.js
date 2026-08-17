/**
 * Unset client legal-acceptance timestamps on prod so they must agree once in-app.
 *
 * Admins and runners are not touched. After a client accepts in the app,
 * POST /v1/auth/accept-legal writes termsAcceptedAt + privacyConsentAt again.
 *
 * Usage (from server/):
 *
 *   # Count only (safe; no write)
 *   PROD_MONGODB_URI="mongodb+srv://.../the1-PROD?..." \
 *     node scripts/reset-client-legal-acceptance-prod.js --dry-run
 *
 *   # Derive prod URI from stage .env (the1-stage → the1-PROD):
 *   node scripts/reset-client-legal-acceptance-prod.js --dry-run --use-prod-from-stage-env
 *
 *   # Apply (requires explicit flag + prod DB name):
 *   PROD_MONGODB_URI="..." \
 *     node scripts/reset-client-legal-acceptance-prod.js --confirm-prod
 *
 * Do not run against stage. Do not run --confirm-prod until the app/API
 * legal gate is deployed.
 */

require('dotenv').config();
const {MongoClient} = require('mongodb');

const LOG = '[reset-client-legal-acceptance-prod]';

const CLIENT_FILTER = {
  role: 'client',
  $or: [
    {termsAcceptedAt: {$exists: true, $ne: null}},
    {privacyConsentAt: {$exists: true, $ne: null}},
  ],
};

/**
 * @returns {{ dryRun: boolean, confirmProd: boolean, useProdFromStageEnv: boolean }}
 */
function parseArgs() {
  const argv = process.argv.slice(2);
  const confirmProd = argv.includes('--confirm-prod');
  const dryRun = argv.includes('--dry-run') || !confirmProd;
  return {
    dryRun,
    confirmProd,
    useProdFromStageEnv: argv.includes('--use-prod-from-stage-env'),
  };
}

/**
 * When local .env targets stage, derive prod Mongo URI (same cluster, the1-PROD db).
 * @returns {void}
 */
function applyProdMongoFromStageEnv() {
  const stageUri =
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    process.env.STAGE_MONGODB_URI ||
    process.env.STAGE_DB_URI ||
    '';
  if (!/\/the1-stage(\?|$)/i.test(stageUri)) {
    throw new Error(
      '--use-prod-from-stage-env requires DB_URI (or MONGODB_URI) containing /the1-stage',
    );
  }
  process.env.PROD_MONGODB_URI = stageUri.replace(
    /\/the1-stage(\?|$)/i,
    '/the1-PROD$1',
  );
}

/**
 * Resolve prod Mongo URI (explicit PROD_* or the1-stage → the1-PROD).
 * @returns {string}
 */
function resolveProdMongoUri() {
  const explicit =
    process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) {
    return explicit;
  }
  const stageish =
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    process.env.STAGE_MONGODB_URI ||
    process.env.STAGE_DB_URI ||
    null;
  if (!stageish) {
    throw new Error(
      'Set PROD_MONGODB_URI (preferred) or DB_URI with /the1-stage to derive the1-PROD',
    );
  }
  if (!/\/the1-stage(\?|$)/i.test(stageish)) {
    throw new Error(
      'Cannot derive prod URI: stage URI must contain /the1-stage, or set PROD_MONGODB_URI',
    );
  }
  return stageish.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * @param {string} uri
 * @returns {string}
 */
function dbNameFromUri(uri) {
  const m = String(uri).match(/\/([^/?]+)(\?|$)/);
  return m ? m[1] : '';
}

async function main() {
  const args = parseArgs();
  if (args.useProdFromStageEnv) {
    applyProdMongoFromStageEnv();
  }

  const uri = resolveProdMongoUri();
  const dbName = dbNameFromUri(uri);

  console.log(`${LOG} db=${dbName} dryRun=${args.dryRun} confirmProd=${args.confirmProd}`);

  if (!/prod/i.test(dbName)) {
    console.error(
      `${LOG} Refusing to run: database name "${dbName}" does not look like prod (expected name containing "PROD").`,
    );
    process.exit(1);
  }

  if (args.confirmProd && args.dryRun && process.argv.includes('--dry-run')) {
    console.error(`${LOG} Pass either --dry-run or --confirm-prod, not both.`);
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const users = client.db(dbName).collection('users');

    const clientTotal = await users.countDocuments({role: 'client'});
    const matched = await users.countDocuments(CLIENT_FILTER);
    const adminCount = await users.countDocuments({role: 'admin'});
    const runnerCount = await users.countDocuments({role: 'runner'});

    console.log(`${LOG} role counts`, {
      client: clientTotal,
      admin: adminCount,
      runner: runnerCount,
      clients_with_legal_timestamps: matched,
    });

    if (!args.confirmProd || args.dryRun) {
      console.log(
        `${LOG} Dry run — would $unset termsAcceptedAt + privacyConsentAt on ${matched} client(s). Re-run with --confirm-prod to apply.`,
      );
      return;
    }

    const result = await users.updateMany(CLIENT_FILTER, {
      $unset: {
        termsAcceptedAt: '',
        privacyConsentAt: '',
      },
    });

    console.log(`${LOG} Applied`, {
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(`${LOG} Failed:`, err.message || err);
  process.exit(1);
});

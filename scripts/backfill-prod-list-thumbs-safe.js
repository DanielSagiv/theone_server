/**
 * Safe prod backfill: ensure `list_thumb_url` (~240px) on location/event media used by section thumbnails.
 * Reversible via JSON backups. Defaults to the same location/event IDs copied from stage.
 *
 * Usage (from server/):
 *
 *   PROD_MONGODB_URI="mongodb+srv://..." \
 *   PROD_S3_BUCKET=... PROD_S3_AKI=... PROD_S3_SEC=... PROD_AWS_REGION=us-west-2 \
 *     node scripts/backfill-prod-list-thumbs-safe.js --dry-run
 *
 *   # write backups then apply:
 *   PROD_MONGODB_URI="..." PROD_S3_BUCKET=... PROD_S3_AKI=... PROD_S3_SEC=... \
 *     node scripts/backfill-prod-list-thumbs-safe.js --backup-dir ./backups/prod-list-thumbs-$(date +%Y%m%d)
 *
 *   # restore from backups:
 *   PROD_MONGODB_URI="..." \
 *     node scripts/backfill-prod-list-thumbs-safe.js --revert --backup-dir ./backups/prod-list-thumbs-YYYYMMDD
 *
 * Flags:
 *   --dry-run       Log only; no backup files, no Mongo writes, no S3 uploads
 *   --backup-dir    Directory for location/event JSON snapshots before changes
 *   --revert        Replace prod docs from backup JSON (requires --backup-dir)
 *   --all           Process all locations/events (default: copied IDs only)
 *   --use-prod-from-stage-env
 *                   Derive PROD_MONGODB_URI from DB_URI (the1-stage -> the1-PROD) and
 *                   PROD_S3_BUCKET default the1-media-uploads-prod when unset
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Location = require('../models/Location');
const Event = require('../models/Event');
const {
  enrichLocationImageFields,
  enrichEventImageFields,
} = require('../utils/ensureImageMetadata');

/** Same IDs as scripts/copy-stage-locations-events-to-prod.js */
const DEFAULT_LOCATION_IDS = [
  '69d9143e8ae9a8c036317fb7',
  '69d947ac8ae9a8c036318759',
  '69d958a68ae9a8c036318ff0',
];

const DEFAULT_EVENT_IDS = [
  '69d914bc8ae9a8c0363181f1',
  '69d949ff8ae9a8c036318a08',
];

/**
 * @returns {{ dryRun: boolean, revert: boolean, all: boolean, backupDir: string|null, useProdFromStageEnv: boolean }}
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
    revert: argv.includes('--revert'),
    all: argv.includes('--all'),
    backupDir,
    useProdFromStageEnv: argv.includes('--use-prod-from-stage-env'),
  };
}

/**
 * When local .env targets stage, derive prod Mongo URI (same cluster, the1-PROD db).
 */
function applyProdMongoFromStageEnv() {
  const stageUri = process.env.DB_URI || process.env.MONGODB_URI || '';
  if (!stageUri.includes('the1-stage')) {
    console.error(
      '[backfill-prod-list-thumbs] --use-prod-from-stage-env requires DB_URI containing the1-stage',
    );
    process.exit(1);
  }
  const prodUri = stageUri.replace(/\/the1-stage(\?|$)/, '/the1-PROD$1');
  process.env.PROD_MONGODB_URI = prodUri;
  if (!process.env.PROD_S3_BUCKET) {
    process.env.PROD_S3_BUCKET = 'the1-media-uploads-prod';
  }
  console.log('[backfill-prod-list-thumbs] derived prod DB: the1-PROD');
}

/**
 * Apply prod S3 env overrides so uploads target prod bucket.
 */
function applyProdS3Env() {
  const bucket = process.env.PROD_S3_BUCKET || process.env.S3_BUCKET;
  const aki = process.env.PROD_S3_AKI || process.env.S3_AKI;
  const sec = process.env.PROD_S3_SEC || process.env.S3_SEC;
  const region =
    process.env.PROD_AWS_REGION ||
    process.env.PROD_S3_REGION ||
    process.env.AWS_REGION ||
    process.env.S3_REGION ||
    'us-west-2';

  if (!bucket || !aki || !sec) {
    console.error(
      '[backfill-prod-list-thumbs] Missing prod S3 config. Set PROD_S3_BUCKET, PROD_S3_AKI, PROD_S3_SEC (or S3_BUCKET / S3_AKI / S3_SEC).',
    );
    process.exit(1);
  }

  process.env.S3_BUCKET = bucket;
  process.env.S3_AKI = aki;
  process.env.S3_SEC = sec;
  process.env.AWS_REGION = region;
  process.env.S3_REGION = region;

  console.log('[backfill-prod-list-thumbs] S3 bucket:', bucket, 'region:', region);
}

/**
 * @returns {string}
 */
function requireProdMongoUri() {
  const uri =
    process.env.PROD_MONGODB_URI ||
    process.env.PROD_DB_URI ||
    process.env.DB_URI;
  if (!uri || !String(uri).trim()) {
    console.error(
      '[backfill-prod-list-thumbs] Missing PROD_MONGODB_URI (or PROD_DB_URI / DB_URI).',
    );
    process.exit(1);
  }
  return String(uri).trim();
}

/**
 * @param {string} dir
 */
function ensureBackupDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * @param {string} dir
 * @param {string} kind
 * @param {import('mongoose').Document} doc
 */
function writeBackup(dir, kind, doc) {
  const id = doc._id.toString();
  const file = path.join(dir, `${kind}-${id}.json`);
  const payload = {
    _id: id,
    backedUpAt: new Date().toISOString(),
    document: doc.toObject ? doc.toObject() : doc,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
}

/**
 * @param {string} dir
 * @param {'locations'|'events'} kind
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function loadBackupDocument(dir, kind, id) {
  const file = path.join(dir, `${kind}-${id}.json`);
  if (!fs.existsSync(file)) {
    console.warn('[backfill-prod-list-thumbs] backup missing:', file);
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.document || null;
}

/**
 * Count image media missing list_thumb_url in a location or event doc.
 * @param {object} doc
 * @returns {{ total: number, missing: number }}
 */
function countListThumbGaps(doc) {
  let total = 0;
  let missing = 0;
  const scan = items => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || item.type !== 'image') continue;
      const u = String(item.url || '').trim();
      if (!u) continue;
      total += 1;
      if (!String(item.list_thumb_url || '').trim()) missing += 1;
    }
  };
  scan(doc.media);
  if (Array.isArray(doc.seats)) {
    for (const seat of doc.seats) scan(seat?.media);
  }
  if (Array.isArray(doc.units)) {
    for (const unit of doc.units) scan(unit?.media);
  }
  return { total, missing };
}

/**
 * @param {boolean} all
 * @returns {Promise<import('mongoose').QueryCursor>}
 */
function locationCursor(all) {
  if (all) return Location.find({}).cursor();
  return Location.find({ _id: { $in: DEFAULT_LOCATION_IDS } }).cursor();
}

/**
 * @param {boolean} all
 * @returns {Promise<import('mongoose').QueryCursor>}
 */
function eventCursor(all) {
  if (all) return Event.find({}).cursor();
  return Event.find({ _id: { $in: DEFAULT_EVENT_IDS } }).cursor();
}

/**
 * Revert locations/events from backup directory.
 * @param {string} backupDir
 * @param {boolean} all
 */
async function runRevert(backupDir, all) {
  const stats = { locations: 0, events: 0, skipped: 0 };
  const locIds = all ? fs.readdirSync(backupDir).filter(f => f.startsWith('locations-')) : DEFAULT_LOCATION_IDS.map(id => `locations-${id}.json`);
  const evIds = all ? fs.readdirSync(backupDir).filter(f => f.startsWith('events-')) : DEFAULT_EVENT_IDS.map(id => `events-${id}.json`);

  const locIdList = all
    ? locIds.map(f => f.replace('locations-', '').replace('.json', ''))
    : DEFAULT_LOCATION_IDS;
  const evIdList = all
    ? evIds.map(f => f.replace('events-', '').replace('.json', ''))
    : DEFAULT_EVENT_IDS;

  for (const id of locIdList) {
    const doc = await loadBackupDocument(backupDir, 'locations', id);
    if (!doc) {
      stats.skipped += 1;
      continue;
    }
    await Location.replaceOne({ _id: doc._id }, doc);
    stats.locations += 1;
    console.log('[revert] location', id);
  }

  for (const id of evIdList) {
    const doc = await loadBackupDocument(backupDir, 'events', id);
    if (!doc) {
      stats.skipped += 1;
      continue;
    }
    await Event.replaceOne({ _id: doc._id }, doc);
    stats.events += 1;
    console.log('[revert] event', id);
  }

  console.log('[backfill-prod-list-thumbs] revert done', stats);
}

/**
 * @param {{ dryRun: boolean, backupDir: string|null, all: boolean }} opts
 */
async function runBackfill(opts) {
  const stats = {
    locationsScanned: 0,
    locationsUpdated: 0,
    eventsScanned: 0,
    eventsUpdated: 0,
    listThumbsBefore: 0,
    listThumbsAfter: 0,
    errors: 0,
  };

  for await (const loc of locationCursor(opts.all)) {
    stats.locationsScanned += 1;
    const before = countListThumbGaps(loc);
    stats.listThumbsBefore += before.missing;

    try {
      if (opts.dryRun) {
        console.log(
          `[location] ${loc._id} "${loc.name || ''}" images=${before.total} missing_list_thumb=${before.missing} (dry-run, no S3/DB writes)`,
        );
        stats.listThumbsAfter += before.missing;
        continue;
      }

      if (opts.backupDir) {
        writeBackup(opts.backupDir, 'locations', loc);
      }

      const dirty = await enrichLocationImageFields(loc);
      const after = countListThumbGaps(loc);
      stats.listThumbsAfter += after.missing;

      if (dirty) {
        stats.locationsUpdated += 1;
        loc.markModified('media');
        loc.markModified('seats');
        loc.markModified('units');
        await loc.save();
      }

      console.log(
        `[location] ${loc._id} "${loc.name || ''}" images=${before.total} missing_list_thumb=${before.missing} -> ${after.missing}`,
      );
    } catch (e) {
      stats.errors += 1;
      console.warn('[location]', loc._id, e.message);
    }
  }

  for await (const ev of eventCursor(opts.all)) {
    stats.eventsScanned += 1;
    const before = countListThumbGaps(ev);
    stats.listThumbsBefore += before.missing;

    try {
      if (opts.dryRun) {
        console.log(
          `[event] ${ev._id} "${ev.name || ''}" images=${before.total} missing_list_thumb=${before.missing} (dry-run, no S3/DB writes)`,
        );
        stats.listThumbsAfter += before.missing;
        continue;
      }

      if (opts.backupDir) {
        writeBackup(opts.backupDir, 'events', ev);
      }

      const dirty = await enrichEventImageFields(ev);
      const after = countListThumbGaps(ev);
      stats.listThumbsAfter += after.missing;

      if (dirty) {
        stats.eventsUpdated += 1;
        ev.markModified('media');
        ev.markModified('seats');
        ev.markModified('units');
        await ev.save();
      }

      console.log(
        `[event] ${ev._id} "${ev.name || ''}" images=${before.total} missing_list_thumb=${before.missing} -> ${after.missing}`,
      );
    } catch (e) {
      stats.errors += 1;
      console.warn('[event]', ev._id, e.message);
    }
  }

  console.log('[backfill-prod-list-thumbs] done', {
    ...stats,
    dryRun: opts.dryRun,
    backupDir: opts.backupDir,
    scope: opts.all ? 'all' : 'copied-ids-only',
  });
}

async function main() {
  const args = parseArgs();
  if (args.useProdFromStageEnv) {
    applyProdMongoFromStageEnv();
  }
  const mongoUri = requireProdMongoUri();

  if (args.revert) {
    if (!args.backupDir) {
      console.error('--revert requires --backup-dir');
      process.exit(1);
    }
    console.log('[backfill-prod-list-thumbs] REVERT from', args.backupDir);
    await mongoose.connect(mongoUri);
    try {
      await runRevert(args.backupDir, args.all);
    } finally {
      await mongoose.connection.close();
    }
    return;
  }

  applyProdS3Env();

  if (args.backupDir && !args.dryRun) {
    ensureBackupDir(args.backupDir);
    console.log('[backfill-prod-list-thumbs] backups ->', path.resolve(args.backupDir));
  }

  console.log(
    '[backfill-prod-list-thumbs] connecting...',
    args.dryRun ? '(dry-run)' : '',
    args.all ? '(all docs)' : `(ids: ${DEFAULT_LOCATION_IDS.length} locations, ${DEFAULT_EVENT_IDS.length} events)`,
  );

  await mongoose.connect(mongoUri);
  try {
    await runBackfill({
      dryRun: args.dryRun,
      backupDir: args.backupDir,
      all: args.all,
    });
  } finally {
    await mongoose.connection.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

/**
 * Parse Artist/ image filenames into artist → genre rows, write data/artist-genres.json,
 * and upsert into stage and/or prod MongoDB.
 *
 * Usage (from server/):
 *   node scripts/seed-artist-genres.js --dry-run
 *   node scripts/seed-artist-genres.js --env stage
 *   node scripts/seed-artist-genres.js --env prod
 *   node scripts/seed-artist-genres.js --env both
 *   node scripts/seed-artist-genres.js --from-json   # skip Artist/ folder; use data/artist-genres.json
 *
 * Env:
 *   stage: STAGE_MONGODB_URI | DB_URI | MONGODB_URI
 *   prod:  PROD_MONGODB_URI | derived (the1-stage → the1-PROD)
 */

require('dotenv').config();
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const ArtistGenre = require('../models/ArtistGenre');
const { normalizeArtistKey } = require('../utils/artistNameNormalize');
const { tokenizeGenres } = require('../utils/artistGenreTokens');

const LOG = '[seed-artist-genres]';
dns.setServers(['8.8.8.8', '1.1.1.1']);

const ARTIST_DIR = path.join(__dirname, '..', 'Artist');
const JSON_OUT = path.join(__dirname, '..', 'data', 'artist-genres.json');

/** Artists that appear in filenames without a dash separator. */
const NO_DASH_ARTISTS = [
  { prefix: 'ACRAZE', artist: 'ACRAZE' },
  { prefix: 'JERRO', artist: 'JERRO' },
];

/**
 * @returns {{ dryRun: boolean, fromJson: boolean, envs: Array<'stage'|'prod'> }}
 */
function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  const fromJson = process.argv.includes('--from-json');
  const envArg = process.argv.find(a => a.startsWith('--env='));
  const envRaw = envArg ? envArg.slice('--env='.length).trim().toLowerCase() : 'both';
  /** @type {Array<'stage'|'prod'>} */
  let envs = ['stage', 'prod'];
  if (envRaw === 'stage') envs = ['stage'];
  else if (envRaw === 'prod') envs = ['prod'];
  else if (envRaw === 'both') envs = ['stage', 'prod'];
  else throw new Error(`Invalid --env=${envRaw} (use stage|prod|both)`);
  return { dryRun, fromJson, envs };
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
  if (!/\/the1-stage(\?|$)/i.test(stageUri)) {
    throw new Error(
      'Prod URI missing and could not derive from stage (expected /the1-stage)',
    );
  }
  return stageUri.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * Parse one filename (basename with extension) into artist/genre.
 * @param {string} fileName
 * @returns {{ artist: string, genre: string, sourceFile: string }|null}
 */
function parseArtistFileName(fileName) {
  const base = path.basename(fileName).replace(/\.[^.]+$/, '').trim();
  if (!base) return null;

  const dash = base.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dash) {
    return {
      artist: dash[1].replace(/\s+/g, ' ').trim(),
      genre: dash[2].replace(/\s+/g, ' ').trim().replace(/\s*2\s*$/i, '').trim(),
      sourceFile: fileName,
    };
  }

  for (const row of NO_DASH_ARTISTS) {
    const re = new RegExp(`^${row.prefix}\\b\\s*(.*)$`, 'i');
    const m = base.match(re);
    if (m) {
      return {
        artist: row.artist,
        genre: String(m[1] || '')
          .replace(/\s+/g, ' ')
          .trim(),
        sourceFile: fileName,
      };
    }
  }

  // No genre in filename
  return {
    artist: base.replace(/\s+/g, ' ').trim(),
    genre: '',
    sourceFile: fileName,
  };
}

/**
 * Build merged artist→genre rows from Artist/ folder.
 * @returns {Array<object>}
 */
function buildRowsFromArtistFolder() {
  if (!fs.existsSync(ARTIST_DIR)) {
    throw new Error(`Artist folder missing: ${ARTIST_DIR}`);
  }
  const files = fs
    .readdirSync(ARTIST_DIR)
    .filter(f => !f.startsWith('.') && /\.(jpe?g|png|webp|avif|gif)$/i.test(f));

  /** @type {Map<string, object>} */
  const byKey = new Map();

  for (const file of files) {
    const parsed = parseArtistFileName(file);
    if (!parsed) continue;
    const artistKey = normalizeArtistKey(parsed.artist);
    if (!artistKey) continue;

    const genres = tokenizeGenres(parsed.genre);
    const existing = byKey.get(artistKey);
    if (!existing) {
      byKey.set(artistKey, {
        artistKey,
        artist: parsed.artist,
        genre: parsed.genre,
        genres,
        sourceFiles: [parsed.sourceFile],
      });
      continue;
    }

    existing.sourceFiles.push(parsed.sourceFile);
    if (parsed.genre && !existing.genre) {
      existing.genre = parsed.genre;
    } else if (
      parsed.genre &&
      existing.genre &&
      !existing.genre.toLowerCase().includes(parsed.genre.toLowerCase())
    ) {
      existing.genre = `${existing.genre}; ${parsed.genre}`;
    }
    const seen = new Set(existing.genres.map(g => g.toLowerCase()));
    for (const g of genres) {
      if (!seen.has(g.toLowerCase())) {
        existing.genres.push(g);
        seen.add(g.toLowerCase());
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.artist.localeCompare(b.artist),
  );
}

/**
 * @returns {Array<object>}
 */
function loadRowsFromJson() {
  if (!fs.existsSync(JSON_OUT)) {
    throw new Error(`Missing ${JSON_OUT} — run once without --from-json first`);
  }
  const payload = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
  const rows = Array.isArray(payload?.artists) ? payload.artists : payload;
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('artist-genres.json has no artists');
  }
  return rows;
}

/**
 * @param {Array<object>} rows
 * @param {'stage'|'prod'} label
 * @param {boolean} dryRun
 */
async function upsertRows(rows, label, dryRun) {
  const uri = resolveMongoUri(label);
  const safe = uri.replace(/\/\/[^@]+@/, '//***@').replace(/\?.*$/, '');
  console.log(`${LOG} ${label}: connecting ${safe}`);

  if (dryRun) {
    console.log(`${LOG} ${label}: dry-run — would upsert ${rows.length} artists`);
    return;
  }

  await mongoose.connect(uri);
  let upserted = 0;
  for (const row of rows) {
    await ArtistGenre.findOneAndUpdate(
      { artistKey: row.artistKey },
      {
        $set: {
          artist: row.artist,
          genre: row.genre || '',
          genres: Array.isArray(row.genres) ? row.genres : [],
          sourceFiles: Array.isArray(row.sourceFiles) ? row.sourceFiles : [],
        },
        $setOnInsert: { artistKey: row.artistKey },
      },
      { upsert: true, new: true },
    );
    upserted += 1;
  }
  const count = await ArtistGenre.countDocuments();
  console.log(`${LOG} ${label}: upserted ${upserted}, collection count=${count}`);
  await mongoose.disconnect();
}

async function main() {
  const { dryRun, fromJson, envs } = parseArgs();
  console.log(`${LOG} start`, { dryRun, fromJson, envs });

  let rows;
  if (fromJson) {
    rows = loadRowsFromJson();
    console.log(`${LOG} loaded ${rows.length} from JSON`);
  } else {
    rows = buildRowsFromArtistFolder();
    const payload = {
      generatedAt: new Date().toISOString(),
      source: 'Artist/',
      count: rows.length,
      artists: rows,
    };
    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2));
    console.log(`${LOG} wrote ${rows.length} artists → ${JSON_OUT}`);
  }

  const missingGenre = rows.filter(r => !r.genre).map(r => r.artist);
  if (missingGenre.length) {
    console.warn(`${LOG} artists with empty genre:`, missingGenre);
  }

  for (const env of envs) {
    await upsertRows(rows, env, dryRun);
  }

  console.log(`${LOG} done`);
}

main().catch(err => {
  console.error(`${LOG} FAILED:`, err);
  process.exitCode = 1;
  return mongoose.disconnect().catch(() => {});
});

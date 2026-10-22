/**
 * ONE-OFF: Collapse similar catalog genre labels to one name each.
 * Updates ArtistGenre rows and Event copies of those labels only.
 *
 * Usage (from server/):
 *   node scripts/oneOffNormalizeSimilarGenreNames.js --stage
 *   node scripts/oneOffNormalizeSimilarGenreNames.js --prod
 */

require('dotenv').config();
const mongoose = require('mongoose');
const ArtistGenre = require('../models/ArtistGenre');
const Event = require('../models/Event');
const { tokenizeGenres } = require('../utils/artistGenreTokens');

const LOG = '[oneOffNormalizeSimilarGenreNames]';

/** Canonical display name -> the other labels that mean the same name. */
const GROUPS = [
  ['Hip Hop Pop Rap Trap', ['Hip Hop Rap Pop Trap', 'Hip Hop Rap Trap Pop', 'Hip HopRap Trap Pop']],
  ['Afro House Tech House', ['Tech House Afro House']],
  ['Bass Trap', ['Trap Bass']],
  ['EDM Bass Dubstep', ['EDM Dubstep Bass']],
  ['EDM Bass Trap', ['EDM Trap Bass']],
  ['EDM House Techno', ['EDM Techno House']],
  ['EDM Pop', ['EDM Popp']],
  ['EDM Pop Tropical House', ['EDM Tropical House Pop']],
  ['EDM Tech House', ['Tech House EDM']],
  ['EDM Tech House Melodic Techno', ['EDM Tech House Memodic Techno']],
  ['Hip Hop Rap R&B', ['Hip Hop - Rap - R&B']],
  ['Open Format (Various Genres)', ['Open Format (Various Genre)']],
  ['Tech House Bass', ['Tech House - Bass']],
];

/**
 * @param {string} value
 * @returns {string}
 */
function collapse(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {Map<string, { canonical: string, tokens: string[] }>}
 */
function buildMap() {
  const map = new Map();
  for (const [canonical, variants] of GROUPS) {
    const tokens = tokenizeGenres(canonical);
    if (!tokens.length) {
      throw new Error(`Canonical genre produced no tokens: ${canonical}`);
    }
    const names = [canonical, ...variants];
    for (const name of names) {
      const key = collapse(name).toLowerCase();
      if (map.has(key)) {
        throw new Error(`Duplicate genre label in map: ${name}`);
      }
      map.set(key, { canonical, tokens });
    }
  }
  return map;
}

const LABEL_MAP = buildMap();

/**
 * @param {string} label
 * @returns {{ canonical: string, tokens: string[] } | null}
 */
function lookup(label) {
  return LABEL_MAP.get(collapse(label).toLowerCase()) || null;
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {boolean}
 */
function sameList(left, right) {
  if (left.length !== right.length) return false;
  return left.every((item, i) => item === right[i]);
}

/**
 * @returns {string}
 */
function resolveProdMongoUri() {
  const explicit = process.env.PROD_MONGODB_URI || process.env.PROD_DB_URI || null;
  if (explicit) return explicit;
  const stageish =
    process.env.DB_URI ||
    process.env.MONGODB_URI ||
    process.env.STAGE_MONGODB_URI ||
    process.env.STAGE_DB_URI ||
    null;
  if (!stageish) {
    throw new Error('Set PROD_MONGODB_URI or DB_URI with /the1-stage to derive the1-PROD');
  }
  if (!/\/the1-stage(\?|$)/i.test(stageish)) {
    throw new Error(
      'Cannot derive prod URI: stage URI must contain /the1-stage, or set PROD_MONGODB_URI'
    );
  }
  return stageish.replace(/\/the1-stage(\?|$)/i, '/the1-PROD$1');
}

/**
 * @param {string[]} labels
 * @returns {string}
 */
function joinGenreLabels(labels) {
  const cleaned = labels.map(collapse).filter(Boolean);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0];
  return cleaned.join('; ');
}

/**
 * @param {Array<{ genres?: string[] }>} artists
 * @returns {string[]}
 */
function unionTokens(artists) {
  const seen = new Set();
  const out = [];
  for (const artist of artists) {
    const tokens = Array.isArray(artist.genres) ? artist.genres : [];
    for (const token of tokens) {
      const value = collapse(token);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * @param {string} expectedDbName
 * @returns {Promise<void>}
 */
async function applyToDb(expectedDbName) {
  const dbName = mongoose.connection.name;
  if (dbName !== expectedDbName) {
    throw new Error(`Refusing database "${dbName}", expected ${expectedDbName}`);
  }

  const artists = await ArtistGenre.find({}).select('artist genre genres').lean();
  let artistUpdates = 0;
  for (const row of artists) {
    const hit = lookup(row.genre);
    if (!hit) continue;
    const nextGenre = hit.canonical;
    const nextTokens = hit.tokens;
    const currentTokens = Array.isArray(row.genres) ? row.genres : [];
    if (collapse(row.genre) === nextGenre && sameList(currentTokens, nextTokens)) {
      continue;
    }
    await ArtistGenre.updateOne(
      { _id: row._id },
      { $set: { genre: nextGenre, genres: nextTokens } }
    );
    artistUpdates += 1;
    console.log(`${LOG} artist ${row.artist}: "${collapse(row.genre)}" -> "${nextGenre}"`);
  }

  const events = await Event.find({
    $or: [
      { 'matched_artists.0': { $exists: true } },
      { genre: { $nin: [null, ''] } },
    ],
  }).select('name genre genres matched_artists');

  let eventUpdates = 0;
  for (const event of events) {
    const matched = Array.isArray(event.matched_artists) ? event.matched_artists : [];
    const oldUnion = unionTokens(matched);
    let changed = false;
    for (const artist of matched) {
      const hit = lookup(artist.genre);
      if (!hit) continue;
      if (collapse(artist.genre) !== hit.canonical) {
        artist.genre = hit.canonical;
        changed = true;
      }
      if (!sameList(artist.genres || [], hit.tokens)) {
        artist.genres = hit.tokens;
        changed = true;
      }
    }

    let labelChanged = false;
    const nextLabel = joinGenreLabels(
      String(event.genre || '')
        .split(';')
        .map(part => {
          const hit = lookup(part);
          if (!hit) return collapse(part);
          if (collapse(part) !== hit.canonical) labelChanged = true;
          return hit.canonical;
        })
    );
    if (labelChanged) changed = true;
    if (!changed) continue;

    const newUnion = unionTokens(matched);
    const oldKeys = new Set(oldUnion.map(token => token.toLowerCase()));
    const extras = (event.genres || []).filter(
      token => !oldKeys.has(collapse(token).toLowerCase())
    );
    const nextTokens = unionTokens([{ genres: newUnion }, { genres: extras }]);
    const plainArtists = matched.map(artist => ({
      artist: artist.artist,
      artistKey: artist.artistKey,
      genre: artist.genre,
      genres: Array.isArray(artist.genres) ? [...artist.genres] : [],
    }));
    await Event.updateOne(
      { _id: event._id },
      {
        $set: {
          genre: labelChanged ? nextLabel : event.genre,
          genres: nextTokens,
          matched_artists: plainArtists,
        },
      }
    );
    eventUpdates += 1;
    console.log(
      `${LOG} event ${event._id} "${event.name || ''}" genre -> "${labelChanged ? nextLabel : event.genre}"`
    );
  }

  console.log(`${LOG} ${expectedDbName}: artists updated ${artistUpdates}, events updated ${eventUpdates}`);
}

async function main() {
  const mode = process.argv.includes('--prod')
    ? 'prod'
    : process.argv.includes('--stage')
      ? 'stage'
      : '';
  if (!mode) {
    throw new Error('Pass --stage or --prod');
  }
  const uri = mode === 'prod' ? resolveProdMongoUri() : process.env.DB_URI;
  const expected = mode === 'prod' ? 'the1-PROD' : 'the1-stage';
  if (!uri) throw new Error('DB_URI is missing');
  await mongoose.connect(uri);
  try {
    await applyToDb(expected);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error(LOG, err.message);
  process.exit(1);
});

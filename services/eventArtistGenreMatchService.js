/**
 * Match event names against ArtistGenre catalog (strict whole-phrase, longest first).
 * Also rewrites "DJ - Venue Event" titles to DJ-only when catalog-gated.
 */
const ArtistGenre = require('../models/ArtistGenre');
const { normalizeArtistKey } = require('../utils/artistNameNormalize');
const { tokenizeGenres } = require('../utils/artistGenreTokens');

const LOG = '[eventArtistGenreMatch]';
const MIN_ARTIST_KEY_CHARS = 3;
const CATALOG_TTL_MS = 5 * 60 * 1000;

/** Spaced dash only — never splits inside names like Eric D-Lux. */
const SPACED_DASH_RE = /\s+[-–—]\s+/;

/** @type {{ at: number, rows: Array<object> }|null} */
let catalogCache = null;

/**
 * Empty match result.
 * @returns {{ matched_artists: Array<object>, genres: string[], genre: string }}
 */
function emptyMatchResult() {
  return { matched_artists: [], genres: [], genre: '' };
}

/**
 * Compact key length (ignore spaces) for min-length gate.
 * @param {string} artistKey
 * @returns {number}
 */
function artistKeyCharCount(artistKey) {
  return String(artistKey || '').replace(/\s+/g, '').length;
}

/**
 * Whether a matched artist's key appears as a contiguous phrase in leftKey words.
 * @param {string[]} leftWords
 * @param {string} artistKey
 * @returns {boolean}
 */
function artistKeyCoversLeftPhrase(leftWords, artistKey) {
  const needle = String(artistKey || '')
    .split(' ')
    .filter(Boolean);
  if (!needle.length || needle.length > leftWords.length) return false;
  for (let i = 0; i <= leftWords.length - needle.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (leftWords[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Whether matched artists fully cover every word of the left-of-dash DJ segment.
 * @param {string} leftKey
 * @param {Array<{ artistKey: string }>} coveringArtists
 * @returns {boolean}
 */
function leftSegmentFullyCovered(leftKey, coveringArtists) {
  const leftWords = String(leftKey || '')
    .split(' ')
    .filter(Boolean);
  if (!leftWords.length || !coveringArtists.length) return false;

  const covered = new Array(leftWords.length).fill(false);
  for (const m of coveringArtists) {
    const needle = String(m.artistKey || '')
      .split(' ')
      .filter(Boolean);
    if (!needle.length) continue;
    for (let i = 0; i <= leftWords.length - needle.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) {
        if (leftWords[i + j] !== needle[j]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let j = 0; j < needle.length; j++) covered[i + j] = true;
    }
  }
  return covered.every(Boolean);
}

/**
 * If title is "DJ - Venue Event" and DJ matches catalog artists, return DJ-only display name.
 * @param {string} originalName
 * @param {Array<{ artist: string, artistKey: string }>} matchedArtists
 * @returns {string} original or rewritten name
 */
function resolveDjOnlyEventName(originalName, matchedArtists) {
  const raw = String(originalName || '').trim();
  if (!raw) return raw;
  if (!Array.isArray(matchedArtists) || matchedArtists.length === 0) {
    return raw;
  }
  if (!SPACED_DASH_RE.test(raw)) {
    return raw;
  }

  const left = raw.split(SPACED_DASH_RE)[0].trim();
  if (!left) return raw;

  const leftKey = normalizeArtistKey(left);
  if (!leftKey) return raw;

  const leftWords = leftKey.split(' ').filter(Boolean);
  const covering = matchedArtists.filter(m =>
    artistKeyCoversLeftPhrase(leftWords, m.artistKey),
  );
  if (!covering.length || !leftSegmentFullyCovered(leftKey, covering)) {
    return raw;
  }

  const seen = new Set();
  const names = [];
  for (const m of covering) {
    const display = String(m.artist || m.artistKey || '').trim();
    if (!display) continue;
    const k = display.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(display);
  }
  return names.length ? names.join(', ') : raw;
}

/**
 * Match artists in an event name against an in-memory catalog (pure; for tests).
 * @param {string} eventName
 * @param {Array<{ artistKey: string, artist?: string, genre?: string, genres?: string[] }>} catalog
 * @returns {{ matched_artists: Array<object>, genres: string[], genre: string }}
 */
function matchArtistsInEventNameAgainstCatalog(eventName, catalog) {
  const haystack = normalizeArtistKey(eventName);
  if (!haystack) return emptyMatchResult();

  const hayWords = haystack.split(' ').filter(Boolean);
  if (!hayWords.length) return emptyMatchResult();

  const used = new Array(hayWords.length).fill(false);
  const rows = Array.isArray(catalog) ? catalog : [];

  const sorted = rows
    .filter(row => {
      const key = String(row?.artistKey || '').trim();
      return key && artistKeyCharCount(key) >= MIN_ARTIST_KEY_CHARS;
    })
    .slice()
    .sort((a, b) => {
      const lenDiff =
        String(b.artistKey).length - String(a.artistKey).length;
      if (lenDiff !== 0) return lenDiff;
      const aw = String(a.artistKey).split(' ').length;
      const bw = String(b.artistKey).split(' ').length;
      return bw - aw;
    });

  /** @type {Array<object>} */
  const matched_artists = [];

  for (const row of sorted) {
    const needleWords = String(row.artistKey)
      .split(' ')
      .filter(Boolean);
    if (!needleWords.length) continue;

    let foundAt = -1;
    for (let i = 0; i <= hayWords.length - needleWords.length; i++) {
      let ok = true;
      for (let j = 0; j < needleWords.length; j++) {
        if (used[i + j] || hayWords[i + j] !== needleWords[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        foundAt = i;
        break;
      }
    }
    if (foundAt < 0) continue;

    for (let j = 0; j < needleWords.length; j++) {
      used[foundAt + j] = true;
    }

    matched_artists.push({
      artist: String(row.artist || row.artistKey).trim(),
      artistKey: String(row.artistKey).trim(),
      genre: String(row.genre || '').trim(),
      genres: Array.isArray(row.genres)
        ? row.genres.map(g => String(g).trim()).filter(Boolean)
        : [],
    });
  }

  /** @type {string[]} */
  const genres = [];
  const seenGenre = new Set();
  for (const m of matched_artists) {
    let artistGenres = Array.isArray(m.genres)
      ? m.genres.map(g => String(g).trim()).filter(Boolean)
      : [];
    if (!artistGenres.length && m.genre) {
      // Prefer tokenized label when catalog row has genre text but empty genres[]
      artistGenres = tokenizeGenres(m.genre);
      m.genres = artistGenres;
    }
    for (const g of artistGenres) {
      const k = g.toLowerCase();
      if (seenGenre.has(k)) continue;
      seenGenre.add(k);
      genres.push(g);
    }
  }

  const genreLabels = matched_artists
    .map(m => m.genre)
    .filter(Boolean);
  const genre =
    genreLabels.length === 0
      ? ''
      : genreLabels.length === 1
        ? genreLabels[0]
        : genreLabels.join('; ');

  return { matched_artists, genres, genre };
}

/**
 * Load ArtistGenre rows (cached briefly).
 * @returns {Promise<Array<object>}
 */
async function loadArtistGenreCatalog() {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.rows;
  }
  const rows = await ArtistGenre.find({})
    .select('artistKey artist genre genres')
    .lean();
  catalogCache = { at: now, rows: Array.isArray(rows) ? rows : [] };
  return catalogCache.rows;
}

/**
 * Clear in-memory catalog cache (tests / after seed).
 */
function clearArtistGenreCatalogCache() {
  catalogCache = null;
}

/**
 * Match event name against DB ArtistGenre catalog.
 * @param {string} eventName
 * @returns {Promise<{ matched_artists: Array<object>, genres: string[], genre: string }>}
 */
async function matchArtistsInEventName(eventName) {
  const catalog = await loadArtistGenreCatalog();
  return matchArtistsInEventNameAgainstCatalog(eventName, catalog);
}

/**
 * Apply match fields onto an event payload or mongoose doc (mutates).
 * When title is "DJ - Venue Event" and DJ is catalog-matched, rewrite name to DJ-only.
 * Never throws — logs and sets empty fields on failure.
 * @param {object} payloadOrDoc
 * @returns {Promise<object>}
 */
async function applyEventArtistGenreMatch(payloadOrDoc) {
  if (!payloadOrDoc || typeof payloadOrDoc !== 'object') {
    return payloadOrDoc;
  }
  try {
    const name = payloadOrDoc.name;
    const result = await matchArtistsInEventName(name);
    payloadOrDoc.matched_artists = result.matched_artists;
    payloadOrDoc.genres = result.genres;
    payloadOrDoc.genre = result.genre;

    const nextName = resolveDjOnlyEventName(
      String(name || ''),
      result.matched_artists,
    );
    if (nextName && nextName !== String(name || '').trim()) {
      console.info(
        `${LOG} DJ-only rename: ${JSON.stringify(String(name))} → ${JSON.stringify(nextName)}`,
      );
      payloadOrDoc.name = nextName;
    }
  } catch (err) {
    console.warn(
      `${LOG} match failed (continuing without genres):`,
      err?.message || err,
    );
    payloadOrDoc.matched_artists = [];
    payloadOrDoc.genres = [];
    payloadOrDoc.genre = '';
  }
  return payloadOrDoc;
}

module.exports = {
  MIN_ARTIST_KEY_CHARS,
  emptyMatchResult,
  matchArtistsInEventNameAgainstCatalog,
  resolveDjOnlyEventName,
  loadArtistGenreCatalog,
  clearArtistGenreCatalogCache,
  matchArtistsInEventName,
  applyEventArtistGenreMatch,
  normalizeArtistKey,
};

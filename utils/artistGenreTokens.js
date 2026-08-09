/**
 * Tokenize a human genre label into filterable genre tokens.
 * Shared by seed scripts and admin artist-genre APIs.
 * @param {string} genreRaw
 * @returns {string[]}
 */
function tokenizeGenres(genreRaw) {
  const raw = String(genreRaw || '')
    .replace(/\s*2\s*$/i, '')
    .replace(/&/g, ' ')
    .replace(/\//g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return [];

  /** Known multi-word genres (longest first). */
  const phrases = [
    'Open Format (Various Genres)',
    'Open Format',
    'Various Genres',
    'Melodic House',
    'Melodic Techno',
    'Tech House',
    'Deep House',
    'Tropical House',
    'Afro House',
    'Bass House',
    'Electro House',
    'Progressive Electro House',
    'Hip Hop',
    'R&B',
    'R And B',
  ];

  let rest = raw;
  /** @type {string[]} */
  const found = [];
  for (const phrase of phrases) {
    const re = new RegExp(phrase.replace(/[()]/g, '\\$&'), 'ig');
    if (re.test(rest)) {
      found.push(phrase === 'R And B' ? 'R&B' : phrase);
      rest = rest.replace(re, ' ');
    }
  }
  rest = rest.replace(/\s+/g, ' ').trim();
  if (rest) {
    for (const part of rest.split(' ')) {
      const token = part.trim();
      if (!token) continue;
      if (/^(and|or|the|of|various)$/i.test(token)) continue;
      found.push(token);
    }
  }

  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const g of found) {
    const key = g.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

/**
 * Normalize genres input from admin UI (array or comma/semicolon string).
 * Falls back to tokenizeGenres(genre) when genres empty.
 * @param {unknown} genresInput
 * @param {string} [genreFallback]
 * @returns {string[]}
 */
function normalizeGenresInput(genresInput, genreFallback = '') {
  /** @type {string[]} */
  let tokens = [];
  if (Array.isArray(genresInput)) {
    tokens = genresInput.map(g => String(g || '').trim()).filter(Boolean);
  } else if (typeof genresInput === 'string' && genresInput.trim()) {
    tokens = genresInput
      .split(/[;,|]+/)
      .map(g => g.trim())
      .filter(Boolean);
  }
  if (!tokens.length && genreFallback) {
    tokens = tokenizeGenres(genreFallback);
  }
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

module.exports = {
  tokenizeGenres,
  normalizeGenresInput,
};

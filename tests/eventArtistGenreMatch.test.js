/**
 * Strict artist→genre matching from event names.
 * Run: node tests/eventArtistGenreMatch.test.js
 */
const assert = require('assert');
const {
  matchArtistsInEventNameAgainstCatalog,
  resolveDjOnlyEventName,
  normalizeArtistKey,
} = require('../services/eventArtistGenreMatchService');

const CATALOG = [
  {
    artistKey: 'THE CHAINSMOKERS',
    artist: 'THE CHAINSMOKERS',
    genre: 'EDM Bass',
    genres: ['EDM', 'Bass'],
  },
  {
    artistKey: 'JOHN SUMMIT',
    artist: 'JOHN SUMMIT',
    genre: 'EDM Tech House Melodic House',
    genres: ['Melodic House', 'Tech House', 'EDM'],
  },
  {
    artistKey: 'CID',
    artist: 'CID',
    genre: 'Tech House',
    genres: ['Tech House'],
  },
  {
    artistKey: 'TIESTO',
    artist: 'Tiësto',
    genre: 'EDM Trance Pop',
    genres: ['EDM', 'Trance', 'Pop'],
  },
  {
    artistKey: 'ROSS',
    artist: 'ROSS',
    genre: 'EDM',
    genres: ['EDM'],
  },
  {
    artistKey: 'ERIC D LUX',
    artist: 'ERIC D-LUX',
    genre: 'Open Format (Various Genre)',
    genres: ['Open Format'],
  },
];

function testExactPhraseMatch() {
  const r = matchArtistsInEventNameAgainstCatalog(
    'JOHN SUMMIT at OMNIA Nightclub',
    CATALOG,
  );
  assert.strictEqual(r.matched_artists.length, 1);
  assert.strictEqual(r.matched_artists[0].artistKey, 'JOHN SUMMIT');
  assert.ok(r.genres.includes('EDM'));
  assert.ok(r.genre.includes('EDM'));
}

function testNoSubstringInsideWord() {
  const r = matchArtistsInEventNameAgainstCatalog(
    'CIDER HOUSE PARTY',
    CATALOG,
  );
  assert.strictEqual(r.matched_artists.length, 0);
  assert.deepStrictEqual(r.genres, []);
  assert.strictEqual(r.genre, '');
}

function testLongerArtistPreferred() {
  const catalog = [
    {
      artistKey: 'CHAIN',
      artist: 'CHAIN',
      genre: 'Short',
      genres: ['Short'],
    },
    ...CATALOG,
  ];
  const r = matchArtistsInEventNameAgainstCatalog(
    'THE CHAINSMOKERS LIVE',
    catalog,
  );
  assert.strictEqual(r.matched_artists.length, 1);
  assert.strictEqual(r.matched_artists[0].artistKey, 'THE CHAINSMOKERS');
  assert.ok(!r.matched_artists.some(m => m.artistKey === 'CHAIN'));
}

function testAccentedNames() {
  const r = matchArtistsInEventNameAgainstCatalog(
    'Tiësto - Trance Night',
    CATALOG,
  );
  assert.strictEqual(r.matched_artists.length, 1);
  assert.strictEqual(r.matched_artists[0].artistKey, 'TIESTO');
  assert.strictEqual(
    normalizeArtistKey('Tiësto'),
    'TIESTO',
  );
}

function testNoMatchEmpty() {
  const r = matchArtistsInEventNameAgainstCatalog(
    'Private Corporate Mixer',
    CATALOG,
  );
  assert.deepStrictEqual(r, {
    matched_artists: [],
    genres: [],
    genre: '',
  });
}

function testCidWholeWord() {
  const r = matchArtistsInEventNameAgainstCatalog('CID at Marquee', CATALOG);
  assert.strictEqual(r.matched_artists.length, 1);
  assert.strictEqual(r.matched_artists[0].artistKey, 'CID');
}

function testNonOverlappingMultiArtist() {
  const r = matchArtistsInEventNameAgainstCatalog(
    'JOHN SUMMIT B2B CID',
    CATALOG,
  );
  assert.strictEqual(r.matched_artists.length, 2);
  const keys = r.matched_artists.map(m => m.artistKey).sort();
  assert.deepStrictEqual(keys, ['CID', 'JOHN SUMMIT']);
}

function testDjOnlyEricDLux() {
  const title = 'Eric D-Lux - Good Life Fridays';
  const r = matchArtistsInEventNameAgainstCatalog(title, CATALOG);
  assert.strictEqual(r.matched_artists.length, 1);
  assert.strictEqual(r.matched_artists[0].artistKey, 'ERIC D LUX');
  assert.ok(r.genres.includes('Open Format'));
  const renamed = resolveDjOnlyEventName(title, r.matched_artists);
  assert.strictEqual(renamed, 'ERIC D-LUX');
}

function testDjOnlyJohnSummit() {
  const title = 'JOHN SUMMIT - Some Venue Party';
  const r = matchArtistsInEventNameAgainstCatalog(title, CATALOG);
  assert.strictEqual(r.matched_artists.length, 1);
  const renamed = resolveDjOnlyEventName(title, r.matched_artists);
  assert.strictEqual(renamed, 'JOHN SUMMIT');
}

function testDjOnlyUnmatchedUnchanged() {
  const title = 'Some Random - Party';
  const r = matchArtistsInEventNameAgainstCatalog(title, CATALOG);
  assert.strictEqual(r.matched_artists.length, 0);
  assert.strictEqual(
    resolveDjOnlyEventName(title, r.matched_artists),
    title,
  );
}

function testDjOnlyNoSuffixUnchanged() {
  const title = 'Eric D-Lux';
  const r = matchArtistsInEventNameAgainstCatalog(title, CATALOG);
  assert.strictEqual(r.matched_artists.length, 1);
  assert.strictEqual(
    resolveDjOnlyEventName(title, r.matched_artists),
    title,
  );
}

function testBareHyphenInsideArtistNeverSplits() {
  const title = 'Eric D-Lux Night';
  const r = matchArtistsInEventNameAgainstCatalog(title, CATALOG);
  assert.strictEqual(r.matched_artists.length, 1);
  assert.strictEqual(
    resolveDjOnlyEventName(title, r.matched_artists),
    title,
  );
  // Direct helper: spaced-dash required
  assert.strictEqual(
    resolveDjOnlyEventName('Eric D-Lux', [
      { artist: 'ERIC D-LUX', artistKey: 'ERIC D LUX' },
    ]),
    'Eric D-Lux',
  );
}

function run() {
  testExactPhraseMatch();
  testNoSubstringInsideWord();
  testLongerArtistPreferred();
  testAccentedNames();
  testNoMatchEmpty();
  testCidWholeWord();
  testNonOverlappingMultiArtist();
  testDjOnlyEricDLux();
  testDjOnlyJohnSummit();
  testDjOnlyUnmatchedUnchanged();
  testDjOnlyNoSuffixUnchanged();
  testBareHyphenInsideArtistNeverSplits();
  console.log('eventArtistGenreMatch.test.js: all passed');
}

run();

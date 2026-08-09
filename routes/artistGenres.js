/**
 * Artist → genre catalog endpoints (labels for prioritize genre filter).
 */
const express = require('express');
const ArtistGenre = require('../models/ArtistGenre');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * Collect unique genre tokens from ArtistGenre docs.
 * @param {Array<object>} rows
 * @returns {string[]}
 */
function collectUniqueGenreLabels(rows) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const row of rows || []) {
    const tokens = Array.isArray(row?.genres) ? row.genres : [];
    if (tokens.length) {
      for (const t of tokens) {
        const label = String(t || '').trim();
        if (!label) continue;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(label);
      }
      continue;
    }
    const raw = String(row?.genre || '').trim();
    if (!raw) continue;
    for (const part of raw.split(/[;,/|]+/)) {
      const label = part.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/**
 * GET /v1/artist-genres
 * Unique genre labels for client prioritize filter (any authenticated user).
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const rows = await ArtistGenre.find({})
      .select('genre genres')
      .lean();
    const genres = collectUniqueGenreLabels(rows);
    return res.json({
      success: true,
      data: { genres },
    });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] GET /artist-genres error:`,
      err,
    );
    return res.status(500).json({
      success: false,
      error: {
        code: 'ARTIST_GENRES_FETCH_FAILED',
        message: 'Failed to load genre labels',
      },
    });
  }
});

module.exports = router;
module.exports.collectUniqueGenreLabels = collectUniqueGenreLabels;

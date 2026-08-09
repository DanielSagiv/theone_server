/**
 * Artist → genre catalog endpoints (labels for prioritize filter + admin manage).
 */
const express = require('express');
const mongoose = require('mongoose');
const ArtistGenre = require('../models/ArtistGenre');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { normalizeArtistKey } = require('../utils/artistNameNormalize');
const { normalizeGenresInput } = require('../utils/artistGenreTokens');
const {
  clearArtistGenreCatalogCache,
} = require('../services/eventArtistGenreMatchService');

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
 * Build a lean public row for admin UI.
 * @param {object} doc
 * @returns {object}
 */
function toAdminRow(doc) {
  return {
    id: String(doc._id),
    artistKey: doc.artistKey,
    artist: doc.artist,
    genre: doc.genre || '',
    genres: Array.isArray(doc.genres) ? doc.genres : [],
    sourceFiles: Array.isArray(doc.sourceFiles) ? doc.sourceFiles : [],
    updatedAt: doc.updatedAt || null,
    createdAt: doc.createdAt || null,
  };
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

/**
 * GET /v1/artist-genres/catalog
 * Full artist→genre catalog for admin EJS console (searchable).
 */
router.get('/catalog', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const filter = {};
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { artist: re },
        { artistKey: re },
        { genre: re },
        { genres: re },
      ];
    }

    const [rows, total] = await Promise.all([
      ArtistGenre.find(filter).sort({ artist: 1 }).lean(),
      ArtistGenre.countDocuments({}),
    ]);
    const artists = rows.map(toAdminRow);
    const allForLabels = q
      ? await ArtistGenre.find({}).select('genre genres').lean()
      : rows;
    const genreLabels = collectUniqueGenreLabels(allForLabels);

    return res.json({
      success: true,
      data: {
        count: artists.length,
        total,
        artists,
        genreLabels,
      },
    });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] GET /artist-genres/catalog error:`,
      err,
    );
    return res.status(500).json({
      success: false,
      error: {
        code: 'ARTIST_GENRES_CATALOG_FAILED',
        message: 'Failed to load artist genre catalog',
      },
    });
  }
});

/**
 * POST /v1/artist-genres/catalog
 * Create artist→genre mapping (admin).
 */
router.post('/catalog', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const artist = String(req.body?.artist || '').trim();
    if (!artist) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'artist is required' },
      });
    }
    const artistKey = normalizeArtistKey(artist);
    if (!artistKey) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'artist is invalid' },
      });
    }

    const genre = String(req.body?.genre || '').trim();
    const genres = normalizeGenresInput(req.body?.genres, genre);
    const sourceFiles = Array.isArray(req.body?.sourceFiles)
      ? req.body.sourceFiles.map(s => String(s || '').trim()).filter(Boolean)
      : [];

    const existing = await ArtistGenre.findOne({ artistKey }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ARTIST_EXISTS',
          message: `Artist already mapped (${existing.artist})`,
          existingId: String(existing._id),
        },
      });
    }

    const doc = await ArtistGenre.create({
      artistKey,
      artist,
      genre,
      genres,
      sourceFiles,
    });
    clearArtistGenreCatalogCache();

    return res.status(201).json({
      success: true,
      message: 'Artist genre created',
      data: { artist: toAdminRow(doc.toObject()) },
    });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] POST /artist-genres/catalog error:`,
      err,
    );
    return res.status(500).json({
      success: false,
      error: {
        code: 'ARTIST_GENRES_CREATE_FAILED',
        message: 'Failed to create artist genre',
      },
    });
  }
});

/**
 * PUT /v1/artist-genres/catalog/:id
 * Update artist→genre mapping (admin).
 */
router.put('/catalog/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid id' },
      });
    }

    const existing = await ArtistGenre.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Artist genre not found' },
      });
    }

    if (req.body?.artist != null) {
      const artist = String(req.body.artist || '').trim();
      if (!artist) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'artist cannot be empty' },
        });
      }
      const artistKey = normalizeArtistKey(artist);
      if (!artistKey) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'artist is invalid' },
        });
      }
      if (artistKey !== existing.artistKey) {
        const clash = await ArtistGenre.findOne({
          artistKey,
          _id: { $ne: existing._id },
        }).lean();
        if (clash) {
          return res.status(409).json({
            success: false,
            error: {
              code: 'ARTIST_EXISTS',
              message: `Another row already uses artist key ${artistKey}`,
            },
          });
        }
        existing.artist = artist;
        existing.artistKey = artistKey;
      } else {
        existing.artist = artist;
      }
    }

    if (req.body?.genre != null) {
      existing.genre = String(req.body.genre || '').trim();
    }

    if (req.body?.genres != null || req.body?.genre != null) {
      existing.genres = normalizeGenresInput(
        req.body?.genres != null ? req.body.genres : existing.genres,
        existing.genre,
      );
    }

    if (req.body?.sourceFiles != null) {
      existing.sourceFiles = Array.isArray(req.body.sourceFiles)
        ? req.body.sourceFiles.map(s => String(s || '').trim()).filter(Boolean)
        : [];
    }

    await existing.save();
    clearArtistGenreCatalogCache();

    return res.json({
      success: true,
      message: 'Artist genre updated',
      data: { artist: toAdminRow(existing.toObject()) },
    });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] PUT /artist-genres/catalog/:id error:`,
      err,
    );
    return res.status(500).json({
      success: false,
      error: {
        code: 'ARTIST_GENRES_UPDATE_FAILED',
        message: 'Failed to update artist genre',
      },
    });
  }
});

/**
 * DELETE /v1/artist-genres/catalog/:id
 * Delete artist→genre mapping (admin).
 */
router.delete(
  '/catalog/:id',
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid id' },
        });
      }

      const deleted = await ArtistGenre.findByIdAndDelete(id).lean();
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Artist genre not found' },
        });
      }
      clearArtistGenreCatalogCache();

      return res.json({
        success: true,
        message: 'Artist genre deleted',
        data: { id, artist: deleted.artist },
      });
    } catch (err) {
      console.error(
        `[${new Date().toISOString()}] DELETE /artist-genres/catalog/:id error:`,
        err,
      );
      return res.status(500).json({
        success: false,
        error: {
          code: 'ARTIST_GENRES_DELETE_FAILED',
          message: 'Failed to delete artist genre',
        },
      });
    }
  },
);

module.exports = router;
module.exports.collectUniqueGenreLabels = collectUniqueGenreLabels;

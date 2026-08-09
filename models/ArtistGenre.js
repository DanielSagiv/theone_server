const mongoose = require('mongoose');

/**
 * Artist → genre mapping (from Artist/ filename catalog).
 * One document per artist; genres stored as display string + token list.
 */
const ArtistGenreSchema = new mongoose.Schema(
  {
    /** Unique lookup key (normalized artist name). */
    artistKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    /** Display name as parsed from source. */
    artist: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    /** Raw genre label (human-readable). */
    genre: {
      type: String,
      trim: true,
      default: '',
    },
    /** Tokenized genres for filtering (e.g. ["EDM", "Tech House"]). */
    genres: {
      type: [String],
      default: [],
    },
    sourceFiles: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

ArtistGenreSchema.index({ genres: 1 });

module.exports = mongoose.model('ArtistGenre', ArtistGenreSchema);

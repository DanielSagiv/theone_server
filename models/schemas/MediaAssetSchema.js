const mongoose = require('mongoose');

/**
 * Shared embedded media asset (image/video) with optional dimensions and thumbnail URL.
 */
const MediaAssetSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['image', 'video'], required: true },
    url: { type: String, required: true, trim: true },
    caption: { type: String, trim: true },
    order: { type: Number, default: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    byte_size: { type: Number, min: 0 },
    thumb_url: { type: String, trim: true },
    /** Long-edge ~240px JPEG for lists / small tiles (optional; falls back to thumb_url). */
    list_thumb_url: { type: String, trim: true },
  },
  { _id: false }
);

module.exports = MediaAssetSchema;

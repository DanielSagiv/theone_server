const mongoose = require('mongoose');

/**
 * Menu item within a venue menu section.
 */
const VenueMenuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    price: { type: Number, min: 0, default: null },
    priceLabel: { type: String, trim: true, default: '' },
    sortOrder: { type: Number, default: 0 },
    available: { type: Boolean, default: true },
  },
  { _id: true },
);

/**
 * Section grouping menu items (e.g. Cocktails, Bottles).
 */
const VenueMenuSectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sortOrder: { type: Number, default: 0 },
    items: { type: [VenueMenuItemSchema], default: [] },
  },
  { _id: true },
);

/**
 * Venue F&B menu document — one per location (v1).
 * Related to Location via location_id; separate from Location.menu (GXN URL).
 */
const VenueMenuSchema = new mongoose.Schema(
  {
    location_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
      unique: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['draft', 'active'],
      default: 'active',
      index: true,
    },
    currency: { type: String, trim: true, default: 'USD' },
    sourcePdfUrl: { type: String, trim: true, default: '' },
    sections: { type: [VenueMenuSectionSchema], default: [] },
    notes: { type: String, trim: true, default: '' },
  },
  { timestamps: true },
);

VenueMenuSchema.index({ location_id: 1, status: 1 });

module.exports = mongoose.model('VenueMenu', VenueMenuSchema);

const mongoose = require('mongoose');
const MediaAssetSchema = require('./schemas/MediaAssetSchema');
const { LOCATION_SEAT_CATEGORY_VALUES } = require('../constants/locationSeatCategories');

const AssetSchema = MediaAssetSchema;

/**
 * Admin sentiment for venue/unit/seat
 */
const SentimentSchema = new mongoose.Schema({
  text: { type: String, trim: true },
  type: { type: String, enum: ['A', 'B'], required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

/**
 * Seat/table for night/day clubs (map-linked)
 */
const SeatSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, index: true },
  label: { type: String, trim: true },
  category: {
    type: String,
    enum: LOCATION_SEAT_CATEGORY_VALUES,
    index: true
  },
  // THE1 business-facing category (independent of GXN/structural category)
  the1Category: {
    type: String,
    trim: true,
    index: true
  },
  section: { type: String, trim: true },
  capacity: { type: Number, min: 0 },
  minSpendUSD: { type: Number, min: 0 },
  priceTier: { type: Number, min: 1, max: 5 },
  qualityScore: { type: Number, min: 1, max: 10, default: 5 }, // Overall seat quality rating for upgrade comparisons
  mapAnchor: { x: Number, y: Number },
  polygon: [{ x: Number, y: Number }],
  media: [AssetSchema],
  sentiment: [SentimentSchema],
}, { _id: true }); // Enable unique IDs for each seat

/**
 * Hotel unit (room/suite)
 */
const UnitSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true, index: true },
  kind: { type: String, enum: ['standard','deluxe','suite','penthouse'], required: true, index: true },
  beds: { type: Number, min: 0 },
  occupancy: { type: Number, min: 1 },
  view: { type: String, trim: true },
  smoking: { type: Boolean, default: false },
  floor: { type: Number, min: 0 },
  minPriceUSD: { type: Number, min: 0 },
  media: [AssetSchema],
  sentiment: [SentimentSchema]
}, { _id: true }); // Enable unique IDs for each unit

/**
 * Location model covering night_club, day_club, restaurant, hotel
 */
const LocationSchema = new mongoose.Schema({
  type: { type: String, enum: ['night_club','day_club','restaurant','hotel'], required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  address: {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, trim: true, index: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true, index: true },
    postalCode: { type: String, trim: true }
  },
  geo: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], index: '2dsphere', default: undefined }
  },
  media: [AssetSchema],
  score: { type: Number, min: 0, max: 5, default: 0 },
  tags: [{ type: String, trim: true }],
  status: { type: String, enum: ['draft','active','archived'], default: 'active' },
  /** Suggested gratuity / tip rate as percentage 0–100; optional for legacy venues. */
  gratuityPercent: { type: Number, min: 0, max: 100 },
  /** Venue admin fee as percentage 0–100; optional for legacy venues. */
  adminFeePercent: { type: Number, min: 0, max: 100 },
  /** Sales tax as percentage 0–100; optional for legacy venues. */
  salesTaxPercent: { type: Number, min: 0, max: 100 },
  // GXN integration field
  gxnVenueCode: { type: String, trim: true }, // GXN venue code (e.g., VEN505115) - sparse index defined below
  // Tao Group integration - external venue id for import idempotency
  taoVenueId: { type: String, trim: true },
  // GXN venue metadata
  timezone: { type: String, trim: true }, // Venue timezone (e.g., "America/Los_Angeles")
  tagline: { type: String, trim: true }, // Short marketing tagline
  directions: { type: String, trim: true }, // Directions/instructions text
  menu: { type: String, trim: true }, // Menu URL
  socials: [{
    linktype: { type: String, trim: true }, // e.g., "Facebook", "Twitter", "Instagram"
    url: { type: String, trim: true }, // Social media URL
    linktypecode: { type: String, trim: true } // GXN link type code (optional, for reference)
  }],
  operatingHours: {
    weekstring: { type: String, trim: true }, // Human-readable summary
    weekdays: [{
      weekday: { type: Number, min: 1, max: 7 }, // 1-7 (Mon-Sun)
      openTime: { type: String, trim: true }, // "08:00" format
      closeTime: { type: String, trim: true }, // "20:00" format
      timestring: { type: String, trim: true } // "From 8:00am to 8:00pm"
    }]
  },
  seasons: { type: mongoose.Schema.Types.Mixed }, // Operating seasons configuration (stored as-is from GXN)
  contact: {
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true },
    website: { type: String, trim: true }
  },
  attributes: {
    bottleService: { type: Boolean, default: undefined },
    dressCode: { type: String, trim: true },
    agePolicy: { type: String, trim: true },
    musicGenres: [{ type: String, trim: true }],
    tableMapUrl: { type: String, trim: true },
    capacity: { type: Number, min: 0 },
    cuisine: [{ type: String, trim: true }],
    priceLevel: { type: Number, min: 1, max: 5 },
    michelinStars: { type: Number, min: 0, max: 3 },
    privateDiningRooms: { type: Number, min: 0 },
    stars: { type: Number, min: 1, max: 5 },
    brand: { type: String, trim: true },
    checkInTime: { type: String, trim: true },
    checkOutTime: { type: String, trim: true },
    amenities: {
      spa: Boolean, gym: Boolean, pool: Boolean, parking: Boolean, wifi: Boolean,
      concierge: Boolean, businessCenter: Boolean, roomService: Boolean
    },
    conferenceRooms: { type: Number, min: 0 }
  },
  seats: [SeatSchema],
  units: [UnitSchema],
  sentiment: [SentimentSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

LocationSchema.index({ name: 'text', description: 'text', 'address.city': 1, 'address.country': 1 });
LocationSchema.index({ gxnVenueCode: 1 }, { sparse: true }); // Index for GXN venue code lookups
LocationSchema.index({ taoVenueId: 1 }, { sparse: true }); // Index for Tao Group venue lookups

module.exports = mongoose.model('Location', LocationSchema);


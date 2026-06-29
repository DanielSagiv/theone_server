const mongoose = require('mongoose');
const MediaAssetSchema = require('./schemas/MediaAssetSchema');

/**
 * Event-specific seat booking (inherited from location seats)
 */
const EventSeatSchema = new mongoose.Schema({
  seat_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // Reference to Location.seats[]._id
  code: { type: String, required: true, trim: true }, // Inherited from location
  label: { type: String, trim: true }, // Inherited from location
  category: { type: String, trim: true }, // Inherited from location
  section: { type: String, trim: true }, // Inherited from location
  capacity: { type: Number, min: 0 }, // Inherited from location
  min_spend: { type: Number, min: 0 }, // Inherited from location
  price_tier: { type: Number, min: 1, max: 5 }, // Inherited from location
  
  // Event-specific pricing and status
  event_price: { type: Number, min: 0 }, // Event-specific pricing
  event_min_spend: { type: Number, min: 0 }, // Event-specific minimum spend
  price_change_reason: { type: String, default: '' }, // Why price was changed
  status: { 
    type: String, 
    enum: ['available', 'held', 'booked', 'blocked'], 
    default: 'available' 
  },
  
  // Booking details
  booked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Who booked it
  booked_at: { type: Date }, // When it was booked
  booking_reference: { type: String, trim: true }, // COE or booking reference
  // Additional COEs sharing this seat (primary COE is in booking_reference)
  merged_coe_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'COE' }],
  
  /**
   * GXN Integration Identifiers
   */
  gxnItemCode: { type: String, trim: true }, // GXN item mastercode for this seat instance
  gxnMasterItemCode: { type: String, trim: true }, // GXN catalog master code
  
  // Map coordinates (inherited from location)
  map_anchor: { x: Number, y: Number },
  polygon: [{ x: Number, y: Number }],
  
  // Event-specific media
  media: [MediaAssetSchema]
}, { _id: true });

/**
 * Event-specific unit booking (inherited from location units)
 */
const EventUnitSchema = new mongoose.Schema({
  unit_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // Reference to Location.units[]._id
  code: { type: String, required: true, trim: true }, // Inherited from location
  kind: { 
    type: String, 
    enum: ['standard', 'deluxe', 'suite', 'penthouse'], 
    required: true 
  }, // Inherited from location
  beds: { type: Number, min: 0 }, // Inherited from location
  occupancy: { type: Number, min: 1 }, // Inherited from location
  view: { type: String, trim: true }, // Inherited from location
  smoking: { type: Boolean, default: false }, // Inherited from location
  floor: { type: Number, min: 0 }, // Inherited from location
  min_price: { type: Number, min: 0 }, // Inherited from location
  
  // Event-specific pricing and status
  event_price: { type: Number, min: 0 }, // Event-specific pricing
  status: { 
    type: String, 
    enum: ['available', 'held', 'booked', 'blocked','pending'], 
    default: 'available' 
  },
  
  // Booking details
  booked_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Who booked it
  booked_at: { type: Date }, // When it was booked
  booking_reference: { type: String, trim: true }, // COE or booking reference
  
  // Event-specific media
  media: [MediaAssetSchema]
}, { _id: true });

/**
 * Event model - represents a specific event at a location
 */
const EventSchema = new mongoose.Schema({
  // Basic Information
  name: { type: String, required: true, trim: true, index: true },
  description: { type: String, trim: true },
  type: { 
    type: String, 
    enum: ['night_club', 'day_club', 'restaurant', 'hotel', 'private', 'corporate'], 
    required: true, 
    index: true 
  },
  
  // Location Reference
  location_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Location', 
    required: true, 
    index: true 
  },
  
  // Event Timing
  start_datetime: { type: Date, required: true, index: true },
  end_datetime: { type: Date, required: false, index: true },
  timezone: { type: String, default: 'UTC' },
  
  // Capacity & Availability
  total_capacity: { type: Number, min: 0, required: true },
  total_available: { type: Number, min: 0, required: true },
  total_booked: { type: Number, min: 0, default: 0 },
  total_revenue: { type: Number, min: 0, default: 0 },
  
  // Pricing
  base_price: { type: Number, min: 0, required: true },
  currency: { type: String, default: 'USD', index: true },
  price_tier: { type: Number, min: 1, max: 5, default: 1 },
  
  
  // Event Status
  status: { 
    type: String, 
    enum: ['draft', 'pending', 'active', 'sold_out', 'cancelled', 'completed', 'archived'], 
    default: 'draft', 
    index: true 
  },
  
  // Event Details
  tags: [{ type: String, trim: true }],
  notes: { type: String, trim: true },
  policies: { type: String, trim: true },
  
  // Media & Assets
  media: [MediaAssetSchema],
  
  // Seats & Units (inherited from location with event-specific pricing/status)
  seats: [EventSeatSchema],
  units: [EventUnitSchema],
  
  // Event Management
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approved_at: { type: Date },
  
  // Availability Tracking
  last_availability_check: { type: Date, default: Date.now },
  availability_updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Event Analytics
  views: { type: Number, default: 0 },
  inquiries: { type: Number, default: 0 },
  conversion_rate: { type: Number, min: 0, max: 100, default: 0 },
  
  // COE Integration
  coe_count: { type: Number, default: 0 }, // Number of COEs that include this event
  is_featured: { type: Boolean, default: false }, // Featured event
  priority: { type: Number, default: 0 }, // Event priority for recommendations
  
  // GXN integration fields
  gxnEventCode: { type: String, trim: true }, // GXN event code (e.g., EVE50511500020251101) - primary unique identifier - sparse index defined below
  gxnEventId: { type: String, trim: true }, // GXN numeric event ID (e.g., 2048373)
  gxnEventDate: { type: String, trim: true }, // GXN date key (e.g., D251101) for reference
  // Tao Group integration - external event id for import idempotency
  taoEventId: { type: String, trim: true },
  // LIV venue listing - external event code for scrap import idempotency
  livEventCode: { type: String, trim: true },
  // OMNIA Night Club (Booketing) - external event code for scrap import idempotency
  omniaEventCode: { type: String, trim: true },
  // Hakkasan Las Vegas (Booketing) - external event code for scrap import idempotency
  hakkasanEventCode: { type: String, trim: true },
  // TAO Beach (Booketing) - external event code for scrap import idempotency
  taoBeachEventCode: { type: String, trim: true },
  // Palm Tree Beach (Booketing) - external event code for scrap import idempotency
  palmTreeBeachEventCode: { type: String, trim: true },
  // Marquee Dayclub (Booketing) - external event code for scrap import idempotency
  marqueeDayclubEventCode: { type: String, trim: true },
  // Marquee Nightclub (taogroup.com) - external event id for scrap import idempotency
  marqueeNightclubEventId: { type: String, trim: true },
  performers: [{ // Performer information (GXN codes + optional display fields)
    perfcode: { type: String, trim: true }, // Performer code (e.g., PER1242)
    importance: { type: String, trim: true }, // Performer importance level
    apprtime: { type: String, trim: true }, // Appearance time
    name: { type: String, trim: true }, // Display name (manual or enriched)
    description: { type: String, trim: true }, // Short bio or notes
    links: [
      {
        url: { type: String, trim: true },
        label: { type: String, trim: true }, // e.g. Instagram, Website
      },
    ],
  }],
  
  // Event Settings
  requires_approval: { type: Boolean, default: false }, // Requires admin approval
  auto_approve: { type: Boolean, default: true }, // Auto-approve bookings
  max_group_size: { type: Number, min: 1 }, // Maximum group size for booking
  
  // Cancellation Policy
  cancellation_policy: {
    hours_before_event: { type: Number, min: 0 }, // Hours before event for cancellation
    refund_percentage: { type: Number, min: 0, max: 100, default: 100 },
    admin_fee: { type: Number, min: 0, default: 0 }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual fields
EventSchema.virtual('duration_hours').get(function() {
  if (this.start_datetime && this.end_datetime) {
    return Math.ceil((this.end_datetime - this.start_datetime) / (1000 * 60 * 60));
  }
  return 0;
});

EventSchema.virtual('is_active').get(function() {
  const now = new Date();
  return this.status === 'active' && 
         this.start_datetime <= now && 
         this.end_datetime >= now;
});

EventSchema.virtual('is_upcoming').get(function() {
  const now = new Date();
  return this.status === 'active' && this.start_datetime > now;
});

EventSchema.virtual('is_past').get(function() {
  const now = new Date();
  return this.end_datetime < now;
});

EventSchema.virtual('availability_percentage').get(function() {
  if (this.total_capacity === 0) return 100;
  return Math.round((this.total_available / this.total_capacity) * 100);
});

// Indexes for performance
EventSchema.index({ location_id: 1, start_datetime: 1 });
EventSchema.index({ status: 1, start_datetime: 1 });
EventSchema.index({ start_datetime: 1, end_datetime: 1 });
EventSchema.index({ name: 'text', description: 'text' });
EventSchema.index({ tags: 1 });
EventSchema.index({ created_by: 1, status: 1 });
EventSchema.index({ gxnEventCode: 1 }, { sparse: true }); // Index for GXN event code lookups
EventSchema.index({ taoEventId: 1 }, { sparse: true }); // Index for Tao Group event lookups
EventSchema.index({ livEventCode: 1 }, { sparse: true }); // Index for LIV scrap import lookups
EventSchema.index({ omniaEventCode: 1 }, { sparse: true }); // Index for OMNIA scrap import lookups
EventSchema.index({ hakkasanEventCode: 1 }, { sparse: true }); // Index for Hakkasan scrap import lookups
EventSchema.index({ taoBeachEventCode: 1 }, { sparse: true }); // Index for TAO Beach scrap import lookups
EventSchema.index({ palmTreeBeachEventCode: 1 }, { sparse: true }); // Index for Palm Tree Beach scrap import lookups
EventSchema.index({ marqueeDayclubEventCode: 1 }, { sparse: true }); // Index for Marquee Dayclub scrap import lookups
EventSchema.index({ marqueeNightclubEventId: 1 }, { sparse: true }); // Index for Marquee Nightclub scrap import lookups

// Pre-save middleware to update availability
EventSchema.pre('save', function(next) {
  try {
    // Update total_available based on seat/unit status
    let availableSeats = 0;
    let availableUnits = 0;
    
    this.seats.forEach(seat => {
      if (seat.status === 'available') availableSeats += seat.capacity || 0;
    });
    
    this.units.forEach(unit => {
      if (unit.status === 'available') availableUnits += unit.occupancy || 0;
    });
    
    this.total_available = availableSeats + availableUnits;
    
    // Update status based on availability
    if (this.total_available === 0 && this.status === 'active') {
      this.status = 'sold_out';
    }
    
    next();
  } catch (error) {
    console.error('Error in Event pre-save middleware:', error);
    next(error);
  }
});

module.exports = mongoose.model('Event', EventSchema);

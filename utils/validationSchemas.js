const Joi = require('joi');
// Location validation
const assetSchema = Joi.object({
  type: Joi.string().valid('image','video').required(),
  url: Joi.string().uri().required(),
  caption: Joi.string().allow(''),
  order: Joi.number().min(0)
});

const sentimentSchema = Joi.object({
  text: Joi.string().allow(''),
  type: Joi.string().valid('A', 'B').required(),
  updatedBy: Joi.string().hex().length(24),
  updatedAt: Joi.date()
});

const seatSchema = Joi.object({
  code: Joi.string().required(),
  label: Joi.string().allow(''),
  category: Joi.string().valid(
    'backwall','large_3rd_tier_couch','third_tier_couch',
    'upper_dance','lower_dance','four_tops','stage_tables','owner_tables'
  ),
  section: Joi.string().allow(''),
  capacity: Joi.number().min(0),
  minSpendUSD: Joi.number().min(0),
  priceTier: Joi.number().min(1).max(5),
  mapAnchor: Joi.object({ x: Joi.number(), y: Joi.number() }),
  polygon: Joi.array().items(Joi.object({ x: Joi.number(), y: Joi.number() })),
  media: Joi.array().items(assetSchema),
  sentiment: Joi.array().items(sentimentSchema)
});

const unitSchema = Joi.object({
  code: Joi.string().required(),
  kind: Joi.string().valid('standard','deluxe','suite','penthouse').required(),
  beds: Joi.number().min(0),
  occupancy: Joi.number().min(1),
  view: Joi.string().allow(''),
  smoking: Joi.boolean(),
  floor: Joi.number().min(0),
  minPriceUSD: Joi.number().min(0),
  media: Joi.array().items(assetSchema),
  sentiment: Joi.array().items(sentimentSchema)
});

const createLocationSchema = Joi.object({
  type: Joi.string().valid('night_club','day_club','restaurant','hotel').required(),
  name: Joi.string().min(2).required(),
  description: Joi.string().allow('').optional(),
  address: Joi.object({
    line1: Joi.string().allow('').optional(),
    line2: Joi.string().allow('').optional(),
    city: Joi.string().allow('').optional(),
    state: Joi.string().allow('').optional(),
    country: Joi.string().allow('').optional(),
    postalCode: Joi.string().allow('').optional()
  }).optional(),
  geo: Joi.object({
    type: Joi.string().valid('Point').optional(),
    coordinates: Joi.array().items(Joi.number()).length(2).optional()
  }).optional(),
  media: Joi.array().items(assetSchema).optional(),
  score: Joi.number().min(0).max(5).optional(),
  tags: Joi.array().items(Joi.string()).optional(),
  status: Joi.string().valid('draft','active','archived').optional(),
  contact: Joi.object({
    name: Joi.string().allow('').optional(),
    phone: Joi.string().allow('').optional(),
    email: Joi.string().email().allow('').optional(),
    website: Joi.string().uri().allow('').optional()
  }).optional(),
  attributes: Joi.object({
    bottleService: Joi.boolean().optional(),
    dressCode: Joi.string().allow('').optional(),
    agePolicy: Joi.string().allow('').optional(),
    musicGenres: Joi.array().items(Joi.string()).optional(),
    tableMapUrl: Joi.string().uri().allow('').optional(),
    capacity: Joi.number().min(0).optional(),
    cuisine: Joi.array().items(Joi.string()).optional(),
    priceLevel: Joi.number().min(1).max(5).optional(),
    michelinStars: Joi.number().min(0).max(3).optional(),
    privateDiningRooms: Joi.number().min(0).optional(),
    stars: Joi.number().min(1).max(5).optional(),
    brand: Joi.string().allow('').optional(),
    checkInTime: Joi.string().allow('').optional(),
    checkOutTime: Joi.string().allow('').optional(),
    amenities: Joi.object({
      spa: Joi.boolean().optional(), 
      gym: Joi.boolean().optional(), 
      pool: Joi.boolean().optional(), 
      parking: Joi.boolean().optional(), 
      wifi: Joi.boolean().optional(),
      concierge: Joi.boolean().optional(), 
      businessCenter: Joi.boolean().optional(), 
      roomService: Joi.boolean().optional()
    }).optional(),
    conferenceRooms: Joi.number().min(0).optional()
  }).optional(),
  seats: Joi.array().items(seatSchema).optional(),
  units: Joi.array().items(unitSchema).optional(),
  sentiment: Joi.array().items(sentimentSchema).optional()
});

const updateLocationSchema = createLocationSchema.fork(
  ['type','name'],
  (schema) => schema.optional()
);

/**
 * Sentiment validation schemas
 */
const addSentimentSchema = Joi.object({
  text: Joi.string().allow(''),
  type: Joi.string().valid('A', 'B').required()
});

const updateSentimentSchema = Joi.object({
  text: Joi.string().allow(''),
  type: Joi.string().valid('A', 'B')
});

/**
 * Event validation schemas
 * @description Joi validation schemas for event endpoints
 */

// Event seat validation schema
const eventSeatSchema = Joi.object({
  seat_id: Joi.string().hex().length(24).required(),
  code: Joi.string().required(),
  label: Joi.string().allow(''),
  category: Joi.string().allow(''),
  section: Joi.string().allow(''),
  capacity: Joi.number().min(0),
  min_spend: Joi.number().min(0),
  price_tier: Joi.number().min(1).max(5),
  event_price: Joi.number().min(0),
  event_min_spend: Joi.number().min(0),
  status: Joi.string().valid('available', 'held', 'booked', 'blocked'),
  booked_by: Joi.string().hex().length(24),
  booked_at: Joi.date(),
  booking_reference: Joi.string().allow(''),
  map_anchor: Joi.object({ x: Joi.number(), y: Joi.number() }),
  polygon: Joi.array().items(Joi.object({ x: Joi.number(), y: Joi.number() })),
  media: Joi.array().items(assetSchema)
});

// Event unit validation schema
const eventUnitSchema = Joi.object({
  unit_id: Joi.string().hex().length(24).required(),
  code: Joi.string().required(),
  kind: Joi.string().valid('standard', 'deluxe', 'suite', 'penthouse').required(),
  beds: Joi.number().min(0),
  occupancy: Joi.number().min(1),
  view: Joi.string().allow(''),
  smoking: Joi.boolean(),
  floor: Joi.number().min(0),
  min_price: Joi.number().min(0),
  event_price: Joi.number().min(0),
  status: Joi.string().valid('available', 'held', 'booked', 'blocked'),
  booked_by: Joi.string().hex().length(24),
  booked_at: Joi.date(),
  booking_reference: Joi.string().allow(''),
  media: Joi.array().items(assetSchema)
});

// Create event validation schema
const createEventSchema = Joi.object({
  name: Joi.string().min(2).required(),
  description: Joi.string().allow('').optional(),
  type: Joi.string().valid('night_club', 'day_club', 'restaurant', 'hotel', 'private', 'corporate').required(),
  location_id: Joi.string().hex().length(24).required(),
  start_datetime: Joi.date().required(),
  end_datetime: Joi.date().required(),
  timezone: Joi.string().default('UTC'),
  base_price: Joi.number().min(0).required(),
  currency: Joi.string().default('USD'),
  price_tier: Joi.number().min(1).max(5).default(1),
  status: Joi.string().valid('draft', 'active', 'sold_out', 'cancelled', 'completed', 'archived').default('draft'),
  tags: Joi.array().items(Joi.string()).optional(),
  notes: Joi.string().allow('').optional(),
  policies: Joi.string().allow('').optional(),
  media: Joi.array().items(assetSchema).optional(),
  seats: Joi.array().items(eventSeatSchema).optional(),
  units: Joi.array().items(eventUnitSchema).optional(),
  requires_approval: Joi.boolean().default(false),
  auto_approve: Joi.boolean().default(true),
  max_group_size: Joi.number().min(1).optional(),
  cancellation_policy: Joi.object({
    hours_before_event: Joi.number().min(0),
    refund_percentage: Joi.number().min(0).max(100).default(100),
    admin_fee: Joi.number().min(0).default(0)
  }).optional()
});

// Update event validation schema
const updateEventSchema = createEventSchema.fork(
  ['name', 'type', 'location_id', 'start_datetime', 'end_datetime', 'base_price'],
  (schema) => schema.optional()
);

// Book seat validation schema
const bookSeatSchema = Joi.object({
  user_id: Joi.string().hex().length(24).required(),
  booking_reference: Joi.string().allow('').optional()
});

// Update availability validation schema
const updateAvailabilitySchema = Joi.object({
  total_available: Joi.number().min(0).required(),
  total_booked: Joi.number().min(0).required(),
  total_revenue: Joi.number().min(0).required()
});

/**
 * COE validation schemas
 * @description Joi validation schemas for COE endpoints
 */

// COE Item validation schema
const coeItemSchema = Joi.object({
  event_id: Joi.string().hex().length(24).required(),
  event_date: Joi.date().required(),
  event_time: Joi.string().required(),
  base_price: Joi.number().min(0).required(),
  quantity: Joi.number().min(1).default(1),
  total_price: Joi.number().min(0).required(),
  runner_assignment: Joi.object({
    runner_id: Joi.string().hex().length(24),
    assigned_by: Joi.string().hex().length(24),
    assigned_at: Joi.date(),
    status: Joi.string().valid('assigned', 'confirmed', 'active', 'completed', 'cancelled').default('assigned'),
    notes: Joi.string().allow('')
  }).optional(),
  status: Joi.string().valid('pending', 'confirmed', 'completed', 'cancelled').default('pending'),
  notes: Joi.string().allow(''),
  client_notes: Joi.string().allow(''),
  sequence: Joi.number().min(1).required()
});

// COE available seat validation schema
const coeAvailableSeatSchema = Joi.object({
  event_id: Joi.string().hex().length(24).required(),
  seat_id: Joi.string().hex().length(24).required(),
  seat_code: Joi.string().required(),
  capacity: Joi.number().min(1).required(),
  base_price: Joi.number().min(0).required(),
  event_price: Joi.number().min(0).required(),
  available_from: Joi.date().required(),
  available_until: Joi.date().required()
});

// Create COE validation schema
const createCOESchema = Joi.object({
  name: Joi.string().min(2).max(200).required(),
  description: Joi.string().max(1000).required(),
  status: Joi.string().valid('draft', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'completed', 'cancelled').default('draft'),
  created_method: Joi.string().valid('manual', 'automated').default('manual'),
  creation_notes: Joi.string().max(500).allow(''),
  client_id: Joi.string().hex().length(24).required(),
  admin_id: Joi.string().hex().length(24).required(),
  participants: Joi.array().items(Joi.object({
    user_id: Joi.string().hex().length(24).required(),
    role: Joi.string().valid('owner', 'participant').default('participant'),
    status: Joi.string().valid('pending', 'accepted', 'rejected').default('pending'),
    added_by: Joi.string().hex().length(24)
  })).optional(),
  runner_assignment: Joi.object({
    type: Joi.string().valid('coe', 'event').default('coe'),
    runner_id: Joi.string().hex().length(24),
    assigned_by: Joi.string().hex().length(24),
    assigned_at: Joi.date(),
    status: Joi.string().valid('assigned', 'confirmed', 'active', 'completed', 'cancelled').default('assigned'),
    notes: Joi.string().allow('')
  }).optional(),
  currency: Joi.string().valid('USD', 'EUR', 'GBP').default('USD'),
  subtotal: Joi.number().min(0).default(0),
  taxes: Joi.number().min(0).default(0),
  fees: Joi.number().min(0).default(0),
  total: Joi.number().min(0).default(0),
  deposit_required: Joi.number().min(0).default(0),
  deposit_paid: Joi.number().min(0).default(0),
  start_date: Joi.date().required(),
  end_date: Joi.date().required(),
  events: Joi.array().items(coeItemSchema).optional(),
  available_seats: Joi.array().items(coeAvailableSeatSchema).optional(),
  policies: Joi.string().max(2000).allow(''),
  notes: Joi.string().max(1000).allow(''),
  client_notes: Joi.string().max(1000).allow(''),
  sharable: Joi.boolean().default(false),
  tags: Joi.array().items(Joi.string()).optional()
});

// Update COE validation schema
const updateCOESchema = createCOESchema.fork(
  ['name', 'description', 'client_id', 'admin_id', 'start_date', 'end_date'],
  (schema) => schema.optional()
);

// Add event to COE validation schema
const addEventToCOESchema = Joi.object({
  event_id: Joi.string().hex().length(24).required(),
  event_date: Joi.date().required(),
  event_time: Joi.string().required(),
  base_price: Joi.number().min(0).required(),
  quantity: Joi.number().min(1).default(1),
  notes: Joi.string().allow(''),
  client_notes: Joi.string().allow('')
});

// Update COE status validation schema
const updateCOEStatusSchema = Joi.object({
  status: Joi.string().valid('draft', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'completed', 'cancelled').required()
});

// Assign runner to COE validation schema
const assignRunnerToCOESchema = Joi.object({
  runner_id: Joi.string().hex().length(24).required(),
  type: Joi.string().valid('coe', 'event').default('coe'),
  notes: Joi.string().allow('')
});

// Update seat assignments validation schema
const updateSeatAssignmentsSchema = Joi.object({
  available_seats: Joi.array().items(coeAvailableSeatSchema).required()
});

/**
 * Authentication validation schemas
 * @description Joi validation schemas for authentication endpoints
 */

/**
 * User signup validation schema
 */
const signupSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  firstName: Joi.string().min(2).required(),
  lastName: Joi.string().min(2).required(),
  phone: Joi.string().min(10).required(),
  dateOfBirth: Joi.date().max('now').required().messages({
    'date.max': 'Date of birth must be in the past',
    'any.required': 'Date of birth is required'
  }),
  industry: Joi.string().valid('fintech', 'cyber', 'social', 'sales', 'e-commerce', 'AI', 'energy', 'crypto', 'banking', 'real-estate', 'tech').required(),
  role: Joi.string().valid('admin', 'client', 'runner').default('client'),
  entity_status: Joi.string().valid('live', 'suspended', 'deleted', 'pendingApproval').default('pendingApproval'),
  visibilityStatus: Joi.string().valid('public', 'private').default('public'),
  userTier: Joi.string().valid('member', 'vip', 'elite').default('member')
});

/**
 * User signin validation schema
 */
const signinSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

/**
 * Password renewal validation schema
 */
const renewPasswordSchema = Joi.object({
  email: Joi.string().email().required()
});

/**
 * Password reset validation schema
 */
const resetPasswordSchema = Joi.object({
  token: Joi.string().required(),
  newPassword: Joi.string().min(6).required()
});

/**
 * User profile update validation schema
 */
const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2),
  lastName: Joi.string().min(2),
  email: Joi.string().email(),
  phone: Joi.string().min(10),
  socialMedia: Joi.object({
    facebook: Joi.string().uri().allow(''),
    linkedin: Joi.string().uri().allow(''),
    x: Joi.string().uri().allow(''),
    instagram: Joi.string().uri().allow('')
  }).optional()
});

/**
 * Entity status update validation schema
 */
const updateEntityStatusSchema = Joi.object({
  entity_status: Joi.string().valid('live', 'suspended', 'deleted', 'pendingApproval').required()
});

const updateRoleSchema = Joi.object({
  role: Joi.string().valid('admin', 'client', 'runner').required()
});

/**
 * Visibility status update validation schema
 */
const updateVisibilityStatusSchema = Joi.object({
  visibilityStatus: Joi.string().valid('public', 'private').required()
});

/**
 * User tier update validation schema
 */
const updateUserTierSchema = Joi.object({
  userTier: Joi.string().valid('member', 'vip', 'elite').required()
});

module.exports = {
  signupSchema,
  signinSchema,
  renewPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  updateEntityStatusSchema,
  updateRoleSchema,
  updateVisibilityStatusSchema,
  updateUserTierSchema,
  createLocationSchema,
  updateLocationSchema,
  addSentimentSchema,
  updateSentimentSchema,
  createEventSchema,
  updateEventSchema,
  eventSeatSchema,
  eventUnitSchema,
  bookSeatSchema,
  updateAvailabilitySchema,
  createCOESchema,
  updateCOESchema,
  coeItemSchema,
  coeAvailableSeatSchema,
  addEventToCOESchema,
  updateCOEStatusSchema,
  assignRunnerToCOESchema,
  updateSeatAssignmentsSchema
};
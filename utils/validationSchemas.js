const Joi = require('joi');
const { LOCATION_SEAT_CATEGORY_VALUES } = require('../constants/locationSeatCategories');
// Location validation
const assetSchema = Joi.object({
  type: Joi.string().valid('image', 'video').required(),
  url: Joi.string().uri().required(),
  caption: Joi.string().allow(''),
  order: Joi.number().min(0),
  width: Joi.number().min(0).optional(),
  height: Joi.number().min(0).optional(),
  byte_size: Joi.number().min(0).optional(),
  thumb_url: Joi.string().uri().allow('', null).optional(),
  list_thumb_url: Joi.string().uri().allow('', null).optional()
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
  category: Joi.string().valid(...LOCATION_SEAT_CATEGORY_VALUES),
  the1Category: Joi.string().allow(''),
  section: Joi.string().allow(''),
  capacity: Joi.number().min(0),
  minSpendUSD: Joi.number().min(0),
  priceTier: Joi.number().min(1).max(5),
  qualityScore: Joi.number().min(1).max(10),
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
  gratuityPercent: Joi.number().min(0).max(100).optional(),
  adminFeePercent: Joi.number().min(0).max(100).optional(),
  salesTaxPercent: Joi.number().min(0).max(100).optional(),
  gxnVenueCode: Joi.string().allow('').optional(),
  timezone: Joi.string().allow('').optional(),
  tagline: Joi.string().allow('').optional(),
  directions: Joi.string().allow('').optional(),
  menu: Joi.string().uri().allow('').optional(),
  socials: Joi.array().items(Joi.object({
    linktype: Joi.string().allow('').optional(),
    url: Joi.string().uri().allow('').optional(),
    linktypecode: Joi.string().allow('').optional()
  })).optional(),
  operatingHours: Joi.object({
    weekstring: Joi.string().allow('').optional(),
    weekdays: Joi.array().items(Joi.object({
      weekday: Joi.number().min(1).max(7).optional(),
      openTime: Joi.string().allow('').optional(),
      closeTime: Joi.string().allow('').optional(),
      timestring: Joi.string().allow('').optional()
    })).optional()
  }).optional(),
  seasons: Joi.any().optional(), // Mixed type, stored as-is
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
  end_datetime: Joi.date().optional(),
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
  }).optional(),
  gxnEventCode: Joi.string().allow('').optional(),
  gxnEventId: Joi.string().allow('').optional(),
  gxnEventDate: Joi.string().allow('').optional(),
  performers: Joi.array().items(Joi.object({
    perfcode: Joi.string().allow('').optional(),
    importance: Joi.string().allow('').optional(),
    apprtime: Joi.string().allow('').optional(),
    name: Joi.string().allow('').optional(),
    description: Joi.string().allow('').optional(),
    links: Joi.array()
      .items(
        Joi.object({
          url: Joi.string().allow('').optional(),
          label: Joi.string().allow('').optional(),
        })
      )
      .optional(),
  })).optional(),
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
    // Accept optional type at event level; ignored by model if not stored
    type: Joi.string().valid('event'),
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

// COE selected seat validation schema
const coeSelectedSeatSchema = Joi.object({
  event_id: Joi.string().hex().length(24).required(),
  seat_id: Joi.string().hex().length(24).required(),
  seat_code: Joi.string().required(),
  category: Joi.string().allow('').optional(),
  capacity: Joi.number().min(1).required(),
  base_price: Joi.number().min(0).required(),
  event_price: Joi.number().min(0).required(),
  available_from: Joi.date().required(),
  available_until: Joi.date().required(),
  status: Joi.string().valid('selected', 'held', 'booked', 'released', 'expired', 'rejected').default('selected'),
  is_merged_booking: Joi.boolean().default(false),
  primary_coe_id: Joi.string().hex().length(24).optional(),
  is_joint_allocation: Joi.boolean().optional(),
  joint_event_group_id: Joi.string().allow('', null).optional(),
  joint_share_percent: Joi.number().min(0).max(100).allow(null).optional(),
  is_simple_joint: Joi.boolean().optional(),
  simple_joint_original_price: Joi.number().min(0).allow(null).optional(),
  /** Venue list/catalog snapshot for strikethrough UI; optional. */
  venue_catalog_price: Joi.number().min(0).allow(null).optional(),
  /** THE1 fee % on negotiated base; optional — server math treats missing as 0. */
  the1_fee_percent: Joi.number().min(0).max(100).allow(null).optional()
});

// Create COE validation schema
const createCOESchema = Joi.object({
  name: Joi.string().min(2).max(200).required(),
  description: Joi.string().max(1000).required(),
  status: Joi.string().valid('draft', 'request', 'approved', 'pending_pay', 'paid', 'rejected', 'expired', 'completed', 'cancelled').default('draft'),
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
  covered_by_t1: Joi.object({
    amount: Joi.number().min(0).default(0),
    date: Joi.date().default(Date.now),
    updated_by: Joi.string().hex().length(24)
  }).optional(),
  pricing_breakdown: Joi.object({
    events: Joi.array().items(Joi.object({
      event_id: Joi.string().hex().length(24).required(),
      event_name: Joi.string().required(),
      event_date: Joi.date().required(),
      tables: Joi.array().items(Joi.object({
        table_id: Joi.string().hex().length(24).required(),
        table_code: Joi.string().required(),
        base_price: Joi.number().min(0).required(),
        event_price: Joi.number().min(0).required(),
        price_difference: Joi.number().default(0)
      })).optional(),
      event_subtotal: Joi.number().min(0).required()
    })).optional(),
    subtotal: Joi.number().min(0).default(0),
    taxes: Joi.number().min(0).default(0),
    fees: Joi.number().min(0).default(0),
    total: Joi.number().min(0).default(0)
  }).optional(),
  start_date: Joi.date().required(),
  end_date: Joi.date().required(),
  events: Joi.array().items(coeItemSchema).optional(),
  selected_seats: Joi.array().items(coeSelectedSeatSchema).optional(),
  policies: Joi.string().max(2000).allow(''),
  notes: Joi.string().max(1000).allow(''),
  client_notes: Joi.string().max(1000).allow(''),
  sharable: Joi.boolean().default(false),
  tags: Joi.array().items(Joi.string()).optional()
});

// Partial update for COE.original_request_data (admin PUT); merged server-side so other request fields are preserved.
const updateCOEOriginalRequestPartialSchema = Joi.object({
  party_size: Joi.number().integer().min(1),
  budget: Joi.object({
    max: Joi.number().min(0).required(),
    currency: Joi.string().valid('USD', 'EUR', 'GBP').default('USD')
  })
})
  .min(1)
  .messages({
    'object.min': 'original_request_data must include at least one of party_size or budget'
  });

/**
 * PUT /coes/:id — partial update only.
 * MUST NOT reuse createCOESchema with .default() on pricing: Joi would inject subtotal/total/deposit 0 etc.
 * on bodies like `{ original_request_data: {...} }`, wiping the COE and breaking persisted edits.
 */
const updateCOESchema = Joi.object({
  name: Joi.string().min(2).max(200),
  description: Joi.string().max(1000).allow(''),
  status: Joi.string().valid(
    'draft',
    'request',
    'approved',
    'pending_pay',
    'paid',
    'rejected',
    'expired',
    'completed',
    'cancelled'
  ),
  created_method: Joi.string().valid('manual', 'automated'),
  creation_notes: Joi.string().max(500).allow(''),
  client_id: Joi.string().hex().length(24),
  admin_id: Joi.string().hex().length(24),
  participants: Joi.array().items(
    Joi.object({
      user_id: Joi.string().hex().length(24).required(),
      role: Joi.string().valid('owner', 'participant').default('participant'),
      status: Joi.string().valid('pending', 'accepted', 'rejected').default('pending'),
      added_by: Joi.string().hex().length(24)
    })
  ),
  runner_assignment: Joi.object({
    type: Joi.string().valid('coe', 'event').default('coe'),
    runner_id: Joi.string().hex().length(24),
    assigned_by: Joi.string().hex().length(24),
    assigned_at: Joi.date(),
    status: Joi.string()
      .valid('assigned', 'confirmed', 'active', 'completed', 'cancelled')
      .default('assigned'),
    notes: Joi.string().allow('')
  }),
  currency: Joi.string().valid('USD', 'EUR', 'GBP'),
  subtotal: Joi.number().min(0),
  taxes: Joi.number().min(0),
  fees: Joi.number().min(0),
  total: Joi.number().min(0),
  deposit_required: Joi.number().min(0),
  deposit_paid: Joi.number().min(0),
  covered_by_t1: Joi.object({
    amount: Joi.number().min(0),
    date: Joi.date(),
    updated_by: Joi.string().hex().length(24)
  }),
  pricing_breakdown: Joi.object({
    events: Joi.array().items(
      Joi.object({
        event_id: Joi.string().hex().length(24).required(),
        event_name: Joi.string().required(),
        event_date: Joi.date().required(),
        tables: Joi.array()
          .items(
            Joi.object({
              table_id: Joi.string().hex().length(24).required(),
              table_code: Joi.string().required(),
              base_price: Joi.number().min(0).required(),
              event_price: Joi.number().min(0).required(),
              price_difference: Joi.number().default(0)
            })
          )
          .optional(),
        event_subtotal: Joi.number().min(0).required()
      })
    ).optional(),
    subtotal: Joi.number().min(0),
    taxes: Joi.number().min(0),
    fees: Joi.number().min(0),
    total: Joi.number().min(0)
  }),
  start_date: Joi.date(),
  end_date: Joi.date(),
  events: Joi.array().items(coeItemSchema),
  selected_seats: Joi.array().items(coeSelectedSeatSchema),
  policies: Joi.string().max(2000).allow(''),
  notes: Joi.string().max(1000).allow(''),
  client_notes: Joi.string().max(1000).allow(''),
  sharable: Joi.boolean(),
  tags: Joi.array().items(Joi.string()),
  original_request_data: updateCOEOriginalRequestPartialSchema.optional()
})
  .min(1)
  .messages({
    'object.min': 'At least one field is required to update a COE'
  });

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

// Add event with seat to COE validation schema (admin add-event flow)
const addEventToCOEWithSeatSchema = Joi.object({
  event_id: Joi.string().hex().length(24).required(),
  seat_id: Joi.string().required(),
  seat_code: Joi.string().allow(''),
  capacity: Joi.number().min(1).default(1),
  base_price: Joi.number().min(0),
  event_price: Joi.number().min(0).required(),
  event_date: Joi.date(),
  event_time: Joi.string().allow(''),
  quantity: Joi.number().min(1).default(1),
  budget_override: Joi.boolean().default(false),
  party_size_override: Joi.boolean().default(false),
  notes: Joi.string().allow(''),
  client_notes: Joi.string().allow(''),
  /** When true, event_price is admin override; server stores catalog price in simple_joint_original_price. */
  is_simple_joint: Joi.boolean().default(false),
  /** THE1 negotiated line: venue catalog snapshot for strikethrough UI (optional). */
  venue_catalog_price: Joi.number().min(0).allow(null).optional(),
  /** THE1 fee % on negotiated base (optional; server defaults missing to 0 in totals if absent). */
  the1_fee_percent: Joi.number().min(0).max(100).allow(null).optional()
});

// Update COE status validation schema
const updateCOEStatusSchema = Joi.object({
  // Accept 'proposal' as an alias for 'approved' (normalized server-side)
  status: Joi.string()
    .valid(
      'draft',
      'request',
      'approved',
      'accepted_not_paid',
      'proposal',
      'pending_pay',
      'paid',
      'rejected',
      'expired',
      'completed',
      'cancelled'
    )
    .required(),
  // Optional deposit percentage (1–100) when proposing an experience
  deposit_percent: Joi.number().min(1).max(100),
  // Optional payment time limit in hours; 0 or undefined means no limit
  payment_deadline_hours: Joi.number().min(0).max(720)
});

// Assign runner to COE validation schema
const assignRunnerToCOESchema = Joi.object({
  runner_id: Joi.string().hex().length(24).required(),
  type: Joi.string().valid('coe', 'event').default('coe'),
  notes: Joi.string().allow('')
});

// Update seat assignments validation schema
const updateSeatAssignmentsSchema = Joi.object({
  selected_seats: Joi.array().items(coeSelectedSeatSchema).required()
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
  industry: Joi.string().valid('fintech', 'cyber', 'social', 'sales', 'e-commerce', 'AI', 'energy', 'crypto', 'banking', 'real-estate', 'tech', 'other').required(),
  industryCustom: Joi.string().allow('', null),
  role: Joi.string().valid('admin', 'client', 'runner').default('client'),
  entity_status: Joi.string().valid('live', 'suspended', 'deleted', 'pendingApproval', 'registrationDeclined').default('pendingApproval'),
  visibilityStatus: Joi.string().valid('public', 'private').default('public'),
  userTier: Joi.string()
    .valid('member', 'vip', 'elite', 'silver', 'gold', 'platinum')
    .default('silver')
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
  code: Joi.string()
    .length(6)
    .pattern(/^[0-9]+$/)
    .required()
    .messages({
      'string.length': 'Reset code must be 6 digits',
      'string.pattern.base': 'Reset code must contain only numbers',
      'any.required': 'Reset code is required'
    }),
  password: Joi.string().min(6).required()
});

/**
 * User profile update validation schema
 */
const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2),
  lastName: Joi.string().min(2),
  email: Joi.string().email(),
  phone: Joi.string().min(10),
  dateOfBirth: Joi.date().max('now'),
  industry: Joi.string().valid('fintech', 'cyber', 'social', 'sales', 'e-commerce', 'AI', 'energy', 'crypto', 'banking', 'real-estate', 'tech', 'other'),
  industryCustom: Joi.string().allow('', null),
  socialMedia: Joi.object({
    facebook: Joi.string().uri().allow(''),
    linkedin: Joi.string().uri().allow(''),
    x: Joi.string().uri().allow(''),
    instagram: Joi.string().uri().allow('')
  }).optional(),
  avatarUrl: Joi.string().uri().allow('', null),
  avatar_width: Joi.number().min(0),
  avatar_height: Joi.number().min(0),
  avatar_byte_size: Joi.number().min(0),
  avatar_thumb_url: Joi.string().uri().allow('', null)
});

/**
 * Entity status update validation schema
 */
const updateEntityStatusSchema = Joi.object({
  entity_status: Joi.string().valid('live', 'suspended', 'deleted', 'pendingApproval', 'registrationDeclined').required(),
  first_coe_deduction_enabled: Joi.boolean().optional()
});

const industryEnum = [
  'fintech',
  'cyber',
  'social',
  'sales',
  'e-commerce',
  'AI',
  'energy',
  'crypto',
  'banking',
  'real-estate',
  'tech',
  'other',
];

/**
 * Admin-only: create a live client user (no pending approval flow).
 */
const adminCreateClientSchema = Joi.object({
  email: Joi.string().email().required(),
  firstName: Joi.string().min(2).trim().required(),
  lastName: Joi.string().min(2).trim().required(),
  phone: Joi.string().trim().min(10).optional().allow('', null),
  dateOfBirth: Joi.date().max('now').optional().allow(null),
  industry: Joi.string().valid(...industryEnum).optional(),
  industryCustom: Joi.string().allow('', null).optional(),
  first_coe_deduction_enabled: Joi.boolean().default(false),
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
  userTier: Joi.string()
    .valid('member', 'vip', 'elite', 'silver', 'gold', 'platinum')
    .required()
});

/**
 * Email Verification Schemas
 */

// Verify email schema
const verifyEmailSchema = Joi.object({
  code: Joi.string()
    .length(6)
    .pattern(/^[0-9]+$/)
    .required()
    .messages({
      'string.length': 'Verification code must be 6 digits',
      'string.pattern.base': 'Verification code must contain only numbers',
      'any.required': 'Verification code is required'
    })
});

// Resend verification email schema
const resendVerificationSchema = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      'string.email': 'Please provide a valid email address',
      'any.required': 'Email address is required'
    })
});

/** Request passwordless login OTP */
const loginOtpRequestSchema = Joi.object({
  email: Joi.string().email().required()
});

/** Verify passwordless login OTP */
const loginOtpVerifySchema = Joi.object({
  email: Joi.string().email().required(),
  code: Joi.string()
    .length(6)
    .pattern(/^[0-9]+$/)
    .required()
    .messages({
      'string.length': 'Sign-in code must be 6 digits',
      'string.pattern.base': 'Sign-in code must contain only numbers',
      'any.required': 'Sign-in code is required'
    })
});

module.exports = {
  signupSchema,
  signinSchema,
  renewPasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  updateEntityStatusSchema,
  adminCreateClientSchema,
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
  coeSelectedSeatSchema,
  addEventToCOESchema,
  addEventToCOEWithSeatSchema,
  updateCOEStatusSchema,
  assignRunnerToCOESchema,
  updateSeatAssignmentsSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  loginOtpRequestSchema,
  loginOtpVerifySchema
};
const mongoose = require('mongoose');

/**
 * COE Item schema for events within a COE
 */
const COEItemSchema = new mongoose.Schema({
  _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
  coe_id: { type: mongoose.Schema.Types.ObjectId, ref: 'COE' },
  
  // Event Reference
  event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  event_date: { type: Date, required: true },
  event_time: { type: String, required: true },
  
  // Pricing
  base_price: { type: Number, min: 0, required: true },
  quantity: { type: Number, min: 1, default: 1 },
  total_price: { type: Number, min: 0, required: true },
  
  // Runner Assignment (Event-Level)
  runner_assignment: {
    runner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_at: { type: Date },
    status: { 
      type: String, 
      enum: ['assigned', 'confirmed', 'active', 'completed', 'cancelled'],
      default: 'assigned'
    },
    notes: { type: String, trim: true }
  },
  
  // Status
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'pending'
  },
  
  // Notes
  notes: { type: String, trim: true },
  client_notes: { type: String, trim: true },
  
  // Ordering
  sequence: { type: Number, required: true }, // Order within COE
  
  // Timestamps
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { _id: true });

/**
 * COE Schema - Curated One Experience
 * Comprehensive event package combining multiple locations/events
 */
const coeSchema = new mongoose.Schema({
  // Core Information
  name: { 
    type: String, 
    required: true, 
    trim: true,
    maxlength: 200
  },
  description: { 
    type: String, 
    required: true, 
    trim: true,
    maxlength: 1000
  },
  status: { 
    type: String, 
    enum: ['draft', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'completed', 'cancelled'],
    default: 'draft',
    index: true
  },
  
  // Manual Creation Fields
  created_method: { 
    type: String, 
    enum: ['manual', 'automated'],
    default: 'manual',
    index: true
  },
  created_by: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  creation_notes: { 
    type: String, 
    trim: true,
    maxlength: 500
  },
  
  // Associations
  client_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  admin_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true
  },
  participants: [{ // Additional clients
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { 
      type: String, 
      enum: ['owner', 'participant'],
      default: 'participant'
    },
    status: { 
      type: String, 
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    added_at: { type: Date, default: Date.now },
    added_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  
  // Runner Assignment
  runner_assignment: {
    type: { 
      type: String, 
      enum: ['coe', 'event'],
      default: 'coe'
    },
    runner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assigned_at: { type: Date },
    status: { 
      type: String, 
      enum: ['assigned', 'confirmed', 'active', 'completed', 'cancelled'],
      default: 'assigned'
    },
    notes: { type: String, trim: true }
  },
  
  // Financial
  currency: { 
    type: String, 
    enum: ['USD', 'EUR', 'GBP'],
    default: 'USD'
  },
  subtotal: { type: Number, min: 0, default: 0 },
  taxes: { type: Number, min: 0, default: 0 },
  fees: { type: Number, min: 0, default: 0 },
  total: { type: Number, min: 0, default: 0 },
  deposit_required: { type: Number, min: 0, default: 0 },
  deposit_paid: { type: Number, min: 0, default: 0 },
  
  // Timeline
  request_date: { type: Date, default: Date.now },
  approved_date: { type: Date },
  sent_date: { type: Date },
  accepted_date: { type: Date },
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },
  
  // Content
  events: [COEItemSchema],
  available_seats: [{ // Pre-selected available seats
    event_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
    seat_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    seat_code: { type: String, required: true, trim: true },
    capacity: { type: Number, min: 1, required: true },
    base_price: { type: Number, min: 0, required: true },
    event_price: { type: Number, min: 0, required: true },
    available_from: { type: Date, required: true },
    available_until: { type: Date, required: true }
  }],
  policies: { 
    type: String, 
    trim: true,
    maxlength: 2000
  },
  notes: { 
    type: String, 
    trim: true,
    maxlength: 1000
  },
  client_notes: { 
    type: String, 
    trim: true,
    maxlength: 1000
  },
  
  // Metadata
  sharable: { type: Boolean, default: false },
  tags: [{ type: String, trim: true }],
  
  // Timestamps
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, {
  timestamps: true,
  collection: 'coes'
});

// Indexes for performance
coeSchema.index({ client_id: 1, status: 1 });
coeSchema.index({ admin_id: 1, status: 1 });
coeSchema.index({ 'runner_assignment.runner_id': 1, status: 1 });
coeSchema.index({ start_date: 1, end_date: 1 });
coeSchema.index({ created_method: 1, status: 1 });

// Virtual for total events count
coeSchema.virtual('events_count').get(function() {
  return this.events ? this.events.length : 0;
});

// Virtual for total participants count
coeSchema.virtual('participants_count').get(function() {
  return this.participants ? this.participants.length + 1 : 1; // +1 for main client
});

// Pre-save middleware to update timestamps
coeSchema.pre('save', function(next) {
  this.updated_at = new Date();
  
  // Update COE item timestamps
  if (this.events && this.events.length > 0) {
    this.events.forEach(event => {
      event.updated_at = new Date();
    });
  }
  
  next();
});

// Pre-save middleware to calculate totals
coeSchema.pre('save', function(next) {
  if (this.events && this.events.length > 0) {
    this.subtotal = this.events.reduce((total, event) => {
      return total + (event.total_price || 0);
    }, 0);
    
    this.total = this.subtotal + this.taxes + this.fees;
    
    // Set default deposit if not specified
    if (this.deposit_required === 0 && this.total > 0) {
      this.deposit_required = Math.round(this.total * 0.2); // 20% deposit
    }
  }
  
  next();
});

// Static method to find COEs by status
coeSchema.statics.findByStatus = function(status) {
  return this.find({ status: status }).sort({ created_at: -1 });
};

// Static method to find COEs by client
coeSchema.statics.findByClient = function(clientId) {
  return this.find({ client_id: clientId }).sort({ created_at: -1 });
};

// Instance method to add event to COE
coeSchema.methods.addEvent = function(eventData) {
  if (!this.events) {
    this.events = [];
  }
  
  const sequence = this.events.length + 1;
  const event = {
    ...eventData,
    coe_id: this._id,
    sequence: sequence,
    created_at: new Date(),
    updated_at: new Date()
  };
  
  this.events.push(event);
  return this.save();
};

// Instance method to remove event from COE
coeSchema.methods.removeEvent = function(eventId) {
  if (!this.events) {
    return Promise.resolve(this);
  }
  
  this.events = this.events.filter(event => event._id.toString() !== eventId.toString());
  
  // Reorder remaining events
  this.events.forEach((event, index) => {
    event.sequence = index + 1;
  });
  
  return this.save();
};

// Instance method to update COE status
coeSchema.methods.updateStatus = function(newStatus, updatedBy) {
  this.status = newStatus;
  this.updated_at = new Date();
  
  // Set specific date fields based on status
  switch (newStatus) {
    case 'approved':
      this.approved_date = new Date();
      break;
    case 'sent':
      this.sent_date = new Date();
      break;
    case 'accepted':
      this.accepted_date = new Date();
      break;
  }
  
  return this.save();
};

module.exports = mongoose.model('COE', coeSchema);

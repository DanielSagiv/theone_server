const Event = require('../models/Event');
const Location = require('../models/Location');

/**
 * Event Service
 * @description Business logic for event management
 */

/**
 * Create event with seat inheritance from location
 * @param {Object} eventData - Event data
 * @param {string} userId - User ID creating the event
 * @returns {Promise<Object>} Created event
 */
async function createEventWithSeats(eventData, userId) {
  try {
    console.log('Creating event with seats:', { eventData: eventData.name, locationId: eventData.location_id });

    // Get location and its seats/units
    const location = await Location.findById(eventData.location_id);
    if (!location) {
      throw new Error('Location not found');
    }

    console.log('Location found:', { name: location.name, seatsCount: location.seats.length, unitsCount: location.units.length });

    // Inherit seats from location
    const inheritedSeats = location.seats.map(seat => {
      const eventSeat = {
        seat_id: seat._id,
        code: seat.code,
        label: seat.label,
        category: seat.category,
        section: seat.section,
        capacity: seat.capacity,
        min_spend: seat.minSpendUSD,
        price_tier: seat.priceTier,
        event_price: eventData.base_price * 1.5, // Default 1.5x base price
        event_min_spend: seat.minSpendUSD * 1.2, // Default 1.2x min spend
        status: 'available',
        map_anchor: seat.mapAnchor,
        polygon: seat.polygon,
        media: []
      };
      
      console.log('Inherited seat:', { code: eventSeat.code, capacity: eventSeat.capacity, eventPrice: eventSeat.event_price });
      return eventSeat;
    });

    // Inherit units from location
    const inheritedUnits = location.units.map(unit => {
      const eventUnit = {
        unit_id: unit._id,
        code: unit.code,
        kind: unit.kind,
        beds: unit.beds,
        occupancy: unit.occupancy,
        view: unit.view,
        smoking: unit.smoking,
        floor: unit.floor,
        min_price: unit.minPriceUSD,
        event_price: eventData.base_price * 1.5,
        status: 'available',
        media: []
      };
      
      console.log('Inherited unit:', { code: eventUnit.code, kind: eventUnit.kind, occupancy: eventUnit.occupancy });
      return eventUnit;
    });

    // Calculate total capacity
    const totalCapacity = inheritedSeats.reduce((sum, seat) => sum + (seat.capacity || 0), 0) +
                         inheritedUnits.reduce((sum, unit) => sum + (unit.occupancy || 0), 0);

    console.log('Total capacity calculated:', totalCapacity);

    // Create event
    const event = new Event({
      ...eventData,
      seats: inheritedSeats,
      units: inheritedUnits,
      total_capacity: totalCapacity,
      total_available: totalCapacity,
      total_booked: 0,
      total_revenue: 0,
      created_by: userId,
      views: 0,
      inquiries: 0,
      conversion_rate: 0,
      coe_count: 0,
      is_featured: false,
      priority: 0
    });

    await event.save();
    console.log('Event created successfully:', event._id);

    return event;
  } catch (error) {
    console.error('Error in createEventWithSeats:', error);
    throw error;
  }
}

/**
 * Update event availability based on seat/unit status
 * @param {string} eventId - Event ID
 * @returns {Promise<Object>} Updated event
 */
async function updateEventAvailability(eventId) {
  try {
    console.log('Updating event availability:', eventId);

    const event = await Event.findById(eventId);
    if (!event) {
      throw new Error('Event not found');
    }

    let availableSeats = 0;
    let availableUnits = 0;
    let totalBooked = 0;
    let totalRevenue = 0;

    // Calculate availability from seats
    event.seats.forEach(seat => {
      if (seat.status === 'available') {
        availableSeats += seat.capacity || 0;
      } else if (seat.status === 'booked') {
        totalBooked += seat.capacity || 0;
        totalRevenue += seat.event_price || 0;
      }
    });

    // Calculate availability from units
    event.units.forEach(unit => {
      if (unit.status === 'available') {
        availableUnits += unit.occupancy || 0;
      } else if (unit.status === 'booked') {
        totalBooked += unit.occupancy || 0;
        totalRevenue += unit.event_price || 0;
      }
    });

    // Update event totals
    event.total_available = availableSeats + availableUnits;
    event.total_booked = totalBooked;
    event.total_revenue = totalRevenue;
    event.last_availability_check = new Date();

    // Update status based on availability
    if (event.total_available === 0 && event.status === 'active') {
      event.status = 'sold_out';
      console.log('Event marked as sold out:', eventId);
    }

    await event.save();
    console.log('Event availability updated:', { 
      eventId, 
      totalAvailable: event.total_available, 
      totalBooked: event.total_booked, 
      totalRevenue: event.total_revenue 
    });

    return event;
  } catch (error) {
    console.error('Error in updateEventAvailability:', error);
    throw error;
  }
}

/**
 * Book specific seat
 * @param {string} eventId - Event ID
 * @param {string} seatId - Seat ID
 * @param {string} userId - User ID booking the seat
 * @param {string} bookingReference - Booking reference (COE ID, etc.)
 * @returns {Promise<Object>} Booking result
 */
async function bookSeat(eventId, seatId, userId, bookingReference = null) {
  try {
    console.log('Booking seat:', { eventId, seatId, userId, bookingReference });

    const event = await Event.findById(eventId);
    if (!event) {
      throw new Error('Event not found');
    }

    // Find the seat
    const seat = event.seats.id(seatId);
    if (!seat) {
      throw new Error('Seat not found');
    }

    // Check if seat is available
    if (seat.status !== 'available') {
      throw new Error(`Seat is not available. Current status: ${seat.status}`);
    }

    // Book the seat
    seat.status = 'booked';
    seat.booked_by = userId;
    seat.booked_at = new Date();
    seat.booking_reference = bookingReference;

    // Update event totals
    event.total_booked += seat.capacity || 0;
    event.total_available -= seat.capacity || 0;
    event.total_revenue += seat.event_price || 0;

    await event.save();

    console.log('Seat booked successfully:', { 
      eventId, 
      seatId, 
      seatCode: seat.code, 
      capacity: seat.capacity, 
      price: seat.event_price 
    });

    return {
      success: true,
      event_id: event._id,
      seat_id: seat._id,
      seat_code: seat.code,
      status: seat.status,
      booked_by: seat.booked_by,
      booked_at: seat.booked_at,
      booking_reference: seat.booking_reference,
      capacity: seat.capacity,
      price: seat.event_price
    };
  } catch (error) {
    console.error('Error in bookSeat:', error);
    throw error;
  }
}

/**
 * Release seat booking
 * @param {string} eventId - Event ID
 * @param {string} seatId - Seat ID
 * @returns {Promise<Object>} Release result
 */
async function releaseSeat(eventId, seatId) {
  try {
    console.log('Releasing seat:', { eventId, seatId });

    const event = await Event.findById(eventId);
    if (!event) {
      throw new Error('Event not found');
    }

    // Find the seat
    const seat = event.seats.id(seatId);
    if (!seat) {
      throw new Error('Seat not found');
    }

    // Check if seat is booked
    if (seat.status !== 'booked') {
      throw new Error(`Seat is not booked. Current status: ${seat.status}`);
    }

    // Store booking details before release
    const bookingDetails = {
      booked_by: seat.booked_by,
      booked_at: seat.booked_at,
      booking_reference: seat.booking_reference,
      capacity: seat.capacity,
      price: seat.event_price
    };

    // Release the seat
    seat.status = 'available';
    seat.booked_by = null;
    seat.booked_at = null;
    seat.booking_reference = null;

    // Update event totals
    event.total_booked -= seat.capacity || 0;
    event.total_available += seat.capacity || 0;
    event.total_revenue -= seat.event_price || 0;

    await event.save();

    console.log('Seat released successfully:', { 
      eventId, 
      seatId, 
      seatCode: seat.code,
      previousBooking: bookingDetails.booking_reference 
    });

    return {
      success: true,
      event_id: event._id,
      seat_id: seat._id,
      seat_code: seat.code,
      status: seat.status,
      previous_booking: bookingDetails
    };
  } catch (error) {
    console.error('Error in releaseSeat:', error);
    throw error;
  }
}

/**
 * Validate event capacity
 * @param {string} eventId - Event ID
 * @param {number} requestedCapacity - Requested capacity
 * @returns {Promise<boolean>} Whether event can accommodate
 */
async function validateEventCapacity(eventId, requestedCapacity) {
  try {
    console.log('Validating event capacity:', { eventId, requestedCapacity });

    const event = await Event.findById(eventId);
    if (!event) {
      throw new Error('Event not found');
    }

    const availableCapacity = event.total_available;
    const canAccommodate = availableCapacity >= requestedCapacity;

    console.log('Capacity validation result:', { 
      eventId, 
      requestedCapacity, 
      availableCapacity, 
      canAccommodate 
    });

    return canAccommodate;
  } catch (error) {
    console.error('Error in validateEventCapacity:', error);
    throw error;
  }
}

/**
 * Get event revenue analytics
 * @param {string} eventId - Event ID
 * @returns {Promise<Object>} Revenue analytics
 */
async function getEventRevenue(eventId) {
  try {
    console.log('Getting event revenue:', eventId);

    const event = await Event.findById(eventId);
    if (!event) {
      throw new Error('Event not found');
    }

    const analytics = {
      event_id: event._id,
      event_name: event.name,
      total_capacity: event.total_capacity,
      total_available: event.total_available,
      total_booked: event.total_booked,
      total_revenue: event.total_revenue,
      occupancy_rate: event.total_capacity > 0 ? (event.total_booked / event.total_capacity) * 100 : 0,
      average_price_per_person: event.total_booked > 0 ? event.total_revenue / event.total_booked : 0,
      revenue_by_seat_type: {},
      revenue_by_unit_type: {}
    };

    // Calculate revenue by seat category
    event.seats.forEach(seat => {
      if (seat.status === 'booked') {
        const category = seat.category || 'unknown';
        if (!analytics.revenue_by_seat_type[category]) {
          analytics.revenue_by_seat_type[category] = {
            count: 0,
            revenue: 0,
            capacity: 0
          };
        }
        analytics.revenue_by_seat_type[category].count++;
        analytics.revenue_by_seat_type[category].revenue += seat.event_price || 0;
        analytics.revenue_by_seat_type[category].capacity += seat.capacity || 0;
      }
    });

    // Calculate revenue by unit kind
    event.units.forEach(unit => {
      if (unit.status === 'booked') {
        const kind = unit.kind || 'unknown';
        if (!analytics.revenue_by_unit_type[kind]) {
          analytics.revenue_by_unit_type[kind] = {
            count: 0,
            revenue: 0,
            capacity: 0
          };
        }
        analytics.revenue_by_unit_type[kind].count++;
        analytics.revenue_by_unit_type[kind].revenue += unit.event_price || 0;
        analytics.revenue_by_unit_type[kind].capacity += unit.occupancy || 0;
      }
    });

    console.log('Event revenue analytics calculated:', { 
      eventId, 
      totalRevenue: analytics.total_revenue, 
      occupancyRate: analytics.occupancy_rate 
    });

    return analytics;
  } catch (error) {
    console.error('Error in getEventRevenue:', error);
    throw error;
  }
}

/**
 * Get event analytics
 * @param {string} eventId - Event ID
 * @returns {Promise<Object>} Event analytics
 */
async function getEventAnalytics(eventId) {
  try {
    console.log('Getting event analytics:', eventId);

    const event = await Event.findById(eventId);
    if (!event) {
      throw new Error('Event not found');
    }

    const analytics = {
      event_id: event._id,
      event_name: event.name,
      status: event.status,
      views: event.views,
      inquiries: event.inquiries,
      conversion_rate: event.conversion_rate,
      total_capacity: event.total_capacity,
      total_available: event.total_available,
      total_booked: event.total_booked,
      total_revenue: event.total_revenue,
      occupancy_rate: event.total_capacity > 0 ? (event.total_booked / event.total_capacity) * 100 : 0,
      average_price_per_person: event.total_booked > 0 ? event.total_revenue / event.total_booked : 0,
      duration_hours: event.duration_hours,
      is_active: event.is_active,
      is_upcoming: event.is_upcoming,
      is_past: event.is_past,
      availability_percentage: event.availability_percentage,
      created_at: event.createdAt,
      updated_at: event.updatedAt,
      last_availability_check: event.last_availability_check
    };

    console.log('Event analytics calculated:', { 
      eventId, 
      views: analytics.views, 
      inquiries: analytics.inquiries, 
      conversionRate: analytics.conversion_rate 
    });

    return analytics;
  } catch (error) {
    console.error('Error in getEventAnalytics:', error);
    throw error;
  }
}

module.exports = {
  createEventWithSeats,
  updateEventAvailability,
  bookSeat,
  releaseSeat,
  validateEventCapacity,
  getEventRevenue,
  getEventAnalytics
};

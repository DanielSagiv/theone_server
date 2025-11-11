const Location = require('../models/Location');
const Event = require('../models/Event');

/**
 * Location-Event Integration Service
 * @description Business logic for location and event relationship management
 */

/**
 * Inherit seats from location to event
 * @param {string} locationId - Location ID
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Inherited seats and units
 */
async function inheritSeatsFromLocation(locationId, eventData) {
  try {
    console.log('Inheriting seats from location:', { locationId, eventName: eventData.name });

    // Get location with seats and units
    const location = await Location.findById(locationId);
    if (!location) {
      throw new Error('Location not found');
    }

    console.log('Location found:', { 
      name: location.name, 
      type: location.type,
      seatsCount: location.seats.length, 
      unitsCount: location.units.length 
    });

    // Inherit seats from location
    const inheritedSeats = location.seats.map(seat => {
      const eventSeat = {
        seat_id: seat._id,
        code: seat.code,
        label: seat.label,
        category: seat.category,
        section: seat.section,
        capacity: seat.capacity,
        min_spend: seat.minSpendUSD, // Location base price
        price_tier: seat.priceTier,
        event_price: seat.minSpendUSD, // Use location base price as initial event price
        event_min_spend: seat.minSpendUSD, // Use location base price as initial min spend
        status: 'available',
        map_anchor: seat.mapAnchor,
        polygon: seat.polygon,
        media: [],
        gxnItemCode: seat.gxnItemCode,
        gxnMasterItemCode: seat.gxnMasterItemCode
      };
      
      console.log('Inherited seat:', { 
        code: eventSeat.code, 
        category: eventSeat.category,
        capacity: eventSeat.capacity, 
        eventPrice: eventSeat.event_price 
      });
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
        min_price: unit.minPriceUSD, // Location base price
        event_price: unit.minPriceUSD, // Use location base price as initial event price
        status: 'available',
        media: []
      };
      
      console.log('Inherited unit:', { 
        code: eventUnit.code, 
        kind: eventUnit.kind, 
        occupancy: eventUnit.occupancy 
      });
      return eventUnit;
    });

    // Calculate total capacity
    const totalCapacity = inheritedSeats.reduce((sum, seat) => sum + (seat.capacity || 0), 0) +
                         inheritedUnits.reduce((sum, unit) => sum + (unit.occupancy || 0), 0);

    console.log('Inheritance complete:', { 
      locationId, 
      seatsInherited: inheritedSeats.length,
      unitsInherited: inheritedUnits.length,
      totalCapacity 
    });

    return {
      seats: inheritedSeats,
      units: inheritedUnits,
      totalCapacity,
      locationInfo: {
        id: location._id,
        name: location.name,
        type: location.type
      }
    };
  } catch (error) {
    console.error('Error in inheritSeatsFromLocation:', error);
    throw error;
  }
}

/**
 * Update location seat status based on event bookings
 * @param {string} locationId - Location ID
 * @param {string} seatId - Seat ID
 * @param {string} status - New status
 * @returns {Promise<Object>} Update result
 */
async function updateLocationSeatStatus(locationId, seatId, status) {
  try {
    console.log('Updating location seat status:', { locationId, seatId, status });

    const location = await Location.findById(locationId);
    if (!location) {
      throw new Error('Location not found');
    }

    // Find the seat in location
    const seat = location.seats.id(seatId);
    if (!seat) {
      throw new Error('Seat not found in location');
    }

    // Update seat status (this is for reference, actual booking status is in events)
    // Location seats maintain their base status, events have booking status
    console.log('Location seat status updated:', { 
      locationId, 
      seatId, 
      seatCode: seat.code,
      previousStatus: seat.status,
      newStatus: status 
    });

    return {
      success: true,
      location_id: locationId,
      seat_id: seatId,
      seat_code: seat.code,
      status: status
    };
  } catch (error) {
    console.error('Error in updateLocationSeatStatus:', error);
    throw error;
  }
}

/**
 * Validate if location can support event capacity
 * @param {string} locationId - Location ID
 * @param {number} requestedCapacity - Requested capacity
 * @param {Date} startDate - Event start date
 * @param {Date} endDate - Event end date
 * @returns {Promise<Object>} Validation result
 */
async function validateLocationCapacity(locationId, requestedCapacity, startDate, endDate) {
  try {
    console.log('Validating location capacity:', { 
      locationId, 
      requestedCapacity, 
      startDate, 
      endDate 
    });

    const location = await Location.findById(locationId);
    if (!location) {
      throw new Error('Location not found');
    }

    // Calculate location's total capacity
    const locationCapacity = location.seats.reduce((sum, seat) => sum + (seat.capacity || 0), 0) +
                            location.units.reduce((sum, unit) => sum + (unit.occupancy || 0), 0);

    // Check if location has enough capacity
    const hasEnoughCapacity = locationCapacity >= requestedCapacity;

    // Check for conflicting events (events that overlap in time)
    const conflictingEvents = await Event.find({
      location_id: locationId,
      status: { $in: ['active', 'sold_out'] },
      $or: [
        {
          start_datetime: { $lt: endDate },
          end_datetime: { $gt: startDate }
        }
      ]
    });

    const hasConflicts = conflictingEvents.length > 0;
    const conflictingEventIds = conflictingEvents.map(event => event._id);

    // Calculate available capacity during the time period
    let availableCapacity = locationCapacity;
    if (hasConflicts) {
      // Subtract capacity used by conflicting events
      conflictingEvents.forEach(event => {
        const bookedCapacity = event.seats
          .filter(seat => seat.status === 'booked')
          .reduce((sum, seat) => sum + (seat.capacity || 0), 0) +
          event.units
          .filter(unit => unit.status === 'booked')
          .reduce((sum, unit) => sum + (unit.occupancy || 0), 0);
        
        availableCapacity -= bookedCapacity;
      });
    }

    const canAccommodate = availableCapacity >= requestedCapacity;

    console.log('Location capacity validation result:', { 
      locationId, 
      locationCapacity,
      requestedCapacity,
      availableCapacity,
      hasConflicts,
      conflictingEventsCount: conflictingEvents.length,
      canAccommodate 
    });

    return {
      location_id: locationId,
      location_capacity: locationCapacity,
      requested_capacity: requestedCapacity,
      available_capacity: availableCapacity,
      has_enough_capacity: hasEnoughCapacity,
      has_conflicts: hasConflicts,
      conflicting_events: conflictingEventIds,
      can_accommodate: canAccommodate,
      validation_passed: canAccommodate && hasEnoughCapacity
    };
  } catch (error) {
    console.error('Error in validateLocationCapacity:', error);
    throw error;
  }
}

/**
 * Get location event count
 * @param {string} locationId - Location ID
 * @param {string} status - Event status filter (optional)
 * @returns {Promise<Object>} Event count by status
 */
async function getLocationEventCount(locationId, status = null) {
  try {
    console.log('Getting location event count:', { locationId, status });

    const filter = { location_id: locationId };
    if (status) {
      filter.status = status;
    }

    const events = await Event.find(filter);
    
    // Count by status
    const countByStatus = events.reduce((acc, event) => {
      acc[event.status] = (acc[event.status] || 0) + 1;
      return acc;
    }, {});

    const totalEvents = events.length;
    const activeEvents = events.filter(event => event.status === 'active').length;
    const upcomingEvents = events.filter(event => 
      event.status === 'active' && event.start_datetime > new Date()
    ).length;
    const pastEvents = events.filter(event => 
      event.end_datetime < new Date()
    ).length;

    console.log('Location event count calculated:', { 
      locationId, 
      totalEvents,
      activeEvents,
      upcomingEvents,
      pastEvents,
      countByStatus 
    });

    return {
      location_id: locationId,
      total_events: totalEvents,
      active_events: activeEvents,
      upcoming_events: upcomingEvents,
      past_events: pastEvents,
      count_by_status: countByStatus,
      events: events.map(event => ({
        id: event._id,
        name: event.name,
        status: event.status,
        start_datetime: event.start_datetime,
        end_datetime: event.end_datetime,
        total_capacity: event.total_capacity,
        total_booked: event.total_booked,
        total_revenue: event.total_revenue
      }))
    };
  } catch (error) {
    console.error('Error in getLocationEventCount:', error);
    throw error;
  }
}

/**
 * Get location event revenue
 * @param {string} locationId - Location ID
 * @param {Date} startDate - Start date filter (optional)
 * @param {Date} endDate - End date filter (optional)
 * @returns {Promise<Object>} Revenue analytics
 */
async function getLocationEventRevenue(locationId, startDate = null, endDate = null) {
  try {
    console.log('Getting location event revenue:', { locationId, startDate, endDate });

    const filter = { location_id: locationId };
    
    if (startDate || endDate) {
      filter.start_datetime = {};
      if (startDate) filter.start_datetime.$gte = startDate;
      if (endDate) filter.start_datetime.$lte = endDate;
    }

    const events = await Event.find(filter);
    
    // Calculate total revenue
    const totalRevenue = events.reduce((sum, event) => sum + (event.total_revenue || 0), 0);
    const totalBooked = events.reduce((sum, event) => sum + (event.total_booked || 0), 0);
    const totalCapacity = events.reduce((sum, event) => sum + (event.total_capacity || 0), 0);
    
    // Calculate average metrics
    const averageRevenuePerEvent = events.length > 0 ? totalRevenue / events.length : 0;
    const averageRevenuePerPerson = totalBooked > 0 ? totalRevenue / totalBooked : 0;
    const overallOccupancyRate = totalCapacity > 0 ? (totalBooked / totalCapacity) * 100 : 0;

    // Revenue by event status
    const revenueByStatus = events.reduce((acc, event) => {
      if (!acc[event.status]) {
        acc[event.status] = { count: 0, revenue: 0, booked: 0, capacity: 0 };
      }
      acc[event.status].count++;
      acc[event.status].revenue += event.total_revenue || 0;
      acc[event.status].booked += event.total_booked || 0;
      acc[event.status].capacity += event.total_capacity || 0;
      return acc;
    }, {});

    // Top performing events
    const topEvents = events
      .sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0))
      .slice(0, 5)
      .map(event => ({
        id: event._id,
        name: event.name,
        revenue: event.total_revenue || 0,
        booked: event.total_booked || 0,
        capacity: event.total_capacity || 0,
        occupancy_rate: event.total_capacity > 0 ? (event.total_booked / event.total_capacity) * 100 : 0,
        start_datetime: event.start_datetime
      }));

    console.log('Location event revenue calculated:', { 
      locationId, 
      totalRevenue,
      totalBooked,
      totalCapacity,
      averageRevenuePerEvent,
      overallOccupancyRate 
    });

    return {
      location_id: locationId,
      period: {
        start_date: startDate,
        end_date: endDate
      },
      summary: {
        total_events: events.length,
        total_revenue: totalRevenue,
        total_booked: totalBooked,
        total_capacity: totalCapacity,
        average_revenue_per_event: averageRevenuePerEvent,
        average_revenue_per_person: averageRevenuePerPerson,
        overall_occupancy_rate: overallOccupancyRate
      },
      revenue_by_status: revenueByStatus,
      top_events: topEvents,
      events: events.map(event => ({
        id: event._id,
        name: event.name,
        status: event.status,
        start_datetime: event.start_datetime,
        end_datetime: event.end_datetime,
        revenue: event.total_revenue || 0,
        booked: event.total_booked || 0,
        capacity: event.total_capacity || 0,
        occupancy_rate: event.total_capacity > 0 ? (event.total_booked / event.total_capacity) * 100 : 0
      }))
    };
  } catch (error) {
    console.error('Error in getLocationEventRevenue:', error);
    throw error;
  }
}

/**
 * Get location analytics including events
 * @param {string} locationId - Location ID
 * @returns {Promise<Object>} Comprehensive location analytics
 */
async function getLocationAnalytics(locationId) {
  try {
    console.log('Getting location analytics:', locationId);

    const location = await Location.findById(locationId);
    if (!location) {
      throw new Error('Location not found');
    }

    // Get event data
    const eventCount = await getLocationEventCount(locationId);
    const eventRevenue = await getLocationEventRevenue(locationId);

    // Calculate location utilization
    const totalLocationCapacity = location.seats.reduce((sum, seat) => sum + (seat.capacity || 0), 0) +
                                 location.units.reduce((sum, unit) => sum + (unit.occupancy || 0), 0);

    const totalEventCapacity = eventCount.events.reduce((sum, event) => sum + event.total_capacity, 0);
    const totalEventBooked = eventCount.events.reduce((sum, event) => sum + event.total_booked, 0);

    const locationUtilization = totalLocationCapacity > 0 ? (totalEventBooked / totalLocationCapacity) * 100 : 0;

    console.log('Location analytics calculated:', { 
      locationId, 
      locationName: location.name,
      totalEvents: eventCount.total_events,
      totalRevenue: eventRevenue.summary.total_revenue,
      locationUtilization 
    });

    return {
      location_id: locationId,
      location_name: location.name,
      location_type: location.type,
      location_capacity: totalLocationCapacity,
      event_summary: {
        total_events: eventCount.total_events,
        active_events: eventCount.active_events,
        upcoming_events: eventCount.upcoming_events,
        past_events: eventCount.past_events
      },
      revenue_summary: eventRevenue.summary,
      utilization: {
        total_event_capacity: totalEventCapacity,
        total_event_booked: totalEventBooked,
        location_utilization_rate: locationUtilization
      },
      top_events: eventRevenue.top_events,
      revenue_by_status: eventRevenue.revenue_by_status
    };
  } catch (error) {
    console.error('Error in getLocationAnalytics:', error);
    throw error;
  }
}

module.exports = {
  inheritSeatsFromLocation,
  updateLocationSeatStatus,
  validateLocationCapacity,
  getLocationEventCount,
  getLocationEventRevenue,
  getLocationAnalytics
};

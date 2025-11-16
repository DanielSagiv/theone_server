const COE = require('../models/COE');
const Event = require('../models/Event');
const User = require('../models/User');

/**
 * COE Service
 * @description Business logic for COE operations
 */

/**
 * Validate that all selected seats are available before COE creation
 * @param {Array} selectedSeats - Array of seat data
 * @throws {Error} If any seat is not available
 */
async function validateSelectedSeats(selectedSeats) {
  try {
    for (const seatData of selectedSeats) {
      const event = await Event.findById(seatData.event_id);
      
      if (!event) {
        throw new Error(`Event ${seatData.event_id} not found`);
      }
      
      const seat = event.seats.find(s => s._id.toString() === seatData.seat_id);
      
      if (!seat) {
        throw new Error(`Seat ${seatData.seat_id} not found in event ${event.name}`);
      }
      
      if (seat.status !== 'available') {
        throw new Error(`Seat ${seat.code} is ${seat.status} and cannot be selected`);
      }
    }
  } catch (error) {
    console.error('Selected seat validation failed:', error);
    throw error;
  }
}

/**
 * Update selected seats status to 'held' when COE is created/approved
 * @param {Array} selectedSeats - Array of seat data
 * @param {string} coeId - COE ID for booking reference
 */
async function updateSelectedSeatsStatus(selectedSeats, coeId, newStatus = 'held') {
  try {
    // Use bulk update for better performance
    const bulkOps = selectedSeats.map(seatData => ({
      updateOne: {
        filter: { '_id': seatData.event_id, 'seats._id': seatData.seat_id },
        update: {
          $set: {
            'seats.$.status': newStatus,
            'seats.$.booking_reference': coeId.toString(),
            'seats.$.booked_at': new Date()
          }
        }
      }
    }));

    if (bulkOps.length > 0) {
      await Event.bulkWrite(bulkOps);
    }

    // Update status in COE selected_seats array
    await COE.updateOne(
      { '_id': coeId },
      {
        $set: {
          'selected_seats.$[seat].status': newStatus
        }
      },
      {
        arrayFilters: [{ 'seat.seat_id': { $in: selectedSeats.map(s => s.seat_id) } }]
      }
    );
  } catch (error) {
    console.error('Error updating selected seats status:', error);
    throw error;
  }
}

/**
 * Update seat statuses to 'booked' when COE is accepted
 * @param {string} coeId - COE ID
 */
async function updateSeatStatusesToBooked(coeId) {
  try {
    // Use bulk update for better performance
    await Event.updateMany(
      { 'seats.booking_reference': coeId.toString() },
      { 
        $set: { 
          'seats.$[seat].status': 'booked'
        }
      },
      { 
        arrayFilters: [{ 'seat.booking_reference': coeId.toString() }]
      }
    );
  } catch (error) {
    console.error('Error updating seat statuses to booked:', error);
    throw error;
  }
}

/**
 * Release selected seats when COE is deleted or cancelled
 * @param {string} coeId - COE ID
 */
async function releaseSelectedSeats(coeId) {
  try {
    // Use bulk update for better performance
    await Event.updateMany(
      { 'seats.booking_reference': coeId.toString() },
      { 
        $set: { 
          'seats.$[seat].status': 'available',
          'seats.$[seat].booking_reference': undefined,
          'seats.$[seat].booked_at': undefined,
          'seats.$[seat].booked_by': undefined
        }
      },
      { 
        arrayFilters: [{ 'seat.booking_reference': coeId.toString() }]
      }
    );

    // Update status in COE selected_seats array to 'released'
    await COE.updateOne(
      { '_id': coeId },
      {
        $set: {
          'selected_seats.$[].status': 'released'
        }
      }
    );
  } catch (error) {
    console.error('Error releasing selected seats:', error);
    throw error;
  }
}

/**
 * Create a new COE
 * @param {Object} coeData - COE data
 * @param {string} createdBy - ID of user creating the COE
 * @returns {Promise<Object>} Created COE
 */
async function createCOE(coeData, createdBy) {
  try {
    // Validate that client and admin exist
    const [client, admin] = await Promise.all([
      User.findById(coeData.client_id),
      User.findById(coeData.admin_id)
    ]);

    if (!client) {
      throw new Error('Client not found');
    }
    if (!admin) {
      throw new Error('Admin not found');
    }

    // Validate selected seats before creating COE
    if (coeData.selected_seats && coeData.selected_seats.length > 0) {
      await validateSelectedSeats(coeData.selected_seats);
    }

    // Set creation details
    const coe = new COE({
      ...coeData,
      created_by: createdBy,
      created_method: 'manual'
    });

    await coe.save();
    
    // Set coe_id for all events and selected_seats after COE is created
    if (coe.events && coe.events.length > 0) {
      coe.events.forEach(event => {
        event.coe_id = coe._id;
      });
    }
    
    if (coe.selected_seats && coe.selected_seats.length > 0) {
      coe.selected_seats.forEach(seat => {
        seat.coe_id = coe._id;
        // Ensure status is set (defaults to 'selected' in schema)
        if (!seat.status) {
          seat.status = 'selected';
        }
      });
    }
    
    await coe.save();
    
    // Update seat statuses to 'held' after COE is created
    if (coeData.selected_seats && coeData.selected_seats.length > 0) {
      await updateSelectedSeatsStatus(coeData.selected_seats, coe._id, 'held');
    }
    
    // Populate references
    await coe.populate([
      { path: 'client_id', select: 'firstName lastName email' },
      { path: 'admin_id', select: 'firstName lastName email' },
      { path: 'created_by', select: 'firstName lastName email' }
    ]);

    return coe;
  } catch (error) {
    console.error('Error creating COE:', error);
    throw error;
  }
}

/**
 * Get COE by ID with populated references
 * @param {string} coeId - COE ID
 * @returns {Promise<Object>} COE with populated data
 */
async function getCOEById(coeId) {
  try {
    const coe = await COE.findById(coeId)
      .populate('client_id', 'firstName lastName email phone')
      .populate('admin_id', 'firstName lastName email')
      .populate('created_by', 'firstName lastName email')
      .populate('participants.user_id', 'firstName lastName email phone')
      .populate('runner_assignment.runner_id', 'firstName lastName email phone avatarUrl')
      .populate({
        path: 'events.event_id',
        select: 'name description location_id start_datetime end_datetime base_price currency status media seats',
        populate: [
          {
            path: 'location_id',
            select: 'name type media seats'
          }
        ]
      })
      .populate('events.runner_assignment.runner_id', 'firstName lastName email phone avatarUrl');

    if (!coe) {
      throw new Error('COE not found');
    }

    return coe;
  } catch (error) {
    console.error('Error getting COE:', error);
    throw error;
  }
}

/**
 * Get all COEs with filtering and pagination
 * @param {Object} filters - Filter options
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} COEs with pagination info
 */
async function getCOEs(filters = {}, pagination = {}) {
  try {
    const {
      status,
      client_id,
      admin_id,
      runner_id,
      created_method,
      start_date,
      end_date
    } = filters;

    const {
      page = 1,
      limit = 10,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = pagination;

    // Build query
    const query = {};
    
    if (status) query.status = status;
    if (client_id) query.client_id = client_id;
    if (admin_id) query.admin_id = admin_id;
    if (created_method) query.created_method = created_method;
    
    if (start_date || end_date) {
      query.start_date = {};
      if (start_date) query.start_date.$gte = new Date(start_date);
      if (end_date) query.start_date.$lte = new Date(end_date);
    }

    if (runner_id) {
      query.$or = [
        { 'runner_assignment.runner_id': runner_id },
        { 'events.runner_assignment.runner_id': runner_id }
      ];
    }

    // Execute query
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const [coes, total] = await Promise.all([
      COE.find(query)
        .populate('client_id', 'firstName lastName email')
        .populate('admin_id', 'firstName lastName email')
        .populate('runner_assignment.runner_id', 'firstName lastName email avatarUrl')
        .sort(sort)
        .skip(skip)
        .limit(limit),
      COE.countDocuments(query)
    ]);

    return {
      coes,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  } catch (error) {
    console.error('Error getting COEs:', error);
    throw error;
  }
}

/**
 * Update COE
 * @param {string} coeId - COE ID
 * @param {Object} updateData - Update data
 * @returns {Promise<Object>} Updated COE
 */
async function updateCOE(coeId, updateData) {
  try {
    // Get the existing COE to compare seat changes
    const existingCOE = await COE.findById(coeId);
    if (!existingCOE) {
      throw new Error('COE not found');
    }

    // Handle seat status updates if selected_seats are being updated
    if (updateData.selected_seats) {
      // Release old seats back to available
      await releaseSelectedSeats(coeId);
      
      // Validate new seat availability
      await validateSelectedSeats(updateData.selected_seats);
      
      // Hold new seats
      await updateSelectedSeatsStatus(updateData.selected_seats, coeId, 'held');
    }

    const coe = await COE.findByIdAndUpdate(
      coeId,
      { ...updateData, updated_at: new Date() },
      { new: true, runValidators: true }
    )
    .populate('client_id', 'firstName lastName email')
    .populate('admin_id', 'firstName lastName email')
    .populate('created_by', 'firstName lastName email');

    if (!coe) {
      throw new Error('COE not found');
    }

    return coe;
  } catch (error) {
    console.error('Error updating COE:', error);
    throw error;
  }
}

/**
 * Delete COE
 * @param {string} coeId - COE ID
 * @returns {Promise<boolean>} Success status
 */
async function deleteCOE(coeId) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      throw new Error('COE not found');
    }

    // Check if COE can be deleted (not accepted or completed)
    if (['accepted', 'completed'].includes(coe.status)) {
      throw new Error('Cannot delete COE in accepted or completed status');
    }

    // Release selected seats before deleting COE
    await releaseSelectedSeats(coeId);

    await COE.findByIdAndDelete(coeId);
    return true;
  } catch (error) {
    console.error('Error deleting COE:', error);
    throw error;
  }
}

/**
 * Add event to COE
 * @param {string} coeId - COE ID
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Updated COE
 */
async function addEventToCOE(coeId, eventData) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      throw new Error('COE not found');
    }

    // Validate event exists
    const event = await Event.findById(eventData.event_id);
    if (!event) {
      throw new Error('Event not found');
    }

    // Calculate total price
    const totalPrice = eventData.base_price * eventData.quantity;

    // Create COE item
    const coeItem = {
      coe_id: coeId,
      event_id: eventData.event_id,
      event_date: eventData.event_date,
      event_time: eventData.event_time,
      base_price: eventData.base_price,
      quantity: eventData.quantity,
      total_price: totalPrice,
      status: 'pending',
      notes: eventData.notes || '',
      client_notes: eventData.client_notes || '',
      sequence: coe.events.length + 1
    };

    coe.events.push(coeItem);
    await coe.save();

    // Update event coe_count
    await Event.findByIdAndUpdate(eventData.event_id, {
      $inc: { coe_count: 1 }
    });

    return await getCOEById(coeId);
  } catch (error) {
    console.error('Error adding event to COE:', error);
    throw error;
  }
}

/**
 * Remove event from COE
 * @param {string} coeId - COE ID
 * @param {string} eventId - Event ID to remove
 * @returns {Promise<Object>} Updated COE
 */
async function removeEventFromCOE(coeId, eventId) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      throw new Error('COE not found');
    }

    // Find and remove the event
    const eventIndex = coe.events.findIndex(event => event.event_id.toString() === eventId);
    if (eventIndex === -1) {
      throw new Error('Event not found in COE');
    }

    const removedEvent = coe.events[eventIndex];
    coe.events.splice(eventIndex, 1);

    // Reorder remaining events
    coe.events.forEach((event, index) => {
      event.sequence = index + 1;
    });

    await coe.save();

    // Update event coe_count
    await Event.findByIdAndUpdate(eventId, {
      $inc: { coe_count: -1 }
    });

    return await getCOEById(coeId);
  } catch (error) {
    console.error('Error removing event from COE:', error);
    throw error;
  }
}

/**
 * Update COE status
 * @param {string} coeId - COE ID
 * @param {string} status - New status
 * @param {string} updatedBy - User ID who updated
 * @returns {Promise<Object>} Updated COE
 */
async function updateCOEStatus(coeId, status, updatedBy) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      throw new Error('COE not found');
    }

    // Validate status transition
    const validTransitions = {
      'draft': ['approved', 'cancelled'],
      'approved': ['sent', 'cancelled'],
      'sent': ['accepted', 'rejected', 'expired'],
      'accepted': ['completed', 'cancelled'],
      'rejected': ['draft'],
      'expired': ['draft'],
      'completed': [],
      'cancelled': []
    };

    if (!validTransitions[coe.status]?.includes(status)) {
      throw new Error(`Invalid status transition from ${coe.status} to ${status}`);
    }

    await coe.updateStatus(status, updatedBy);
    
    // Handle seat status changes based on COE status
    if (status === 'accepted') {
      // When COE is accepted, seats become 'booked'
      await updateSeatStatusesToBooked(coeId);
      // Update selected_seats status in COE
      const coe = await COE.findById(coeId);
      if (coe && coe.selected_seats && coe.selected_seats.length > 0) {
        coe.selected_seats.forEach(seat => {
          seat.status = 'booked';
        });
        await coe.save();
      }
    } else if (['cancelled', 'rejected', 'expired'].includes(status)) {
      // When COE is cancelled/rejected/expired, seats are released
      await releaseSelectedSeats(coeId);
    }
    
    return await getCOEById(coeId);
  } catch (error) {
    console.error('Error updating COE status:', error);
    throw error;
  }
}

/**
 * Assign runner to COE
 * @param {string} coeId - COE ID
 * @param {Object} runnerData - Runner assignment data
 * @param {string} assignedBy - User ID who assigned
 * @returns {Promise<Object>} Updated COE
 */
async function assignRunnerToCOE(coeId, runnerData, assignedBy) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      throw new Error('COE not found');
    }

    // Validate runner exists
    const runner = await User.findById(runnerData.runner_id);
    if (!runner || runner.role !== 'runner') {
      throw new Error('Invalid runner');
    }

    // Update runner assignment
    coe.runner_assignment = {
      type: runnerData.type || 'coe',
      runner_id: runnerData.runner_id,
      assigned_by: assignedBy,
      assigned_at: new Date(),
      status: 'assigned',
      notes: runnerData.notes || ''
    };

    await coe.save();
    return await getCOEById(coeId);
  } catch (error) {
    console.error('Error assigning runner to COE:', error);
    throw error;
  }
}

/**
 * Update seat assignments for COE
 * @param {string} coeId - COE ID
 * @param {Array} selectedSeats - Selected seats data
 * @returns {Promise<Object>} Updated COE
 */
async function updateSeatAssignments(coeId, selectedSeats) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      throw new Error('COE not found');
    }

    // Validate all events and seats exist
    for (const seat of selectedSeats) {
      const event = await Event.findById(seat.event_id);
      if (!event) {
        throw new Error(`Event ${seat.event_id} not found`);
      }

      // Check if seat exists in event
      const seatExists = event.seats.some(s => s._id.toString() === seat.seat_id);
      if (!seatExists) {
        throw new Error(`Seat ${seat.seat_id} not found in event ${seat.event_id}`);
      }
    }

    coe.selected_seats = selectedSeats.map(seat => ({
      ...seat,
      status: seat.status || 'selected'
    }));
    await coe.save();

    return await getCOEById(coeId);
  } catch (error) {
    console.error('Error updating seat assignments:', error);
    throw error;
  }
}

/**
 * Get COEs by client
 * @param {string} clientId - Client ID
 * @returns {Promise<Array>} Client's COEs
 */
async function getCOEsByClient(clientId) {
  try {
    const coes = await COE.find({ 
      $or: [
        { client_id: clientId },
        { 'participants.user_id': clientId }
      ]
    })
    .populate('client_id', 'firstName lastName email')
    .populate('admin_id', 'firstName lastName email')
    .populate('runner_assignment.runner_id', 'firstName lastName email avatarUrl')
    .sort({ created_at: -1 });

    return coes;
  } catch (error) {
    console.error('Error getting COEs by client:', error);
    throw error;
  }
}

/**
 * Get COEs by runner
 * @param {string} runnerId - Runner ID
 * @returns {Promise<Array>} Runner's assigned COEs
 */
async function getCOEsByRunner(runnerId) {
  try {
    const coes = await COE.find({
      $or: [
        { 'runner_assignment.runner_id': runnerId },
        { 'events.runner_assignment.runner_id': runnerId }
      ]
    })
    .populate('client_id', 'firstName lastName email')
    .populate('admin_id', 'firstName lastName email')
    .populate('runner_assignment.runner_id', 'firstName lastName email avatarUrl')
    .sort({ created_at: -1 });

    return coes;
  } catch (error) {
    console.error('Error getting COEs by runner:', error);
    throw error;
  }
}

/**
 * Get COE statistics
 * @returns {Promise<Object>} COE statistics
 */
async function getCOEStatistics() {
  try {
    const stats = await COE.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$total' }
        }
      }
    ]);

    const totalCOEs = await COE.countDocuments();
    const totalValue = await COE.aggregate([
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    return {
      totalCOEs,
      totalValue: totalValue[0]?.total || 0,
      byStatus: stats.reduce((acc, stat) => {
        acc[stat._id] = {
          count: stat.count,
          totalValue: stat.totalValue
        };
        return acc;
      }, {})
    };
  } catch (error) {
    console.error('Error getting COE statistics:', error);
    throw error;
  }
}

module.exports = {
  createCOE,
  getCOEById,
  getCOEs,
  updateCOE,
  deleteCOE,
  addEventToCOE,
  removeEventFromCOE,
  updateCOEStatus,
  assignRunnerToCOE,
  updateSeatAssignments,
  getCOEsByClient,
  getCOEsByRunner,
  getCOEStatistics,
  validateSelectedSeats,
  updateSelectedSeatsStatus,
  updateSeatStatusesToBooked,
  releaseSelectedSeats
};

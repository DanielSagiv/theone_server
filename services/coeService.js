const COE = require('../models/COE');
const Event = require('../models/Event');
const User = require('../models/User');

/**
 * COE Service
 * @description Business logic for COE operations
 */

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

    // Set creation details
    const coe = new COE({
      ...coeData,
      created_by: createdBy,
      created_method: 'manual'
    });

    await coe.save();
    
    // Set coe_id for all events and available_seats after COE is created
    if (coe.events && coe.events.length > 0) {
      coe.events.forEach(event => {
        event.coe_id = coe._id;
      });
    }
    
    if (coe.available_seats && coe.available_seats.length > 0) {
      coe.available_seats.forEach(seat => {
        seat.coe_id = coe._id;
      });
    }
    
    await coe.save();
    
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
      .populate('runner_assignment.runner_id', 'firstName lastName email phone')
      .populate('events.event_id', 'name description location_id start_datetime end_datetime base_price currency status')
      .populate('events.runner_assignment.runner_id', 'firstName lastName email phone');

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
        .populate('runner_assignment.runner_id', 'firstName lastName email')
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
 * @param {Array} availableSeats - Available seats data
 * @returns {Promise<Object>} Updated COE
 */
async function updateSeatAssignments(coeId, availableSeats) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      throw new Error('COE not found');
    }

    // Validate all events and seats exist
    for (const seat of availableSeats) {
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

    coe.available_seats = availableSeats;
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
    .populate('runner_assignment.runner_id', 'firstName lastName email')
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
    .populate('runner_assignment.runner_id', 'firstName lastName email')
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
  getCOEStatistics
};

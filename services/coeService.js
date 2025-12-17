const COE = require('../models/COE');
const Event = require('../models/Event');
const User = require('../models/User');
const { selectSeatsByBudgetAndCapacity } = require('./botAutoFillService');
const { generateSeatUpgradeOffers } = require('./seatUpgradeService');

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
      // Validate event_id exists
      if (!seatData.event_id) {
        throw new Error(`Seat data missing event_id: ${JSON.stringify(seatData)}`);
      }
      
      // Validate seat_id exists
      if (!seatData.seat_id) {
        throw new Error(`Seat data missing seat_id: ${JSON.stringify(seatData)}`);
      }
      
      const event = await Event.findById(seatData.event_id);
      
      if (!event) {
        throw new Error(`Event ${seatData.event_id} not found`);
      }
      
      // Normalize seat_id for comparison (handle both ObjectId and string)
      const seatIdStr = seatData.seat_id.toString();
      const seat = event.seats.find(s => {
        if (!s._id) return false;
        const sIdStr = s._id.toString();
        return sIdStr === seatIdStr;
      });
      
      if (!seat) {
        // Provide helpful error message with available seat IDs
        const availableSeatIds = event.seats.map(s => s._id?.toString()).filter(Boolean);
        throw new Error(`Seat ${seatIdStr} not found in event ${event.name}. Available seat IDs: ${availableSeatIds.join(', ')}`);
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

    // Log pricing before save
    console.log('[COE_SERVICE] Pricing in COE before save:', {
      subtotal: coe.subtotal,
      taxes: coe.taxes,
      fees: coe.fees,
      total: coe.total,
      deposit_required: coe.deposit_required
    });

    await coe.save();
    
    // Log pricing after save
    console.log('[COE_SERVICE] Pricing in COE after save:', {
      subtotal: coe.subtotal,
      taxes: coe.taxes,
      fees: coe.fees,
      total: coe.total,
      deposit_required: coe.deposit_required
    });
    
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
    const mongoose = require('mongoose');
    
    // Load COE with population - schema now has defaults for base_price/total_price so validation should pass
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

    // Manual population fallback for events that weren't populated
    // This can happen when events are updated via native MongoDB
    if (coe.events && Array.isArray(coe.events)) {
      for (let i = 0; i < coe.events.length; i++) {
        const eventItem = coe.events[i];
        if (eventItem.event_id) {
          // Check if event_id is not populated (it's an ObjectId or string, not an object with name)
          const isPopulated = eventItem.event_id && 
                             typeof eventItem.event_id === 'object' && 
                             eventItem.event_id.name !== undefined;
          
          if (!isPopulated) {
            // Extract the event ID (could be ObjectId, string, or object with _id)
            let eventIdValue;
            if (eventItem.event_id._id) {
              eventIdValue = eventItem.event_id._id;
            } else if (eventItem.event_id instanceof mongoose.Types.ObjectId) {
              eventIdValue = eventItem.event_id;
            } else if (typeof eventItem.event_id === 'string') {
              eventIdValue = eventItem.event_id;
            } else {
              eventIdValue = eventItem.event_id;
            }
            
            // Try to populate it manually
            try {
              const populatedEvent = await Event.findById(eventIdValue)
                .populate('location_id', 'name type media seats')
                .select('name description location_id start_datetime end_datetime base_price currency status media seats');
              if (populatedEvent) {
                eventItem.event_id = populatedEvent;
                console.log('[getCOEById] Manually populated event:', populatedEvent.name, 'for event_id:', eventIdValue);
              } else {
                console.warn('[getCOEById] Event not found for event_id:', eventIdValue);
              }
            } catch (populateError) {
              console.warn('[getCOEById] Failed to manually populate event:', populateError.message, 'for event_id:', eventIdValue);
            }
          }
        }
      }
    }

    return coe;
  } catch (error) {
    // If validation fails, try using lean() to bypass validation
    if (error.message && error.message.includes('validation failed')) {
      console.warn('[getCOEById] Validation error, using lean() to bypass:', error.message);
      try {
        const coe = await COE.findById(coeId)
          .lean()
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
          .populate('events.runner_assignment.runner_id', 'firstName lastName email phone avatarUrl')
          .exec();
        
        if (!coe) {
          throw new Error('COE not found');
        }
        
        // Manual population fallback for events (lean() returns plain objects)
        if (coe.events && Array.isArray(coe.events)) {
          for (let i = 0; i < coe.events.length; i++) {
            const eventItem = coe.events[i];
            if (eventItem.event_id) {
              // Check if event_id is not populated (it's an ObjectId or string, not an object with name)
              const isPopulated = eventItem.event_id && 
                                 typeof eventItem.event_id === 'object' && 
                                 eventItem.event_id.name !== undefined;
              
              if (!isPopulated) {
                // Extract the event ID (could be ObjectId, string, or object with _id)
                let eventIdValue;
                if (eventItem.event_id._id) {
                  eventIdValue = eventItem.event_id._id;
                } else if (typeof eventItem.event_id === 'string') {
                  eventIdValue = eventItem.event_id;
                } else {
                  eventIdValue = eventItem.event_id.toString ? eventItem.event_id.toString() : eventItem.event_id;
                }
                
                try {
                  const populatedEvent = await Event.findById(eventIdValue)
                    .populate('location_id', 'name type media seats')
                    .select('name description location_id start_datetime end_datetime base_price currency status media seats')
                    .lean();
                  if (populatedEvent) {
                    eventItem.event_id = populatedEvent;
                    console.log('[getCOEById] Manually populated event (lean):', populatedEvent.name, 'for event_id:', eventIdValue);
                  } else {
                    console.warn('[getCOEById] Event not found (lean) for event_id:', eventIdValue);
                  }
                } catch (populateError) {
                  console.warn('[getCOEById] Failed to manually populate event (lean):', populateError.message, 'for event_id:', eventIdValue);
                }
              }
            }
          }
        }
        
        return coe;
      } catch (leanError) {
        console.error('Error getting COE with lean():', leanError);
        throw error; // Throw original validation error
      }
    }
    
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

/**
 * Accept a seat upgrade offer - replace current seat with upgraded seat
 * @param {string} coeId - COE ID
 * @param {string} currentSeatId - Current seat ID to replace
 * @param {string} upgradeSeatId - Upgrade seat ID to use
 * @param {string} eventId - Event ID
 * @returns {Promise<Object>} Updated COE
 */
async function acceptSeatUpgrade(coeId, currentSeatId, upgradeSeatId, eventId) {
  try {
    const coe = await COE.findById(coeId);
    if (!coe) {
      throw new Error('COE not found');
    }

    if (coe.status !== 'draft') {
      throw new Error('Seat upgrades can only be accepted for draft COEs');
    }

    // Find the upgrade offer
    const offerIndex = coe.seat_upgrade_offers.findIndex(
      o => o.current_seat_id.toString() === currentSeatId && o.event_id.toString() === eventId
    );
    
    if (offerIndex === -1) {
      throw new Error('Upgrade offer not found');
    }

    const offer = coe.seat_upgrade_offers[offerIndex];
    
    // Find the alternative seat in the offer
    const altIndex = offer.alternatives.findIndex(a => a.seat_id.toString() === upgradeSeatId);
    if (altIndex === -1) {
      throw new Error('Alternative seat not found in offer');
    }

    const upgradeSeat = offer.alternatives[altIndex];

    // Find and update the selected seat
    const seatIndex = coe.selected_seats.findIndex(
      s => s.seat_id.toString() === currentSeatId && s.event_id.toString() === eventId
    );

    if (seatIndex === -1) {
      throw new Error('Current seat not found in COE');
    }

    // Replace with upgraded seat
    coe.selected_seats[seatIndex] = {
      event_id: coe.selected_seats[seatIndex].event_id,
      seat_id: upgradeSeat.seat_id,
      seat_code: upgradeSeat.seat_code,
      capacity: upgradeSeat.capacity || coe.selected_seats[seatIndex].capacity,
      base_price: upgradeSeat.base_price || upgradeSeat.event_price,
      event_price: upgradeSeat.event_price,
      available_from: coe.selected_seats[seatIndex].available_from,
      available_until: coe.selected_seats[seatIndex].available_until,
      status: 'selected'
    };

    // Mark offer as accepted
    coe.seat_upgrade_offers[offerIndex].alternatives[altIndex].status = 'accepted';

    // Recalculate totals
    const newSubtotal = coe.selected_seats.reduce((sum, s) => sum + (s.event_price || 0), 0);
    coe.subtotal = newSubtotal;
    coe.total = newSubtotal + (coe.taxes || 0) + (coe.fees || 0);

    await coe.save();
    return await getCOEById(coeId);
  } catch (error) {
    console.error('Error accepting seat upgrade:', error);
    throw error;
  }
}

/**
 * Remove events from a draft COE
 * Also removes associated selected_seats and seat_upgrade_offers
 * @param {string} coeId - COE ID
 * @param {Array<string>} eventIds - Array of event IDs to remove
 * @returns {Promise<Object>} Updated COE
 */
async function removeEventsFromCOE(coeId, eventIds) {
  try {
    const coe = await COE.findById(coeId);
    
    if (!coe) {
      throw new Error('COE not found');
    }

    if (coe.status !== 'draft') {
      throw new Error('Can only remove events from draft COEs');
    }

    // Normalize event IDs to strings for comparison
    const eventIdStrings = eventIds.map(id => id.toString());

    // Remove events from COE.events array (if it exists)
    if (coe.events && Array.isArray(coe.events)) {
      coe.events = coe.events.filter(event => {
        const eventId = event.event_id?.toString() || event.event_id;
        return !eventIdStrings.includes(eventId);
      });
      
      // Reorder remaining events
      coe.events.forEach((event, index) => {
        event.sequence = index + 1;
      });
    }

    // Remove selected_seats associated with removed events
    const initialSeatCount = coe.selected_seats?.length || 0;
    coe.selected_seats = (coe.selected_seats || []).filter(seat => {
      const seatEventId = seat.event_id?.toString() || seat.event_id;
      return !eventIdStrings.includes(seatEventId);
    });

    // Remove seat_upgrade_offers associated with removed events
    coe.seat_upgrade_offers = (coe.seat_upgrade_offers || []).filter(offer => {
      const offerEventId = offer.event_id?.toString() || offer.event_id;
      return !eventIdStrings.includes(offerEventId);
    });

    // Recalculate totals
    const newSubtotal = (coe.selected_seats || []).reduce((sum, s) => sum + (s.event_price || 0), 0);
    coe.subtotal = newSubtotal;
    coe.total = newSubtotal + (coe.taxes || 0) + (coe.fees || 0);

    // Update event coe_count
    for (const eventId of eventIds) {
      await Event.findByIdAndUpdate(eventId, {
        $inc: { coe_count: -1 }
      });
    }

    await coe.save();
    
    console.log(`[COE_SERVICE] Removed ${eventIds.length} events from COE ${coeId}. Removed ${initialSeatCount - (coe.selected_seats?.length || 0)} seats.`);
    
    return await getCOEById(coeId);
  } catch (error) {
    console.error('Error removing events from COE:', error);
    throw error;
  }
}

/**
 * Replace an event in a draft COE
 * @param {string} coeId - COE ID
 * @param {string} oldEventId - Event ID to replace
 * @param {string} newEventId - New event ID
 * @param {Object} options - Options for seat selection
 * @param {boolean} options.preserve_seats - Try to match seats from old event
 * @param {Object} options.seat_preferences - Preferences for seat selection if preserve_seats is false
 * @returns {Promise<Object>} Updated COE
 */
async function replaceEventInCOE(coeId, oldEventId, newEventId, options = {}) {
  try {
    const { preserve_seats = false, seat_preferences = {}, isAdmin = false } = options;
    
    // Use native MongoDB collection to load COE and bypass Mongoose validation entirely
    // This ensures we can work with the COE even if some events are missing required fields
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const coesCollection = db.collection('coes');
    const coeObjectId = mongoose.Types.ObjectId.isValid(coeId) 
      ? new mongoose.Types.ObjectId(coeId) 
      : coeId;
    
    // Load COE using native MongoDB to bypass validation
    let coe = await coesCollection.findOne({ _id: coeObjectId });
    
    if (!coe) {
      throw new Error('COE not found');
    }

    if (coe.status !== 'draft') {
      throw new Error('Can only replace events in draft COEs');
    }

    // Ensure all existing events have required fields to avoid validation errors
    // Load the COE and fix any events missing required fields
    const coeDoc = await coesCollection.findOne({ _id: coeObjectId });
    if (coeDoc && coeDoc.events && Array.isArray(coeDoc.events)) {
      let needsUpdate = false;
      const fixedEvents = coeDoc.events.map(event => {
        const fixed = { ...event };
        if (fixed.base_price === undefined || fixed.base_price === null) {
          fixed.base_price = 0;
          needsUpdate = true;
        }
        if (fixed.total_price === undefined || fixed.total_price === null) {
          fixed.total_price = 0;
          needsUpdate = true;
        }
        if (fixed.quantity === undefined || fixed.quantity === null) {
          fixed.quantity = 1;
          needsUpdate = true;
        }
        return fixed;
      });
      
      if (needsUpdate) {
        await coesCollection.updateOne(
          { _id: coeObjectId },
          { $set: { events: fixedEvents } }
        );
        console.log('[COE_SERVICE] Fixed events with missing required fields');
      }
    }
    
    // Reload COE after ensuring required fields (use lean to avoid validation)
    coe = await COE.findById(coeId).lean();

    const oldEventIdStr = oldEventId.toString();
    const newEventIdStr = newEventId.toString();

    // Helper function to normalize event ID for comparison
    const normalizeEventIdForComparison = (id) => {
      if (!id) return null;
      // Handle ObjectId, string, or object with _id
      if (id.toString && typeof id.toString === 'function') {
        return id.toString();
      }
      if (id._id && id._id.toString) {
        return id._id.toString();
      }
      return String(id);
    };

    const normalizedOldEventId = normalizeEventIdForComparison(oldEventId);
    const normalizedNewEventId = normalizeEventIdForComparison(newEventId);

    console.log('[COE_SERVICE] replaceEventInCOE - Looking for old event:', {
      coeId,
      oldEventId: normalizedOldEventId,
      oldEventIdRaw: oldEventId,
      oldEventIdType: typeof oldEventId,
      newEventId: normalizedNewEventId,
      coeEventsCount: coe.events?.length || 0,
      selectedSeatsCount: coe.selected_seats?.length || 0
    });

    // Check both coe.events array and selected_seats
    const eventsInCoe = (coe.events || []).map(e => {
      const eventId = normalizeEventIdForComparison(e.event_id);
      return { eventId, source: 'events_array', raw: e.event_id };
    });
    
    const eventsInSeats = (coe.selected_seats || []).map(seat => {
      const eventId = normalizeEventIdForComparison(seat.event_id);
      return { eventId, source: 'selected_seats', raw: seat.event_id };
    });

    console.log('[COE_SERVICE] Events in COE:', {
      fromEventsArray: eventsInCoe.map(e => ({ eventId: e.eventId, rawType: typeof e.raw })),
      fromSelectedSeats: [...new Set(eventsInSeats.map(e => e.eventId))],
      lookingFor: normalizedOldEventId,
      lookingForType: typeof oldEventId
    });

    // Validate old event exists in COE (check both events array and selected_seats)
    
    const hasOldEventInEvents = (coe.events || []).some(event => {
      const eventId = normalizeEventIdForComparison(event.event_id);
      const matches = eventId === normalizedOldEventId;
      if (matches) {
        console.log('[COE_SERVICE] Found old event in events array:', {
          eventId,
          oldEventId: normalizedOldEventId,
          event: event
        });
      }
      return matches;
    });

    const hasOldEventInSeats = (coe.selected_seats || []).some(seat => {
      const seatEventId = normalizeEventIdForComparison(seat.event_id);
      const matches = seatEventId === normalizedOldEventId;
      if (matches) {
        console.log('[COE_SERVICE] Found old event in selected_seats:', {
          seatEventId,
          oldEventId: normalizedOldEventId,
          seat_code: seat.seat_code
        });
      }
      return matches;
    });

    const hasOldEvent = hasOldEventInEvents || hasOldEventInSeats;

    if (!hasOldEvent) {
      console.error('[COE_SERVICE] Old event not found in COE:', {
        oldEventId: oldEventIdStr,
        eventsInCoe: eventsInCoe.map(e => e.eventId),
        eventsInSeats: [...new Set(eventsInSeats.map(e => e.eventId))],
        coeId
      });
      throw new Error('Old event not found in COE');
    }

    console.log('[COE_SERVICE] Old event found:', {
      foundInEventsArray: hasOldEventInEvents,
      foundInSelectedSeats: hasOldEventInSeats
    });

    // Fetch new event and validate
    const newEvent = await Event.findById(newEventId)
      .populate('location_id', 'name address city state country seats media');
    
    if (!newEvent) {
      throw new Error('New event not found');
    }

    const now = new Date();
    if (newEvent.end_datetime && new Date(newEvent.end_datetime) < now) {
      throw new Error('New event has already ended');
    }

    // Get old event structure from coe.events before removal (to preserve sequence and other fields)
    const oldEventIndex = (coe.events || []).findIndex(event => {
      const eventId = normalizeEventIdForComparison(event.event_id);
      return eventId === normalizedOldEventId;
    });
    const oldEventInCoe = oldEventIndex >= 0 ? coe.events[oldEventIndex] : null;
    const oldEventSequence = oldEventInCoe?.sequence || ((coe.events || []).length + 1);

    // Instead of removing and re-adding, we'll replace the event in place
    // First, save old seats before removing them (needed for preserve_seats logic)
    const oldSeatsBeforeRemoval = (coe.selected_seats || []).filter(seat => {
      const seatEventId = seat.event_id?.toString() || seat.event_id;
      return seatEventId === oldEventIdStr;
    });
    
    // Remove old seats and upgrade offers for the old event
    coe.selected_seats = (coe.selected_seats || []).filter(seat => {
      const seatEventId = seat.event_id?.toString() || seat.event_id;
      return seatEventId !== oldEventIdStr;
    });
    
    coe.seat_upgrade_offers = (coe.seat_upgrade_offers || []).filter(offer => {
      const offerEventId = offer.event_id?.toString() || offer.event_id;
      return offerEventId !== oldEventIdStr;
    });

    // Replace the old event with the new event in the events array
    // Use direct MongoDB update to bypass Mongoose validation
    // This avoids validation errors on other events that might be missing required fields
    
    // Preserve pricing fields from old event or use defaults
    const eventDate = newEvent.start_datetime 
      ? new Date(newEvent.start_datetime) 
      : (oldEventInCoe?.event_date ? new Date(oldEventInCoe.event_date) : new Date());
    
    const newEventEntry = {
      coe_id: coe._id,
      event_id: newEventId,
      event_date: eventDate, // Must be Date object, not string
      event_time: newEvent.start_datetime 
        ? new Date(newEvent.start_datetime).toTimeString().split(' ')[0] 
        : (oldEventInCoe?.event_time || 'TBD'),
      base_price: oldEventInCoe?.base_price ?? 0, // Preserve from old event or default to 0
      quantity: oldEventInCoe?.quantity ?? 1, // Preserve from old event or default to 1
      total_price: oldEventInCoe?.total_price ?? 0, // Preserve from old event or default to 0
      sequence: oldEventSequence, // Preserve sequence from old event
      status: oldEventInCoe?.status || 'pending', // Preserve status from old event
      notes: oldEventInCoe?.notes || '',
      client_notes: oldEventInCoe?.client_notes || ''
    };
    
    console.log('[COE_SERVICE] Creating new event entry:', {
      event_id: newEventId,
      event_date: eventDate,
      base_price: newEventEntry.base_price,
      total_price: newEventEntry.total_price,
      quantity: newEventEntry.quantity
    });

    // Use native MongoDB collection to bypass Mongoose validation entirely
    // mongoose, db, and coesCollection are already declared at the top of the function
    const oldEventObjectId = mongoose.Types.ObjectId.isValid(oldEventId) 
      ? new mongoose.Types.ObjectId(oldEventId) 
      : oldEventId;
    const newEventObjectId = mongoose.Types.ObjectId.isValid(newEventId) 
      ? new mongoose.Types.ObjectId(newEventId) 
      : newEventId;
    
    // Update newEventEntry to use ObjectId for event_id (required for proper population)
    // Also generate a new _id for the subdocument
    newEventEntry._id = new mongoose.Types.ObjectId();
    newEventEntry.event_id = newEventObjectId;
    newEventEntry.coe_id = coeObjectId;
    
    // Convert newEventEntry to use ObjectIds for MongoDB update
    // Ensure event_id is definitely an ObjectId
    const finalEventObjectId = mongoose.Types.ObjectId.isValid(newEventId) 
      ? new mongoose.Types.ObjectId(newEventId) 
      : newEventObjectId;
    
    const newEventEntryForDB = {
      _id: newEventEntry._id, // Include the generated _id
      coe_id: coeObjectId,
      event_id: finalEventObjectId, // Ensure it's an ObjectId
      event_date: newEventEntry.event_date,
      event_time: newEventEntry.event_time,
      base_price: newEventEntry.base_price,
      quantity: newEventEntry.quantity,
      total_price: newEventEntry.total_price,
      sequence: newEventEntry.sequence,
      status: newEventEntry.status,
      notes: newEventEntry.notes,
      client_notes: newEventEntry.client_notes
    };
    
    console.log('[COE_SERVICE] newEventEntryForDB prepared:', {
      event_id: finalEventObjectId.toString(),
      event_id_type: finalEventObjectId.constructor.name,
      isObjectId: finalEventObjectId instanceof mongoose.Types.ObjectId,
      has_id: !!newEventEntryForDB._id
    });
    
    if (oldEventIndex >= 0) {
      // Use Mongoose update with runValidators: false to bypass validation but keep reference handling
      // This ensures Mongoose recognizes event_id as a reference for population
      try {
        const updateResult = await COE.updateOne(
          { 
            _id: coeId,
            'events.event_id': oldEventObjectId
          },
          {
            $set: {
              'events.$': newEventEntryForDB
            }
          },
          { runValidators: false } // Bypass validation but keep Mongoose reference handling
        );
        console.log('[COE_SERVICE] Used Mongoose $set with positional operator to replace event:', {
          matched: updateResult.matchedCount,
          modified: updateResult.modifiedCount
        });
        
        if (updateResult.matchedCount === 0) {
          console.warn('[COE_SERVICE] Positional operator did not find event, trying index-based update');
          // Fallback to index-based update
          await COE.updateOne(
            { _id: coeId },
            {
              $set: {
                [`events.${oldEventIndex}`]: newEventEntryForDB
              }
            },
            { runValidators: false }
          );
          console.log('[COE_SERVICE] Used index-based Mongoose $set as fallback');
        }
      } catch (mongooseError) {
        console.error('[COE_SERVICE] Mongoose update failed, falling back to native MongoDB:', mongooseError.message);
        // Fallback to native MongoDB if Mongoose fails
        const updateResult = await coesCollection.updateOne(
          { 
            _id: coeObjectId,
            'events.event_id': oldEventObjectId
          },
          {
            $set: {
              'events.$': newEventEntryForDB
            }
          }
        );
        console.log('[COE_SERVICE] Used native MongoDB $set as fallback:', {
          matched: updateResult.matchedCount,
          modified: updateResult.modifiedCount
        });
      }
    } else {
      // If old event not found, just add the new event
      try {
        await COE.findByIdAndUpdate(
          coeId,
          {
            $push: { events: newEventEntryForDB }
          },
          { runValidators: false }
        );
        console.log('[COE_SERVICE] Used Mongoose $push to add event');
      } catch (mongooseError) {
        console.error('[COE_SERVICE] Mongoose push failed, falling back to native MongoDB:', mongooseError.message);
        await coesCollection.updateOne(
          { _id: coeObjectId },
          {
            $push: { events: newEventEntryForDB }
          }
        );
        console.log('[COE_SERVICE] Used native MongoDB $push as fallback');
      }
    }
    
    // Verify the replacement was saved and event_id format
    // First check using native MongoDB to see raw data
    const verifyCoeRaw = await coesCollection.findOne({ _id: coeObjectId });
    if (verifyCoeRaw && verifyCoeRaw.events) {
      const replacedEventRaw = verifyCoeRaw.events.find(e => {
        const eId = e.event_id?.toString() || e.event_id;
        return eId === finalEventObjectId.toString();
      });
      console.log('[COE_SERVICE] Raw DB check after replacement:', {
        found: !!replacedEventRaw,
        eventIdType: replacedEventRaw ? typeof replacedEventRaw.event_id : 'N/A',
        eventIdConstructor: replacedEventRaw ? replacedEventRaw.event_id?.constructor?.name : 'N/A',
        eventIdValue: replacedEventRaw ? replacedEventRaw.event_id?.toString() : 'N/A'
      });
    }
    
    // Now check using Mongoose
    const verifyCoe = await COE.findById(coeId);
    const hasNewEventAfterSave = verifyCoe.events?.some(event => {
      const eventId = normalizeEventIdForComparison(event.event_id);
      return eventId === normalizedNewEventId;
    });
    const hasOldEventAfterSave = verifyCoe.events?.some(event => {
      const eventId = normalizeEventIdForComparison(event.event_id);
      return eventId === normalizedOldEventId;
    });
    console.log('[COE_SERVICE] Verification after save:', {
      hasNewEvent: hasNewEventAfterSave,
      hasOldEvent: hasOldEventAfterSave,
      eventsCount: verifyCoe.events?.length || 0,
      eventIds: verifyCoe.events?.map(e => e.event_id?.toString() || e.event_id) || []
    });

    // If the replacement didn't work, use direct MongoDB update
    if (!hasNewEventAfterSave || hasOldEventAfterSave) {
      console.log('[COE_SERVICE] Mongoose save() did not persist the replacement, using direct MongoDB update');
      
      // First, remove the old event if it still exists
      if (hasOldEventAfterSave) {
        // Use mongoose.Types.ObjectId for proper comparison (mongoose already declared at top)
        const oldEventObjectId = mongoose.Types.ObjectId.isValid(oldEventId) 
          ? new mongoose.Types.ObjectId(oldEventId) 
          : oldEventId;
        
        await COE.findByIdAndUpdate(coeId, {
          $pull: {
            events: {
              event_id: oldEventObjectId
            }
          }
        });
        console.log('[COE_SERVICE] Removed old event using MongoDB $pull:', {
          oldEventId: oldEventId.toString(),
          oldEventObjectId: oldEventObjectId.toString()
        });
      }
      
      // Then add the new event
      if (!hasNewEventAfterSave) {
        await COE.findByIdAndUpdate(coeId, {
          $push: { events: newEventEntry }
        });
        console.log('[COE_SERVICE] Added new event using MongoDB $push');
      }
      
      // Verify again after MongoDB update
      const verifyCoe2 = await COE.findById(coeId);
      const hasNewEvent2 = verifyCoe2.events?.some(event => {
        const eventId = normalizeEventIdForComparison(event.event_id);
        return eventId === normalizedNewEventId;
      });
      const hasOldEvent2 = verifyCoe2.events?.some(event => {
        const eventId = normalizeEventIdForComparison(event.event_id);
        return eventId === normalizedOldEventId;
      });
      console.log('[COE_SERVICE] Verification after MongoDB update:', {
        hasNewEvent: hasNewEvent2,
        hasOldEvent: hasOldEvent2,
        eventsCount: verifyCoe2.events?.length || 0,
        eventIds: verifyCoe2.events?.map(e => e.event_id?.toString() || e.event_id) || []
      });
      
      // Reload COE after MongoDB update to get fresh data
      if (hasNewEvent2 && !hasOldEvent2) {
        console.log('[COE_SERVICE] MongoDB update successful, reloading COE');
      }
    }

    // Reload COE after native MongoDB update using lean() to bypass validation
    // This prevents validation errors on existing events that might be missing required fields
    const coeAfterUpdate = await COE.findById(coeId).lean();
    
    // Convert back to Mongoose document only if we need to save later
    // For now, work with the plain object to avoid validation issues
    let newSeats = [];

    if (preserve_seats) {
      // Use the old seats we saved before removal
      for (const oldSeat of oldSeatsBeforeRemoval) {
        // Try to find matching seat by code
        const matchingSeat = newEvent.seats.find(s => 
          s.code === oldSeat.seat_code && s.status === 'available'
        );

        if (matchingSeat) {
          newSeats.push({
            event_id: newEventId,
            seat_id: matchingSeat._id,
            seat_code: matchingSeat.code,
            capacity: matchingSeat.capacity || oldSeat.capacity,
            base_price: matchingSeat.base_price || oldSeat.base_price,
            event_price: matchingSeat.event_price || matchingSeat.base_price || oldSeat.event_price,
            available_from: newEvent.start_datetime || new Date(),
            available_until: newEvent.end_datetime || null,
            status: 'selected'
          });
        }
      }
    } else if (seat_preferences && Object.keys(seat_preferences).length > 0) {
      // Use existing seat selection logic
      const seatResult = await selectSeatsByBudgetAndCapacity(
        newEvent,
        seat_preferences,
        seat_preferences.budget?.max || null
      );

      if (seatResult.seats && seatResult.seats.length > 0) {
        newSeats = seatResult.seats.map(seat => ({
          event_id: newEventId,
          seat_id: seat._id,
          seat_code: seat.code,
          capacity: seat.capacity,
          base_price: seat.base_price,
          event_price: seat.event_price || seat.base_price,
          available_from: newEvent.start_datetime || new Date(),
          available_until: newEvent.end_datetime || null,
          status: 'selected'
        }));
      }
    }

    // Add new seats to COE using native MongoDB
    if (newSeats.length > 0) {
      await coesCollection.updateOne(
        { _id: coeObjectId },
        {
          $push: {
            selected_seats: { $each: newSeats }
          }
        }
      );
      console.log('[COE_SERVICE] Added new seats using native MongoDB');
    }

    // Recalculate totals using native MongoDB
    // Filter out seats from the old event (they should already be removed, but double-check)
    // oldEventIdStr is already declared at the top of the function
    const currentSeats = (coeAfterUpdate.selected_seats || []).filter(seat => {
      const seatEventId = seat.event_id?.toString() || seat.event_id;
      return seatEventId !== oldEventIdStr;
    });
    const allSeats = [...currentSeats, ...newSeats];
    const newSubtotal = allSeats.reduce((sum, s) => sum + (s.event_price || 0), 0);
    const newTotal = newSubtotal + (coeAfterUpdate.taxes || 0) + (coeAfterUpdate.fees || 0);
    
    // Also recalculate the event's base_price and total_price based on selected seats for this event
    const eventSeatsTotal = allSeats
      .filter(seat => {
        const seatEventId = seat.event_id?.toString() || seat.event_id;
        return seatEventId === newEventId.toString();
      })
      .reduce((sum, s) => sum + (s.event_price || 0), 0);
    
    // Update the event's pricing in the events array
    await coesCollection.updateOne(
      { 
        _id: coeObjectId,
        'events.event_id': finalEventObjectId
      },
      {
        $set: {
          'events.$.base_price': eventSeatsTotal > 0 ? eventSeatsTotal : (newEvent.base_price || 0),
          'events.$.total_price': eventSeatsTotal > 0 ? eventSeatsTotal : (newEvent.base_price || 0)
        }
      }
    );
    
    // Update COE totals
    await coesCollection.updateOne(
      { _id: coeObjectId },
      {
        $set: {
          subtotal: newSubtotal,
          total: newTotal
        }
      }
    );
    console.log('[COE_SERVICE] Updated totals and event pricing using native MongoDB:', {
      newSubtotal,
      newTotal,
      eventSeatsTotal,
      seatsCount: allSeats.length
    });

    // Update event coe_count (decrement old, increment new)
    await Event.findByIdAndUpdate(oldEventId, {
      $inc: { coe_count: -1 }
    });
    await Event.findByIdAndUpdate(newEventId, {
      $inc: { coe_count: 1 }
    });

    console.log(`[COE_SERVICE] Replaced event ${oldEventId} with ${newEventId} in COE ${coeId}. Added ${newSeats.length} seats.`);
    
    // Verify the event was stored correctly by checking the database directly
    const verifyCoeDoc = await coesCollection.findOne({ _id: coeObjectId });
    if (verifyCoeDoc && verifyCoeDoc.events) {
      const replacedEvent = verifyCoeDoc.events.find(e => {
        const eId = e.event_id?.toString() || e.event_id;
        return eId === newEventObjectId.toString();
      });
      console.log('[COE_SERVICE] Verification after replacement (raw DB):', {
        foundReplacedEvent: !!replacedEvent,
        eventIdType: replacedEvent ? typeof replacedEvent.event_id : 'N/A',
        eventIdValue: replacedEvent ? replacedEvent.event_id?.toString() : 'N/A',
        eventIdIsObjectId: replacedEvent ? (replacedEvent.event_id instanceof mongoose.Types.ObjectId || replacedEvent.event_id.constructor.name === 'ObjectId') : false,
        allEventIds: verifyCoeDoc.events.map(e => ({
          id: e.event_id?.toString() || e.event_id,
          type: typeof e.event_id,
          isObjectId: e.event_id instanceof mongoose.Types.ObjectId || (e.event_id && e.event_id.constructor.name === 'ObjectId')
        }))
      });
      
      // Verify the event actually exists in the Event collection
      const eventExists = await Event.findById(newEventObjectId);
      console.log('[COE_SERVICE] Event exists check:', {
        eventId: newEventObjectId.toString(),
        exists: !!eventExists,
        eventName: eventExists?.name || 'NOT FOUND'
      });
    }
    
    // Force Mongoose to reload the document by finding it fresh
    // This ensures the reference is recognized
    await COE.findById(coeId); // This will cache the document structure
    
    // Return the updated COE
    // Use getCOEById which should handle population properly
    // The validation issue should be resolved since we've updated via native MongoDB
    let updatedCoe = await getCOEById(coeId);
    
    // Log the populated event to verify it's working
    if (updatedCoe && updatedCoe.events) {
      const populatedEvent = updatedCoe.events.find(e => {
        const eId = e.event_id?._id?.toString() || e.event_id?.toString() || e.event_id;
        return eId === newEventId.toString();
      });
      console.log('[COE_SERVICE] Populated event after replacement:', {
        found: !!populatedEvent,
        eventName: populatedEvent?.event_id?.name || 'NOT POPULATED',
        eventIdType: populatedEvent ? typeof populatedEvent.event_id : 'N/A',
        isObject: populatedEvent ? (typeof populatedEvent.event_id === 'object') : false,
        hasName: !!(populatedEvent?.event_id?.name),
        eventIdStructure: populatedEvent ? {
          has_id: !!populatedEvent.event_id?._id,
          has_name: !!populatedEvent.event_id?.name,
          keys: populatedEvent.event_id ? Object.keys(populatedEvent.event_id) : []
        } : null
      });
      
      // If event is not populated, try to manually populate it
      if (populatedEvent && !populatedEvent.event_id?.name) {
        console.warn('[COE_SERVICE] Event not populated, attempting manual population');
        const manualEvent = await Event.findById(newEventObjectId);
        if (manualEvent) {
          populatedEvent.event_id = manualEvent;
          console.log('[COE_SERVICE] Manually populated event:', manualEvent.name);
        }
      }
    }
    
    // Phase: COE Event Management – Regenerate seat upgrade offers after event replacement
    // Reuse seatUpgradeService.generateSeatUpgradeOffers to avoid logic duplication.
    try {
      if (updatedCoe && updatedCoe.status === 'draft') {
        console.log('[COE_SERVICE] Regenerating seat upgrade offers after event replacement for COE:', coeId);

        // Derive total budget and user preferences if available (bot-created COEs)
        const totalBudgetFromPrefs =
          updatedCoe.preferences?.budget?.max ||
          updatedCoe.preferences?.budget_range?.max ||
          null;
        const userPreferences = updatedCoe.preferences || {};

        // Reload raw COE document for upgrade generation
        const coeForUpgrades = await COE.findById(coeId);
        if (!coeForUpgrades) {
          console.warn('[COE_SERVICE] Regenerate upgrades: COE not found when reloading, skipping upgrade regeneration');
        } else if (coeForUpgrades.status === 'draft') {
          // Use isAdmin flag passed from route to determine upgrade generation behavior
          const upgradeOffers = await generateSeatUpgradeOffers(
            coeForUpgrades,
            totalBudgetFromPrefs,
            userPreferences,
            isAdmin
          );

          console.log('[COE_SERVICE] Regenerated seat upgrade offers after event replacement:', {
            totalOffers: upgradeOffers.length
          });

          // Overwrite seat_upgrade_offers with freshly generated offers
          coeForUpgrades.seat_upgrade_offers = upgradeOffers;
          await coeForUpgrades.save();

          // Reload COE again so callers receive the latest data including new upgrade offers
          updatedCoe = await getCOEById(coeId);
          console.log('[COE_SERVICE] COE after regenerating seat upgrade offers:', {
            coeId: updatedCoe?._id,
            seatUpgradeOffersCount: updatedCoe?.seat_upgrade_offers?.length || 0
          });
        } else {
          console.log('[COE_SERVICE] Skipping upgrade regeneration – reloaded COE is not in draft status');
        }
      } else {
        console.log('[COE_SERVICE] Skipping upgrade regeneration – updated COE is not in draft status');
      }
    } catch (upgradeError) {
      // Do not block event replacement if upgrade regeneration fails
      console.error('[COE_SERVICE] Error regenerating seat upgrade offers after event replacement:', upgradeError);
    }
    
    return updatedCoe;
  } catch (error) {
    console.error('Error replacing event in COE:', error);
    throw error;
  }
}

/**
 * Find alternative events for replacement
 * @param {string} coeId - COE ID
 * @param {string} eventId - Current event ID
 * @param {Object} filters - Filter criteria
 * @param {string} filters.city - Filter by city
 * @param {Date} filters.date_range_start - Start date for alternatives
 * @param {Date} filters.date_range_end - End date for alternatives
 * @param {number} filters.limit - Max number of alternatives (default: 10 for clients, 100 for admins)
 * @param {boolean} filters.isAdmin - Whether user is admin (affects limit and optimization)
 * @returns {Promise<Array>} List of alternative events
 */
async function findAlternativeEvents(coeId, eventId, filters = {}) {
  try {
    const { city, date_range_start, date_range_end, isAdmin = false } = filters;
    // For admins, show all events (higher limit), for clients keep default limit
    const limit = isAdmin ? (filters.limit || 100) : (filters.limit || 10);

    console.log('[COE_SERVICE] findAlternativeEvents called:', {
      coeId,
      eventId,
      filters,
      city,
      date_range_start,
      date_range_end,
      limit
    });

    // Get current event details
    const currentEvent = await Event.findById(eventId)
      .populate('location_id', 'name address city state country');
    
    if (!currentEvent) {
      throw new Error('Current event not found');
    }

    console.log('[COE_SERVICE] Current event:', {
      _id: currentEvent._id,
      name: currentEvent.name,
      start_datetime: currentEvent.start_datetime,
      end_datetime: currentEvent.end_datetime,
      location_city: currentEvent.location_id?.address?.city,
      location_name: currentEvent.location_id?.name
    });

    // Get COE to exclude events already in COE
    const coe = await COE.findById(coeId);
    if (!coe) {
      throw new Error('COE not found');
    }

    const existingEventIds = new Set();
    
    // Exclude events from selected_seats
    (coe.selected_seats || []).forEach(seat => {
      const eventIdStr = seat.event_id?.toString() || seat.event_id;
      if (eventIdStr) {
        existingEventIds.add(eventIdStr);
      }
    });
    
    // Also exclude events from coe.events array
    (coe.events || []).forEach(event => {
      const eventIdStr = event.event_id?.toString() || event.event_id;
      if (eventIdStr) {
        existingEventIds.add(eventIdStr);
      }
    });

    console.log('[COE_SERVICE] Existing event IDs in COE (from selected_seats and events):', Array.from(existingEventIds));

    // Build query
    // Universal restrictions: active status, not fully booked, exclude current event and events already in COE
    const query = {
      status: 'active',
      _id: { $ne: eventId, $nin: Array.from(existingEventIds) },
      // Universal restriction: exclude fully booked events
      total_available: { $gt: 0 }
    };

    // Add city filter - ALWAYS apply city restriction (universal restriction)
    // For admins: still respect city, but show ALL events in that city (no optimization)
    // For clients: city filter + optimization
    const targetCity = city || currentEvent.location_id?.address?.city;
    if (targetCity) {
      query['location_id.address.city'] = new RegExp(targetCity, 'i');
      console.log('[COE_SERVICE] City filter applied:', targetCity, 'isAdmin:', isAdmin);
    } else {
      console.log('[COE_SERVICE] No city filter applied - allowing events from any city');
    }

    // Add date range filter (use current event date ±7 days if not specified)
    // Use correct overlap logic: event overlaps if start_datetime <= endDate AND end_datetime >= startDate
    const now = new Date();
    let startDate = date_range_start;
    let endDate = date_range_end;

    if (!startDate || !endDate) {
      const currentEventDate = currentEvent.start_datetime ? new Date(currentEvent.start_datetime) : now;
      startDate = new Date(currentEventDate);
      startDate.setDate(startDate.getDate() - 7);
      endDate = new Date(currentEventDate);
      endDate.setDate(endDate.getDate() + 7);
    }

    // Use correct date overlap logic (same as botToolHandlers.js)
    // An event overlaps if: event.start_datetime <= endDate AND event.end_datetime >= startDate
    query.start_datetime = { $lte: endDate }; // Event starts before or at end of query range
    query.$and = [
      {
        // Event overlaps with query range: end_datetime >= startDate
        $or: [
          { end_datetime: { $gte: startDate } },
          { end_datetime: { $exists: false } },
          { end_datetime: null }
        ]
      },
      {
        // Exclude past events: end_datetime >= now
        $or: [
          { end_datetime: { $gte: now } },
          { end_datetime: { $exists: false } },
          { end_datetime: null }
        ]
      }
    ];

    console.log('[COE_SERVICE] Query built:', JSON.stringify(query, null, 2));
    console.log('[COE_SERVICE] Date range:', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      now: now.toISOString(),
      currentEventDate: currentEvent.start_datetime?.toISOString()
    });

    // Find alternative events
    // For admins: no optimization, just sort by date
    // For clients: current behavior (sorted by date, limited results)
    const alternatives = await Event.find(query)
      .populate('location_id', 'name address city state country media')
      .sort({ start_datetime: 1 })
      .limit(limit);
    
    console.log('[COE_SERVICE] findAlternativeEvents - Admin mode:', isAdmin, 'Limit:', limit);

    console.log('[COE_SERVICE] Raw alternatives found:', alternatives.length);
    console.log('[COE_SERVICE] Alternative events:', alternatives.map(e => ({
      _id: e._id,
      name: e.name,
      start_datetime: e.start_datetime,
      end_datetime: e.end_datetime,
      location_city: e.location_id?.address?.city,
      available_seats: (e.seats || []).filter(s => s.status === 'available').length
    })));

    // Format results and filter to only include events with available seats
    // Universal restriction: exclude fully booked events (total_available === 0)
    const results = alternatives
      .map(event => {
        const availableSeatsCount = (event.seats || []).filter(s => s.status === 'available').length;
        const totalAvailable = event.total_available || availableSeatsCount;
        const seatPrices = (event.seats || []).filter(s => s.status === 'available').map(s => s.event_price || s.base_price || 0);
        const minPrice = seatPrices.length > 0 ? Math.min(...seatPrices) : 0;
        const maxPrice = seatPrices.length > 0 ? Math.max(...seatPrices) : 0;

        return {
          _id: event._id,
          name: event.name,
          start_datetime: event.start_datetime,
          end_datetime: event.end_datetime,
          location: event.location_id,
          available_seats_count: availableSeatsCount,
          total_available: totalAvailable,
          price_range: {
            min: minPrice,
            max: maxPrice
          }
        };
      })
      .filter(event => {
        // Universal restriction: exclude fully booked events (both admin and client)
        return event.available_seats_count > 0 && event.total_available > 0;
      });

    console.log('[COE_SERVICE] Final results after filtering:', results.length);
    console.log('[COE_SERVICE] Results:', results.map(r => ({
      _id: r._id,
      name: r.name,
      start_datetime: r.start_datetime,
      available_seats_count: r.available_seats_count
    })));

    return results;
  } catch (error) {
    console.error('Error finding alternative events:', error);
    throw error;
  }
}

/**
 * Check if alternative events exist for a given event on the same day
 * @param {string} coeId - COE ID
 * @param {string} eventId - Event ID to check
 * @returns {Promise<boolean>} True if alternatives exist on the same day
 */
async function hasAlternativeEventsSameDay(coeId, eventId) {
  try {
    console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Starting check:', { coeId, eventId });
    
    // Normalize eventId to string for comparison
    const eventIdStr = eventId?.toString() || eventId;
    
    // Get current event to find its date
    const currentEvent = await Event.findById(eventIdStr);
    if (!currentEvent) {
      console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Current event not found:', eventIdStr);
      return false;
    }
    
    if (!currentEvent.start_datetime) {
      console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Current event has no start_datetime:', eventIdStr);
      return false;
    }

    // Normalize event date to YYYY-MM-DD
    const eventDate = new Date(currentEvent.start_datetime);
    const startOfDay = new Date(eventDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(eventDate);
    endOfDay.setHours(23, 59, 59, 999);

    console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Date range:', {
      eventDate: eventDate.toISOString(),
      startOfDay: startOfDay.toISOString(),
      endOfDay: endOfDay.toISOString()
    });

    // Get COE to exclude events already in COE
    const coe = await COE.findById(coeId);
    if (!coe) {
      console.log('[COE_SERVICE] hasAlternativeEventsSameDay - COE not found:', coeId);
      return false;
    }

    const existingEventIds = new Set();
    (coe.selected_seats || []).forEach(seat => {
      const seatEventIdStr = seat.event_id?.toString() || seat.event_id;
      if (seatEventIdStr) {
        existingEventIds.add(seatEventIdStr);
      }
    });
    (coe.events || []).forEach(event => {
      const eventIdStrFromCoe = event.event_id?.toString() || event.event_id;
      if (eventIdStrFromCoe) {
        existingEventIds.add(eventIdStrFromCoe);
      }
    });

    console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Excluding events:', {
      currentEventId: eventIdStr,
      existingEventIds: Array.from(existingEventIds),
      totalExcluded: existingEventIds.size + 1
    });

    // Build query for events on the same day
    const query = {
      status: 'active',
      _id: { $ne: eventIdStr, $nin: Array.from(existingEventIds) },
      start_datetime: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    };

    console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Query:', JSON.stringify(query, null, 2));

    // Check if events have available seats on the same day
    const sameDayEvents = await Event.find(query)
      .populate('location_id', 'name address')
      .limit(10);

    console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Found same-day events:', {
      count: sameDayEvents.length,
      eventIds: sameDayEvents.map(e => e._id.toString()),
      eventNames: sameDayEvents.map(e => e.name)
    });

    // Filter to only events with available seats
    const eventsWithSeats = sameDayEvents.filter(event => {
      const availableSeatsCount = (event.seats || []).filter(s => s.status === 'available').length;
      console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Event seat check:', {
        eventId: event._id.toString(),
        eventName: event.name,
        totalSeats: (event.seats || []).length,
        availableSeats: availableSeatsCount,
        hasAvailableSeats: availableSeatsCount > 0
      });
      return availableSeatsCount > 0;
    });

    console.log('[COE_SERVICE] hasAlternativeEventsSameDay - Final result:', {
      totalSameDayEvents: sameDayEvents.length,
      eventsWithAvailableSeats: eventsWithSeats.length,
      hasAlternatives: eventsWithSeats.length > 0,
      alternativeEventIds: eventsWithSeats.map(e => e._id.toString())
    });

    return eventsWithSeats.length > 0;
  } catch (error) {
    console.error('[COE_SERVICE] Error checking for same-day alternatives:', error);
    return false; // Default to false on error
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
  releaseSelectedSeats,
  acceptSeatUpgrade,
  removeEventsFromCOE,
  replaceEventInCOE,
  findAlternativeEvents,
  hasAlternativeEventsSameDay
};

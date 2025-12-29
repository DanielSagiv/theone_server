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
 * Filter selected_seats to only include seats matching events currently in the COE
 * This ensures seats from replaced events (if not fully cleaned from DB) are not returned
 * @param {Object} coe - COE object with events and selected_seats arrays
 * @param {string} logPrefix - Optional prefix for log messages (e.g., '[GET /coes/my]')
 * @returns {Object} COE object with filtered selected_seats array
 */
function filterSelectedSeatsByEvents(coe, logPrefix = '') {
  if (!coe.selected_seats || !Array.isArray(coe.selected_seats) || 
      !coe.events || !Array.isArray(coe.events)) {
    return coe;
  }

  // Extract valid event IDs from events array (source of truth)
  // Handle both populated (with _id) and non-populated event objects
  const validEventIds = new Set();
  coe.events.forEach(event => {
    const eventId = event.event_id?._id?.toString() || event.event_id?.toString() || event.event_id;
    if (eventId) {
      validEventIds.add(eventId);
    }
  });

  const originalSeatCount = coe.selected_seats.length;
  coe.selected_seats = coe.selected_seats.filter(seat => {
    const seatEventId = seat.event_id?.toString() || seat.event_id;
    const isValid = validEventIds.has(seatEventId);
    
    // Log warning only for detailed endpoint (includes seat details)
    if (!isValid && logPrefix.includes('/:id')) {
      console.warn(`${logPrefix} Filtering out seat from replaced event:`, {
        seat_code: seat.seat_code,
        seatEventId,
        validEventIds: Array.from(validEventIds)
      });
    }
    
    return isValid;
  });

  if (originalSeatCount !== coe.selected_seats.length) {
    const logMessage = logPrefix.includes('/:id') 
      ? `${logPrefix} Filtered selected_seats based on events array:`
      : `${logPrefix} Filtered selected_seats for COE:`;
    
    const logData = logPrefix.includes('/:id')
      ? {
          originalCount: originalSeatCount,
          filteredCount: coe.selected_seats.length,
          removed: originalSeatCount - coe.selected_seats.length,
          note: 'Removed seats from events not currently in COE (replaced events)'
        }
      : {
          coeId: coe._id,
          originalCount: originalSeatCount,
          filteredCount: coe.selected_seats.length,
          removed: originalSeatCount - coe.selected_seats.length
        };
    
    console.log(logMessage, logData);
  }

  return coe;
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
      'approved': ['pending_pay', 'paid', 'rejected', 'expired', 'cancelled'],
      'pending_pay': ['paid', 'rejected', 'expired', 'cancelled'],
      'paid': ['completed', 'cancelled'],
      'rejected': ['draft'],
      'expired': ['draft'],
      'completed': [],
      'cancelled': []
    };

    if (!validTransitions[coe.status]?.includes(status)) {
      throw new Error(`Invalid status transition from ${coe.status} to ${status}`);
    }

    const oldStatus = coe.status;
    await coe.updateStatus(status, updatedBy);
    
    // Handle seat status changes based on COE status
    if (status === 'paid') {
      // When COE is paid, seats become 'booked'
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
    
    // Send notifications for status changes
    try {
      const notificationService = require('./notificationService');
      const updatedCoe = await getCOEById(coeId);
      const User = require('../models/User');
      
      // Get user info for notifications
      // CRITICAL: Extract user IDs properly - handle both populated and non-populated cases
      const clientId = updatedCoe.client_id?._id 
        ? updatedCoe.client_id._id.toString() 
        : (updatedCoe.client_id?.toString ? updatedCoe.client_id.toString() : String(updatedCoe.client_id));
      const adminId = updatedCoe.admin_id?._id 
        ? updatedCoe.admin_id._id.toString() 
        : (updatedCoe.admin_id?.toString ? updatedCoe.admin_id.toString() : String(updatedCoe.admin_id));
      
      const client = await User.findById(clientId).select('firstName lastName');
      const admin = await User.findById(adminId).select('firstName lastName');
      
      // Determine notification recipients and types
      const notifications = [];
      
      switch (status) {
        case 'approved':
          // Notify client
          notifications.push({
            userId: clientId,
            type: 'coe_approved',
            data: {
              coe_id: coeId,
              coe: { name: updatedCoe.name },
              is_admin: false
            }
          });
          break;
          
        case 'accepted':
          // Notify admin
          notifications.push({
            userId: adminId,
            type: 'coe_accepted',
            data: {
              coe_id: coeId,
              coe: { name: updatedCoe.name },
              sender_name: client ? `${client.firstName} ${client.lastName}`.trim() : 'Client',
              is_admin: true
            }
          });
          break;
          
        case 'rejected':
          // Notify admin
          notifications.push({
            userId: adminId,
            type: 'coe_rejected',
            data: {
              coe_id: coeId,
              coe: { name: updatedCoe.name },
              sender_name: client ? `${client.firstName} ${client.lastName}`.trim() : 'Client',
              is_admin: true
            }
          });
          break;
          
        case 'paid':
          // Notify both client and admin
          notifications.push(
            {
              userId: clientId,
              type: 'coe_paid',
              data: {
                coe_id: coeId,
                coe: { name: updatedCoe.name },
                is_admin: false
              }
            },
            {
              userId: adminId,
              type: 'coe_paid',
              data: {
                coe_id: coeId,
                coe: { name: updatedCoe.name },
                is_admin: true
              }
            }
          );
          break;
          
        case 'completed':
          // Notify both client and admin
          notifications.push(
            {
              userId: clientId,
              type: 'coe_completed',
              data: {
                coe_id: coeId,
                coe: { name: updatedCoe.name },
                is_admin: false
              }
            },
            {
              userId: adminId,
              type: 'coe_completed',
              data: {
                coe_id: coeId,
                coe: { name: updatedCoe.name },
                is_admin: true
              }
            }
          );
          break;
          
        case 'cancelled':
          // Notify both client and admin
          notifications.push(
            {
              userId: clientId,
              type: 'coe_cancelled',
              data: {
                coe_id: coeId,
                coe: { name: updatedCoe.name },
                is_admin: false
              }
            },
            {
              userId: adminId,
              type: 'coe_cancelled',
              data: {
                coe_id: coeId,
                coe: { name: updatedCoe.name },
                is_admin: true
              }
            }
          );
          break;
          
        case 'expired':
          // Notify both client and admin
          notifications.push(
            {
              userId: clientId,
              type: 'coe_expired',
              data: {
                coe_id: coeId,
                coe: { name: updatedCoe.name },
                is_admin: false
              }
            },
            {
              userId: adminId,
              type: 'coe_expired',
              data: {
                coe_id: coeId,
                coe: { name: updatedCoe.name },
                is_admin: true
              }
            }
          );
          break;
      }
      
      // Send notifications asynchronously (don't block status update)
      Promise.all(
        notifications.map(notif => 
          notificationService.createAndSendNotification(notif.userId, notif.type, notif.data)
            .catch(err => console.error(`[COEService] Failed to send notification to ${notif.userId}:`, err))
        )
      );
    } catch (error) {
      // Log but don't fail the status update if notifications fail
      console.error('[COEService] Error sending notifications:', error);
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
    
    // Send notification to runner
    try {
      const notificationService = require('./notificationService');
      const updatedCoe = await getCOEById(coeId);
      
      await notificationService.createAndSendNotification(
        runnerData.runner_id.toString(),
        'runner_assigned',
        {
          coe_id: coeId,
          coe: { name: updatedCoe.name }
        }
      );
    } catch (error) {
      // Log but don't fail the assignment if notification fails
      console.error('[COEService] Error sending runner assignment notification:', error);
    }
    
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

    // Normalize event IDs early for logging
    const oldEventIdStr = oldEventId.toString();
    const newEventIdStr = newEventId.toString();

    console.log('[COE_SERVICE] ===== REPLACE EVENT START =====');
    console.log('[COE_SERVICE] Replace event params:', {
      coeId,
      oldEventId: oldEventIdStr,
      newEventId: newEventIdStr,
      preserve_seats,
      has_seat_preferences: !!(seat_preferences && Object.keys(seat_preferences).length > 0),
      isAdmin
    });
    console.log('[COE_SERVICE] COE initial state:', {
      status: coe.status,
      eventsCount: coe.events?.length || 0,
      eventIds: (coe.events || []).map(e => e.event_id?.toString() || e.event_id),
      seatsCount: coe.selected_seats?.length || 0,
      seatEventIds: [...new Set((coe.selected_seats || []).map(s => s.event_id?.toString() || s.event_id))],
      currentSubtotal: coe.subtotal || 0,
      currentTotal: coe.total || 0
    });

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
    
    // Calculate budget being released from old event seats
    // This budget will be available for seat selection in the new event
    const oldEventBudget = oldSeatsBeforeRemoval.reduce((sum, seat) => {
      return sum + (seat.event_price || seat.base_price || 0);
    }, 0);
    
    console.log('[COE_SERVICE] ===== OLD EVENT SEATS ANALYSIS =====');
    console.log('[COE_SERVICE] Old event seats being removed:', {
      oldEventId: oldEventIdStr,
      oldSeatsCount: oldSeatsBeforeRemoval.length,
      oldSeats: oldSeatsBeforeRemoval.map(s => ({
        seat_code: s.seat_code,
        event_price: s.event_price || 0,
        base_price: s.base_price || 0,
        price_used: s.event_price || s.base_price || 0
      })),
      oldEventBudget
    });
    
    // Release old seats back to inventory before removing them
    if (oldSeatsBeforeRemoval.length > 0) {
      try {
        // Use the same bulkWrite pattern as updateSelectedSeatsStatus, but to release seats
        const releaseOps = oldSeatsBeforeRemoval.map(seatData => ({
          updateOne: {
            filter: { '_id': seatData.event_id, 'seats._id': seatData.seat_id },
            update: {
              $set: {
                'seats.$.status': 'available',
                'seats.$.booking_reference': undefined,
                'seats.$.booked_at': undefined,
                'seats.$.booked_by': undefined
              }
            }
          }
        }));

        if (releaseOps.length > 0) {
          await Event.bulkWrite(releaseOps);
          console.log('[COE_SERVICE] Released', oldSeatsBeforeRemoval.length, 'seats from old event back to inventory');
        }
      } catch (releaseError) {
        // Log but don't fail - seats are still removed from COE
        console.error('[COE_SERVICE] Error releasing old seats:', releaseError);
      }
    }
    
    // Remove old seats and upgrade offers for the old event from database
    // Use MongoDB $pull to actually remove them from the database
    try {
      // Convert oldEventIdStr to ObjectId for MongoDB query
      const oldEventObjectIdForPull = mongoose.Types.ObjectId.isValid(oldEventIdStr)
        ? new mongoose.Types.ObjectId(oldEventIdStr)
        : oldEventIdStr;
      
      await coesCollection.updateOne(
        { _id: coeObjectId },
        {
          $pull: {
            selected_seats: { event_id: oldEventObjectIdForPull },
            seat_upgrade_offers: { event_id: oldEventObjectIdForPull }
          }
        }
      );
      console.log('[COE_SERVICE] Removed old seats and upgrade offers from database for event:', oldEventIdStr);
    } catch (pullError) {
      console.error('[COE_SERVICE] Error removing old seats/offers from database:', pullError);
      // Continue - seats removal is not critical if it fails
    }
    
    // Also update in-memory object for consistency (used in calculations later)
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
    
    console.log('[COE_SERVICE] ===== REPLACING EVENT IN EVENTS ARRAY =====');
    console.log('[COE_SERVICE] Replacement details:', {
      oldEventIndex,
      oldEventId: oldEventIdStr,
      newEventId: newEventIdStr,
      newEventEntryForDB: {
        event_id: newEventEntryForDB.event_id?.toString() || newEventEntryForDB.event_id,
        sequence: newEventEntryForDB.sequence,
        base_price: newEventEntryForDB.base_price,
        total_price: newEventEntryForDB.total_price
      },
      oldEventObjectId: oldEventObjectId.toString(),
      eventsArrayBeforeReplace: (coe.events || []).map(e => ({
        event_id: e.event_id?.toString() || e.event_id,
        sequence: e.sequence
      }))
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
          modified: updateResult.modifiedCount,
          oldEventId: oldEventIdStr,
          newEventId: newEventIdStr
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
    console.log('[COE_SERVICE] ===== VERIFICATION AFTER EVENT REPLACEMENT =====');
    if (verifyCoeRaw && verifyCoeRaw.events) {
      // Verify OLD event is NOT in the array (this is critical for alternatives to work)
      const oldEventStillPresent = verifyCoeRaw.events.find(e => {
        const eId = e.event_id?.toString() || e.event_id;
        return eId === oldEventIdStr;
      });
      
      // Verify NEW event IS in the array
      const replacedEventRaw = verifyCoeRaw.events.find(e => {
        const eId = e.event_id?.toString() || e.event_id;
        return eId === finalEventObjectId.toString();
      });
      
      console.log('[COE_SERVICE] Raw DB check after replacement:', {
        oldEventId: oldEventIdStr,
        newEventId: newEventIdStr,
        oldEventRemoved: !oldEventStillPresent,
        oldEventStillPresent: !!oldEventStillPresent,
        newEventFound: !!replacedEventRaw,
        allEventIdsInArray: verifyCoeRaw.events.map(e => e.event_id?.toString() || e.event_id),
        eventsCount: verifyCoeRaw.events.length,
        eventIdType: replacedEventRaw ? typeof replacedEventRaw.event_id : 'N/A',
        eventIdConstructor: replacedEventRaw ? replacedEventRaw.event_id?.constructor?.name : 'N/A',
        eventIdValue: replacedEventRaw ? replacedEventRaw.event_id?.toString() : 'N/A',
        eventsArray: verifyCoeRaw.events.map(e => ({
          event_id: e.event_id?.toString() || e.event_id,
          sequence: e.sequence,
          base_price: e.base_price,
          total_price: e.total_price
        }))
      });
      
      // CRITICAL: If old event is still in the array, explicitly remove it
      // This ensures event A will be available as an alternative after replacement
      if (oldEventStillPresent) {
        console.warn('[COE_SERVICE] ⚠️ Old event still present after $set replacement! Removing it explicitly...');
        const oldEventObjectIdForPull = mongoose.Types.ObjectId.isValid(oldEventIdStr)
          ? new mongoose.Types.ObjectId(oldEventIdStr)
          : oldEventIdStr;
        
        const pullResult = await coesCollection.updateOne(
          { _id: coeObjectId },
          {
            $pull: {
              events: { event_id: oldEventObjectIdForPull }
            }
          }
        );
        console.log('[COE_SERVICE] ===== EXPLICIT OLD EVENT REMOVAL =====');
        console.log('[COE_SERVICE] Explicitly removed old event from events array:', {
          matched: pullResult.matchedCount,
          modified: pullResult.modifiedCount,
          oldEventId: oldEventIdStr,
          oldEventIdType: typeof oldEventIdStr,
          eventsArrayBeforePull: verifyCoeRaw.events.map(e => e.event_id?.toString() || e.event_id)
        });
        
        // Verify it's actually gone
        const verifyAfterPull = await coesCollection.findOne({ _id: coeObjectId });
        const stillPresent = verifyAfterPull?.events?.find(e => {
          const eId = e.event_id?.toString() || e.event_id;
          return eId === oldEventIdStr;
        });
        console.log('[COE_SERVICE] Verification after explicit $pull:', {
          oldEventStillPresent: !!stillPresent,
          eventsArrayAfterPull: verifyAfterPull?.events?.map(e => e.event_id?.toString() || e.event_id) || []
        });
      }
    }
    
    // Now check using Mongoose - reload fresh to verify
    const verifyCoe = await coesCollection.findOne({ _id: coeObjectId });
    const hasNewEventAfterSave = verifyCoe?.events?.some(event => {
      const eventId = normalizeEventIdForComparison(event.event_id);
      return eventId === normalizedNewEventId;
    });
    const hasOldEventAfterSave = verifyCoe?.events?.some(event => {
      const eventId = normalizeEventIdForComparison(event.event_id);
      return eventId === normalizedOldEventId;
    });
    console.log('[COE_SERVICE] Verification after replacement (raw DB):', {
      hasNewEvent: hasNewEventAfterSave,
      hasOldEvent: hasOldEventAfterSave,
      eventsCount: verifyCoe?.events?.length || 0,
      eventIds: verifyCoe?.events?.map(e => e.event_id?.toString() || e.event_id) || []
    });

    // If the replacement didn't work, use direct MongoDB update
    if (!hasNewEventAfterSave || hasOldEventAfterSave) {
      console.log('[COE_SERVICE] Mongoose save() did not persist the replacement, using direct MongoDB update');
      
      // First, remove the old event if it still exists (CRITICAL: use native MongoDB for reliability)
      if (hasOldEventAfterSave) {
        const oldEventObjectIdForPull = mongoose.Types.ObjectId.isValid(oldEventIdStr)
          ? new mongoose.Types.ObjectId(oldEventIdStr)
          : oldEventIdStr;
        
        const pullResult = await coesCollection.updateOne(
          { _id: coeObjectId },
          {
            $pull: {
              events: { event_id: oldEventObjectIdForPull }
            }
          }
        );
        console.log('[COE_SERVICE] Removed old event using native MongoDB $pull:', {
          oldEventId: oldEventIdStr,
          matched: pullResult.matchedCount,
          modified: pullResult.modifiedCount
        });
      }
      
      // Then add the new event if it's not there (use native MongoDB for reliability)
      if (!hasNewEventAfterSave) {
        const pushResult = await coesCollection.updateOne(
          { _id: coeObjectId },
          {
            $push: { events: newEventEntryForDB }
          }
        );
        console.log('[COE_SERVICE] Added new event using native MongoDB $push:', {
          matched: pushResult.matchedCount,
          modified: pushResult.modifiedCount
        });
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
    } else {
      // Fallback: Try to use COE preferences if available (for bot-created COEs)
      // This allows auto-selection when mobile app doesn't send preferences
      try {
        // CRITICAL: Reload COE from database AFTER removing old seats to get current state
        // This ensures we calculate the budget based on the actual current subtotal
        const coeForBudgetCalc = await coesCollection.findOne({ _id: coeObjectId });
        
        if (!coeForBudgetCalc) {
          throw new Error('COE not found for budget calculation');
        }
        
        // Calculate current subtotal from actual seats in database (excluding old event seats)
        const currentSeatsForBudget = (coeForBudgetCalc.selected_seats || []).filter(seat => {
          const seatEventId = seat.event_id?.toString() || seat.event_id;
          return seatEventId !== oldEventIdStr; // Exclude old event seats
        });
        const currentSubtotalFromSeats = currentSeatsForBudget.reduce((sum, s) => {
          return sum + (s.event_price || s.base_price || 0);
        }, 0);
        
        console.log('[COE_SERVICE] ===== BUDGET CALCULATION DETAILED =====');
        console.log('[COE_SERVICE] Budget calc - DB state after removing old seats:', {
          totalSeatsInDB: coeForBudgetCalc.selected_seats?.length || 0,
          seatsAfterFilteringOld: currentSeatsForBudget.length,
          seatsByEvent: currentSeatsForBudget.reduce((acc, s) => {
            const eid = s.event_id?.toString() || s.event_id;
            if (!acc[eid]) acc[eid] = { count: 0, total: 0 };
            acc[eid].count++;
            acc[eid].total += (s.event_price || s.base_price || 0);
            return acc;
          }, {}),
          currentSubtotalFromSeats,
          storedSubtotal: coeForBudgetCalc.subtotal || 0,
          oldEventBudget
        });
        
        let preferencesToUse = null;
        let availableBudget = null;
        
        // Try to get preferences from the COE (if stored)
        const coeWithPrefs = coeForBudgetCalc.preferences ? {
          preferences: coeForBudgetCalc.preferences
        } : await COE.findById(coeId).select('preferences').lean();
        
        if (coeWithPrefs && coeWithPrefs.preferences) {
          // Extract party_size and original budget from COE preferences
          const partySize = coeWithPrefs.preferences.party_size || 2;
          const originalBudget = coeWithPrefs.preferences.budget?.max || 
                                 coeWithPrefs.preferences.budget_range?.max || 
                                 null;
          
          // Calculate available budget for new event
          // Available = Original budget - Current subtotal (calculated from seats) + Old event budget
          // This ensures we use the actual current subtotal, not a stale stored value
          if (originalBudget !== null && oldEventBudget !== undefined) {
            availableBudget = originalBudget - currentSubtotalFromSeats + oldEventBudget;
            console.log('[COE_SERVICE] Budget calculation formula:', {
              formula: 'availableBudget = originalBudget - currentSubtotalFromSeats + oldEventBudget',
              originalBudget,
              currentSubtotalFromSeats,
              oldEventBudget,
              calculation: `${originalBudget} - ${currentSubtotalFromSeats} + ${oldEventBudget}`,
              availableBudget,
              storedSubtotal: coeForBudgetCalc.subtotal || 0,
              difference: (coeForBudgetCalc.subtotal || 0) - currentSubtotalFromSeats
            });
          } else if (oldEventBudget > 0) {
            // If no original budget, use at least the old event budget (minimum)
            availableBudget = oldEventBudget;
            console.log('[COE_SERVICE] No original budget found, using old event budget:', availableBudget);
          }
          
          // Build preferences object for seat selection
          preferencesToUse = {
            party_size: partySize,
            budget: availableBudget ? { max: availableBudget } : null,
            ...coeWithPrefs.preferences
          };
          
          console.log('[COE_SERVICE] Using COE preferences for seat selection:', {
            partySize,
            availableBudget,
            originalBudget: originalBudget || 'not set',
            hasPreferences: !!coeWithPrefs.preferences
          });
        } else {
          // Default fallback: use old event budget if available, otherwise no limit
          availableBudget = oldEventBudget > 0 ? oldEventBudget : null;
          
          preferencesToUse = {
            party_size: 2,
            budget: availableBudget ? { max: availableBudget } : null
          };
          
          console.log('[COE_SERVICE] No COE preferences found, using defaults with released budget:', {
            partySize: 2,
            availableBudget
          });
        }
        
        if (preferencesToUse) {
          // Use existing seat selection logic
          const seatResult = await selectSeatsByBudgetAndCapacity(
            newEvent,
            preferencesToUse,
            preferencesToUse.budget?.max || null
          );

          // Handle both old format (array) and new format (object with seats/diagnostics)
          const autoSeats = Array.isArray(seatResult) ? seatResult : (seatResult.seats || []);
          
          if (autoSeats.length > 0) {
            newSeats = autoSeats.map(seat => ({
              event_id: newEventId,
              seat_id: seat.seat_id || seat._id,
              seat_code: seat.seat_code || seat.code,
              capacity: seat.capacity,
              base_price: seat.base_price,
              event_price: seat.event_price || seat.base_price,
              available_from: seat.available_from || newEvent.start_datetime || new Date(),
              available_until: seat.available_until || newEvent.end_datetime || null,
              status: seat.status || 'selected'
            }));
            
            console.log('[COE_SERVICE] Auto-selected seats:', {
              seatsCount: newSeats.length,
              partySize: preferencesToUse.party_size,
              budget: preferencesToUse.budget?.max,
              usedCOEPreferences: !!(coeWithPrefs && coeWithPrefs.preferences)
            });
          } else {
            console.warn('[COE_SERVICE] No seats found by selectSeatsByBudgetAndCapacity:', {
              eventId: newEventId,
              eventName: newEvent.name,
              totalSeatsInEvent: newEvent.seats?.length || 0,
              availableSeatsCount: newEvent.seats?.filter(s => s.status === 'available')?.length || 0,
              preferences: preferencesToUse,
              diagnostics: seatResult.diagnostics || null
            });
          }
        }
      } catch (prefError) {
        // Don't fail event replacement if preference lookup fails
        console.error('[COE_SERVICE] Error in seat selection fallback:', prefError);
      }
    }

    // CRITICAL FALLBACK: If no seats were selected by any method above, select any available seat
    // This ensures events always get seats if any are available in inventory, regardless of budget constraints
    if (newSeats.length === 0 && newEvent.seats && Array.isArray(newEvent.seats)) {
      const availableSeats = newEvent.seats.filter(s => s.status === 'available');
      
      if (availableSeats.length > 0) {
        // Get party size from COE preferences or default to 2
        let partySize = 2;
        try {
          const coeWithPrefs = await COE.findById(coeId).select('preferences').lean();
          if (coeWithPrefs?.preferences?.party_size) {
            partySize = coeWithPrefs.preferences.party_size;
          }
        } catch (prefError) {
          // Use default if preferences can't be loaded
        }
        
        // Select the first available seat(s) that meets capacity requirements
        let seatsSelected = 0;
        let totalCapacity = 0;
        
        for (const seat of availableSeats) {
          if (totalCapacity >= partySize) break;
          
          const seatCapacity = seat.capacity || 1;
          newSeats.push({
            event_id: newEventId,
            seat_id: seat._id,
            seat_code: seat.code,
            capacity: seatCapacity,
            base_price: seat.base_price || 0,
            event_price: seat.event_price || seat.base_price || 0,
            available_from: newEvent.start_datetime || new Date(),
            available_until: newEvent.end_datetime || null,
            status: 'selected'
          });
          
          seatsSelected++;
          totalCapacity += seatCapacity;
        }
        
        console.log('[COE_SERVICE] ✅ FALLBACK: Selected available seats without budget constraints:', {
          eventId: newEventId,
          eventName: newEvent.name,
          seatsSelected,
          totalCapacity,
          partySize,
          note: 'Used fallback selection because budget-based selection returned no seats'
        });
      } else {
        console.warn('[COE_SERVICE] ⚠️ No available seats found for fallback selection:', {
          eventId: newEventId,
          eventName: newEvent.name,
          totalSeatsInEvent: newEvent.seats?.length || 0,
          note: 'Event will be added to COE without seats'
        });
      }
    }

    // CRITICAL FIX: Remove any existing seats for the new event BEFORE adding new ones
    // This prevents accumulation of costs when replacing events (e.g., A->B->A scenario)
    // If event A was previously in COE and we're replacing back to A, old A seats must be removed first
    if (newSeats.length > 0) {
      const newEventObjectIdForPull = mongoose.Types.ObjectId.isValid(newEventIdStr)
        ? new mongoose.Types.ObjectId(newEventIdStr)
        : newEventIdStr;
      
      // Remove any existing seats for the new event to prevent accumulation
      const removeNewEventSeatsResult = await coesCollection.updateOne(
        { _id: coeObjectId },
        {
          $pull: {
            selected_seats: { event_id: newEventObjectIdForPull }
          }
        }
      );
      
      if (removeNewEventSeatsResult.modifiedCount > 0) {
        console.log('[COE_SERVICE] Removed existing seats for new event before adding new seats:', {
          newEventId: newEventIdStr,
          removedCount: removeNewEventSeatsResult.modifiedCount,
          note: 'This prevents cost accumulation when replacing back to a previously used event'
        });
      }
      
      // Now add new seats
      await coesCollection.updateOne(
        { _id: coeObjectId },
        {
          $push: {
            selected_seats: { $each: newSeats }
          }
        }
      );
      console.log('[COE_SERVICE] Added new seats using native MongoDB');
      console.log('[COE_SERVICE] New seats added:', {
        count: newSeats.length,
        seats: newSeats.map(s => ({
          event_id: s.event_id?.toString() || s.event_id,
          seat_code: s.seat_code,
          event_price: s.event_price || 0,
          base_price: s.base_price || 0,
          price_used: s.event_price || s.base_price || 0
        })),
        totalPrice: newSeats.reduce((sum, s) => sum + (s.event_price || s.base_price || 0), 0)
      });
      
      // Hold new seats using existing updateSelectedSeatsStatus function
      try {
        await updateSelectedSeatsStatus(newSeats, coeId, 'held');
        console.log('[COE_SERVICE] Held', newSeats.length, 'new seats for replaced event');
      } catch (holdError) {
        console.error('[COE_SERVICE] Error holding new seats:', holdError);
        // Don't fail the replacement, but log the error
      }
    }

    // CRITICAL: Reload COE from database after all MongoDB operations (especially after multiple replacements)
    // This ensures we have the latest state with all seats properly removed/added
    let coeForCostCalculation = await coesCollection.findOne({ _id: coeObjectId });
    
    if (!coeForCostCalculation) {
      throw new Error('COE not found after seat updates');
    }

    // CRITICAL FIX: Calculate costs based on seats that match events currently in the COE's events array
    // This ensures correct calculation after multiple replacements
    // Use events array as source of truth, not just filtering out the current old event
    
    // Extract valid event IDs from the events array (source of truth)
    const validEventIds = new Set();
    (coeForCostCalculation.events || []).forEach(event => {
      const eventIdStr = normalizeEventIdForComparison(event.event_id);
      if (eventIdStr) {
        validEventIds.add(eventIdStr);
      }
    });

    console.log('[COE_SERVICE] ===== FINAL COST CALCULATION =====');
    console.log('[COE_SERVICE] Valid event IDs from events array:', {
      validEventIds: Array.from(validEventIds),
      eventsCount: coeForCostCalculation.events?.length || 0,
      allEventIds: (coeForCostCalculation.events || []).map(e => ({
        event_id: e.event_id?.toString() || e.event_id,
        sequence: e.sequence
      })),
      totalSeatsInDBBeforeCleanup: coeForCostCalculation.selected_seats?.length || 0,
      allSeatEventIdsBeforeCleanup: [...new Set((coeForCostCalculation.selected_seats || []).map(s => normalizeEventIdForComparison(s.event_id)))]
    });

    // CRITICAL CLEANUP: Remove ALL orphaned seats from database BEFORE calculating costs
    // Orphaned seats = seats whose event_id does NOT exist in the COE's events array
    // This MUST happen before cost calculation to prevent accumulation
    // Use the most direct approach: filter seats array in memory, then replace the entire array
    const seatsBeforeCleanup = coeForCostCalculation.selected_seats || [];
    const validSeats = seatsBeforeCleanup.filter(seat => {
      const seatEventId = normalizeEventIdForComparison(seat.event_id);
      const isValid = validEventIds.has(seatEventId);
      if (!isValid) {
        console.warn('[COE_SERVICE] Found orphaned seat (event not in COE):', {
          seat_code: seat.seat_code,
          seatEventId,
          validEventIds: Array.from(validEventIds),
          price: seat.event_price || seat.base_price || 0
        });
      }
      return isValid;
    });

    if (validSeats.length !== seatsBeforeCleanup.length) {
      const seatsRemoved = seatsBeforeCleanup.length - validSeats.length;
      console.log('[COE_SERVICE] 🧹 CLEANUP: Removing orphaned seats BEFORE cost calculation:', {
        totalSeatsBefore: seatsBeforeCleanup.length,
        validSeatsAfter: validSeats.length,
        seatsToRemove: seatsRemoved,
        orphanedSeats: seatsBeforeCleanup.filter(s => {
          const eid = normalizeEventIdForComparison(s.event_id);
          return !validEventIds.has(eid);
        }).map(s => ({
          event_id: s.event_id?.toString() || s.event_id,
          seat_code: s.seat_code,
          price: s.event_price || s.base_price || 0
        }))
      });

      // CRITICAL: Replace the entire selected_seats array with only valid seats
      // This is the most reliable way to ensure orphaned seats are removed regardless of ID format issues
      const replaceResult = await coesCollection.updateOne(
        { _id: coeObjectId },
        {
          $set: {
            selected_seats: validSeats
          }
        }
      );

      console.log('[COE_SERVICE] ✅ Cleanup result (direct array replacement):', {
        matched: replaceResult.matchedCount,
        modified: replaceResult.modifiedCount,
        seatsBefore: seatsBeforeCleanup.length,
        seatsAfter: validSeats.length,
        removed: seatsRemoved
      });

      // CRITICAL: Reload COE after cleanup to get absolutely clean state for cost calculation
      coeForCostCalculation = await coesCollection.findOne({ _id: coeObjectId });
      if (!coeForCostCalculation) {
        throw new Error('COE not found after cleanup');
      }
      console.log('[COE_SERVICE] ✅ Reloaded COE after cleanup:', {
        seatsBeforeCleanup: seatsBeforeCleanup.length,
        seatsAfterCleanup: coeForCostCalculation.selected_seats?.length || 0,
        removed: seatsBeforeCleanup.length - (coeForCostCalculation.selected_seats?.length || 0),
        expectedRemoved: seatsRemoved
      });
    } else {
      console.log('[COE_SERVICE] ✅ No orphaned seats found - all seats match current events');
    }
    
    // Now calculate costs from the clean seat data
    // Filter seats to only include those matching events currently in the COE
    // This is a safety check - seats should already be clean from cleanup above
    const allSeats = (coeForCostCalculation.selected_seats || []).filter(seat => {
      const seatEventId = normalizeEventIdForComparison(seat.event_id);
      const isValid = validEventIds.has(seatEventId);
      
      if (!isValid) {
        console.warn('[COE_SERVICE] ⚠️ WARNING: Found invalid seat after cleanup (this should not happen):', {
          seat_code: seat.seat_code,
          seatEventId,
          seat_price: seat.event_price || seat.base_price || 0,
          validEventIds: Array.from(validEventIds)
        });
      }
      
      return isValid;
    });
    
    console.log('[COE_SERVICE] Cost calc - DB state after all operations:', {
      totalSeatsInDB: coeForCostCalculation.selected_seats?.length || 0,
      allSeatsInDB: (coeForCostCalculation.selected_seats || []).map(s => ({
        event_id: s.event_id?.toString() || s.event_id,
        seat_code: s.seat_code,
        event_price: s.event_price || 0,
        base_price: s.base_price || 0,
        price_used: s.event_price || s.base_price || 0
      })),
      seatsAfterFilteringByEventsArray: allSeats.length,
      seatsByEvent: allSeats.reduce((acc, s) => {
        const eid = s.event_id?.toString() || s.event_id;
        if (!acc[eid]) acc[eid] = { count: 0, total: 0, seats: [] };
        acc[eid].count++;
        const price = s.event_price || s.base_price || 0;
        acc[eid].total += price;
        acc[eid].seats.push({ seat_code: s.seat_code, price });
        return acc;
      }, {}),
      newSeatsAdded: newSeats.length,
      oldEventId: oldEventIdStr,
      oldEventBudget,
      note: 'Cost calculation based on events array. Seats from replaced events (not in events array) are excluded.'
    });
    
    // CRITICAL: Calculate subtotal ONLY from filtered seats (seats matching current events)
    // This ensures we never accumulate costs from replaced events
    const newSubtotal = allSeats.reduce((sum, s) => {
      const price = s.event_price || s.base_price || 0;
      console.log('[COE_SERVICE] Adding to subtotal:', {
        seat_code: s.seat_code,
        event_id: s.event_id?.toString() || s.event_id,
        price,
        runningSum: sum + price
      });
      return sum + price;
    }, 0);
    const newTotal = newSubtotal + (coeForCostCalculation.taxes || 0) + (coeForCostCalculation.fees || 0);
    
    console.log('[COE_SERVICE] ===== FINAL COST CALCULATION SUMMARY =====');
    console.log('[COE_SERVICE] Final totals:', {
      newSubtotal,
      newTotal,
      previousSubtotal: coeForCostCalculation.subtotal || 0,
      previousTotal: coeForCostCalculation.total || 0,
      taxes: coeForCostCalculation.taxes || 0,
      fees: coeForCostCalculation.fees || 0,
      calculationBreakdown: {
        allSeatsCount: allSeats.length,
        allSeatsDetails: allSeats.map(s => ({
          event_id: s.event_id?.toString() || s.event_id,
          seat_code: s.seat_code,
          price: s.event_price || s.base_price || 0
        })),
        seatPrices: allSeats.map(s => s.event_price || s.base_price || 0),
        calculatedSubtotal: newSubtotal,
        note: 'CRITICAL: This calculation ONLY includes seats from events currently in the COE events array. Seats from replaced events are excluded.'
      }
    });
    
    // Verification: Ensure we're not including any seats from replaced events
    const allSeatEventIds = [...new Set(allSeats.map(s => normalizeEventIdForComparison(s.event_id)))];
    const invalidSeatEventIds = allSeatEventIds.filter(eid => !validEventIds.has(eid));
    if (invalidSeatEventIds.length > 0) {
      console.error('[COE_SERVICE] ⚠️ ERROR: Found seats from invalid events in calculation!', {
        invalidEventIds: invalidSeatEventIds,
        validEventIds: Array.from(validEventIds)
      });
    } else {
      console.log('[COE_SERVICE] ✅ Verification passed: All seats in calculation match valid events');
    }
    
    // Also recalculate the event's base_price and total_price based on selected seats for this event
    const eventSeatsTotal = allSeats
      .filter(seat => {
        const seatEventId = seat.event_id?.toString() || seat.event_id;
        return seatEventId === newEventId.toString();
      })
      .reduce((sum, s) => sum + (s.event_price || s.base_price || 0), 0);
    
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
    const updateResult = await coesCollection.updateOne(
      { _id: coeObjectId },
      {
        $set: {
          subtotal: newSubtotal,
          total: newTotal
        }
      }
    );
    
    console.log('[COE_SERVICE] Updated totals and event pricing using native MongoDB:', {
      updateResult: {
        matched: updateResult.matchedCount,
        modified: updateResult.modifiedCount
      },
      newSubtotal,
      newTotal,
      eventSeatsTotal,
      seatsCount: allSeats.length
    });

    // Verify the update was successful
    const verifyTotals = await coesCollection.findOne({ _id: coeObjectId });
    if (verifyTotals) {
      console.log('[COE_SERVICE] Verification of saved totals:', {
        savedSubtotal: verifyTotals.subtotal || 0,
        savedTotal: verifyTotals.total || 0,
        expectedSubtotal: newSubtotal,
        expectedTotal: newTotal,
        match: verifyTotals.subtotal === newSubtotal && verifyTotals.total === newTotal
      });
      
      if (verifyTotals.subtotal !== newSubtotal || verifyTotals.total !== newTotal) {
        console.error('[COE_SERVICE] ⚠️ WARNING: Saved totals do not match calculated totals!');
      }
    }

    // Update event coe_count (decrement old, increment new)
    await Event.findByIdAndUpdate(oldEventId, {
      $inc: { coe_count: -1 }
    });
    await Event.findByIdAndUpdate(newEventId, {
      $inc: { coe_count: 1 }
    });

    console.log(`[COE_SERVICE] ===== REPLACE EVENT COMPLETED =====`);
    console.log(`[COE_SERVICE] Replaced event ${oldEventId} with ${newEventId} in COE ${coeId}. Added ${newSeats.length} seats.`);
    
    // Final verification - reload COE to show final state
    const finalCoeCheck = await coesCollection.findOne({ _id: coeObjectId });
    console.log('[COE_SERVICE] ===== FINAL COE STATE VERIFICATION =====');
    console.log('[COE_SERVICE] Final COE state after replacement:', {
      eventsCount: finalCoeCheck?.events?.length || 0,
      eventIds: (finalCoeCheck?.events || []).map(e => e.event_id?.toString() || e.event_id),
      seatsCount: finalCoeCheck?.selected_seats?.length || 0,
      seatEventIds: [...new Set((finalCoeCheck?.selected_seats || []).map(s => s.event_id?.toString() || s.event_id))],
      subtotal: finalCoeCheck?.subtotal || 0,
      total: finalCoeCheck?.total || 0,
      oldEventId: oldEventIdStr,
      newEventId: newEventIdStr,
      oldEventInEvents: (finalCoeCheck?.events || []).some(e => {
        const eid = e.event_id?.toString() || e.event_id;
        return eid === oldEventIdStr;
      }),
      newEventInEvents: (finalCoeCheck?.events || []).some(e => {
        const eid = e.event_id?.toString() || e.event_id;
        return eid === newEventIdStr;
      })
    });
    
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
    // CRITICAL: Use native MongoDB to get absolute latest data and ensure replaced events are not excluded
    const mongoose = require('mongoose');
    const db = mongoose.connection.db;
    const coesCollection = db.collection('coes');
    const coeObjectId = mongoose.Types.ObjectId.isValid(coeId) 
      ? new mongoose.Types.ObjectId(coeId) 
      : coeId;
    
    const coe = await coesCollection.findOne({ _id: coeObjectId });
    if (!coe) {
      throw new Error('COE not found');
    }

    // Helper function to normalize event ID for consistent comparison
    // Matches the normalization used in replaceEventInCOE
    const normalizeEventId = (id) => {
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

    const existingEventIds = new Set();
    
    // CRITICAL FIX: Only exclude events that are in the events array (source of truth)
    // Do NOT exclude events based on selected_seats alone, as old seats may not be fully cleaned up
    // This ensures previously replaced events become available again
    // Using native MongoDB ensures we get the absolute latest state from the database
    (coe.events || []).forEach(event => {
      const eventIdStr = normalizeEventId(event.event_id);
      if (eventIdStr) {
        existingEventIds.add(eventIdStr);
      }
    });

    // Normalize current event ID and add to exclusion set (we're replacing this event)
    const normalizedCurrentEventId = normalizeEventId(eventId);
    if (normalizedCurrentEventId) {
      existingEventIds.add(normalizedCurrentEventId);
    }

    console.log('[COE_SERVICE] ===== FIND ALTERNATIVE EVENTS - EXCLUSION LOGIC =====');
    console.log('[COE_SERVICE] COE state when finding alternatives:', {
      coeId,
      currentEventId: normalizedCurrentEventId,
      eventsInEventsArray: (coe.events || []).map(e => ({
        event_id: e.event_id?.toString() || e.event_id,
        event_id_type: typeof e.event_id,
        event_id_constructor: e.event_id?.constructor?.name
      })),
      // Log selected_seats for debugging, but note we're NOT using it for exclusions
      eventsInSeats: [...new Set((coe.selected_seats || []).map(s => ({
        event_id: s.event_id?.toString() || s.event_id,
        event_id_type: typeof s.event_id,
        seat_code: s.seat_code
      })))],
      existingEventIds: Array.from(existingEventIds),
      totalExcluded: existingEventIds.size,
      note: 'EXCLUSION BASED ON EVENTS ARRAY ONLY. Previously replaced events (not in events array) will be available as alternatives, even if old seats still exist in selected_seats.',
      rawEventsArray: coe.events?.length || 0,
      rawSeatsArray: coe.selected_seats?.length || 0
    });

    // Build query
    // Universal restrictions: active status, not fully booked, exclude current event and events already in COE
    const query = {
      status: 'active',
      _id: { $nin: Array.from(existingEventIds) },
      // Universal restriction: exclude fully booked events
      total_available: { $gt: 0 }
    };

    // Add city filter
    // For admins: only apply city filter if explicitly provided (don't default to current event's city)
    // For clients: default to current event's city if not provided (backward compatibility)
    const targetCity = city || (!isAdmin ? currentEvent.location_id?.address?.city : null);
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
    console.log('[COE_SERVICE] Final exclusion list:', {
      excludedEventIds: Array.from(existingEventIds),
      currentEventId: normalizedCurrentEventId,
      eventsInArray: (coe.events || []).map(e => e.event_id?.toString() || e.event_id),
      seatsEventIds: [...new Set((coe.selected_seats || []).map(s => s.event_id?.toString() || s.event_id))],
      note: 'Events in this list will be EXCLUDED from alternatives. Exclusion based on events array only. Previously replaced events (not in events array) should NOT be in this list and will be available as alternatives.'
    });

    console.log('[COE_SERVICE] Raw alternatives found:', alternatives.length);
    console.log('[COE_SERVICE] Alternative events (before filtering):', alternatives.map(e => ({
      _id: e._id?.toString() || e._id,
      name: e.name,
      start_datetime: e.start_datetime,
      end_datetime: e.end_datetime,
      location_city: e.location_id?.address?.city,
      available_seats: (e.seats || []).filter(s => s.status === 'available').length,
      isExcluded: existingEventIds.has(e._id?.toString() || e._id)
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
          description: event.description || null,
          start_datetime: event.start_datetime,
          end_datetime: event.end_datetime,
          location: event.location_id,
          media: event.media || [],
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
  validateSelectedSeats,
  filterSelectedSeatsByEvents,
  updateSelectedSeatsStatus,
  updateSeatStatusesToBooked,
  releaseSelectedSeats,
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
  acceptSeatUpgrade,
  removeEventsFromCOE,
  replaceEventInCOE,
  findAlternativeEvents,
  hasAlternativeEventsSameDay
};

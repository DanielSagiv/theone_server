const mongoose = require('mongoose');
const COE = require('../models/COE');
const Event = require('../models/Event');
const coeService = require('./coeService');

/**
 * Normalize ObjectId/string for map keys. Iterative to avoid stack overflow from
 * deep _id chains or circular refs (e.g. populated docs / driver ObjectIds).
 * @param {any} id
 * @returns {string|null}
 */
function normalizeId(id) {
  if (id == null) return null;
  const seen = new Set();
  let current = id;
  while (true) {
    if (typeof current !== 'object' || current === null) return String(current);
    if (seen.has(current)) return String(current);
    seen.add(current);
    if (current.$oid !== undefined) return String(current.$oid);
    if (current._id !== undefined) {
      current = current._id;
      continue;
    }
    return String(current);
  }
}

/**
 * Find merge opportunities between COEs that share events and have seats
 * @param {Object} options
 * @param {string[]} [options.status] - allowed COE statuses
 * @param {string} [options.event_id] - filter to a single event
 * @param {number} [options.limit] - max opportunities to return
 * @param {string} [options.coe_id] - optional filter: only opportunities involving this COE
 * @param {boolean} [options.debug] - if true, return diagnostic info when no/few opportunities
 * @returns {Promise<{ opportunities: Array, debug?: Object }>}
 */
async function findMergeOpportunities(options = {}) {
  const {
    status,
    event_id: filterEventId,
    limit,
    coe_id: filterCoeId,
    debug: wantDebug,
  } = options;

  const coeQuery = {};

  if (status && Array.isArray(status) && status.length > 0) {
    coeQuery.status = { $in: status };
  }

  // Only COEs that have events AND selected seats
  coeQuery.events = { $exists: true, $not: { $size: 0 } };
  coeQuery.selected_seats = { $exists: true, $not: { $size: 0 } };

  const coes = await COE.find(coeQuery)
    .populate('client_id', 'firstName lastName email avatarUrl')
    .lean();

  const eventMap = new Map(); // eventId -> array of { coe, seat }
  const debugInfo = wantDebug ? {
    coes_loaded: coes.length,
    events_with_eligible_seats: 0,
    events_with_single_coe: [],
    events_with_same_client_only: [],
    reasons: [],
  } : null;

  const normalizedFilterEventId = filterEventId ? normalizeId(filterEventId) : null;
  const normalizedFilterCoeId = filterCoeId ? normalizeId(filterCoeId) : null;

  for (const coe of coes) {
    const coeIdStr = normalizeId(coe._id);

    const seats = Array.isArray(coe.selected_seats) ? coe.selected_seats : [];
    if (!seats.length) continue;

    for (const seat of seats) {
      // Only consider active-ish seats
      if (!seat || !seat.event_id) continue;
      if (!['selected', 'held', 'booked'].includes(seat.status)) continue;

      const eventIdStr = normalizeId(seat.event_id);
      if (!eventIdStr) continue;
      if (normalizedFilterEventId && eventIdStr !== normalizedFilterEventId) continue;

      if (!eventMap.has(eventIdStr)) {
        eventMap.set(eventIdStr, []);
      }

      eventMap.get(eventIdStr).push({
        coe,
        seat,
      });
    }
  }

  if (wantDebug && debugInfo) {
    debugInfo.events_with_eligible_seats = eventMap.size;
    if (coes.length === 0) {
      debugInfo.reasons.push('No COEs found with both non-empty events and selected_seats (or none match status/coe_id filter).');
    } else if (eventMap.size === 0) {
      debugInfo.reasons.push('No COEs have selected/held/booked seats for the filtered event(s). Check seat status and event_id on selected_seats.');
    }
  }

  const results = [];

  // Preload Events for all eventIds we found
  const eventIds = Array.from(eventMap.keys()).map(id => new mongoose.Types.ObjectId(id));
  const eventsById = {};
  if (eventIds.length) {
    const events = await Event.find({ _id: { $in: eventIds } })
      .select('name start_datetime location_id seats')
      .populate('location_id', 'name')
      .lean();
    for (const ev of events) {
      eventsById[normalizeId(ev._id)] = ev;
    }
  }

  for (const [eventIdStr, entries] of eventMap.entries()) {
    // Need at least 2 COEs with seats on this event
    if (entries.length < 2) {
      if (wantDebug && debugInfo) {
        debugInfo.events_with_single_coe.push({
          event_id: eventIdStr,
          event_name: eventsById[eventIdStr]?.name || null,
          coes_count: 1,
          reason: 'Only one COE has selected/held/booked seats for this event. Merge requires two different clients with seats on the same event.',
        });
      }
      continue;
    }

    const eventDoc = eventsById[eventIdStr];

    const eventPayload = {
      event_id: eventIdStr,
      event_name: eventDoc?.name || null,
      event_date: eventDoc?.start_datetime || null,
      location_id: eventDoc?.location_id?._id || eventDoc?.location_id || null,
      location_name: eventDoc?.location_id?.name || null,
      opportunities: [],
      available_seats: (eventDoc?.seats || [])
        .filter(s => s && s.status === 'available')
        .map(s => ({
          _id: normalizeId(s._id),
          seat_id: normalizeId(s.seat_id),
          code: s.code || s.seat_code || '',
          capacity: s.capacity ?? 0,
          event_price: s.event_price ?? 0,
        })),
    };

    // Deduplicate by COE id (in case multiple seats per event)
    const coeById = new Map(); // coeId -> best seat
    for (const { coe, seat } of entries) {
      const coeIdStr = normalizeId(coe._id);
      const existing = coeById.get(coeIdStr);
      if (!existing) {
        coeById.set(coeIdStr, { coe, seat });
      } else {
        // Prefer held/booked over selected
        const priority = s =>
          s.status === 'booked' ? 2 : s.status === 'held' ? 1 : 0;
        if (priority(seat) > priority(existing.seat)) {
          coeById.set(coeIdStr, { coe, seat });
        }
      }
    }

    const coeEntries = Array.from(coeById.values());
    if (coeEntries.length < 2) {
      if (wantDebug && debugInfo) {
        debugInfo.events_with_single_coe.push({
          event_id: eventIdStr,
          event_name: eventDoc?.name || null,
          coes_count: 1,
          reason: 'After dedup by COE: only one COE. Merge requires two different COEs on the same event.',
        });
      }
      continue;
    }

    // Build pairs
    let sameClientOnly = true;
    for (let i = 0; i < coeEntries.length; i++) {
      for (let j = i + 1; j < coeEntries.length; j++) {
        const { coe: coeA, seat: seatA } = coeEntries[i];
        const { coe: coeB, seat: seatB } = coeEntries[j];

        // Must be different clients
        if (normalizeId(coeA.client_id) === normalizeId(coeB.client_id)) {
          continue;
        }
        sameClientOnly = false;

        const capacityA = seatA.capacity || 0;
        const capacityB = seatB.capacity || 0;
        const combinedCapacity = capacityA + capacityB;
        const capacitySufficient =
          capacityA >= combinedCapacity || capacityB >= combinedCapacity;

        const coeAIdStr = normalizeId(coeA._id);
        const coeBIdStr = normalizeId(coeB._id);
        const seats = eventDoc?.seats || [];
        let primaryCoeIdStrForUnmerge = null;
        let mergedCoeIdsForUnmerge = [];
        const isMerged = seats.some(seat => {
          const ref = normalizeId(seat.booking_reference);
          const mergedIds = (seat.merged_coe_ids || []).map(id => normalizeId(id));
          const match =
            (ref === coeAIdStr && mergedIds.includes(coeBIdStr)) ||
            (ref === coeBIdStr && mergedIds.includes(coeAIdStr));
          if (match) {
            primaryCoeIdStrForUnmerge = ref;
            mergedCoeIdsForUnmerge = mergedIds;
          }
          return match;
        });
        if (isMerged && !primaryCoeIdStrForUnmerge) {
          console.warn('[mergeService] isMerged true but primary not set (seats may lack booking_reference/merged_coe_ids):', {
            eventIdStr,
            coeAIdStr,
            coeBIdStr,
            seatsCount: seats.length,
            firstSeatKeys: seats[0] ? Object.keys(seats[0]) : [],
          });
        }

        eventPayload.opportunities.push({
          coe_a_id: coeA._id,
          coe_a_name: coeA.name,
          client_a_id: coeA.client_id,
          client_a_name: coeA.client_id?.firstName
            ? `${coeA.client_id.firstName} ${coeA.client_id.lastName}`.trim()
            : undefined,
          client_a_avatar_url: coeA.client_id?.avatarUrl || null,
          seat_a: {
            seat_id: seatA.seat_id,
            seat_code: seatA.seat_code,
            capacity: seatA.capacity,
            event_price: seatA.event_price,
          },
          coe_b_id: coeB._id,
          coe_b_name: coeB.name,
          client_b_id: coeB.client_id,
          client_b_name: coeB.client_id?.firstName
            ? `${coeB.client_id.firstName} ${coeB.client_id.lastName}`.trim()
            : undefined,
          client_b_avatar_url: coeB.client_id?.avatarUrl || null,
          seat_b: {
            seat_id: seatB.seat_id,
            seat_code: seatB.seat_code,
            capacity: seatB.capacity,
            event_price: seatB.event_price,
          },
          capacity_sufficient: capacitySufficient,
          is_merged: isMerged,
          ...(isMerged && primaryCoeIdStrForUnmerge
            ? (() => {
                console.log('[mergeService] merged opportunity with unmerge ids:', {
                  eventIdStr,
                  primary_coe_id: primaryCoeIdStrForUnmerge,
                  merged_coe_ids: mergedCoeIdsForUnmerge,
                });
                return {
                  primary_coe_id: primaryCoeIdStrForUnmerge,
                  merged_coe_ids: mergedCoeIdsForUnmerge,
                };
              })()
            : {}),
        });
      }
    }

    if (wantDebug && debugInfo && sameClientOnly) {
      debugInfo.events_with_same_client_only.push({
        event_id: eventIdStr,
        event_name: eventDoc?.name || null,
        coes_count: coeEntries.length,
        reason: 'All COEs with seats on this event belong to the same client. Merge is only between two different clients.',
      });
    }

    if (eventPayload.opportunities.length) {
      results.push(eventPayload);
    }
  }

  // When coe_id filter is set, keep only opportunities that involve this COE (so "Check available merges" from COE detail shows pairs including that COE)
  let opportunities = results;
  if (normalizedFilterCoeId) {
    opportunities = opportunities.map(eventItem => ({
      ...eventItem,
      opportunities: (eventItem.opportunities || []).filter(
        pair =>
          normalizeId(pair.coe_a_id) === normalizedFilterCoeId ||
          normalizeId(pair.coe_b_id) === normalizedFilterCoeId
      ),
    })).filter(eventItem => (eventItem.opportunities || []).length > 0);
  }

  if (typeof limit === 'number' && limit > 0 && opportunities.length > limit) {
    opportunities = opportunities.slice(0, limit);
  }

  if (wantDebug && debugInfo) {
    if (opportunities.length === 0 && debugInfo.reasons.length === 0) {
      if (debugInfo.events_with_single_coe.length) {
        debugInfo.reasons.push('No event has two different COEs with eligible seats. Each event has only one COE (or one client). Ensure both COEs have selected_seats for the same event_id.');
      }
      if (debugInfo.events_with_same_client_only.length) {
        debugInfo.reasons.push('Some events have multiple COEs but all are the same client. Merge requires two different clients.');
      }
    }
    return { opportunities, debug: debugInfo };
  }

  return { opportunities };
}

/**
 * Execute merge for two COEs on a single event/seat
 * @param {Object} params
 * @param {string} params.coe_id_a
 * @param {string} params.coe_id_b
 * @param {string} params.event_id
 * @param {string} params.target_seat_id - Event.seats._id of keeper seat
 * @param {string} [params.target_owner_coe_id] - optional explicit primary COE id
 * @param {string} [params.admin_id] - acting admin (for audit)
 */
async function executeMerge(params) {
  const {
    coe_id_a,
    coe_id_b,
    event_id,
    target_seat_id,
    target_owner_coe_id,
    admin_id,
  } = params || {};

  if (!coe_id_a || !coe_id_b || !event_id || !target_seat_id) {
    throw new Error('Missing required merge parameters');
  }

  const coeIdAStr = normalizeId(coe_id_a);
  const coeIdBStr = normalizeId(coe_id_b);
  const eventIdStr = normalizeId(event_id);
  const targetSeatIdStr = normalizeId(target_seat_id);

  if (coeIdAStr === coeIdBStr) {
    throw new Error('Cannot merge the same COE');
  }

  const allowedStatuses = [
    'draft',
    'request',
    'approved',
    'pending_pay',
    'paid',
  ];

  const [coeA, coeB, eventDoc] = await Promise.all([
    COE.findById(coeIdAStr).lean(),
    COE.findById(coeIdBStr).lean(),
    Event.findById(eventIdStr),
  ]);

  if (!coeA || !coeB || !eventDoc) {
    throw new Error('COE or event not found');
  }

  if (!allowedStatuses.includes(coeA.status) || !allowedStatuses.includes(coeB.status)) {
    throw new Error('Merge not allowed for current COE statuses');
  }

  // Validate that both COEs include this event
  const coeHasEvent = (coe, idStr) =>
    Array.isArray(coe.events) &&
    coe.events.some(e => normalizeId(e.event_id) === idStr);

  if (!coeHasEvent(coeA, eventIdStr) || !coeHasEvent(coeB, eventIdStr)) {
    throw new Error('Both COEs must include the target event');
  }

  // Get keeper seat from Event.seats.
  // Frontend currently sends the location seat_id (Event.seats[].seat_id),
  // not the Event.seats subdocument _id, so support both forms.
  let targetSeat = eventDoc.seats.id(targetSeatIdStr);
  if (!targetSeat) {
    targetSeat = eventDoc.seats.find(
      s => normalizeId(s.seat_id) === targetSeatIdStr
    );
  }
  if (!targetSeat) {
    throw new Error('Target seat not found on event');
  }

  const existingBookingRef = targetSeat.booking_reference || null;

  // Determine primary COE
  let primaryCoeIdStr;
  if (target_owner_coe_id) {
    primaryCoeIdStr = normalizeId(target_owner_coe_id);
  } else if (existingBookingRef === coeIdAStr || existingBookingRef === coeIdBStr) {
    primaryCoeIdStr = existingBookingRef;
  } else {
    primaryCoeIdStr = coeIdAStr;
  }

  const mergedCoeIdStr = primaryCoeIdStr === coeIdAStr ? coeIdBStr : coeIdAStr;

  // Idempotency: if target seat already has booking_reference = primary
  // and merged_coe_ids already contains the other COE, consider merged
  const mergedIds = (targetSeat.merged_coe_ids || []).map(id => normalizeId(id));
  if (
    normalizeId(targetSeat.booking_reference) === primaryCoeIdStr &&
    mergedIds.includes(mergedCoeIdStr)
  ) {
    return {
      alreadyMerged: true,
      primary_coe_id: primaryCoeIdStr,
      merged_coe_id: mergedCoeIdStr,
      event_id: eventIdStr,
      target_seat_id: targetSeatIdStr,
    };
  }

  // Helper: find selected seat entry for a given COE and event
  const findSelectedSeatForEvent = (coe, eIdStr) => {
    if (!Array.isArray(coe.selected_seats)) return null;
    return coe.selected_seats.find(
      s =>
        normalizeId(s.event_id) === eIdStr &&
        ['selected', 'held', 'booked'].includes(s.status)
    );
  };

  const currentSeatA = findSelectedSeatForEvent(coeA, eventIdStr);
  const currentSeatB = findSelectedSeatForEvent(coeB, eventIdStr);

  if (!currentSeatA || !currentSeatB) {
    throw new Error('Both COEs must have a selected seat for the event');
  }

  // Capacity check (simple rule: one of the seats should be able to hold combined capacity)
  const capacityA = currentSeatA.capacity || 0;
  const capacityB = currentSeatB.capacity || 0;
  const combinedCapacity = capacityA + capacityB;
  const targetCapacity = targetSeat.capacity || 0;
  if (targetCapacity < combinedCapacity) {
    // Soft failure: allow but flag
    // For now, throw; could be a warning flag instead if desired
    // throw new Error('Target seat capacity is insufficient for combined party');
  }

  // Start transactional-like sequence (best effort without Mongoose transaction for now)
  // 1. Release old seats (for COEs whose current seat is not the target)
  const bulkEventUpdates = [];

  const releaseOldSeatForCoe = async (coe, coeIdStr, currentSeat) => {
    if (!currentSeat) return;
    if (normalizeId(currentSeat.seat_id) === normalizeId(targetSeat.seat_id)) {
      return; // already pointing at same location seat; only logical merge needed
    }

    // Release Event seat that was previously held by this COE (by booking_reference)
    bulkEventUpdates.push({
      updateMany: {
        filter: {
          _id: new mongoose.Types.ObjectId(eventIdStr),
          'seats.booking_reference': coeIdStr,
        },
        update: {
          $set: {
            'seats.$[seat].status': 'available',
            'seats.$[seat].booking_reference': undefined,
            'seats.$[seat].booked_at': undefined,
            'seats.$[seat].booked_by': undefined,
            'seats.$[seat].merged_coe_ids': [],
          },
        },
        arrayFilters: [{ 'seat.booking_reference': coeIdStr }],
      },
    });

    // Mark COE's old selected seat as released
    await COE.updateOne(
      { _id: coeIdStr },
      {
        $set: {
          'selected_seats.$[seat].status': 'released',
          'selected_seats.$[seat].is_merged_booking': false,
          'selected_seats.$[seat].primary_coe_id': undefined,
        },
      },
      {
        arrayFilters: [
          {
            'seat.event_id': new mongoose.Types.ObjectId(eventIdStr),
            'seat.seat_id': new mongoose.Types.ObjectId(currentSeat.seat_id),
          },
        ],
      }
    );
  };

  // Release old seats for both COEs where needed
  await releaseOldSeatForCoe(coeA, coeIdAStr, currentSeatA);
  await releaseOldSeatForCoe(coeB, coeIdBStr, currentSeatB);

  if (bulkEventUpdates.length) {
    await Event.bulkWrite(bulkEventUpdates);
  }

  // 2. Ensure both COEs have selected_seats entry pointing to target seat
  const ensureSeatForCoe = async (coe, coeIdStr, isPrimary) => {
    const existingSeat = findSelectedSeatForEvent(coe, eventIdStr);
    const seatPayload = {
      event_id: new mongoose.Types.ObjectId(eventIdStr),
      seat_id: targetSeat.seat_id, // location seat reference
      seat_code: targetSeat.code,
      capacity: targetSeat.capacity || (existingSeat?.capacity || 0),
      base_price: existingSeat?.base_price || 0,
      // IMPORTANT: keep each COE's pricing exactly as it was before merge.
      // We do NOT change event_price for either primary or merged COE.
      event_price: existingSeat?.event_price || targetSeat.event_price || 0,
      available_from: existingSeat?.available_from || new Date(),
      available_until: existingSeat?.available_until || eventDoc.start_datetime || new Date(),
      status: existingSeat?.status || targetSeat.status || 'held',
      is_merged_booking: !isPrimary,
      primary_coe_id: isPrimary ? undefined : new mongoose.Types.ObjectId(primaryCoeIdStr),
    };

    if (existingSeat) {
      // Update existing seat entry
      await COE.updateOne(
        { _id: coeIdStr },
        {
          $set: {
            'selected_seats.$[seat].seat_id': seatPayload.seat_id,
            'selected_seats.$[seat].seat_code': seatPayload.seat_code,
            'selected_seats.$[seat].capacity': seatPayload.capacity,
            'selected_seats.$[seat].base_price': seatPayload.base_price,
            'selected_seats.$[seat].event_price': seatPayload.event_price,
            'selected_seats.$[seat].available_from': seatPayload.available_from,
            'selected_seats.$[seat].available_until': seatPayload.available_until,
            'selected_seats.$[seat].status': seatPayload.status,
            'selected_seats.$[seat].is_merged_booking': seatPayload.is_merged_booking,
            'selected_seats.$[seat].primary_coe_id': seatPayload.primary_coe_id,
          },
        },
      {
        arrayFilters: [
          {
            'seat.event_id': new mongoose.Types.ObjectId(eventIdStr),
          },
        ],
      }
      );
    } else {
      // Add new entry
      await COE.updateOne(
        { _id: coeIdStr },
        {
          $push: {
            selected_seats: seatPayload,
          },
        }
      );
    }
  };

  await ensureSeatForCoe(coeA, coeIdAStr, primaryCoeIdStr === coeIdAStr);
  await ensureSeatForCoe(coeB, coeIdBStr, primaryCoeIdStr === coeIdBStr);

  // 3. Update Event seat in DB: set held, booking_reference, merged_coe_ids (explicit update so seat is no longer available)
  const mergedSet = new Set(
    (targetSeat.merged_coe_ids || []).map(id => normalizeId(id))
  );
  mergedSet.add(mergedCoeIdStr);
  const mergedCoeIdsArray = Array.from(mergedSet).map(
    id => new mongoose.Types.ObjectId(id)
  );

  const eventSeatId = targetSeat._id;
  // Link seat to primary COE; status set to held only when COE is paid (see paymentService.updateCOEPaymentStatus / holdSeatsForCOE)
  const updateResult = await Event.updateOne(
    { _id: new mongoose.Types.ObjectId(eventIdStr) },
    {
      $set: {
        'seats.$[seat].booking_reference': primaryCoeIdStr,
        'seats.$[seat].booked_at': new Date(),
        'seats.$[seat].merged_coe_ids': mergedCoeIdsArray,
      },
    },
    {
      arrayFilters: [{ 'seat._id': eventSeatId }],
    }
  );

  if (updateResult.matchedCount === 0 || updateResult.modifiedCount === 0) {
    console.warn('[MERGE_SERVICE] Event seat update matched/modified:', {
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount,
      eventIdStr,
      eventSeatId: eventSeatId?.toString?.(),
    });
  }

  // Basic audit log
  console.log('[MERGE_SERVICE] executeMerge completed', {
    coe_id_a: coeIdAStr,
    coe_id_b: coeIdBStr,
    primary_coe_id: primaryCoeIdStr,
    merged_coe_id: mergedCoeIdStr,
    event_id: eventIdStr,
    target_seat_id: targetSeatIdStr,
    admin_id: admin_id || null,
  });

  return {
    primary_coe_id: primaryCoeIdStr,
    merged_coe_id: mergedCoeIdStr,
    event_id: eventIdStr,
    target_seat_id: targetSeatIdStr,
  };
}

/**
 * Unmerge a single COE from a shared seat on an event
 * @param {Object} params
 * @param {string} params.primary_coe_id
 * @param {string} params.merged_coe_id
 * @param {string} params.event_id
 */
async function unmergeSingle(params) {
  const { primary_coe_id, merged_coe_id, event_id } = params || {};

  if (!primary_coe_id || !merged_coe_id || !event_id) {
    throw new Error('Missing required unmerge parameters');
  }

  const primaryIdStr = normalizeId(primary_coe_id);
  const mergedIdStr = normalizeId(merged_coe_id);
  const eventIdStr = normalizeId(event_id);

  if (primaryIdStr === mergedIdStr) {
    throw new Error('primary_coe_id and merged_coe_id must be different');
  }

  // Find event seat that has booking_reference = primary and merged_coe_ids includes merged
  const eventDoc = await Event.findOne({
    _id: eventIdStr,
    'seats.booking_reference': primaryIdStr,
    'seats.merged_coe_ids': { $in: [new mongoose.Types.ObjectId(mergedIdStr)] },
  });

  if (!eventDoc) {
    throw new Error('Shared seat not found for unmerge');
  }

  const seat = eventDoc.seats.find(s => {
    const bookingRef = normalizeId(s.booking_reference);
    const mergedIds = (s.merged_coe_ids || []).map(id => normalizeId(id));
    return (
      bookingRef === primaryIdStr &&
      mergedIds.includes(mergedIdStr)
    );
  });

  if (!seat) {
    throw new Error('Shared seat not found for unmerge');
  }

  // Remove merged COE from merged_coe_ids
  seat.merged_coe_ids = (seat.merged_coe_ids || []).filter(
    id => normalizeId(id) !== mergedIdStr
  );

  await eventDoc.save();

  const eventIdObj = new mongoose.Types.ObjectId(eventIdStr);
  const primaryIdObj = new mongoose.Types.ObjectId(primaryIdStr);

  const mergedCoe = await COE.findById(mergedIdStr).lean();
  const mergedSeatEntry = mergedCoe?.selected_seats?.find(
    s =>
      normalizeId(s.event_id) === eventIdStr &&
      s.is_merged_booking === true &&
      normalizeId(s.primary_coe_id) === primaryIdStr
  );
  const requiredCapacity = Math.max(
    1,
    mergedSeatEntry?.capacity || 0,
    mergedCoe?.original_request_data?.party_size || 0
  );
  // Prefer to restore the merged COE to its *original* table when possible,
  // even if that table would not satisfy the strict capacity heuristic.
  // During merge, the original table is kept in selected_seats with status "released".
  let preferredSeat = null;
  if (mergedCoe && Array.isArray(mergedCoe.selected_seats)) {
    const originalReleasedSeatEntry = mergedCoe.selected_seats.find(s =>
      normalizeId(s.event_id) === eventIdStr &&
      s.status === 'released' &&
      !s.is_merged_booking &&
      // Make sure this is not the shared seat we're unmerging from
      normalizeId(s.seat_id) !== normalizeId(seat._id)
    );
    if (originalReleasedSeatEntry) {
      preferredSeat = (eventDoc.seats || []).find(s =>
        normalizeId(s._id) === normalizeId(originalReleasedSeatEntry.seat_id) ||
        normalizeId(s.seat_id) === normalizeId(originalReleasedSeatEntry.seat_id)
      );
      if (preferredSeat && normalizeId(preferredSeat._id) === normalizeId(seat._id)) {
        preferredSeat = null;
      }
    }
  }

  const availableSeats = (eventDoc.seats || [])
    .filter(
      s =>
        s.status === 'available' &&
        (s.capacity || 0) >= requiredCapacity &&
        normalizeId(s._id) !== normalizeId(seat._id)
    )
    .sort((a, b) => (a.capacity || 0) - (b.capacity || 0));

  const newSeat = preferredSeat || availableSeats[0];

  if (newSeat) {
    const availFrom = eventDoc.start_datetime || new Date();
    const availUntil = eventDoc.end_datetime || eventDoc.start_datetime || new Date();
    const basePrice = newSeat.base_price ?? newSeat.event_price ?? 0;
    const eventPrice = newSeat.event_price ?? basePrice;

    await COE.updateOne(
      { _id: mergedIdStr },
      {
        $set: {
          'selected_seats.$[seat].seat_id': newSeat._id,
          'selected_seats.$[seat].seat_code': newSeat.code || newSeat.seat_code || '',
          'selected_seats.$[seat].capacity': newSeat.capacity || requiredCapacity,
          'selected_seats.$[seat].base_price': basePrice,
          'selected_seats.$[seat].event_price': eventPrice,
          'selected_seats.$[seat].available_from': availFrom,
          'selected_seats.$[seat].available_until': availUntil,
          'selected_seats.$[seat].status': 'held',
          'selected_seats.$[seat].is_merged_booking': false,
          'selected_seats.$[seat].primary_coe_id': undefined,
        },
      },
      {
        arrayFilters: [
          {
            'seat.event_id': eventIdObj,
            'seat.is_merged_booking': true,
            'seat.primary_coe_id': primaryIdObj,
          },
        ],
      }
    );

    // Seats are set to held only when COE is paid (see paymentService.updateCOEPaymentStatus / holdSeatsForCOE)
    console.log('[MERGE_SERVICE] unmergeSingle completed with reassignment', {
      primary_coe_id: primaryIdStr,
      merged_coe_id: mergedIdStr,
      event_id: eventIdStr,
      new_seat_id: normalizeId(newSeat._id),
      new_seat_code: newSeat.code,
      required_capacity: requiredCapacity,
    });

    return {
      primary_coe_id: primaryIdStr,
      merged_coe_id: mergedIdStr,
      event_id: eventIdStr,
      reassigned: true,
      new_seat_id: newSeat._id,
      new_seat_code: newSeat.code,
    };
  }

  // No suitable available seat: mark merged entry as released only
  await COE.updateOne(
    { _id: mergedIdStr },
    {
      $set: {
        'selected_seats.$[seat].status': 'released',
        'selected_seats.$[seat].is_merged_booking': false,
        'selected_seats.$[seat].primary_coe_id': undefined,
      },
    },
    {
      arrayFilters: [
        {
          'seat.event_id': eventIdObj,
          'seat.is_merged_booking': true,
          'seat.primary_coe_id': primaryIdObj,
        },
      ],
    }
  );

  console.log('[MERGE_SERVICE] unmergeSingle completed (released, no available seat)', {
    primary_coe_id: primaryIdStr,
    merged_coe_id: mergedIdStr,
    event_id: eventIdStr,
    required_capacity: requiredCapacity,
  });

  return {
    primary_coe_id: primaryIdStr,
    merged_coe_id: mergedIdStr,
    event_id: eventIdStr,
    reassigned: false,
  };
}

/**
 * Unmerge all merged COEs for a primary on an event
 * @param {Object} params
 * @param {string} params.primary_coe_id
 * @param {string} params.event_id
 */
async function unmergeAllForSeat(params) {
  const { primary_coe_id, event_id } = params || {};

  if (!primary_coe_id || !event_id) {
    throw new Error('Missing required unmerge parameters');
  }

  const primaryIdStr = normalizeId(primary_coe_id);
  const eventIdStr = normalizeId(event_id);

  const eventDoc = await Event.findOne({
    _id: eventIdStr,
    'seats.booking_reference': primaryIdStr,
  });

  if (!eventDoc) {
    throw new Error('Shared seat not found for unmerge');
  }

  const seat = eventDoc.seats.find(
    s => normalizeId(s.booking_reference) === primaryIdStr
  );

  if (!seat) {
    throw new Error('Shared seat not found for unmerge');
  }

  const mergedIds = (seat.merged_coe_ids || []).map(id => normalizeId(id));

  // Clear merged_coe_ids on seat
  seat.merged_coe_ids = [];
  await eventDoc.save();

  if (mergedIds.length) {
    await COE.updateMany(
      {
        _id: { $in: mergedIds.map(id => new mongoose.Types.ObjectId(id)) },
      },
      {
        $set: {
          'selected_seats.$[seat].status': 'released',
          'selected_seats.$[seat].is_merged_booking': false,
          'selected_seats.$[seat].primary_coe_id': undefined,
        },
      },
      {
        arrayFilters: [
          {
            'seat.event_id': new mongoose.Types.ObjectId(eventIdStr),
            'seat.is_merged_booking': true,
            'seat.primary_coe_id': new mongoose.Types.ObjectId(primaryIdStr),
          },
        ],
      }
    );
  }

  console.log('[MERGE_SERVICE] unmergeAllForSeat completed', {
    primary_coe_id: primaryIdStr,
    event_id: eventIdStr,
    merged_count: mergedIds.length,
  });

  return {
    primary_coe_id: primaryIdStr,
    event_id: eventIdStr,
    unmerged_coe_ids: mergedIds,
  };
}

/**
 * Enrich COE selected_seats with shared_with (other client name + avatar) when seat is part of a merge.
 * Mutates coe.selected_seats in place. Call after COE is loaded with events populated (event.seats with booking_reference, merged_coe_ids).
 * @param {Object} coe - COE document (plain object) with events[].event_id and selected_seats
 */
async function enrichCoeSelectedSeatsWithSharedWith(coe) {
  if (!coe || !Array.isArray(coe.selected_seats) || coe.selected_seats.length === 0) {
    return;
  }
  const currentCoeId = normalizeId(coe._id);
  const otherCoeIdsSet = new Set();

  for (const seat of coe.selected_seats) {
    const seatEventId = normalizeId(seat.event_id);
    const seatSeatId = normalizeId(seat.seat_id);
    let otherIds = [];

    const eventItem = (coe.events || []).find(
      e => normalizeId(e.event_id?._id || e.event_id) === seatEventId
    );
    const event = eventItem?.event_id;
    if (event && Array.isArray(event.seats)) {
      const eventSeat = event.seats.find(
        s =>
          normalizeId(s.seat_id) === seatSeatId ||
          normalizeId(s._id) === seatSeatId
      );
      if (eventSeat) {
        const ref = normalizeId(eventSeat.booking_reference);
        const mergedIds = (eventSeat.merged_coe_ids || []).map(id => normalizeId(id));
        if (ref === currentCoeId && mergedIds.length > 0) {
          otherIds = mergedIds;
        } else if (mergedIds.includes(currentCoeId)) {
          otherIds = ref ? [ref] : [];
        }
      }
    }
    if (otherIds.length === 0 && seat.is_merged_booking && seat.primary_coe_id) {
      otherIds = [normalizeId(seat.primary_coe_id)];
    }
    otherIds.forEach(id => otherCoeIdsSet.add(id));
  }

  const otherCoeIds = Array.from(otherCoeIdsSet);
  if (otherCoeIds.length === 0) return;

  const otherCoes = await COE.find({ _id: { $in: otherCoeIds.map(id => new mongoose.Types.ObjectId(id)) } })
    .populate('client_id', 'firstName lastName avatarUrl')
    .lean();
  const coeIdToShared = new Map();
  for (const c of otherCoes) {
    const idStr = normalizeId(c._id);
    const name =
      c.client_id?.firstName || c.client_id?.lastName
        ? `${c.client_id.firstName || ''} ${c.client_id.lastName || ''}`.trim()
        : null;
    coeIdToShared.set(idStr, {
      client_name: name || 'Another guest',
      client_avatar_url: c.client_id?.avatarUrl || null,
    });
  }

  for (const seat of coe.selected_seats) {
    const seatEventId = normalizeId(seat.event_id);
    const seatSeatId = normalizeId(seat.seat_id);
    let otherIds = [];
    const eventItem = (coe.events || []).find(
      e => normalizeId(e.event_id?._id || e.event_id) === seatEventId
    );
    const event = eventItem?.event_id;
    if (event && Array.isArray(event.seats)) {
      const eventSeat = event.seats.find(
        s =>
          normalizeId(s.seat_id) === seatSeatId ||
          normalizeId(s._id) === seatSeatId
      );
      if (eventSeat) {
        const ref = normalizeId(eventSeat.booking_reference);
        const mergedIds = (eventSeat.merged_coe_ids || []).map(id => normalizeId(id));
        if (ref === currentCoeId && mergedIds.length > 0) {
          otherIds = mergedIds;
        } else if (mergedIds.includes(currentCoeId)) {
          otherIds = ref ? [ref] : [];
        }
      }
    }
    if (otherIds.length === 0 && seat.is_merged_booking && seat.primary_coe_id) {
      otherIds = [normalizeId(seat.primary_coe_id)];
    }
    seat.shared_with = otherIds
      .map(id => coeIdToShared.get(id))
      .filter(Boolean);
  }
}

module.exports = {
  findMergeOpportunities,
  executeMerge,
  unmergeSingle,
  unmergeAllForSeat,
  enrichCoeSelectedSeatsWithSharedWith,
};


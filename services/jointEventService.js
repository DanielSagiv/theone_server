/**
 * Joint event / shared table allocation for multiple clients (jointevent plan).
 *
 * Product rules implemented:
 * - Admin picks event, section, clients, and % shares (sum 100). One available table is assigned.
 * - Each client gets a COE line with their dollar share as event_price on the shared seat row.
 * - Deposit: full joint share is due at deposit time; non-joint seat rows use deposit_percent (see paymentService).
 *
 * Note: JOINT-EVENT-REQUIREMENTS.md also mentions 48h windows and deposit credit; those are not auto-applied here
 * beyond existing proposal_group timer flows when duplicateCoeAsProposal extends a group.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const COE = require('../models/COE');
const Event = require('../models/Event');
const User = require('../models/User');
const { isJointEventAdminEnabled } = require('../utils/featureFlags');
const coeService = require('./coeService');
const proposalGroupService = require('./proposalGroupService');

const ACTIVE_COE_STATUSES = ['draft', 'request', 'approved', 'accepted_not_paid', 'pending_pay'];

/**
 * Coerce string/ObjectId to ObjectId for consistent COE.client_id storage (avoids query mismatches).
 * @param {string|import('mongoose').Types.ObjectId} id
 * @returns {import('mongoose').Types.ObjectId}
 */
function toClientObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid client user id');
  }
  return id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id);
}

/**
 * Push + in-app notification when a joint-only COE is created already in `approved` (skip updateCOEStatus).
 * @param {string} coeId
 */
async function notifyClientJointProposalReady(coeId) {
  try {
    const notificationService = require('./notificationService');
    const updatedCoe = await COE.findById(coeId).select('name client_id').lean();
    if (!updatedCoe?.client_id) return;
    const clientId = updatedCoe.client_id.toString();
    await notificationService.createAndSendNotification(clientId, 'coe_approved', {
      coe_id: coeId,
      coe: { name: updatedCoe.name || 'Experience' },
      is_admin: false,
    });
  } catch (err) {
    console.warn('[jointEventService] notifyClientJointProposalReady:', err.message);
  }
}

/**
 * @param {number} tableTotalDollars
 * @param {number[]} percents - same length as clients, sum 100
 * @returns {number[]} dollar amounts per client (2 decimal places, last absorbs rounding)
 */
function splitTableTotalByPercent(tableTotalDollars, percents) {
  const cents = Math.round(tableTotalDollars * 100);
  if (cents <= 0) return percents.map(() => 0);
  const n = percents.length;
  const out = [];
  let allocated = 0;
  for (let i = 0; i < n - 1; i++) {
    const c = Math.floor((cents * percents[i]) / 100);
    out.push(c);
    allocated += c;
  }
  out.push(cents - allocated);
  return out.map((c) => Math.round(c) / 100);
}

/**
 * @param {import('mongoose').Document} eventDoc
 * @param {string} sectionCategory
 * @returns {object|null} seat subdoc
 */
function findFirstAvailableSeatInSection(eventDoc, sectionCategory) {
  const want = String(sectionCategory || '').trim().toLowerCase();
  if (!want || !eventDoc?.seats?.length) return null;
  return (
    eventDoc.seats.find((s) => {
      if (!s || s.status !== 'available') return false;
      const cat = (s.category && String(s.category).trim().toLowerCase()) || '';
      const sec = (s.section && String(s.section).trim().toLowerCase()) || '';
      return cat === want || sec === want || cat.includes(want) || sec.includes(want);
    }) || null
  );
}

function formatEventTime(startDate) {
  if (!startDate) return '';
  const d = new Date(startDate);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Find latest "active" COE for client under this admin.
 * @param {string} clientId
 * @param {string} adminId
 */
async function findActiveCoeForClient(clientId, adminId) {
  return COE.findOne({
    client_id: clientId,
    admin_id: adminId,
    status: { $in: ACTIVE_COE_STATUSES },
  })
    .sort({ updatedAt: -1 })
    .exec();
}

/**
 * Reserve event seat for joint flow (bypasses per-COE validateSelectedSeats race).
 * @param {string} eventId
 * @param {string} seatSubdocId
 * @param {string} jointGroupId
 * @param {string} adminUserId
 */
async function reserveSeatPendingJoint(eventId, seatSubdocId, jointGroupId, adminUserId) {
  const sid =
    typeof seatSubdocId === 'string' ? new mongoose.Types.ObjectId(seatSubdocId) : seatSubdocId;
  const updated = await Event.findOneAndUpdate(
    {
      _id: eventId,
      seats: {
        $elemMatch: {
          _id: sid,
          status: 'available',
        },
      },
    },
    {
      $set: {
        'seats.$.status': 'held',
        'seats.$.booking_reference': `joint-pending:${jointGroupId}`,
        'seats.$.booked_at': new Date(),
        'seats.$.booked_by': new mongoose.Types.ObjectId(adminUserId),
        'seats.$.merged_coe_ids': [],
      },
    },
    { new: true },
  );
  if (!updated) {
    throw new Error('Selected table is no longer available');
  }
  return updated;
}

/**
 * Finalize seat booking: primary COE + merged siblings.
 * @param {string} eventId
 * @param {string} seatSubdocId
 * @param {string} primaryCoeId
 * @param {string[]} otherCoeIds
 */
async function finalizeJointSeatBooking(eventId, seatSubdocId, primaryCoeId, otherCoeIds) {
  const sid =
    typeof seatSubdocId === 'string' ? new mongoose.Types.ObjectId(seatSubdocId) : seatSubdocId;
  const merged = (otherCoeIds || []).map((id) => new mongoose.Types.ObjectId(id));
  await Event.updateOne(
    { _id: eventId, 'seats._id': sid },
    {
      $set: {
        'seats.$.status': 'held',
        'seats.$.booking_reference': String(primaryCoeId),
        'seats.$.merged_coe_ids': merged,
      },
    },
  );
}

/**
 * Release seat if joint flow fails after reserve.
 */
async function releaseJointPendingSeat(eventId, seatSubdocId, jointGroupId) {
  const sid =
    typeof seatSubdocId === 'string' ? new mongoose.Types.ObjectId(seatSubdocId) : seatSubdocId;
  const pendingRef = `joint-pending:${jointGroupId}`;
  await Event.updateOne(
    {
      _id: eventId,
      seats: { $elemMatch: { _id: sid, booking_reference: pendingRef } },
    },
    {
      $set: {
        'seats.$.status': 'available',
        'seats.$.booking_reference': undefined,
        'seats.$.booked_at': undefined,
        'seats.$.booked_by': undefined,
        'seats.$.merged_coe_ids': [],
      },
    },
  );
}

/**
 * Build selected_seat row for joint allocation (uses Event seat subdocument _id as seat_id).
 */
function buildJointSeatRow({
  event,
  targetSeat,
  shareDollars,
  jointGroupId,
  sharePercent,
  isPrimary,
  primaryCoeId,
}) {
  return {
    event_id: event._id,
    seat_id: targetSeat._id,
    seat_code: targetSeat.code,
    category: targetSeat.category || targetSeat.section || '',
    capacity: targetSeat.capacity || 0,
    base_price: shareDollars,
    event_price: shareDollars,
    available_from: new Date(),
    available_until: event.end_datetime || event.start_datetime || new Date(),
    status: 'held',
    is_joint_allocation: true,
    joint_event_group_id: jointGroupId,
    joint_share_percent: sharePercent,
    is_merged_booking: !isPrimary,
    primary_coe_id: isPrimary ? undefined : new mongoose.Types.ObjectId(primaryCoeId),
  };
}

/**
 * Build COE event line for joint row.
 */
function buildJointEventItem({ event, shareDollars, sequence, jointGroupId }) {
  return {
    event_id: event._id,
    event_date: event.start_datetime,
    event_time: formatEventTime(event.start_datetime),
    base_price: shareDollars,
    quantity: 1,
    total_price: shareDollars,
    sequence,
    status: 'pending',
    is_joint_allocation: true,
    joint_event_group_id: jointGroupId,
  };
}

/**
 * Create a COE that contains only the joint event (client had no active COE).
 */
async function createJointOnlyCoe({
  clientId,
  adminUserId,
  event,
  targetSeat,
  shareDollars,
  sharePercent,
  jointGroupId,
  isPrimary,
  primaryCoeIdStr,
}) {
  const clientOid = toClientObjectId(clientId);
  const adminOid = toClientObjectId(adminUserId);
  const seatRow = buildJointSeatRow({
    event,
    targetSeat,
    shareDollars,
    jointGroupId,
    sharePercent,
    isPrimary,
    primaryCoeId: primaryCoeIdStr,
  });
  const eventItem = buildJointEventItem({
    event,
    shareDollars,
    sequence: 1,
    jointGroupId,
  });

  const plain = {
    name: `Joint: ${event.name}`.slice(0, 200),
    description: `Shared table with other guests — ${event.name}`.slice(0, 1000),
    /** Admin-published joint proposal: must not stay `draft` or GET /coes/my hides it from clients. */
    status: 'approved',
    approved_date: new Date(),
    client_id: clientOid,
    admin_id: adminOid,
    created_by: adminOid,
    start_date: event.start_datetime,
    end_date: event.end_datetime || event.start_datetime,
    events: [eventItem],
    selected_seats: [seatRow],
    joint_event_group_id: jointGroupId,
    payment_status: 'unpaid',
    total_paid: 0,
    deposit_percent: 20,
    currency: 'USD',
  };

  coeService.applyPricingFromSelectedSeats(plain);
  const coe = new COE(plain);
  await coe.save();
  if (coe.events?.length) coe.events.forEach((e) => { e.coe_id = coe._id; });
  if (coe.selected_seats?.length) {
    coe.selected_seats.forEach((s) => {
      s.coe_id = coe._id;
      if (!isPrimary && primaryCoeIdStr) {
        s.primary_coe_id = new mongoose.Types.ObjectId(primaryCoeIdStr);
        s.is_merged_booking = true;
      }
    });
  }
  await coe.save();
  return coe;
}

/**
 * Append joint event + seat to a duplicated proposal COE.
 */
async function appendJointToCoeDoc(coeDoc, { event, targetSeat, shareDollars, sharePercent, jointGroupId, isPrimary, primaryCoeIdStr }) {
  const maxSeq = (coeDoc.events || []).reduce((m, e) => Math.max(m, e.sequence || 0), 0);
  const eventItem = buildJointEventItem({
    event,
    shareDollars,
    sequence: maxSeq + 1,
    jointGroupId,
  });
  const seatRow = buildJointSeatRow({
    event,
    targetSeat,
    shareDollars,
    jointGroupId,
    sharePercent,
    isPrimary,
    primaryCoeId: primaryCoeIdStr,
  });
  coeDoc.events = [...(coeDoc.events || []), eventItem];
  coeDoc.selected_seats = [...(coeDoc.selected_seats || []), seatRow];
  coeDoc.joint_event_group_id = jointGroupId;
  coeService.applyPricingFromSelectedSeats(coeDoc);
  coeDoc.events.forEach((e) => { e.coe_id = coeDoc._id; });
  coeDoc.selected_seats.forEach((s) => {
    s.coe_id = coeDoc._id;
    if (!isPrimary && primaryCoeIdStr) {
      s.primary_coe_id = new mongoose.Types.ObjectId(primaryCoeIdStr);
      s.is_merged_booking = true;
    }
  });
  coeDoc.markModified('events');
  coeDoc.markModified('selected_seats');
  await coeDoc.save();
  return coeDoc;
}

/**
 * Admin creates a joint table allocation for multiple clients on one event.
 * @param {Object} params
 * @param {string} params.adminUserId
 * @param {string} params.eventId
 * @param {string} params.sectionCategory - section / category label on Event.seats
 * @param {{ client_id: string, share_percent: number }[]} params.clients
 * @returns {Promise<{ joint_event_group_id: string, coe_ids: string[], primary_coe_id: string }>}
 */
async function createJointEventAllocation({ adminUserId, eventId, sectionCategory, clients }) {
  if (!isJointEventAdminEnabled()) {
    throw new Error('Joint event admin feature is disabled');
  }
  const admin = await User.findById(adminUserId);
  if (!admin || admin.role !== 'admin') {
    throw new Error('Admin only');
  }
  if (!eventId || !sectionCategory || !Array.isArray(clients) || clients.length < 2) {
    throw new Error('eventId, sectionCategory, and at least two clients are required');
  }
  const percents = clients.map((c) => Number(c.share_percent));
  if (percents.some((p) => !Number.isFinite(p) || p <= 0)) {
    throw new Error('Each client needs a positive share_percent');
  }
  const sum = percents.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error('share_percent values must sum to 100');
  }

  const event = await Event.findById(eventId);
  if (!event) {
    throw new Error('Event not found');
  }

  const targetSeat = findFirstAvailableSeatInSection(event, sectionCategory);
  if (!targetSeat || !targetSeat._id) {
    throw new Error('No available table found for that section');
  }

  const tableTotal = Number(targetSeat.event_price || targetSeat.base_price || 0);
  if (!Number.isFinite(tableTotal) || tableTotal <= 0) {
    throw new Error('Selected table has no valid price');
  }

  const shareDollars = splitTableTotalByPercent(tableTotal, percents);
  const jointGroupId = crypto.randomUUID();
  const seatSubdocId = targetSeat._id;

  await reserveSeatPendingJoint(event._id, seatSubdocId, jointGroupId, adminUserId);

  const createdCoeIds = [];
  let primaryCoeIdStr = null;

  try {
    for (let i = 0; i < clients.length; i++) {
      const { client_id: clientId, share_percent: pct } = clients[i];
      const client = await User.findById(clientId);
      if (!client || client.role !== 'client') {
        throw new Error(`Invalid client_id at index ${i}`);
      }

      const isPrimary = i === 0;
      const share = shareDollars[i];

      const existing = await findActiveCoeForClient(clientId, adminUserId);
      let coeDoc;
      let createdJointOnlyApproved = false;

      if (existing) {
        const dupSummary = await proposalGroupService.duplicateCoeAsProposal(existing._id.toString(), adminUserId);
        const dupId =
          dupSummary?._id?.toString?.() ||
          dupSummary?.id?.toString?.() ||
          (dupSummary && dupSummary._id && String(dupSummary._id));
        if (!dupId) {
          throw new Error('Failed to duplicate COE');
        }
        coeDoc = await COE.findById(dupId);
        if (!coeDoc) {
          throw new Error('Failed to load duplicated COE');
        }
        await appendJointToCoeDoc(coeDoc, {
          event,
          targetSeat,
          shareDollars: share,
          sharePercent: pct,
          jointGroupId,
          isPrimary,
          primaryCoeIdStr: primaryCoeIdStr || coeDoc._id.toString(),
        });
      } else {
        coeDoc = await createJointOnlyCoe({
          clientId,
          adminUserId,
          event,
          targetSeat,
          shareDollars: share,
          sharePercent: pct,
          jointGroupId,
          isPrimary,
          primaryCoeIdStr: primaryCoeIdStr || '',
        });
        createdJointOnlyApproved = true;
      }

      if (isPrimary) {
        primaryCoeIdStr = coeDoc._id.toString();
      }

      createdCoeIds.push(coeDoc._id.toString());

      try {
        if (coeDoc.status !== 'approved') {
          await coeService.updateCOEStatus(coeDoc._id.toString(), 'approved', adminUserId, {
            skipMultiProposalResolution: true,
            suppressNotifications: false,
          });
        } else if (createdJointOnlyApproved) {
          await notifyClientJointProposalReady(coeDoc._id.toString());
        }
      } catch (stErr) {
        console.error('[jointEventService] publish joint COE failed:', stErr.message);
        throw new Error(
          `Failed to publish experience for a client (${client?.email || clientId}): ${stErr.message}`,
        );
      }
    }

    if (!primaryCoeIdStr) {
      primaryCoeIdStr = createdCoeIds[0];
    }

    const others = createdCoeIds.filter((id) => id !== primaryCoeIdStr);
    await finalizeJointSeatBooking(event._id, seatSubdocId, primaryCoeIdStr, others);

    return {
      joint_event_group_id: jointGroupId,
      coe_ids: createdCoeIds,
      primary_coe_id: primaryCoeIdStr,
      event_id: event._id.toString(),
      seat_subdoc_id: seatSubdocId.toString(),
    };
  } catch (err) {
    console.error('[jointEventService] createJointEventAllocation failed:', err.message);
    try {
      await releaseJointPendingSeat(event._id, seatSubdocId, jointGroupId);
    } catch (relErr) {
      console.error('[jointEventService] release pending seat failed:', relErr.message);
    }
    throw err;
  }
}

/**
 * List distinct section/category labels on an event that have at least one available seat.
 * @param {string} eventId
 */
async function listJointSectionOptions(eventId) {
  const event = await Event.findById(eventId).select('seats name').lean();
  if (!event) {
    throw new Error('Event not found');
  }
  const labels = new Map();
  for (const s of event.seats || []) {
    if (!s || s.status !== 'available') continue;
    const label = (s.category && String(s.category).trim()) || (s.section && String(s.section).trim()) || '';
    if (!label) continue;
    if (!labels.has(label)) labels.set(label, 0);
    labels.set(label, labels.get(label) + 1);
  }
  return {
    event_id: eventId,
    sections: Array.from(labels.entries()).map(([section, available_count]) => ({ section, available_count })),
  };
}

module.exports = {
  createJointEventAllocation,
  listJointSectionOptions,
  splitTableTotalByPercent,
};

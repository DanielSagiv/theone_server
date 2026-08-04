/**
 * Admin paid-COE seat upgrades: pending until on-spot payment, then apply seat/price.
 */
const mongoose = require('mongoose');
const COE = require('../models/COE');
const Event = require('../models/Event');
const {
  applyPricingFromSelectedSeats,
  getCOEById,
  getNegotiatedBaseForSeat,
  resolveThe1FeePercentForSeat,
} = require('./coeService');
const {
  normalizeEventId,
  computeEventLineTotalWithFees,
  buildProposedSeatRow,
  round2,
} = require('../utils/eventLineFeeTotal');

const PENDING_TTL_MS = 30 * 60 * 1000;
const AMOUNT_TOLERANCE = 0.01;

/**
 * @param {unknown} id
 * @returns {string|null}
 */
function idStr(id) {
  if (id == null) return null;
  if (typeof id === 'object' && id._id != null) return id._id.toString();
  if (typeof id.toString === 'function') return id.toString();
  return String(id);
}

/**
 * Section label for an event seat.
 * @param {object} seat
 * @returns {string}
 */
function seatSectionLabel(seat) {
  const raw = seat?.category || seat?.section || 'General';
  return String(raw).trim() || 'General';
}

/**
 * Normalize section labels for comparison.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function sameSection(a, b) {
  return (
    String(a || 'General').trim().toLowerCase() ===
    String(b || 'General').trim().toLowerCase()
  );
}

/**
 * Expire stale pending upgrades and release holds.
 * @param {import('mongoose').Document} coe
 * @returns {Promise<boolean>} whether coe was modified
 */
async function expireStalePendingUpgrades(coe) {
  const now = new Date();
  let changed = false;
  const list = Array.isArray(coe.paid_seat_upgrades) ? coe.paid_seat_upgrades : [];
  for (const up of list) {
    if (up.status !== 'pending_payment') continue;
    if (up.expires_at && up.expires_at < now) {
      await releaseUpgradeHold(coe, up).catch(() => {});
      up.status = 'expired';
      changed = true;
    }
  }
  return changed;
}

/**
 * Release held inventory for a pending upgrade target (if different from current).
 * @param {import('mongoose').Document} coe
 * @param {object} upgrade
 */
async function releaseUpgradeHold(coe, upgrade) {
  const eventId = idStr(upgrade.event_id);
  const targetId = idStr(upgrade.target_seat_id);
  const currentId = idStr(upgrade.current_seat_id);
  if (!eventId || !targetId || targetId === currentId) return;

  const event = await Event.findById(eventId);
  if (!event) return;
  const seat = event.seats.id(targetId);
  if (!seat) return;
  if (seat.status === 'held' && idStr(seat.booking_reference) === idStr(coe._id)) {
    seat.status = 'available';
    seat.booking_reference = undefined;
    seat.booked_at = undefined;
    seat.booked_by = undefined;
    await event.save();
  }
}

/**
 * Hold target seat inventory for pending upgrade.
 * @param {import('mongoose').Document} coe
 * @param {object} eventSeat - event.seats subdoc
 * @param {string} eventId
 */
async function holdTargetSeat(coe, eventSeat, eventId) {
  const event = await Event.findById(eventId);
  if (!event) throw new Error('Event not found');
  const seat = event.seats.id(eventSeat._id);
  if (!seat) throw new Error('Target seat not found in event');
  if (seat.status !== 'available' && seat.status !== 'held') {
    throw new Error('Target seat is not available');
  }
  if (seat.status === 'held' && idStr(seat.booking_reference) !== idStr(coe._id)) {
    throw new Error('Target seat is held by another experience');
  }
  seat.status = 'held';
  seat.booking_reference = coe._id;
  seat.booked_at = new Date();
  seat.booked_by = coe.client_id;
  await event.save();
}

/**
 * Resolve target event seat for upgrade (same section keep; else available in section).
 * Admin may select any section; if the target has no free inventory, keep the current
 * physical seat and apply the requested category/pricing on the COE seat row.
 * @param {object} event
 * @param {object} currentSelected
 * @param {string} targetCategory
 * @returns {object} event.seats element
 */
function resolveTargetEventSeat(event, currentSelected, targetCategory) {
  const currentSeatId = idStr(currentSelected.seat_id);
  let currentEventSeat = event.seats.id(currentSeatId);
  if (!currentEventSeat) {
    currentEventSeat = (event.seats || []).find((s) => {
      return idStr(s._id) === currentSeatId || idStr(s.seat_id) === currentSeatId;
    });
  }
  if (!currentEventSeat) {
    throw new Error('Current seat not found in event');
  }

  const currentCat =
    currentSelected.category || seatSectionLabel(currentEventSeat);
  if (sameSection(targetCategory, currentCat)) {
    return currentEventSeat;
  }

  const needCap = Number(currentSelected.capacity) || 1;
  const available = (event.seats || []).filter((s) => {
    if (s.status !== 'available') return false;
    if (!sameSection(seatSectionLabel(s), targetCategory)) return false;
    return (Number(s.capacity) || 0) >= needCap;
  });
  if (available.length === 0) {
    return currentEventSeat;
  }
  available.sort((a, b) => {
    const pa = Number(a.event_price) || Number(a.min_spend) || 0;
    const pb = Number(b.event_price) || Number(b.min_spend) || 0;
    return pa - pb;
  });
  return available[0];
}

/**
 * Create a pending paid seat upgrade (does not mutate selected_seats).
 * @param {string} coeId
 * @param {string} adminUserId
 * @param {object} body
 * @returns {Promise<{ coe: object, upgrade: object }>}
 */
async function createPaidSeatUpgrade(coeId, adminUserId, body) {
  const eventId = normalizeEventId(body.event_id);
  const targetCategory = String(body.seat_category || body.category || '').trim();
  if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
    throw new Error('event_id is required');
  }
  if (!targetCategory) {
    throw new Error('seat_category is required');
  }

  const negotiatedBase = Number(body.event_price ?? body.the1_base_price);
  if (!Number.isFinite(negotiatedBase) || negotiatedBase <= 0) {
    throw new Error('event_price must be a positive number');
  }

  const the1FeePercent =
    body.the1_fee_percent != null && body.the1_fee_percent !== ''
      ? Number(body.the1_fee_percent)
      : 20;
  if (!Number.isFinite(the1FeePercent) || the1FeePercent < 0 || the1FeePercent > 100) {
    throw new Error('the1_fee_percent must be between 0 and 100');
  }

  const isSimpleJoint =
    body.is_simple_joint === true || body.is_simple_joint === 'true';
  const venueCatalog =
    body.venue_catalog_price != null && body.venue_catalog_price !== ''
      ? Number(body.venue_catalog_price)
      : null;

  const coe = await COE.findById(coeId);
  if (!coe) throw new Error('COE not found');

  if ((coe.payment_status || '').toString().toLowerCase() !== 'paid') {
    throw new Error('Seat upgrades require an experience paid in full');
  }

  const expiredChanged = await expireStalePendingUpgrades(coe);
  if (expiredChanged) {
    await coe.save();
  }

  const existingPending = (coe.paid_seat_upgrades || []).find(
    (u) => u.status === 'pending_payment' && idStr(u.event_id) === eventId
  );
  if (existingPending) {
    throw new Error(
      'A pending upgrade already exists for this event. Complete payment or cancel it first.'
    );
  }

  const onCoe = (coe.events || []).some(
    (ev) => normalizeEventId(ev.event_id) === eventId
  );
  if (!onCoe) throw new Error('Event not found on this experience');

  const seatIndex = (coe.selected_seats || []).findIndex(
    (s) => normalizeEventId(s.event_id) === eventId
  );
  if (seatIndex === -1) {
    throw new Error('Current seat not found in COE');
  }
  const currentSelected = coe.selected_seats[seatIndex];
  const currentBase = getNegotiatedBaseForSeat(currentSelected);
  if (negotiatedBase <= currentBase + AMOUNT_TOLERANCE) {
    throw new Error(
      'Upgrade base price must be higher than the current negotiated min spend'
    );
  }

  const event = await Event.findById(eventId);
  if (!event) throw new Error('Event not found');

  const targetEventSeat = resolveTargetEventSeat(
    event,
    currentSelected,
    targetCategory
  );
  const targetSeatId = targetEventSeat._id;
  const samePhysical =
    idStr(targetSeatId) === idStr(currentSelected.seat_id);

  if (!samePhysical) {
    await holdTargetSeat(coe, targetEventSeat, eventId);
  }

  const currentLineTotal = await computeEventLineTotalWithFees(eventId, [
    currentSelected,
  ]);

  const proposedRow = buildProposedSeatRow(currentSelected, {
    seat_id: targetSeatId,
    seat_code: targetEventSeat.code || currentSelected.seat_code,
    category: targetCategory,
    capacity: targetEventSeat.capacity || currentSelected.capacity,
    base_price:
      Number(targetEventSeat.min_spend) ||
      Number(targetEventSeat.event_min_spend) ||
      negotiatedBase,
    event_price: negotiatedBase,
    the1_fee_percent: the1FeePercent,
    venue_catalog_price: isSimpleJoint
      ? null
      : Number.isFinite(venueCatalog) && venueCatalog > 0
        ? venueCatalog
        : null,
    is_simple_joint: isSimpleJoint,
    simple_joint_original_price: isSimpleJoint
      ? Number(targetEventSeat.event_price) ||
        Number(targetEventSeat.min_spend) ||
        negotiatedBase
      : null,
    simple_joint_manual_price: isSimpleJoint ? negotiatedBase : null,
  });

  const proposedLineTotal = await computeEventLineTotalWithFees(eventId, [
    proposedRow,
  ]);
  const delta = round2(proposedLineTotal - currentLineTotal);
  if (delta <= AMOUNT_TOLERANCE) {
    if (!samePhysical) {
      await releaseUpgradeHold(coe, {
        event_id: eventId,
        target_seat_id: targetSeatId,
        current_seat_id: currentSelected.seat_id,
      });
    }
    throw new Error('Upgrade fee-inclusive total must be higher than current');
  }

  const upgrade = {
    event_id: new mongoose.Types.ObjectId(eventId),
    status: 'pending_payment',
    current_seat_id: currentSelected.seat_id,
    current_seat_code: currentSelected.seat_code,
    current_category: currentSelected.category || null,
    current_event_price: currentSelected.event_price,
    current_base_price: currentSelected.base_price,
    current_the1_fee_percent: resolveThe1FeePercentForSeat(currentSelected),
    current_line_total_with_fees: currentLineTotal,
    target_seat_id: targetSeatId,
    target_seat_code: targetEventSeat.code || currentSelected.seat_code,
    target_category: targetCategory,
    venue_catalog_price: proposedRow.venue_catalog_price,
    the1_fee_percent: the1FeePercent,
    event_price: negotiatedBase,
    base_price: proposedRow.base_price,
    is_simple_joint: isSimpleJoint,
    simple_joint_manual_price: isSimpleJoint ? negotiatedBase : null,
    upgrade_delta_with_fees: delta,
    payment_id: null,
    created_by: new mongoose.Types.ObjectId(adminUserId),
    expires_at: new Date(Date.now() + PENDING_TTL_MS),
    created_at: new Date(),
  };

  coe.paid_seat_upgrades = coe.paid_seat_upgrades || [];
  coe.paid_seat_upgrades.push(upgrade);
  await coe.save();

  const saved = coe.paid_seat_upgrades[coe.paid_seat_upgrades.length - 1];
  const populated = await getCOEById(coeId);
  return {
    coe: populated,
    upgrade: serializeUpgrade(saved),
  };
}

/**
 * @param {object} upgrade
 * @returns {object}
 */
function serializeUpgrade(upgrade) {
  const u =
    typeof upgrade.toObject === 'function' ? upgrade.toObject() : { ...upgrade };
  return {
    id: u._id?.toString?.() || String(u._id),
    event_id: idStr(u.event_id),
    status: u.status,
    current_seat_id: idStr(u.current_seat_id),
    current_seat_code: u.current_seat_code,
    current_category: u.current_category,
    current_line_total_with_fees: u.current_line_total_with_fees,
    target_seat_id: idStr(u.target_seat_id),
    target_seat_code: u.target_seat_code,
    target_category: u.target_category,
    venue_catalog_price: u.venue_catalog_price,
    the1_fee_percent: u.the1_fee_percent,
    event_price: u.event_price,
    base_price: u.base_price,
    upgrade_delta_with_fees: u.upgrade_delta_with_fees,
    payment_id: idStr(u.payment_id),
    adhoc_payer: u.adhoc_payer || null,
    expires_at: u.expires_at,
    applied_at: u.applied_at,
    created_at: u.created_at,
  };
}

/**
 * Cancel a pending paid seat upgrade and release hold.
 * @param {string} coeId
 * @param {string} upgradeId
 * @returns {Promise<object>} updated COE
 */
async function cancelPaidSeatUpgrade(coeId, upgradeId) {
  const coe = await COE.findById(coeId);
  if (!coe) throw new Error('COE not found');

  const upgrade = (coe.paid_seat_upgrades || []).id(upgradeId);
  if (!upgrade) throw new Error('Upgrade not found');
  if (upgrade.status !== 'pending_payment') {
    throw new Error('Only pending upgrades can be cancelled');
  }

  await releaseUpgradeHold(coe, upgrade);
  upgrade.status = 'cancelled';
  await coe.save();
  return getCOEById(coeId);
}

/**
 * Validate adhoc amount against pending upgrade; used before charge.
 * @param {import('mongoose').Document} coe
 * @param {string} upgradeId
 * @param {number} amount
 * @param {string} [eventId]
 * @returns {object} upgrade subdoc
 */
function assertPendingUpgradeForCharge(coe, upgradeId, amount, eventId) {
  const upgrade = (coe.paid_seat_upgrades || []).id(upgradeId);
  if (!upgrade) throw new Error('Seat upgrade not found');
  if (
    upgrade.status === 'pending_payment' &&
    upgrade.expires_at &&
    upgrade.expires_at < new Date()
  ) {
    upgrade.status = 'expired';
    // Best-effort persist; caller may not save coe on throw
    coe
      .save()
      .catch((err) =>
        console.error('[paidSeatUpgrade] expire save:', err.message)
      );
    releaseUpgradeHold(coe, upgrade).catch(() => {});
    throw new Error('Seat upgrade expired');
  }
  if (upgrade.status !== 'pending_payment') {
    throw new Error('Seat upgrade is not awaiting payment');
  }
  if (eventId && idStr(upgrade.event_id) !== idStr(eventId)) {
    throw new Error('event_id does not match the seat upgrade');
  }
  const expected = Number(upgrade.upgrade_delta_with_fees);
  const got = Number(amount);
  if (!Number.isFinite(got) || Math.abs(got - expected) > AMOUNT_TOLERANCE) {
    throw new Error(
      `Amount must match upgrade delta ($${expected.toFixed(2)})`
    );
  }
  return upgrade;
}

/**
 * Apply pending upgrade after successful adhoc payment.
 * @param {string} coeId
 * @param {string} upgradeId
 * @param {import('mongoose').Document} payment
 * @returns {Promise<object>} updated COE
 */
async function applyPaidSeatUpgradeAfterPayment(coeId, upgradeId, payment) {
  const coe = await COE.findById(coeId);
  if (!coe) throw new Error('COE not found');

  const upgrade = (coe.paid_seat_upgrades || []).id(upgradeId);
  if (!upgrade) throw new Error('Seat upgrade not found');
  if (upgrade.status === 'applied') {
    return getCOEById(coeId);
  }
  if (upgrade.status !== 'pending_payment') {
    throw new Error('Seat upgrade is not awaiting payment');
  }

  const eventId = idStr(upgrade.event_id);
  const seatIndex = (coe.selected_seats || []).findIndex(
    (s) =>
      normalizeEventId(s.event_id) === eventId &&
      idStr(s.seat_id) === idStr(upgrade.current_seat_id)
  );
  const seatIndexFallback = (coe.selected_seats || []).findIndex(
    (s) => normalizeEventId(s.event_id) === eventId
  );
  const idx = seatIndex >= 0 ? seatIndex : seatIndexFallback;
  if (idx < 0) throw new Error('Current seat not found in COE');

  const existingSeat = coe.selected_seats[idx];
  const samePhysical =
    idStr(upgrade.target_seat_id) === idStr(existingSeat.seat_id);

  const event = await Event.findById(eventId);
  if (!event) throw new Error('Event not found');

  const targetSeat = event.seats.id(upgrade.target_seat_id);
  if (!targetSeat) throw new Error('Target seat not found in event');

  if (!samePhysical) {
    try {
      const oldSeat =
        event.seats.id(existingSeat.seat_id) ||
        (event.seats || []).find(
          (s) => idStr(s._id) === idStr(existingSeat.seat_id)
        );
      if (oldSeat) {
        oldSeat.status = 'available';
        oldSeat.booking_reference = undefined;
        oldSeat.booked_at = undefined;
        oldSeat.booked_by = undefined;
        oldSeat.merged_coe_ids = [];
      }
    } catch (releaseErr) {
      console.error('[paidSeatUpgrade] release old seat:', releaseErr.message);
    }

    targetSeat.status = 'booked';
    targetSeat.booking_reference = coe._id;
    targetSeat.booked_at = new Date();
    targetSeat.booked_by = coe.client_id;
    await event.save();
  }

  const negotiated = Number(upgrade.event_price);
  coe.selected_seats[idx] = {
    event_id: existingSeat.event_id,
    seat_id: upgrade.target_seat_id,
    seat_code:
      upgrade.target_seat_code || targetSeat.code || existingSeat.seat_code,
    category: upgrade.target_category || seatSectionLabel(targetSeat),
    capacity: targetSeat.capacity || existingSeat.capacity,
    base_price: Number(upgrade.base_price) || negotiated,
    event_price: negotiated,
    available_from: existingSeat.available_from,
    available_until: existingSeat.available_until,
    status: existingSeat.status || 'selected',
    is_merged_booking: existingSeat.is_merged_booking || false,
    primary_coe_id: existingSeat.primary_coe_id,
    ai_recommendation: existingSeat.ai_recommendation,
    recommendation_generated_at: existingSeat.recommendation_generated_at,
    recommendation_version: existingSeat.recommendation_version ?? 1,
    is_joint_allocation: existingSeat.is_joint_allocation || false,
    joint_event_group_id: existingSeat.joint_event_group_id || null,
    joint_share_percent: existingSeat.joint_share_percent ?? null,
    is_simple_joint: upgrade.is_simple_joint === true,
    simple_joint_original_price: upgrade.is_simple_joint
      ? Number(targetSeat.event_price) ||
        Number(targetSeat.min_spend) ||
        negotiated
      : null,
    venue_catalog_price: upgrade.is_simple_joint
      ? null
      : upgrade.venue_catalog_price != null
        ? Number(upgrade.venue_catalog_price)
        : null,
    the1_fee_percent:
      upgrade.the1_fee_percent != null ? Number(upgrade.the1_fee_percent) : null,
  };

  await applyPricingFromSelectedSeats(coe);

  upgrade.status = 'applied';
  upgrade.payment_id = payment._id;
  upgrade.applied_at = new Date();
  if (payment.adhoc_payer) {
    upgrade.adhoc_payer = {
      type: payment.adhoc_payer.type,
      user_id: payment.adhoc_payer.user_id,
      display_name: payment.adhoc_payer.display_name,
      email: payment.adhoc_payer.email,
      phone: payment.adhoc_payer.phone,
    };
  }

  await coe.save();

  try {
    const { logIncident } = require('./coeHistoryService');
    await logIncident({
      coe,
      coeId,
      userId: null,
      userRole: 'admin',
      title: 'Paid seat upgrade applied',
      changes: [
        {
          field: 'seat',
          label: 'Table',
          from: upgrade.current_seat_code,
          to: upgrade.target_seat_code,
          message: `Paid upgrade applied (${upgrade.current_seat_code} → ${upgrade.target_seat_code})`,
        },
      ],
    });
  } catch (historyErr) {
    console.error('[paidSeatUpgrade] history:', historyErr.message);
  }

  return getCOEById(coeId);
}

module.exports = {
  createPaidSeatUpgrade,
  cancelPaidSeatUpgrade,
  assertPendingUpgradeForCharge,
  applyPaidSeatUpgradeAfterPayment,
  serializeUpgrade,
  expireStalePendingUpgrades,
  AMOUNT_TOLERANCE,
};

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
 * Party size for an event line on a COE (event → request → preferences → 1).
 * @param {object} coe
 * @param {string} eventId
 * @returns {number}
 */
function getPartySizeForEvent(coe, eventId) {
  const line = (coe.events || []).find(
    (ev) => normalizeEventId(ev.event_id) === eventId
  );
  const fromLine = Number(line?.party_size);
  if (Number.isFinite(fromLine) && fromLine >= 1) return Math.floor(fromLine);
  const fromOrd = Number(coe.original_request_data?.party_size);
  if (Number.isFinite(fromOrd) && fromOrd >= 1) return Math.floor(fromOrd);
  const fromPrefs = Number(
    coe.preferences?.party_size != null
      ? coe.preferences.party_size
      : coe.preferences?.partySize
  );
  if (Number.isFinite(fromPrefs) && fromPrefs >= 1) return Math.floor(fromPrefs);
  return 1;
}

/**
 * Representative capacity for a section (smallest table that fits party, else any).
 * @param {object} event
 * @param {string} category
 * @param {number} partySize
 * @returns {number|null}
 */
function representativeCapacityForCategory(event, category, partySize) {
  const needCap = Math.max(1, Number(partySize) || 1);
  const inSection = (event.seats || []).filter((s) =>
    sameSection(seatSectionLabel(s), category)
  );
  if (inSection.length === 0) return null;
  const fitting = inSection.filter((s) => (Number(s.capacity) || 0) >= needCap);
  const pool = fitting.length > 0 ? fitting : inSection;
  pool.sort((a, b) => (Number(a.capacity) || 0) - (Number(b.capacity) || 0));
  const cap = Number(pool[0].capacity);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

/**
 * Resolve target event seat for upgrade (same section keep; else available in section).
 * Admin may select any section; if the target has no free inventory that fits party size,
 * keep the current physical seat and apply the requested category/pricing on the COE seat row.
 * @param {object} event
 * @param {object} currentSelected
 * @param {string} targetCategory
 * @param {number} [partySize=1]
 * @returns {{ seat: object, inventoryFallback: boolean }}
 */
function resolveTargetEventSeat(
  event,
  currentSelected,
  targetCategory,
  partySize = 1
) {
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
    return { seat: currentEventSeat, inventoryFallback: false };
  }

  const needCap = Math.max(1, Number(partySize) || 1);
  const available = (event.seats || []).filter((s) => {
    if (s.status !== 'available') return false;
    if (!sameSection(seatSectionLabel(s), targetCategory)) return false;
    return (Number(s.capacity) || 0) >= needCap;
  });
  if (available.length === 0) {
    return { seat: currentEventSeat, inventoryFallback: true };
  }
  // Prefer smallest fitting table, then lowest price.
  available.sort((a, b) => {
    const ca = Number(a.capacity) || 0;
    const cb = Number(b.capacity) || 0;
    if (ca !== cb) return ca - cb;
    const pa = Number(a.event_price) || Number(a.min_spend) || 0;
    const pb = Number(b.event_price) || Number(b.min_spend) || 0;
    return pa - pb;
  });
  return { seat: available[0], inventoryFallback: false };
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

  const partySize = getPartySizeForEvent(coe, eventId);
  const resolved = resolveTargetEventSeat(
    event,
    currentSelected,
    targetCategory,
    partySize
  );
  const targetEventSeat = resolved.seat;
  const inventoryFallback = resolved.inventoryFallback === true;
  const targetSeatId = targetEventSeat._id;
  const samePhysical =
    idStr(targetSeatId) === idStr(currentSelected.seat_id);

  if (!samePhysical) {
    await holdTargetSeat(coe, targetEventSeat, eventId);
  }

  const currentLineTotal = await computeEventLineTotalWithFees(eventId, [
    currentSelected,
  ]);

  const fallbackCapacity = inventoryFallback
    ? representativeCapacityForCategory(event, targetCategory, partySize)
    : null;
  const resolvedCapacity =
    (inventoryFallback
      ? fallbackCapacity
      : Number(targetEventSeat.capacity)) ||
    Number(currentSelected.capacity) ||
    1;

  const proposedRow = buildProposedSeatRow(currentSelected, {
    seat_id: targetSeatId,
    seat_code: targetEventSeat.code || currentSelected.seat_code,
    category: targetCategory,
    capacity: resolvedCapacity,
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
    target_inventory_fallback: inventoryFallback,
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
    current_event_price: u.current_event_price,
    current_base_price: u.current_base_price,
    current_the1_fee_percent: u.current_the1_fee_percent,
    current_line_total_with_fees: u.current_line_total_with_fees,
    target_seat_id: idStr(u.target_seat_id),
    target_seat_code: u.target_seat_code,
    target_category: u.target_category,
    target_inventory_fallback: u.target_inventory_fallback === true,
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
  const inventoryFallback = upgrade.target_inventory_fallback === true;
  const partySize = getPartySizeForEvent(coe, eventId);
  const fallbackCapacity = inventoryFallback
    ? representativeCapacityForCategory(
        event,
        upgrade.target_category || seatSectionLabel(targetSeat),
        partySize
      )
    : null;
  const writtenCategory =
    upgrade.target_category || seatSectionLabel(targetSeat);
  const writtenCapacity =
    (inventoryFallback
      ? fallbackCapacity
      : Number(targetSeat.capacity)) ||
    Number(existingSeat.capacity) ||
    1;
  const writtenSeatCode = inventoryFallback
    ? 'TBD'
    : upgrade.target_seat_code || targetSeat.code || existingSeat.seat_code;

  const nextSeatRow = {
    event_id: existingSeat.event_id,
    seat_id: upgrade.target_seat_id,
    seat_code: writtenSeatCode,
    category: writtenCategory,
    capacity: writtenCapacity,
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

  if (typeof coe.selected_seats.set === 'function') {
    coe.selected_seats.set(idx, nextSeatRow);
  } else {
    coe.selected_seats[idx] = nextSeatRow;
  }
  if (typeof coe.markModified === 'function') {
    coe.markModified('selected_seats');
  }

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

  console.log('[paidSeatUpgrade] applied', {
    coe: idStr(coeId),
    event: eventId,
    from_category: upgrade.current_category || null,
    target_category: upgrade.target_category || null,
    written_category: writtenCategory,
    from_seat: idStr(upgrade.current_seat_id),
    to_seat: idStr(upgrade.target_seat_id),
    same_physical: samePhysical,
    inventory_fallback: inventoryFallback,
  });

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
          to: writtenSeatCode,
          message: `Paid upgrade applied (${upgrade.current_seat_code} → ${writtenSeatCode}${
            inventoryFallback ? ', table TBD' : ''
          })`,
        },
      ],
    });
  } catch (historyErr) {
    console.error('[paidSeatUpgrade] history:', historyErr.message);
  }

  return getCOEById(coeId);
}

/**
 * Undo an applied paid seat upgrade after GOAT void/reversal of its adhoc payment.
 * Restores the previous seat/price; does not touch deposit/full payment_status.
 * @param {string} coeId
 * @param {import('mongoose').Document|object} payment
 * @returns {Promise<object|null>} updated COE or null if no applied upgrade
 */
async function revertPaidSeatUpgradeAfterUndo(coeId, payment) {
  const coe = await COE.findById(coeId);
  if (!coe) {
    throw new Error('COE not found');
  }
  const paymentId = idStr(payment?._id || payment?.id);
  if (!paymentId) return null;

  const upgrade = (coe.paid_seat_upgrades || []).find(
    (u) => idStr(u.payment_id) === paymentId && u.status === 'applied',
  );
  if (!upgrade) return null;

  const eventId = idStr(upgrade.event_id);
  const seatIndex = (coe.selected_seats || []).findIndex(
    (s) => normalizeEventId(s.event_id) === eventId,
  );
  if (seatIndex < 0) {
    upgrade.status = 'cancelled';
    await coe.save();
    return getCOEById(coeId);
  }

  const existingSeat = coe.selected_seats[seatIndex];
  const samePhysical =
    idStr(upgrade.current_seat_id) === idStr(existingSeat.seat_id);

  const event = await Event.findById(eventId);
  if (event && !samePhysical) {
    try {
      const targetSeat =
        event.seats.id(existingSeat.seat_id) ||
        (event.seats || []).find(
          (s) => idStr(s._id) === idStr(existingSeat.seat_id),
        );
      if (targetSeat && idStr(targetSeat.booking_reference) === idStr(coe._id)) {
        targetSeat.status = 'available';
        targetSeat.booking_reference = undefined;
        targetSeat.booked_at = undefined;
        targetSeat.booked_by = undefined;
        targetSeat.merged_coe_ids = [];
      }
      const currentSeat =
        event.seats.id(upgrade.current_seat_id) ||
        (event.seats || []).find(
          (s) => idStr(s._id) === idStr(upgrade.current_seat_id),
        );
      if (currentSeat) {
        currentSeat.status = 'booked';
        currentSeat.booking_reference = coe._id;
        currentSeat.booked_at = new Date();
        currentSeat.booked_by = coe.client_id;
      }
      await event.save();
    } catch (seatErr) {
      console.error('[paidSeatUpgrade] revert seats:', seatErr.message);
    }
  }

  const restoredRow = {
    event_id: existingSeat.event_id,
    seat_id: upgrade.current_seat_id,
    seat_code: upgrade.current_seat_code || existingSeat.seat_code,
    category: upgrade.current_category || existingSeat.category,
    capacity: existingSeat.capacity,
    base_price:
      Number(upgrade.current_base_price) || Number(existingSeat.base_price) || 0,
    event_price:
      Number(upgrade.current_event_price) ||
      Number(existingSeat.event_price) ||
      0,
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
    is_simple_joint: existingSeat.is_simple_joint || false,
    simple_joint_original_price: existingSeat.simple_joint_original_price,
    venue_catalog_price: existingSeat.venue_catalog_price,
    the1_fee_percent:
      upgrade.current_the1_fee_percent != null
        ? Number(upgrade.current_the1_fee_percent)
        : existingSeat.the1_fee_percent,
  };

  if (typeof coe.selected_seats.set === 'function') {
    coe.selected_seats.set(seatIndex, restoredRow);
  } else {
    coe.selected_seats[seatIndex] = restoredRow;
  }
  if (typeof coe.markModified === 'function') {
    coe.markModified('selected_seats');
  }

  await applyPricingFromSelectedSeats(coe);
  upgrade.status = 'cancelled';
  await coe.save();

  try {
    const { logIncident } = require('./coeHistoryService');
    await logIncident({
      coe,
      coeId,
      userId: null,
      userRole: 'admin',
      title: 'Paid seat upgrade reversed',
      changes: [
        {
          field: 'seat',
          label: 'Table',
          from: existingSeat.seat_code,
          to: upgrade.current_seat_code,
          message: `On-spot upgrade undone (${existingSeat.seat_code} → ${upgrade.current_seat_code})`,
        },
      ],
    });
  } catch (historyErr) {
    console.error('[paidSeatUpgrade] revert history:', historyErr.message);
  }

  return getCOEById(coeId);
}

module.exports = {
  createPaidSeatUpgrade,
  cancelPaidSeatUpgrade,
  revertPaidSeatUpgradeAfterUndo,
  assertPendingUpgradeForCharge,
  applyPaidSeatUpgradeAfterPayment,
  serializeUpgrade,
  expireStalePendingUpgrades,
  AMOUNT_TOLERANCE,
};

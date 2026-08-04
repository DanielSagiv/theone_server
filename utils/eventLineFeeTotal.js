/**
 * Fee-inclusive event line totals for paid seat upgrades (matches mobile event fee preview math).
 */
const mongoose = require('mongoose');
const Event = require('../models/Event');
const {
  getNegotiatedBaseForSeat,
  resolveThe1FeePercentForSeat,
  computeVenuePricingTotals,
} = require('../services/coeService');

/**
 * @param {unknown} x
 * @returns {number}
 */
function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

/**
 * Normalize event id to string.
 * @param {unknown} eventId
 * @returns {string|null}
 */
function normalizeEventId(eventId) {
  if (eventId == null) return null;
  if (typeof eventId === 'object' && eventId._id != null) {
    return eventId._id.toString();
  }
  if (typeof eventId.toString === 'function') {
    return eventId.toString();
  }
  return String(eventId);
}

/**
 * Fee-inclusive total for one event's seat rows (MS + venue fees + THE1 + processing).
 * @param {Array<object>} seatRows - selected_seats-shaped rows for a single event
 * @param {object|null} location - populated Location or null
 * @returns {number}
 */
function computeSeatRowsLineTotalWithFees(seatRows, location) {
  if (!Array.isArray(seatRows) || seatRows.length === 0) {
    return 0;
  }
  let ms = 0;
  let the1FeeSum = 0;
  for (const row of seatRows) {
    const base = getNegotiatedBaseForSeat(row);
    ms += base;
    the1FeeSum += base * (resolveThe1FeePercentForSeat(row) / 100);
  }
  const v = computeVenuePricingTotals(ms, location || null, the1FeeSum);
  return round2(v.ms + v.vf + v.st + v.gratuity + v.the1 + v.processing);
}

/**
 * Load event location for fee percents.
 * @param {string} eventId
 * @returns {Promise<object|null>}
 */
async function loadEventLocation(eventId) {
  if (!eventId || !mongoose.Types.ObjectId.isValid(eventId)) {
    return null;
  }
  const event = await Event.findById(eventId).populate('location_id').lean();
  if (!event) return null;
  const loc = event.location_id;
  return loc && typeof loc === 'object' ? loc : null;
}

/**
 * Compute fee-inclusive line total for seat rows on an event.
 * @param {string} eventId
 * @param {Array<object>} seatRows
 * @returns {Promise<number>}
 */
async function computeEventLineTotalWithFees(eventId, seatRows) {
  const location = await loadEventLocation(eventId);
  return computeSeatRowsLineTotalWithFees(seatRows, location);
}

/**
 * Build a hypothetical selected_seats row for fee preview / apply.
 * @param {object} baseRow - existing selected_seats entry
 * @param {object} patch - fields to overlay (event_price, the1_fee_percent, seat_id, …)
 * @returns {object}
 */
function buildProposedSeatRow(baseRow, patch) {
  return {
    ...((baseRow && typeof baseRow.toObject === 'function'
      ? baseRow.toObject()
      : baseRow) || {}),
    ...patch,
  };
}

module.exports = {
  round2,
  normalizeEventId,
  computeSeatRowsLineTotalWithFees,
  computeEventLineTotalWithFees,
  loadEventLocation,
  buildProposedSeatRow,
};

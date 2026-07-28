/**
 * Maps client REST request-update body to create_coe_draft tool params.
 */
const { extractPreferenceKeywords } = require('../services/botPreferenceService');
const { normalizeCoeDatePair } = require('./calendarDateOnly');

/**
 * @param {object|undefined|null} existingSubdoc
 * @param {object} patch
 * @returns {object}
 */
function mergeClientOriginalRequestData(existingSubdoc, patch) {
  let prev = {};
  if (existingSubdoc != null && typeof existingSubdoc === 'object') {
    try {
      prev =
        typeof existingSubdoc.toObject === 'function'
          ? existingSubdoc.toObject()
          : { ...existingSubdoc };
    } catch (e) {
      prev = { ...existingSubdoc };
    }
    if (prev.budget != null && typeof prev.budget === 'object') {
      prev = { ...prev, budget: { ...prev.budget } };
    }
  }

  if (patch.city != null && String(patch.city).trim()) {
    prev.city = String(patch.city).trim();
  }
  if (patch.party_size != null && patch.party_size !== '') {
    const ps = Number(patch.party_size);
    if (!Number.isNaN(ps) && ps >= 1) {
      prev.party_size = Math.floor(ps);
    }
  } else if (Array.isArray(patch.event_selections) && patch.event_selections.length > 0) {
    const fromEvents = patch.event_selections
      .map(row => Number(row?.party_size))
      .filter(n => Number.isFinite(n) && n >= 1)
      .map(n => Math.floor(n));
    if (fromEvents.length > 0) {
      prev.party_size = Math.max(...fromEvents);
    }
  }
  if (patch.budget && typeof patch.budget === 'object') {
    prev.budget = { ...(prev.budget || {}) };
    if (patch.budget.max != null && patch.budget.max !== '') {
      const bm = Number(patch.budget.max);
      if (!Number.isNaN(bm) && bm >= 0) {
        prev.budget.max = bm;
      }
    }
    if (patch.budget.currency != null && patch.budget.currency !== '') {
      prev.budget.currency = patch.budget.currency;
    }
  }
  if (patch.start_date && patch.end_date) {
    const { startDate, endDate } = normalizeCoeDatePair(
      patch.start_date,
      patch.end_date,
    );
    prev.requested_dates = {
      start_date: startDate,
      end_date: endDate,
    };
  }
  if (patch.seat_preferences !== undefined) {
    prev.seat_preferences = patch.seat_preferences || '';
  }
  if (patch.specific_preferences !== undefined) {
    prev.general_preferences = patch.specific_preferences || '';
  }
  if (patch.open_to_join_events !== undefined) {
    prev.open_to_join_events = patch.open_to_join_events === true;
  }

  return prev;
}

/**
 * @param {object} body Validated client request update body
 * @param {string} coeId
 * @returns {object} create_coe_draft tool params
 */
function buildCreateCoeDraftParamsFromClientRequest(body, coeId) {
  const budgetMax =
    body.budget?.max != null ? Number(body.budget.max) : null;

  const selections = Array.isArray(body.event_selections)
    ? body.event_selections
    : [];
  let partySize =
    body.party_size != null &&
    Number.isFinite(Number(body.party_size)) &&
    Number(body.party_size) >= 1
      ? Math.floor(Number(body.party_size))
      : null;
  if (partySize == null && selections.length > 0) {
    const fromEvents = selections
      .map(row => Number(row?.party_size))
      .filter(n => Number.isFinite(n) && n >= 1)
      .map(n => Math.floor(n));
    if (fromEvents.length > 0) {
      partySize = Math.max(...fromEvents);
    }
  }

  const preferences = {
    city: body.city || null,
    budget_range: budgetMax != null ? { max: budgetMax } : undefined,
    location_preferences: body.city ? [body.city] : [],
    party_size: partySize,
    preferences: extractPreferenceKeywords(
      body.seat_preferences || '',
      body.specific_preferences || '',
    ),
    notes: `${body.seat_preferences || ''}\n${body.specific_preferences || ''}`.trim(),
    seat_preferences: body.seat_preferences || '',
    specific_preferences: body.specific_preferences || '',
  };

  const toolParams = {
    start_date: body.start_date,
    end_date: body.end_date,
    request_coe_id: coeId,
    preferences,
    manual_event_selection: true,
  };

  if (selections.length > 0) {
    toolParams.events = selections.map(row => {
      const eventId = row.event_id;
      return {
        event_id: eventId,
        selected_seats: [],
        preferred_seat_category: row.seat_category || null,
        simple_joint_manual_price:
          row.simple_joint_manual_price != null &&
          Number.isFinite(Number(row.simple_joint_manual_price))
            ? Number(row.simple_joint_manual_price)
            : null,
        simple_joint_the1_fee_percent:
          row.simple_joint_the1_fee_percent != null &&
          Number.isFinite(Number(row.simple_joint_the1_fee_percent))
            ? Math.min(100, Math.max(0, Number(row.simple_joint_the1_fee_percent)))
            : null,
        the1_pricing:
          row.the1_base_price != null &&
          Number.isFinite(Number(row.the1_base_price))
            ? {
                venue_catalog_price:
                  row.venue_catalog_price != null &&
                  Number.isFinite(Number(row.venue_catalog_price))
                    ? Number(row.venue_catalog_price)
                    : null,
                the1_base_price: Number(row.the1_base_price),
                the1_fee_percent:
                  row.the1_fee_percent != null &&
                  Number.isFinite(Number(row.the1_fee_percent))
                    ? Number(row.the1_fee_percent)
                    : 20,
              }
            : null,
        party_size:
          row.party_size != null &&
          Number.isFinite(Number(row.party_size)) &&
          Number(row.party_size) >= 1
            ? Math.floor(Number(row.party_size))
            : partySize,
      };
    });
  }

  return toolParams;
}

module.exports = {
  mergeClientOriginalRequestData,
  buildCreateCoeDraftParamsFromClientRequest,
};

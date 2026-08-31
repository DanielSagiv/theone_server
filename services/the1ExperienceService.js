/**
 * THE1 Experience: host inventory COE + spawn client proposal COEs.
 */
const mongoose = require('mongoose');
const COE = require('../models/COE');
const User = require('../models/User');
const Event = require('../models/Event');
const {
  idString,
  isThe1ExperienceHost,
  isThe1ExperienceChild,
  eventIdFromRow,
} = require('../utils/the1Experience');

function roundCurrency(amount) {
  return Math.round((Number(amount || 0) + Number.EPSILON) * 100) / 100;
}

/**
 * @param {unknown} raw
 * @param {{ allowZero?: boolean }} [opts]
 * @returns {number|null}
 */
function coerceEventPartySize(raw, opts = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (opts.allowZero) return v >= 0 ? v : null;
  return v >= 1 ? v : null;
}

/**
 * @param {object[]|undefined} events
 * @returns {Map<string, number>}
 */
function partySizeByEventFromLines(events) {
  const map = new Map();
  for (const row of events || []) {
    const eid = eventIdFromRow(row);
    const n = coerceEventPartySize(row?.party_size);
    if (eid && n != null) map.set(eid, n);
  }
  return map;
}

/**
 * @param {Map<string, number>} map
 * @returns {number|null}
 */
function maxPartySizeFromMap(map) {
  let max = null;
  for (const n of map.values()) {
    max = max == null ? n : Math.max(max, n);
  }
  return max;
}

/**
 * Restore map minus allocate map (positive restores remaining).
 * @param {Map<string, number>} [restoreMap]
 * @param {Map<string, number>} [allocateMap]
 * @returns {Map<string, number>}
 */
function mergePartySizeDeltas(restoreMap, allocateMap) {
  const deltas = new Map();
  for (const [eid, n] of restoreMap || []) {
    deltas.set(eid, (deltas.get(eid) || 0) + n);
  }
  for (const [eid, n] of allocateMap || []) {
    deltas.set(eid, (deltas.get(eid) || 0) - n);
  }
  return deltas;
}

/**
 * Mutates host.events[].party_size by signed deltas (negative = allocate).
 * @param {object} host
 * @param {Map<string, number>} deltasByEventId
 * @param {{ skipMissingEvents?: boolean }} [opts]
 * @returns {object}
 */
function applyHostPartySizeDeltas(host, deltasByEventId, opts = {}) {
  if (!host || !deltasByEventId || deltasByEventId.size === 0) {
    return host;
  }
  for (const [eid, delta] of deltasByEventId) {
    const d = Number(delta);
    if (!eid || !Number.isFinite(d) || d === 0) continue;
    const row = (host.events || []).find((e) => eventIdFromRow(e) === eid);
    if (!row) {
      if (opts.skipMissingEvents) continue;
      throw new Error('Selected events must be a subset of the THE1 Experience');
    }
    const current = coerceEventPartySize(row.party_size, { allowZero: true });
    if (current == null) {
      throw new Error('Party size exceeds remaining guests for this event');
    }
    const next = current + Math.trunc(d);
    if (next < 0) {
      throw new Error('Party size exceeds remaining guests for this event');
    }
    row.party_size = next;
  }
  if (typeof host.markModified === 'function') {
    host.markModified('events');
  }
  return host;
}

function clientDisplayName(user) {
  if (!user || typeof user !== 'object') return '';
  const first = String(user.firstName || '').trim();
  const last = String(user.lastName || '').trim();
  return [first, last].filter(Boolean).join(' ').trim() || String(user.email || '').trim();
}

/**
 * @param {object} row
 * @returns {object}
 */
function cloneSelectedSeatRow(row) {
  const src = typeof row.toObject === 'function' ? row.toObject() : { ...row };
  delete src._id;
  return {
    event_id: src.event_id,
    seat_id: src.seat_id,
    seat_code: src.seat_code,
    category: src.category,
    capacity: src.capacity,
    base_price: src.base_price,
    event_price: src.event_price,
    available_from: src.available_from,
    available_until: src.available_until,
    status: 'selected',
    is_merged_booking: true,
    primary_coe_id: src.primary_coe_id || null,
    is_joint_allocation: false,
    joint_event_group_id: null,
    joint_share_percent: null,
    is_simple_joint: src.is_simple_joint === true,
    simple_joint_original_price: src.simple_joint_original_price ?? null,
    venue_catalog_price: src.venue_catalog_price ?? null,
    the1_fee_percent: src.the1_fee_percent ?? null,
    venue_min_spend_usd: src.venue_min_spend_usd ?? null,
    negotiated_min_spend_usd: src.negotiated_min_spend_usd ?? null,
  };
}

/**
 * @param {object} item
 * @param {string} childCoeId
 * @param {number} sequence
 * @param {number|null|undefined} [partySize]
 * @returns {object}
 */
function cloneEventItem(item, childCoeId, sequence, partySize) {
  const src = typeof item.toObject === 'function' ? item.toObject() : { ...item };
  delete src._id;
  const clientParty = coerceEventPartySize(partySize);
  const srcParty = coerceEventPartySize(src.party_size);
  return {
    coe_id: childCoeId,
    event_id: src.event_id,
    event_date: src.event_date,
    event_time: src.event_time,
    base_price: src.base_price || 0,
    quantity: src.quantity || 1,
    total_price: src.total_price || 0,
    status: 'pending',
    sequence,
    party_size: clientParty != null ? clientParty : srcParty,
    notes: src.notes,
    client_notes: src.client_notes,
  };
}

/**
 * @param {object} host
 * @param {Array<{ event_id: string, buy_in: number, party_size?: number }>} eventBuyIns
 * @returns {{
 *   eventIds: Set<string>,
 *   buyInByEvent: Map<string, number>,
 *   partySizeByEvent: Map<string, number>,
 *   events: object[],
 *   seats: object[],
 * }}
 */
function pickHostEventsAndSeats(host, eventBuyIns) {
  const buyInByEvent = new Map();
  const partySizeByEvent = new Map();
  for (const row of eventBuyIns || []) {
    const eid = idString(row.event_id);
    const buyIn = roundCurrency(row.buy_in);
    if (!eid || buyIn <= 0) {
      throw new Error('Each selected event requires a buy-in greater than zero');
    }
    const partySize = coerceEventPartySize(row.party_size);
    if (partySize == null) {
      throw new Error('Each selected event requires a party size of at least 1');
    }
    buyInByEvent.set(eid, buyIn);
    partySizeByEvent.set(eid, partySize);
  }
  if (buyInByEvent.size === 0) {
    throw new Error('Select at least one event');
  }

  const hostEventIds = new Set(
    (host.events || []).map((e) => eventIdFromRow(e)).filter(Boolean),
  );
  for (const eid of buyInByEvent.keys()) {
    if (!hostEventIds.has(eid)) {
      throw new Error('Selected events must be a subset of the THE1 Experience');
    }
  }

  const events = (host.events || []).filter((e) =>
    buyInByEvent.has(eventIdFromRow(e)),
  );
  const seats = (host.selected_seats || []).filter((s) =>
    buyInByEvent.has(eventIdFromRow(s)),
  );
  if (seats.length === 0) {
    throw new Error('No tables on the THE1 Experience match the selected events');
  }
  return {
    eventIds: new Set(buyInByEvent.keys()),
    buyInByEvent,
    partySizeByEvent,
    events,
    seats,
  };
}

/**
 * Stamp client buy-in onto cloned seat rows. Catalog/host price kept for strikethrough.
 * @param {object[]} seats
 * @param {Map<string, number>} buyInByEvent
 * @returns {object[]}
 */
function applyBuyInsToSeats(seats, buyInByEvent) {
  return seats.map((row) => {
    const eid = eventIdFromRow(row);
    const buyIn = buyInByEvent.get(eid);
    const hostPrice = roundCurrency(row.event_price || row.base_price || 0);
    const catalog =
      row.simple_joint_original_price ??
      row.venue_catalog_price ??
      hostPrice;
    return {
      ...row,
      event_price: buyIn,
      base_price: buyIn,
      is_simple_joint: true,
      simple_joint_original_price:
        Number(row.simple_joint_original_price) > 0
          ? row.simple_joint_original_price
          : catalog,
    };
  });
}

function hostEventDisplayName(host, eid) {
  const item = (host?.events || []).find((e) => eventIdFromRow(e) === eid);
  if (!item) return '';
  const ev = item.event_id;
  if (ev && typeof ev === 'object') {
    const fromName = String(ev.name || ev.event_name || '').trim();
    if (fromName) return fromName;
    const performers = Array.isArray(ev.performers) ? ev.performers : [];
    const p = performers.find((x) => x && String(x.name || '').trim());
    if (p) return String(p.name).trim();
  }
  return String(item.event_name || '').trim();
}

/**
 * Per-event buy-in lines for one child (names from populated host events).
 * @param {object} host
 * @param {object} child
 * @returns {Array<{ event_id: string, name: string, buy_in: number }>}
 */
function childEventBuyInLines(host, child) {
  const seats = Array.isArray(child?.selected_seats) ? child.selected_seats : [];
  const byEvent = new Map();
  for (const s of seats) {
    const eid = eventIdFromRow(s);
    if (!eid) continue;
    const buyIn = roundCurrency(Number(s.event_price) || Number(s.base_price) || 0);
    const prev = byEvent.get(eid);
    if (prev) {
      prev.buy_in = roundCurrency(prev.buy_in + buyIn);
    } else {
      byEvent.set(eid, {
        event_id: eid,
        name: hostEventDisplayName(host, eid) || 'Event',
        buy_in: buyIn,
      });
    }
  }
  return [...byEvent.values()];
}

/**
 * @param {object} host
 * @param {object[]} children
 * @returns {object}
 */
function formatHostSummary(host, children) {
  const seatPriceSum = roundCurrency(
    (host.selected_seats || []).reduce(
      (sum, s) => sum + (Number(s.event_price) || Number(s.base_price) || 0),
      0,
    ),
  );
  const tableCost = roundCurrency(
    Number(host.total) > 0 ? host.total : seatPriceSum,
  );
  const list = Array.isArray(children) ? children : [];
  let buyInCollected = 0;
  let onSpotCollected = 0;
  let buyInAssigned = 0;
  const clients = list.map((ch) => {
    const paid = roundCurrency(ch.total_paid || 0);
    buyInCollected += paid;
    onSpotCollected += roundCurrency(ch.adhoc_collected_total || 0);
    const eventIds = [
      ...new Set(
        (ch.selected_seats || [])
          .map((s) => eventIdFromRow(s))
          .filter(Boolean),
      ),
    ];
    const client = ch.client_id;
    const firstName =
      client && typeof client === 'object' ? String(client.firstName || '').trim() : '';
    const lastName =
      client && typeof client === 'object' ? String(client.lastName || '').trim() : '';
    const email =
      client && typeof client === 'object' ? String(client.email || '').trim() : '';
    const avatarUrl =
      client && typeof client === 'object' && client.avatarUrl
        ? String(client.avatarUrl).trim()
        : '';
    const avatarThumb =
      client && typeof client === 'object' && client.avatar_thumb_url
        ? String(client.avatar_thumb_url).trim()
        : '';
    const event_lines = childEventBuyInLines(host, ch);
    buyInAssigned += event_lines.reduce(
      (sum, line) => sum + (Number(line.buy_in) || 0),
      0,
    );
    return {
      coe_id: idString(ch._id),
      client_id: idString(client?._id || client),
      name: clientDisplayName(client),
      firstName,
      lastName,
      email,
      avatarUrl: avatarUrl || null,
      avatar_thumb_url: avatarThumb || null,
      buy_in_total: roundCurrency(ch.total || 0),
      amount_paid: paid,
      payment_status: ch.payment_status || 'unpaid',
      status: ch.status,
      event_ids: eventIds,
      event_lines,
    };
  });
  onSpotCollected += roundCurrency(host.adhoc_collected_total || 0);
  return {
    client_count: clients.length,
    table_cost: tableCost,
    table_price: seatPriceSum,
    buy_in_collected: roundCurrency(buyInCollected),
    buy_in_assigned: roundCurrency(buyInAssigned),
    on_spot_collected: roundCurrency(onSpotCollected),
    clients,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId|string} hostId
 * @returns {Promise<object[]>}
 */
async function loadHostChildren(hostId) {
  return COE.find({
    the1_experience_host_id: hostId,
    status: { $ne: 'deleted' },
  })
    .select(
      'the1_experience_host_id total total_paid adhoc_collected_total client_id name selected_seats events status payment_status',
    )
    .populate('client_id', 'firstName lastName email avatarUrl avatar_thumb_url')
    .lean();
}

/**
 * @param {object} host
 * @returns {Promise<object>}
 */
async function buildHostSummary(host) {
  const children = await loadHostChildren(host._id);
  return formatHostSummary(host, children);
}

/**
 * Stash computed host summary without persisting it (not a COE schema path).
 * Mongoose strict mode drops unknown `set()` paths; `$locals` survives toObject.
 * @param {object} host
 * @param {object} summary
 */
function stashHostSummary(host, summary) {
  if (!host || summary == null) return;
  if (host.$locals && typeof host.$locals === 'object') {
    host.$locals.the1_experience_summary = summary;
  }
  host.the1_experience_summary = summary;
}

/**
 * Attach the1_experience_summary on host docs in a list (one query).
 * @param {object[]} coes
 * @returns {Promise<Map<string, object>>} host id string → summary
 */
async function attachHostSummaries(coes) {
  const summariesByHostId = new Map();
  if (!Array.isArray(coes) || coes.length === 0) return summariesByHostId;
  const hosts = coes.filter((c) => isThe1ExperienceHost(c));
  if (hosts.length === 0) return summariesByHostId;
  const hostIdStrings = [
    ...new Set(hosts.map((h) => idString(h._id)).filter(Boolean)),
  ];
  const hostObjectIds = hostIdStrings
    .filter((s) => mongoose.Types.ObjectId.isValid(s))
    .map((s) => new mongoose.Types.ObjectId(s));
  const children = await COE.find({
    status: { $ne: 'deleted' },
    $or: [
      { the1_experience_host_id: { $in: hostObjectIds } },
      { the1_experience_host_id: { $in: hostIdStrings } },
    ],
  })
    .select(
      'the1_experience_host_id total total_paid adhoc_collected_total client_id selected_seats status payment_status',
    )
    .populate('client_id', 'firstName lastName email avatarUrl avatar_thumb_url')
    .lean();
  const byHost = new Map();
  for (const ch of children) {
    const hid = idString(ch.the1_experience_host_id);
    if (!hid) continue;
    if (!byHost.has(hid)) byHost.set(hid, []);
    byHost.get(hid).push(ch);
  }
  for (const host of hosts) {
    const hid = idString(host._id);
    const summary = formatHostSummary(host, byHost.get(hid) || []);
    stashHostSummary(host, summary);
    summariesByHostId.set(hid, summary);
  }
  return summariesByHostId;
}

/**
 * @param {object} host
 * @param {string} childId
 * @param {Set<string>} eventIds
 */
async function attachChildToHostEventSeats(host, childId, eventIds) {
  const childOid = new mongoose.Types.ObjectId(idString(childId));
  for (const seat of host.selected_seats || []) {
    const eid = eventIdFromRow(seat);
    const seatId = seat.seat_id;
    if (!seatId) continue;
    const onEvent = eventIds && eventIds.has(eid);
    await Event.updateOne(
      { _id: seat.event_id, 'seats._id': seatId },
      onEvent
        ? { $addToSet: { 'seats.$.merged_coe_ids': childOid } }
        : { $pull: { 'seats.$.merged_coe_ids': childOid } },
    );
  }
}

/**
 * Persist host child count so GET /coes/my list JSON includes it (schema path).
 * @param {import('mongoose').Types.ObjectId|string} hostId
 * @returns {Promise<number>}
 */
async function syncHostClientCount(hostId) {
  const hid = idString(hostId);
  if (!hid || !mongoose.Types.ObjectId.isValid(hid)) {
    return 0;
  }
  const oid = new mongoose.Types.ObjectId(hid);
  const n = await COE.countDocuments({
    status: { $ne: 'deleted' },
    $or: [
      { the1_experience_host_id: oid },
      { the1_experience_host_id: hid },
    ],
  });
  await COE.updateOne(
    { _id: oid },
    { $set: { the1_experience_client_count: n } },
  );
  return n;
}

/**
 * Spawn a client proposal from a THE1 Experience host and approve it (push as today).
 * @param {string} hostId
 * @param {{ client_id: string, deposit_percent?: number, events: Array<{ event_id: string, buy_in: number, party_size: number }> }} payload
 * @param {string} adminId
 * @returns {Promise<object>}
 */
async function addClientToThe1Experience(hostId, payload, adminId) {
  const host = await COE.findById(hostId);
  if (!host || host.status === 'deleted') {
    throw new Error('THE1 Experience not found');
  }
  if (!isThe1ExperienceHost(host)) {
    throw new Error('This experience is not a THE1 Experience host');
  }

  const clientId = payload?.client_id;
  if (!clientId || !String(clientId).match(/^[0-9a-fA-F]{24}$/)) {
    throw new Error('A valid client is required');
  }
  const client = await User.findById(clientId).select(
    'firstName lastName email role isActive',
  );
  if (!client || client.isActive === false) {
    throw new Error('Client not found');
  }
  if (client.role && String(client.role).toLowerCase() !== 'client') {
    throw new Error('Selected user is not a client');
  }

  const picked = pickHostEventsAndSeats(host, payload.events);
  applyHostPartySizeDeltas(
    host,
    mergePartySizeDeltas(new Map(), picked.partySizeByEvent),
  );
  const childId = new mongoose.Types.ObjectId();
  const clonedEvents = picked.events.map((item, i) =>
    cloneEventItem(
      item,
      childId,
      i + 1,
      picked.partySizeByEvent.get(eventIdFromRow(item)),
    ),
  );
  const clonedSeats = applyBuyInsToSeats(
    picked.seats.map((s) => {
      const row = cloneSelectedSeatRow(s);
      row.primary_coe_id = host._id;
      row.coe_id = childId;
      return row;
    }),
    picked.buyInByEvent,
  );

  const depositPercent =
    typeof payload.deposit_percent === 'number' &&
    payload.deposit_percent >= 1 &&
    payload.deposit_percent <= 100
      ? Math.round(payload.deposit_percent)
      : 100;

  const clientParty = maxPartySizeFromMap(picked.partySizeByEvent);
  const clientName = clientDisplayName(client) || 'Client';
  const child = new COE({
    _id: childId,
    name: `${clientName} — ${host.name || 'THE1 Experience'}`,
    description: host.description || 'THE1 Experience',
    status: 'draft',
    created_method: 'manual',
    created_by: adminId,
    client_id: client._id,
    admin_id: host.admin_id || adminId,
    currency: host.currency || 'USD',
    start_date: host.start_date,
    end_date: host.end_date,
    events: clonedEvents,
    selected_seats: clonedSeats,
    is_the1_event: true,
    is_the1_experience_host: false,
    the1_experience_host_id: host._id,
    deposit_percent: depositPercent,
    original_request_data: {
      ...(host.original_request_data && typeof host.original_request_data === 'object'
        ? {
            city: host.original_request_data.city,
            requested_dates: host.original_request_data.requested_dates,
            party_size:
              clientParty != null
                ? clientParty
                : host.original_request_data.party_size,
            budget: host.original_request_data.budget,
          }
        : clientParty != null
          ? { party_size: clientParty }
          : {}),
      is_the1_event: true,
    },
  });

  const coeService = require('./coeService');
  await coeService.applyPricingFromSelectedSeats(child);
  await child.save();
  await host.save();
  await attachChildToHostEventSeats(host, child._id, picked.eventIds);

  const approved = await coeService.updateCOEStatus(child._id, 'approved', adminId);
  await syncHostClientCount(host._id);
  return approved;
}

function childBuyInAlreadyPaid(child) {
  const ps = String(child?.payment_status || '').toLowerCase();
  return ps === 'paid' || ps === 'deposit_paid';
}

/**
 * Update an unpaid child proposal's event subset and buy-in.
 * @param {string} hostId
 * @param {string} childId
 * @param {{ events: Array<{ event_id: string, buy_in: number, party_size: number }>, deposit_percent?: number }} payload
 * @returns {Promise<object>}
 */
async function updateThe1ExperienceClient(hostId, childId, payload) {
  const host = await COE.findById(hostId);
  if (!host || host.status === 'deleted') {
    throw new Error('THE1 Experience not found');
  }
  if (!isThe1ExperienceHost(host)) {
    throw new Error('This experience is not a THE1 Experience host');
  }

  const child = await COE.findById(childId);
  if (!child || child.status === 'deleted') {
    throw new Error('Client proposal not found');
  }
  if (idString(child.the1_experience_host_id) !== idString(host._id)) {
    throw new Error('Client is not on this THE1 Experience');
  }
  if (childBuyInAlreadyPaid(child)) {
    throw new Error(
      'This client has already paid. Open their proposal to submit a revision.',
    );
  }

  const prevParty = partySizeByEventFromLines(child.events);
  const picked = pickHostEventsAndSeats(host, payload.events);
  applyHostPartySizeDeltas(
    host,
    mergePartySizeDeltas(prevParty, picked.partySizeByEvent),
  );
  const clonedEvents = picked.events.map((item, i) =>
    cloneEventItem(
      item,
      child._id,
      i + 1,
      picked.partySizeByEvent.get(eventIdFromRow(item)),
    ),
  );
  const clonedSeats = applyBuyInsToSeats(
    picked.seats.map((s) => {
      const row = cloneSelectedSeatRow(s);
      row.primary_coe_id = host._id;
      row.coe_id = child._id;
      return row;
    }),
    picked.buyInByEvent,
  );

  child.events = clonedEvents;
  child.selected_seats = clonedSeats;
  const clientParty = maxPartySizeFromMap(picked.partySizeByEvent);
  if (clientParty != null) {
    child.original_request_data = {
      ...(child.original_request_data && typeof child.original_request_data === 'object'
        ? child.original_request_data
        : {}),
      party_size: clientParty,
    };
  }
  if (
    typeof payload.deposit_percent === 'number' &&
    payload.deposit_percent >= 1 &&
    payload.deposit_percent <= 100
  ) {
    child.deposit_percent = Math.round(payload.deposit_percent);
  }
  if (typeof child.markModified === 'function') {
    child.markModified('events');
    child.markModified('selected_seats');
    child.markModified('original_request_data');
  }

  const coeService = require('./coeService');
  await coeService.applyPricingFromSelectedSeats(child);
  await child.save();
  await host.save();
  await attachChildToHostEventSeats(host, child._id, picked.eventIds);
  await syncHostClientCount(host._id);
  return child;
}

/**
 * Add a deleted child's party sizes back onto the host remaining.
 * @param {string|import('mongoose').Types.ObjectId} hostId
 * @param {object} child
 * @returns {Promise<void>}
 */
async function restoreHostPartySizeFromChild(hostId, child) {
  const hid = idString(hostId);
  if (!hid || !mongoose.Types.ObjectId.isValid(hid)) {
    return;
  }
  const restoreMap = partySizeByEventFromLines(child?.events);
  if (restoreMap.size === 0) {
    return;
  }
  const host = await COE.findById(hid);
  if (!host || host.status === 'deleted' || !isThe1ExperienceHost(host)) {
    return;
  }
  applyHostPartySizeDeltas(
    host,
    mergePartySizeDeltas(restoreMap, new Map()),
    { skipMissingEvents: true },
  );
  await host.save();
}

/**
 * Child COE ids for a host (non-deleted).
 * @param {string} hostId
 * @returns {Promise<string[]>}
 */
async function listChildCoeIds(hostId) {
  const rows = await COE.find({
    the1_experience_host_id: hostId,
    status: { $ne: 'deleted' },
  })
    .select('_id')
    .lean();
  return rows.map((r) => idString(r._id));
}

/**
 * Clients associated with a host event (have that event on their child COE).
 * @param {string} hostId
 * @param {string} eventId
 * @returns {Promise<object[]>}
 */
async function listClientsForHostEvent(hostId, eventId) {
  const summary = await buildHostSummary(await COE.findById(hostId).lean());
  const eid = String(eventId);
  return (summary.clients || []).filter((c) =>
    (c.event_ids || []).some((id) => String(id) === eid),
  );
}

module.exports = {
  roundCurrency,
  cloneSelectedSeatRow,
  pickHostEventsAndSeats,
  applyBuyInsToSeats,
  coerceEventPartySize,
  partySizeByEventFromLines,
  mergePartySizeDeltas,
  applyHostPartySizeDeltas,
  formatHostSummary,
  buildHostSummary,
  attachHostSummaries,
  syncHostClientCount,
  restoreHostPartySizeFromChild,
  addClientToThe1Experience,
  updateThe1ExperienceClient,
  listChildCoeIds,
  listClientsForHostEvent,
  isThe1ExperienceHost,
  isThe1ExperienceChild,
};

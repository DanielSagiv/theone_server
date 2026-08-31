/**
 * Slim JSON serialization for GET /coes/my (Experiences list).
 * Preserves top-level COE fields for EJS + mobile actions; trims heavy nested event/location payloads.
 */

/** Fields populated on events.event_id for list cards. */
const LIST_EVENT_POPULATE_SELECT =
  'name start_datetime end_datetime timezone type media seats performers location_id';

/** Fields populated on events.event_id.location_id for list cards. */
const LIST_LOCATION_POPULATE_SELECT = 'name';

/**
 * @param {unknown} id
 * @returns {string|null}
 */
function normalizeIdString(id) {
  if (id == null) return null;
  if (typeof id === 'object' && id._id != null) {
    return String(id._id);
  }
  if (typeof id.toString === 'function') {
    return id.toString();
  }
  return String(id);
}

/**
 * Extract raw event id from an events[] row when event_id is not populated.
 * @param {unknown} eventId
 * @returns {unknown|null}
 */
function extractUnpopulatedEventId(eventId) {
  if (!eventId) return null;
  if (typeof eventId === 'object' && eventId.name !== undefined) {
    return null;
  }
  if (typeof eventId === 'object' && eventId._id) {
    return eventId._id;
  }
  return eventId;
}

/**
 * Whether events[].event_id is a populated Event document.
 * @param {unknown} eventId
 * @returns {boolean}
 */
function isPopulatedEventId(eventId) {
  return (
    eventId &&
    typeof eventId === 'object' &&
    eventId.name !== undefined
  );
}

/**
 * Keep first list-usable image only (smaller payload for mobile thumbnails).
 * @param {unknown} media
 * @returns {Array<object>}
 */
function trimMediaForList(media) {
  if (!Array.isArray(media)) return [];
  const firstImage = media.find(
    (m) =>
      m &&
      m.type === 'image' &&
      (String(m.url || '').trim() ||
        String(m.thumb_url || '').trim() ||
        String(m.list_thumb_url || '').trim()),
  );
  if (!firstImage) return [];
  return [
    {
      type: firstImage.type,
      url: firstImage.url,
      thumb_url: firstImage.thumb_url,
      list_thumb_url: firstImage.list_thumb_url,
      width: firstImage.width,
      height: firstImage.height,
    },
  ];
}

/**
 * @param {object|null|undefined} seat
 * @returns {object|null|undefined}
 */
function trimEventSeatForList(seat) {
  if (!seat || typeof seat !== 'object') return seat;
  return {
    _id: seat._id,
    seat_id: seat.seat_id,
    code: seat.code,
    category: seat.category,
    section: seat.section,
    event_min_spend: seat.event_min_spend,
    min_spend: seat.min_spend,
  };
}

/**
 * @param {object|null|undefined} performer
 * @returns {object|null|undefined}
 */
function trimPerformerForList(performer) {
  if (!performer || typeof performer !== 'object') return performer;
  return {
    name: performer.name,
    perfcode: performer.perfcode,
    links: performer.links,
  };
}

/**
 * @param {object|null|undefined} event
 * @returns {object|null|undefined}
 */
function trimPopulatedEventForList(event) {
  if (!event || typeof event !== 'object') return event;
  const loc = event.location_id;
  let location_id = loc;
  if (loc && typeof loc === 'object' && loc.name !== undefined) {
    location_id = {
      _id: loc._id,
      name: loc.name,
    };
  }
  return {
    _id: event._id,
    name: event.name,
    start_datetime: event.start_datetime,
    end_datetime: event.end_datetime,
    timezone: event.timezone,
    type: event.type,
    media: trimMediaForList(event.media),
    performers: Array.isArray(event.performers)
      ? event.performers.map(trimPerformerForList)
      : [],
    location_id,
    seats: Array.isArray(event.seats)
      ? event.seats.map(trimEventSeatForList)
      : [],
  };
}

/**
 * @param {object|null|undefined} seat
 * @returns {object|null|undefined}
 */
function trimSelectedSeatForList(seat) {
  if (!seat || typeof seat !== 'object') return seat;
  return {
    event_id: seat.event_id,
    seat_id: seat.seat_id,
    seat_code: seat.seat_code,
    category: seat.category,
    section: seat.section,
    event_price: seat.event_price,
    base_price: seat.base_price,
    event_min_spend: seat.event_min_spend,
    min_spend: seat.min_spend,
    is_simple_joint: seat.is_simple_joint,
    simple_joint_original_price: seat.simple_joint_original_price,
    venue_catalog_price: seat.venue_catalog_price,
    is_joint_allocation: seat.is_joint_allocation,
    is_merged_booking: seat.is_merged_booking,
  };
}

/**
 * Trim events[] rows for list response (populated + bot-shaped fallbacks).
 * @param {unknown} events
 * @returns {unknown}
 */
function trimCoeEventsForList(events) {
  if (!Array.isArray(events)) return events;
  return events.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const out = {
      ...item,
      is_joint_allocation: item.is_joint_allocation,
    };
    if (isPopulatedEventId(item.event_id)) {
      out.event_id = trimPopulatedEventForList(item.event_id);
    }
    if (Array.isArray(item.media)) {
      out.media = trimMediaForList(item.media);
    }
    if (Array.isArray(item.performers)) {
      out.performers = item.performers.map(trimPerformerForList);
    }
    return out;
  });
}

/**
 * Normalize proposal_group_id / proposal_label for JSON output.
 * @param {object} doc
 * @returns {{proposal_group_id: string|null, proposal_label: string|null}}
 */
function normalizeProposalFields(doc) {
  const gid =
    doc.proposal_group_id != null && String(doc.proposal_group_id).trim() !== ''
      ? String(doc.proposal_group_id).trim()
      : null;
  const label =
    doc.proposal_label != null && String(doc.proposal_label).trim() !== ''
      ? String(doc.proposal_label).trim()
      : null;
  return {
    proposal_group_id: gid,
    proposal_label: label,
  };
}

/**
 * Host summary is computed at list time and is not a schema path, so toObject() drops it.
 * Read it from $locals (mongoose) or the plain object.
 * @param {object} doc
 * @param {object} plain
 * @returns {object|undefined}
 */
function readThe1ExperienceSummary(doc, plain) {
  if (doc && doc.$locals && doc.$locals.the1_experience_summary) {
    return doc.$locals.the1_experience_summary;
  }
  if (doc && doc.the1_experience_summary) {
    return doc.the1_experience_summary;
  }
  if (plain && plain.the1_experience_summary) {
    return plain.the1_experience_summary;
  }
  return undefined;
}

/**
 * Serialize one COE for GET /coes/my list response.
 * @param {object} doc - Mongoose doc or plain object after list processing
 * @returns {object}
 */
function serializeCoeForList(doc) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const proposal = normalizeProposalFields(o);
  const the1Summary = readThe1ExperienceSummary(doc, o);
  return {
    ...o,
    ...proposal,
    ...(the1Summary != null ? { the1_experience_summary: the1Summary } : {}),
    is_the1_experience_host: o.is_the1_experience_host === true,
    the1_experience_host_id: (() => {
      const raw = o.the1_experience_host_id;
      if (raw == null || raw === '') return null;
      if (typeof raw === 'object' && raw._id != null) return String(raw._id);
      const s = String(raw);
      return s && s !== '[object Object]' ? s : null;
    })(),
    events: trimCoeEventsForList(o.events),
    selected_seats: Array.isArray(o.selected_seats)
      ? o.selected_seats.map(trimSelectedSeatForList)
      : o.selected_seats,
  };
}

/**
 * Batch-fetch events that failed Mongoose populate (single $in query).
 * @param {Array<object>} coes
 * @param {import('mongoose').Model} Event
 * @param {typeof import('mongoose')} mongoose
 * @returns {Promise<void>}
 */
async function batchPopulateMissingListEvents(coes, Event, mongoose) {
  if (!Array.isArray(coes) || coes.length === 0) return;

  const missingSlots = [];
  const idSet = new Set();

  for (const coe of coes) {
    if (!Array.isArray(coe.events)) continue;
    for (let i = 0; i < coe.events.length; i++) {
      const eventItem = coe.events[i];
      const rawId = extractUnpopulatedEventId(eventItem?.event_id);
      if (rawId == null) continue;
      const idStr = normalizeIdString(rawId);
      if (!idStr || !mongoose.Types.ObjectId.isValid(idStr)) continue;
      idSet.add(idStr);
      missingSlots.push({ coe, index: i, idStr });
    }
  }

  if (idSet.size === 0) return;

  const objectIds = [...idSet].map((id) => new mongoose.Types.ObjectId(id));
  const events = await Event.find({ _id: { $in: objectIds } })
    .select(LIST_EVENT_POPULATE_SELECT)
    .populate('location_id', LIST_LOCATION_POPULATE_SELECT)
    .lean();

  const eventMap = new Map(events.map((ev) => [String(ev._id), ev]));
  for (const { coe, index, idStr } of missingSlots) {
    const populated = eventMap.get(idStr);
    if (populated) {
      coe.events[index].event_id = populated;
    }
  }
}

module.exports = {
  LIST_EVENT_POPULATE_SELECT,
  LIST_LOCATION_POPULATE_SELECT,
  batchPopulateMissingListEvents,
  serializeCoeForList,
  trimCoeEventsForList,
  trimMediaForList,
  trimPopulatedEventForList,
  trimSelectedSeatForList,
};

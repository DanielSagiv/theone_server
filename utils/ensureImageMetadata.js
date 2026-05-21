const { uploadBufferToS3 } = require('./s3');
const { enrichMediaItemInPlace, ensureListThumbUrlInPlace } = require('./imageAssetMeta');

/**
 * Upload helper for thumbnail JPEGs during enrichment (same cache policy as main assets).
 * @param {Buffer} buffer
 * @param {string} key
 * @param {string} contentType
 * @returns {Promise<string>}
 */
async function uploadEnrichmentThumb(buffer, key, contentType) {
  return uploadBufferToS3(buffer, key, contentType, {});
}

/**
 * Enrich location media trees in-place (mutates Mongoose doc).
 * @param {import('mongoose').Document} location
 * @returns {Promise<boolean>} dirty
 */
async function enrichLocationImageFields(location) {
  let dirty = false;
  const loc = location;
  if (Array.isArray(loc.media)) {
    for (const item of loc.media) {
      if (await enrichMediaItemInPlace(item, uploadEnrichmentThumb)) dirty = true;
      if (await ensureListThumbUrlInPlace(item, uploadEnrichmentThumb)) dirty = true;
    }
  }
  if (Array.isArray(loc.seats)) {
    for (const seat of loc.seats) {
      if (!seat || !Array.isArray(seat.media)) continue;
      for (const item of seat.media) {
        if (await enrichMediaItemInPlace(item, uploadEnrichmentThumb)) dirty = true;
        if (await ensureListThumbUrlInPlace(item, uploadEnrichmentThumb)) dirty = true;
      }
    }
  }
  if (Array.isArray(loc.units)) {
    for (const unit of loc.units) {
      if (!unit || !Array.isArray(unit.media)) continue;
      for (const item of unit.media) {
        if (await enrichMediaItemInPlace(item, uploadEnrichmentThumb)) dirty = true;
        if (await ensureListThumbUrlInPlace(item, uploadEnrichmentThumb)) dirty = true;
      }
    }
  }
  return dirty;
}

/**
 * Enrich event media trees in-place.
 * @param {import('mongoose').Document} event
 * @returns {Promise<boolean>}
 */
async function enrichEventImageFields(event) {
  let dirty = false;
  const ev = event;
  if (Array.isArray(ev.media)) {
    for (const item of ev.media) {
      if (await enrichMediaItemInPlace(item, uploadEnrichmentThumb)) dirty = true;
      if (await ensureListThumbUrlInPlace(item, uploadEnrichmentThumb)) dirty = true;
    }
  }
  if (Array.isArray(ev.seats)) {
    for (const seat of ev.seats) {
      if (!seat || !Array.isArray(seat.media)) continue;
      for (const item of seat.media) {
        if (await enrichMediaItemInPlace(item, uploadEnrichmentThumb)) dirty = true;
        if (await ensureListThumbUrlInPlace(item, uploadEnrichmentThumb)) dirty = true;
      }
    }
  }
  if (Array.isArray(ev.units)) {
    for (const unit of ev.units) {
      if (!unit || !Array.isArray(unit.media)) continue;
      for (const item of unit.media) {
        if (await enrichMediaItemInPlace(item, uploadEnrichmentThumb)) dirty = true;
        if (await ensureListThumbUrlInPlace(item, uploadEnrichmentThumb)) dirty = true;
      }
    }
  }
  return dirty;
}

/**
 * Enrich user avatar fields when URL set but dimensions missing.
 * @param {object} userPlain - Fields to pass to findByIdAndUpdate or mutate on doc
 * @returns {Promise<boolean>}
 */
async function enrichUserAvatarFields(userPlain) {
  if (!userPlain || !userPlain.avatarUrl || typeof userPlain.avatarUrl !== 'string') {
    return false;
  }
  const w0 = Number(userPlain.avatar_width);
  const h0 = Number(userPlain.avatar_height);
  if (w0 > 0 && h0 > 0 && userPlain.avatar_thumb_url) return false;

  const synthetic = {
    type: 'image',
    url: userPlain.avatarUrl,
    width: userPlain.avatar_width,
    height: userPlain.avatar_height,
    thumb_url: userPlain.avatar_thumb_url,
    byte_size: userPlain.avatar_byte_size
  };

  const snap = `${synthetic.width}|${synthetic.height}|${synthetic.thumb_url || ''}`;
  await enrichMediaItemInPlace(synthetic, uploadEnrichmentThumb);
  const snap2 = `${synthetic.width}|${synthetic.height}|${synthetic.thumb_url || ''}`;
  if (snap === snap2) return false;

  if (synthetic.width) userPlain.avatar_width = synthetic.width;
  if (synthetic.height) userPlain.avatar_height = synthetic.height;
  if (synthetic.byte_size != null) userPlain.avatar_byte_size = synthetic.byte_size;
  if (synthetic.thumb_url) userPlain.avatar_thumb_url = synthetic.thumb_url;
  return true;
}

/**
 * Enrich COE seat_upgrade_offers[].alternatives[].media in-place.
 * @param {import('mongoose').Document} coe
 * @returns {Promise<boolean>}
 */
async function enrichCOESeatUpgradeMedia(coe) {
  let dirty = false;
  const offers = coe.seat_upgrade_offers;
  if (!Array.isArray(offers)) return false;
  for (const offer of offers) {
    if (!offer || !Array.isArray(offer.alternatives)) continue;
    for (const alt of offer.alternatives) {
      if (!alt || !Array.isArray(alt.media)) continue;
      for (const item of alt.media) {
        if (await enrichMediaItemInPlace(item, uploadEnrichmentThumb)) dirty = true;
      }
    }
  }
  return dirty;
}

/**
 * Enrich plain upgrade-offer payloads (in-place) before persisting to a COE.
 * @param {Array} offers - generateSeatUpgradeOffers output
 * @returns {Promise<void>}
 */
async function enrichSeatUpgradeOffersPayload(offers) {
  if (!Array.isArray(offers) || offers.length === 0) return;
  for (const offer of offers) {
    if (!offer || !Array.isArray(offer.alternatives)) continue;
    for (const alt of offer.alternatives) {
      if (!alt || !Array.isArray(alt.media)) continue;
      for (const item of alt.media) {
        try {
          await enrichMediaItemInPlace(item, uploadEnrichmentThumb);
        } catch (e) {
          console.warn('[ensureImageMetadata] seat upgrade media item:', e.message);
        }
      }
    }
  }
}

module.exports = {
  enrichLocationImageFields,
  enrichEventImageFields,
  enrichUserAvatarFields,
  enrichCOESeatUpgradeMedia,
  enrichSeatUpgradeOffersPayload,
  uploadEnrichmentThumb
};

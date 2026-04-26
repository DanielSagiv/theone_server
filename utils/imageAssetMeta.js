const crypto = require('crypto');
const axios = require('axios');
const sharp = require('sharp');

/** Max bytes to download when enriching metadata from a remote URL. */
const MAX_FETCH_BYTES = 25 * 1024 * 1024;

/** Long edge for generated JPEG thumbnails. */
const THUMB_MAX_EDGE = 512;

/**
 * @param {string} mime
 * @returns {boolean}
 */
function isRasterImageMime(mime) {
  if (!mime || typeof mime !== 'string') return false;
  const m = mime.toLowerCase();
  return (
    m === 'image/jpeg' ||
    m === 'image/jpg' ||
    m === 'image/png' ||
    m === 'image/webp' ||
    m === 'image/gif'
  );
}

/**
 * Download image bytes with size and timeout limits (for edit-time / backfill enrichment).
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function fetchImageBufferLimited(url) {
  const res = await axios.get(url.trim(), {
    responseType: 'arraybuffer',
    maxContentLength: MAX_FETCH_BYTES,
    maxBodyLength: MAX_FETCH_BYTES,
    timeout: 45000,
    validateStatus: (s) => s >= 200 && s < 300
  });
  return Buffer.from(res.data);
}

/**
 * Read width/height from raster image buffer.
 * @param {Buffer} buffer
 * @returns {Promise<{ width: number, height: number }>}
 */
async function probeImageBuffer(buffer) {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Image metadata missing dimensions');
  }
  return { width: meta.width, height: meta.height };
}

/**
 * Build a JPEG thumbnail (respects EXIF orientation via sharp rotate).
 * @param {Buffer} buffer
 * @param {number} [maxEdge=THUMB_MAX_EDGE]
 * @returns {Promise<Buffer>}
 */
async function buildThumbnailJpegBuffer(buffer, maxEdge = THUMB_MAX_EDGE) {
  return sharp(buffer)
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

/**
 * Derive width, height, byte size, and optional thumbnail buffer from an uploaded file buffer.
 * @param {Buffer} buffer
 * @param {string} mime
 * @param {{ includeThumb?: boolean }} [opts]
 * @returns {Promise<{ width?: number, height?: number, byte_size: number, thumbBuffer?: Buffer }|null>}
 */
async function extractMetaFromUploadBuffer(buffer, mime, opts = {}) {
  const includeThumb = opts.includeThumb !== false;
  const byte_size = buffer.length;
  if (!isRasterImageMime(mime)) {
    return { byte_size };
  }
  try {
    const { width, height } = await probeImageBuffer(buffer);
    let thumbBuffer;
    if (includeThumb) {
      try {
        thumbBuffer = await buildThumbnailJpegBuffer(buffer);
      } catch (_) {
        thumbBuffer = undefined;
      }
    }
    return { width, height, byte_size, thumbBuffer };
  } catch (err) {
    console.warn('[imageAssetMeta] extractMetaFromUploadBuffer failed:', err.message);
    return { byte_size };
  }
}

/**
 * Whether an embedded media object needs dimension/thumb enrichment.
 * @param {object} item
 * @returns {boolean}
 */
function mediaItemNeedsEnrichment(item) {
  if (!item || item.type !== 'image' || !item.url || typeof item.url !== 'string') {
    return false;
  }
  const w = Number(item.width);
  const h = Number(item.height);
  if (w > 0 && h > 0 && item.thumb_url) return false;
  if (w > 0 && h > 0 && !item.thumb_url) return true;
  return true;
}

/**
 * Enrich a single media subdocument in-place (fetch URL, probe, optional thumb upload).
 * @param {object} item - Plain or Mongoose subdoc
 * @param {(buf: Buffer, key: string, contentType: string) => Promise<string>} uploadThumb - uploads JPEG, returns URL
 * @returns {Promise<boolean>} true if item was mutated
 */
async function enrichMediaItemInPlace(item, uploadThumb) {
  if (!mediaItemNeedsEnrichment(item)) return false;

  const w = Number(item.width);
  const h = Number(item.height);
  const hasDims = w > 0 && h > 0;

  try {
    if (!hasDims) {
      const buf = await fetchImageBufferLimited(item.url);
      const { width, height } = await probeImageBuffer(buf);
      item.width = width;
      item.height = height;
      item.byte_size = buf.length;

      if (!item.thumb_url && uploadThumb) {
        try {
          const thumbBuf = await buildThumbnailJpegBuffer(buf);
          const hash = crypto.createHash('sha256').update(item.url).digest('hex').slice(0, 16);
          const key = `thumbs/enriched/${hash}_w${THUMB_MAX_EDGE}.jpg`;
          item.thumb_url = await uploadThumb(thumbBuf, key, 'image/jpeg');
        } catch (te) {
          console.warn('[imageAssetMeta] thumb upload failed:', te.message);
        }
      }
      return true;
    }

    if (!item.thumb_url && uploadThumb) {
      const buf = await fetchImageBufferLimited(item.url);
      const thumbBuf = await buildThumbnailJpegBuffer(buf);
      const hash = crypto.createHash('sha256').update(item.url).digest('hex').slice(0, 16);
      const key = `thumbs/enriched/${hash}_w${THUMB_MAX_EDGE}.jpg`;
      item.thumb_url = await uploadThumb(thumbBuf, key, 'image/jpeg');
      return true;
    }
  } catch (err) {
    console.warn('[imageAssetMeta] enrichMediaItemInPlace failed:', item.url?.slice(0, 80), err.message);
  }
  return false;
}

module.exports = {
  MAX_FETCH_BYTES,
  THUMB_MAX_EDGE,
  isRasterImageMime,
  fetchImageBufferLimited,
  probeImageBuffer,
  buildThumbnailJpegBuffer,
  extractMetaFromUploadBuffer,
  mediaItemNeedsEnrichment,
  enrichMediaItemInPlace
};

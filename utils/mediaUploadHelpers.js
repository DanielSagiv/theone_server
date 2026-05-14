const crypto = require('crypto');
const { uploadBufferToS3, extFromMime } = require('./s3');
const { extractMetaFromUploadBuffer, buildThumbnailJpegBuffer, LIST_THUMB_MAX_EDGE } = require('./imageAssetMeta');

/**
 * Upload main asset + optionally thumbnails; returns API payload fields for `data`.
 * @param {import('multer').File} file
 * @param {string} keyDirectory - e.g. `locations/${userId}` (no trailing slash) or `avatars/${userId}`
 * @param {string} userId - Used in object key hash (matches legacy upload naming)
 * @param {{ includeListThumb?: boolean }} [options] - set false for avatars (no list tile variant)
 * @returns {Promise<{ url: string, type: 'image'|'video', width?: number, height?: number, byte_size?: number, thumb_url?: string, list_thumb_url?: string }>}
 */
async function uploadMediaWithMetadata(file, keyDirectory, userId, options = {}) {
  const includeListThumb = options.includeListThumb !== false && !String(keyDirectory).startsWith('avatars/');
  const mime = file.mimetype || 'application/octet-stream';
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'other';
  if (type === 'other') {
    throw new Error('INVALID_FILE_TYPE');
  }

  const ext = extFromMime(mime);
  const hash = crypto.createHash('sha256').update(String(userId) + Date.now().toString()).digest('hex').slice(0, 16);

  const mainKey = `${keyDirectory}/${hash}.${ext}`;
  const url = await uploadBufferToS3(file.buffer, mainKey, mime, {});

  const meta = await extractMetaFromUploadBuffer(file.buffer, mime, { includeThumb: type === 'image' });

  let thumb_url;
  let list_thumb_url;
  if (type === 'image' && meta.thumbBuffer) {
    const thumbKey = `${keyDirectory}/thumbs/${hash}_w512.jpg`;
    thumb_url = await uploadBufferToS3(meta.thumbBuffer, thumbKey, 'image/jpeg', {});
    if (includeListThumb) {
      try {
        const listBuf = await buildThumbnailJpegBuffer(file.buffer, LIST_THUMB_MAX_EDGE);
        const listKey = `${keyDirectory}/thumbs/${hash}_w${LIST_THUMB_MAX_EDGE}.jpg`;
        list_thumb_url = await uploadBufferToS3(listBuf, listKey, 'image/jpeg', {});
      } catch (e) {
        console.warn('[mediaUploadHelpers] list thumb upload failed:', e.message);
      }
    }
  }

  const out = {
    url,
    type,
    byte_size: meta.byte_size
  };
  if (meta.width) out.width = meta.width;
  if (meta.height) out.height = meta.height;
  if (thumb_url) out.thumb_url = thumb_url;
  if (list_thumb_url) out.list_thumb_url = list_thumb_url;
  return out;
}

module.exports = { uploadMediaWithMetadata };

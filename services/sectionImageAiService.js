/**
 * Admin Tools: list location seat/section images, AI-edit via OpenAI, apply to S3 + Mongo.
 * Output is normalized to 4:3 (~1536×1152 JPEG) to match app seat/section cover crops.
 */

const OpenAI = require('openai');
const { toFile } = require('openai');
const sharp = require('sharp');
const Location = require('../models/Location');
const { getObjectBufferFromConfiguredBucketUrl } = require('../utils/s3');
const { uploadMediaWithMetadata } = require('../utils/mediaUploadHelpers');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
/** Prefer OPENAI_IMAGE_MODEL (trim whitespace). Default gpt-image-1.5. */
const IMAGE_MODEL = String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5').trim();
/** Ordered fallbacks when primary model is denied / missing for this project. */
const IMAGE_MODEL_FALLBACKS = ['gpt-image-1.5', 'chatgpt-image-latest', 'gpt-image-1'];

/** Preferred OpenAI edit size (landscape; matches venue section photos). */
const SECTION_IMAGE_AI_SIZE = '1536x1024';
/** Fallback when a model rejects landscape size. */
const SECTION_IMAGE_AI_SIZE_FALLBACK = '1024x1024';
/** OpenAI render quality for this low-volume admin tool. */
const SECTION_IMAGE_AI_QUALITY = 'high';

/** Final stored / preview size (exact 4:3) for app carousels. */
const SECTION_IMAGE_OUT_W = 1536;
const SECTION_IMAGE_OUT_H = 1152;
const SECTION_IMAGE_JPEG_QUALITY = 90;

const SECTION_IMAGE_PROMPT =
  'Create a new image from the image. The new image will be without text (if any) and the image will be sharper. ' +
  'Fill the entire frame edge-to-edge with a landscape venue or section photo composition. ' +
  'Do not add borders, letterboxing, black bars, or empty padding. Preserve the subject and venue look.';

/** Max length for optional operator add-on prompt (appended to fixed prompt). */
const EXTRA_PROMPT_MAX_LEN = 500;

const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

/**
 * Build the final OpenAI edit prompt: fixed base + optional operator note.
 * @param {string} [extraPrompt]
 * @returns {string}
 */
function buildSectionImagePrompt(extraPrompt) {
  const base = SECTION_IMAGE_PROMPT;
  const extra = String(extraPrompt || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EXTRA_PROMPT_MAX_LEN);
  if (!extra) {
    return base;
  }
  return `${base} Additional instruction: ${extra}`;
}

/**
 * Resolve image bytes from our S3 bucket or public HTTP URL.
 * @param {string} sourceUrl
 * @returns {Promise<Buffer>}
 */
async function downloadImageBuffer(sourceUrl) {
  const fromS3 = await getObjectBufferFromConfiguredBucketUrl(sourceUrl);
  if (fromS3 && fromS3.length) {
    return fromS3;
  }
  const res = await fetch(String(sourceUrl), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to download image (${res.status})`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Normalize OpenAI / HTTP errors for API responses.
 * @param {any} error
 * @returns {Error}
 */
function wrapProcessError(error) {
  const msg =
    error?.error?.message ||
    error?.message ||
    'Failed to process section image';
  const status = error?.statusCode || error?.status || 500;
  const err = new Error(msg);
  err.statusCode =
    Number(status) >= 400 && Number(status) < 600 ? Number(status) : 500;
  return err;
}

/**
 * Whether an OpenAI error looks like an unsupported size parameter.
 * @param {Error} error
 * @returns {boolean}
 */
function isUnsupportedSizeError(error) {
  const msg = String(error?.message || '');
  return (
    /invalid.*size/i.test(msg) ||
    /unsupported.*size/i.test(msg) ||
    /size.*not supported/i.test(msg) ||
    /must be one of/i.test(msg) && /size/i.test(msg)
  );
}

/**
 * Prepare a landscape PNG for OpenAI images.edit (cover crop, no black letterbox).
 * @param {Buffer} inputBuffer
 * @returns {Promise<Buffer>}
 */
async function prepareEditPngBuffer(inputBuffer) {
  const targetW = 1536;
  const targetH = 1024;
  let png = await sharp(inputBuffer)
    .rotate()
    .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  // Soft shrink if oversized for upload (gpt-image accepts up to ~50MB; keep lean).
  let scaleW = targetW;
  let scaleH = targetH;
  while (png.length > 20 * 1024 * 1024 && scaleW > 512) {
    scaleW = Math.floor(scaleW * 0.75);
    scaleH = Math.floor(scaleH * 0.75);
    png = await sharp(inputBuffer)
      .rotate()
      .resize(scaleW, scaleH, { fit: 'cover', position: 'centre' })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
  return png;
}

/**
 * Center-crop to 4:3 and encode JPEG for app section/seat usage.
 * @param {Buffer} inputBuffer
 * @param {{ allowUpscale?: boolean }} [opts] - when false, do not enlarge small sources
 * @returns {Promise<{ buffer: Buffer, mime: string, width: number, height: number }>}
 */
async function normalizeSectionImageForApp(inputBuffer, opts = {}) {
  const allowUpscale = opts.allowUpscale !== false;
  const rotated = sharp(inputBuffer).rotate();
  const meta = await rotated.metadata();
  const srcW = meta.width || SECTION_IMAGE_OUT_W;
  const srcH = meta.height || SECTION_IMAGE_OUT_H;
  const targetRatio = SECTION_IMAGE_OUT_W / SECTION_IMAGE_OUT_H;
  const srcRatio = srcW / Math.max(srcH, 1);

  let cropW;
  let cropH;
  if (srcRatio > targetRatio) {
    cropH = srcH;
    cropW = Math.max(1, Math.round(srcH * targetRatio));
  } else {
    cropW = srcW;
    cropH = Math.max(1, Math.round(srcW / targetRatio));
  }
  const left = Math.max(0, Math.floor((srcW - cropW) / 2));
  const top = Math.max(0, Math.floor((srcH - cropH) / 2));

  let outW = SECTION_IMAGE_OUT_W;
  let outH = SECTION_IMAGE_OUT_H;
  if (!allowUpscale && (cropW < SECTION_IMAGE_OUT_W || cropH < SECTION_IMAGE_OUT_H)) {
    outW = cropW;
    outH = cropH;
  }

  const buffer = await sharp(inputBuffer)
    .rotate()
    .extract({ left, top, width: cropW, height: cropH })
    .resize(outW, outH, { fit: 'fill' })
    .jpeg({ quality: SECTION_IMAGE_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return {
    buffer,
    mime: 'image/jpeg',
    width: outW,
    height: outH,
  };
}

/**
 * Find seat + media entry on a Location document (or lean object).
 * @param {object} location
 * @param {string} seatCode
 * @param {number} mediaIndex
 * @returns {{ seat: object, media: object, seatIndex: number } | null}
 */
function findSeatMedia(location, seatCode, mediaIndex) {
  const seats = Array.isArray(location?.seats) ? location.seats : [];
  const code = String(seatCode || '').trim();
  const idx = Number(mediaIndex);
  if (!code || !Number.isInteger(idx) || idx < 0) {
    return null;
  }
  const seatIndex = seats.findIndex(s => String(s?.code || '').trim() === code);
  if (seatIndex < 0) {
    return null;
  }
  const seat = seats[seatIndex];
  const mediaArr = Array.isArray(seat.media) ? seat.media : [];
  if (idx >= mediaArr.length) {
    return null;
  }
  const media = mediaArr[idx];
  if (!media || media.type === 'video' || !media.url) {
    return null;
  }
  return { seat, media, seatIndex };
}

/**
 * List image media on all seats for a location.
 * @param {string} locationId
 * @returns {Promise<{ locationId: string, locationName: string, items: Array<object> }>}
 */
async function listLocationSectionImages(locationId) {
  try {
    const id = String(locationId || '').trim();
    if (!id) {
      const err = new Error('locationId is required');
      err.statusCode = 400;
      throw err;
    }
    const location = await Location.findById(id).select('name seats').lean();
    if (!location) {
      const err = new Error('Location not found');
      err.statusCode = 404;
      throw err;
    }
    const items = [];
    const seats = Array.isArray(location.seats) ? location.seats : [];
    for (const seat of seats) {
      const mediaArr = Array.isArray(seat.media) ? seat.media : [];
      mediaArr.forEach((m, mediaIndex) => {
        if (!m || m.type === 'video' || !m.url || !String(m.url).trim()) {
          return;
        }
        items.push({
          seatCode: seat.code,
          seatLabel: seat.label || seat.code || '',
          category: seat.category || '',
          mediaIndex,
          url: m.url,
          // Prefer full url for dashboard display — stage thumbs/enriched/* are often 403.
          thumb_url: m.thumb_url || null,
          list_thumb_url: m.list_thumb_url || null,
          caption: m.caption || '',
        });
      });
    }
    return {
      locationId: String(location._id),
      locationName: location.name || '',
      items,
    };
  } catch (error) {
    console.error('[sectionImageAi] listLocationSectionImages error:', {
      at: new Date().toISOString(),
      locationId,
      message: error.message,
    });
    throw error;
  }
}

/**
 * Call OpenAI images.edit (single model + size attempt).
 * @param {import('openai').Uploadable} imageFile
 * @param {string} model
 * @param {string} prompt
 * @param {string} size
 * @returns {Promise<object>}
 */
async function runImageEdit(imageFile, model, prompt, size) {
  // Newer image models reject response_format; URL or b64_json both handled below.
  return openaiClient.images.edit({
    model,
    image: imageFile,
    prompt,
    n: 1,
    size,
    quality: SECTION_IMAGE_AI_QUALITY,
  });
}

/**
 * Shared pipeline: input bytes → landscape PNG prep → OpenAI edit → 4:3 JPEG normalize.
 * @param {{ inputBuffer: Buffer, prompt: string, logContext?: object }} params
 * @returns {Promise<{ previewBase64: string, mime: string, model: string, prompt: string }>}
 */
async function runSectionImageEditPipeline({ inputBuffer, prompt, logContext }) {
  if (!openaiClient) {
    const err = new Error('OpenAI API key is not configured on the server');
    err.statusCode = 503;
    throw err;
  }
  if (!inputBuffer || !Buffer.isBuffer(inputBuffer) || !inputBuffer.length) {
    const err = new Error('Image buffer is empty');
    err.statusCode = 400;
    throw err;
  }
  const pngBuffer = await prepareEditPngBuffer(inputBuffer);
  const imageFile = await toFile(pngBuffer, 'section-source.png', {
    type: 'image/png',
  });

  let completion;
  let usedModel = IMAGE_MODEL;
  let usedSize = SECTION_IMAGE_AI_SIZE;
  const tried = new Set();
  const candidates = [IMAGE_MODEL, ...IMAGE_MODEL_FALLBACKS].filter(m => {
    const name = String(m || '').trim();
    if (!name || tried.has(name)) return false;
    tried.add(name);
    return true;
  });

  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    try {
      if (i > 0) {
        console.warn('[sectionImageAi] trying fallback image model', {
          from: usedModel,
          to: model,
          previousError: lastErr?.message,
        });
      }
      usedModel = model;
      usedSize = SECTION_IMAGE_AI_SIZE;
      try {
        completion = await runImageEdit(imageFile, model, prompt, usedSize);
      } catch (sizeErr) {
        const wrappedSize = wrapProcessError(sizeErr);
        if (
          usedSize !== SECTION_IMAGE_AI_SIZE_FALLBACK &&
          isUnsupportedSizeError(wrappedSize)
        ) {
          console.warn('[sectionImageAi] landscape size rejected; retrying square', {
            model,
            from: usedSize,
            to: SECTION_IMAGE_AI_SIZE_FALLBACK,
            message: wrappedSize.message,
          });
          usedSize = SECTION_IMAGE_AI_SIZE_FALLBACK;
          completion = await runImageEdit(imageFile, model, prompt, usedSize);
        } else {
          throw sizeErr;
        }
      }
      lastErr = null;
      break;
    } catch (attemptErr) {
      lastErr = wrapProcessError(attemptErr);
      const msg = lastErr.message || '';
      const retryable =
        lastErr.statusCode === 403 ||
        /does not have access to model/i.test(msg) ||
        /model .* does not exist/i.test(msg) ||
        /That model does not exist/i.test(msg);
      if (!retryable || i === candidates.length - 1) {
        throw lastErr;
      }
    }
  }
  if (!completion) {
    throw lastErr || new Error('Failed to process section image');
  }

  const first = completion?.data?.[0];
  let outBuffer;
  if (first?.b64_json) {
    outBuffer = Buffer.from(first.b64_json, 'base64');
  } else if (first?.url) {
    outBuffer = await downloadImageBuffer(first.url);
  } else {
    throw new Error('Empty response from OpenAI image edit');
  }

  const normalized = await normalizeSectionImageForApp(outBuffer, {
    allowUpscale: true,
  });

  console.log('[sectionImageAi] process ok', {
    at: new Date().toISOString(),
    ...(logContext || {}),
    model: usedModel,
    size: usedSize,
    bytes: normalized.buffer.length,
    width: normalized.width,
    height: normalized.height,
  });
  return {
    previewBase64: normalized.buffer.toString('base64'),
    mime: normalized.mime,
    model: usedModel,
    prompt,
  };
}

/**
 * Load seat media from DB and run OpenAI image edit.
 * @param {{ locationId: string, seatCode: string, mediaIndex: number, extraPrompt?: string }} params
 * @returns {Promise<{ previewBase64: string, mime: string, model: string, prompt: string }>}
 */
async function processSectionImage({ locationId, seatCode, mediaIndex, extraPrompt }) {
  try {
    const id = String(locationId || '').trim();
    const location = await Location.findById(id).select('name seats').lean();
    if (!location) {
      const err = new Error('Location not found');
      err.statusCode = 404;
      throw err;
    }
    const found = findSeatMedia(location, seatCode, mediaIndex);
    if (!found) {
      const err = new Error('Seat media not found');
      err.statusCode = 404;
      throw err;
    }
    const prompt = buildSectionImagePrompt(extraPrompt);
    const sourceUrl = String(found.media.url).trim();
    console.log('[sectionImageAi] process start', {
      at: new Date().toISOString(),
      locationId: id,
      seatCode,
      mediaIndex,
      model: IMAGE_MODEL,
      sourceUrl,
      prompt,
    });
    const inputBuffer = await downloadImageBuffer(sourceUrl);
    return await runSectionImageEditPipeline({
      inputBuffer,
      prompt,
      logContext: { locationId: id, seatCode, mediaIndex },
    });
  } catch (error) {
    const wrapped = error.statusCode ? error : wrapProcessError(error);
    console.error('[sectionImageAi] processSectionImage error:', {
      at: new Date().toISOString(),
      locationId,
      seatCode,
      mediaIndex,
      message: wrapped.message,
      statusCode: wrapped.statusCode,
    });
    throw wrapped;
  }
}

/**
 * Run OpenAI image edit on a locally uploaded image (preview only; no S3 apply).
 * @param {{ sourceBase64: string, mime?: string, extraPrompt?: string }} params
 * @returns {Promise<{ previewBase64: string, mime: string, model: string, prompt: string }>}
 */
async function processLocalSectionImage({ sourceBase64, mime, extraPrompt }) {
  try {
    const raw = String(sourceBase64 || '').trim();
    // Allow data-URL prefix from the browser.
    const b64 = raw.includes(',') ? raw.split(',').pop() : raw;
    if (!b64) {
      const err = new Error('sourceBase64 is required');
      err.statusCode = 400;
      throw err;
    }
    let inputBuffer;
    try {
      inputBuffer = Buffer.from(b64, 'base64');
    } catch (_) {
      const err = new Error('Invalid sourceBase64');
      err.statusCode = 400;
      throw err;
    }
    if (!inputBuffer.length) {
      const err = new Error('Invalid sourceBase64');
      err.statusCode = 400;
      throw err;
    }
    // Soft guard — express.json limit is 15mb; reject clearly before OpenAI.
    const maxBytes = 12 * 1024 * 1024;
    if (inputBuffer.length > maxBytes) {
      const err = new Error('Local image is too large (max ~12MB)');
      err.statusCode = 400;
      throw err;
    }
    const prompt = buildSectionImagePrompt(extraPrompt);
    console.log('[sectionImageAi] process local start', {
      at: new Date().toISOString(),
      model: IMAGE_MODEL,
      inputBytes: inputBuffer.length,
      mime: mime || null,
      prompt,
    });
    return await runSectionImageEditPipeline({
      inputBuffer,
      prompt,
      logContext: { source: 'local' },
    });
  } catch (error) {
    const wrapped = error.statusCode ? error : wrapProcessError(error);
    console.error('[sectionImageAi] processLocalSectionImage error:', {
      at: new Date().toISOString(),
      message: wrapped.message,
      statusCode: wrapped.statusCode,
    });
    throw wrapped;
  }
}

/**
 * Upload processed image to S3 and replace the seat media slot on the Location.
 * Normalizes to 4:3 app size (no upscale for small as-is sources).
 * @param {{
 *   locationId: string,
 *   seatCode: string,
 *   mediaIndex: number,
 *   previewBase64: string,
 *   mime?: string,
 *   userId: string,
 * }} params
 * @returns {Promise<object>} updated media asset fields
 */
async function applyProcessedSectionImage({
  locationId,
  seatCode,
  mediaIndex,
  previewBase64,
  mime,
  userId,
}) {
  try {
    const id = String(locationId || '').trim();
    const b64 = String(previewBase64 || '').trim();
    if (!b64) {
      const err = new Error('previewBase64 is required');
      err.statusCode = 400;
      throw err;
    }
    const rawBuffer = Buffer.from(b64, 'base64');
    if (!rawBuffer.length) {
      const err = new Error('Invalid previewBase64');
      err.statusCode = 400;
      throw err;
    }

    // Always normalize on apply so as-is local uploads match AI output sizing.
    const normalized = await normalizeSectionImageForApp(rawBuffer, {
      allowUpscale: false,
    });
    const buffer = normalized.buffer;
    const contentType = normalized.mime;

    const location = await Location.findById(id);
    if (!location) {
      const err = new Error('Location not found');
      err.statusCode = 404;
      throw err;
    }
    const found = findSeatMedia(location, seatCode, mediaIndex);
    if (!found) {
      const err = new Error('Seat media not found');
      err.statusCode = 404;
      throw err;
    }

    const file = {
      buffer,
      mimetype: contentType,
      originalname: 'section-ai.jpg',
    };
    const uid = String(userId || 'admin');
    const uploaded = await uploadMediaWithMetadata(
      file,
      `locations/${uid}`,
      uid,
    );

    const seat = location.seats[found.seatIndex];
    const existing = seat.media[mediaIndex] || {};
    const next = {
      type: 'image',
      url: uploaded.url,
      caption: existing.caption || '',
      order: existing.order != null ? existing.order : mediaIndex,
    };
    if (uploaded.width) next.width = uploaded.width;
    if (uploaded.height) next.height = uploaded.height;
    if (uploaded.byte_size) next.byte_size = uploaded.byte_size;
    if (uploaded.thumb_url) next.thumb_url = uploaded.thumb_url;
    if (uploaded.list_thumb_url) next.list_thumb_url = uploaded.list_thumb_url;

    // Targeted $set — avoid location.save() full-doc validation (legacy seat
    // categories like DJ_Table_Backstage can fail the enum even when untouched).
    const mediaPath = `seats.${found.seatIndex}.media.${mediaIndex}`;
    const updateResult = await Location.updateOne(
      { _id: id },
      { $set: { [mediaPath]: next } },
      { runValidators: false },
    );
    if (!updateResult.matchedCount) {
      const err = new Error('Location not found');
      err.statusCode = 404;
      throw err;
    }
    if (!updateResult.modifiedCount) {
      console.warn('[sectionImageAi] apply update matched but not modified', {
        locationId: id,
        seatCode,
        mediaIndex,
        mediaPath,
      });
    }

    console.log('[sectionImageAi] apply ok', {
      at: new Date().toISOString(),
      locationId: id,
      seatCode,
      mediaIndex,
      url: uploaded.url,
      width: uploaded.width,
      height: uploaded.height,
      mimeIgnored: mime || null,
    });

    return next;
  } catch (error) {
    console.error('[sectionImageAi] applyProcessedSectionImage error:', {
      at: new Date().toISOString(),
      locationId,
      seatCode,
      mediaIndex,
      message: error.message,
    });
    throw error;
  }
}

module.exports = {
  listLocationSectionImages,
  processSectionImage,
  processLocalSectionImage,
  applyProcessedSectionImage,
  SECTION_IMAGE_PROMPT,
  buildSectionImagePrompt,
  normalizeSectionImageForApp,
  EXTRA_PROMPT_MAX_LEN,
  SECTION_IMAGE_OUT_W,
  SECTION_IMAGE_OUT_H,
};

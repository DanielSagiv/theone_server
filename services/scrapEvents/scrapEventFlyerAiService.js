/**
 * Scrap-import event flyer AI clean: remove baked-in text, sharpen, keep source aspect ratio.
 * Same OpenAI images.edit family as sectionImageAiService; does not force 4:3.
 * Pass 1 + vision leftover-text check; one retry edit when text is still likely.
 */
const OpenAI = require('openai');
const { toFile } = require('openai');
const sharp = require('sharp');

const LOG_PREFIX = '[scrap-event-flyer-ai]';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const IMAGE_MODEL = String(process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5').trim();
const IMAGE_MODEL_FALLBACKS = ['gpt-image-1.5', 'chatgpt-image-latest', 'gpt-image-1'];

const AI_QUALITY = 'high';
const AI_SIZE_SQUARE = '1024x1024';
const MAX_LONG_EDGE = 1536;
const JPEG_QUALITY = 90;

const EVENT_FLYER_PROMPT =
  'Create a new image from the image. The new image will be without text (if any) and the image will be sharper. ' +
  'Remove all letters even if they look like design: titles, artist names, venue names, dates, times, logos, ' +
  'signatures, watermarks, and typographic overlays. Reconstruct the artwork and background so no ghosted or ' +
  'smeared letterforms remain. Fill the entire frame edge-to-edge with the subject and artwork. ' +
  'Do not add new text, borders, letterboxing, black bars, or empty padding. ' +
  'Preserve the subject, composition, and venue look — not the typography.';

const EVENT_FLYER_RETRY_PROMPT =
  'This image still has leftover characters, logos, signatures, or ghosted smeared letterforms. ' +
  'Paint them out and reconstruct the artwork and background. The new image must be without text and sharper. ' +
  'Do not add any new text, borders, or letterboxing.';

const VISION_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();

const openaiClient = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

/**
 * Whether scrap commit should run flyer AI (key present and kill switch not off).
 * @returns {boolean}
 */
function isScrapEventFlyerAiEnabled() {
  const flag = String(process.env.SCRAP_EVENT_FLYER_AI || '1').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
    return false;
  }
  return Boolean(openaiClient);
}

/**
 * @param {any} error
 * @returns {Error}
 */
function wrapProcessError(error) {
  const msg =
    error?.error?.message || error?.message || 'Failed to process event flyer image';
  const status = error?.statusCode || error?.status || 500;
  const err = new Error(msg);
  err.statusCode =
    Number(status) >= 400 && Number(status) < 600 ? Number(status) : 500;
  return err;
}

/**
 * @param {Error} error
 * @returns {boolean}
 */
function isUnsupportedSizeError(error) {
  const msg = String(error?.message || '');
  return (
    /invalid.*size/i.test(msg) ||
    /unsupported.*size/i.test(msg) ||
    /size.*not supported/i.test(msg) ||
    (/must be one of/i.test(msg) && /size/i.test(msg))
  );
}

/**
 * Pick OpenAI edit size from source orientation.
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
function pickAiSizeForOrientation(width, height) {
  const w = Number(width) || 1;
  const h = Number(height) || 1;
  const ratio = w / h;
  if (ratio >= 1.15) return '1536x1024';
  if (ratio <= 0.87) return '1024x1536';
  return AI_SIZE_SQUARE;
}

/**
 * Parse OpenAI size string into width/height.
 * @param {string} size
 * @returns {{ w: number, h: number }}
 */
function parseAiSize(size) {
  const m = String(size || '').match(/^(\d+)x(\d+)$/i);
  if (!m) return { w: 1024, h: 1024 };
  return { w: Number(m[1]), h: Number(m[2]) };
}

/**
 * Cover-crop source to target AI size as PNG.
 * @param {Buffer} inputBuffer
 * @param {string} aiSize
 * @returns {Promise<Buffer>}
 */
async function prepareEditPngBuffer(inputBuffer, aiSize) {
  const { w: targetW, h: targetH } = parseAiSize(aiSize);
  let png = await sharp(inputBuffer)
    .rotate()
    .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

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
 * Resize keeping aspect ratio with max long edge; JPEG encode.
 * @param {Buffer} inputBuffer
 * @returns {Promise<{ buffer: Buffer, mime: string, width: number, height: number }>}
 */
async function normalizeEventFlyerForApp(inputBuffer) {
  const rotated = sharp(inputBuffer).rotate();
  const meta = await rotated.metadata();
  const srcW = meta.width || MAX_LONG_EDGE;
  const srcH = meta.height || MAX_LONG_EDGE;
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(1, Math.round(srcH * scale));

  const buffer = await sharp(inputBuffer)
    .rotate()
    .resize(outW, outH, { fit: 'inside', withoutEnlargement: scale >= 1 })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  const outMeta = await sharp(buffer).metadata();
  return {
    buffer,
    mime: 'image/jpeg',
    width: outMeta.width || outW,
    height: outMeta.height || outH,
  };
}

/**
 * @param {import('openai').Uploadable} imageFile
 * @param {string} model
 * @param {string} prompt
 * @param {string} size
 * @returns {Promise<object>}
 */
async function runImageEdit(imageFile, model, prompt, size) {
  return openaiClient.images.edit({
    model,
    image: imageFile,
    prompt,
    n: 1,
    size,
    quality: AI_QUALITY,
  });
}

/**
 * Download HTTP(S) image URL to buffer (AI result URL fallback).
 * @param {string} sourceUrl
 * @returns {Promise<Buffer>}
 */
async function downloadHttpImageBuffer(sourceUrl) {
  const res = await fetch(String(sourceUrl), { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to download AI image (${res.status})`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Bytes from an images.edit completion (b64 or URL).
 * @param {object} completion
 * @returns {Promise<Buffer>}
 */
async function bufferFromEditCompletion(completion) {
  const first = completion?.data?.[0];
  if (first?.b64_json) {
    return Buffer.from(first.b64_json, 'base64');
  }
  if (first?.url) {
    return downloadHttpImageBuffer(first.url);
  }
  throw new Error('Empty response from OpenAI image edit');
}

/**
 * Vision check: leftover readable or ghosted text. True on API error (fail-safe retry).
 * @param {Buffer} imageBuffer
 * @returns {Promise<boolean>}
 */
async function flyerImageHasLeftoverText(imageBuffer) {
  try {
    const jpeg = await sharp(imageBuffer)
      .jpeg({ quality: 70, mozjpeg: true })
      .toBuffer();
    const completion = await openaiClient.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0,
      max_tokens: 16,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'Does this image still contain readable text, logos with letters, signatures, ' +
                'watermarks, or ghosted/smeared letterforms? Answer YES or NO only.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` },
            },
          ],
        },
      ],
    });
    const raw = String(completion?.choices?.[0]?.message?.content || '').trim();
    const leftover = /^\s*yes\b/i.test(raw);
    console.log(`${LOG_PREFIX} leftover-text check`, { answer: raw, leftover });
    return leftover;
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} leftover-text check failed; will retry edit`,
      err?.message || err
    );
    return true;
  }
}

/**
 * One images.edit with model + size fallbacks.
 * @param {Buffer} sourceBuffer
 * @param {string} prompt
 * @param {string} preferredSize
 * @returns {Promise<{ completion: object, usedModel: string, usedSize: string }>}
 */
async function runFlyerEditWithFallbacks(sourceBuffer, prompt, preferredSize) {
  const pngBuffer = await prepareEditPngBuffer(sourceBuffer, preferredSize);
  const imageFile = await toFile(pngBuffer, 'event-flyer-source.png', {
    type: 'image/png',
  });

  let completion;
  let usedModel = IMAGE_MODEL;
  let usedSize = preferredSize;
  const tried = new Set();
  const candidates = [IMAGE_MODEL, ...IMAGE_MODEL_FALLBACKS].filter((m) => {
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
        console.warn(`${LOG_PREFIX} trying fallback image model`, {
          from: usedModel,
          to: model,
          previousError: lastErr?.message,
        });
      }
      usedModel = model;
      usedSize = preferredSize;
      try {
        completion = await runImageEdit(imageFile, model, prompt, usedSize);
      } catch (sizeErr) {
        const wrappedSize = wrapProcessError(sizeErr);
        if (usedSize !== AI_SIZE_SQUARE && isUnsupportedSizeError(wrappedSize)) {
          console.warn(`${LOG_PREFIX} size rejected; retrying square`, {
            model,
            from: usedSize,
            to: AI_SIZE_SQUARE,
            message: wrappedSize.message,
          });
          usedSize = AI_SIZE_SQUARE;
          const squarePng = await prepareEditPngBuffer(sourceBuffer, AI_SIZE_SQUARE);
          const squareFile = await toFile(squarePng, 'event-flyer-source.png', {
            type: 'image/png',
          });
          completion = await runImageEdit(squareFile, model, prompt, usedSize);
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
    throw lastErr || new Error('Failed to process event flyer');
  }
  return { completion, usedModel, usedSize };
}

/**
 * Clean venue flyer bytes: remove text, sharpen, keep AR JPEG.
 * @param {Buffer} inputBuffer
 * @returns {Promise<{ buffer: Buffer, mime: string, width: number, height: number, model: string }>}
 */
async function cleanEventFlyerBuffer(inputBuffer) {
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

  const meta = await sharp(inputBuffer).rotate().metadata();
  const preferredSize = pickAiSizeForOrientation(meta.width, meta.height);

  const pass1 = await runFlyerEditWithFallbacks(
    inputBuffer,
    EVENT_FLYER_PROMPT,
    preferredSize
  );
  let outBuffer = await bufferFromEditCompletion(pass1.completion);
  let usedModel = pass1.usedModel;
  let usedSize = pass1.usedSize;
  let pass2Ran = false;

  const leftover = await flyerImageHasLeftoverText(outBuffer);
  if (leftover) {
    try {
      console.log(`${LOG_PREFIX} leftover text likely; running retry edit`);
      const pass2 = await runFlyerEditWithFallbacks(
        outBuffer,
        EVENT_FLYER_RETRY_PROMPT,
        usedSize
      );
      outBuffer = await bufferFromEditCompletion(pass2.completion);
      usedModel = pass2.usedModel;
      usedSize = pass2.usedSize;
      pass2Ran = true;
    } catch (retryErr) {
      console.warn(
        `${LOG_PREFIX} retry edit failed; keeping pass-1 result`,
        retryErr?.message || retryErr
      );
    }
  }

  const normalized = await normalizeEventFlyerForApp(outBuffer);
  console.log(`${LOG_PREFIX} clean ok`, {
    at: new Date().toISOString(),
    model: usedModel,
    size: usedSize,
    pass2: pass2Ran,
    bytes: normalized.buffer.length,
    width: normalized.width,
    height: normalized.height,
  });

  return {
    buffer: normalized.buffer,
    mime: normalized.mime,
    width: normalized.width,
    height: normalized.height,
    model: usedModel,
  };
}

module.exports = {
  isScrapEventFlyerAiEnabled,
  cleanEventFlyerBuffer,
  normalizeEventFlyerForApp,
  pickAiSizeForOrientation,
  EVENT_FLYER_PROMPT,
  EVENT_FLYER_RETRY_PROMPT,
};

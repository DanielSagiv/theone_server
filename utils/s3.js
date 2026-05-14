const AWS = require('aws-sdk');

/**
 * Build public object URL (virtual-hosted–style) for the configured bucket.
 * Track B (optional): put CloudFront in front of this origin and store that host in env if needed.
 * @param {string} bucket
 * @param {string} region
 * @param {string} key
 * @returns {string}
 */
function buildPublicS3ObjectUrl(bucket, region, key) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

/**
 * Parse S3 virtual-hosted-style URL: `https://bucket.s3.region.amazonaws.com/key`
 * @param {string} url
 * @returns {{ bucket: string, region: string, key: string } | null}
 */
function parseVirtualHostedS3Url(url) {
  try {
    const u = new URL(String(url).trim());
    const m = u.hostname.match(/^(.+)\.s3\.([^.]+)\.amazonaws\.com$/);
    if (!m) return null;
    const key = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (!key) return null;
    return { bucket: m[1], region: m[2], key };
  } catch {
    return null;
  }
}

/**
 * Download object bytes using AWS credentials when URL targets the configured `S3_BUCKET`.
 * @param {string} url
 * @returns {Promise<Buffer|null>} buffer or null if URL is not our bucket / creds missing
 */
async function getObjectBufferFromConfiguredBucketUrl(url) {
  const cfgBucket = process.env.S3_BUCKET;
  const parsed = parseVirtualHostedS3Url(url);
  if (!parsed || !cfgBucket || parsed.bucket !== cfgBucket) return null;
  if (!process.env.S3_AKI || !process.env.S3_SEC) return null;

  AWS.config.update({
    accessKeyId: process.env.S3_AKI,
    secretAccessKey: process.env.S3_SEC,
    region: process.env.AWS_REGION || process.env.S3_REGION || parsed.region || 'us-east-2'
  });

  const s3 = new AWS.S3({ region: parsed.region || AWS.config.region });
  const data = await s3.getObject({ Bucket: parsed.bucket, Key: parsed.key }).promise();
  if (!data.Body) return null;
  return Buffer.isBuffer(data.Body) ? data.Body : Buffer.from(data.Body);
}

/**
 * S3 utility for uploading buffers
 * @description Uploads a buffer to S3 and returns the public URL
 * @param {Buffer} buffer - File content buffer
 * @param {string} key - Object key/path in S3
 * @param {string} contentType - MIME type
 * @param {{ cacheControl?: string }} [options]
 * @returns {Promise<string>} Public URL of uploaded object
 */
async function uploadBufferToS3(buffer, key, contentType, options = {}) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET is not configured');
  }

  AWS.config.update({
    accessKeyId: process.env.S3_AKI,
    secretAccessKey: process.env.S3_SEC,
    region: process.env.AWS_REGION || process.env.S3_REGION || 'us-east-2'
  });

  const s3 = new AWS.S3();

  const params = {
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: options.cacheControl || 'public, max-age=31536000, immutable'
  };

  const result = await s3.upload(params).promise();
  const region = AWS.config.region || 'us-east-1';
  const builtUrl = buildPublicS3ObjectUrl(bucket, region, key);
  return result.Location || builtUrl;
}

/**
 * Get safe file extension from MIME type
 * @param {string} mimeType
 * @returns {string}
 */
function extFromMime(mimeType) {
  if (!mimeType) return 'bin';

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/svg+xml') return 'svg';

  if (mimeType === 'video/mp4') return 'mp4';
  if (mimeType === 'video/webm') return 'webm';
  if (mimeType === 'video/quicktime') return 'mov';
  if (mimeType === 'video/x-msvideo') return 'avi';
  if (mimeType === 'video/avi') return 'avi';
  if (mimeType === 'video/3gpp') return '3gp';
  if (mimeType === 'video/x-ms-wmv') return 'wmv';
  if (mimeType === 'video/x-flv') return 'flv';

  return 'bin';
}

/**
 * Create a presigned GET URL for an object key
 * @param {string} bucket
 * @param {string} key
 * @param {number} expiresSeconds
 * @returns {string}
 */
function getSignedGetUrl(bucket, key, expiresSeconds = 300) {
  const s3 = new AWS.S3({ region: AWS.config.region || process.env.AWS_REGION || 'us-east-2' });
  return s3.getSignedUrl('getObject', { Bucket: bucket, Key: key, Expires: expiresSeconds });
}

module.exports = {
  uploadBufferToS3,
  extFromMime,
  buildPublicS3ObjectUrl,
  getSignedGetUrl,
  getObjectBufferFromConfiguredBucketUrl,
  parseVirtualHostedS3Url
};

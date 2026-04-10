const AWS = require('aws-sdk');
const path = require('path');

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
 * S3 utility for uploading buffers
 * @description Uploads a buffer to S3 and returns the public URL
 * @param {Buffer} buffer - File content buffer
 * @param {string} key - Object key/path in bucket
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
  const url = buildPublicS3ObjectUrl(bucket, region, key);
  return result.Location || url;
}

/**
 * Get safe file extension from MIME type
 * @param {string} mimeType
 */
function extFromMime(mimeType) {
  if (!mimeType) return 'bin';
  
  // Image types
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/svg+xml') return 'svg';
  
  // Video types
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

module.exports = { uploadBufferToS3, extFromMime, buildPublicS3ObjectUrl };
 
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

module.exports.getSignedGetUrl = getSignedGetUrl;



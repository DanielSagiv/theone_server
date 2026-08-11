/**
 * Outbound HTTP client for scrap-import Stage/Prod targets.
 */
const axios = require('axios');

const DEFAULT_STAGE_API_BASE = 'https://stage.the1.vip/v1';
const DEFAULT_PROD_API_BASE = 'https://app.the1.vip/v1';

const LOG_PREFIX = '[scrap-import-platform]';

/**
 * @param {string} platform
 * @returns {'local'|'stage'|'prod'}
 */
function normalizeScrapImportPlatform(platform) {
  const p = String(platform || 'local').trim().toLowerCase();
  if (p === 'stage' || p === 'prod' || p === 'local') return p;
  return 'local';
}

/**
 * @param {'local'|'stage'|'prod'} platform
 * @returns {string|null} Absolute /v1 base URL, or null for local
 */
function getScrapImportPlatformApiBase(platform) {
  const p = normalizeScrapImportPlatform(platform);
  if (p === 'local') return null;
  if (p === 'stage') {
    return (
      process.env.SCRAP_IMPORT_STAGE_API_BASE ||
      process.env.STAGE_API_BASE ||
      DEFAULT_STAGE_API_BASE
    ).replace(/\/$/, '');
  }
  return (
    process.env.SCRAP_IMPORT_PROD_API_BASE ||
    process.env.PROD_API_BASE ||
    DEFAULT_PROD_API_BASE
  ).replace(/\/$/, '');
}

/**
 * @param {'stage'|'prod'} platform
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ token: string, user: object, expiresAt?: string }>}
 */
async function loginScrapImportPlatform(platform, email, password) {
  const p = normalizeScrapImportPlatform(platform);
  if (p === 'local') {
    const err = new Error('Local platform does not use remote login');
    err.code = 'SCRAP_PLATFORM_LOCAL_NO_LOGIN';
    throw err;
  }
  const base = getScrapImportPlatformApiBase(p);
  if (!base) {
    const err = new Error(`Missing API base for platform ${p}`);
    err.code = 'SCRAP_PLATFORM_BASE_MISSING';
    throw err;
  }

  console.log(`${LOG_PREFIX} login: platform=${p} email=${String(email || '').slice(0, 3)}…`);

  const res = await axios.post(
    `${base}/auth/signin`,
    { email, password },
    { timeout: 30000, validateStatus: () => true }
  );

  if (!res.data?.success || !res.data?.data?.token) {
    const msg = res.data?.error?.message || `Sign-in failed (${res.status})`;
    const err = new Error(msg);
    err.code = res.data?.error?.code || 'SCRAP_PLATFORM_LOGIN_FAILED';
    err.status = res.status;
    throw err;
  }

  const user = res.data.data.user || {};
  if (user.role !== 'admin') {
    const err = new Error('Target account must be an admin');
    err.code = 'SCRAP_PLATFORM_NOT_ADMIN';
    throw err;
  }

  return {
    token: res.data.data.token,
    user,
    expiresAt: res.data.data.expiresAt,
  };
}

/**
 * @param {'stage'|'prod'} platform
 * @param {string} token
 * @param {string} method
 * @param {string} path - path under /v1 (e.g. /locations)
 * @param {object|null} [body]
 * @param {{ formData?: import('form-data')|FormData, headers?: object, timeoutMs?: number }} [options]
 * @returns {Promise<{ status: number, data: any, ok: boolean }>}
 */
async function scrapImportPlatformRequest(platform, token, method, path, body = null, options = {}) {
  const p = normalizeScrapImportPlatform(platform);
  if (p === 'local') {
    const err = new Error('Use local DB handlers for platform=local');
    err.code = 'SCRAP_PLATFORM_LOCAL_NO_HTTP';
    throw err;
  }
  const base = getScrapImportPlatformApiBase(p);
  if (!base) {
    const err = new Error(`Missing API base for platform ${p}`);
    err.code = 'SCRAP_PLATFORM_BASE_MISSING';
    throw err;
  }

  const urlPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${urlPath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  const config = {
    method: method.toLowerCase(),
    url,
    headers,
    timeout: options.timeoutMs || 120000,
    validateStatus: () => true,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  };

  if (options.formData) {
    config.data = options.formData;
    if (typeof options.formData.getHeaders === 'function') {
      Object.assign(headers, options.formData.getHeaders());
    }
  } else if (body != null && method.toUpperCase() !== 'GET') {
    headers['Content-Type'] = 'application/json';
    config.data = body;
  }

  const res = await axios(config);
  return {
    status: res.status,
    data: res.data,
    ok: res.status >= 200 && res.status < 300 && res.data?.success !== false,
  };
}

/**
 * @param {'stage'|'prod'} platform
 * @param {string} token
 * @returns {Promise<{ ok: boolean, user?: object, error?: string }>}
 */
async function validateScrapImportPlatformToken(platform, token) {
  try {
    const res = await scrapImportPlatformRequest(platform, token, 'GET', '/auth/validate');
    if (!res.ok) {
      return {
        ok: false,
        error: res.data?.error?.message || `Validate failed (${res.status})`,
      };
    }
    return { ok: true, user: res.data?.data?.user || res.data?.user || res.data?.data };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = {
  normalizeScrapImportPlatform,
  getScrapImportPlatformApiBase,
  loginScrapImportPlatform,
  scrapImportPlatformRequest,
  validateScrapImportPlatformToken,
  DEFAULT_STAGE_API_BASE,
  DEFAULT_PROD_API_BASE,
};

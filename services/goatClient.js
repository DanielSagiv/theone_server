/**
 * GOAT Payment Gateway API client (HTTP Basic auth).
 * @description Thin wrapper for sandbox/production REST per project GoatSkill reference.
 */

const axios = require('axios');

/**
 * Base URL without trailing slash (api host only).
 * @returns {string}
 */
function getGoatBaseUrl() {
  if (process.env.GOAT_BASE_URL && String(process.env.GOAT_BASE_URL).trim()) {
    return String(process.env.GOAT_BASE_URL).trim().replace(/\/+$/, '');
  }
  if (process.env.NODE_ENV === 'production' && process.env.GOAT_PRODUCTION_BASE_URL) {
    return String(process.env.GOAT_PRODUCTION_BASE_URL).trim().replace(/\/+$/, '');
  }
  const sand =
    process.env.GOAT_SANDBOX_BASE_URL ||
    'https://api.sandbox.goatpaymentsgateway.com';
  return String(sand).trim().replace(/\/+$/, '');
}

/**
 * API root including /api/v2.
 * @returns {string}
 */
function getGoatApiRoot() {
  return `${getGoatBaseUrl()}/api/v2`;
}

/**
 * Basic Authorization header value for GOAT.
 * @returns {string}
 */
function getBasicAuthHeader() {
  const key = process.env.GOAT_SOURCE_KEY || '';
  const pin = process.env.GOAT_PIN != null ? String(process.env.GOAT_PIN) : '';
  const token = Buffer.from(`${key}:${pin}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

/**
 * Axios instance for GOAT JSON API.
 * @returns {import('axios').AxiosInstance}
 */
function createGoatAxios() {
  const timeoutMs = Number(process.env.GOAT_REQUEST_TIMEOUT_MS) || 90000;
  return axios.create({
    baseURL: getGoatApiRoot(),
    timeout: timeoutMs,
    headers: {
      Authorization: getBasicAuthHeader(),
      'Content-Type': 'application/json',
    },
    validateStatus: () => true,
  });
}

/**
 * Build a readable error from GOAT error JSON (often only "Validation error" at top level).
 * @param {import('axios').AxiosResponse} res
 * @param {string} fallback
 * @returns {string}
 */
function formatGoatHttpError(res, fallback) {
  const d = res && res.data;
  if (d == null) {
    return `${fallback} (HTTP ${res?.status})`;
  }
  const base =
    d.error_message ||
    d.message ||
    (typeof d.error === 'string' ? d.error : null) ||
    fallback;
  const bits = [];
  if (d.error_details != null && d.error_details !== '') {
    bits.push(
      typeof d.error_details === 'string'
        ? d.error_details
        : JSON.stringify(d.error_details),
    );
  }
  if (Array.isArray(d.errors) && d.errors.length) {
    bits.push(
      d.errors
        .map((e) =>
          e && typeof e === 'object'
            ? e.message || e.field || JSON.stringify(e)
            : String(e),
        )
        .join('; '),
    );
  }
  if (d.error_code) {
    bits.push(`code=${d.error_code}`);
  }
  const suffix = bits.filter(Boolean).join(' | ');
  return suffix ? `${base}: ${suffix}` : `${base} (HTTP ${res.status})`;
}

/**
 * Tokenize PAN to cardRef (saved card token).
 * @param {{ card: string, expiry_month: number, expiry_year: number }} payload
 * @returns {Promise<{ cardRef: string, raw: object }>}
 */
async function createSavedCardFromCardNumber(payload) {
  const client = createGoatAxios();
  const res = await client.post('/saved-cards', {
    card: String(payload.card).replace(/\D/g, ''),
    expiry_month: Number(payload.expiry_month),
    expiry_year: Number(payload.expiry_year),
  });
  if (res.status >= 400) {
    throw new Error(formatGoatHttpError(res, 'GOAT saved-cards failed'));
  }
  const cardRef = res.data?.cardRef;
  if (!cardRef) {
    throw new Error('GOAT did not return cardRef');
  }
  return { cardRef: String(cardRef), raw: res.data };
}

/** GOAT enforces `source` length ≤ 26 (prefix + id). Example: `tkn-` + 16-char cardRef = 20. */
const GOAT_MAX_SOURCE_LENGTH = 26;

/**
 * Build source string for token charges (tkn- prefix per GOAT docs).
 * @param {string} storedTokenId - Raw cardRef or already-prefixed tkn- value
 * @returns {string}
 */
function toSourceToken(storedTokenId) {
  const s = String(storedTokenId || '').trim();
  if (!s) return '';
  if (s.startsWith('tkn-')) return s;
  return `tkn-${s}`;
}

/**
 * @param {string} source - Full `source` value sent to GOAT
 * @throws {Error} If longer than gateway allows (e.g. legacy non-GOAT tokens)
 */
function assertGoatSourceLength(source) {
  const s = String(source || '');
  if (s.length > GOAT_MAX_SOURCE_LENGTH) {
    throw new Error(
      `GOAT requires payment source ≤ ${GOAT_MAX_SOURCE_LENGTH} characters (got ${s.length}). ` +
        'This card token is from an old payment provider or is invalid. Remove it in the app and add the card again to save a GOAT token.'
    );
  }
}

/**
 * Charge using stored token (source charge).
 * @param {{ amount: number, source: string, description?: string, orderNumber?: string, customerName?: string, customer?: { customer_id?: string, identifier?: string, email?: string } }} opts
 * @returns {Promise<object>} GOAT response body
 */
async function chargeWithSource(opts) {
  if (!process.env.GOAT_SOURCE_KEY || !String(process.env.GOAT_SOURCE_KEY).trim()) {
    const err = new Error(
      'GOAT_SOURCE_KEY is not set in server environment. Add it to .env and restart the API.',
    );
    throw err;
  }
  const client = createGoatAxios();
  const amount = Math.round(Number(opts.amount) * 100) / 100;
  const orderNum = (opts.orderNumber && String(opts.orderNumber).trim()) || 'the1-order';
  assertGoatSourceLength(opts.source);
  const body = {
    amount,
    source: opts.source,
    capture: opts.capture !== false,
    ignore_duplicates: true,
    transaction_details: {
      description: (opts.description || 'THE1 payment').slice(0, 500),
      order_number: orderNum.slice(0, 120),
    },
  };
  if (opts.customerName && String(opts.customerName).trim()) {
    body.name = String(opts.customerName).trim().slice(0, 120);
  }
  if (opts.customer && typeof opts.customer === 'object') {
    const customer = {};
    if (
      opts.customer.customer_id != null &&
      Number.isInteger(Number(opts.customer.customer_id))
    ) {
      customer.customer_id = Number(opts.customer.customer_id);
    }
    if (opts.customer.identifier) {
      customer.identifier = String(opts.customer.identifier).trim().slice(0, 120);
    }
    if (opts.customer.email) {
      customer.email = String(opts.customer.email).trim().slice(0, 254);
    }
    if (Object.keys(customer).length > 0) {
      body.customer = customer;
    }
  }
  const maxAttempts = 3;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await client.post('/transactions/charge', body);
      if (res.status >= 400) {
        const msg = formatGoatHttpError(res, 'GOAT charge failed');
        const isTransient =
          res.status >= 500 ||
          /auth service unavailable|timeout|temporar/i.test(msg);
        if (isTransient && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 800));
          continue;
        }
        console.error('[GOAT] POST /transactions/charge failed', {
          status: res.status,
          body: res.data,
          requestSummary: {
            amount: body.amount,
            sourcePrefix: String(body.source).slice(0, 12),
            attempt,
          },
        });
        const err = new Error(msg);
        err.response = res;
        throw err;
      }
      return res.data;
    } catch (err) {
      const isTransientNetwork =
        err?.code === 'ECONNABORTED' ||
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'ECONNRESET' ||
        /timeout|network|socket hang up/i.test(err?.message || '');
      lastErr = err;
      if (isTransientNetwork && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 800));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('GOAT charge failed');
}

/**
 * Returns true if GOAT charge response indicates approval.
 * @param {object} data
 * @returns {boolean}
 */
function isChargeApproved(data) {
  if (!data) return false;
  const code = data.status_code;
  if (code === 'A' || code === 'a') return true;
  const st = data.status && String(data.status);
  if (st && st.toLowerCase() === 'approved') return true;
  return false;
}

/**
 * Refund a settled charge by original reference_number (integer).
 * @param {{ reference_number: number, amount?: number, description?: string }} opts
 * @returns {Promise<object>}
 */
async function refundTransaction(opts) {
  const client = createGoatAxios();
  const body = {
    reference_number: Number(opts.reference_number),
  };
  if (opts.amount != null && opts.amount > 0) {
    body.amount = Number(opts.amount);
  }
  if (opts.description) {
    body.transaction_details = { description: opts.description };
  }
  const res = await client.post('/transactions/refund', body);
  if (res.status >= 400) {
    const err = new Error(formatGoatHttpError(res, 'GOAT refund failed'));
    err.response = res;
    throw err;
  }
  return res.data;
}

/**
 * Optional: list transactions for reconciliation (GET /transactions).
 * @param {Record<string, string>} query
 * @returns {Promise<object>}
 */
async function listTransactions(query = {}) {
  const client = createGoatAxios();
  const res = await client.get('/transactions', { params: query });
  if (res.status >= 400) {
    throw new Error(formatGoatHttpError(res, 'GOAT list transactions failed'));
  }
  return res.data;
}

/**
 * List customers for lookup by customer_number/identifier.
 * @param {Record<string, string|number|boolean>} query
 * @returns {Promise<object[]>}
 */
async function listCustomers(query = {}) {
  const client = createGoatAxios();
  const res = await client.get('/customers', { params: query });
  if (res.status >= 400) {
    throw new Error(formatGoatHttpError(res, 'GOAT list customers failed'));
  }
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Create a customer in GOAT vault.
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function createCustomer(payload) {
  const client = createGoatAxios();
  const res = await client.post('/customers', payload || {});
  if (res.status >= 400) {
    const err = new Error(formatGoatHttpError(res, 'GOAT create customer failed'));
    err.response = res;
    throw err;
  }
  return res.data;
}

module.exports = {
  getGoatBaseUrl,
  getGoatApiRoot,
  GOAT_MAX_SOURCE_LENGTH,
  createSavedCardFromCardNumber,
  toSourceToken,
  assertGoatSourceLength,
  chargeWithSource,
  isChargeApproved,
  refundTransaction,
  listTransactions,
  listCustomers,
  createCustomer,
};

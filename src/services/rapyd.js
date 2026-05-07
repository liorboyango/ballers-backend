/**
 * Rapyd Service
 *
 * Thin client for Rapyd's Collect (Payments) API. Rapyd authenticates
 * every request with an HMAC-SHA256 signature derived from:
 *
 *   to_sign = http_method + url_path + salt + timestamp + access_key + secret_key + body
 *   signature = base64( hex( HMAC_SHA256(secret_key, to_sign) ) )
 *
 * This module exposes a small, Stripe-like surface so that callers can do:
 *
 *   const rapyd = require('./rapyd');
 *   const payment = await rapyd.createPayment({ amount, currency, ... });
 *   const fetched = await rapyd.retrievePayment(payment.id);
 *   const event   = rapyd.webhooks.constructEvent(rawBody, headers);
 *
 * Env vars (validated lazily on first use, not at require-time, so tests
 * can set them before importing):
 *   RAPYD_ACCESS_KEY     - Public access key from Rapyd dashboard
 *   RAPYD_SECRET_KEY     - Secret key used for HMAC signing
 *   RAPYD_WEBHOOK_SECRET - Secret used to verify webhook signatures
 *   RAPYD_API_URL        - Optional override (defaults to sandbox in non-prod,
 *                          production https://api.rapyd.net otherwise)
 */

'use strict';

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

const SANDBOX_URL = 'https://sandboxapi.rapyd.net';
const PRODUCTION_URL = 'https://api.rapyd.net';

/**
 * Resolve the Rapyd API base URL.
 * Order of precedence: explicit RAPYD_API_URL → production (when NODE_ENV=production) → sandbox.
 * @returns {string}
 */
function getBaseUrl() {
  if (process.env.RAPYD_API_URL) {
    return process.env.RAPYD_API_URL.replace(/\/$/, '');
  }
  return process.env.NODE_ENV === 'production' ? PRODUCTION_URL : SANDBOX_URL;
}

/**
 * Read and validate the Rapyd credentials. Throws if missing.
 * Done lazily so unit tests can set env vars before invoking the service.
 * @returns {{ accessKey: string, secretKey: string }}
 */
function getCredentials() {
  const accessKey = process.env.RAPYD_ACCESS_KEY;
  const secretKey = process.env.RAPYD_SECRET_KEY;

  if (!accessKey || !secretKey) {
    throw new Error(
      'Rapyd credentials are not configured. ' +
      'Set RAPYD_ACCESS_KEY and RAPYD_SECRET_KEY in your environment ' +
      '(use the sandbox keys for development).'
    );
  }

  return { accessKey, secretKey };
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically-random hex salt (8–40 chars per Rapyd spec).
 * @returns {string}
 */
function generateSalt() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Build the HMAC-SHA256 signature required by Rapyd for every request.
 *
 * Per Rapyd docs the signature is computed as:
 *   to_sign = method + url_path + salt + timestamp + access_key + secret_key + body
 *   sig     = base64( hex( hmac_sha256(secret_key, to_sign) ) )
 *
 * Notes:
 * - method MUST be lowercase ("get", "post", "put", "delete").
 * - url_path is the request path INCLUDING any query string, e.g. "/v1/payments/abc".
 * - body is the JSON-serialised request body. For an empty body, pass "" (NOT "{}").
 *   Rapyd also accepts that an object with no enumerable keys may be serialised as
 *   empty string. We follow the docs exactly.
 *
 * @param {object} args
 * @param {string} args.method      Lowercase HTTP verb
 * @param {string} args.urlPath     Path beginning with '/'
 * @param {string} args.salt        Random salt
 * @param {number} args.timestamp   Unix seconds
 * @param {string} args.accessKey   Rapyd access key
 * @param {string} args.secretKey   Rapyd secret key
 * @param {string} args.body        Serialised body or '' for none
 * @returns {string} base64 signature
 */
function buildSignature({ method, urlPath, salt, timestamp, accessKey, secretKey, body }) {
  const toSign = method + urlPath + salt + timestamp + accessKey + secretKey + body;
  const hmacHex = crypto.createHmac('sha256', secretKey).update(toSign).digest('hex');
  return Buffer.from(hmacHex).toString('base64');
}

// ---------------------------------------------------------------------------
// Core HTTP request
// ---------------------------------------------------------------------------

/**
 * Perform a signed Rapyd API request and unwrap the standard envelope.
 *
 * Rapyd responses look like:
 *   { status: { status: 'SUCCESS' | 'ERROR', error_code, message, ... }, data: {...} }
 *
 * On ERROR we throw an AppError with the Rapyd message; on transport errors we
 * throw a 502.
 *
 * @param {string} method 'GET' | 'POST' | 'PUT' | 'DELETE'
 * @param {string} path   e.g. '/v1/payments'
 * @param {object} [body] Request body (object) — omitted for GET/DELETE
 * @returns {Promise<any>} the `data` field of the Rapyd response
 */
async function rapydRequest(method, path, body) {
  const { accessKey, secretKey } = getCredentials();
  const baseUrl = getBaseUrl();
  const httpMethod = method.toLowerCase();

  // Body must be "" for empty bodies per Rapyd HMAC spec.
  const hasBody = body !== undefined && body !== null && Object.keys(body).length > 0;
  const serialisedBody = hasBody ? JSON.stringify(body) : '';

  const salt = generateSalt();
  const timestamp = Math.floor(Date.now() / 1000);

  const signature = buildSignature({
    method: httpMethod,
    urlPath: path,
    salt,
    timestamp,
    accessKey,
    secretKey,
    body: serialisedBody,
  });

  const headers = {
    'Content-Type': 'application/json',
    access_key: accessKey,
    salt,
    timestamp: String(timestamp),
    signature,
  };

  const url = `${baseUrl}${path}`;

  try {
    const response = await axios({
      method: httpMethod,
      url,
      headers,
      // Send the exact serialised body so Rapyd recomputes the same signature.
      data: hasBody ? serialisedBody : undefined,
      // Validate manually so we can surface Rapyd's structured error envelope.
      validateStatus: () => true,
      timeout: 30000,
    });

    const payload = response.data || {};
    const status = payload.status || {};

    if (response.status >= 400 || status.status === 'ERROR') {
      const message =
        status.message ||
        status.error_code ||
        `Rapyd request failed with HTTP ${response.status}`;
      logger.error('Rapyd API error', {
        path,
        method: httpMethod,
        httpStatus: response.status,
        rapydStatus: status,
      });
      // Map Rapyd error to a 4xx where appropriate; 5xx for server-side issues.
      const httpStatusOut = response.status >= 400 && response.status < 600 ? response.status : 502;
      throw new AppError(`Rapyd: ${message}`, httpStatusOut);
    }

    return payload.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('Rapyd transport error', { path, method: httpMethod, error: err.message });
    throw new AppError(`Rapyd request failed: ${err.message}`, 502);
  }
}

// ---------------------------------------------------------------------------
// Public API – Payments
// ---------------------------------------------------------------------------

/**
 * Create a Rapyd Payment.
 *
 * Mirrors `stripe.paymentIntents.create` semantics. Amount is expressed in the
 * SMALLEST currency unit (e.g. cents for USD) so callers can use the same
 * amount math they used with Stripe.
 *
 * @param {object} params
 * @param {number} params.amount             Amount in minor units (cents)
 * @param {string} params.currency           ISO-4217 currency, e.g. 'USD'
 * @param {string} [params.paymentMethodType='us_visa_card']
 *        Rapyd `payment_method_type` (e.g. 'us_visa_card').
 *        Defaults to a generic card type appropriate for sandbox/USD flows.
 * @param {object} [params.metadata]         Arbitrary metadata (e.g. { userId })
 * @param {string} [params.description]      Human-readable description
 * @param {string} [params.completePaymentUrl] Redirect URL after 3DS success
 * @param {string} [params.errorPaymentUrl]    Redirect URL after 3DS failure
 * @param {boolean} [params.captureAutomatically=true]
 *        Whether to capture immediately or hold for manual capture.
 * @returns {Promise<object>} The Rapyd Payment object
 */
async function createPayment(params) {
  if (!params || typeof params !== 'object') {
    throw new AppError('createPayment: params object is required', 400);
  }
  const { amount, currency } = params;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('createPayment: amount must be a positive number (in minor units)', 400);
  }
  if (!currency || typeof currency !== 'string') {
    throw new AppError('createPayment: currency is required (ISO-4217 string)', 400);
  }

  // Rapyd expects amount in MAJOR units as a decimal number (e.g. 19.99),
  // so convert from minor units (cents) used throughout the rest of the system.
  const amountMajor = Number((amount / 100).toFixed(2));

  const body = {
    amount: amountMajor,
    currency: currency.toUpperCase(),
    payment_method_type: params.paymentMethodType || 'us_visa_card',
    capture: params.captureAutomatically !== false,
    description: params.description,
    metadata: params.metadata || {},
    complete_payment_url: params.completePaymentUrl,
    error_payment_url: params.errorPaymentUrl,
  };

  // Strip undefined keys so the signed body matches what's sent on the wire.
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  logger.debug('Creating Rapyd payment', {
    amount: amountMajor,
    currency: body.currency,
    paymentMethodType: body.payment_method_type,
  });

  return rapydRequest('POST', '/v1/payments', body);
}

/**
 * Retrieve a Rapyd Payment by id. Used to verify status before creating an order.
 *
 * @param {string} paymentId Rapyd payment id (e.g. 'payment_xxx')
 * @returns {Promise<object>} The Rapyd Payment object
 */
async function retrievePayment(paymentId) {
  if (!paymentId || typeof paymentId !== 'string') {
    throw new AppError('retrievePayment: paymentId is required', 400);
  }
  return rapydRequest('GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison for two same-length strings.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a Rapyd webhook signature and parse the event body.
 *
 * Rapyd sends webhook events with these headers:
 *   signature  - base64(hex(hmac_sha256(secret, url + salt + timestamp + access_key + body)))
 *   salt       - per-request salt
 *   timestamp  - unix seconds
 *   access_key - Rapyd access key
 *
 * Note: the URL component used in the signature MUST be the FULL public URL
 * configured in the Rapyd webhook settings (e.g. https://api.example.com/api/rapyd/webhook).
 * Pass that URL via opts.url, or set RAPYD_WEBHOOK_URL.
 *
 * @param {string|Buffer} rawBody Raw request body bytes (NOT parsed JSON)
 * @param {object} headers       Request headers (lowercase keys recommended)
 * @param {object} [opts]
 * @param {string} [opts.url]    Full webhook URL — defaults to env RAPYD_WEBHOOK_URL
 * @param {string} [opts.secret] Webhook secret — defaults to env RAPYD_WEBHOOK_SECRET
 * @param {number} [opts.toleranceSeconds=300] Max allowed timestamp drift
 * @returns {object} The parsed event object
 * @throws {AppError} 400 if signature/timestamp invalid
 */
function constructEvent(rawBody, headers, opts = {}) {
  if (!rawBody) {
    throw new AppError('Webhook: missing request body', 400);
  }
  if (!headers || typeof headers !== 'object') {
    throw new AppError('Webhook: missing headers', 400);
  }

  const secret = opts.secret || process.env.RAPYD_WEBHOOK_SECRET;
  if (!secret) {
    throw new AppError('Webhook: RAPYD_WEBHOOK_SECRET is not configured', 500);
  }

  // Header lookups are case-insensitive in HTTP; normalise.
  const get = (name) => headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  const signature = get('signature');
  const salt = get('salt');
  const timestamp = get('timestamp');
  const accessKey = get('access_key') || get('access-key');

  if (!signature || !salt || !timestamp || !accessKey) {
    throw new AppError(
      'Webhook: missing one of required headers (signature, salt, timestamp, access_key)',
      400
    );
  }

  const tolerance = Number(opts.toleranceSeconds) || 300;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    throw new AppError('Webhook: invalid timestamp header', 400);
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > tolerance) {
    throw new AppError('Webhook: timestamp outside tolerance window', 400);
  }

  const url = opts.url || process.env.RAPYD_WEBHOOK_URL || '';
  const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);

  // Rapyd webhook signature recipe:
  //   to_sign = url + salt + timestamp + access_key + body
  //   sig     = base64( hex( hmac_sha256(secret, to_sign) ) )
  const toSign = url + salt + String(timestamp) + accessKey + bodyString;
  const expectedHex = crypto.createHmac('sha256', secret).update(toSign).digest('hex');
  const expected = Buffer.from(expectedHex).toString('base64');

  if (!safeEqual(expected, signature)) {
    logger.warn('Rapyd webhook signature mismatch', { url, accessKey });
    throw new AppError('Webhook: invalid signature', 400);
  }

  try {
    return JSON.parse(bodyString);
  } catch (err) {
    throw new AppError('Webhook: body is not valid JSON', 400);
  }
}

// ---------------------------------------------------------------------------
// Exports — Stripe-like shape for ergonomic call sites
// ---------------------------------------------------------------------------

module.exports = {
  // High-level helpers
  createPayment,
  retrievePayment,

  // Webhook namespace mirroring stripe.webhooks.constructEvent
  webhooks: {
    constructEvent,
  },

  // Low-level escape hatches (useful for tests or future endpoints)
  _internal: {
    rapydRequest,
    buildSignature,
    getBaseUrl,
  },
};

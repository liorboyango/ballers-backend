/**
 * Airwallex Service
 *
 * Thin client for Airwallex's Payment Acceptance (PA) API. Airwallex uses a
 * token-based auth model: you exchange a Client ID + API key for a short-lived
 * bearer token (valid ~30 minutes) via POST /api/v1/authentication/login, then
 * send `Authorization: Bearer <token>` on every subsequent request.
 *
 * This module exposes a small, Stripe-like surface so that callers can do:
 *
 *   const airwallex = require('./airwallex');
 *   const intent  = await airwallex.createPaymentIntent({ amount, currency, ... });
 *   const fetched = await airwallex.retrievePaymentIntent(intent.id);
 *   const event   = airwallex.webhooks.constructEvent(rawBody, headers);
 *
 * Env vars (validated lazily on first use, not at require-time, so tests
 * can set them before importing):
 *   AIRWALLEX_CLIENT_ID      - Unique Client ID from the Airwallex dashboard
 *   AIRWALLEX_API_KEY        - API key used to obtain a bearer token
 *   AIRWALLEX_WEBHOOK_SECRET - Secret used to verify webhook signatures
 *   AIRWALLEX_API_URL        - Optional override (defaults to demo in non-prod,
 *                              production https://api.airwallex.com otherwise)
 */

'use strict';

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

const DEMO_URL = 'https://api-demo.airwallex.com';
const PRODUCTION_URL = 'https://api.airwallex.com';

const CHECKOUT_DEMO_URL = 'https://checkout-demo.airwallex.com';
const CHECKOUT_PRODUCTION_URL = 'https://checkout.airwallex.com';

/**
 * Resolve the Airwallex API base URL.
 * Order of precedence: explicit AIRWALLEX_API_URL → production (when NODE_ENV=production) → demo.
 * @returns {string}
 */
function getBaseUrl() {
  if (process.env.AIRWALLEX_API_URL) {
    return process.env.AIRWALLEX_API_URL.replace(/\/$/, '');
  }
  return process.env.NODE_ENV === 'production' ? PRODUCTION_URL : DEMO_URL;
}

/**
 * Resolve the Airwallex Hosted Payment Page (checkout) base URL.
 * This is a different host from the API: it serves the customer-facing
 * redirect checkout page, not the JSON API.
 * Order of precedence: explicit AIRWALLEX_CHECKOUT_URL → production (when
 * NODE_ENV=production) → demo.
 * @returns {string}
 */
function getCheckoutBaseUrl() {
  if (process.env.AIRWALLEX_CHECKOUT_URL) {
    return process.env.AIRWALLEX_CHECKOUT_URL.replace(/\/$/, '');
  }
  return process.env.NODE_ENV === 'production'
    ? CHECKOUT_PRODUCTION_URL
    : CHECKOUT_DEMO_URL;
}

/**
 * Build a redirect URL to Airwallex's Hosted Payment Page (HPP) for a
 * previously-created Payment Intent. The customer is sent here to enter card
 * details; Airwallex redirects them back to successUrl/failUrl/cancelUrl when
 * done. No card data ever touches our servers or the frontend.
 *
 * @param {object} params
 * @param {string} params.intentId      Airwallex payment intent id (int_...)
 * @param {string} params.clientSecret  client_secret from the created intent
 * @param {string} params.currency      ISO-4217 currency, e.g. 'USD'
 * @param {number} [params.amount]      Amount in MAJOR units (e.g. 19.99) — display only
 * @param {string} [params.successUrl]  Redirect target on success
 * @param {string} [params.failUrl]     Redirect target on failure
 * @param {string} [params.cancelUrl]   Redirect target on cancel
 * @param {string} [params.locale]      UI locale, e.g. 'en' / 'he'
 * @returns {string} Fully-qualified hosted checkout URL
 */
function buildHostedCheckoutUrl(params = {}) {
  const { intentId, clientSecret, currency, amount, successUrl, failUrl, cancelUrl, locale } = params;
  if (!intentId || !clientSecret) {
    throw new AppError('buildHostedCheckoutUrl: intentId and clientSecret are required', 500);
  }

  const query = new URLSearchParams();
  query.set('intent_id', intentId);
  query.set('client_secret', clientSecret);
  query.set('mode', 'payment');
  if (currency) query.set('currency', String(currency).toUpperCase());
  if (Number.isFinite(amount)) query.set('amount', String(amount));
  if (successUrl) query.set('successUrl', successUrl);
  if (failUrl) query.set('failUrl', failUrl);
  if (cancelUrl) query.set('cancelUrl', cancelUrl);
  if (locale) query.set('locale', locale);

  // Airwallex HPP is a hash-routed SPA: the query string lives after the hash.
  return `${getCheckoutBaseUrl()}/#/standalone/checkout?${query.toString()}`;
}

/**
 * Read and validate the Airwallex credentials. Throws if missing.
 * Done lazily so unit tests can set env vars before invoking the service.
 * @returns {{ clientId: string, apiKey: string }}
 */
function getCredentials() {
  const clientId = process.env.AIRWALLEX_CLIENT_ID;
  const apiKey = process.env.AIRWALLEX_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error(
      'Airwallex credentials are not configured. ' +
      'Set AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY in your environment ' +
      '(use the demo credentials for development).'
    );
  }

  return { clientId, apiKey };
}

// ---------------------------------------------------------------------------
// Authentication / token caching
// ---------------------------------------------------------------------------

// In-memory bearer token cache. Airwallex tokens are valid ~30 minutes; we
// refresh a minute early to avoid edge-of-expiry races.
let cachedToken = null;
let cachedTokenExpiresAt = 0; // unix ms

const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

/**
 * Obtain a valid bearer token, using the in-memory cache when possible.
 *
 * POST /api/v1/authentication/login
 *   headers: x-client-id, x-api-key
 *   → { token, expires_at }
 *
 * @param {boolean} [forceRefresh=false] Ignore the cache and fetch a fresh token.
 * @returns {Promise<string>} A bearer token.
 */
async function getAuthToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now < cachedTokenExpiresAt - TOKEN_REFRESH_SKEW_MS) {
    return cachedToken;
  }

  const { clientId, apiKey } = getCredentials();
  const url = `${getBaseUrl()}/api/v1/authentication/login`;

  try {
    const response = await axios({
      method: 'post',
      url,
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': clientId,
        'x-api-key': apiKey,
      },
      validateStatus: () => true,
      timeout: 30000,
    });

    if (response.status >= 400 || !response.data || !response.data.token) {
      const message =
        (response.data && (response.data.message || response.data.code)) ||
        `HTTP ${response.status}`;
      logger.error('Airwallex authentication failed', {
        httpStatus: response.status,
        body: response.data,
      });
      throw new AppError(`Airwallex authentication failed: ${message}`, 502);
    }

    cachedToken = response.data.token;
    // expires_at is an ISO timestamp; fall back to 25 minutes if absent.
    const expiresAt = response.data.expires_at
      ? Date.parse(response.data.expires_at)
      : now + 25 * 60 * 1000;
    cachedTokenExpiresAt = Number.isFinite(expiresAt) ? expiresAt : now + 25 * 60 * 1000;

    return cachedToken;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('Airwallex authentication transport error', { error: err.message });
    throw new AppError(`Airwallex authentication failed: ${err.message}`, 502);
  }
}

// ---------------------------------------------------------------------------
// Core HTTP request
// ---------------------------------------------------------------------------

/**
 * Perform an authenticated Airwallex API request.
 *
 * Transparently obtains/refreshes the bearer token. On a 401 (expired token)
 * it forces a single token refresh and retries once.
 *
 * @param {string} method 'GET' | 'POST' | 'PUT' | 'DELETE'
 * @param {string} path   e.g. '/api/v1/pa/payment_intents/create'
 * @param {object} [body] Request body (object) — omitted for GET/DELETE
 * @param {boolean} [_isRetry=false] Internal flag to prevent infinite retry loops.
 * @returns {Promise<any>} the parsed response body
 */
async function airwallexRequest(method, path, body, _isRetry = false) {
  const token = await getAuthToken();
  const url = `${getBaseUrl()}${path}`;
  const httpMethod = method.toLowerCase();

  try {
    const response = await axios({
      method: httpMethod,
      url,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      data: body !== undefined ? body : undefined,
      validateStatus: () => true,
      timeout: 30000,
    });

    // Token expired mid-flight — refresh once and retry.
    if (response.status === 401 && !_isRetry) {
      logger.warn('Airwallex token rejected (401); refreshing and retrying once.');
      await getAuthToken(true);
      return airwallexRequest(method, path, body, true);
    }

    if (response.status >= 400) {
      const payload = response.data || {};
      const message =
        payload.message ||
        payload.code ||
        `Airwallex request failed with HTTP ${response.status}`;
      logger.error('Airwallex API error', {
        path,
        method: httpMethod,
        httpStatus: response.status,
        body: payload,
      });
      const httpStatusOut = response.status >= 400 && response.status < 600 ? response.status : 502;
      throw new AppError(`Airwallex: ${message}`, httpStatusOut);
    }

    return response.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('Airwallex transport error', { path, method: httpMethod, error: err.message });
    throw new AppError(`Airwallex request failed: ${err.message}`, 502);
  }
}

// ---------------------------------------------------------------------------
// Public API – Payment Intents
// ---------------------------------------------------------------------------

/**
 * Create an Airwallex Payment Intent.
 *
 * Mirrors `stripe.paymentIntents.create` semantics. Amount is passed in by the
 * caller in the SMALLEST currency unit (e.g. cents for USD) so callers can use
 * the same amount math they used with Stripe; this function converts to the
 * MAJOR units (decimal, e.g. 19.99) that Airwallex expects.
 *
 * POST /api/v1/pa/payment_intents/create
 *
 * @param {object} params
 * @param {number} params.amount        Amount in minor units (cents)
 * @param {string} params.currency      ISO-4217 currency, e.g. 'USD'
 * @param {object} [params.metadata]    Arbitrary metadata (e.g. { userId })
 * @param {string} [params.description] Human-readable descriptor
 * @param {string} [params.merchantOrderId] Your reference for the order
 * @param {string} [params.returnUrl]   Redirect URL after 3DS
 * @returns {Promise<object>} The Airwallex Payment Intent object
 */
async function createPaymentIntent(params) {
  if (!params || typeof params !== 'object') {
    throw new AppError('createPaymentIntent: params object is required', 400);
  }
  const { amount, currency } = params;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('createPaymentIntent: amount must be a positive number (in minor units)', 400);
  }
  if (!currency || typeof currency !== 'string') {
    throw new AppError('createPaymentIntent: currency is required (ISO-4217 string)', 400);
  }

  // Airwallex expects amount in MAJOR units as a decimal number (e.g. 19.99).
  const amountMajor = Number((amount / 100).toFixed(2));

  const body = {
    // request_id is a per-request idempotency key required by Airwallex.
    request_id: crypto.randomUUID(),
    amount: amountMajor,
    currency: currency.toUpperCase(),
    merchant_order_id: params.merchantOrderId,
    descriptor: params.description,
    metadata: params.metadata || {},
    return_url: params.returnUrl,
  };

  // Strip undefined keys so we don't send nulls Airwallex may reject.
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  logger.debug('Creating Airwallex payment intent', {
    amount: amountMajor,
    currency: body.currency,
    merchantOrderId: body.merchant_order_id,
  });

  return airwallexRequest('POST', '/api/v1/pa/payment_intents/create', body);
}

/**
 * Retrieve an Airwallex Payment Intent by id. Used to verify status before
 * creating an order.
 *
 * GET /api/v1/pa/payment_intents/{id}
 *
 * @param {string} paymentIntentId Airwallex payment intent id (e.g. 'int_xxx')
 * @returns {Promise<object>} The Airwallex Payment Intent object
 */
async function retrievePaymentIntent(paymentIntentId) {
  if (!paymentIntentId || typeof paymentIntentId !== 'string') {
    throw new AppError('retrievePaymentIntent: paymentIntentId is required', 400);
  }
  return airwallexRequest(
    'GET',
    `/api/v1/pa/payment_intents/${encodeURIComponent(paymentIntentId)}`
  );
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
 * Verify an Airwallex webhook signature and parse the event body.
 *
 * Airwallex signs webhooks with these headers:
 *   x-timestamp - unix milliseconds when the event was sent
 *   x-signature - hex( hmac_sha256(secret, timestamp + raw_body) )
 *
 * @param {string|Buffer} rawBody Raw request body bytes (NOT parsed JSON)
 * @param {object} headers       Request headers (lowercase keys recommended)
 * @param {object} [opts]
 * @param {string} [opts.secret] Webhook secret — defaults to env AIRWALLEX_WEBHOOK_SECRET
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

  const secret = opts.secret || process.env.AIRWALLEX_WEBHOOK_SECRET;
  if (!secret) {
    throw new AppError('Webhook: AIRWALLEX_WEBHOOK_SECRET is not configured', 500);
  }

  // Header lookups are case-insensitive in HTTP; normalise.
  const get = (name) => headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  const signature = get('x-signature');
  const timestamp = get('x-timestamp');

  if (!signature || !timestamp) {
    throw new AppError(
      'Webhook: missing one of required headers (x-signature, x-timestamp)',
      400
    );
  }

  const tolerance = Number(opts.toleranceSeconds) || 300;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) {
    throw new AppError('Webhook: invalid x-timestamp header', 400);
  }
  // Airwallex sends the timestamp in milliseconds.
  const nowSec = Math.floor(Date.now() / 1000);
  const tsSec = Math.floor(tsNum / 1000);
  if (Math.abs(nowSec - tsSec) > tolerance) {
    throw new AppError('Webhook: timestamp outside tolerance window', 400);
  }

  const bodyString = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);

  // Airwallex webhook signature recipe:
  //   value_to_digest = timestamp + raw_body
  //   sig             = hex( hmac_sha256(secret, value_to_digest) )
  const toSign = String(timestamp) + bodyString;
  const expected = crypto.createHmac('sha256', secret).update(toSign).digest('hex');

  if (!safeEqual(expected, signature)) {
    logger.warn('Airwallex webhook signature mismatch');
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
  createPaymentIntent,
  retrievePaymentIntent,

  // Hosted Checkout (redirect flow)
  getCheckoutBaseUrl,
  buildHostedCheckoutUrl,

  // Webhook namespace mirroring stripe.webhooks.constructEvent
  webhooks: {
    constructEvent,
  },

  // Low-level escape hatches (useful for tests or future endpoints)
  _internal: {
    airwallexRequest,
    getAuthToken,
    getBaseUrl,
  },
};

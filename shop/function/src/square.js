/*
 * Square, without the SDK: hosted Payment Links over the REST API, plus webhook signature checking.
 *
 * Verified against Square's current official sources (November 2026):
 *  - Webhook signature (developer.squareup.com/docs/webhooks/step3validate and the official `square` Node SDK v46 WebhooksHelper):
 *    header `x-square-hmacsha256-signature` = base64( HMAC-SHA256( signatureKey, notificationUrl + rawBody ) ).
 *    The notification URL is the one registered for the subscription, byte for byte. The body is the raw, unparsed text.
 *  - Base URLs: https://connect.squareup.com (production), https://connect.squareupsandbox.com (sandbox). Header `Square-Version`
 *    (the SDK v46 default, 2026-09-16, is pinned here) and `Authorization: Bearer <access token>`.
 *  - Endpoints: POST/DELETE /v2/online-checkout/payment-links, GET /v2/payments/{id}, GET /v2/orders/{id}, GET /v2/refunds/{id},
 *    GET /v2/locations/{id}. Money amounts are integers in the smallest unit (cents).
 *  - Payment status is one of APPROVED, PENDING, COMPLETED, CANCELED, FAILED. Refund status is PENDING, COMPLETED, REJECTED, FAILED.
 */
import { createHmac } from 'node:crypto';
import { safeEqual } from './util.js';

export const SQUARE_VERSION = '2026-09-16';
const BASES = { production: 'https://connect.squareup.com', sandbox: 'https://connect.squareupsandbox.com' };

/** True only if the signature header matches. `notificationUrl` must be exactly the URL saved in the Square webhook subscription. */
export function verifySquareSignature(rawBody, header, signatureKey, notificationUrl) {
  if (typeof rawBody !== 'string' || !rawBody || !header || !signatureKey || !notificationUrl) return false;
  const expected = createHmac('sha256', signatureKey).update(notificationUrl + rawBody, 'utf8').digest('base64');
  return safeEqual(String(header).trim(), expected);
}

export class SquareError extends Error {
  constructor(status, errors) {
    super('square_error');
    this.status = status;
    this.errors = Array.isArray(errors) ? errors.map((e) => ({ category: e.category, code: e.code, field: e.field })) : [];   // detail text is not kept: it can echo request data
  }
  get codes() { return this.errors.map((e) => e.code).filter(Boolean); }
}

export function createSquare({ accessToken, environment = 'sandbox', fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = BASES[environment === 'production' ? 'production' : 'sandbox'];
  async function call(method, path, body, { retry = false } = {}) {
    const tries = retry ? 3 : 1;
    for (let i = 0; i < tries; i++) {
      const res = await fetchImpl(base + path, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }
      if (res.ok) return json || {};
      if (retry && (res.status === 429 || res.status >= 500) && i < tries - 1) { await sleep(400 * (i + 1)); continue; }
      throw new SquareError(res.status, json && json.errors);
    }
    return {};
  }
  const enc = encodeURIComponent;
  return {
    environment: environment === 'production' ? 'production' : 'sandbox',
    /** Creates a Square-hosted checkout page. The same idempotency_key with the same body returns the same link. */
    createPaymentLink: (body) => call('POST', '/v2/online-checkout/payment-links', body),
    deletePaymentLink: (id) => call('DELETE', `/v2/online-checkout/payment-links/${enc(id)}`),
    retrievePayment: (id) => call('GET', `/v2/payments/${enc(id)}`, undefined, { retry: true }),
    retrieveOrder: (id) => call('GET', `/v2/orders/${enc(id)}`, undefined, { retry: true }),
    retrieveRefund: (id) => call('GET', `/v2/refunds/${enc(id)}`, undefined, { retry: true }),
    retrieveLocation: (id) => call('GET', `/v2/locations/${enc(id)}`, undefined, { retry: true })
  };
}

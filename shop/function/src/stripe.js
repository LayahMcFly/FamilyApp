/*
 * Stripe, without the SDK: Checkout Sessions over the REST API plus webhook signature checking.
 * Verified against Stripe's docs: events are signed with "Stripe-Signature: t=<unix>,v1=<hex HMAC-SHA256 of `t.payload`>",
 * the HMAC key is the endpoint's signing secret (whsec_...), and the check uses the raw, unparsed body.
 */
import { createHmac } from 'node:crypto';
import { safeEqual } from './util.js';

export function formEncode(obj, prefix = '', out = []) {
  if (Array.isArray(obj)) obj.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out));
  else if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue;
      formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else if (obj !== undefined && obj !== null) out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(obj))}`);
  return out;
}

export function verifyStripeSignature(rawBody, header, secret, { tolerance = 300, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!rawBody || !header || !secret) return false;
  const parts = String(header).split(',').map((p) => p.trim().split('='));
  const t = parts.find((p) => p[0] === 't')?.[1];
  const sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || !sigs.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSec - Number(t)) > tolerance) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return sigs.some((s) => safeEqual(s, expected));
}

export function createStripe({ secretKey, fetchImpl = fetch }) {
  async function call(method, path, params, idempotencyKey) {
    const headers = { Authorization: `Bearer ${secretKey}` };
    let body;
    if (params) { body = formEncode(params).join('&'); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetchImpl(`https://api.stripe.com/v1${path}`, { method, headers, body });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) { const e = new Error('stripe_error'); e.status = res.status; e.detail = json && json.error ? { type: json.error.type, code: json.error.code, param: json.error.param } : null; throw e; }
    return json;
  }
  return {
    createCheckoutSession: (params, idempotencyKey) => call('POST', '/checkout/sessions', params, idempotencyKey),
    retrieveSession: (id) => call('GET', `/checkout/sessions/${encodeURIComponent(id)}`),
    expireSession: (id) => call('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {})
  };
}

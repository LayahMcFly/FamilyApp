/*
 * Printify REST client (https://api.printify.com/v1). Personal access token as a Bearer token; every request needs a User-Agent.
 * Rate limits (docs): 600 requests/minute overall, 100/minute for catalog endpoints. We cache catalog reads.
 */
import { createHmac } from 'node:crypto';
import { safeEqual } from './util.js';

/** Printify signs webhook bodies with HMAC-SHA256 (hex), sent as "X-Pfy-Signature: sha256=<hex>". Only the body is signed (no timestamp). */
export function verifyPrintifySignature(rawBody, header, secret) {
  if (!rawBody || !header || !secret) return false;
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(String(header).trim());
  if (!m) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return safeEqual(m[1].toLowerCase(), expected);
}

export class PrintifyError extends Error {
  constructor(status, body) { super('printify_error'); this.status = status; this.body = body; }
}

export function createPrintify({ token, shopId, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  const base = 'https://api.printify.com/v1';
  async function call(method, path, body, tries = 3) {
    for (let i = 0; i < tries; i++) {
      const res = await fetchImpl(base + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'FamilyCircle-Shop/1.0', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      let json = null;
      const text = await res.text();
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (res.ok) return json;
      // 429 (too many requests) and 503 are safe to retry after a pause; 502 is documented as safe too.
      if ((res.status === 429 || res.status === 502 || res.status === 503) && i < tries - 1) { await sleep(400 * 2 ** i); continue; }
      throw new PrintifyError(res.status, json);
    }
    return null;
  }
  const cache = new Map();
  async function cached(key, ttlMs, load) {
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    const value = await load();
    cache.set(key, { until: now() + ttlMs, value });
    return value;
  }
  const shop = () => {
    if (!shopId) throw new Error('printify_shop_not_set');
    return `/shops/${encodeURIComponent(shopId)}`;
  };
  return {
    listShops: () => call('GET', '/shops.json'),
    // The whole blueprint list is large and rarely changes: keep it for an hour.
    listBlueprints: () => cached('bp', 3600e3, async () => { const r = await call('GET', '/catalog/blueprints.json'); return Array.isArray(r) ? r : (r && r.data) || []; }),
    listProviders: (bp) => cached('pr' + bp, 3600e3, async () => { const r = await call('GET', `/catalog/blueprints/${encodeURIComponent(bp)}/print_providers.json`); return Array.isArray(r) ? r : (r && r.data) || []; }),
    listVariants: (bp, pr) => call('GET', `/catalog/blueprints/${encodeURIComponent(bp)}/print_providers/${encodeURIComponent(pr)}/variants.json`),
    uploadImageBase64: (fileName, contents) => call('POST', '/uploads/images.json', { file_name: fileName, contents }),
    shippingCost: (lineItems, addressTo) => call('POST', `${shop()}/orders/shipping.json`, { line_items: lineItems, address_to: addressTo }),
    createOrder: (order) => call('POST', `${shop()}/orders.json`, order, 1),     // never retried blindly: external_id makes a repeat safe, but we decide
    getOrder: (id) => call('GET', `${shop()}/orders/${encodeURIComponent(id)}.json`),
    sendToProduction: (id) => call('POST', `${shop()}/orders/${encodeURIComponent(id)}/send_to_production.json`, {}),
    cancelOrder: (id) => call('POST', `${shop()}/orders/${encodeURIComponent(id)}/cancel.json`, {}),
    listWebhooks: () => call('GET', `${shop()}/webhooks.json`),
    createWebhook: (topic, url, secret) => call('POST', `${shop()}/webhooks.json`, { topic, url, secret })
  };
}

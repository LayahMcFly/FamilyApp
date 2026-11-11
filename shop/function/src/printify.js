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
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return {
    listShops: () => call('GET', '/shops.json'),
    // The whole blueprint list is large and rarely changes: keep it for an hour.
    listBlueprints: () => cached('bp', 3600e3, async () => { const r = await call('GET', '/catalog/blueprints.json'); return Array.isArray(r) ? r : (r && r.data) || []; }),
    listProviders: (bp) => cached('pr' + bp, 3600e3, async () => { const r = await call('GET', `/catalog/blueprints/${encodeURIComponent(bp)}/print_providers.json`); return Array.isArray(r) ? r : (r && r.data) || []; }),
    listVariants: (bp, pr) => call('GET', `/catalog/blueprints/${encodeURIComponent(bp)}/print_providers/${encodeURIComponent(pr)}/variants.json`),
    // Products already created in the merchant's own shop (NOT the blank catalog). Paginated: { current_page, last_page, total, data: [...] }.
    // limit is 1 to 50 (default 50). sid lets the diagnostics look at the merchant's other shops.
    listProductsPage: (page = 1, limit = 50, sid = shopId) => {
      if (!sid) throw new Error('printify_shop_not_set');
      return call('GET', `/shops/${encodeURIComponent(sid)}/products.json?${qs({ page, limit })}`);
    },
    // Short-lived copy of the variant list so a sync does not ask Printify for the same blueprint and provider again and again.
    listVariantsCached: (bp, pr) => cached(`va${bp}:${pr}`, 600e3, () => call('GET', `/catalog/blueprints/${encodeURIComponent(bp)}/print_providers/${encodeURIComponent(pr)}/variants.json`)),
    probe: (path) => call('GET', path, undefined, 1),
    shopId: () => shopId,
    // Temporary products used only to get Printify's own picture of a buyer's design on the product (the preview in the cart).
    createProduct: (product) => call('POST', `${shop()}/products.json`, product, 1),
    getProduct: (id) => call('GET', `${shop()}/products/${encodeURIComponent(id)}.json`),
    deleteProduct: (id) => call('DELETE', `${shop()}/products/${encodeURIComponent(id)}.json`),
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

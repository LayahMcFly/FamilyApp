/*
 * CJdropshipping API 2.0 client. Nothing here touches Appwrite or Square, and the secret API key never leaves this function.
 *
 * Verified against CJ's official docs (developers.cjdropshipping.com, read November 2026):
 *   POST /api2.0/v1/authentication/getAccessToken      { apiKey }            -> access token (180 days) + refresh token (180 days)
 *   POST /api2.0/v1/authentication/refreshAccessToken  { refreshToken }
 *   GET  /api2.0/v1/product/query?pid= | productSku= | variantSku=           (variants[], inventories[] per warehouse country)
 *   GET  /api2.0/v1/product/listV2?keyWord=&page=&size=                      (size 1-100, page 1-1000, 50 points a call)
 *   POST /api2.0/v1/logistic/freightCalculate           { startCountryCode, endCountryCode, zip, products:[{quantity,vid}] }
 *   POST /api2.0/v1/shopping/order/createOrderV2        payType 3 = create only, nothing paid. isSandbox marks a sandbox order.
 *   POST /api2.0/v1/shopping/pay/payBalance             { orderId }  pays from the CJ wallet (simulated for sandbox orders)
 *   GET  /api2.0/v1/shopping/order/getOrderDetail?orderId=   (accepts our own order number or CJ's id)
 *   POST /api2.0/v1/shopping/order/cancel               { cjOrderId }  only unpaid orders
 *   GET  /api2.0/v1/logistic/trackInfo?trackNumber=
 * Limits (docs): free accounts 1 request per second; 10 requests per second per IP; a daily points quota (50,000 base points).
 * Header for every call after login: CJ-Access-Token.
 *
 * What the docs did NOT make clear (so the code is defensive about it, and the admin "Test CJ connection" button shows the real answers):
 *  - exact field names inside some responses (names below are read from several spellings),
 *  - what happens when the wallet balance is too low (any pay error is treated as "needs your attention", never retried blindly).
 */
const BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

export class CjError extends Error {
  constructor(status, code, message, kind = 'api') { super('cj_error'); this.status = status; this.code = code; this.cjMessage = String(message || '').slice(0, 300); this.kind = kind; }
  get rateLimited() { return this.status === 429 || this.kind === 'rate_limit'; }
  get authProblem() { return this.status === 401 || this.kind === 'auth'; }
  get notFound() { return this.kind === 'not_found'; }
}

const num = (v) => { const t = String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''); if (!/\d/.test(t)) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const cents = (v) => { const n = num(v); return n === null ? null : Math.round(n * 100); };
const str = (v, max = 400) => (v == null ? '' : String(v)).slice(0, max);
export const stripHtml = (s) => String(s || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<\/(p|div|li|br|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const httpsOnly = (u) => (typeof u === 'string' && /^https:\/\//i.test(u.trim()) ? u.trim() : '');

function imageList(v) {
  if (Array.isArray(v)) return v.map(httpsOnly).filter(Boolean);
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('[')) { try { return imageList(JSON.parse(t)); } catch { return []; } }
    return t.split(',').map(httpsOnly).filter(Boolean);
  }
  return [];
}

/** Turns CJ's product answer into the small, safe shape the shop stores. Only https images are kept. Descriptions are stripped to plain text. */
export function normalizeProduct(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const variants = (Array.isArray(p.variants) ? p.variants : []).map((v) => {
    const stock = {};
    for (const inv of Array.isArray(v.inventories) ? v.inventories : []) {
      const cc = str(inv.countryCode, 2).toUpperCase(); if (!cc) continue;
      const n = num(inv.totalInventory !== undefined ? inv.totalInventory : (num(inv.cjInventory) || 0) + (num(inv.factoryInventory) || 0));
      stock[cc] = (stock[cc] || 0) + (n === null ? 0 : Math.max(0, Math.floor(n)));
    }
    const warehouses = Array.isArray(v.inventories) && v.inventories.length > 0;
    return {
      vid: str(v.vid, 64), sku: str(v.variantSku || v.sku, 80), name: str(v.variantNameEn || v.variantName || v.variantKey || v.variantSku, 120),
      image: httpsOnly(v.variantImage), costCents: cents(v.variantSellPrice !== undefined ? v.variantSellPrice : v.sellPrice), stock, stockKnown: warehouses
    };
  }).filter((v) => v.vid && v.costCents !== null && v.costCents >= 0);
  const mainImg = imageList(p.productImage || p.bigImage);
  const more = imageList(p.productImageSet || p.productImages);
  const images = [...new Set([...mainImg, ...more, ...variants.map((v) => v.image).filter(Boolean)])].slice(0, 12);
  const specs = [];
  for (const [k, label] of [['productWeight', 'Weight'], ['packingWeight', 'Packing weight'], ['materialNameEn', 'Material'], ['productType', 'Type'], ['packingNameEn', 'Packing'], ['productUnit', 'Unit']]) {
    const v = stripHtml(Array.isArray(p[k]) ? p[k].join(', ') : p[k]); if (v) specs.push([label, str(v, 120)]);
  }
  return {
    pid: str(p.pid || p.id, 64), sku: str(p.productSku || p.sku, 80), title: str(p.productNameEn || p.productName || p.nameEn, 200),
    description: stripHtml(p.description || p.productDescription).slice(0, 4000), images, variants, specs: specs.slice(0, 8),
    categoryName: str(p.categoryName, 120)
  };
}

export function createCj({ apiKey, loadTokens, saveTokens, fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), minGapMs = 1100 }) {
  let last = 0;
  async function pace() {            // free accounts: 1 request per second
    const wait = last + minGapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  }
  async function raw(method, path, { query, body, token } = {}) {
    await pace();
    const url = BASE + path + (query ? '?' + Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '');
    let res;
    try {
      res = await fetchImpl(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'CJ-Access-Token': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new CjError(0, 'network', 'CJ could not be reached.', 'network'); }
    let json = null; const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (res.status === 429) throw new CjError(429, 'rate_limit', 'Too many requests', 'rate_limit');
    if (res.status === 401) throw new CjError(401, 'auth', (json && json.message) || 'Not signed in to CJ', 'auth');
    if (!json || typeof json !== 'object') throw new CjError(res.status, 'bad_answer', 'CJ answered in an unexpected way.', 'bad_answer');
    const ok = json.result === true || Number(json.code) === 200 || json.success === true;
    if (ok) return json;
    const code = Number(json.code) || 0; const message = json.message || json.msg || '';
    // 1600200 is CJ's rate-limit code; 1600001 and friends mean the token is not accepted (names per CJ's error list; matched by message too).
    if (code === 1600200 || /too many requests|rate limit|frequen/i.test(message)) throw new CjError(res.status, 'rate_limit', message, 'rate_limit');
    if (code === 1600001 || code === 1600003 || /token/i.test(message) && /(invalid|expired|illegal)/i.test(message)) throw new CjError(res.status, 'auth', message, 'auth');
    if (code === 1600014) throw new CjError(res.status, 'api_inactive', 'CJ turned off API access for this account (no CJ transactions for 30 days). Reactivate it on CJ\'s API page.', 'auth');
    throw new CjError(res.status, String(code || json.code || 'error'), message, /not exist|not found|no data/i.test(message) ? 'not_found' : 'api');
  }
  const dateOf = (v, fallbackMs) => { const t = Date.parse(v); return Number.isFinite(t) ? t : now() + fallbackMs; };
  async function login() {
    if (!apiKey) throw new CjError(0, 'not_configured', 'CJ_API_KEY is not set.', 'auth');
    const prev = (await loadTokens()) || {};
    if (prev.refreshToken && prev.refreshExpires > now() + 864e5) {
      try {
        const r = await raw('POST', '/authentication/refreshAccessToken', { body: { refreshToken: prev.refreshToken } });
        const d = r.data || {};
        if (d.accessToken) { const t = { accessToken: d.accessToken, accessExpires: dateOf(d.accessTokenExpiryDate, 179 * 864e5), refreshToken: d.refreshToken || prev.refreshToken, refreshExpires: d.refreshToken ? dateOf(d.refreshTokenExpiryDate, 179 * 864e5) : prev.refreshExpires, openId: d.openId || prev.openId || '' }; await saveTokens(t); return t; }
      } catch (e) { if (e instanceof CjError && e.rateLimited) throw e; /* fall through to a fresh login */ }
    }
    const r = await raw('POST', '/authentication/getAccessToken', { body: { apiKey } });
    const d = r.data || {};
    if (!d.accessToken) throw new CjError(200, 'no_token', 'CJ did not return a token.', 'auth');
    const t = { accessToken: d.accessToken, accessExpires: dateOf(d.accessTokenExpiryDate, 179 * 864e5), refreshToken: d.refreshToken || '', refreshExpires: d.refreshToken ? dateOf(d.refreshTokenExpiryDate, 179 * 864e5) : 0, openId: d.openId || '' };
    await saveTokens(t); return t;
  }
  let mem = null;
  async function token(force = false) {
    if (!force) {
      if (mem && mem.accessExpires > now() + 864e5) return mem.accessToken;
      const saved = await loadTokens();
      if (saved && saved.accessToken && saved.accessExpires > now() + 864e5) { mem = saved; return saved.accessToken; }
    }
    mem = await login(); return mem.accessToken;
  }
  /** One call with the token. A refused token is renewed once. A rate limit waits and tries once more. Order creation is never retried here. */
  async function call(method, path, opts = {}, { retry = true } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await raw(method, path, { ...opts, token: await token(attempt > 0 && opts.__renew) }); }
      catch (e) {
        if (!(e instanceof CjError) || !retry) throw e;
        if (e.authProblem && attempt === 0 && e.code !== 'api_inactive') { opts = { ...opts, __renew: true }; mem = null; continue; }
        if (e.rateLimited && attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
        throw e;
      }
    }
    throw new CjError(0, 'gave_up', 'CJ did not answer.', 'api');
  }
  const idLooksLikePid = (s) => /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(s) || /^\d{10,}$/.test(s);
  return {
    /** Read-only. Looks a product up by CJ product id, product SKU or variant SKU. */
    async product(idOrSku) {
      const q = String(idOrSku || '').trim(); if (!q) throw new CjError(0, 'empty', 'Enter a CJ SKU or product ID.', 'not_found');
      const tries = idLooksLikePid(q) ? [{ pid: q }, { productSku: q }] : [{ productSku: q }, { variantSku: q }, { pid: q }];
      let lastErr = null;
      for (const query of tries) {
        try { const r = await call('GET', '/product/query', { query }); if (r.data && (r.data.pid || r.data.productSku || r.data.variants)) return normalizeProduct(r.data); }
        catch (e) { if (!(e instanceof CjError) || !(e.notFound || e.kind === 'api')) throw e; lastErr = e; }
      }
      throw lastErr || new CjError(0, 'not_found', 'CJ has no product with that SKU or ID.', 'not_found');
    },
    /** Read-only keyword search. Costs about 50 API points a call, so the admin screen only calls it when asked. */
    async search(keyword, page = 1, size = 12) {
      const r = await call('GET', '/product/listV2', { query: { keyWord: String(keyword || '').slice(0, 100), page: Math.max(1, Math.min(1000, page)), size: Math.max(1, Math.min(24, size)) } });
      const d = r.data || {};
      const list = d.content && Array.isArray(d.content[0] && d.content[0].productList) ? d.content.flatMap((c) => c.productList || []) : (Array.isArray(d.productList) ? d.productList : (Array.isArray(d.list) ? d.list : (Array.isArray(d.content) ? d.content : [])));
      return { total: Number(d.totalRecords || d.total || list.length) || 0, items: list.slice(0, 24).map((x) => ({ pid: str(x.id || x.pid, 64), sku: str(x.sku || x.productSku, 80), title: str(x.nameEn || x.productNameEn || x.name, 200), image: httpsOnly(x.bigImage || x.productImage), priceText: str(x.sellPrice || x.nowPrice || '', 40) })) };
    },
    /** Shipping options for these variants from a warehouse country to a destination. Read-only and safe. */
    async freight({ from, to, zip, products }) {
      const r = await call('POST', '/logistic/freightCalculate', { body: { startCountryCode: from, endCountryCode: to, ...(zip ? { zip } : {}), products: products.map((p) => ({ quantity: p.quantity, vid: p.vid })) } });
      const list = Array.isArray(r.data) ? r.data : [];
      return list.map((o) => ({ name: str(o.logisticName, 80), priceCents: cents(o.totalPostageFee != null && num(o.totalPostageFee) > 0 ? o.totalPostageFee : o.logisticPrice), aging: str(o.logisticAging, 20) })).filter((o) => o.name && o.priceCents !== null && o.priceCents >= 0);
    },
    /** Creates a CJ order in "create only" mode (payType 3): nothing is paid and nothing is shipped. NEVER retried automatically. */
    async createOrder(body) { const r = await call('POST', '/shopping/order/createOrderV2', { body }, { retry: false }); return r.data || {}; },
    /** Pays a CJ order from the CJ wallet. NEVER retried automatically. */
    async payBalance(orderId) { await call('POST', '/shopping/pay/payBalance', { body: { orderId } }, { retry: false }); return true; },
    async orderDetail(orderId) { const r = await call('GET', '/shopping/order/getOrderDetail', { query: { orderId } }); return r.data || null; },
    async cancelOrder(cjOrderId) { const r = await call('POST', '/shopping/order/cancel', { body: { cjOrderId } }, { retry: false }); return r.data || {}; },
    async trackInfo(numbers) { const r = await call('GET', '/logistic/trackInfo', { query: { trackNumber: numbers.join(',') } }); return Array.isArray(r.data) ? r.data : []; },
    /** Login only. Used by the admin "Test CJ connection" button. */
    async checkLogin() { await token(true); return true; }
  };
}

export const CJ_STATUS_TO_OURS = {
  CREATED: 'created', IN_CART: 'created', UNPAID: 'created',
  UNSHIPPED: 'in_production', PENDING: 'in_production', PROCESSING: 'in_production',
  SHIPPED: 'shipped', DELIVERED: 'delivered', CANCELLED: 'cj_canceled'
};

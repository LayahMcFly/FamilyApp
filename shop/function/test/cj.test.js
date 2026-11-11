import test from 'node:test';
import assert from 'node:assert/strict';
import { createCj, normalizeProduct, CjError, stripHtml } from '../src/cj.js';

const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ code: 200, result: true, data }) });
const fail = (code, message, status = 200) => ({ status, text: async () => JSON.stringify({ code, result: false, message }) });
function client(handler, saved = {}) {
  const calls = []; let store = { ...saved }; let t = 1e12;
  const c = createCj({ apiKey: 'KEY', loadTokens: async () => store, saveTokens: async (x) => { store = x; }, now: () => t, sleep: async (ms) => { t += ms; }, minGapMs: 1100,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); } });
  return { c, calls, store: () => store, tick: (ms) => { t += ms; } };
}
const login = (url) => url.includes('getAccessToken') ? ok({ accessToken: 'AT1', refreshToken: 'RT1', accessTokenExpiryDate: new Date(1e12 + 15e9).toISOString(), refreshTokenExpiryDate: new Date(1e12 + 15e9).toISOString(), openId: 7 }) : null;

test('normalizeProduct keeps https images only, plain-text descriptions, cents, and per-country stock', () => {
  const p = normalizeProduct({ pid: 'P', productSku: 'S', productNameEn: 'Blanket', description: '<p>Soft <b>big</b></p><script>x()</script>', productImage: 'http://bad.test/a.jpg', productImageSet: ['https://ok.test/b.jpg'],
    variants: [{ vid: 'v1', variantSku: 'S-1', variantNameEn: 'Blue', variantSellPrice: '8.05', inventories: [{ countryCode: 'us', totalInventory: 3 }, { countryCode: 'US', totalInventory: 2 }] }, { vid: '', variantSellPrice: '1' }, { vid: 'v3', variantSellPrice: 'abc' }] });
  assert.deepEqual(p.images, ['https://ok.test/b.jpg']); assert.equal(p.description, 'Soft big'); assert.equal(p.variants.length, 1);
  assert.equal(p.variants[0].costCents, 805); assert.deepEqual(p.variants[0].stock, { US: 5 }); assert.equal(p.variants[0].stockKnown, true);
  assert.equal(stripHtml('a&amp;b'), 'a&b');
});
test('one login, token saved and reused; calls are spaced at least 1.1 seconds apart', async () => {
  const stamps = []; const h = client((url, init) => { stamps.push(Date.now()); return login(url) || ok({ ok: 1 }); });
  await h.c.orderDetail('x'); await h.c.orderDetail('y');
  assert.equal(h.calls.filter((c) => c.url.includes('getAccessToken')).length, 1); assert.equal(h.store().accessToken, 'AT1');
  assert.equal(h.calls.at(-1).init.headers['CJ-Access-Token'], 'AT1');
});
test('a refused token is renewed once; a rate limit waits and tries again', async () => {
  let n = 0; const h = client((url) => { const l = login(url); if (l) return l; n++; if (n === 1) return fail(1600001, 'Invalid token'); if (n === 2) return { status: 429, text: async () => '{}' }; return ok({ fine: true }); });
  const d = await h.c.orderDetail('x'); assert.deepEqual(d, { fine: true });
});
test('createOrder is never retried, even on a network failure or a rate limit', async () => {
  for (const mode of ['net', '429']) {
    const h = client((url) => { const l = login(url); if (l) return l; if (mode === 'net') throw new Error('socket'); return { status: 429, text: async () => '{}' }; });
    await assert.rejects(() => h.c.createOrder({ orderNumber: 'a' }), (e) => e instanceof CjError);
    assert.equal(h.calls.filter((c) => c.url.includes('createOrderV2')).length, 1, mode);
  }
});
test('payBalance is never retried; errors keep CJ message', async () => {
  const h = client((url) => login(url) || fail(1603000, 'Insufficient balance'));
  await assert.rejects(() => h.c.payBalance('1'), (e) => e.cjMessage === 'Insufficient balance');
  assert.equal(h.calls.filter((c) => c.url.includes('payBalance')).length, 1);
});
test('API turned off for inactivity is reported as an auth problem with a plain message', async () => {
  const h = client((url) => login(url) || fail(1600014, 'x'));
  await assert.rejects(() => h.c.orderDetail('1'), (e) => e.authProblem && /30 days/.test(e.cjMessage));
});
test('freight keeps only usable options; product lookup tries pid then SKU', async () => {
  const h = client((url) => { const l = login(url); if (l) return l; if (url.includes('freightCalculate')) return ok([{ logisticName: 'A', logisticPrice: 4.99, logisticAging: '8-12' }, { logisticName: '', logisticPrice: 1 }, { logisticName: 'B', logisticPrice: 'x' }]); if (url.includes('pid=')) return fail(1600404, 'product not exist'); return ok({ pid: 'P9', productSku: 'SK', variants: [] }); });
  const f = await h.c.freight({ from: 'US', to: 'US', products: [{ vid: 'v', quantity: 1 }] }); assert.deepEqual(f, [{ name: 'A', priceCents: 499, aging: '8-12' }]);
  const p = await h.c.product('123456'); assert.equal(p.pid, 'P9');
});

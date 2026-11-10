import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createShop, T, stageOf } from '../src/shop.js';
import { PrintifyError } from '../src/printify.js';

/* ---------- fakes ---------- */
class FakeDb {
  constructor() { this.t = {}; this.n = 0; }
  tab(id) { return (this.t[id] ||= new Map()); }
  err(code) { const e = new Error('x'); e.code = code; return e; }
  async getRow({ tableId, rowId }) { const r = this.tab(tableId).get(rowId); if (!r) throw this.err(404); return { ...r }; }
  async createRow({ tableId, rowId, data, permissions }) {
    if (this.tab(tableId).has(rowId)) throw this.err(409);
    const r = { ...data, $id: rowId, $permissions: permissions, $createdAt: new Date(1700000000000 + this.n++ * 1000).toISOString(), $updatedAt: new Date(1700000000000 + this.n * 1000).toISOString() };
    this.tab(tableId).set(rowId, r); return { ...r };
  }
  async updateRow({ tableId, rowId, data }) { const r = this.tab(tableId).get(rowId); if (!r) throw this.err(404); Object.assign(r, data); r.$updatedAt = new Date(1700000000000 + this.n++ * 1000).toISOString(); return { ...r }; }
  async deleteRow({ tableId, rowId }) { this.tab(tableId).delete(rowId); }
  async listRows({ tableId, queries = [] }) {
    let rows = [...this.tab(tableId).values()].map((r) => ({ ...r })); let limit = 25, desc = false;
    for (const q of queries) {
      const p = JSON.parse(q);
      if (p.method === 'equal') rows = rows.filter((r) => p.values.includes(p.attribute === '$id' ? r.$id : r[p.attribute]));
      if (p.method === 'limit') limit = p.values[0];
      if (p.method === 'orderDesc') desc = true;
    }
    if (desc) rows.reverse();
    return { rows: rows.slice(0, limit), total: rows.length };
  }
}
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 0, 0, 0, 0, 0, 0]);
class FakeStorage {
  constructor() { this.files = new Map(); }
  add(id, { owner, buf, mime = 'image/jpeg' }) { this.files.set(id, { $id: id, $permissions: [`update("user:${owner}")`, `read("user:${owner}")`, `delete("user:${owner}")`], mimeType: mime, sizeOriginal: buf.length, buf }); }
  async getFile({ fileId }) { const f = this.files.get(fileId); if (!f) { const e = new Error('x'); e.code = 404; throw e; } return { ...f }; }
  async getFileDownload({ fileId }) { return this.files.get(fileId).buf; }
  async updateFile({ fileId, permissions }) { this.files.get(fileId).$permissions = permissions; }
  async deleteFile({ fileId }) { this.files.delete(fileId); }
}
const VAR = { id: 101, title: '12x16 / Black', options: { size: '12x16', color: 'Black' }, placeholders: [{ position: 'front', width: 1200, height: 1600 }] };
function world(over = {}) {
  const db = new FakeDb(), storage = new FakeStorage();
  const memberships = { alice: ['fam1'], bob: ['fam1'], carol: ['fam2'] };
  const users = { listMemberships: async ({ userId }) => ({ memberships: (memberships[userId] || []).map((t) => ({ teamId: t, confirm: true })) }) };
  const sessions = new Map(); const pcalls = []; let pFail = null;
  const stripe = {
    createCheckoutSession: async (p, key) => { const id = 'cs_' + key.slice(0, 10); const s = { id, url: 'https://checkout.stripe.test/' + id, params: p }; sessions.set(id, { ...s, status: 'open', payment_status: 'unpaid', client_reference_id: p.client_reference_id, currency: 'usd' }); return s; },
    retrieveSession: async (id) => { const s = sessions.get(id); if (!s) throw new Error('no'); return JSON.parse(JSON.stringify(s)); },
    expireSession: async (id) => { const s = sessions.get(id); if (s.payment_status !== 'paid') s.status = 'expired'; }
  };
  const printify = {
    shippingCost: async () => ({ standard: 499 }),
    uploadImageBase64: async (name, b64) => { pcalls.push(['upload', name]); return { id: 'img1', preview_url: 'https://pfy.test/' + name }; },
    createOrder: async (o) => { pcalls.push(['create', o]); if (pFail) throw pFail; return { id: 'pf_' + o.external_id.slice(0, 6), status: 'pending', total_price: over.cost ?? 1500, total_shipping: 400 }; },
    sendToProduction: async (id) => { pcalls.push(['send', id]); },
    getOrder: async (id) => printify.__order || { id, status: 'pending', metadata: {} },
    cancelOrder: async (id) => { pcalls.push(['cancel', id]); },
    listWebhooks: async () => [], createWebhook: async (t) => { pcalls.push(['hook', t]); return {}; },
    listBlueprints: async () => [{ id: 7, title: 'Framed Poster', brand: 'Acme', model: 'fp' }],
    listProviders: async () => [{ id: 3, title: 'Prov', production_time: { average: 4 } }],
    listVariants: async () => ({ variants: [VAR, { id: 102, title: '16x20 / Black', options: {}, placeholders: [{ position: 'front', width: 1600, height: 2000 }] }] })
  };
  const cfg = { databaseId: 'family', designBucketId: 'shop-designs', siteUrl: 'https://x.test/FamilyCircle/', adminIds: ['owner'], countries: ['US'], stripeKeyPrefix: 'sk_test_', stripeWebhookSecret: 'whsec_1', printifyWebhookSecret: 'pfy1', webhookBase: 'https://fn.test', autoSubmit: false, ...over.cfg };
  let t = 1700000000000;
  const shop = createShop({ users, db, storage, stripe, printify, cfg, now: () => t });
  const A = { $id: 'alice', email: 'a@x.test', emailVerification: true }, B = { $id: 'bob', email: 'b@x.test', emailVerification: true }, C = { $id: 'carol', email: 'c@x.test', emailVerification: true }, O = { $id: 'owner', email: 'o@x.test', emailVerification: true };
  const call = async (user, action, body = {}) => { const r = await shop.handle({ user, body: { action, ...body } }); return r; };
  const ok = async (user, action, body) => { const r = await call(user, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`); return r.json; };
  return { db, storage, shop, stripe, printify, sessions, pcalls, cfg, A, B, C, O, call, ok, setFail: (e) => { pFail = e; }, advance: (ms) => { t += ms; }, sign: (secret, body) => { const ts = Math.floor(t / 1000); return `t=${ts},v1=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`; } };
}
async function seed(w) {
  await w.db.createRow({ tableId: T.families, rowId: 'fam1', data: {}, permissions: [] });
  await w.db.createRow({ tableId: T.families, rowId: 'fam2', data: {}, permissions: [] });
  await w.db.createRow({ tableId: T.posts, rowId: 'post1', data: { familyId: 'fam1', authorId: 'alice', kind: 'photo', mediaFileId: 'm1' }, permissions: [] });
  await w.ok(w.O, 'shopAdminSaveProduct', { key: 'framed-print', blueprintId: 7, providerId: 3, position: 'front', title: 'Framed photo print', enabled: true, variants: [{ id: 101, priceCents: 3000 }, { id: 102, priceCents: 4500 }] });
}
const ADDR = { first_name: 'Bob', last_name: 'Lee', address1: '1 Main St', city: 'Valdosta', region: 'ga', zip: '31601', country: 'US' };
async function design(w, user = w.A, fileId = 'f1', variantId = 101, ratio = [1200, 1600]) {
  w.storage.add(fileId, { owner: user.$id, buf: jpeg(...ratio) });
  return w.ok(user, 'shopSaveDesign', { familyId: 'fam1', postId: 'post1', productKey: 'framed-print', variantId, fileId, quantity: 1, spec: { zoom: 1 } });
}
async function pay(w, orderId, extra = {}) {
  const sid = [...w.sessions.keys()].find((k) => w.sessions.get(k).client_reference_id === orderId);
  const s = w.sessions.get(sid); const o = w.db.tab(T.orders).get(orderId);
  Object.assign(s, { status: 'complete', payment_status: 'paid', amount_subtotal: o.subtotalCents, amount_total: o.subtotalCents + o.shippingCents, shipping_cost: { amount_subtotal: o.shippingCents }, total_details: { amount_tax: 0, amount_shipping: o.shippingCents }, payment_intent: 'pi_1', ...extra });
  return sid;
}
const evt = (w, id, type, sid) => { const raw = JSON.stringify({ id, type, data: { object: { id: sid } } }); return [raw, { 'stripe-signature': w.sign('whsec_1', raw) }]; };

/* ---------- tests ---------- */
test('only the owner can set up products; the server checks IDs against Printify; nothing is enabled by default', async () => {
  const w = world();
  assert.equal((await w.call(w.A, 'shopAdminSaveProduct', {})).status, 403);
  await w.db.createRow({ tableId: T.families, rowId: 'fam1', data: {}, permissions: [] });
  let c = await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' });
  assert.equal(c.products.length, 0); assert.ok(c.slots.every((s) => !s.available));
  const bad = await w.call(w.O, 'shopAdminSaveProduct', { key: 'mug', blueprintId: 7, providerId: 3, position: 'front', variants: [{ id: 999, priceCents: 1500 }] });
  assert.equal(bad.status, 400);
  assert.equal((await w.call(w.O, 'shopAdminSaveProduct', { key: 'nope', blueprintId: 7, providerId: 3, position: 'front', variants: [{ id: 101, priceCents: 1500 }] })).status, 400);
  await w.ok(w.O, 'shopAdminSaveProduct', { key: 'mug', blueprintId: 7, providerId: 3, position: 'front', variants: [{ id: 101, priceCents: 1500 }] });
  c = await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' }); assert.equal(c.products.length, 0, 'saved but not enabled');
  await w.ok(w.O, 'shopAdminToggle', { key: 'mug', enabled: true });
  c = await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' }); assert.equal(c.products[0].variants[0].priceCents, 1500);
  assert.equal(JSON.stringify(c).includes('blueprint'), false, 'no Printify ids go to shoppers');
  assert.equal((await w.call(w.C, 'shopCatalog', { familyId: 'fam1' })).status, 403, 'other family');
});

test('uploader controls gift use; family membership alone is not enough', async () => {
  const w = world(); await seed(w);
  w.storage.add('fb', { owner: 'bob', buf: jpeg(1200, 1600) });
  const body = { familyId: 'fam1', postId: 'post1', productKey: 'framed-print', variantId: 101, fileId: 'fb', quantity: 1 };
  assert.equal((await w.call(w.B, 'shopSaveDesign', body)).status, 403);
  assert.equal((await w.call(w.B, 'shopSetGift', { familyId: 'fam1', postId: 'post1', allowed: true })).status, 403, 'only the uploader can allow');
  await w.ok(w.A, 'shopSetGift', { familyId: 'fam1', postId: 'post1', allowed: true });
  assert.deepEqual((await w.ok(w.B, 'shopGiftStatus', { familyId: 'fam1', postIds: ['post1'] })).allowed, { post1: true });
  await w.ok(w.B, 'shopSaveDesign', body);
});

test('design image checks: owner, JPEG, shape, frozen after save', async () => {
  const w = world(); await seed(w);
  w.storage.add('notmine', { owner: 'bob', buf: jpeg(1200, 1600) });
  const base = { familyId: 'fam1', postId: 'post1', productKey: 'framed-print', variantId: 101, quantity: 1 };
  assert.equal((await w.call(w.A, 'shopSaveDesign', { ...base, fileId: 'notmine' })).status, 403);
  w.storage.add('wrong', { owner: 'alice', buf: jpeg(1600, 1200) });
  assert.equal((await w.call(w.A, 'shopSaveDesign', { ...base, fileId: 'wrong' })).status, 400, 'wrong shape is not stretched');
  w.storage.add('png', { owner: 'alice', buf: jpeg(1200, 1600), mime: 'image/png' });
  assert.equal((await w.call(w.A, 'shopSaveDesign', { ...base, fileId: 'png' })).status, 400);
  const d = await design(w);
  assert.deepEqual(w.storage.files.get('f1').$permissions, ['read("user:alice")'], 'buyer can no longer replace or delete the approved file');
  assert.equal(d.design.unitCents, 3000);
});

test('checkout: server prices, consent needed, duplicate request returns the same order, designs are reserved', async () => {
  const w = world(); await seed(w);
  const d = await design(w);
  const b = { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-12345678', consentImage: true, consentDelivery: true, totalCents: 1 };
  assert.equal((await w.call(w.A, 'shopCheckout', { ...b, consentDelivery: false })).status, 400);
  const q = await w.ok(w.A, 'shopQuote', b); assert.equal(q.totalCents, 3000 + 499);
  const r1 = await w.ok(w.A, 'shopCheckout', b);
  const r2 = await w.ok(w.A, 'shopCheckout', b);
  assert.equal(r1.orderId, r2.orderId); assert.equal(r1.url, r2.url); assert.equal(w.sessions.size, 1, 'one Stripe session only');
  const s = [...w.sessions.values()][0].params;
  assert.equal(s.line_items[0].price_data.unit_amount, 3000, 'the browser-sent total was ignored');
  assert.equal(s.shipping_options[0].shipping_rate_data.fixed_amount.amount, 499);
  const again = await w.call(w.A, 'shopCheckout', { ...b, requestId: 'req-87654321' });
  assert.equal(again.status, 409, 'design is already in an order');
  assert.equal((await w.call(w.B, 'shopQuote', { ...b })).status, 403, 'someone else cannot use my design');
  const o = w.db.tab(T.orders).get(r1.orderId); assert.equal(o.region, undefined); assert.equal(JSON.parse(o.address).region, 'GA');
});

test('payment confirmed by Stripe creates ONE Printify order and waits for manual approval', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-aaaaaaaa', consentImage: true, consentDelivery: true });
  // An event arrives but Stripe says unpaid: nothing happens.
  w.sessions.get([...w.sessions.keys()][0]).status = 'complete';        // card not captured yet (delayed method)
  let [raw, h] = evt(w, 'evt_1', 'checkout.session.completed', [...w.sessions.keys()][0]);
  let r = await w.shop.handleWebhook('stripe', raw, h); assert.equal(r.status, 200);
  assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'processing'); assert.equal(w.pcalls.length, 0);
  const sid = await pay(w, orderId);
  [raw, h] = evt(w, 'evt_2', 'checkout.session.async_payment_succeeded', sid);
  await w.shop.handleWebhook('stripe', raw, h);
  [raw, h] = evt(w, 'evt_3', 'checkout.session.completed', sid);          // a second, different event for the same payment
  await w.shop.handleWebhook('stripe', raw, h);
  r = await w.shop.handleWebhook('stripe', raw, h); assert.equal(r.json.duplicate, true);       // and a retry of the same event
  const o = w.db.tab(T.orders).get(orderId);
  assert.equal(o.paymentStatus, 'paid'); assert.equal(o.fulfillmentStatus, 'created');
  const creates = w.pcalls.filter((c) => c[0] === 'create'); assert.equal(creates.length >= 1, true);
  assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 0, 'manual approval: never sent to production by us');
  assert.equal(creates[0][1].external_id, orderId); assert.equal(creates[0][1].line_items[0].print_areas.front[0].scale, 1);
  assert.equal(creates[0][1].address_to.email, 'a@x.test');
  const late = evt(w, 'evt_4', 'checkout.session.expired', sid);          // late "expired" must not undo a paid order
  await w.shop.handleWebhook('stripe', late[0], late[1]); assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'paid');
  assert.equal(stageOf(w.db.tab(T.orders).get(orderId)).tone, 'ok');
});

test('bad webhook signatures are refused and change nothing', async () => {
  const w = world(); await seed(w);
  let r = await w.shop.handleWebhook('stripe', '{"id":"e","type":"checkout.session.completed"}', { 'stripe-signature': 't=1,v1=00' }); assert.equal(r.status, 400);
  r = await w.shop.handleWebhook('printify', '{"id":"e"}', { 'x-pfy-signature': 'sha256=' + '0'.repeat(64) }); assert.equal(r.status, 400);
  r = await w.shop.handleWebhook('printify', '{"id":"e"}', {}); assert.equal(r.status, 400);
});

test('wrong amount at payment time holds the order instead of fulfilling it', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-bbbbbbbb', consentImage: true, consentDelivery: true });
  const sid = await pay(w, orderId, { amount_subtotal: 100 });
  const [raw, h] = evt(w, 'evt_x', 'checkout.session.completed', sid); await w.shop.handleWebhook('stripe', raw, h);
  const o = w.db.tab(T.orders).get(orderId); assert.equal(o.paymentStatus, 'paid'); assert.equal(o.fulfillmentStatus, 'needs_review'); assert.equal(w.pcalls.length, 0);
});

test('payment succeeds then Printify fails: paid, fulfillment failed, no auto refund, admin retry works', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-cccccccc', consentImage: true, consentDelivery: true });
  w.setFail(new PrintifyError(503, { message: 'secret internal detail' }));
  const sid = await pay(w, orderId); const [raw, h] = evt(w, 'evt_f', 'checkout.session.completed', sid); await w.shop.handleWebhook('stripe', raw, h);
  let o = w.db.tab(T.orders).get(orderId);
  assert.equal(o.paymentStatus, 'paid'); assert.equal(o.fulfillmentStatus, 'failed'); assert.ok(!/secret/.test(o.lastError));
  const uploads = w.pcalls.filter((c) => c[0] === 'upload').length;
  assert.equal((await w.call(w.A, 'shopAdminResolve', { orderId, act: 'retry' })).status, 403, 'buyers cannot run admin actions');
  w.setFail(null);
  const r = await w.ok(w.O, 'shopAdminResolve', { orderId, act: 'retry' });
  assert.equal(r.order.fulfillmentStatus, 'created'); assert.equal(w.pcalls.filter((c) => c[0] === 'upload').length, uploads, 'the image is not uploaded twice');
  const ap = await w.ok(w.O, 'shopAdminResolve', { orderId, act: 'approve' }); assert.equal(ap.order.fulfillmentStatus, 'sending');
  assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 1);
});

test('Printify cost above what the customer paid: order is created but held, not approved, even with auto-submit on', async () => {
  const w = world({ cost: 9000, cfg: { autoSubmit: true } }); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-dddddddd', consentImage: true, consentDelivery: true });
  const sid = await pay(w, orderId); const [raw, h] = evt(w, 'evt_m', 'checkout.session.completed', sid); await w.shop.handleWebhook('stripe', raw, h);
  const o = w.db.tab(T.orders).get(orderId); assert.equal(o.fulfillmentStatus, 'needs_review'); assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 0);
});

test('auto-submit on: a normal order is sent to production once', async () => {
  const w = world({ cfg: { autoSubmit: true } }); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-eeeeeeee', consentImage: true, consentDelivery: true });
  const sid = await pay(w, orderId); for (const id of ['e1', 'e2']) { const [raw, h] = evt(w, id, 'checkout.session.completed', sid); await w.shop.handleWebhook('stripe', raw, h); }
  assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 1); assert.equal(w.db.tab(T.orders).get(orderId).fulfillmentStatus, 'sending');
});

test('photo permission turned off after payment holds the order', async () => {
  const w = world(); await seed(w);
  await w.ok(w.A, 'shopSetGift', { familyId: 'fam1', postId: 'post1', allowed: true });
  const d = await design(w, w.B, 'fb');
  const { orderId } = await w.ok(w.B, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-ffffffff', consentImage: true, consentDelivery: true });
  await w.ok(w.A, 'shopSetGift', { familyId: 'fam1', postId: 'post1', allowed: false });
  const sid = await pay(w, orderId); const [raw, h] = evt(w, 'evt_p', 'checkout.session.completed', sid); await w.shop.handleWebhook('stripe', raw, h);
  assert.equal(w.db.tab(T.orders).get(orderId).fulfillmentStatus, 'needs_review'); assert.equal(w.pcalls.length, 0);
});

test('order privacy: only the buyer reads an order; admin sees operations; status never moves backwards', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-gggggggg', consentImage: true, consentDelivery: true });
  assert.equal((await w.call(w.B, 'shopOrder', { orderId })).status, 404, 'same family, different person');
  assert.equal((await w.call(w.C, 'shopOrder', { orderId })).status, 404);
  assert.equal((await w.ok(w.B, 'shopOrders')).orders.length, 0);
  const mine = await w.ok(w.A, 'shopOrder', { orderId }); assert.equal(mine.order.address.zip, '31601');
  assert.equal(JSON.stringify((await w.ok(w.A, 'shopOrders')).orders).includes('31601'), false, 'the list never carries addresses');
  assert.equal((await w.call(w.A, 'shopAdminOrder', { orderId })).status, 403);
  const sid = await pay(w, orderId); const [raw, h] = evt(w, 'evt_o', 'checkout.session.completed', sid); await w.shop.handleWebhook('stripe', raw, h);
  const adm = await w.ok(w.O, 'shopAdminOrder', { orderId }); assert.equal(adm.order.address.zip, '31601');
  // Printify webhook: shipment, then a late "in production" event must not undo it
  const pid = w.db.tab(T.orders).get(orderId).printifyOrderId;
  const send = async (id, status, shipments) => { w.printify.__order = { id: pid, status, shipments, metadata: { shop_order_id: orderId } }; const raw = JSON.stringify({ id, type: 'order:updated', resource: { id: pid } }); return w.shop.handleWebhook('printify', raw, { 'x-pfy-signature': 'sha256=' + createHmac('sha256', 'pfy1').update(raw).digest('hex') }); };
  await send('w1', 'fulfilled', [{ carrier: 'usps', number: '94', url: 'https://t.test/94', delivered_at: null }]);
  assert.equal(w.db.tab(T.orders).get(orderId).fulfillmentStatus, 'shipped');
  await send('w2', 'in-production', []); assert.equal(w.db.tab(T.orders).get(orderId).fulfillmentStatus, 'shipped');
  const dup = await send('w2', 'in-production', []); assert.equal(dup.json.duplicate, true);
  await send('w3', 'fulfilled', [{ carrier: 'usps', number: '94', url: 'u', delivered_at: '2026-11-20 10:00:00+00:00' }]);
  const fin = await w.ok(w.A, 'shopOrder', { orderId }); assert.equal(fin.order.fulfillmentStatus, 'delivered'); assert.equal(fin.order.tracking[0].number, '94');
});

test('buyer can cancel only an unpaid order; designs are released', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-hhhhhhhh', consentImage: true, consentDelivery: true });
  const r = await w.ok(w.A, 'shopCancelOrder', { orderId }); assert.equal(r.order.paymentStatus, 'expired');
  assert.equal((await w.ok(w.A, 'shopDesigns', { familyId: 'fam1' })).designs.length, 1, 'back in the cart');
});

test('abandoned checkout frees the design after 35 minutes', async () => {
  const w = world(); await seed(w); const d = await design(w);
  await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-iiiiiiii', consentImage: true, consentDelivery: true });
  assert.equal((await w.ok(w.A, 'shopDesigns', { familyId: 'fam1' })).designs.length, 0);
  w.advance(36 * 60e3); assert.equal((await w.ok(w.A, 'shopDesigns', { familyId: 'fam1' })).designs.length, 1);
});

test('address checks and product price guard', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const b = { familyId: 'fam1', designIds: [d.design.id], requestId: 'req-jjjjjjjj', consentImage: true, consentDelivery: true };
  assert.equal((await w.call(w.A, 'shopQuote', { ...b, address: { ...ADDR, zip: 'ABC' } })).status, 400);
  assert.equal((await w.call(w.A, 'shopQuote', { ...b, address: { ...ADDR, country: 'FR' } })).status, 400);
  assert.equal((await w.call(w.A, 'shopQuote', { ...b, address: { ...ADDR, region: 'Georgia' } })).status, 400);
  assert.equal((await w.call(w.O, 'shopAdminSaveProduct', { key: 'mug', blueprintId: 7, providerId: 3, position: 'front', variants: [{ id: 101, priceCents: 5 }] })).status, 400);
});

test('webhook registration is admin only and uses the function URL', async () => {
  const w = world(); await seed(w);
  assert.equal((await w.call(w.A, 'shopAdminRegisterWebhooks')).status, 403);
  const r = await w.ok(w.O, 'shopAdminRegisterWebhooks'); assert.equal(r.url, 'https://fn.test/webhooks/printify'); assert.ok(r.added.includes('order:shipment:created'));
});

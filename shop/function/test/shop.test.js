import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createShop, T, stageOf } from '../src/shop.js';
import { PrintifyError } from '../src/printify.js';
import { SquareError } from '../src/square.js';

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
  async createFile({ fileId, file, permissions }) { this.files.set(fileId, { $id: fileId, $permissions: permissions, buf: Buffer.alloc(0), mimeType: 'image/jpeg' }); return { $id: fileId }; }
}
const VAR = { id: 101, title: '12x16 / Black', options: { size: '12x16', color: 'Black' }, placeholders: [{ position: 'front', width: 1200, height: 1600 }] };
function world(over = {}) {
  const db = new FakeDb(), storage = new FakeStorage();
  const memberships = { alice: ['fam1'], bob: ['fam1'], carol: ['fam2'] };
  const users = { listMemberships: async ({ userId }) => ({ memberships: (memberships[userId] || []).map((t) => ({ teamId: t, confirm: true })) }) };
  const pcalls = []; let pFail = null;
  const sq = { links: new Map(), orders: new Map(), payments: new Map(), refunds: new Map(), deleted: [], created: [] };
  const nf = () => new SquareError(404, [{ category: 'INVALID_REQUEST_ERROR', code: 'NOT_FOUND' }]);
  const square = {
    createPaymentLink: async (req) => {
      sq.created.push(req);
      const key = req.idempotency_key; const id = 'pl_' + key.slice(0, 8), oid = 'sqo_' + key.slice(0, 8);
      const items = req.order.line_items; const sub = items.reduce((n, l) => n + Number(l.quantity) * l.base_price_money.amount, 0);
      const ship = (req.checkout_options.shipping_fee && req.checkout_options.shipping_fee.charge.amount) || 0;
      const order = { id: oid, location_id: req.order.location_id, reference_id: req.order.reference_id, metadata: req.order.metadata, state: 'OPEN', line_items: items, total_money: { amount: over.sqTotal ?? sub + ship, currency: 'USD' }, total_tax_money: { amount: 0, currency: 'USD' }, tenders: [] };
      sq.orders.set(oid, order); sq.links.set(id, { id, order_id: oid });
      return { payment_link: { id, order_id: oid, url: over.sqUrl ?? 'https://square.test/pay/' + id }, related_resources: { orders: [order] } };
    },
    deletePaymentLink: async (id) => { sq.deleted.push(id); sq.links.delete(id); return {}; },
    retrievePayment: async (id) => { const x = sq.payments.get(id); if (!x) throw nf(); return JSON.parse(JSON.stringify({ payment: x })); },
    retrieveOrder: async (id) => { const x = sq.orders.get(id); if (!x) throw nf(); return JSON.parse(JSON.stringify({ order: x })); },
    retrieveRefund: async (id) => { const x = sq.refunds.get(id); if (!x) throw nf(); return JSON.parse(JSON.stringify({ refund: x })); },
    retrieveLocation: async (id) => ({ location: { id, merchant_id: 'M1', name: 'Shop', status: 'ACTIVE', currency: 'USD', country: 'US' } })
  };
  const printify = {
    shippingCost: async () => ({ standard: 499 }),
    uploadImageBase64: async (name, b64) => { pcalls.push(['upload', name]); return { id: 'img1', preview_url: 'https://pfy.test/' + name }; },
    createOrder: async (o) => { pcalls.push(['create', o]); if (pFail) throw pFail; return { id: 'pf_' + o.external_id.slice(0, 6), status: 'pending', total_price: over.cost ?? 1500, total_shipping: 400 }; },
    sendToProduction: async (id) => { pcalls.push(['send', id]); },
    getOrder: async (id) => printify.__order || { id, status: 'pending', metadata: {} },
    cancelOrder: async (id) => { pcalls.push(['cancel', id]); },
    createProduct: async (p) => { pcalls.push(['createProduct', p]); if (over.noProduct) throw new PrintifyError(400, { message: 'bad' }); return { id: 'tmp1' }; },
    getProduct: async (id) => { pcalls.push(['getProduct', id]); return over.mockupReady === false ? { id, images: [] } : { id, images: [{ src: 'https://images-api.printify.com/mockup/tmp1/101/a.jpg', variant_ids: [101], is_default: true }] }; },
    deleteProduct: async (id) => { pcalls.push(['deleteProduct', id]); },
    listWebhooks: async () => [], createWebhook: async (t) => { pcalls.push(['hook', t]); return {}; },
    listBlueprints: async () => [{ id: 7, title: 'Framed Poster', brand: 'Acme', model: 'fp', images: ['http://evil.example/x.jpg', 'https://images.printify.com/a.jpg'] }],
    listProviders: async () => [{ id: 3, title: 'Prov', production_time: { average: 4 } }],
    listVariants: async () => ({ variants: [VAR, { id: 102, title: '16x20 / Black', options: {}, placeholders: [{ position: 'front', width: 1600, height: 2000 }] }] })
  };
  const cfg = { databaseId: 'family', designBucketId: 'shop-designs', siteUrl: 'https://x.test/FamilyCircle/', adminIds: ['owner'], countries: ['US'], squareConfigured: true, squareEnvironment: 'sandbox', squareLocationId: 'LOC1', squareWebhookSignatureKey: 'sigkey', printifyWebhookSecret: 'pfy1', printifyConfigured: true, printifyShopId: '15930678', webhookBase: 'https://fn.test', autoSubmit: false, ...over.cfg };
  let t = 1700000000000;
  const fetchImpl = async (u) => { pcalls.push(['fetchImage', u]); return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array(3000).buffer }; };
  const shop = createShop({ users, db, storage, square, printify, cfg, now: () => t, fetchImpl });
  const A = { $id: 'alice', email: 'a@x.test', emailVerification: true }, B = { $id: 'bob', email: 'b@x.test', emailVerification: true }, C = { $id: 'carol', email: 'c@x.test', emailVerification: true }, O = { $id: 'owner', email: 'o@x.test', emailVerification: true };
  const call = async (user, action, body = {}) => { const r = await shop.handle({ user, body: { action, ...body } }); return r; };
  const ok = async (user, action, body) => { const r = await call(user, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`); return r.json; };
  return { db, storage, shop, square, sq, printify, pcalls, cfg, A, B, C, O, call, ok, setFail: (e) => { pFail = e; }, advance: (ms) => { t += ms; }, sign: (body, url = 'https://fn.test/webhooks/square', key = 'sigkey') => createHmac('sha256', key).update(url + body).digest('base64') };
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
let payN = 0;
/** Records a payment in the fake Square the way Square would after the buyer pays on its page. */
function pay(w, orderId, extra = {}) {
  const o = w.db.tab(T.orders).get(orderId); const order = w.sq.orders.get(o.squareOrderId);
  const id = extra.id || 'pay_' + ++payN;
  const p = { id, status: 'COMPLETED', location_id: 'LOC1', order_id: order.id, total_money: { amount: o.subtotalCents + o.shippingCents, currency: 'USD' }, tip_money: { amount: 0, currency: 'USD' }, ...extra };
  w.sq.payments.set(id, p); if (!order.tenders.some((x) => x.payment_id === id)) order.tenders.push({ id: 'tdr_' + id, payment_id: id });
  return id;
}
const evt = (w, id, type, objId, extra = {}) => {
  const isRefund = type.startsWith('refund');
  const raw = JSON.stringify({ merchant_id: 'M1', type, event_id: id, created_at: '2026-11-07T00:00:00Z', data: { type: isRefund ? 'refund' : 'payment', id: objId, object: isRefund ? { refund: { id: objId } } : { payment: { id: objId } } }, ...extra });
  return [raw, { 'x-square-hmacsha256-signature': w.sign(raw) }];
};
const hook = (w, id, type, objId, extra) => { const [raw, h] = evt(w, id, type, objId, extra); return w.shop.handleWebhook('square', raw, h); };

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
  assert.equal(c.products[0].image, 'https://images.printify.com/a.jpg', 'only Printify pictures are passed on');
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
  assert.equal(r1.orderId, r2.orderId); assert.equal(r1.url, r2.url); assert.equal(w.sq.created.length, 1, 'one Square link only');
  const s = w.sq.created[0];
  assert.equal(s.order.line_items[0].base_price_money.amount, 3000, 'the browser-sent total was ignored');
  assert.equal(s.checkout_options.shipping_fee.charge.amount, 499);
  assert.equal(s.order.location_id, 'LOC1'); assert.equal(s.order.reference_id, r1.orderId); assert.equal(s.idempotency_key, r1.orderId);
  assert.equal(s.checkout_options.redirect_url, `https://x.test/FamilyCircle/#/orders/${r1.orderId}/done`);
  assert.equal(s.checkout_options.ask_for_shipping_address, true, 'Square only accepts a shipping fee together with the address fields');
  assert.equal(s.pre_populated_data.buyer_address.address_line_1, '1 Main St'); assert.equal(s.pre_populated_data.buyer_address.administrative_district_level_1, 'GA');
  const again = await w.call(w.A, 'shopCheckout', { ...b, requestId: 'req-87654321' });
  assert.equal(again.status, 409, 'design is already in an order');
  assert.equal((await w.call(w.B, 'shopQuote', { ...b })).status, 403, 'someone else cannot use my design');
  const o = w.db.tab(T.orders).get(r1.orderId); assert.equal(o.region, undefined); assert.equal(JSON.parse(o.address).region, 'GA');
});

test('a Square payment confirmed by Square creates ONE Printify order and waits for manual approval', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-aaaaaaaa', consentImage: true, consentDelivery: true });
  // payment.updated arrives while Square says the payment is only APPROVED: that is not success.
  const sid = pay(w, orderId, { status: 'APPROVED' });
  await hook(w, 'evt_1', 'payment.updated', sid);
  assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'processing'); assert.equal(w.pcalls.length, 0);
  w.sq.payments.get(sid).status = 'COMPLETED';
  await hook(w, 'evt_2', 'payment.updated', sid);
  await hook(w, 'evt_3', 'payment.created', sid);                         // another, different event for the same payment
  const r = await hook(w, 'evt_3', 'payment.created', sid); assert.equal(r.json.duplicate, true);       // and a retry of the same event
  const o = w.db.tab(T.orders).get(orderId);
  assert.equal(o.paymentStatus, 'paid'); assert.equal(o.fulfillmentStatus, 'created'); assert.equal(o.squarePaymentId, sid);
  const creates = w.pcalls.filter((c) => c[0] === 'create'); assert.equal(creates.length, 1, 'exactly one Printify order');
  assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 0, 'manual approval: never sent to production by us');
  assert.equal(creates[0][1].external_id, orderId); assert.equal(creates[0][1].line_items[0].print_areas.front[0].scale, 1);
  assert.equal(creates[0][1].address_to.email, 'a@x.test');
  w.sq.payments.get(sid).status = 'CANCELED';                              // a late, odd status must not undo a paid order
  await hook(w, 'evt_4', 'payment.updated', sid); assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'paid');
  assert.equal(stageOf(w.db.tab(T.orders).get(orderId)).tone, 'ok');
});

test('a redirect alone is not payment: asking for the order refreshes from Square, and an unpaid order stays unpaid', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-rrrrrrrr', consentImage: true, consentDelivery: true });
  let r = await w.ok(w.A, 'shopOrder', { orderId, refresh: true }); assert.equal(r.order.paymentStatus, 'pending_payment'); assert.equal(w.pcalls.length, 0);
  pay(w, orderId);                                                          // the webhook is late or lost, but Square knows
  r = await w.ok(w.A, 'shopOrder', { orderId, refresh: true }); assert.equal(r.order.paymentStatus, 'paid');
  assert.equal(w.pcalls.filter((c) => c[0] === 'create').length, 1);
});

test('payments at another location, or for orders that are not ours, are ignored', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-oooooooo', consentImage: true, consentDelivery: true });
  const o = w.db.tab(T.orders).get(orderId);
  const stranger = pay(w, orderId, { id: 'pay_other_loc', location_id: 'OTHER' });
  assert.equal((await hook(w, 'e_a', 'payment.updated', stranger)).status, 200);
  const foreign = (id, ref, loc = 'LOC1') => { w.sq.orders.set('sqo_' + id, { id: 'sqo_' + id, location_id: loc, reference_id: ref, state: 'OPEN', line_items: [], total_money: { amount: 100, currency: 'USD' } }); w.sq.payments.set('pay_' + id, { id: 'pay_' + id, status: 'COMPLETED', location_id: 'LOC1', order_id: 'sqo_' + id, total_money: { amount: 100, currency: 'USD' } }); return 'pay_' + id; };
  await hook(w, 'e_b', 'payment.updated', foreign('x', 'a'.repeat(35)));        // looks like an order id but we have no such order
  await hook(w, 'e_c', 'payment.updated', foreign('y', 'not-ours'));            // some other app's reference
  await hook(w, 'e_e', 'payment.updated', foreign('z', orderId));               // our order id, but a different Square order than we created
  await hook(w, 'e_d', 'payment.updated', 'pay_missing');                       // Square has no such payment
  assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'pending_payment'); assert.equal(w.pcalls.length, 0);
  assert.ok(o.squareOrderId);
});

test('bad webhook signatures are refused and change nothing', async () => {
  const w = world(); await seed(w);
  const raw = '{"type":"payment.updated","event_id":"e","data":{"object":{"payment":{"id":"p"}}}}';
  let r = await w.shop.handleWebhook('square', raw, { 'x-square-hmacsha256-signature': 'AAAA' }); assert.equal(r.status, 400);
  r = await w.shop.handleWebhook('square', raw, {}); assert.equal(r.status, 400);
  r = await w.shop.handleWebhook('square', raw, { 'x-square-hmacsha256-signature': w.sign(raw, 'https://evil.test/webhooks/square') }); assert.equal(r.status, 400, 'signed for another URL');
  r = await w.shop.handleWebhook('square', raw, { 'x-square-hmacsha256-signature': w.sign(raw, undefined, 'otherkey') }); assert.equal(r.status, 400, 'signed with another key');
  r = await w.shop.handleWebhook('square', raw, { 'x-square-hmacsha256-signature': w.sign(raw) }); assert.equal(r.status, 200, 'the right signature is accepted');
  assert.equal((await w.shop.handleWebhook('stripe', '{}', {})).status, 410);
  r = await w.shop.handleWebhook('printify', '{"id":"e"}', { 'x-pfy-signature': 'sha256=' + '0'.repeat(64) }); assert.equal(r.status, 400);
  r = await w.shop.handleWebhook('printify', '{"id":"e"}', {}); assert.equal(r.status, 400);
});

test('wrong amount at payment time holds the order instead of fulfilling it', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-bbbbbbbb', consentImage: true, consentDelivery: true });
  const sid = pay(w, orderId, { total_money: { amount: 100, currency: 'USD' } }); await hook(w, 'evt_x', 'payment.updated', sid);
  const o = w.db.tab(T.orders).get(orderId); assert.equal(o.paymentStatus, 'paid'); assert.equal(o.fulfillmentStatus, 'needs_review'); assert.equal(w.pcalls.length, 0);
});

test('tip, currency or order-total mismatch holds the order', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-kkkkkkkk', consentImage: true, consentDelivery: true });
  const sid = pay(w, orderId, { tip_money: { amount: 200, currency: 'USD' } }); await hook(w, 'e1', 'payment.updated', sid);
  let o = w.db.tab(T.orders).get(orderId); assert.equal(o.fulfillmentStatus, 'needs_review'); assert.match(o.lastError, /tip/); assert.equal(w.pcalls.length, 0);
  const w2 = world(); await seed(w2); const d2 = await design(w2);
  const r2 = await w2.ok(w2.A, 'shopCheckout', { familyId: 'fam1', designIds: [d2.design.id], address: ADDR, requestId: 'req-llllllll', consentImage: true, consentDelivery: true });
  const s2 = pay(w2, r2.orderId, { total_money: { amount: 3499, currency: 'EUR' } }); await hook(w2, 'e1', 'payment.updated', s2);
  o = w2.db.tab(T.orders).get(r2.orderId); assert.equal(o.fulfillmentStatus, 'needs_review'); assert.match(o.lastError, /currency/); assert.equal(w2.pcalls.length, 0);
});

test('Square returns a different total than we priced: the link is deleted and nothing can be paid', async () => {
  const w = world({ sqTotal: 1 }); await seed(w); const d = await design(w);
  const r = await w.call(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-mmmmmmmm', consentImage: true, consentDelivery: true });
  assert.equal(r.status, 502); assert.equal(w.sq.deleted.length, 1);
  const o = [...w.db.tab(T.orders).values()][0]; assert.equal(o.paymentStatus, 'payment_failed');
  assert.equal((await w.ok(w.A, 'shopDesigns', { familyId: 'fam1' })).designs.length, 1, 'design released');
  const w2 = world({ sqUrl: 'http://insecure.test/x' }); await seed(w2); const d2 = await design(w2);
  assert.equal((await w2.call(w2.A, 'shopCheckout', { familyId: 'fam1', designIds: [d2.design.id], address: ADDR, requestId: 'req-nnnnnnnn', consentImage: true, consentDelivery: true })).status, 502, 'only https checkout pages');
});

test('refunds: partial and full are recorded from Square; approval after a refund is refused', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-pppppppp', consentImage: true, consentDelivery: true });
  const sid = pay(w, orderId); await hook(w, 'e1', 'payment.updated', sid);
  assert.equal(w.db.tab(T.orders).get(orderId).fulfillmentStatus, 'created');
  w.sq.refunds.set('rf1', { id: 'rf1', payment_id: sid, status: 'PENDING', amount_money: { amount: 500, currency: 'USD' } });
  await hook(w, 'r0', 'refund.created', 'rf1'); assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'paid', 'a pending refund changes nothing yet');
  w.sq.refunds.get('rf1').status = 'COMPLETED'; w.sq.payments.get(sid).refunded_money = { amount: 500, currency: 'USD' };
  await hook(w, 'r1', 'refund.updated', 'rf1');
  let o = w.db.tab(T.orders).get(orderId); assert.equal(o.paymentStatus, 'partially_refunded'); assert.equal(o.refundedCents, 500);
  assert.equal((await w.call(w.O, 'shopAdminResolve', { orderId, act: 'approve' })).status, 409, 'partially refunded orders are not approved');
  assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 0);
  w.sq.refunds.set('rf2', { id: 'rf2', payment_id: sid, status: 'COMPLETED', amount_money: { amount: 2999, currency: 'USD' } }); w.sq.payments.get(sid).refunded_money = { amount: 3499, currency: 'USD' };
  await hook(w, 'r2', 'refund.updated', 'rf2');
  o = w.db.tab(T.orders).get(orderId); assert.equal(o.paymentStatus, 'refunded'); assert.equal(o.fulfillmentStatus, 'needs_review'); assert.match(o.lastError, /Printify/);
  await hook(w, 'r3', 'payment.updated', sid); assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'refunded', 'a late payment event does not undo a refund');
  assert.equal(stageOf(w.db.tab(T.orders).get(orderId)).label, 'Refunded');
});

test('a refund made in Square right before approval is noticed by the approve button', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-qqqqqqqq', consentImage: true, consentDelivery: true });
  const sid = pay(w, orderId); await hook(w, 'e1', 'payment.updated', sid);
  w.sq.payments.get(sid).refunded_money = { amount: 3499, currency: 'USD' };      // the refund webhook has not arrived yet
  assert.equal((await w.call(w.O, 'shopAdminResolve', { orderId, act: 'approve' })).status, 409);
  assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 0); assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'refunded');
});

test('a second payment for the same order is noted, not fulfilled twice', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-ssssssss', consentImage: true, consentDelivery: true });
  const p1 = pay(w, orderId); await hook(w, 'e1', 'payment.updated', p1);
  const p2 = pay(w, orderId, { id: 'pay_dup' }); await hook(w, 'e2', 'payment.updated', p2);
  const o = w.db.tab(T.orders).get(orderId); assert.equal(o.squarePaymentId, p1); assert.match(o.lastError, /pay_dup/);
  assert.equal(w.pcalls.filter((c) => c[0] === 'create').length, 1);
});

test('a payment that arrives after the order was closed is kept but held for review', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-tttttttt', consentImage: true, consentDelivery: true });
  w.advance(36 * 60e3); await w.ok(w.A, 'shopDesigns', { familyId: 'fam1' });          // the stale reservation is closed
  assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'expired'); assert.equal(w.sq.deleted.length, 1, 'payment link deleted');
  const sid = pay(w, orderId); await hook(w, 'e1', 'payment.updated', sid);
  const o = w.db.tab(T.orders).get(orderId); assert.equal(o.paymentStatus, 'paid'); assert.equal(o.fulfillmentStatus, 'needs_review'); assert.equal(w.pcalls.length, 0);
});

test('closing a stale order first asks Square: a payment we missed wins over expiry', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-uuuuuuuu', consentImage: true, consentDelivery: true });
  pay(w, orderId); w.advance(36 * 60e3); await w.ok(w.A, 'shopDesigns', { familyId: 'fam1' });
  assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'paid'); assert.equal(w.sq.deleted.length, 0);
  assert.equal((await w.call(w.A, 'shopCancelOrder', { orderId })).status, 409, 'a paid order cannot be canceled by the buyer');
});

test('a declined card keeps the order waiting; a later successful payment completes it', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-vvvvvvvv', consentImage: true, consentDelivery: true });
  const f = pay(w, orderId, { id: 'pay_fail', status: 'FAILED' }); await hook(w, 'e1', 'payment.updated', f);
  assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'pending_payment', 'the Square page stays open for another try');
  const ok = pay(w, orderId, { id: 'pay_ok' }); await hook(w, 'e2', 'payment.updated', ok);
  assert.equal(w.db.tab(T.orders).get(orderId).paymentStatus, 'paid');
});

test('old Stripe orders are left alone and never touched by Square events', async () => {
  const w = world(); await seed(w);
  const oldId = 'c'.repeat(35);
  await w.db.createRow({ tableId: T.orders, rowId: oldId, data: { ownerId: 'alice', familyId: 'fam1', paymentStatus: 'paid', fulfillmentStatus: 'shipped', items: '[]', address: '{}', subtotalCents: 3000, shippingCents: 499, totalCents: 3499, stripeSessionId: 'cs_old', stripePaymentIntent: 'pi_old', tracking: '[]' }, permissions: [] });
  const list = await w.ok(w.A, 'shopOrders'); assert.equal(list.orders.length, 1); assert.equal(list.orders[0].paymentStatus, 'paid');
  const row = await w.ok(w.O, 'shopAdminOrder', { orderId: oldId }); assert.equal(row.order.oldStripeRef, 'pi_old'); assert.equal(row.order.paymentProvider, 'stripe (old order)');
  const r = await w.ok(w.A, 'shopOrder', { orderId: oldId, refresh: true }); assert.equal(r.order.paymentStatus, 'paid');
  w.sq.orders.set('sqo_old', { id: 'sqo_old', location_id: 'LOC1', reference_id: oldId, state: 'OPEN', line_items: [], total_money: { amount: 3499, currency: 'USD' } });
  w.sq.payments.set('pay_old', { id: 'pay_old', status: 'COMPLETED', location_id: 'LOC1', order_id: 'sqo_old', total_money: { amount: 3499, currency: 'USD' } });
  await hook(w, 'e1', 'payment.updated', 'pay_old'); assert.equal(w.pcalls.length, 0); assert.equal(w.db.tab(T.orders).get(oldId).fulfillmentStatus, 'shipped');
});

test("a photo from the buyer's own phone can be used without a family post, but only with the confirmation", async () => {
  const w = world(); await seed(w);
  w.storage.add('own1', { owner: 'alice', buf: jpeg(1200, 1600) });
  const base = { familyId: 'fam1', postId: 'own-upload', productKey: 'framed-print', variantId: 101, fileId: 'own1', quantity: 1, spec: { zoom: 1 } };
  assert.equal((await w.call(w.A, 'shopSaveDesign', base)).status, 400, 'no confirmation, no design');
  await w.ok(w.A, 'shopSaveDesign', { ...base, ownPhoto: true });
  const rows = [...w.db.tab(T.designs).values()]; assert.equal(rows.length, 1); assert.equal(rows[0].postId, 'own-upload');
  const cart = await w.ok(w.A, 'shopQuote', { familyId: 'fam1', designIds: [rows[0].$id], address: ADDR });
  assert.ok(cart.totalCents > 0, 'an own-photo design can be quoted');
});

test('payment succeeds then Printify fails: paid, fulfillment failed, no auto refund, admin retry works', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-cccccccc', consentImage: true, consentDelivery: true });
  w.setFail(new PrintifyError(503, { message: 'secret internal detail' }));
  const sid = pay(w, orderId); await hook(w, 'evt_f', 'payment.updated', sid);
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
  const sid = pay(w, orderId); await hook(w, 'evt_m', 'payment.updated', sid);
  const o = w.db.tab(T.orders).get(orderId); assert.equal(o.fulfillmentStatus, 'needs_review'); assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 0);
});

test('auto-submit on: a normal order is sent to production once', async () => {
  const w = world({ cfg: { autoSubmit: true } }); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-eeeeeeee', consentImage: true, consentDelivery: true });
  const sid = pay(w, orderId); for (const id of ['e1', 'e2']) await hook(w, id, 'payment.updated', sid);
  assert.equal(w.pcalls.filter((c) => c[0] === 'send').length, 1); assert.equal(w.db.tab(T.orders).get(orderId).fulfillmentStatus, 'sending');
});

test('photo permission turned off after payment holds the order', async () => {
  const w = world(); await seed(w);
  await w.ok(w.A, 'shopSetGift', { familyId: 'fam1', postId: 'post1', allowed: true });
  const d = await design(w, w.B, 'fb');
  const { orderId } = await w.ok(w.B, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-ffffffff', consentImage: true, consentDelivery: true });
  await w.ok(w.A, 'shopSetGift', { familyId: 'fam1', postId: 'post1', allowed: false });
  const sid = pay(w, orderId); await hook(w, 'evt_p', 'payment.updated', sid);
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
  const sid = pay(w, orderId); await hook(w, 'evt_o', 'payment.updated', sid);
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

/* ---------- sync from the owner's own Printify shop ---------- */
const PID = 'a1b2c3d4e5f6a1b2c3d4e5f6', PID2 = 'b1b2c3d4e5f6a1b2c3d4e5f7';
const mkProduct = (over = {}) => ({
  id: PID, title: 'Personalized Photo Mug', description: '<p>Hello &amp; welcome</p>', blueprint_id: 68, print_provider_id: 5, visible: false,
  options: [{ name: 'Size', type: 'size', values: [{ id: 1, title: '11oz' }, { id: 2, title: '15oz' }] }],
  variants: [{ id: 501, title: '11oz', price: 1999, is_enabled: true, is_available: true, options: [1] }, { id: 502, title: '15oz', price: 2299, is_enabled: true, is_available: true, options: [2] }, { id: 503, title: '20oz', price: 2599, is_enabled: false, is_available: true, options: [] }],
  images: [{ src: 'https://images-api.printify.com/mockup/a.jpg', is_default: false, variant_ids: [501], position: 'front' }, { src: 'https://images-api.printify.com/mockup/b.jpg', is_default: true, variant_ids: [502], position: 'front' }, { src: 'http://evil.test/c.jpg', variant_ids: [501], is_default: true }],
  print_areas: [{ variant_ids: [501, 502], placeholders: [{ position: 'front', images: [] }] }], ...over
});
const MUG_CAT = { variants: [{ id: 501, options: {}, placeholders: [{ position: 'front', width: 2700, height: 1100 }] }, { id: 502, options: {}, placeholders: [{ position: 'front', width: 2700, height: 1100 }] }, { id: 503, options: {}, placeholders: [{ position: 'front', width: 2700, height: 1100 }] }] };
function fakeShop(w, products, extra = {}) {
  const calls = [];
  Object.assign(w.printify, {
    listShops: async () => extra.shops || [{ id: 15930678, title: 'Family Circle', sales_channel: 'custom_integration' }],
    listProductsPage: async (page, limit, sid) => {
      calls.push([page, limit, sid]);
      if (extra.fail) throw extra.fail;
      const list = (extra.byShop && sid !== undefined && extra.byShop[sid]) || products;
      const last = Math.max(1, Math.ceil(list.length / limit));
      return { current_page: page, last_page: last, total: list.length, data: list.slice((page - 1) * limit, page * limit) };
    },
    listVariantsCached: async () => MUG_CAT, probe: async () => ({})
  });
  return calls;
}
async function syncAll(w, body = {}) {
  const seen = []; let page = 1, last = 1, first;
  do { const r = await w.ok(w.O, 'shopAdminSync', { page, ...body }); first ||= r; last = r.lastPage; r.results.forEach((x) => x.key && seen.push(x.key)); page++; } while (page <= last);
  await w.ok(w.O, 'shopAdminSyncFinish', { seen });
  return first;
}

test('sync reads EVERY page of the shop products, is admin only, and stores a stable row per Printify product', async () => {
  const w = world(); await seed(w);
  const many = Array.from({ length: 23 }, (_, i) => mkProduct({ id: (i + 10).toString(16).padStart(24, 'c'), title: 'Mug ' + i }));
  const calls = fakeShop(w, many);
  assert.equal((await w.call(w.A, 'shopAdminSync', { page: 1 })).status, 403);
  await syncAll(w);
  assert.deepEqual(calls.map((c) => c[0]), [1, 2, 3], '23 products at 10 per page = 3 pages');
  const ov = await w.ok(w.O, 'shopAdminOverview');
  assert.equal(ov.imported.length, 23);
  await syncAll(w);                                                            // a second sync updates, never duplicates
  assert.equal((await w.ok(w.O, 'shopAdminOverview')).imported.length, 23);
});

test('imported product: title, text, picture, enabled variants, prices and IDs are copied; new products start hidden', async () => {
  const w = world(); await seed(w); fakeShop(w, [mkProduct()]);
  await syncAll(w);
  const p = (await w.ok(w.O, 'shopAdminOverview')).imported[0];
  assert.equal(p.key, 'pf_' + PID); assert.equal(p.title, 'Personalized Photo Mug'); assert.equal(p.enabled, false);
  assert.equal(p.supported, true); assert.equal(p.variantCount, 2, 'the switched-off 20oz is left out'); assert.equal(p.minCents, 1999); assert.equal(p.maxCents, 2299);
  assert.equal(p.image, 'https://images-api.printify.com/mockup/b.jpg'); assert.equal(p.blueprintId, 68); assert.equal(p.providerId, 5); assert.equal(p.position, 'front'); assert.equal(p.visible, false, 'a draft is imported too');
  assert.equal((await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' })).products.some((x) => x.key === 'pf_' + PID), false, 'hidden until turned on');
  await w.ok(w.O, 'shopAdminToggle', { key: 'pf_' + PID, enabled: true });
  const c = await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' });
  const pub = c.products.find((x) => x.key === 'pf_' + PID);
  assert.equal(pub.blurb, 'Hello & welcome'); assert.deepEqual(pub.variants.map((v) => [v.id, v.label, v.priceCents, v.width, v.height, v.options.Size]), [[501, '11oz', 1999, 2700, 1100, '11oz'], [502, '15oz', 2299, 2700, 1100, '15oz']]);
  assert.equal(pub.image, 'https://images-api.printify.com/mockup/b.jpg');
  assert.deepEqual(pub.images, ['https://images-api.printify.com/mockup/a.jpg', 'https://images-api.printify.com/mockup/b.jpg']);
  assert.deepEqual(pub.variants.map((v) => pub.images[v.img]), ['https://images-api.printify.com/mockup/a.jpg', 'https://images-api.printify.com/mockup/b.jpg'], 'each variant gets its own picture; non-Printify addresses are dropped');
  assert.ok(c.slots.some((s) => s.key === 'pf_' + PID && s.available));
  assert.equal(JSON.stringify(c).includes('cost'), false);
});

test('re-sync keeps the on/off choice, picks up price changes, and marks a product removed from Printify as missing and off', async () => {
  const w = world(); await seed(w); fakeShop(w, [mkProduct(), mkProduct({ id: PID2, title: 'Second' })]);
  await syncAll(w); await w.ok(w.O, 'shopAdminToggle', { key: 'pf_' + PID, enabled: true, section: 'jewelry' });
  fakeShop(w, [mkProduct({ variants: [{ id: 501, title: '11oz', price: 2499, is_enabled: true, is_available: true, options: [1] }] })]);
  await syncAll(w);
  const ov = (await w.ok(w.O, 'shopAdminOverview')).imported;
  const a = ov.find((x) => x.key === 'pf_' + PID), b = ov.find((x) => x.key === 'pf_' + PID2);
  assert.equal(a.enabled, true); assert.equal(a.minCents, 2499); assert.equal(a.section, 'jewelry', 'the local section choice survives a sync');
  assert.equal(b.missing, true); assert.equal(b.enabled, false);
  assert.equal((await w.call(w.O, 'shopAdminToggle', { key: 'pf_' + PID2, enabled: true })).status, 409);
});

test('products the photo editor cannot fill are flagged with a reason and cannot be turned on', async () => {
  const w = world(); await seed(w);
  fakeShop(w, [
    mkProduct({ id: PID, print_areas: [{ variant_ids: [501], placeholders: [{ position: 'front', images: [] }, { position: 'back', images: [] }] }] }),
    mkProduct({ id: PID2, variants: [{ id: 501, title: 'x', price: 1999, is_enabled: false }] }),
    mkProduct({ id: 'c1b2c3d4e5f6a1b2c3d4e5f8', print_areas: [] })
  ]);
  await syncAll(w, { enableNew: true });
  const ov = (await w.ok(w.O, 'shopAdminOverview')).imported;
  assert.equal(ov.length, 3); assert.ok(ov.every((x) => !x.supported && !x.enabled), 'nothing unsupported is ever switched on');
  assert.match(ov.find((x) => x.key === 'pf_' + PID).reason, /2 areas/); assert.match(ov.find((x) => x.key === 'pf_' + PID2).reason, /No variants/);
  const r = await w.call(w.O, 'shopAdminToggle', { key: 'pf_' + PID, enabled: true }); assert.equal(r.status, 409); assert.equal(r.json.error, 'unsupported');
});

test('empty and failing Printify answers are explained, not hidden', async () => {
  let w = world(); await seed(w); fakeShop(w, []);
  let r = await w.ok(w.O, 'shopAdminSync', { page: 1 }); assert.equal(r.diagnosis.code, 'no_products'); assert.match(r.diagnosis.message, /no filter/);
  w = world(); await seed(w); fakeShop(w, [], { byShop: { 999: [mkProduct()] }, shops: [{ id: 15930678, title: 'Family Circle' }, { id: 999, title: 'BrainTeaz' }] });
  r = await w.ok(w.O, 'shopAdminSync', { page: 1 }); assert.equal(r.diagnosis.code, 'wrong_shop_likely'); assert.match(r.diagnosis.message, /BrainTeaz/);
  w = world(); await seed(w); fakeShop(w, [], { fail: new PrintifyError(404, {}), shops: [{ id: 111, title: 'Other' }] });
  r = await w.call(w.O, 'shopAdminSync', { page: 1 }); assert.equal(r.json.error, 'wrong_shop'); assert.match(r.json.message, /Other \(ID 111/);
  w = world(); await seed(w); fakeShop(w, [], { fail: new PrintifyError(403, {}) });
  r = await w.call(w.O, 'shopAdminSync', { page: 1 }); assert.equal(r.json.error, 'missing_permission'); assert.match(r.json.message, /products\.read/);
  w = world(); await seed(w); fakeShop(w, [], { fail: new PrintifyError(401, {}) });
  assert.equal((await w.call(w.O, 'shopAdminSync', { page: 1 })).json.error, 'bad_token');
  w = world(); await seed(w); fakeShop(w, [], { fail: new PrintifyError(503, {}) });
  assert.equal((await w.call(w.O, 'shopAdminSync', { page: 1 })).json.error, 'api_failure');
});

test('an imported product can be designed with a buyer photo, only by its owner, and the shared base product is never edited', async () => {
  const w = world(); await seed(w); fakeShop(w, [mkProduct()]);
  await syncAll(w); await w.ok(w.O, 'shopAdminToggle', { key: 'pf_' + PID, enabled: true });
  w.storage.add('mugf', { owner: 'alice', buf: jpeg(2700, 1100) });
  const d = await w.ok(w.A, 'shopSaveDesign', { familyId: 'fam1', postId: 'post1', productKey: 'pf_' + PID, variantId: 501, fileId: 'mugf', quantity: 1, spec: {} });
  assert.ok(d.design || d.designId || d.id || d.ok);
  const before = JSON.stringify([...w.db.tab(T.catalog).get('pf_' + PID).variants]);
  const rows = [...w.db.tab(T.designs).values()]; assert.equal(rows[0].productKey, 'pf_' + PID); assert.equal(rows[0].ownerId, 'alice');
  assert.equal(JSON.stringify([...w.db.tab(T.catalog).get('pf_' + PID).variants]), before, 'saving a design never edits the shared product');
  assert.equal((await w.call(w.B, 'shopSaveDesign', { familyId: 'fam1', postId: 'post1', productKey: 'pf_' + PID, variantId: 501, fileId: 'mugf', quantity: 1, spec: {} })).status >= 400, true, 'another buyer cannot reuse alice\'s upload');
});

test('Printify connection check reports shop match and which read permissions work', async () => {
  const w = world(); await seed(w); fakeShop(w, [mkProduct()]);
  w.printify.probe = async (path) => { if (path.includes('/orders.json')) throw new PrintifyError(403, {}); return {}; };
  w.printify.listWebhooks = async () => [];
  const r = await w.ok(w.O, 'shopAdminPrintifyCheck');
  assert.equal(r.shopMatch, true); assert.equal(r.shops[0].products, 1);
  assert.equal(r.scopes.find((x) => x.scope === 'products.read').ok, true); assert.equal(r.scopes.find((x) => x.scope === 'orders.read').ok, false);
  assert.equal((await w.call(w.A, 'shopAdminPrintifyCheck')).status, 403);
});

test('sync puts each product in a section by its name, and a section you chose yourself is kept', async () => {
  const { guessSection } = await import('../src/sync.js');
  assert.equal(guessSection('Oval Necklace', 'Personalized Photo Oval Necklace, Custom Image Pendant'), 'jewelry');
  assert.equal(guessSection('Mug', 'Spring photo mug'), 'drinkware');
  assert.equal(guessSection('Framed Poster', 'Framed photo print'), 'wall-art');
  assert.equal(guessSection('Fleece Blanket', 'Photo blanket'), 'home');
  assert.equal(guessSection('Unisex Tee', 'Family reunion shirt'), 'apparel');
  assert.equal(guessSection('Whatever', 'Surprise thing'), 'gifts');
  const w = world(); await seed(w);
  fakeShop(w, [mkProduct({ title: 'Photo Oval Necklace' }), mkProduct({ id: PID2, title: 'Photo mug' })]);
  await syncAll(w);
  let ov = (await w.ok(w.O, 'shopAdminOverview')).imported;
  assert.equal(ov.find((x) => x.key === 'pf_' + PID).section, 'jewelry'); assert.equal(ov.find((x) => x.key === 'pf_' + PID2).section, 'drinkware');
  await w.ok(w.O, 'shopAdminToggle', { key: 'pf_' + PID2, enabled: false, section: 'home' }); await syncAll(w);
  ov = (await w.ok(w.O, 'shopAdminOverview')).imported;
  assert.equal(ov.find((x) => x.key === 'pf_' + PID2).section, 'home');
  assert.equal((await w.call(w.O, 'shopAdminToggle', { key: 'pf_' + PID2, enabled: false, section: 'bogus' })).status, 200);
});

test('cart preview: makes a temporary Printify product, keeps its picture for the buyer, deletes the product', async () => {
  const w = world({ cfgOver: {} }); await seed(w);
  const d = (await design(w)).design;
  assert.equal(d.preview, '');
  let r = await w.ok(w.A, 'shopPreview', { familyId: 'fam1', designId: d.id });
  assert.equal(r.status, 'pending');
  const made = w.pcalls.find((c) => c[0] === 'createProduct')[1];
  assert.deepEqual(made.tags, ['fc-preview']); assert.equal(made.variants.length, 1); assert.equal(made.print_areas[0].placeholders[0].position, 'front');
  r = await w.ok(w.A, 'shopPreview', { familyId: 'fam1', designId: d.id });
  assert.equal(r.status, 'ready'); assert.ok(r.fileId);
  assert.ok(w.pcalls.some((c) => c[0] === 'deleteProduct' && c[1] === 'tmp1'), 'temporary product removed');
  const list = await w.ok(w.A, 'shopDesigns', { familyId: 'fam1' });
  assert.equal(list.designs[0].preview, r.fileId);
  assert.equal((await w.call(w.B, 'shopPreview', { familyId: 'fam1', designId: d.id })).status, 404, 'only the owner');
  await w.ok(w.A, 'shopUpdateDesign', { designId: d.id, remove: true });
  assert.equal(w.storage.files.has(r.fileId), false, 'preview picture deleted with the design');
});

test('cart preview: a Printify failure never blocks the cart', async () => {
  const w = world({ noProduct: true }); await seed(w);
  const d = (await design(w)).design;
  const r = await w.ok(w.A, 'shopPreview', { familyId: 'fam1', designId: d.id });
  assert.equal(r.status, 'unavailable');
  assert.equal((await w.ok(w.A, 'shopPreview', { familyId: 'fam1', designId: d.id })).status, 'unavailable');
  assert.equal((await w.ok(w.A, 'shopDesigns', { familyId: 'fam1' })).designs.length, 1);
});

test('words products: typed words instead of a photo; kind is guessed from the name and can be set by the owner', async () => {
  const { guessKind } = await import('../src/sync.js');
  assert.equal(guessKind('Bracelets', 'Personalized Engraved Name Bar Bracelet | Natural Stone Beads'), 'words');
  assert.equal(guessKind('Canvas', 'Customizable Photo Framed Canvas'), 'photo');
  assert.equal(guessKind('Necklace', 'Personalized Photo Oval Necklace, Custom Image Pendant'), 'photo');
  const w = world(); await seed(w);
  const meta = { kind: 'words', ok: true, reason: '', notes: [], section: 'jewelry' };
  await w.db.createRow({ tableId: T.catalog, rowId: 'pf_WORDSBAR1234', data: { title: 'Engraved Name Bar', blurb: '', blueprintId: 7, providerId: 3, position: 'front', enabled: true,
    variants: JSON.stringify({ v: [{ id: 101, label: 'One size', options: {}, priceCents: 2500, width: 1200, height: 1600 }], m: meta }) }, permissions: [] });
  const cat = await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' });
  assert.equal(cat.products.find((p) => p.key === 'pf_WORDSBAR1234').kind, 'words');
  assert.equal(cat.products.find((p) => p.key === 'framed-print').kind, 'photo');
  w.storage.add('wf1', { owner: 'alice', buf: jpeg(1200, 1600) });
  const base = { familyId: 'fam1', productKey: 'pf_WORDSBAR1234', variantId: 101, fileId: 'wf1', quantity: 1 };
  assert.equal((await w.call(w.A, 'shopSaveDesign', { ...base, postId: 'words-only', spec: { text: '   ' } })).status, 400, 'words required');
  assert.equal((await w.call(w.A, 'shopSaveDesign', { ...base, postId: 'post1', spec: {} })).status, 400, 'a photo cannot go on a words product');
  const d = await w.ok(w.A, 'shopSaveDesign', { ...base, postId: 'words-only', spec: { text: 'Layah  &  Mom', font: 'nope', extra: 'x' } });
  assert.deepEqual(d.design.spec, { kind: 'words', text: 'Layah & Mom', font: 'script' });
  w.storage.add('wf2', { owner: 'alice', buf: jpeg(1200, 1600) });
  assert.equal((await w.call(w.A, 'shopSaveDesign', { familyId: 'fam1', postId: 'words-only', productKey: 'framed-print', variantId: 101, fileId: 'wf2', quantity: 1, spec: { text: 'Hi' } })).status, 400, 'words cannot go on a photo product');
  await w.ok(w.O, 'shopAdminToggle', { key: 'pf_WORDSBAR1234', enabled: true, kind: 'photo' });
  assert.equal((await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' })).products.find((p) => p.key === 'pf_WORDSBAR1234').kind, 'photo', 'owner choice wins');
});

/* ---------- Photo Gifts / Family Shop sections ---------- */
test('catalog names two sections; Family Shop is not open and shows no products', async () => {
  const w = world(); await seed(w);
  const c = await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' });
  assert.deepEqual(c.sections.map((s) => [s.id, s.title, s.ready]), [['photo-gifts', 'Photo Gifts', true], ['family-shop', 'Family Shop', false]]);
  assert.ok(c.products.length >= 1 && c.products.every((p) => p.shopSection === 'photo-gifts'));
  assert.equal(JSON.stringify(c).includes('"supplier"'), false, 'supplier ids are never sent to the browser');
});

test('Family Shop cannot be quoted or checked out; no Square link is made', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const b = { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-fshop-001', consentImage: true, consentDelivery: true, section: 'family-shop' };
  assert.equal((await w.call(w.A, 'shopQuote', b)).status, 409);
  const r = await w.call(w.A, 'shopCheckout', b); assert.equal(r.status, 409); assert.equal(r.json.error, 'coming_soon');
  assert.equal(w.sq.created.length, 0);
  const ok = await w.ok(w.A, 'shopCheckout', { ...b, section: 'photo-gifts' }); assert.ok(ok.orderId);
});

test('new order lines are tagged Printify; an old order without the tag is still fulfilled; a line it cannot identify is held, never sent', async () => {
  const w = world(); await seed(w); const d = await design(w);
  const { orderId } = await w.ok(w.A, 'shopCheckout', { familyId: 'fam1', designIds: [d.design.id], address: ADDR, requestId: 'req-tag-0001', consentImage: true, consentDelivery: true });
  assert.equal(JSON.parse(w.db.tab(T.orders).get(orderId).items)[0].supplier, 'printify');
  // an order saved before this feature: no tag on the line
  const old = w.db.tab(T.orders).get(orderId); const lines = JSON.parse(old.items); delete lines[0].supplier; old.items = JSON.stringify(lines);
  await hook(w, 'evt_old1', 'payment.updated', pay(w, orderId));
  assert.equal(w.db.tab(T.orders).get(orderId).fulfillmentStatus, 'created');
  assert.equal(w.pcalls.filter((c) => c[0] === 'create').length, 1);
  // a paid order whose lines say nothing about a supplier: held, and Printify is not called
  const w2 = world(); await seed(w2); const d2 = await design(w2);
  const r2 = await w2.ok(w2.A, 'shopCheckout', { familyId: 'fam1', designIds: [d2.design.id], address: ADDR, requestId: 'req-tag-0002', consentImage: true, consentDelivery: true });
  const row = w2.db.tab(T.orders).get(r2.orderId); row.items = JSON.stringify([{ title: 'Mystery', quantity: 1 }]);
  await hook(w2, 'evt_unk1', 'payment.updated', pay(w2, r2.orderId));
  assert.equal(w2.db.tab(T.orders).get(r2.orderId).fulfillmentStatus, 'needs_review');
  assert.equal(w2.pcalls.filter((c) => c[0] === 'create').length, 0, 'nothing reached Printify');
});

test('a product tagged for another supplier never appears in Photo Gifts and cannot be put in its cart', async () => {
  const w = world(); await seed(w);
  const row = w.db.tab(T.catalog).get('framed-print'); const j = JSON.parse(row.variants);
  row.variants = JSON.stringify({ v: Array.isArray(j) ? j : j.v, m: { ...(j.m || {}), supplier: 'cj' } });
  const c = await w.ok(w.A, 'shopCatalog', { familyId: 'fam1' });
  assert.equal(c.products.length, 0);
  w.storage.add('fx', { owner: 'alice', buf: jpeg(1200, 1600) });
  const r = await w.call(w.A, 'shopSaveDesign', { familyId: 'fam1', postId: 'post1', productKey: 'framed-print', variantId: 101, fileId: 'fx', quantity: 1, spec: { zoom: 1 } });
  assert.notEqual(r.status, 200);
});

test('kind guess: the product title decides first, so a generic "photo" blank name cannot turn an engraved name product into a photo product', async () => {
  const { guessKind } = await import('../src/sync.js');
  assert.equal(guessKind('Photo Bracelet', 'Personalized Engraved Name Bar Bracelet | Natural Stone Beads'), 'words');
  assert.equal(guessKind('Mug', 'Custom Photo Mug'), 'photo');
  assert.equal(guessKind('Engraved Bar Bracelet', 'Family Bracelet'), 'words');
  assert.equal(guessKind('Mug', 'Coffee Mug'), 'photo');
  assert.equal(guessKind('Name Necklace', 'Necklace with your photo'), 'photo');
});

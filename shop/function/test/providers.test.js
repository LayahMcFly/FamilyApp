import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyStripeSignature, formEncode } from '../src/stripe.js';
import { verifyPrintifySignature, createPrintify, PrintifyError } from '../src/printify.js';
import { imageSize } from '../src/images.js';

test('stripe signature: valid, tampered, old, missing', () => {
  const secret = 'whsec_test123', body = '{"id":"evt_1","type":"x"}', t = 1700000000;
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const h = `t=${t},v1=${v1}`;
  assert.equal(verifyStripeSignature(body, h, secret, { nowSec: t + 10 }), true);
  assert.equal(verifyStripeSignature(body + ' ', h, secret, { nowSec: t + 10 }), false);
  assert.equal(verifyStripeSignature(body, h, 'whsec_other', { nowSec: t + 10 }), false);
  assert.equal(verifyStripeSignature(body, h, secret, { nowSec: t + 301 }), false);       // outside the 5 minute window
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${v1.slice(0, 10)}`, secret, { nowSec: t }), false);
  assert.equal(verifyStripeSignature(body, '', secret, { nowSec: t }), false);
  assert.equal(verifyStripeSignature(body, `t=${t},v0=abc,v1=${'0'.repeat(64)},v1=${v1}`, secret, { nowSec: t }), true);   // several v1 values: any may match
});

test('stripe signature agrees with the official Stripe library', async () => {
  let Stripe; try { Stripe = (await import('/tmp/stripe-x/node_modules/stripe/esm/stripe.esm.node.js')).default; } catch { return; }   // only when the library is installed
  const secret = 'whsec_abc', body = JSON.stringify({ id: 'evt_2', object: 'event', type: 'checkout.session.completed' });
  const header = new Stripe('sk_test_x').webhooks.generateTestHeaderString({ payload: body, secret });
  assert.equal(verifyStripeSignature(body, header, secret), true);
  new Stripe('sk_test_x').webhooks.constructEvent(body, header, secret);                  // the library accepts the same header
  assert.equal(verifyStripeSignature(body, header, 'whsec_nope'), false);
});

test('form encoding matches what Stripe expects', () => {
  const s = formEncode({ mode: 'payment', line_items: [{ quantity: 2, price_data: { currency: 'usd', unit_amount: 1999, product_data: { name: 'A & B' } } }], metadata: { orderId: 'o1' }, skip: undefined });
  assert.deepEqual(s, ['mode=payment', 'line_items%5B0%5D%5Bquantity%5D=2', 'line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd', 'line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1999', 'line_items%5B0%5D%5Bprice_data%5D%5Bproduct_data%5D%5Bname%5D=A%20%26%20B', 'metadata%5BorderId%5D=o1']);
});

test('printify signature: sha256= prefix, body only, constant-time compare', () => {
  const secret = 'abc123', body = '{"id":"w1","type":"order:updated"}';
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyPrintifySignature(body, sig, secret), true);
  assert.equal(verifyPrintifySignature(body, sig.replace('sha256=', ''), secret), false);
  assert.equal(verifyPrintifySignature(body + 'x', sig, secret), false);
  assert.equal(verifyPrintifySignature(body, sig, ''), false);
  assert.equal(verifyPrintifySignature(body, 'sha256=zz', secret), false);
});

test('printify client: headers, retry on 429, error carries status only, catalog cached', async () => {
  const calls = [];
  const replies = [{ status: 429, body: {} }, { status: 200, body: [{ id: 1, title: 'Mug' }] }];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); const r = replies.shift() || { status: 200, body: [] }; return { ok: r.status < 300, status: r.status, text: async () => JSON.stringify(r.body) }; };
  const p = createPrintify({ token: 'SECRET', shopId: '99', fetchImpl, sleep: async () => {} });
  const list = await p.listBlueprints();
  assert.equal(list.length, 1); assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer SECRET'); assert.ok(calls[0].opts.headers['User-Agent']);
  await p.listBlueprints(); assert.equal(calls.length, 2, 'second read comes from the cache');
  const bad = createPrintify({ token: 'SECRET', shopId: '99', fetchImpl: async () => ({ ok: false, status: 422, text: async () => '{"errors":{"reason":"x SECRET"}}' }), sleep: async () => {} });
  await assert.rejects(() => bad.createOrder({}), (e) => e instanceof PrintifyError && e.status === 422 && !String(e.message).includes('SECRET'));
});

test('image size from JPEG and PNG headers', () => {
  const png = Buffer.alloc(32); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png), { type: 'png', width: 640, height: 480 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  assert.deepEqual(imageSize(jpg), { type: 'jpeg', width: 640, height: 480 });
  assert.equal(imageSize(Buffer.from('hello world not an image at all......')), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifySquareSignature, createSquare, SquareError, SQUARE_VERSION } from '../src/square.js';
import { verifyPrintifySignature, createPrintify, PrintifyError } from '../src/printify.js';
import { imageSize } from '../src/images.js';

const URL_ = 'https://fn.example/webhooks/square';
test('square signature: base64 HMAC-SHA256 of notification URL + raw body', () => {
  const key = 'sigkey123', body = '{"event_id":"e1","type":"payment.updated"}';
  const sig = createHmac('sha256', key).update(URL_ + body).digest('base64');
  assert.equal(verifySquareSignature(body, sig, key, URL_), true);
  assert.equal(verifySquareSignature(body + ' ', sig, key, URL_), false, 'one extra byte in the body');
  assert.equal(verifySquareSignature(body, sig, key, URL_ + '/'), false, 'URL must match exactly');
  assert.equal(verifySquareSignature(body, sig, 'other', URL_), false);
  assert.equal(verifySquareSignature(body, '', key, URL_), false);
  assert.equal(verifySquareSignature(body, sig, '', URL_), false);
  assert.equal(verifySquareSignature(body, sig, key, ''), false);
  assert.equal(verifySquareSignature(body, sig.slice(0, 10), key, URL_), false);
});

test('square signature agrees with the official Square library', async () => {
  let W; try { W = (await import('/tmp/sq/node_modules/square/wrapper/WebhooksHelper.js')).WebhooksHelper; } catch { return; }   // only when the library is installed
  const key = 'abc', body = JSON.stringify({ event_id: 'e', type: 'payment.updated', data: { object: { payment: { id: 'p' } } } });
  const sig = createHmac('sha256', key).update(URL_ + body).digest('base64');
  assert.equal(await W.verifySignature({ requestBody: body, signatureHeader: sig, signatureKey: key, notificationUrl: URL_ }), true);
  assert.equal(verifySquareSignature(body, sig, key, URL_), true);
});

test('square client: version header, bearer token, base URL per environment, safe errors, retries only for reads', async () => {
  const calls = []; const replies = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); const r = replies.shift() || { status: 200, body: {} }; return { ok: r.status < 300, status: r.status, json: async () => r.body }; };
  const sq = createSquare({ accessToken: 'TOKEN', environment: 'sandbox', fetchImpl, sleep: async () => {} });
  replies.push({ status: 200, body: { payment_link: { id: 'pl' } } });
  await sq.createPaymentLink({ idempotency_key: 'k' });
  assert.equal(calls[0].url, 'https://connect.squareupsandbox.com/v2/online-checkout/payment-links'); assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer TOKEN'); assert.equal(calls[0].opts.headers['Square-Version'], SQUARE_VERSION);
  const live = createSquare({ accessToken: 'T', environment: 'production', fetchImpl, sleep: async () => {} });
  await live.retrievePayment('p/1'); assert.equal(calls[1].url, 'https://connect.squareup.com/v2/payments/p%2F1');
  assert.equal(createSquare({ accessToken: 'T', environment: 'anything', fetchImpl }).environment, 'sandbox', 'unknown values fall back to sandbox');
  replies.push({ status: 429, body: {} }, { status: 200, body: { order: { id: 'o' } } });
  assert.equal((await sq.retrieveOrder('o')).order.id, 'o'); assert.equal(calls.length, 4, 'a read is retried once');
  const n = calls.length; replies.push({ status: 500, body: {} }, { status: 200, body: {} });
  await assert.rejects(() => sq.createPaymentLink({}), (e) => e instanceof SquareError && e.status === 500); assert.equal(calls.length, n + 1, 'a create is never retried blindly');
  replies.length = 0; replies.push({ status: 400, body: { errors: [{ category: 'INVALID_REQUEST_ERROR', code: 'BAD_REQUEST', field: 'order', detail: 'echo TOKEN secret' }] } });
  await assert.rejects(() => sq.retrieveLocation('L'), (e) => e instanceof SquareError && e.status === 400 && e.codes[0] === 'BAD_REQUEST' && !JSON.stringify(e).includes('TOKEN') && !String(e.message).includes('TOKEN'));
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

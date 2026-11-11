import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isBlockedIp, checkUrl, safeLookup, parseMeta, guardedGet, fetchPreview, clearPreviewCache } from '../src/preview.js';

test('addresses that must never be contacted are refused, public ones are allowed', () => {
  for (const ip of ['127.0.0.1', '127.8.8.8', '10.1.2.3', '192.168.1.1', '172.16.0.5', '172.31.255.255', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', 'abc', '', '999.1.1.1'])
    assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.255.255', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e'])
    assert.equal(isBlockedIp(ip), false, ip);
});

test('only plain public web addresses can be previewed', () => {
  for (const u of ['ftp://example.com/a', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://user:pw@example.com/', 'https://example.com:8080/', 'http://127.0.0.1/', 'http://[::1]/',
    'http://2130706433/', 'http://localhost/', 'http://printer.local/', 'http://intranet/', 'http://metadata.internal/', 'not a url', '', 'http://a.b.lan/'])
    assert.equal(checkUrl(u), null, u);
  assert.equal(checkUrl('https://Example.com/a?b=1#frag').toString(), 'https://example.com/a?b=1');
  assert.ok(checkUrl('http://example.com:80/x'));
  assert.ok(checkUrl('https://example.com:443/x'));
});

test('a name that resolves to a private address is refused at connection time', async () => {
  await assert.rejects(new Promise((res, rej) => safeLookup('localhost', {}, (e, a) => (e ? rej(e) : res(a)))), /blocked/);
  await assert.rejects(guardedGet('http://127.0.0.1:9/', { accept: 'text/html', maxBytes: 100 }), /blocked/);
});

test('page details are read from the head as plain text', () => {
  const html = `<html><head><title> Fallback &amp; title </title>
    <meta content='Cats &amp; dogs: the &#39;best&#39; day' property='og:title'>
    <meta property="og:description" content="Line one
      line two &#x1F600;">
    <meta property=og:site_name content=Example>
    <meta name="twitter:image" content="/img/cat.png">
    <meta property="og:title" content="second one is ignored">
    <meta property="og:image" content="//evil.test/x.png"></head><body><meta property="og:title" content="body"></body></html>`;
  const m = parseMeta(html, 'https://news.example.com/story/1');
  assert.equal(m.title, "Cats & dogs: the 'best' day");
  assert.equal(m.description, 'Line one line two 😀');
  assert.equal(m.siteName, 'Example');
  assert.equal(m.image, 'https://evil.test/x.png');           // og:image wins over twitter:image; protocol-relative resolves against the page
  const t = parseMeta('<title>Only a title</title>', 'https://www.site.org/p');
  assert.deepEqual(t, { title: 'Only a title', description: '', siteName: 'site.org', image: '' });
  const long = parseMeta(`<meta property="og:title" content="${'x'.repeat(500)}"><meta property="og:description" content="${'y\u0007'.repeat(500)}">`, 'https://a.io/');
  assert.ok(long.title.length <= 120 && long.description.length <= 240 && !/[\u0007]/.test(long.description));
  assert.equal(parseMeta('<meta property="og:image" content="javascript:alert(1)">', 'https://a.io/').image.startsWith('javascript'), true, 'parseMeta only extracts; fetching refuses it');
});

function serve(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ s, base: `http://127.0.0.1:${s.address().port}` })); });
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const T = { allowPrivate: true, noCache: true, timeoutMs: 600 };   // tests talk to a local server, so the private-address guard is switched off here only

test('a good page gives title, description, site name and an embedded image', async () => {
  clearPreviewCache();
  const { s, base } = await serve((req, res) => {
    if (req.url === '/p') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<head><title>Hi</title><meta property="og:description" content="Desc"><meta property="og:image" content="/i.png"></head><body>x</body>`); }
    else if (req.url === '/i.png') { res.setHeader('content-type', 'image/png'); res.end(PNG); }
    else { res.statusCode = 404; res.end(); }
  });
  const v = await fetchPreview(base + '/p', T);
  s.close();
  assert.equal(v.title, 'Hi'); assert.equal(v.description, 'Desc');
  assert.ok(v.image.startsWith('data:image/png;base64,'));
  assert.equal(Buffer.from(v.image.split(',')[1], 'base64').equals(PNG), true);
});

test('bad answers give no preview: not html, error status, svg or oversized pictures, redirect loops, slow servers', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(300 * 1024, 2)]);
  const { s, base } = await serve((req, res) => {
    const u = req.url;
    if (u === '/json') { res.setHeader('content-type', 'application/json'); res.end('{"title":"x"}'); }
    else if (u === '/500') { res.statusCode = 500; res.setHeader('content-type', 'text/html'); res.end('<title>Oops</title>'); }
    else if (u === '/svg') { res.setHeader('content-type', 'text/html'); res.end('<title>T</title><meta property="og:image" content="/a.svg">'); }
    else if (u === '/a.svg') { res.setHeader('content-type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'); }
    else if (u === '/fake') { res.setHeader('content-type', 'text/html'); res.end('<title>T</title><meta property="og:image" content="/fake.png">'); }
    else if (u === '/fake.png') { res.setHeader('content-type', 'image/png'); res.end('<html>not an image</html>'); }
    else if (u === '/bigimg') { res.setHeader('content-type', 'text/html'); res.end('<title>T</title><meta property="og:image" content="/big.png">'); }
    else if (u === '/big.png') { res.setHeader('content-type', 'image/png'); res.end(big); }
    else if (u.startsWith('/loop')) { res.statusCode = 302; res.setHeader('location', '/loop' + Math.random()); res.end(); }
    else if (u === '/slow') { setTimeout(() => { res.setHeader('content-type', 'text/html'); res.end('<title>late</title>'); }, 2000); }
    else if (u === '/hop1') { res.statusCode = 301; res.setHeader('location', '/hop2'); res.end(); }
    else if (u === '/hop2') { res.setHeader('content-type', 'text/html'); res.end('<title>After redirect</title>'); }
    else { res.statusCode = 404; res.end(); }
  });
  assert.equal(await fetchPreview(base + '/json', T), null);
  assert.equal(await fetchPreview(base + '/500', T), null);
  assert.equal(await fetchPreview(base + '/nothing', T), null);
  assert.equal((await fetchPreview(base + '/svg', T)).image, '', 'svg is never embedded');
  assert.equal((await fetchPreview(base + '/fake', T)).image, '', 'the bytes must really be a picture');
  const bi = await fetchPreview(base + '/bigimg', T); assert.equal(bi.title, 'T'); assert.equal(bi.image, '', 'pictures over 200 KB are dropped, the text stays');
  assert.equal(await fetchPreview(base + '/loop', T), null, 'more than 3 redirects');
  assert.equal(await fetchPreview(base + '/slow', T), null, 'timeout');
  assert.equal((await fetchPreview(base + '/hop1', T)).title, 'After redirect', 'a normal redirect works');
  s.close();
});

test('results are cached for a while and a huge page is read only up to its head', async () => {
  clearPreviewCache(); let hits = 0;
  const { s, base } = await serve((req, res) => { hits++; res.setHeader('content-type', 'text/html'); res.write('<head><title>Big</title></head>'); res.end('z'.repeat(3 * 1024 * 1024)); });
  const a = await fetchPreview(base + '/', { allowPrivate: true, timeoutMs: 800 });
  const b = await fetchPreview(base + '/', { allowPrivate: true, timeoutMs: 800 });
  s.close();
  assert.equal(a.title, 'Big'); assert.equal(b, a); assert.equal(hits, 1);
});

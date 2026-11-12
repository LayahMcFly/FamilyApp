/*
 * Link previews for chat. The SERVER fetches the page, so the website sees our server and never the family's phones.
 *
 * Because the server fetches whatever address a family member types, this file is written to be hard to abuse (SSRF):
 *  - only http(s) on the default ports, a real domain name (no IP addresses, no "localhost", no ".local");
 *  - every address the name resolves to is checked, and the connection is made to that checked address (no DNS tricks);
 *  - private, loopback, link-local, carrier-grade NAT, documentation, multicast and mapped IPv6 ranges are refused;
 *  - redirects are followed at most 3 times and every hop is checked again;
 *  - 4 second timeout, 512 KB of HTML at most, only text/html is read;
 *  - the preview image is fetched the same way, at most 200 KB, only JPEG / PNG / WebP / GIF (never SVG), and sent back
 *    as a data: image so viewers' devices never contact the other website;
 *  - the answer contains plain text and that image only. Nothing from the page is ever run or kept as HTML.
 * Nothing here logs a URL or page text.
 */
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

export const PREVIEW_LIMITS = { htmlBytes: 512 * 1024, imageBytes: 200 * 1024, timeoutMs: 4000, redirects: 3, titleMax: 120, descMax: 240, siteMax: 60 };

const BLOCK4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]];
const v4int = (a) => a.split('.').reduce((n, x) => n * 256 + Number(x), 0);
const BLOCK4_RANGES = BLOCK4.map(([a, bits]) => { const start = v4int(a), size = 2 ** (32 - bits); return [start, start + size - 1]; });
// IPv6 ranges that are not "mapped IPv4" (those are handled by hand below, because Node's BlockList mixes the two families up).
const BLOCK6 = [['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]];
const blocked6 = new net.BlockList();
for (const [a, n] of BLOCK6) blocked6.addSubnet(a, n, 'ipv6');

/** Eight 16-bit groups of an IPv6 address, or null. */
function groups6(ip) {
  let s = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) { const n = v4int(dotted[1]); s = s.slice(0, dotted.index) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16); }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const a = halves[0] ? halves[0].split(':') : [], b = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - a.length - b.length : 0;
  if (fill < 0 || (halves.length === 1 && a.length !== 8)) return null;
  const all = [...a, ...Array(fill).fill('0'), ...b].map((x) => parseInt(x, 16));
  return all.length === 8 && all.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? all : null;
}

/** True when the address must never be contacted. Anything that is not a valid address counts as blocked. */
export function isBlockedIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) { const n = v4int(ip); return BLOCK4_RANGES.some(([lo, hi]) => n >= lo && n <= hi); }
  if (v !== 6) return true;
  const g = groups6(ip);
  if (!g) return true;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return true;   // ::, ::1, ::a.b.c.d and ::ffff:a.b.c.d (IPv4-mapped)
  return blocked6.check(ip, 'ipv6');
}

/** Returns a clean URL object, or null if this address is not allowed to be previewed. */
export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (!host || host.length > 253 || net.isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.')) return null;
  if (/\.(local|localhost|internal|lan|home|corp|intranet)$/.test(host)) return null;
  u.hash = '';
  return u;
}

/** dns.lookup that refuses to hand back any private address, so the socket can only connect to a public one. */
export function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) return cb(new Error('blocked'));
    if (options && options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

/** One guarded GET. Follows redirects itself so each hop is checked. Resolves {status, type, body, url} or throws. */
export async function guardedGet(rawUrl, { accept, maxBytes, stopAt, lookup = safeLookup, allowPrivate = false, timeoutMs = PREVIEW_LIMITS.timeoutMs, redirects = PREVIEW_LIMITS.redirects } = {}) {
  let url = allowPrivate ? new URL(rawUrl) : checkUrl(rawUrl);
  for (let hop = 0; hop <= redirects; hop++) {
    if (!url) throw new Error('blocked');
    const res = await new Promise((resolve, reject) => {
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request(url, { method: 'GET', lookup: allowPrivate ? undefined : lookup, timeout: timeoutMs, headers: { 'User-Agent': 'FamilyCirclePreview/1.0 (private family site)', Accept: accept, 'Accept-Language': 'en' } }, (r) => {
        const status = r.statusCode || 0, type = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (status >= 300 && status < 400 && r.headers.location) { r.resume(); return resolve({ redirect: new URL(r.headers.location, url).toString() }); }
        const len = Number(r.headers['content-length'] || 0);
        if (len && len > maxBytes && !stopAt) { r.destroy(); return reject(new Error('too big')); }
        const chunks = []; let total = 0, cut = false, tail = '';
        const done = () => resolve({ status, type, body: Buffer.concat(chunks), cut, url: url.toString() });
        r.on('data', (d) => {
          total += d.length; chunks.push(d);
          let found = false;
          if (stopAt) { const txt = tail + d.toString('latin1').toLowerCase(); found = txt.includes(stopAt); tail = txt.slice(-stopAt.length); }
          if (total > maxBytes || found) { cut = total > maxBytes; r.destroy(); done(); }
        });
        r.on('end', done); r.on('error', () => done()); r.on('close', done);
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      req.end();
    });
    if (res.redirect) { url = allowPrivate ? new URL(res.redirect) : checkUrl(res.redirect); continue; }
    return res;
  }
  throw new Error('too many redirects');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 8 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function clean(s, max) {
  const t = decode(s || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

/** Reads the title, description, site name and image address out of a page's <head>. Pure text work, nothing is run. */
export function parseMeta(html, baseUrl) {
  const head = String(html).slice(0, PREVIEW_LIMITS.htmlBytes);
  const meta = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    const key = String(attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content !== undefined && meta[key] === undefined) meta[key] = attrs.content;
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  const title = clean(meta['og:title'] || meta['twitter:title'] || (t ? t[1] : ''), PREVIEW_LIMITS.titleMax);
  const description = clean(meta['og:description'] || meta['twitter:description'] || meta.description || '', PREVIEW_LIMITS.descMax);
  let siteName = clean(meta['og:site_name'] || '', PREVIEW_LIMITS.siteMax);
  let host = ''; try { host = new URL(baseUrl).hostname.replace(/^www\./, ''); } catch (e) { /* ok */ }
  if (!siteName) siteName = host;
  let image = '';
  const rawImg = decode(meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || '').trim();
  if (rawImg) { try { image = new URL(rawImg, baseUrl).toString(); } catch (e) { image = ''; } }
  return { title, description, siteName, image };
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
function sniff(buf) {   // trust the bytes, not the header
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'image/gif';
  return '';
}

const cache = new Map();   // url -> { at, value }   (kept in memory only, for 30 minutes)
const CACHE_MS = 30 * 60 * 1000, CACHE_MAX = 200;

/** The whole preview: { url, title, description, siteName, image } or null when there is nothing to show. */
export async function fetchPreview(rawUrl, opts = {}) {
  const key = String(rawUrl);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS && !opts.noCache) return hit.value;
  let value = null;
  try {
    const page = await guardedGet(rawUrl, { ...opts, accept: 'text/html,application/xhtml+xml', maxBytes: PREVIEW_LIMITS.htmlBytes, stopAt: '</head>' });
    if (page.status >= 200 && page.status < 300 && (page.type === 'text/html' || page.type === 'application/xhtml+xml')) {
      const meta = parseMeta(page.body.toString('utf8'), page.url);
      let image = '';
      if (meta.image) {
        try {
          const img = await guardedGet(meta.image, { ...opts, accept: 'image/jpeg,image/png,image/webp,image/gif', maxBytes: PREVIEW_LIMITS.imageBytes });
          const type = sniff(img.body);
          if (img.status === 200 && !img.cut && IMAGE_TYPES.includes(type) && img.body.length <= PREVIEW_LIMITS.imageBytes) image = `data:${type};base64,${img.body.toString('base64')}`;
        } catch (e) { /* no picture; the text still shows */ }
      }
      if (meta.title || meta.description || image) value = { url: page.url, title: meta.title, description: meta.description, siteName: meta.siteName, image };
    }
  } catch (e) { value = null; }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
  return value;
}
export function clearPreviewCache() { cache.clear(); }

/** A picture from a web address (for a profile picture). Same guards as the link preview; the bytes are checked, not the header. */
export const PICTURE_MAX = 3 * 1024 * 1024;
export async function fetchPictureUrl(rawUrl, opts = {}) {
  try {
    const img = await guardedGet(rawUrl, { ...opts, accept: 'image/jpeg,image/png,image/webp,image/gif', maxBytes: PICTURE_MAX, timeoutMs: 6000 });
    const type = sniff(img.body);
    if (img.status !== 200 || img.cut || !IMAGE_TYPES.includes(type) || img.body.length > PICTURE_MAX) return null;
    return { type, data: img.body.toString('base64') };
  } catch (e) { return null; }
}


/* ---------- site info for saved links: the page title and a small icon (png, ico, gif, jpeg or webp; never SVG) ---------- */
function sniffIcon(buf) {
  const t = sniff(buf); if (t) return t;
  if (buf.length > 6 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  return '';
}
const ICON_MAX = 100 * 1024;
export async function fetchSiteInfo(rawUrl, opts = {}) {
  let title = '', icon = '', pageUrl = rawUrl, candidates = [];
  try {
    const page = await guardedGet(rawUrl, { ...opts, accept: 'text/html,application/xhtml+xml', maxBytes: PREVIEW_LIMITS.htmlBytes, stopAt: '</head>' });
    pageUrl = page.url || rawUrl;
    if (page.status >= 200 && page.status < 300 && (page.type === 'text/html' || page.type === 'application/xhtml+xml')) {
      const html = page.body.toString('utf8');
      const meta = parseMeta(html, pageUrl);
      title = meta.title || meta.siteName || '';
      for (const tag of html.slice(0, PREVIEW_LIMITS.htmlBytes).match(/<link\b[^>]*>/gi) || []) {
        const a = {};
        for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
        if (/\bicon\b/i.test(a.rel || '') && a.href && !/\.svg(\?|$)/i.test(a.href)) { try { candidates.push(new URL(decode(a.href), pageUrl).toString()); } catch (e) { /* skip */ } }
      }
    }
  } catch (e) { /* no title; the address still works */ }
  try { candidates.push(new URL('/favicon.ico', pageUrl).toString()); } catch (e) { /* skip */ }
  for (const u of [...new Set(candidates)].slice(0, 3)) {
    try {
      const img = await guardedGet(u, { ...opts, accept: 'image/png,image/x-icon,image/vnd.microsoft.icon,image/gif,image/jpeg,image/webp', maxBytes: ICON_MAX });
      const type = sniffIcon(img.body);
      if (img.status === 200 && !img.cut && type && img.body.length <= ICON_MAX) { icon = `data:${type};base64,${img.body.toString('base64')}`; break; }
    } catch (e) { /* try the next one */ }
  }
  return { title, icon };
}

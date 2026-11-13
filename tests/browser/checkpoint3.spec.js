/* Checkpoint 3 (family context and access) browser tests (class B: real Chrome, real app code, FAKE Appwrite).
 * Covers: stale tree/member names after a family switch, late activity and feed answers, immediate access check after a 'not a member' answer.
 * Run: node checkpoint3.spec.js
 * They prove what the BROWSER CODE does when the (fake) server says something. They do NOT prove Appwrite permissions. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]); if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const PNG = fs.readFileSync(path.join(__dirname, 'sample-photo.png'));
const user = { $id: 'u1', name: 'Test Owner', email: 't@example.com', emailVerification: true, prefs: {} };
const TWO = [{ id: 'famA', name: 'Alpha Family', role: 'owner' }, { id: 'famB', name: 'Beta Family', role: 'member' }];
const prof = (uid, name, fid) => ({ $id: 'p' + uid + fid, userId: uid, familyId: fid, displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' });
const mem = (uid, fid, roles) => ({ $id: 'm' + uid + fid, userId: uid, userName: '', teamId: fid, roles: roles || ['member'], confirm: true, joined: '2026-01-01T00:00:00Z' });
let pass = 0, fail = 0, PORT; const results = [];
function check(n, ok, d) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + d)); }
async function open(browser, mock, hash, init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  if (init) await page.addInitScript(init);
  await page.goto('http://127.0.0.1:' + PORT + SUB + (hash || '')); return { ctx, page, errors };
}
const settle = p => p.waitForSelector('main[data-view]', { timeout: 8000 });
const text = p => p.locator('body').innerText();
async function switchTo(page, id, name) {
  await page.evaluate(() => { location.hash = '#/hub'; });
  await page.waitForSelector('.fam-select', { timeout: 8000 });
  await page.selectOption('.fam-select', id);
  await page.waitForFunction(n => document.querySelector('.hub-family') && document.querySelector('.hub-family').innerText === n, name, { timeout: 8000 });
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const base = (x) => Object.assign({ signedIn: true, user: { $id: 'u1', name: 'Test Owner', email: 't@example.com', emailVerification: true, prefs: {} }, families: TWO, canCreateFamily: false, api: {} }, x);

  // G1. The previous family's tree must not be used to name people in the next family
  { const mock = base({ members: null, membersBy: { famA: [mem('u1', 'famA', ['owner']), mem('u2', 'famA')], famB: [mem('u1', 'famB'), mem('u2', 'famB')] }, failRows: { 'people:famB': true },
      tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB')], posts: [], people: [{ $id: 'pa2', familyId: 'famA', name: 'Alpha Secret Name', userId: 'u2', parentIds: [], $createdAt: '2026-01-01' }] } });
    const { ctx, page, errors } = await open(browser, mock, '#/family'); await settle(page); await page.waitForSelector('text=Alpha Secret Name', { timeout: 8000 });
    check('G1 control: family A members list shows the name from A\'s tree', true, '');
    await switchTo(page, 'famB', 'Beta Family');
    await page.evaluate(() => { location.hash = '#/family'; }); await page.waitForSelector('text=Family member', { timeout: 8000 }).catch(() => {});
    const t = await text(page);
    check('G1 after switching to B (B\'s tree cannot load), B\'s members are not given A\'s tree names', !/Alpha Secret Name/.test(t), t.slice(0, 300));
    check('G1 no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // G2. A late activity answer from the old family must not set the new family's notification badge
  { const now = new Date().toISOString();
    const mock = base({ tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB'), prof('u9', 'Other Person', 'famA')], people: [], posts: [{ $id: 'mine', familyId: 'famA', authorId: 'u1', kind: 'text', body: 'my post', $createdAt: now }], reactions: [{ $id: 'r1', postId: 'mine', userId: 'u9', familyId: 'famA', $createdAt: now }] } });
    const init = () => { window.__held = []; window.__hold = true; window.__MOCK.gate = function (t, f, q) { if (window.__hold && t === 'posts' && f === 'famA' && q.some(function (x) { return x.m === 'equal' && x.a[0] === 'authorId'; })) return new Promise(function (r) { window.__held.push(r); }); }; };
    const { ctx, page, errors } = await open(browser, mock, '#/hub', init); await settle(page);
    await page.waitForFunction(() => window.__held.length >= 1, null, { timeout: 8000 });
    await switchTo(page, 'famB', 'Beta Family'); await page.waitForTimeout(300);
    await page.evaluate(() => { window.__hold = false; window.__held.forEach(function (r) { r(); }); }); await page.waitForTimeout(800);
    const badge = await page.evaluate(() => { const b = document.getElementById('bell-badge'); return b ? { hidden: b.hidden, text: b.textContent } : null; });
    check('G2 family A\'s late activity answer does not show a count while family B is open', !badge || badge.hidden, JSON.stringify(badge));
    check('G2 no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // G3. A late feed answer from the old family cannot repopulate the screen of the new family
  { const mock = base({ tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB')], people: [], posts: [{ $id: 'pa', familyId: 'famA', authorId: 'u1', kind: 'text', body: 'ALPHA-ONLY-POST', $createdAt: '2026-01-01T00:00:00Z' }, { $id: 'pb', familyId: 'famB', authorId: 'u1', kind: 'text', body: 'BETA-POST', $createdAt: '2026-01-02T00:00:00Z' }] } });
    const init = () => { window.__held = []; window.__hold = true; window.__MOCK.gate = function (t, f) { if (window.__hold && t === 'posts' && f === 'famA') return new Promise(function (r) { window.__held.push(r); }); }; };
    const { ctx, page, errors } = await open(browser, mock, '#/home', init); await settle(page);
    await page.waitForFunction(() => window.__held.length >= 1, null, { timeout: 8000 });
    await switchTo(page, 'famB', 'Beta Family');
    await page.evaluate(() => { window.__hold = false; window.__held.forEach(function (r) { r(); }); }); await page.waitForTimeout(800);
    check('G3 old family\'s late feed does not appear on the new family\'s Hub', !/ALPHA-ONLY-POST/.test(await text(page)), '');
    await page.evaluate(() => { location.hash = '#/home'; }); await page.waitForSelector('text=BETA-POST', { timeout: 8000 });
    check('G3 new family\'s own feed shows only its posts', !/ALPHA-ONLY-POST/.test(await text(page)), '');
    check('G3 no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // G4. When the server says "you are not a member", the app checks access straight away (no wait for the 5-minute check)
  { const mock = base({ tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB')], people: [], posts: [] } });
    const { ctx, page, errors } = await open(browser, mock, '#/hub'); await settle(page);
    await page.evaluate(() => { window.__MOCK.revoked = ['famA']; window.__MOCK.api.chatOpen = function () { return { __deny: 'You are not a member of this family.' }; }; });
    await page.evaluate(() => { location.hash = '#/chat'; });
    await page.waitForFunction(() => document.querySelector('.hub-family') && document.querySelector('.hub-family').innerText === 'Beta Family', null, { timeout: 8000 }).catch(() => {});
    const t = await text(page);
    check('G4 a "not a member" answer moves the app to the remaining family\'s Hub at once', /Beta Family/.test(t) && page.url().endsWith('#/hub'), page.url() + ' ' + t.slice(0, 200));
    check('G4 the person is told why', /no longer a member/i.test(t), t.slice(0, 300));
    check('G4 no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

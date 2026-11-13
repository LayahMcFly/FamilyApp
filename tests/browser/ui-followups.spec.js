/* Browser tests for UI follow-ups (Back to Hub arrow, Switch family layout, automatic-update report) (class B evidence: real Chrome, real app code, FAKE backend).
 * Run: cd tests/browser && node ui-followups.spec.js . Proves what the screen shows for given sync responses. It does NOT prove anything about live Printify or Appwrite data. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const user = { $id: 'u1', name: 'Test Owner', email: 't@example.com', emailVerification: true, prefs: {} };
const prof = (uid, name, fid) => ({ $id: 'p' + uid + fid, userId: uid, familyId: fid, displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' });
function world(extra) {
  const fams = [{ id: 'famA', name: 'Alpha Family', role: 'owner' }];
  return Object.assign({ signedIn: true, user, families: fams, canCreateFamily: false,
    tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB')], people: [], posts: [] } }, extra || {});
}
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
async function open(browser, mock, hash, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 800 } }, opts || {}));
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());   // nothing leaves the machine
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  await page.goto('http://127.0.0.1:' + PORT + SUB + (hash || ''));
  return { ctx, page, errors };
}
let PORT;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
  const settle = p => p.waitForSelector('main[data-view]', { timeout: 8000 });
  const two = [{ id: 'famA', name: 'Happy Family', role: 'owner' }, { id: 'famB', name: 'Beta Family', role: 'member' }];

  // 1. Back to Hub shows exactly one arrow (the CSS chevron), not an icon plus the chevron
  { const { ctx, page } = await open(browser, world({ families: two }), '#/home'); await settle(page);
    const a = page.locator('.hub-back a');
    check('1 Back to Hub link exists', (await a.count()) === 1, '');
    check('1 no extra icon inside the link', (await a.locator('svg').count()) === 0, '');
    check('1 the chevron is drawn once by the link style', await a.evaluate(el => getComputedStyle(el, '::before').content !== 'none' && getComputedStyle(el, '::before').content !== 'normal'), '');
    check('1 link text is exactly Back to Hub', (await a.innerText()).trim() === 'Back to Hub', await a.innerText());
    await page.screenshot({ path: path.join(shots, 'back-to-hub-fixed.png'), clip: { x: 0, y: 40, width: 390, height: 140 } });
    await ctx.close(); }

  // 2. Switch family: the drop-down sits under its label, on the left, not pushed right
  { const { ctx, page } = await open(browser, world({ families: two }), '#/hub'); await settle(page);
    const lab = await page.locator('.hub-switch label').boundingBox(), sel = await page.locator('#hub-fam').boundingBox(), box = await page.locator('.hub-switch').boundingBox();
    check('2 drop-down left edge lines up with the label', Math.abs(sel.x - lab.x) <= 1, JSON.stringify({ lab, sel }));
    check('2 drop-down is below the label', sel.y > lab.y, '');
    check('2 drop-down fills the switcher width (not squeezed right)', sel.width >= box.width - 2, JSON.stringify({ sel, box }));
    check('2 drop-down stays inside the screen', sel.x + sel.width <= 390, '');
    await page.screenshot({ path: path.join(shots, 'hub-switch-fixed.png'), clip: { x: 0, y: 40, width: 390, height: 260 } });
    await ctx.close(); }
  { const { ctx, page } = await open(browser, world({ families: two }), '#/hub', { viewport: { width: 1200, height: 800 } }); await settle(page);
    const lab = await page.locator('.hub-switch label').boundingBox(), sel = await page.locator('#hub-fam').boundingBox();
    check('2 desktop: still left-aligned under the label', Math.abs(sel.x - lab.x) <= 1 && sel.width <= 362, JSON.stringify({ lab, sel }));
    await ctx.close(); }

  // 3. The automatic update (runs when an owner opens the shop) now leaves the same report in Manage the shop
  { const imp = [0, 1, 2].map(i => ({ key: 'p-' + i, title: 'Item ' + i, enabled: i === 0, supported: true, reason: '', notes: [], image: '', section: 'gifts', kind: 'photo', visible: true, missing: false, variantCount: 1, minCents: 2000, maxCents: 2000, syncedAt: '', printifyId: String(i), blueprintId: 1, providerId: 1, position: i }));
    const sync = { ok: true, page: 1, lastPage: 1, total: 3, results: imp.map(p => ({ key: p.key, title: p.title, action: 'updated', supported: true, reason: '', notes: [], enabled: p.enabled, variants: 1 })) };
    const mock = world({ bodies: [] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
    await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await page.addInitScript(([m, imp, sync]) => {
      m.tables.profiles = [{ $id: 'pu1famA', userId: 'u1', familyId: 'famA', displayName: 'Test Owner', bio: '', about: '[]', $createdAt: '2026-01-01' }];
      m.api = {
        shopCatalog: () => ({ products: [], featuredKeys: [], sections: [], slots: [], config: { countries: ['US'], currency: 'usd', maxQty: 10, supportEmail: '', taxPercent: 0, testMode: true, paymentsReady: true }, isAdmin: true }),
        shopAdminCheck: () => ({ squareEnvironment: 'sandbox', configured: {}, autoSubmit: false, taxPercent: 0 }),
        shopAdminOverview: () => ({ orders: [], imported: imp, products: [] }),
        shopAdminSync: (b) => { m.bodies.push(b); return sync; }, shopAdminSyncFinish: () => ({ deleted: 0 }), shopAdminToggle: () => ({}), shopAdminCjList: () => ({ configured: false })
      };
      window.__MOCK = m;
    }, [mock, imp, sync]);
    await page.goto('http://127.0.0.1:' + PORT + SUB + '#/shop');
    await page.waitForSelector('text=Last updated', { timeout: 10000 });
    await page.evaluate(() => { location.hash = '#/shop/admin'; });
    await page.waitForSelector('.sync-report[aria-label="Latest sync results"]', { timeout: 8000 });
    const rep = await page.locator('.sync-report[aria-label="Latest sync results"]').innerText();
    check('3 automatic update report appears and is labelled automatic', /Latest automatic update/.test(rep) && /new products always start switched off/.test(rep), rep);
    check('3 counts: reported 3, read 3, 0 new / 3 updated / 0 skipped, on 1', /reported 3 products/.test(rep) && /0 new, 3 updated, 0 skipped/.test(rep) && /Switched on: 1/.test(rep), rep);
    check('3 automatic update sent enableNew false and made no toggle calls', (await page.evaluate(() => window.__MOCK.bodies.every(b => b.enableNew === false))) && !(await page.evaluate(() => window.__MOCK.log.some(l => /Toggle/.test(l)))), '');
    check('3 no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

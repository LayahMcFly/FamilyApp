/* Browser tests for the Shop Manager Printify sync report (class B evidence: real Chrome, real app code, FAKE backend).
 * Run: cd tests/browser && node sync-report.spec.js . Proves what the screen shows for given sync responses. It does NOT prove anything about live Printify or Appwrite data. */
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

  // Test data mirrors the shape seen in the owner's recording: 14 products, 6 switched on, 8 switched off, one a Printify draft.
  const names = ['Oval Pendant', 'Framed Canvas', 'Name Bar Bracelet', 'Photo and Text Pendant', 'Heart Frame Pendant', 'Photo Puzzle',
    'Stone Bracelet', 'Charm Bracelet', 'Ceramic Tile', 'Round Pendant', 'Heart Keychain', 'Acrylic Keyring', 'Horizontal Poster', 'Matte Poster'];
  const mkImported = () => names.map((t, i) => ({ key: 'p-' + i, title: t, enabled: i < 6, supported: true, reason: '', notes: [], image: '', section: 'gifts', kind: 'photo', visible: t !== 'Charm Bracelet', missing: false, variantCount: 1, minCents: 2000, maxCents: 2000, syncedAt: '', printifyId: String(i), blueprintId: 1, providerId: 1, position: i }));
  async function run(imported, syncResponse) {
    const mock = { signedIn: true, user: user, families: [{ id: 'famA', name: 'Alpha Family', role: 'owner' }], tables: { profiles: [prof('u1', 'Test Owner', 'famA')], people: [], posts: [] }, bodies: [] };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
    await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await page.addInitScript(([m, imp, sync]) => {
      m.api = {
        shopCatalog: () => ({ products: [], featuredKeys: [], sections: [], slots: [], config: { countries: ['US'], currency: 'usd', maxQty: 10, supportEmail: '', taxPercent: 0, testMode: true, paymentsReady: true }, isAdmin: true }),
        shopAdminCheck: () => ({ squareEnvironment: 'sandbox', configured: {}, autoSubmit: false, taxPercent: 0 }),
        shopAdminOverview: () => ({ orders: [], imported: imp, products: [] }),
        shopAdminSync: (b) => { m.bodies.push(b); return sync; },
        shopAdminSyncFinish: () => ({ deleted: 0 }),
        shopAdminToggle: () => ({})
      };
      window.__MOCK = m;
    }, [mock, imported, syncResponse]);
    await page.goto('http://127.0.0.1:' + PORT + SUB + '#/shop/admin');
    try { await page.waitForSelector('text=Your Printify store products', { timeout: 8000 }); } catch (e) { console.log('DEBUG', page.url(), (await page.locator('body').innerText()).slice(0, 600), errors.join('|')); throw e; }
    return { ctx, page, errors };
  }
  const text = (page, sel) => page.locator(sel).first().innerText();
  const all = (page, sel) => page.locator(sel).allInnerTexts().then(a => a.join('\n'));

  // 1. The recording's shape: 14 reported, all 14 already saved, 6 on / 8 off. Sync with "Show NEW" ticked.
  { const imp = mkImported();
    const sync = { ok: true, page: 1, lastPage: 1, total: 14, shop: null, results: imp.map(p => ({ key: p.key, title: p.title, action: 'updated', supported: true, reason: '', notes: [], enabled: p.enabled, variants: 1 })) };
    const { ctx, page, errors } = await run(imp, sync);
    check('1 before any sync: no latest-sync card', (await page.locator('.sync-report[aria-label="Latest sync results"]').count()) === 0, '');
    const saved = await text(page, '.sync-report[aria-label="Saved products now"]');
    check('1 saved summary: 14 total, 6 on, 8 off, adds up', /\(14\)/.test(saved) && /Switched on: 6/.test(saved) && /Switched off[^\n]*: 8/.test(saved) && /Flagged[^\n]*: 0/.test(saved) && /add up to 14/.test(saved), saved);
    check('1 saved summary never says visible to customers', !/visible to customers/i.test(saved) && /cannot confirm what a customer sees/.test(saved), saved);
    await page.locator('#sync-new').check();
    await page.getByRole('button', { name: 'Sync from Printify' }).click();
    await page.waitForSelector('.sync-report[aria-label="Latest sync results"]', { timeout: 8000 });
    const rep = await text(page, '.sync-report[aria-label="Latest sync results"]');
    check('1 reports Printify total and products read separately', /Printify reported 14 products/.test(rep) && /read 14/.test(rep), rep);
    check('1 new/updated/skipped add up to read', /0 new, 14 updated, 0 skipped/.test(rep) && /add up to 14/.test(rep), rep);
    check('1 switched on 6 / left off 8 / flagged 0', /Switched on: 6/.test(rep) && /switched off after this sync: 8 of the 14/.test(rep) && /Flagged[^\n]*: 0/.test(rep), rep);
    check('1 flagged is explained as overlapping, not an extra group', /not a fourth group/.test(rep), rep);
    check('1 says it is not a storefront check', /not a check of what customers can see/.test(rep), rep);
    check('1 does not claim visible to customers', !/visible to customers/i.test(rep), rep);
    check('1 Show NEW note: applies only to new, updated kept state', /applies only to the 0 new products/.test(rep) && /14 updated products kept the on\/off setting/.test(rep), rep);
    check('1 sync request carried enableNew true (checkbox behaviour unchanged)', (await page.evaluate(() => window.__MOCK.bodies.map(b => b.enableNew))).every(v => v === true), '');
    await page.locator('.sync-report details summary').click();
    const rows = await all(page, '.sync-rows li');
    check('1 every one of the 14 products is listed with its state', names.every(n => rows.includes(n)) && (rows.match(/switched on/g) || []).length === 6 && (rows.match(/left switched off/g) || []).length === 8, rows);
    const log = await page.evaluate(() => window.__MOCK.log.filter(l => /shopAdmin(Toggle|Sync)/.test(l)).join('|'));
    check('1 no publish/hide calls made by the report (sync only)', !/Toggle/.test(log), log);
    const saved2 = await text(page, '.sync-report[aria-label="Saved products now"]');
    check('1 card survives the reload after sync and still matches saved state', /Switched on: 6/.test(saved2), saved2);
    await page.screenshot({ path: path.join(shots, 'sync-report-mobile.png'), fullPage: true });
    check('1 no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // 2. Mixed run: new, updated, skipped, flagged; Printify reports more than was read; "Show NEW" NOT ticked.
  { const imp = mkImported().slice(0, 3);
    const sync = { ok: true, page: 1, lastPage: 1, total: 6, shop: null, results: [
      { key: 'p-0', title: 'Oval Pendant', action: 'updated', supported: true, reason: '', notes: [], enabled: true, variants: 1 },
      { key: 'p-9', title: 'Brand New Mug', action: 'new', supported: true, reason: '', notes: [], enabled: false, variants: 2 },
      { key: 'p-10', title: 'Two Print Area Shirt', action: 'new', supported: false, reason: 'It has more than one print area.', notes: [], enabled: false, variants: 3 },
      { key: 'p-11', title: 'Flagged Update', action: 'updated', supported: false, reason: 'No usable variants.', notes: [], enabled: false, variants: 0 },
      { key: 'p-12', title: 'Unreadable Hoodie', action: 'skipped', supported: false, reason: 'Printify did not return the print area sizes for this product just now.', notes: [], enabled: false, variants: 0 } ] };
    const { ctx, page, errors } = await run(imp, sync);
    await page.getByRole('button', { name: 'Sync from Printify' }).click();
    await page.waitForSelector('.sync-report[aria-label="Latest sync results"]', { timeout: 8000 });
    const rep = await text(page, '.sync-report[aria-label="Latest sync results"]');
    check('2 reported 6 but read 5, difference flagged as unexplained', /reported 6 products/.test(rep) && /read 5/.test(rep) && /not explained by this screen/.test(rep), rep);
    check('2 2 new + 2 updated + 1 skipped = 5', /2 new, 2 updated, 1 skipped/.test(rep) && /add up to 5/.test(rep), rep);
    check('2 flagged 2 and overlap explanation; off 4 of 4 saved; on 1', /Flagged[^\n]*: 2\./.test(rep) && /switched off after this sync: 3 of the 4 that were saved/.test(rep) && /Switched on: 1/.test(rep), rep);
    check('2 results without the published field (older server) show no unpublished line', !/Not published on Printify/.test(rep), rep);
    check('2 no Show NEW note when it was not ticked', !/Show NEW products/.test(rep), rep);
    await page.locator('.sync-report details summary').click();
    const rows = await page.locator('.sync-rows li').allInnerTexts();
    check('2 skipped first, then flagged, then the rest', /Unreadable Hoodie/.test(rows[0]) && /(Two Print Area Shirt|Flagged Update)/.test(rows[1]) && /(Two Print Area Shirt|Flagged Update)/.test(rows[2]) && /Oval Pendant|Brand New Mug/.test(rows[3]), rows.join(' // '));
    check('2 reasons are shown for skipped and flagged', /print area sizes/.test(rows[0]) && /more than one print area|No usable variants/.test(rows[1]), rows.join(' // '));
    check('2 request carried enableNew false (checkbox untouched)', (await page.evaluate(() => window.__MOCK.bodies.map(b => b.enableNew))).every(v => v === false), '');
    const saved = await text(page, '.sync-report[aria-label="Saved products now"]');
    check('2 saved summary is separate from the sync report and adds up to 3', /\(3\)/.test(saved) && /add up to 3/.test(saved), saved);
    check('2 no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // 3. Saved-summary categories: missing, flagged, off and on are each counted once.
  { const imp = mkImported().slice(0, 4); imp[0].missing = true; imp[0].enabled = true; imp[1].supported = false; imp[1].reason = 'x'; imp[2].enabled = false; imp[3].enabled = true;
    const { ctx, page } = await run(imp, { ok: true, page: 1, lastPage: 1, total: 0, results: [] });
    const saved = await text(page, '.sync-report[aria-label="Saved products now"]');
    check('3 each product counted once (1 on, 1 off, 1 flagged, 1 missing)', /Switched on: 1/.test(saved) && /Switched off[^\n]*: 1/.test(saved) && /Flagged[^\n]*: 1/.test(saved) && /No longer in your Printify shop: 1/.test(saved), saved);
    await ctx.close(); }

  // 4. Unpublished products: counted, explained, and shown per product
  { const imp = mkImported().slice(0, 3);
    const sync = { ok: true, page: 1, lastPage: 1, total: 3, results: [
      { key: 'p-0', title: 'Oval Pendant', action: 'updated', supported: true, published: true, reason: '', notes: [], enabled: true, variants: 1 },
      { key: 'p-1', title: 'Was On Now Draft', action: 'updated', supported: true, published: false, reason: '', notes: [], enabled: false, variants: 1 },
      { key: 'p-2', title: 'Brand New Draft', action: 'new', supported: true, published: false, reason: '', notes: [], enabled: false, variants: 1 } ] };
    const { ctx, page } = await run(imp, sync);
    await page.locator('#sync-new').check();
    await page.getByRole('button', { name: 'Sync from Printify' }).click();
    await page.waitForSelector('.sync-report[aria-label="Latest sync results"]', { timeout: 8000 });
    const rep = await text(page, '.sync-report[aria-label="Latest sync results"]');
    check('4 counts products Printify has not published, with the always-off rule', /Not published on Printify: 2\./.test(rep) && /always left switched off/.test(rep) && /overlaps/.test(rep), rep);
    await page.locator('.sync-report details summary').click();
    const rows = await all(page, '.sync-rows li');
    check('4 each unpublished product says so', (rows.match(/not published on Printify/g) || []).length === 2, rows);
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

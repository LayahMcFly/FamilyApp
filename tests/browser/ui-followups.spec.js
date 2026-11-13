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
    await page.locator('.sync-report[aria-label="Latest sync results"]').screenshot({ path: path.join(shots, 'auto-update-card.png') });
    check('3 no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // 4. Settings > Family and members: roles and powers table (owner and plain member both see it)
  for (const role of ['owner', 'member']) {
    const mock = world({ families: [{ id: 'famA', name: 'Alpha Family', role }], members: [{ $id: 'm1', userId: 'u1', confirm: true, roles: role === 'owner' ? ['owner'] : [], userName: 'Test Owner', userEmail: 't@example.com' }] });
    const { ctx, page, errors } = await open(browser, mock, '#/settings/family');
    await page.waitForSelector('.roles-table', { timeout: 8000 });
    const cols = await page.locator('.roles-table thead th').allInnerTexts();
    check('4 ' + role + ': columns are Power, Owner, Tree admin, Chat admin, Member', cols.join('|') === 'Power|Owner|Tree admin|Chat admin|Member', cols.join('|'));
    const cell = async (rowText) => { const r = page.locator('.roles-table tbody tr', { has: page.locator('th[scope="row"]', { hasText: rowText }) }).first(); return (await r.locator('td').allInnerTexts()).map(t => /yes/.test(t) ? 'Y' : 'N').join(''); };
    check('4 ' + role + ': tree editing = owner + tree admin', (await cell('Add, edit or delete people in the tree')) === 'YYNN', await cell('Add, edit or delete people in the tree'));
    check('4 ' + role + ': channel management = owner + chat admin', (await cell('Create, rename, reorder or archive chat channels')) === 'YNYN', '');
    check('4 ' + role + ': moderating chat = owner + chat admin', (await cell('Delete other people’s messages in channels')) === 'YNYN', '');
    check('4 ' + role + ': deleting the family = owner only', (await cell('Delete the whole family')) === 'YNNN', '');
    check('4 ' + role + ': choosing admins = owner only', (await cell('Choose who is a tree admin')) === 'YNNN', '');
    check('4 ' + role + ': basic family use = everyone', (await cell('See the feed and the family tree')) === 'YYYY', '');
    check('4 ' + role + ': every power row has one cell per role', await page.locator('.roles-table tbody tr:has(th[scope="row"])').evaluateAll(rs => rs.every(r => r.querySelectorAll('td').length === 4)), '');
    check('4 ' + role + ': says roles can be combined and shop management is separate', /Roles can be combined/.test(await page.locator('[aria-label="What each role can do"]').innerText()) && /Managing the shop[^.]*is separate from family roles/.test(await page.locator('[aria-label="What each role can do"]').innerText()), '');
    check('4 ' + role + ': the table is read-only (no buttons or inputs inside it)', (await page.locator('[aria-label="What each role can do"] button, [aria-label="What each role can do"] input, [aria-label="What each role can do"] select').count()) === 0, '');
    check('4 ' + role + ': says there is no parent/adult role', /no separate parent or adult role/.test(await page.locator('[aria-label="What each role can do"]').innerText()), '');
    if (role === 'owner') { const t = await page.locator('body').innerText(); check('4 owner: table sits above the Tree admins list', t.indexOf('What each role can do') > -1 && t.indexOf('What each role can do') < t.indexOf('Family tree admins'), ''); await page.locator('[aria-label="What each role can do"]').screenshot({ path: path.join(shots, 'roles-table-mobile.png') }); }
    check('4 ' + role + ': no page errors', errors.length === 0, errors.join('|'));
    await ctx.close();
  }

  // 5. Roles table fits the screen: no sideways scrolling, nothing cut off, no extra blank space
  for (const width of [320, 360, 390, 768, 1200]) {
    const mock = world({ families: [{ id: 'famA', name: 'Alpha Family', role: 'owner' }], members: [{ $id: 'm1', userId: 'u1', confirm: true, roles: ['owner'], userName: 'Test Owner', userEmail: 't@example.com' }] });
    const { ctx, page } = await open(browser, mock, '#/settings/family', { viewport: { width, height: 900 } });
    await page.waitForSelector('.roles-table', { timeout: 8000 });
    const m = await page.evaluate(() => {
      const wrap = document.querySelector('.roles-wrap'), t = document.querySelector('.roles-table'), card = wrap.closest('section'), cr = card.getBoundingClientRect(), tr = t.getBoundingClientRect();
      const cells = [...t.querySelectorAll('th, td')].map(c => c.getBoundingClientRect());
      return { sw: wrap.scrollWidth, cw: wrap.clientWidth, scrollable: wrap.scrollWidth > wrap.clientWidth + 1, tl: tr.left, tr: tr.right, cl: cr.left, cr: cr.right, minL: Math.min(...cells.map(c => c.left)), maxR: Math.max(...cells.map(c => c.right)), docW: document.documentElement.scrollWidth, vw: window.innerWidth };
    });
    check('5 @' + width + ': the table does not scroll sideways', !m.scrollable, JSON.stringify(m));
    check('5 @' + width + ': every cell is inside the card (nothing cut off left or right)', m.minL >= m.cl - 1 && m.maxR <= m.cr + 1, JSON.stringify(m));
    check('5 @' + width + ': the table fills the card width (no extra space)', Math.abs(m.tr - m.tl - (m.cr - m.cl - 2 * (m.tl - m.cl))) <= 2 && m.tr <= m.cr, JSON.stringify(m));
    const hdr = await page.evaluate(() => [...document.querySelectorAll('.roles-table thead th')].map(h => ({ t: h.textContent, over: h.scrollWidth > h.clientWidth + 1, lines: Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight)) })));
    check('5 @' + width + ': no column heading is cut or broken mid-word', hdr.every(h => !h.over), JSON.stringify(hdr));
    check('5 @' + width + ': the page itself does not scroll sideways', m.docW <= m.vw + 1, JSON.stringify(m));
    if (width === 360) { const bb = await page.evaluate(() => { const r = document.querySelector('[aria-label="What each role can do"]').getBoundingClientRect(); return { x: 0, y: r.top + window.scrollY, width: window.innerWidth, height: r.height }; }); await page.evaluate(() => { document.querySelectorAll('.topbar, header, .nav').forEach(e => { e.style.visibility = 'hidden'; }); }); await page.screenshot({ path: path.join(shots, 'roles-table-fit-360.png'), fullPage: true, clip: bb }); }
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

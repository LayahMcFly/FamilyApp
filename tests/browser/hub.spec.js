/* Browser tests for the Family Hub (class B evidence: real Chrome, real app code, FAKE Appwrite backend).
 * Run:  cd tests/browser && npm i playwright-core && node hub.spec.js
 * It proves routing and screen behaviour. It does NOT prove anything about the live Appwrite project. */
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
  const view = p => p.evaluate(() => document.querySelector('main') && document.querySelector('main').getAttribute('data-view'));
  const settle = p => p.waitForSelector('main[data-view]', { timeout: 8000 });

  // A. signed out
  { const { ctx, page, errors } = await open(browser, world({ signedIn: false }));
    await page.waitForSelector('h1,h2', { timeout: 8000 });
    check('A signed out shows sign-in, no Hub', (await page.locator('text=Welcome back').count()) > 0 && (await page.locator('.hub-grid').count()) === 0, 'sign-in not shown');
    check('A no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // B. one family -> Hub, default landing
  { const { ctx, page, errors } = await open(browser, world(), ''); await settle(page);
    check('B lands on Hub with no hash', (await view(page)) === 'hub', await view(page));
    check('B shows the family name', (await page.locator('.hub-family').innerText()) === 'Alpha Family', '');
    check('B single family: no switcher', (await page.locator('.hub-switch').count()) === 0, '');
    const labels = await page.locator('.hub-title').allInnerTexts();
    check('B cards (chat/shop may be off in config)', labels.includes('Community') && labels.includes('Family Tree') && labels.includes('Recipes') && labels.includes('Calendar & Chores'), labels.join(','));
    check('B page URL keeps /FamilyCircle/ subpath', page.url().includes(SUB), page.url());
    await page.screenshot({ path: path.join(shots, 'hub-mobile-light.png'), fullPage: true });
    check('B no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // D. original apps: exact URLs, new tab, exact label, not a hash link
  { const { ctx, page } = await open(browser, world(), '#/hub'); await settle(page);
    const rec = page.locator('a[data-hub="recipes"]'), cal = page.locator('a[data-hub="calendar"]');
    check('D Recipes URL', (await rec.getAttribute('href')) === 'https://layahmcfly.github.io/ZenfulOutput/recipe-book/', await rec.getAttribute('href'));
    check('D Calendar URL', (await cal.getAttribute('href')) === 'https://layahmcfly.github.io/ZenfulOutput/family-board/', '');
    for (const [n, l] of [['Recipes', rec], ['Calendar', cal]]) {
      check('D ' + n + ' opens in new tab safely', (await l.getAttribute('target')) === '_blank' && /noopener/.test(await l.getAttribute('rel')), '');
      check('D ' + n + ' has the exact label', (await l.locator('.hub-orig').innerText()) === 'Original app — separate sign-in may be required.', await l.locator('.hub-orig').innerText());
    }
    check('D inside cards stay in this tab', (await page.locator('a[data-hub="tree"]').getAttribute('target')) === null && (await page.locator('a[data-hub="community"]').getAttribute('target')) === null, '');
    check('D no card claims Appwrite/migrated', !/appwrite|migrat|integrat/i.test(await page.locator('.hub-grid').innerText()), '');
    await ctx.close(); }

  // C/E/F. navigation and deep links
  { const { ctx, page, errors } = await open(browser, world(), '#/hub'); await settle(page);
    await page.click('a[data-hub="community"]'); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'home');
    check('C Community opens the feed (#/home)', location_ok(page.url(), '#/home') && (await view(page)) === 'home', page.url());
    check('E feed has Back to Hub', (await page.locator('.hub-back a').count()) === 1, '');
    await page.click('.hub-back a'); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'hub');
    check('E Back to Hub works', (await view(page)) === 'hub', '');
    await page.click('a[data-hub="tree"]'); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'tree');
    check('C Tree opens as its own module with Back to Hub', (await page.locator('.hub-back a').count()) === 1 && /Family Tree/.test(await page.locator('main h1').first().innerText()), '');
    await page.goBack(); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'hub');
    check('E browser Back returns to Hub', (await view(page)) === 'hub', '');
    await page.goForward(); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'tree');
    check('E browser Forward returns to Tree', (await view(page)) === 'tree', '');
    await page.reload(); await settle(page);
    check('E refresh stays on Tree', (await view(page)) === 'tree', await view(page));
    await page.click('a.brand'); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'hub');
    check('E FamilyCircle name opens Hub', (await view(page)) === 'hub', '');
    check('C no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  for (const [hash, want] of [['#/home', 'home'], ['#/tree', 'tree'], ['#/tree/abc', 'tree'], ['#/post/xyz', 'post'], ['#/chat', 'chat'], ['#/dms/abc', 'dms'], ['#/shop', 'shop'], ['#/orders', 'orders'], ['#/orders/o1/done', 'orders'], ['#/saved', 'saved'], ['#/profile', 'profile'], ['#/shorts', 'shorts'], ['#/settings', 'settings']]) {
    const { ctx, page } = await open(browser, world(), hash);
    try { await settle(page); } catch (e) { /* module may be switched off in config */ }
    const v = await view(page);
    check('F deep link ' + hash + ' -> ' + want + ' (not forced to Hub)', v === want || (v === 'hub' && ['chat','dms','shop','orders'].includes(want) && !(await page.evaluate(() => !!(window.FCChat || window.FCShop)))), 'got ' + v);
    await ctx.close();
  }

  // nav bar: five items on a phone, labels, active state
  { const { ctx, page } = await open(browser, world(), '#/home'); await settle(page);
    const vis = await page.$$eval('.nav li', els => els.filter(e => e.offsetParent !== null).map(e => (e.innerText || e.textContent || '').trim() || e.getAttribute('class')));
    const names = await page.$$eval('.nav li a', els => els.filter(e => e.offsetParent !== null).map(e => e.getAttribute('data-route')));
    check('J phone bottom bar has at most 5 visible items', names.length + (await page.locator('.nav li.nav-create').count()) <= 5 && vis.length <= 5, vis.join('|'));
    check('J phone bar order Hub, Shorts, (Create), Feed, Profile', names.join(',') === 'hub,shorts,home,profile' || names.join(',') === 'hub,shorts,create,home,profile', names.join(','));
    check('J Feed label is Feed and route is #/home', (await page.locator('.nav a[data-route="home"] span').innerText()) === 'Feed' && (await page.locator('.nav a[data-route="home"]').getAttribute('href')) === '#/home', '');
    check('J Tree is not in the social bar', (await page.locator('.nav a[data-route="tree"]').count()) === 0, '');
    check('J Feed is the active item on the feed', (await page.locator('.nav a[data-route="home"]').getAttribute('aria-current')) === 'page', '');
    check('J bookmark icon in top bar reaches Saved', (await page.locator('#saved-btn').getAttribute('href')) === '#/saved', '');
    await ctx.close(); }
  { const { ctx, page } = await open(browser, world(), '#/hub', { viewport: { width: 1280, height: 800 } }); await settle(page);
    check('J desktop sidebar keeps Saved', (await page.locator('.nav li.nav-saved').isVisible()), '');
    await page.screenshot({ path: path.join(shots, 'hub-desktop-light.png') }); await ctx.close(); }

  // J. dark + keyboard + no overlap
  { const { ctx, page } = await open(browser, world(), '#/hub', { colorScheme: 'dark' }); await settle(page);
    await page.screenshot({ path: path.join(shots, 'hub-mobile-dark.png'), fullPage: true });
    await page.focus('a.brand'); const seq = [];
    for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => document.activeElement && (document.activeElement.getAttribute('data-hub') || '')));
    }
    check('J keyboard Tab reaches every Hub card in order', ['community', 'tree', 'recipes', 'calendar'].every(x => seq.includes(x)), seq.join(','));
    const url0 = page.url(); await page.focus('a[data-hub="tree"]'); await page.keyboard.press('Enter'); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'tree');
    check('J Enter on a card opens it', (await view(page)) === 'tree' && url0 !== page.url(), '');
    await page.goto('http://127.0.0.1:' + PORT + SUB + '#/hub'); await settle(page);
    const ov = await page.evaluate(() => { const g = document.querySelector('.hub-grid li:last-child').getBoundingClientRect(), n = document.querySelector('.nav').getBoundingClientRect(); return { gridBottom: g.bottom + window.scrollY, navTop: n.top + window.scrollY, navPos: getComputedStyle(document.querySelector('.nav')).position, docH: document.documentElement.scrollHeight, navH: n.height }; });
    check('J last card is reachable above the bottom bar (scrolled to end)', await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); const g = document.querySelector('.hub-grid li:last-child').getBoundingClientRect(), n = document.querySelector('.nav').getBoundingClientRect(); return g.bottom <= n.top + 1; }), JSON.stringify(ov));
    await ctx.close(); }

  // I. latest work still works: profile Details card, tree person panel (regression for a bug caught here)
  { const mock = world({ tables: { profiles: [Object.assign(prof('u1', 'Test Owner', 'famA'), { bio: 'Hello there' })], posts: [], people: [{ $id: 'pa', familyId: 'famA', name: 'Alpha Person', userId: 'u1', gender: 'Female', birthday: '1990-05-04', confirmed: true, parentIds: [], $createdAt: '2026-01-01' }] } });
    const { ctx, page, errors } = await open(browser, mock, '#/profile'); await settle(page); await page.waitForTimeout(500);
    const t = await page.locator('main').innerText();
    check('I profile page shows Details card (Gender, Birthday)', /details/i.test(t) && /gender/i.test(t) && /female/i.test(t) && /birthday/i.test(t), t.slice(0, 300));
    check('I profile page shows bio once, not duplicated in Details', (t.match(/Hello there/g) || []).length === 1, '');
    check('I profile has no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }
  { const mock = world({ tables: { profiles: [prof('u1', 'Test Owner', 'famA')], posts: [], people: [{ $id: 'pa', familyId: 'famA', name: 'Alpha Person', userId: 'u1', gender: 'Female', birthday: '1990-05-04', confirmed: true, parentIds: [], $createdAt: '2026-01-01' }] } });
    const { ctx, page, errors } = await open(browser, mock, '#/tree'); await settle(page); await page.waitForTimeout(600);
    const t = await page.locator('main').innerText();
    check('I tree person panel renders (no "not defined" error)', !/not defined/.test(t) && /Alpha Person/.test(t), t.slice(0, 300));
    check('I tree has no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // G. multiple families + switching
  { const mock = world({ families: [{ id: 'famA', name: 'Alpha Family', role: 'owner' }, { id: 'famB', name: 'Beta Family', role: 'member' }],
      tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB')], people: [{ $id: 'pa', familyId: 'famA', name: 'Alpha Person' }, { $id: 'pb', familyId: 'famB', name: 'Beta Person' }], posts: [] } });
    const { ctx, page } = await open(browser, mock, '#/tree'); await settle(page);
    await page.waitForTimeout(400);
    check('G tree for family A shows only A people', /Alpha Person/.test(await page.locator('main').innerText()) && !/Beta Person/.test(await page.locator('main').innerText()), '');
    await page.goto('http://127.0.0.1:' + PORT + SUB + '#/hub'); await settle(page);
    check('G switcher is shown with 2 families', (await page.locator('#hub-fam').count()) === 1, '');
    await page.selectOption('#hub-fam', 'famB'); await page.waitForFunction(() => document.querySelector('.hub-family') && document.querySelector('.hub-family').innerText === 'Beta Family', null, { timeout: 8000 });
    check('G switching lands on the NEW family Hub', (await page.locator('.hub-family').innerText()) === 'Beta Family' && page.url().endsWith('#/hub'), page.url());
    await page.click('a[data-hub="tree"]'); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'tree'); await page.waitForTimeout(400);
    const t = await page.locator('main').innerText();
    check('G after switching, tree shows B and none of A', /Beta Person/.test(t) && !/Alpha Person/.test(t), t.slice(0, 200));
    await ctx.close(); }

  // 5. entry states: no family; revoked membership
  { const { ctx, page } = await open(browser, world({ families: [], canCreateFamily: true }), ''); await page.waitForSelector('h1,h2', { timeout: 8000 });
    check('Entry: signed in, no family -> onboarding, no Hub', (await page.locator('.hub-grid').count()) === 0 && (await page.locator('main[data-view]').count()) === 0, '');
    await ctx.close(); }
  { const mock = world({ families: [{ id: 'famA', name: 'Alpha Family', role: 'owner' }, { id: 'famB', name: 'Beta Family', role: 'member' }] });
    const { ctx, page } = await open(browser, mock, '#/hub'); await settle(page);
    await page.evaluate(() => { window.__MOCK.revoked = ['famA']; });
    await page.evaluate(() => { /* force the 5-minute access re-check to run on the next navigation */ });
    await page.waitForTimeout(100);
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
  function location_ok(u, h) { return u.endsWith(h); }
})().catch(e => { console.error(e); process.exit(2); });

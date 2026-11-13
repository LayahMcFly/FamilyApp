/* Browser tests for the responsive Hub layout (class B evidence: real Chrome, real app code, FAKE Appwrite backend).
 * Run:  cd tests/browser && npm i playwright-core && node hub-layout.spec.js
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
const OUT = process.env.SHOTS || path.join(__dirname, 'screenshots');
async function openAt(browser, w, h, mock, blockModules) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  for (const m of blockModules || []) await page.route(new RegExp('/FamilyCircle/' + m + '\\.js'), r => r.abort());   // module off = its Hub card is not offered (same as the app's own switches)
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  await page.goto('http://127.0.0.1:' + PORT + SUB + '#/hub'); await page.waitForSelector('.hub-grid', { timeout: 8000 });
  return { ctx, page, errors };
}
const geometry = page => page.evaluate(() => {
  const li = [...document.querySelectorAll('.hub-grid > li')], cards = li.map(l => l.querySelector('a.hub-card')), nav = document.querySelector('.nav'), grid = document.querySelector('.hub-grid'), head = document.querySelector('.hub-head');
  const r = e => e.getBoundingClientRect();
  const lefts = [...new Set(cards.map(c => Math.round(r(c).left)))].sort((a, b) => a - b), tops = [...new Set(cards.map(c => Math.round(r(c).top)))].sort((a, b) => a - b);
  const clipped = cards.filter(c => [c, ...c.querySelectorAll('.hub-title,.hub-desc,.hub-orig')].some(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map(c => c.dataset.hub);
  const overlap = []; cards.forEach((a, i) => cards.forEach((b, j) => { if (j > i) { const A = r(a), B = r(b); if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) overlap.push(a.dataset.hub + '/' + b.dataset.hub); } }));
  const navBox = nav ? r(nav) : null, side = navBox && navBox.width < 400 && navBox.height > navBox.width;     // left menu (desktop) vs bottom bar (phone)
  return { ids: cards.map(c => c.dataset.hub), cols: lefts.length, rows: tops.length, lefts, tops, rowOf: cards.map(c => tops.indexOf(Math.round(r(c).top))), colOf: cards.map(c => lefts.indexOf(Math.round(r(c).left))),
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, clipped, overlap, liCount: li.length, emptyLi: li.filter(l => !l.querySelector('a.hub-card')).length,
    headInsideGrid: grid.contains(head) , selectInsideGrid: !!grid.querySelector('select, .hub-switch'), headBottom: Math.round(r(head).bottom), gridTop: Math.round(r(grid).top), gridLeft: Math.round(r(grid).left), gridRight: Math.round(r(grid).right),
    navRight: side ? Math.round(navBox.right) : null, navTop: !side && navBox ? Math.round(navBox.top) : null, lastBottom: Math.round(Math.max.apply(null, cards.map(c => r(c).bottom))), vw: document.documentElement.clientWidth };
});
const rowMajor = g => g.ids.every((_, i) => g.rowOf[i] === Math.floor(i / 3) && g.colOf[i] === i % 3);
let PORT;
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port; fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const TWO = world({ families: [{ id: 'famA', name: 'Alpha Family With A Rather Long Name To Test Wrapping', role: 'owner' }, { id: 'famB', name: 'Beta Family', role: 'member' }] });
  let phoneIds = null;

  // phones and tablets below 900px: one column
  for (const [w, h] of [[360, 740], [390, 800], [768, 1024], [899, 900]]) {
    const { ctx, page, errors } = await openAt(browser, w, h, TWO); const g = await geometry(page);
    check(`${w}px: one column, cards stacked in order, none side by side`, g.cols === 1 && g.rows === g.ids.length, JSON.stringify({ cols: g.cols, rows: g.rows }));
    check(`${w}px: no sideways scroll, no clipped text, no overlap`, !g.hOverflow && g.clipped.length === 0 && g.overlap.length === 0, JSON.stringify({ o: g.hOverflow, c: g.clipped, v: g.overlap }));
    check(`${w}px: family heading and selector sit above the grid, not inside it`, !g.headInsideGrid && !g.selectInsideGrid && g.headBottom <= g.gridTop, JSON.stringify(g));
    if (w === 390) { phoneIds = g.ids; await page.screenshot({ path: path.join(OUT, 'phone-390-six-destinations.png') });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); const g2 = await geometry(page); const nav = await page.evaluate(() => Math.round(document.querySelector('.nav').getBoundingClientRect().top));
      const lastBottomNow = await page.evaluate(() => Math.round(document.querySelector('.hub-grid li:last-child').getBoundingClientRect().bottom));
      check('390px: last card can be scrolled clear of the bottom bar', lastBottomNow <= nav, lastBottomNow + ' vs ' + nav); }
    if (w === 899) await page.screenshot({ path: path.join(OUT, 'tablet-899-one-column.png') });
    check(`${w}px: no page errors`, errors.length === 0, errors.join('|')); await ctx.close();
  }

  // computers 900px and wider: three columns, row by row, same order as the phone
  for (const [w, h] of [[900, 800], [1024, 800], [1280, 800], [1440, 900]]) {
    const { ctx, page, errors } = await openAt(browser, w, h, TWO); const g = await geometry(page);
    check(`${w}px: three columns, filled row by row (6 cards = 2 full rows)`, g.cols === 3 && g.rows === 2 && rowMajor(g), JSON.stringify({ cols: g.cols, rows: g.rows, r: g.rowOf, c: g.colOf }));
    check(`${w}px: same card order as on the phone`, JSON.stringify(g.ids) === JSON.stringify(phoneIds), g.ids.join(',') + ' vs ' + (phoneIds || []).join(','));
    check(`${w}px: no sideways scroll, no clipped text, no overlap`, !g.hOverflow && g.clipped.length === 0 && g.overlap.length === 0, JSON.stringify({ o: g.hOverflow, c: g.clipped, v: g.overlap }));
    check(`${w}px: grid starts to the right of the left menu (${g.gridLeft} >= ${g.navRight}) and fits the screen (${g.gridRight} <= ${g.vw})`, g.navRight !== null && g.gridLeft >= g.navRight && g.gridRight <= g.vw, JSON.stringify(g));
    check(`${w}px: family heading and selector are above and outside the grid`, !g.headInsideGrid && !g.selectInsideGrid && g.headBottom <= g.gridTop, JSON.stringify(g));
    if (w === 900) await page.screenshot({ path: path.join(OUT, 'desktop-900-narrowest-three-columns.png') });
    if (w === 1280) await page.screenshot({ path: path.join(OUT, 'desktop-1280-six-destinations.png') });
    check(`${w}px: no page errors`, errors.length === 0, errors.join('|')); await ctx.close();
  }

  // fewer destinations: only the real ones, last row incomplete, no placeholders (chat and shop modules off = 4 destinations)
  { const { ctx, page, errors } = await openAt(browser, 1280, 800, TWO, ['chat', 'shop']); const g = await geometry(page);
    check('4 destinations at 1280px: exactly 4 cards in 3 + 1, row by row', g.ids.length === 4 && g.cols === 3 && g.rows === 2 && rowMajor(g), JSON.stringify(g.ids) + JSON.stringify({ r: g.rowOf, c: g.colOf }));
    check('4 destinations: no empty placeholder cells, no duplicates', g.emptyLi === 0 && g.liCount === 4 && new Set(g.ids).size === 4, JSON.stringify({ e: g.emptyLi, n: g.liCount }));
    check('4 destinations: last row stays incomplete (one card, first column)', g.rowOf.filter(r => r === 1).length === 1 && g.colOf[3] === 0, '');
    await page.screenshot({ path: path.join(OUT, 'desktop-1280-four-destinations.png') });
    const p = await openAt(browser, 390, 800, TWO, ['chat', 'shop']); const gp = await geometry(p.page);
    check('4 destinations: phone order is the same and still one column', gp.cols === 1 && JSON.stringify(gp.ids) === JSON.stringify(g.ids), gp.ids.join(','));
    check('4 destinations: no page errors', errors.length === 0 && p.errors.length === 0, errors.join('|')); await p.ctx.close(); await ctx.close(); }

  // nine: the app has at most six destinations today, so this is TEST-ONLY: three cards are cloned in the browser (never shipped) to prove the 3 x 3 geometry
  { const { ctx, page, errors } = await openAt(browser, 1280, 800, TWO);
    await page.evaluate(() => { const ul = document.querySelector('.hub-grid'), lis = [...ul.children]; lis.slice(0, 3).forEach((l, i) => { const c = l.cloneNode(true); c.querySelector('a').dataset.hub = 'test-only-' + i; ul.appendChild(c); }); });
    const g = await geometry(page);
    check('9 destinations (test-only clones): a full 3 x 3 grid, row by row', g.ids.length === 9 && g.cols === 3 && g.rows === 3 && rowMajor(g), JSON.stringify({ n: g.ids.length, cols: g.cols, rows: g.rows }));
    check('9 destinations: no overlap, clipping or sideways scroll', g.overlap.length === 0 && g.clipped.length === 0 && !g.hOverflow, JSON.stringify(g.clipped));
    await page.screenshot({ path: path.join(OUT, 'desktop-1280-nine-simulated-test-only.png') });
    check('9 destinations: no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // the card links and permission rules are untouched: same cards as before for the same configuration
  { const { ctx, page } = await openAt(browser, 1280, 800, TWO); const hrefs = await page.evaluate(() => [...document.querySelectorAll('.hub-card')].map(a => a.getAttribute('data-hub') + '=' + a.getAttribute('href')));
    check('links unchanged', hrefs.join('|') === 'community=#/home|messages=#/chat|tree=#/tree|shop=#/shop|recipes=' + 'https://layahmcfly.github.io/ZenfulOutput/recipe-book/' + '|calendar=' + 'https://layahmcfly.github.io/ZenfulOutput/family-board/', hrefs.join('|')); await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

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
  const li = [...document.querySelectorAll('.hub-grid > li')], cards = li.map(l => l.querySelector('.hub-card')), nav = document.querySelector('.nav'), grid = document.querySelector('.hub-grid'), head = document.querySelector('.hub-head');
  const r = e => e.getBoundingClientRect();
  const lefts = [...new Set(cards.map(c => Math.round(r(c).left)))].sort((a, b) => a - b), tops = [...new Set(cards.map(c => Math.round(r(c).top)))].sort((a, b) => a - b);
  const clipped = cards.filter(c => [c, ...c.querySelectorAll('.hub-title,.hub-desc,.hub-orig,.hub-badge')].some(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).map(c => c.dataset.hub);
  const overlap = []; cards.forEach((a, i) => cards.forEach((b, j) => { if (j > i) { const A = r(a), B = r(b); if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) overlap.push(a.dataset.hub + '/' + b.dataset.hub); } }));
  const navBox = nav ? r(nav) : null, side = navBox && navBox.width < 400 && navBox.height > navBox.width;     // left menu (desktop) vs bottom bar (phone)
  return { ids: cards.map(c => c.dataset.hub), cols: lefts.length, rows: tops.length, lefts, tops, rowOf: cards.map(c => tops.indexOf(Math.round(r(c).top))), colOf: cards.map(c => lefts.indexOf(Math.round(r(c).left))),
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, clipped, overlap, liCount: li.length, emptyLi: li.filter(l => !l.querySelector('.hub-card')).length,
    headInsideGrid: grid.contains(head) , selectInsideGrid: !!grid.querySelector('select, .hub-switch'), headBottom: Math.round(r(head).bottom), gridTop: Math.round(r(grid).top), gridLeft: Math.round(r(grid).left), gridRight: Math.round(r(grid).right),
    navRight: side ? Math.round(navBox.right) : null, navTop: !side && navBox ? Math.round(navBox.top) : null, lastBottom: Math.round(Math.max.apply(null, cards.map(c => r(c).bottom))), vw: document.documentElement.clientWidth };
});
const rowMajor = g => g.ids.every((_, i) => g.rowOf[i] === Math.floor(i / 3) && g.colOf[i] === i % 3);
const REAL = ['community', 'messages', 'tree', 'shop', 'recipes', 'calendar'], PLAN = ['giving', 'exchange', 'challenges', 'legacy', 'skills', 'travel', 'vault', 'assistant'], ALL = REAL.concat(PLAN);
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
    if (w === 390) { phoneIds = g.ids; await page.screenshot({ path: path.join(OUT, 'phone-390-all-destinations.png'), fullPage: true });
      check('390px: all 14 destinations in the agreed order (6 existing, then 8 Planned)', JSON.stringify(g.ids) === JSON.stringify(ALL), g.ids.join(','));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); const g2 = await geometry(page); const nav = await page.evaluate(() => Math.round(document.querySelector('.nav').getBoundingClientRect().top));
      const lastBottomNow = await page.evaluate(() => Math.round(document.querySelector('.hub-grid li:last-child').getBoundingClientRect().bottom));
      check('390px: last card can be scrolled clear of the bottom bar', lastBottomNow <= nav, lastBottomNow + ' vs ' + nav); }
    if (w === 899) await page.screenshot({ path: path.join(OUT, 'tablet-899-one-column.png'), fullPage: true });
    check(`${w}px: no page errors`, errors.length === 0, errors.join('|')); await ctx.close();
  }

  // computers 900px and wider: three columns, row by row, same order as the phone
  for (const [w, h] of [[900, 800], [1024, 800], [1280, 800], [1440, 900]]) {
    const { ctx, page, errors } = await openAt(browser, w, h, TWO); const g = await geometry(page);
    check(`${w}px: three columns, filled row by row (14 cards = 4 full rows + 2)`, g.ids.length === 14 && g.cols === 3 && g.rows === 5 && rowMajor(g) && g.rowOf.filter(r => r === 4).length === 2, JSON.stringify({ cols: g.cols, rows: g.rows, r: g.rowOf, c: g.colOf }));
    check(`${w}px: same card order as on the phone`, JSON.stringify(g.ids) === JSON.stringify(phoneIds), g.ids.join(',') + ' vs ' + (phoneIds || []).join(','));
    check(`${w}px: no sideways scroll, no clipped text, no overlap`, !g.hOverflow && g.clipped.length === 0 && g.overlap.length === 0, JSON.stringify({ o: g.hOverflow, c: g.clipped, v: g.overlap }));
    check(`${w}px: grid starts to the right of the left menu (${g.gridLeft} >= ${g.navRight}) and fits the screen (${g.gridRight} <= ${g.vw})`, g.navRight !== null && g.gridLeft >= g.navRight && g.gridRight <= g.vw, JSON.stringify(g));
    check(`${w}px: family heading and selector are above and outside the grid`, !g.headInsideGrid && !g.selectInsideGrid && g.headBottom <= g.gridTop, JSON.stringify(g));
    if (w === 900) await page.screenshot({ path: path.join(OUT, 'desktop-900-narrowest-three-columns.png'), fullPage: true });
    if (w === 1280) await page.screenshot({ path: path.join(OUT, 'desktop-1280-all-destinations.png'), fullPage: true });
    check(`${w}px: no page errors`, errors.length === 0, errors.join('|')); await ctx.close();
  }

  // visibility rules unchanged: Shop module off = no Shop card, and the Planned cards simply follow the cards that are there
  { const { ctx, page, errors } = await openAt(browser, 1280, 800, TWO, ['shop']); const g = await geometry(page);
    check('Shop off at 1280px: Shop card absent, the other 5 real cards keep their order, then the 8 Planned', JSON.stringify(g.ids) === JSON.stringify(ALL.filter(x => x !== 'shop')), g.ids.join(','));
    check('Shop off: 13 cards = 4 full rows + 1 card alone in the first column, no placeholders', g.ids.length === 13 && g.cols === 3 && g.rows === 5 && rowMajor(g) && g.rowOf.filter(r => r === 4).length === 1 && g.colOf[12] === 0 && g.emptyLi === 0 && g.liCount === 13, JSON.stringify({ r: g.rowOf, c: g.colOf }));
    await page.screenshot({ path: path.join(OUT, 'desktop-1280-shop-off-13-cards.png'), fullPage: true });
    check('Shop off: no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }
  { const { ctx, page, errors } = await openAt(browser, 1280, 800, TWO, ['chat', 'shop']); const g = await geometry(page);
    check('Chat and Shop off: 4 real cards then 8 Planned, 12 cards = 4 full rows', JSON.stringify(g.ids) === JSON.stringify(['community', 'tree', 'recipes', 'calendar'].concat(PLAN)) && g.rows === 4 && rowMajor(g) && g.emptyLi === 0, g.ids.join(','));
    check('Chat and Shop off: no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // Planned cards: honest, inert, accessible
  for (const [w, h] of [[390, 800], [1280, 800]]) {
    const { ctx, page, errors } = await openAt(browser, w, h, TWO); const url0 = page.url();
    const st = await page.evaluate(PLAN => {
      const out = {}; PLAN.forEach(id => { const b = document.querySelector('[data-hub="' + id + '"]'), li = b && b.closest('li'), note = li && li.querySelector('.hub-note');
        out[id] = { tag: b && b.tagName, href: b && b.getAttribute('href'), type: b && b.getAttribute('type'), badge: b && (b.querySelector('.hub-badge') || {}).textContent, expanded: b && b.getAttribute('aria-expanded'),
          controls: b && b.getAttribute('aria-controls'), noteId: note && note.id, noteHidden: note && note.hidden, noteDisplay: note && getComputedStyle(note).display, anchors: li ? li.querySelectorAll('a').length : -1,
          controlsInside: li ? li.querySelectorAll('input,textarea,select,form,[type=file],[contenteditable]').length : -1, title: b && b.querySelector('.hub-title').textContent, desc: b && b.querySelector('.hub-desc').textContent }; }); return out; }, PLAN);
    const names = { giving: 'Giving Center', exchange: 'Family Exchange', challenges: 'Challenges', legacy: 'Memories & Legacy', skills: 'Skills & Mentorship', travel: 'Travel Planner', vault: 'Document Vault', assistant: 'Family Assistant' };
    check(`${w}px Planned: each of the 8 is a button (not a link), with no href and no route`, PLAN.every(id => st[id].tag === 'BUTTON' && st[id].type === 'button' && st[id].href === null && st[id].anchors === 0), JSON.stringify(st));
    check(`${w}px Planned: names are exactly the agreed ones`, PLAN.every(id => st[id].title === names[id]), PLAN.map(id => st[id].title).join('|'));
    check(`${w}px Planned: every card carries a visible "Planned" label`, PLAN.every(id => st[id].badge === 'Planned'), '');
    check(`${w}px Planned: notes start closed (hidden, not displayed), aria-expanded=false, aria-controls points at the note`, PLAN.every(id => st[id].expanded === 'false' && st[id].noteHidden === true && st[id].noteDisplay === 'none' && st[id].controls === st[id].noteId), JSON.stringify(st.giving));
    check(`${w}px Planned: no inputs, forms, uploads or editable fields anywhere in them`, PLAN.every(id => st[id].controlsInside === 0), '');
    // open one with the mouse
    await page.click('[data-hub="giving"]');
    const o1 = await page.evaluate(() => { const b = document.querySelector('[data-hub="giving"]'), n = document.getElementById(b.getAttribute('aria-controls')); const r = n.getBoundingClientRect(), c = b.getBoundingClientRect(), li = b.closest('li').getBoundingClientRect();
      return { exp: b.getAttribute('aria-expanded'), visible: !n.hidden && r.height > 0, text: n.textContent, below: r.top >= c.bottom - 1, insideCell: r.bottom <= li.bottom + 1 && r.left >= li.left - 1 && r.right <= li.right + 1, hash: location.hash, view: document.querySelector('main').dataset.view, hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
    check(`${w}px Planned: click shows a short "not available yet" note under the card, nothing navigates`, o1.exp === 'true' && o1.visible && /Giving Center is not available yet/.test(o1.text) && o1.below && o1.insideCell && o1.hash === '#/hub' && o1.view === 'hub' && page.url() === url0, JSON.stringify(o1));
    check(`${w}px Planned: the note makes no promise of data, payment, upload or enrolment, and contains no figures`, !/\$|\d/.test(o1.text) && /nothing to open, create, send or pay/.test(o1.text), o1.text);
    check(`${w}px Planned: opening a note does not add sideways scroll`, !o1.hOverflow, '');
    const g1 = await geometry(page);
    check(`${w}px Planned: with a note open, no card overlaps, clips or leaves its row`, g1.overlap.length === 0 && g1.clipped.length === 0 && (w < 900 || (g1.cols === 3 && rowMajor(g1))), JSON.stringify({ o: g1.overlap, c: g1.clipped }));
    await page.screenshot({ path: path.join(OUT, `planned-note-open-${w}.png`), fullPage: true });
    await page.click('[data-hub="giving"]');
    check(`${w}px Planned: second click closes the note again`, await page.evaluate(() => { const b = document.querySelector('[data-hub="giving"]'); return b.getAttribute('aria-expanded') === 'false' && document.getElementById(b.getAttribute('aria-controls')).hidden; }), '');
    // keyboard: Space and Enter on a card
    await page.focus('[data-hub="vault"]'); await page.keyboard.press('Enter');
    const k1 = await page.evaluate(() => document.querySelector('[data-hub="vault"]').getAttribute('aria-expanded')); await page.keyboard.press('Space');
    const k2 = await page.evaluate(() => document.querySelector('[data-hub="vault"]').getAttribute('aria-expanded'));
    check(`${w}px Planned: Enter opens and Space closes (native button keyboard behaviour)`, k1 === 'true' && k2 === 'false' && page.url() === url0, k1 + ',' + k2);
    // keyboard order reaches all 14 in order, planned ones included
    await page.focus('a[data-hub="community"]'); const seq = ['community'];
    for (let i = 0; i < 13; i++) { await page.keyboard.press('Tab'); seq.push(await page.evaluate(() => document.activeElement.getAttribute('data-hub') || '?')); }
    check(`${w}px Planned: Tab visits all 14 cards in order`, JSON.stringify(seq) === JSON.stringify(ALL), seq.join(','));
    // accessible name carries title, Planned and description
    const nm = await page.evaluate(() => document.querySelector('[data-hub="travel"]').innerText.replace(/\s+/g, ' '));
    check(`${w}px Planned: the button's readable text includes name, "Planned" and what it will be`, /Travel Planner/.test(nm) && /planned/i.test(nm) && /itineraries/.test(nm), nm);
    // no duplicate Calendar, no empty cards, unique ids, one h1
    const dup = await page.evaluate(() => { const t = [...document.querySelectorAll('.hub-title')].map(e => e.textContent); return { t, uniq: new Set(t).size === t.length, cal: t.filter(x => /calendar|events/i.test(x)), ids: new Set([...document.querySelectorAll('[id]')].map(e => e.id)).size === document.querySelectorAll('[id]').length, h1: document.querySelectorAll('h1').length, empty: [...document.querySelectorAll('.hub-grid li')].filter(l => !l.querySelector('.hub-title').textContent.trim() || !l.querySelector('.hub-desc').textContent.trim()).length }; });
    check(`${w}px: titles unique, only ONE Calendar card (Events live under Calendar & Chores), element ids unique, one h1, no empty cards`, dup.uniq && dup.cal.length === 1 && dup.cal[0] === 'Calendar & Chores' && dup.ids && dup.h1 === 1 && dup.empty === 0, JSON.stringify(dup));
    check(`${w}px Planned: no page errors`, errors.length === 0, errors.join('|')); await ctx.close(); }

  // dark mode screenshot, real cards must still work and Planned must stay readable
  { const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'dark' }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort()); await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
    await page.addInitScript(m => { window.__MOCK = m; }, TWO); await page.goto('http://127.0.0.1:' + PORT + SUB + '#/hub'); await page.waitForSelector('.hub-grid');
    await page.click('[data-hub="legacy"]'); await page.screenshot({ path: path.join(OUT, 'phone-390-dark-note-open.png'), fullPage: true });
    const cr = await page.evaluate(() => { const l = c => { c = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
      const pairs = [['.hub-badge', '.hub-badge'], ['.hub-note', '.hub-note']].map(([a]) => { const e = document.querySelector(a), cs = getComputedStyle(e); return { fg: cs.color, bg: cs.backgroundColor }; });
      return pairs.map(p => { const a = l(p.fg), b = l(p.bg); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }); });
    check('dark mode: Planned badge and note text have contrast of at least 4.5:1 (' + cr.map(x => x.toFixed(1)).join(', ') + ')', cr.every(x => x >= 4.5), cr.join(','));
    check('dark mode: no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // the card links and permission rules are untouched: same cards as before for the same configuration
  { const { ctx, page } = await openAt(browser, 1280, 800, TWO); const hrefs = await page.evaluate(() => [...document.querySelectorAll('a.hub-card')].map(a => a.getAttribute('data-hub') + '=' + a.getAttribute('href')));
    check('links unchanged (the same six existing destinations, same targets; Planned cards add no links)', hrefs.join('|') === 'community=#/home|messages=#/chat|tree=#/tree|shop=#/shop|recipes=' + 'https://layahmcfly.github.io/ZenfulOutput/recipe-book/' + '|calendar=' + 'https://layahmcfly.github.io/ZenfulOutput/family-board/', hrefs.join('|')); await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

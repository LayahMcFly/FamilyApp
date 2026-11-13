/* Release-review browser tests (class B: real Chrome, real app code, FAKE Appwrite).
 * Covers: chat family-menu switching, access revocation with controlled time, photo viewer, Mother/Father labels.
 * Run: node review.spec.js   (after: npm i playwright-core)
 * These tests prove what the BROWSER CODE does when the (fake) server says something. They do NOT prove Appwrite permissions. */
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
const prof = (uid, name, fid) => ({ $id: 'p' + uid + fid, userId: uid, familyId: fid, displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' });
const TWO = [{ id: 'famA', name: 'Alpha Family', role: 'owner' }, { id: 'famB', name: 'Beta Family', role: 'member' }];
function world(x) { return Object.assign({ signedIn: true, user, families: [TWO[0]], canCreateFamily: false, tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB')], people: [], posts: [] } }, x || {}); }
let pass = 0, fail = 0, PORT; const results = [];
function check(n, ok, d) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  -> ' + d)); }
async function open(browser, mock, hash, o) {
  o = o || {}; const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.route(/\/storage\/buckets\/.*\/files\/.*\/view/, r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  if (o.clock) await page.clock.install({ time: new Date() });
  await page.goto('http://127.0.0.1:' + PORT + SUB + (hash || '')); return { ctx, page, errors };
}
const view = p => p.evaluate(() => document.querySelector('main') && document.querySelector('main').dataset.view);
const settle = p => p.waitForSelector('main[data-view]', { timeout: 8000 });
const text = p => p.locator('body').innerText();
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

  // 1. Switching families from chat's OWN family menu (channels and DMs)
  for (const start of ['#/chat', '#/dms']) {
    const mock = world({ families: TWO, tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB')], people: [], posts: [] } });
    const { ctx, page, errors } = await open(browser, mock, start); await settle(page);
    await page.waitForSelector('.fam-btn', { timeout: 8000 });
    const before = await page.evaluate(() => ({ subs: window.__MOCK.log.filter(x => x === 'subscribe').length }));
    check('1 [' + start + '] chat shows family A content first', /channel-of-a/.test(await text(page)) || start === '#/dms', (await text(page)).slice(0, 200));
    await page.click('.fam-btn'); await page.locator('.cs-row', { hasText: 'Beta Family' }).click();
    await page.waitForFunction(() => document.querySelector('.hub-family'), null, { timeout: 8000 });
    check('1 [' + start + '] lands on the NEW family Hub', (await page.locator('.hub-family').innerText()) === 'Beta Family' && page.url().endsWith('#/hub'), page.url());
    const t = await text(page);
    check('1 [' + start + '] no old-family text or chat screen left', !/channel-of-a/.test(t) && (await page.locator('.chat-side,.chat-main').count()) === 0 && !(await page.evaluate(() => document.body.classList.contains('chat-mode'))), t.slice(0, 200));
    const after = await page.evaluate(() => ({ subs: window.__MOCK.log.filter(x => x === 'subscribe').length, unsubs: window.__MOCK.log.filter(x => x === 'unsubscribe').length }));
    check('1 [' + start + '] chat subscription was closed', after.subs === 0 || after.unsubs >= after.subs, JSON.stringify({ before, after }));
    await page.evaluate(() => { window.__MOCK.log.length = 0; });
    await page.goto('http://127.0.0.1:' + PORT + SUB + '#/chat'); await page.waitForFunction(() => document.querySelector('main').dataset.view === 'chat'); await page.waitForTimeout(500);
    const t2 = await text(page), log = await page.evaluate(() => window.__MOCK.log.join(','));
    check('1 [' + start + '] chat for family B asks the server about B only, shows no A content', /chatOpen famB/.test(log) && !/famA/.test(log) && !/channel-of-a/.test(t2), log.slice(0, 200));
    check('1 [' + start + '] no page errors', errors.length === 0, errors.join('|')); await ctx.close();
  }

  // 2. Access revocation: the real 5-minute membership recheck, using controlled time (fast-forward 6 minutes)
  { const mock = world({ families: TWO, tables: { profiles: [prof('u1', 'Test Owner', 'famA'), prof('u1', 'Test Owner', 'famB')], people: [{ $id: 'pa', familyId: 'famA', name: 'Alpha Person', parentIds: [], $createdAt: '2026-01-01' }, { $id: 'pb', familyId: 'famB', name: 'Beta Person', parentIds: [], $createdAt: '2026-01-01' }], posts: [] } });
    const { ctx, page, errors } = await open(browser, mock, '#/tree', { clock: true }); await settle(page); await page.waitForTimeout(500);
    check('2a before revocation: family A tree is visible', /Alpha Person/.test(await text(page)), '');
    await page.evaluate(() => { window.__MOCK.revoked = ['famA']; window.__MOCK.log.push('--revoked--'); });
    await page.clock.fastForward('06:00');           // past the 5-minute recheck window, without waiting
    await page.evaluate(() => { location.hash = '#/post/old-post-of-A'; }); // a navigation triggers the real recheck
    await page.waitForFunction(() => document.querySelector('.hub-family') && document.querySelector('.hub-family').innerText === 'Beta Family', null, { timeout: 8000 });
    const t = await text(page), log = await page.evaluate(() => { const l = window.__MOCK.log, i = l.indexOf('api listFamilies', l.indexOf('--revoked--')); return l.slice(i).join(','); });   // calls made AFTER the server said "no longer a member"
    check('2a revoked A: protected content removed, lands on remaining family\'s Hub', !/Alpha/.test(t) && page.url().endsWith('#/hub'), t.slice(0, 200) + ' ' + page.url());
    check('2a user is told why', /no longer a member/i.test(t), t.slice(0, 300));
    check('2a after the server reports the revocation, the app never requests family A again (earlier badge polls before the recheck are expected)', !/ famA/.test(log), log.slice(0, 300));
    await page.click('a[data-hub="tree"]'); await page.waitForTimeout(500);
    check('2a family B tree shows no A people', /Beta Person/.test(await text(page)) && !/Alpha Person/.test(await text(page)), '');
    check('2a no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }
  { const mock = world({ families: [TWO[0]], tables: { profiles: [prof('u1', 'Test Owner', 'famA')], people: [{ $id: 'pa', familyId: 'famA', name: 'Alpha Person', parentIds: [], $createdAt: '2026-01-01' }], posts: [] }, canCreateFamily: true });
    const { ctx, page, errors } = await open(browser, mock, '#/tree', { clock: true }); await settle(page); await page.waitForTimeout(500);
    await page.evaluate(() => { window.__MOCK.revoked = ['famA']; });
    await page.clock.fastForward('06:00'); await page.evaluate(() => { location.hash = '#/tree/pa'; });
    await page.waitForSelector('text=You are not in a family space yet', { timeout: 8000 });
    const t = await text(page);
    check('2b revoked from the ONLY family: onboarding (create/join), no app shell or content', !/Alpha/.test(t) && (await page.locator('.nav,.hub-grid,main[data-view]').count()) === 0, t.slice(0, 200));
    check('2b no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // 3a. Photo viewer
  { const mock = world({ tables: { profiles: [prof('u1', 'Test Owner', 'famA')], people: [], posts: [{ $id: 'post1', familyId: 'famA', authorId: 'u1', kind: 'photo', body: 'A caption', mediaFileId: 'file1', mediaMime: 'image/png', mediaSize: 3000, $createdAt: '2026-11-01T10:00:00.000+00:00', $updatedAt: '2026-11-01T10:00:00.000+00:00' }] } });
    const { ctx, page, errors } = await open(browser, mock, '#/home'); await settle(page);
    await page.waitForSelector('.media img.zoomable', { timeout: 8000 });
    await page.click('.media img.zoomable'); await page.waitForFunction(() => location.hash === '#/post/post1');
    check('3a feed: pressing a photo opens the post thread', (await view(page)) === 'post', await view(page));
    await page.waitForSelector('.media img.zoomable', { timeout: 8000 }); await page.click('.media img.zoomable');
    await page.waitForSelector('dialog.photo-viewer[open]');
    const tf = () => page.locator('.photo-viewer img').evaluate(i => i.style.transform);
    check('3a thread: pressing the photo opens the full-screen viewer', (await page.locator('dialog.photo-viewer').isVisible()), '');
    await page.click('button[aria-label="Zoom in"]'); check('3a Zoom in button scales up', /scale\(1\.4/.test(await tf()), await tf());
    await page.click('button[aria-label="Zoom out"]'); check('3a Zoom out returns to 1', /scale\(1\)/.test(await tf()), await tf());
    await page.dblclick('.pv-stage'); check('3a double-click zooms in', /scale\(2\.5\)/.test(await tf()), await tf());
    await page.dblclick('.pv-stage'); check('3a double-click again zooms out', /scale\(1\)/.test(await tf()), await tf());
    await page.mouse.move(195, 400); await page.mouse.wheel(0, -300); await page.waitForTimeout(100); check('3a scroll wheel zooms', !/scale\(1\)/.test(await tf()), await tf());
    await page.evaluate(() => {   // two-finger pinch, simulated with pointer events
      const st = document.querySelector('.pv-stage'), mk = (t, id, x, y) => st.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true }));
      mk('pointerdown', 1, 150, 400); mk('pointerdown', 2, 240, 400); mk('pointermove', 2, 340, 400); mk('pointermove', 1, 100, 400); mk('pointerup', 1, 100, 400); mk('pointerup', 2, 340, 400); });
    const sc = Number(((await tf()).match(/scale\(([\d.]+)\)/) || [])[1]); check('3a pinch changes the zoom', sc > 1, await tf());
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('dialog.photo-viewer'));
    check('3a Esc closes the viewer', true, '');
    await page.click('.media img.zoomable'); await page.waitForSelector('dialog.photo-viewer[open]'); await page.click('.pv-close'); await page.waitForFunction(() => !document.querySelector('dialog.photo-viewer'));
    check('3a Close button closes the viewer', true, '');
    await page.click('.media img.zoomable'); await page.waitForSelector('dialog.photo-viewer[open]'); await page.mouse.click(5, 5); await page.waitForFunction(() => !document.querySelector('dialog.photo-viewer'));
    check('3a tapping the dark area closes the viewer', true, '');
    await page.focus('.media img.zoomable'); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.photo-viewer[open]');
    check('3a keyboard Enter opens the viewer', true, ''); await page.screenshot({ path: path.join(__dirname, 'screenshots', 'photo-viewer.png') });
    check('3a no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // 3b. Mother / Father labels
  { const P = (id, name, g, x) => Object.assign({ $id: id, familyId: 'famA', name, gender: g, parentIds: [], partnerIds: [], $createdAt: '2026-01-01' }, x || {});
    const people = [P('mom', 'Mom Alpha', 'Female'), P('dad', 'Dad Alpha', 'Male'), P('step', 'Bob Stepper', 'Male'), P('nb', 'Sam Nonbin', 'Nonbinary'), P('unk', 'Pat Unset', ''),
      P('kid', 'Kid Test', 'Male', { parentIds: ['mom', 'dad', 'step', 'nb'], parentKinds: JSON.stringify({ step: 'step' }) }), P('kid2', 'Kid Two', 'Female', { parentIds: ['unk'] })];
    const mock = world({ tables: { profiles: [prof('u1', 'Test Owner', 'famA')], people, posts: [] } });
    const { ctx, page, errors } = await open(browser, mock, '#/tree/kid'); await settle(page); await page.waitForSelector('.tree-panel .rel-group', { timeout: 8000 });
    const chip = n => page.locator('.tree-panel .chip', { hasText: n }).locator('.kind-tag').innerText();
    check('3b female parent is tagged Mother', (await chip('Mom Alpha')) === 'Mother', await chip('Mom Alpha'));
    check('3b male parent is tagged Father', (await chip('Dad Alpha')) === 'Father', await chip('Dad Alpha'));
    check('3b step parent tagged Step-father', (await chip('Bob Stepper')) === 'Step-father', await chip('Bob Stepper'));
    check('3b nonbinary parent keeps neutral wording', (await chip('Sam Nonbin')) === 'Birth parent', await chip('Sam Nonbin'));
    await page.goto('http://127.0.0.1:' + PORT + SUB + '#/tree/kid2'); await page.waitForSelector('.tree-panel .rel-group'); await page.waitForTimeout(300);
    check('3b parent with no gender set keeps neutral wording', (await page.locator('.tree-panel .chip', { hasText: 'Pat Unset' }).locator('.kind-tag').innerText()) === 'Birth parent', '');
    // relationship dropdown inside the edit dialog
    await page.goto('http://127.0.0.1:' + PORT + SUB + '#/tree/kid'); await page.waitForSelector('.tree-panel .rel-group');
    await page.getByRole('button', { name: 'Edit', exact: true }).click(); await page.getByRole('button', { name: /^Edit Kid Test/ }).click();
    await page.waitForSelector('dialog .parent-rows .row'); const opts = await page.locator('dialog .parent-rows .row').first().locator('select').nth(1).locator('option').allInnerTexts();
    check('3b edit dialog: relationship list for the first (female) parent says Mother', opts[0] === 'Mother', opts.join('|'));
    const opts2 = await page.locator('dialog .parent-rows .row').nth(1).locator('select').nth(1).locator('option').allInnerTexts();
    check('3b edit dialog: male parent says Father, Step-father', opts2[0] === 'Father' && opts2.includes('Step-father'), opts2.join('|'));
    check('3b no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

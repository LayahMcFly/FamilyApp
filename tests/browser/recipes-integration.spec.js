/* Browser tests for Recipes inside Family Circle (class B evidence: real Chrome, real app code, FAKE Appwrite backend, synthetic recipes).
 * Run:  cd tests/browser && node recipes-integration.spec.js
 * It proves routing, the sign-in handshake, per-member storage and the adapted Recipe Book behaviour. It proves nothing about the live site or real devices. */
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), SUB = '/FamilyCircle/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/markdown' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(SUB)) { res.writeHead(404); return res.end(); }
  let f = path.join(ROOT, u.slice(SUB.length) || 'index.html'); if (f.endsWith('/')) f += 'index.html';
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-appwrite.js'), 'utf8');
const mkUser = (id, name) => ({ $id: id, name, email: id + '@example.com', emailVerification: true, prefs: {} });
const prof = (uid, name, fid) => ({ $id: 'p' + uid + fid, userId: uid, familyId: fid, displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' });
const world = (user) => ({ signedIn: true, user, families: [{ id: 'famA', name: 'Alpha Family', role: 'owner' }], canCreateFamily: false,
  tables: { profiles: [prof(user.$id, user.name, 'famA')], people: [], posts: [] } });
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
let PORT;
const URL0 = () => 'http://127.0.0.1:' + PORT + SUB;
async function newPage(ctx, mock, hash, errors, offsite) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror ' + e));
  page.on('console', m => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push('console ' + m.text()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { offsite.push(r.request().url()); r.abort(); });
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  await page.goto(URL0() + (hash || ''));
  return page;
}
const F = p => p.frameLocator('iframe.recipes-frame');
const openRecipes = async (p) => { await p.evaluate(() => { location.hash = '#/hub'; }); await p.waitForSelector('a[data-hub="recipes"]'); await p.evaluate(() => { location.hash = '#/recipes'; }); await p.waitForSelector('iframe.recipes-frame'); await F(p).locator('.book-title').waitFor({ timeout: 8000 }); };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });
  const A = mkUser('uA', 'Alex Tester'), B = mkUser('uB', 'Bea Tester');
  const errors = [], offsite = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, acceptDownloads: true });
  // a sentinel standing in for the ORIGINAL Recipe Book's data on the same origin (same host as the real one)
  const page = await newPage(ctx, world(A), '#/hub', errors, offsite);
  await page.waitForSelector('a[data-hub="recipes"]');
  await page.evaluate(() => { localStorage.setItem('rb_recipes', JSON.stringify([{ name: 'ORIGINAL APP SENTINEL', slug: 'sentinel', ingredients: [], steps: [], categories: [], tags: [] }])); });

  // 1. Hub card -> in-app view, same tab
  const pagesBefore = ctx.pages().length;
  await page.click('a[data-hub="recipes"]');
  await page.waitForSelector('iframe.recipes-frame'); await F(page).locator('.book-title').waitFor({ timeout: 8000 });
  check('1 Recipes opens inside the app (#/recipes)', page.url().endsWith('#/recipes'), page.url());
  check('1 no new tab or window opened', ctx.pages().length === pagesBefore, String(ctx.pages().length));
  check('1 Back to Hub link present above the book', (await page.locator('main .hub-back a[href="#/hub"]').count()) === 1, '');
  check('1 Hub stays highlighted in the bottom bar', (await page.locator('.nav [data-route="hub"][aria-current="page"]').count()) === 1, '');
  const cards = await F(page).locator('ul.grid li').count();
  check('1 four sample recipes shown on first open', cards === 4, String(cards));
  check('1 the original app sentinel is not shown', (await F(page).locator('body').innerText()).indexOf('SENTINEL') < 0, '');
  await page.screenshot({ path: path.join(shots, 'recipes-mobile-home.png') });

  // 2. open a recipe, scale, tick ingredient, cook mode, timer
  await F(page).locator('ul.grid li a').first().click();
  await F(page).locator('h1, h2').first().waitFor();
  const before = await F(page).locator('.ings li').first().innerText();
  await F(page).locator('[data-act="sup"]').first().click();
  const after = await F(page).locator('.ings li').first().innerText();
  check('2 scaling changes the ingredient amounts', before !== after, before + ' | ' + after);
  const box = F(page).locator('input[data-ing]').first(); await box.check();
  check('2 ingredient check box ticks', await box.isChecked(), '');
  await page.screenshot({ path: path.join(shots, 'recipes-mobile-recipe.png') });
  await F(page).locator('[data-act="cook"]').first().click();
  await F(page).locator('#cook').waitFor({ timeout: 4000 });
  check('2 cook mode opens', await F(page).locator('#cook').isVisible(), '');
  await page.screenshot({ path: path.join(shots, 'recipes-mobile-cook.png') });
  await F(page).locator('[data-act="ckexit"]').first().click();
  const tbtn = F(page).locator('[data-act="timer"]').first();
  if (await tbtn.count()) { await tbtn.click(); check('2 a timer starts from a step', (await F(page).locator('#tray .tm, #tray > *').count()) > 0, ''); } else check('2 sample recipe has a timer button (skipped if none)', true, '');

  // 3. add a recipe, survives reload, is private to this member
  await F(page).locator('.slim a').first().click();
  await F(page).locator('a.btn', { hasText: 'Add a recipe' }).click();
  await F(page).locator('#f-name').fill('Test Lemon Cake');
  await F(page).locator('#f-ing').fill('2 cups flour\n1 lemon');
  await F(page).locator('#f-steps').fill('Mix.\nBake 30 minutes.');
  await F(page).locator('#fsave').click();
  await F(page).locator('h1, h2').first().waitFor();
  await page.reload(); await page.waitForSelector('iframe.recipes-frame'); await F(page).locator('.book-title').waitFor({ timeout: 8000 });
  check('3 a new recipe is still there after a full page reload', (await F(page).locator('ul.grid').innerText()).includes('Test Lemon Cake'), '');
  const keysA = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fcrb:')));
  check('3 stored only under this member id', keysA.length > 0 && keysA.every(k => k.startsWith('fcrb:uA:')), keysA.join(','));
  const sentinel = await page.evaluate(() => localStorage.getItem('rb_recipes'));
  check('3 original app keys (rb_*) untouched', /ORIGINAL APP SENTINEL/.test(sentinel) && sentinel.length < 200, String(sentinel).slice(0, 80));

  // 4. a second member on the same device sees none of it
  const pageB = await newPage(ctx, world(B), '#/hub', errors, offsite);
  await pageB.waitForSelector('a[data-hub="recipes"]'); await openRecipes(pageB);
  const textB = await F(pageB).locator('ul.grid').innerText();
  check('4 second member sees only the starter recipes', !textB.includes('Test Lemon Cake') && (await F(pageB).locator('ul.grid li').count()) === 4, textB.slice(0, 60));
  const keysAll = await pageB.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fcrb:')).map(k => k.split(':')[1]));
  check('4 both members have separate key groups', keysAll.includes('uA') && keysAll.includes('uB'), keysAll.join(','));
  await pageB.close();

  // 5. only the real parent can start the book; spoofed or malformed messages are ignored
  const evil = await newPage(ctx, world(A), '#/hub', errors, offsite);
  await evil.route(/spoof\.html$/, r => r.fulfill({ contentType: 'text/html', body: '<script src="spoof.js"></script>' }));
  await evil.route(/spoof\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: "window.top.document.querySelector('iframe').contentWindow.postMessage({type:'fc-recipes-init',userId:'spoofer'},'*')" }));
  const res = await evil.evaluate(async (u) => {
    const out = {}; const mk = src => new Promise(r => { const f = document.createElement('iframe'); f.src = src; f.onload = () => r(f); document.body.appendChild(f); });
    const target = await mk(u + 'recipes-app/index.html'); await new Promise(r => setTimeout(r, 400));
    await mk(u + 'spoof.html');
    await new Promise(r => setTimeout(r, 600));
    out.afterSpoof = Object.keys(localStorage).filter(k => k.includes('spoofer')).length;
    out.stuck = target.contentDocument.body.innerText.includes('Opening the book');
    for (const bad of ['../x', 'a:b', '', 'x'.repeat(80), 123]) target.contentWindow.postMessage({ type: 'fc-recipes-init', userId: bad }, location.origin);
    await new Promise(r => setTimeout(r, 600));
    out.afterBad = Object.keys(localStorage).filter(k => /fcrb:(\.\.|a:b|:|x{20}|123)/.test(k)).length;
    out.stuck2 = target.contentDocument.body.innerText.includes('Opening the book');
    return out;
  }, URL0());
  check('5 a message from any other frame is ignored', res.afterSpoof === 0 && res.stuck, JSON.stringify(res));
  check('5 malformed member ids are ignored', res.afterBad === 0 && res.stuck2, JSON.stringify(res));
  await evil.close();

  // 6. opened on its own (no Family Circle around it): nothing stored, clear message
  const solo = await newPage(ctx, world(A), 'recipes-app/index.html', errors, offsite);
  const soloText = await solo.locator('body').innerText();
  check('6 opened alone it asks you to go through Family Circle', /opens from inside Family Circle/.test(soloText), soloText.slice(0, 80));
  await solo.close();

  // 7. settings, backup, restore, cookbook maker, no leftovers from the original
  await F(page).locator('[data-act="settings"]').first().click();
  const sd = await F(page).locator('#sdlg').innerText();
  check('7 settings has no online-account, AI or outside-service text', !/supabase|sign in|groq|gemini|openrouter|api key|themealdb/i.test(sd), sd.slice(0, 200));
  check('7 settings explains where recipes are kept', /on this device/i.test(sd), '');
  const dl = page.waitForEvent('download');
  await F(page).locator('[data-act="backup"]').first().click(); const d = await dl;
  const file = path.join(shots, 'rb-backup-test.json'); await d.saveAs(file);
  const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('7 backup file is the original backup shape', bk.app === 'family-recipe-book' && bk.version === 1 && Array.isArray(bk.recipes) && bk.recipes.some(r => r.name === 'Test Lemon Cake'), JSON.stringify(Object.keys(bk)));
  await F(page).locator('[data-close="close"]').first().click();
  // restore a synthetic backup that includes a photo
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const rf = path.join(shots, 'rb-restore-test.json');
  fs.writeFileSync(rf, JSON.stringify({ app: 'family-recipe-book', version: 1, recipes: [{ name: 'Restored Soup', ingredients: ['1 cup water'], steps: ['Boil.'], image: png, categories: ['Soups'], tags: [] }] }));
  await F(page).locator('[data-act="settings"]').first().click();
  await F(page).locator('#restore').setInputFiles(rf);
  await F(page).locator('#toast.on').waitFor({ timeout: 4000 });
  check('7 restore adds the recipe', (await F(page).locator('#toast').innerText()).includes('Restored 1 recipe'), await F(page).locator('#toast').innerText());
  await F(page).locator('[data-close="close"]').first().click().catch(() => {});
  const badf = path.join(shots, 'rb-bad-test.json'); fs.writeFileSync(badf, 'not json at all');
  await F(page).locator('[data-act="settings"]').first().click().catch(() => {});
  await F(page).locator('#restore').setInputFiles(badf);
  await page.waitForTimeout(500);
  check('7 a bad file is refused with a message', /does not look like/.test(await F(page).locator('#toast').innerText()), await F(page).locator('#toast').innerText());
  await F(page).locator('[data-close="close"]').first().click().catch(() => {});
  await F(page).locator('a.btn', { hasText: 'Make a cookbook' }).click();
  await F(page).locator('body').waitFor();
  await page.waitForTimeout(1500);
  check('7 cookbook maker loads under the frame security rules', !(await F(page).locator('.err').count()), await F(page).locator('.err').allInnerTexts().catch(() => ''));
  await page.screenshot({ path: path.join(shots, 'recipes-mobile-cookbook.png') });
  await F(page).locator('[data-cb="new"]').click();
  await F(page).locator('[data-cb="selall"]').click();
  for (let i = 0; i < 4; i++) { await F(page).locator('[data-cb="step"]').last().click(); await page.waitForTimeout(500); }
  await F(page).locator('[data-cb="mkpdf"]').first().waitFor({ timeout: 15000 });
  await F(page).locator('[data-cb="mkpdf"]').first().click();
  await F(page).locator('a[download$=".pdf"]').waitFor({ timeout: 60000 });
  const pdfDl = page.waitForEvent('download', { timeout: 30000 });
  await F(page).locator('a[download$=".pdf"]').click(); const pd = await pdfDl;
  const pdfFile = path.join(shots, 'rb-cookbook-test.pdf'); await pd.saveAs(pdfFile);
  const head = fs.readFileSync(pdfFile).subarray(0, 5).toString();
  check('7 the cookbook maker makes a real PDF inside the frame', head === '%PDF-' && fs.statSync(pdfFile).size > 5000, head + ' ' + fs.statSync(pdfFile).size);
  const idbs = await page.frames().find(f => /recipes-app/.test(f.url())).evaluate(() => indexedDB.databases().then(x => x.map(d => d.name)));
  check('7 saved cookbooks live in a per-member database, not the original app’s', idbs.includes('fcrb_cookbooks_uA') && !idbs.includes('rb_cookbooks_v1'), idbs.join(','));
  const dinner = page; await F(page).locator('.slim a').first().click().catch(() => {});

  // 8. What's for dinner has no web option
  await F(page).locator('[data-act="dinner"]').first().click();
  const nd = await F(page).locator('#ndlg').innerText();
  check('8 dinner picker offers only the member’s own recipes', !/something new|themealdb/i.test(nd) && /from your book/i.test(nd), nd.slice(0, 120));
  await F(page).locator('[data-act="ndclose"]').first().click();

  // 9. nothing left the machine, no console or security errors
  check('9 no request to any other website', offsite.length === 0, offsite.join(' '));
  check('9 no page, console or CSP errors', errors.length === 0, errors.join(' | '));

  // 10. desktop screenshot
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const dp = await newPage(dctx, world(A), '#/hub', [], []);
  await dp.waitForSelector('a[data-hub="recipes"]'); await openRecipes(dp); await dp.screenshot({ path: path.join(shots, 'recipes-desktop-home.png') });
  await browser.close(); server.close();
  console.log(results.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

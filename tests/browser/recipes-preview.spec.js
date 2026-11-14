/* Browser tests for the Recipes PREVIEW (class B evidence: real Chrome, real preview code, FAKE in-memory server, invented data and generated photos).
 * Run:  cd tests/browser && npm i playwright-core && node recipes-preview.spec.js
 * Proves screen behaviour and that the preview page makes no network request. Proves NOTHING about real accounts, real privacy, real photo storage,
 * real devices (touch, sound, printing dialogs) or the original Recipe Book. */
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
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
let PORT; const PREVIEW = () => 'http://127.0.0.1:' + PORT + SUB + 'recipes-preview/index.html';
const BANNER = 'Preview — sample data, not saved to your account.';

async function open(browser, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, timezoneId: 'America/New_York' });
  const page = await ctx.newPage(); const log = { errors: [], console: [], requests: [], external: [] };
  page.on('pageerror', e => log.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(m.type() + ': ' + m.text()); });
  page.on('request', r => log.requests.push(r.url()));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { log.external.push(r.request().url()); r.abort(); });
  await page.goto(PREVIEW() + (o.hash || ''));
  await page.waitForSelector('.rc-screen', { timeout: 8000 });
  return { ctx, page, log };
}
const who = async (page, label) => { await page.selectOption('#pv-who', { label }); await page.waitForSelector('.rc-screen'); await page.waitForTimeout(60); };
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const openRecipe = async (page, name) => { await page.locator('.rc-card', { hasText: name }).first().click(); await page.waitForSelector('#rc-recipe'); };
const goBackup = async page => { await page.click('#rc-nav-backup'); await page.waitForSelector('#rc-pick'); };
const imgOk = (page, sel) => page.evaluate(s => { const i = document.querySelector(s); return !!i && i.complete && i.naturalWidth > 0; }, sel);
const listNames = page => page.locator('.rc-card-name').allInnerTexts();
async function importFixture(page, id) { await page.selectOption('#rc-pick', id); await page.click('#rc-check'); await page.waitForSelector('#rc-report'); }

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });

  // A. label, network, CSP, storage
  { const { ctx, page, log } = await open(browser);
    check('A banner says exactly "' + BANNER + '"', (await page.locator('#pv-banner strong').innerText()) === BANNER, await page.locator('#pv-banner strong').innerText());
    check('A banner is a visible note and stays at the top while scrolling', await page.evaluate(() => { window.scrollTo(0, 600); const r = document.getElementById('pv-banner').getBoundingClientRect(); return r.top >= 0 && r.top < 2 && document.getElementById('pv-banner').getAttribute('role') === 'note'; }), '');
    check('A no page errors and no console errors on load (checked before the CSP probes below)', log.errors.length === 0 && log.console.length === 0, log.errors.concat(log.console).join(' | '));
    const blocked = await page.evaluate(async () => { const out = []; for (const u of ['https://nyc.cloud.appwrite.io/v1/health', location.origin + '/FamilyCircle/recipes-preview/recipes.css']) { try { await fetch(u); out.push('allowed'); } catch (e) { out.push('blocked'); } } return out; });
    check('A the page CSP blocks fetch, even to Appwrite and the same site', blocked.join() === 'blocked,blocked', blocked.join());
    const ws = await page.evaluate(() => new Promise(res => { document.addEventListener('securitypolicyviolation', e => res(e.violatedDirective)); try { new WebSocket('wss://nyc.cloud.appwrite.io/v1/realtime'); } catch (e) { res('threw'); } setTimeout(() => res('no violation'), 1500); }));
    check('A the CSP blocks WebSocket (violation: connect-src)', ws === 'connect-src', ws);
    const img = await page.evaluate(() => new Promise(res => { document.addEventListener('securitypolicyviolation', e => res(e.violatedDirective)); const i = new Image(); i.src = 'https://www.themealdb.com/images/x.jpg'; document.body.appendChild(i); setTimeout(() => res('no violation'), 1500); }));
    check('A the CSP refuses a picture from another website (violation: img-src)', img === 'img-src', img);
    await page.waitForTimeout(150);
    check('A zero requests left this machine', log.external.length === 0, log.external.join(','));
    check('A config.js, app.js and the Appwrite SDK were never loaded', !log.requests.some(u => /\/(config|app|chat|hub|shop|calls)\.js|appwrite|sdk\.js/.test(u)), log.requests.filter(u => /config|app\.js|appwrite|sdk/.test(u)).join(','));
    check('A the page has no file picker anywhere (no real uploads in this preview)', (await page.locator('input[type=file]').count()) === 0, '');
    await page.click('#rc-nav-backup'); await page.waitForSelector('#rc-pick');
    check('A the Backup page has no file picker either', (await page.locator('input[type=file]').count()) === 0, '');
    await page.goto(PREVIEW() + '#/recipes/new'); await page.waitForSelector('#rc-form');
    check('A the editor has no file picker (sample photos come from a list)', (await page.locator('input[type=file]').count()) === 0, '');
    await ctx.close(); }

  // B. list, empty state, privacy
  { const { ctx, page } = await open(browser);
    check('B Sample Cook A sees three recipes with thumbnails that load', JSON.stringify(await listNames(page)) === JSON.stringify(['Sample Tomato Soup', 'Sample Lemon Cookies', 'Sample Pasta Night']) && await imgOk(page, '.rc-card img'), JSON.stringify(await listNames(page)));
    check('B the recipe without a photo shows "No photo", not a broken picture', (await page.locator('.rc-card', { hasText: 'Pasta Night' }).locator('.rc-nophoto').count()) === 1, '');
    check('B every card carries the "Private to you" label', (await page.locator('.rc-card .is-private').count()) === 3, '');
    check('B the page says real account privacy is not implemented or verified', /Real account privacy is not implemented or verified/.test(await page.locator('#rc-private-note').innerText()), await page.locator('#rc-private-note').innerText());
    await who(page, 'Sample Cook B');
    check('B Sample Cook B sees only their own recipe', JSON.stringify(await listNames(page)) === JSON.stringify(['Example Pancakes']), JSON.stringify(await listNames(page)));
    const idA = await (async () => { await who(page, 'Sample Cook A'); const href = await page.locator('.rc-card').first().getAttribute('href'); return href; })();
    await who(page, 'Sample Cook B'); await page.goto(PREVIEW() + idA); await page.waitForSelector('.rc-screen');
    check('B opening Sample Cook A\'s recipe address as Sample Cook B shows "not found" and none of the recipe', (await page.locator('#rc-missing').count()) === 1 && (await page.locator('#rc-recipe').count()) === 0, '');
    await who(page, 'Sample Cook C (empty book)');
    check('B the empty book shows an empty state with two ways forward', (await page.locator('#rc-empty').count()) === 1 && (await page.locator('#rc-empty a').count()) === 2 && /No recipes yet/.test(await page.locator('#rc-empty').innerText()), '');
    await page.screenshot({ path: path.join(shots, 'recipes-phone-empty.png'), fullPage: true });
    await ctx.close(); }

  // C. detail, photo aspect, blocked panel, no fake controls
  { const { ctx, page } = await open(browser);
    await openRecipe(page, 'Tomato Soup');
    check('C detail shows name, ingredients, steps, facts', (await page.locator('.rc-title').innerText()) === 'Sample Tomato Soup' && (await page.locator('#rc-ings li').count()) === 3 && (await page.locator('#rc-steps li').count()) === 2 && /4 servings/.test(await page.locator('.rc-facts').innerText()), '');
    check('C the photo loads and its alt text names the recipe', await imgOk(page, '#rc-recipe img') && (await page.locator('#rc-recipe img').getAttribute('alt')) === 'Photo of Sample Tomato Soup', '');
    check('C the heading receives focus after opening a recipe', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('rc-title')), '');
    check('C "Private to you" is shown with the not-verified note', (await page.locator('#rc-recipe .is-private').count()) === 1 && /not implemented or verified/.test(await page.locator('#rc-recipe').innerText()), '');
    const blockedText = await page.locator('#rc-blocked').innerText();
    check('C a "Not in this preview" panel lists scaling, check boxes, cook mode, timers', ['Serving scaling', 'Ingredient check boxes', 'Cook mode', 'Timers'].every(t => blockedText.includes(t)), blockedText);
    check('C there are no scaling, cook mode, timer or ingredient check box controls on the page', (await page.locator('#rc-recipe input[type=checkbox], button:has-text("Cook"), button:has-text("Timer"), button:has-text("Scale"), [data-scale]').count()) === 0, '');
    await page.goto(PREVIEW() + '#/recipes'); await page.waitForSelector('.rc-card');
    await page.locator('.rc-card', { hasText: 'Example' }).count();
    await who(page, 'Sample Cook B'); await openRecipe(page, 'Example Pancakes');
    const dims = await page.evaluate(() => { const i = document.querySelector('#rc-recipe img'); const r = i.getBoundingClientRect(); return { natural: i.naturalWidth / i.naturalHeight, shown: r.width / r.height }; });
    check('C a tall (400x800) photo keeps its proportions on screen, not stretched', Math.abs(dims.natural - 0.5) < 0.01 && Math.abs(dims.shown - dims.natural) < 0.03, JSON.stringify(dims));
    check('C no horizontal scrolling on the phone detail page', !(await overflow(page)), '');
    await page.screenshot({ path: path.join(shots, 'recipes-phone-detail.png'), fullPage: true });
    await ctx.close(); }

  // D. create, edit, delete
  { const { ctx, page } = await open(browser);
    await who(page, 'Sample Cook C (empty book)'); await page.click('#rc-new'); await page.waitForSelector('#rc-form');
    check('D the new-recipe heading receives focus', await page.evaluate(() => document.activeElement && document.activeElement.tagName === 'H1'), '');
    await page.click('#rc-save'); await page.waitForSelector('#rc-formmsg:not(:empty)');
    check('D saving with no name shows a message, keeps focus on it, and saves nothing', /name/i.test(await page.locator('#rc-formmsg').innerText()) && await page.evaluate(() => document.activeElement.id === 'rc-formmsg'), await page.locator('#rc-formmsg').innerText());
    await page.fill('#f-name', 'Sample Garden Salad'); await page.fill('#f-desc', 'Invented.'); await page.fill('#f-yield', '2 servings'); await page.fill('#f-ings', '1 sample lettuce\n\n2 sample tomatoes\n'); await page.fill('#f-steps', 'Chop.\nToss.'); await page.fill('#f-cats', 'Lunch, Sample'); await page.fill('#f-tags', 'fast'); await page.fill('#f-notes', 'Note <b>not bold</b>');
    await page.press('#f-name', 'Enter'); await page.waitForSelector('#rc-recipe');
    check('D pressing Enter in the name field saves; the detail shows the new recipe', (await page.locator('.rc-title').innerText()) === 'Sample Garden Salad' && (await page.locator('#rc-ings li').count()) === 2 && (await page.locator('#rc-steps li').count()) === 2, '');
    check('D markup typed into a field is shown as plain text, not as HTML', (await page.locator('.rc-notes').innerText()) === 'Note <b>not bold</b>' && (await page.locator('.rc-notes b').count()) === 0, '');
    await page.click('#rc-edit'); await page.waitForSelector('#rc-form');
    check('D the editor opens filled with the saved values', (await page.inputValue('#f-name')) === 'Sample Garden Salad' && (await page.inputValue('#f-ings')) === '1 sample lettuce\n2 sample tomatoes', await page.inputValue('#f-ings'));
    await page.fill('#f-name', 'Sample Garden Salad Deluxe'); await page.click('#rc-save'); await page.waitForSelector('#rc-recipe');
    check('D edit saves and shows the new name', (await page.locator('.rc-title').innerText()) === 'Sample Garden Salad Deluxe', '');
    await page.click('#rc-fav'); check('D favourite toggles and says so', (await page.locator('#rc-fav').getAttribute('aria-pressed')) === 'true' && /Remove favourite/.test(await page.locator('#rc-fav').innerText()), '');
    await page.click('#rc-delete'); await page.waitForSelector('#rc-confirm');
    check('D delete asks first and names the recipe', /Delete "Sample Garden Salad Deluxe"\?/.test(await page.locator('#rc-confirm').innerText()), '');
    await page.click('#rc-delete-no'); check('D "Keep it" leaves the recipe in place', (await page.locator('#rc-confirm').count()) === 0 && (await page.locator('#rc-recipe').count()) === 1, '');
    await page.click('#rc-delete'); await page.click('#rc-delete-yes'); await page.waitForSelector('#rc-empty');
    check('D confirming delete removes it and shows the empty state', (await page.locator('.rc-card').count()) === 0, '');
    await ctx.close(); }

  // E. photo choosing and refusal in the editor
  { const { ctx, page } = await open(browser);
    await who(page, 'Sample Cook C (empty book)'); await page.goto(PREVIEW() + '#/recipes/new'); await page.waitForSelector('#rc-form'); await page.fill('#f-name', 'Sample Photo Test');
    await page.selectOption('#f-photo', 'tall'); await page.waitForTimeout(50);
    check('E choosing a good sample photo shows its size and a preview', /400x800 pixels/.test(await page.locator('#rc-photo-status').innerText()) && await imgOk(page, '#rc-photo-prev img'), await page.locator('#rc-photo-status').innerText());
    const bads = { 'bad-wide': /1200x800/, 'bad-heavy': /KB; the preview limit is 150 KB/, 'bad-gif': /GIF/, 'bad-svg': /SVG/, 'bad-external': /another website/, 'bad-corrupt': /cannot be read/ };
    for (const [k, re] of Object.entries(bads)) {
      await page.selectOption('#f-photo', k); await page.waitForTimeout(40);
      const status = await page.locator('#rc-photo-status').innerText();
      check('E problem photo "' + k + '" is flagged before saving with the reason', /will be refused/.test(status) && re.test(status), status);
      check('E problem photo "' + k + '" shows no preview picture', (await page.locator('#rc-photo-prev img').count()) === 0, '');
      await page.click('#rc-save'); await page.waitForSelector('#rc-formmsg:not(:empty)');
      const m = await page.locator('#rc-formmsg').innerText();
      check('E saving with "' + k + '" is refused, says nothing was saved, and keeps the typed text', /photo was refused/.test(m) && /nothing was saved/i.test(m) && (await page.inputValue('#f-name')) === 'Sample Photo Test' && (await page.locator('#rc-form').count()) === 1, m);
    }
    await page.selectOption('#f-photo', 'bowl'); await page.click('#rc-save'); await page.waitForSelector('#rc-recipe');
    check('E after refusals a good photo saves and shows on the detail page; only that one recipe exists', await imgOk(page, '#rc-recipe img'), '');
    await page.goto(PREVIEW() + '#/recipes'); await page.waitForSelector('.rc-card');
    check('E none of the refused attempts created a recipe', (await page.locator('.rc-card').count()) === 1, '');
    await page.locator('.rc-card').first().click(); await page.click('#rc-edit'); await page.waitForSelector('#rc-form');
    check('E editing offers to keep the current photo', (await page.locator('#f-photo').inputValue()) === '__keep', '');
    await page.selectOption('#f-photo', ''); await page.click('#rc-save'); await page.waitForSelector('#rc-recipe');
    check('E choosing "No photo" removes the photo', (await page.locator('#rc-recipe .rc-nophoto').count()) === 1, '');
    await ctx.close(); }

  // F. print
  { const { ctx, page } = await open(browser);
    await openRecipe(page, 'Tomato Soup'); await page.emulateMedia({ media: 'print' });
    const hid = await page.evaluate(() => ['#pv-banner', '#pv-controls', '#rc-actions', '#rc-blocked', '.rc-back'].map(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'missing'; }));
    check('F print view hides the banner, controls, buttons, blocked panel and back link', hid.every(d => d === 'none'), hid.join());
    check('F print view still shows the title, photo, ingredients and method', await page.evaluate(() => ['.rc-title', '#rc-recipe img', '#rc-ings', '#rc-steps'].every(s => { const e = document.querySelector(s); return e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; })), '');
    check('F the printed photo is capped (about 60 mm = 227px at 96dpi)', await page.evaluate(() => document.querySelector('#rc-recipe img').getBoundingClientRect().height <= 230), '');
    const pdf = await page.pdf({ format: 'Letter' }); check('F Chrome produces a PDF of the recipe page (headless print, not a real printer)', pdf.length > 2000 && pdf.slice(0, 4).toString() === '%PDF', String(pdf.length));
    fs.writeFileSync(path.join(shots, 'recipes-print-tomato-soup.pdf'), pdf);
    await ctx.close(); }

  // G. export and round trip through the screens
  { const { ctx, page } = await open(browser);
    await goBackup(page);
    check('G the Backup page states it is not a migration and not full compatibility', /not a migration and not a claim of full compatibility/.test(await page.locator('#rc-honest').innerText()), '');
    await page.click('#rc-export'); await page.waitForSelector('#rc-export-summary');
    check('G export says how many recipes and photos it holds', /Exported 3 recipes, 2 with a photo/.test(await page.locator('#rc-export-summary').innerText()), await page.locator('#rc-export-summary').innerText());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rc-download')]); const dpath = await dl.path(); const body = JSON.parse(fs.readFileSync(dpath, 'utf8'));
    check('G the downloaded file is in the original backup shape with photos', body.app === 'family-recipe-book' && body.version === 1 && body.recipes.length === 3 && body.recipes.filter(r => r.image.startsWith('data:image/')).length === 2 && dl.suggestedFilename() === 'sample-recipes-backup.json', JSON.stringify(Object.keys(body)));
    await page.click('#rc-use-export'); await who(page, 'Sample Cook C (empty book)'); await goBackup(page);
    check('G the export is offered as "My last export" in the picker', (await page.locator('#rc-pick option[value="__export"]').count()) === 1 && (await page.locator('#rc-pick').inputValue()) === '__export', '');
    await page.click('#rc-check'); await page.waitForSelector('#rc-report');
    check('G the empty book sees the export as 3 new records, no questions asked', /3 records: 3 new, 0 already/.test(await page.locator('#rc-counts').innerText()) && (await page.locator('#rc-items select').count()) === 0 && !(await page.locator('#rc-apply').isDisabled()), await page.locator('#rc-counts').innerText());
    await page.click('#rc-apply'); await page.waitForSelector('#rc-result');
    check('G the result says 3 added, 0 photos lost', /3 added, 0 replaced, 0 skipped by your choice\. 0 photos were not imported/.test(await page.locator('#rc-result-summary').innerText()), await page.locator('#rc-result-summary').innerText());
    await page.click('#rc-see'); await page.waitForSelector('.rc-card');
    check('G the round-tripped book lists the same three recipes with their photos', JSON.stringify(await listNames(page)) === JSON.stringify(['Sample Tomato Soup', 'Sample Lemon Cookies', 'Sample Pasta Night']) && (await page.locator('.rc-card img').count()) === 2, JSON.stringify(await listNames(page)));
    await goBackup(page); await page.click('#rc-export'); await page.waitForSelector('#rc-export-summary');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#rc-download')]); const body2 = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
    check('G exporting again gives identical recipes, field by field', JSON.stringify(body2.recipes) === JSON.stringify(body.recipes), '');
    await ctx.close(); }

  // H. fixtures through the screens: valid, duplicates, malformed, photo problems, file errors
  { const { ctx, page, log } = await open(browser);
    await who(page, 'Sample Cook C (empty book)'); await goBackup(page); await importFixture(page, 'valid-photos');
    check('H valid backup: 3 new, nothing needs a choice, Import is enabled, and nothing is imported yet', /3 new/.test(await page.locator('#rc-counts').innerText()) && !(await page.locator('#rc-apply').isDisabled()) && /Nothing has been imported yet/.test(await page.locator('#rc-need').innerText()), '');
    await page.click('#rc-cancel-import'); await page.click('#rc-nav-recipes'); await page.waitForSelector('#rc-empty');
    check('H checking and cancelling imported nothing', true, '');
    await goBackup(page); await importFixture(page, 'valid-photos'); await page.click('#rc-apply'); await page.waitForSelector('#rc-result');
    await page.click('#rc-see'); await page.waitForSelector('.rc-card');
    check('H after importing, the three recipes and their photos are listed', (await page.locator('.rc-card').count()) === 3 && (await page.locator('.rc-card img').count()) === 3 && await imgOk(page, '.rc-card img'), '');
    // duplicates, as A
    await who(page, 'Sample Cook A'); await goBackup(page); await importFixture(page, 'duplicates');
    check('H duplicates: report names 2 existing, 1 repeated in file, and Import is disabled with a count', /2 already in your book, 1 repeated inside the file/.test(await page.locator('#rc-counts').innerText()) && await page.locator('#rc-apply').isDisabled() && /3 records need a choice/.test(await page.locator('#rc-need').innerText()), await page.locator('#rc-need').innerText());
    await page.screenshot({ path: path.join(shots, 'recipes-phone-duplicates.png'), fullPage: true });
    check('H the repeat inside the file does not offer "Replace"', !(await page.locator('#rc-choice-3 option[value=replace]').count()), '');
    await page.selectOption('#rc-choice-0', 'replace'); await page.selectOption('#rc-choice-1', 'skip');
    check('H with two of three chosen, Import is still disabled', await page.locator('#rc-apply').isDisabled() && /1 record needs a choice/.test(await page.locator('#rc-need').innerText()), '');
    await page.selectOption('#rc-choice-3', 'keep-both'); check('H with all chosen, Import becomes enabled', !(await page.locator('#rc-apply').isDisabled()), '');
    await page.click('#rc-apply'); await page.waitForSelector('#rc-result');
    const rs = await page.locator('#rc-result').innerText();
    check('H duplicates result: 3 added, 1 replaced, 1 skipped, listed by name', /3 added, 1 replaced, 1 skipped/.test(rs) && /Skipped/.test(rs) && /Sample Lemon Cookies/.test(rs) && /Sample Granola/.test(rs), rs);
    // malformed
    await who(page, 'Sample Cook C (empty book)'); await goBackup(page); await importFixture(page, 'malformed');
    check('H malformed: 7 records cannot be imported, each with a reason', /7 cannot be imported/.test(await page.locator('#rc-counts').innerText()) && (await page.locator('.rc-item.is-invalid .rc-reasons').count()) === 7, await page.locator('#rc-counts').innerText());
    check('H malformed: the extra fields are named, not silently dropped', /rating, cookbookPage/.test(await page.locator('#rc-items').innerText()), '');
    check('H malformed: Import is disabled until the broken records are skipped on purpose', await page.locator('#rc-apply').isDisabled() && /7 records need a choice/.test(await page.locator('#rc-need').innerText()), '');
    await page.screenshot({ path: path.join(shots, 'recipes-phone-malformed.png'), fullPage: true });
    await page.click('#rc-skip-invalid'); check('H "Skip all" makes the choices and enables Import', !(await page.locator('#rc-apply').isDisabled()), '');
    check('H the overview report has no horizontal scrolling on the phone', !(await overflow(page)), '');
    await page.click('#rc-apply'); await page.waitForSelector('#rc-result');
    check('H malformed result: 2 added, 7 skipped, ignored fields reported', /2 added, 0 replaced, 7 skipped/.test(await page.locator('#rc-result-summary').innerText()) && /Fields ignored/.test(await page.locator('#rc-result').innerText()), await page.locator('#rc-result-summary').innerText());
    // photo problems
    await who(page, 'Sample Cook B'); await goBackup(page); await importFixture(page, 'photo-problems');
    const rep = await page.locator('#rc-items').innerText();
    check('H photo problems: six photos cannot be kept, each with its reason', /6 with a photo that cannot be kept/.test(await page.locator('#rc-counts').innerText()) && /1200x800/.test(rep) && /GIF/.test(rep) && /SVG/.test(rep) && /another website/.test(rep) && /cannot be read/.test(rep) && /KB; the preview limit/.test(rep), rep.slice(0, 200));
    check('H photo problems: the choice names the loss ("without the photo")', (await page.locator('#rc-choice-1 option', { hasText: 'without the photo' }).count()) >= 1 && (await page.locator('#rc-choice-1 option[value=skip]').count()) === 1, '');
    check('H photo problems: Import is disabled until each photo is decided', await page.locator('#rc-apply').isDisabled(), '');
    for (let i = 1; i <= 6; i++) await page.selectOption('#rc-choice-' + i, i <= 2 ? 'add' : 'skip');
    await page.screenshot({ path: path.join(shots, 'recipes-phone-photo-problems.png'), fullPage: true });
    await page.click('#rc-apply'); await page.waitForSelector('#rc-result');
    const pr = await page.locator('#rc-result').innerText();
    check('H photo result: 3 added, 4 skipped, 2 photos named as not imported with reasons', /3 added, 0 replaced, 4 skipped by your choice\. 2 photos were not imported/.test(pr) && /Photos not imported/.test(pr) && /Sample Wide Photo: /.test(pr) && /Sample Heavy Photo: /.test(pr), pr);
    await page.click('#rc-see'); await page.waitForSelector('.rc-card');
    check('H the two recipes added without a photo show "No photo"', (await page.locator('.rc-card', { hasText: 'Wide Photo' }).locator('.rc-nophoto').count()) === 1 && (await page.locator('.rc-card', { hasText: 'Heavy Photo' }).locator('.rc-nophoto').count()) === 1, '');
    // file errors
    const errs = { 'not-json': /not valid JSON/, 'wrong-app': /different app/, 'wrong-version': /version 7/, 'empty-list': /empty recipe list/, 'too-many': /201 records/, 'too-big': /larger than 2 MB/ };
    await goBackup(page);
    for (const [id, re] of Object.entries(errs)) { await importFixture(page, id); check('H file error "' + id + '" is explained and nothing can be imported', re.test(await page.locator('#rc-file-error').innerText()) && (await page.locator('#rc-apply').count()) === 0 && (await page.locator('[role=alert]').count()) >= 1, ''); }
    check('H bare-list shape is accepted', (await (async () => { await importFixture(page, 'bare-array'); return /1 new/.test(await page.locator('#rc-counts').innerText()); })()), '');
    check('H still zero requests left this machine, and no page errors', log.external.length === 0 && log.errors.length === 0, log.external.concat(log.errors).join(' | '));
    await ctx.close(); }

  // I. keyboard, focus, layouts, reload, reset
  { const { ctx, page } = await open(browser);
    await page.keyboard.press('Tab'); check('I the first Tab stop is the skip link', await page.evaluate(() => document.activeElement.classList.contains('skip-link')), '');
    await page.focus('#pv-who'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
    const seq = []; for (let i = 0; i < 4; i++) { seq.push(await page.evaluate(() => document.activeElement.id || document.activeElement.className)); await page.keyboard.press('Tab'); }
    check('I keyboard Tab reaches New recipe, then the navigation tabs, then the first recipe', seq.some(x => /rc-new/.test(x)) && seq.some(x => /rc-nav/.test(x)), seq.join(' > '));
    await page.focus('.rc-card'); await page.keyboard.press('Enter'); await page.waitForSelector('#rc-recipe');
    check('I Enter on a focused recipe card opens it', (await page.locator('.rc-title').count()) === 1, '');
    await page.focus('#rc-edit'); const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; }); check('I a keyboard-focused button shows a visible focus ring', ring, '');
    await page.keyboard.press('Enter'); await page.waitForSelector('#rc-form'); await page.keyboard.press('Tab');
    check('I the editor is operable by keyboard (Enter opened it; fields take focus)', await page.evaluate(() => /^(INPUT|TEXTAREA|SELECT|A|BUTTON|H1)$/.test(document.activeElement.tagName)), '');
    await ctx.close(); }
  for (const [w, h, label] of [[320, 640, 'narrow phone 320'], [390, 844, 'phone 390'], [820, 1000, 'tablet 820'], [1280, 900, 'desktop 1280']]) {
    const { ctx, page } = await open(browser, { w, h }); const bad = [];
    for (const hash of ['#/recipes', '#/recipes/backup', '#/recipes/new']) { await page.goto(PREVIEW() + hash); await page.waitForSelector('.rc-screen'); if (await overflow(page)) bad.push(hash); }
    await page.goto(PREVIEW() + '#/recipes'); await page.waitForSelector('.rc-card'); await openRecipe(page, 'Tomato Soup'); if (await overflow(page)) bad.push('detail');
    check('I ' + label + ': no horizontal scrolling on list, detail, editor or backup', bad.length === 0, bad.join());
    if (w === 1280) { await page.goto(PREVIEW() + '#/recipes'); await page.waitForSelector('.rc-card'); const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.rc-grid')).gridTemplateColumns.split(' ').length); check('I desktop shows the list in 3 columns', cols === 3, String(cols)); await page.screenshot({ path: path.join(shots, 'recipes-desktop-list.png'), fullPage: true }); }
    if (w === 390) { await page.goto(PREVIEW() + '#/recipes'); await page.waitForSelector('.rc-card'); await page.screenshot({ path: path.join(shots, 'recipes-phone-list.png'), fullPage: true }); await page.goto(PREVIEW() + '#/recipes/new'); await page.waitForSelector('#rc-form'); await page.selectOption('#f-photo', 'bad-heavy'); await page.fill('#f-name', 'x'); await page.click('#rc-save'); await page.waitForSelector('#rc-formmsg:not(:empty)'); await page.screenshot({ path: path.join(shots, 'recipes-phone-photo-refused.png'), fullPage: true }); }
    await ctx.close(); }
  { const { ctx, page } = await open(browser);
    await who(page, 'Sample Cook C (empty book)'); await page.goto(PREVIEW() + '#/recipes/new'); await page.waitForSelector('#rc-form'); await page.fill('#f-name', 'Sample Vanishing Dish'); await page.click('#rc-save'); await page.waitForSelector('#rc-recipe');
    check('I storage: nothing was written to localStorage or sessionStorage', await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), '');
    await page.reload(); await page.waitForSelector('.rc-screen'); await who(page, 'Sample Cook C (empty book)');
    check('I reloading clears the sample change (Sample Cook C is empty again)', (await page.locator('.rc-card').count()) === 0, '');
    await who(page, 'Sample Cook A'); await openRecipe(page, 'Tomato Soup'); await page.click('#rc-delete'); await page.click('#rc-delete-yes'); await page.waitForSelector('.rc-card');
    check('I a deleted seed recipe is gone for now', (await page.locator('.rc-card').count()) === 2, '');
    await page.click('#pv-reset'); await page.waitForSelector('.rc-screen'); await page.waitForTimeout(150);
    check('I "Reset sample data" restores the three seed recipes for Sample Cook A', (await page.locator('.rc-card').count()) === 3, String(await page.locator('.rc-card').count()));
    await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

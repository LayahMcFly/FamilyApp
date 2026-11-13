/* Browser tests for tree name changes (class B evidence: real Chrome, real app code, FAKE Appwrite backend and a fake function).
 * Run:  cd tests/browser && node tree-rename.spec.js
 * Proves screens and the requests the app sends. It does NOT prove anything about the live Appwrite project or the deployed function. */
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
const OUT = process.env.SHOTS || path.join(__dirname, 'screenshots');
let pass = 0, fail = 0; const results = [];
function check(name, ok, detail) { (ok ? pass++ : fail++); results.push((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); }
const me = id => ({ $id: id, name: id, email: id + '@example.com', emailVerification: true, prefs: {} });
const prof = (uid, name, extra) => Object.assign({ $id: 'p' + uid, userId: uid, familyId: 'famA', displayName: name, bio: '', about: '[]', $createdAt: '2026-01-01' }, extra || {});
const person = (id, name, o) => Object.assign({ $id: id, familyId: 'famA', name, parentIds: [], partnerIds: [], $createdAt: '2026-01-01' }, o || {});
const year = new Date().getUTCFullYear();
function world(who, role, extra) {   // who: the signed-in user id; role: owner or member
  return Object.assign({ signedIn: true, user: me(who), families: [{ id: 'famA', name: 'Alpha Family', role }], canCreateFamily: false,
    tables: {
      profiles: [prof('u-admin', 'Bob Admin', { treeAdmin: true }), prof('u-owner', 'Alice Owner'), prof('u-cara', 'Cara Smith'), prof('u-teen', 'Tee Smith'), prof('u-dan', 'Dan Smith')],
      people: [
        person('pc', 'Cara Smith', { userId: 'u-cara', confirmed: true, birthday: '1985-04-02' }),         // adult, confirmed
        person('pt', 'Tee Smith', { userId: 'u-teen', confirmed: true, birthday: (year - 10) + '-06-30' }), // child, confirmed
        person('pd', 'Dan Smith', { userId: 'u-dan', confirmed: true }),                                    // no birthday
        person('pg', 'Grandma Rose', { birthday: '1950-01-01' })                                            // no account
      ], posts: [], nameRequests: [] } }, extra || {});
}
let PORT;
async function open(browser, mock, hash, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w || 390, height: h || 900 } }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/appwrite/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE }));
  await page.addInitScript(m => { window.__MOCK = m; }, mock);
  await page.goto('http://127.0.0.1:' + PORT + SUB + hash); await page.waitForSelector('main[data-view]', { timeout: 8000 });
  return { ctx, page, errors };
}
// Functions cannot be passed into the page, so the fake function replies are installed inside it. window.__calls records what the app sent.
const install = (page, replies) => page.evaluate(r => { window.__calls = []; window.__MOCK.api = {}; Object.keys(r).forEach(a => { window.__MOCK.api[a] = b => { window.__calls.push(Object.assign({ action: a }, b)); return r[a]; }; }); }, replies);
const calls = page => page.evaluate(() => window.__calls);
const sent = page => page.evaluate(() => window.__MOCK.log.filter(l => /^api tree/.test(l)));
async function openEdit(page, personName) {
  await page.waitForSelector('button[aria-label="Edit ' + personName + '"]', { timeout: 8000 });
  await page.click('button[aria-label="Edit ' + personName + '"]'); await page.waitForSelector('dialog[open]');
}
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port; fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });

  // 1. owner: the name field is open on a confirmed adult, and the hint says it changes right away
  { const mock = world('u-owner', 'owner');
    const { ctx, page, errors } = await open(browser, mock, '#/settings/tree'); await install(page, { treeEditPerson: {} });
    await openEdit(page, 'Cara Smith');
    const st = await page.evaluate(() => ({ nameOff: document.querySelector('#pname').disabled, bdOff: document.querySelector('#pbday').disabled, gdOff: document.querySelector('#pgender').disabled, hint: document.querySelector('dialog .hint') && [...document.querySelectorAll('dialog .hint')].map(e => e.textContent).join(' | ') }));
    check('owner: name is editable on a confirmed adult; birthday and gender stay locked', !st.nameOff && st.bdOff && st.gdOff, JSON.stringify(st));
    check('owner: hint says the change is immediate', /changes right away/.test(st.hint) && /gender and birthday/.test(st.hint), st.hint);
    await page.fill('#pname', 'Cara Jones'); await page.click('dialog button:has-text("Save")'); await page.waitForTimeout(500);
    check('owner: saves with a plain "Saved." (no request wording)', (await page.locator('.toast, [role=status]').allInnerTexts()).join(' ').includes('Saved.') && (c1 => c1.length === 1 && c1[0].name === 'Cara Jones' && !('birthday' in c1[0]) && !('gender' in c1[0]))(await calls(page)), JSON.stringify(await calls(page)));
    check('owner: no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // 2. tree admin (not owner) editing an ADULT: hint says approval is asked; save reports the request
  { const mock = world('u-admin', 'member');
    const { ctx, page, errors } = await open(browser, mock, '#/settings/tree'); await install(page, { treeEditPerson: { pendingName: { requestId: 'r1', to: 'Cara Jones' } } });
    await openEdit(page, 'Cara Smith');
    const st = await page.evaluate(() => ({ nameOff: document.querySelector('#pname').disabled, hint: [...document.querySelectorAll('dialog .hint')].map(e => e.textContent).join(' | ') }));
    check('tree admin + adult: name is editable and the hint says Cara is asked to approve; the name stays until they accept', !st.nameOff && /asked to approve/.test(st.hint) && /stays the same until they accept/.test(st.hint), JSON.stringify(st));
    await page.screenshot({ path: path.join(OUT, 'rename-admin-dialog.png') });
    await page.fill('#pname', 'Cara Jones'); await page.click('dialog button:has-text("Save")'); await page.waitForTimeout(500);
    const t = (await page.locator('.toast, [role=status]').allInnerTexts()).join(' ');
    check('tree admin + adult: after saving, the message says a request was sent and the name stays until they accept', /Request sent/.test(t) && /stays the same until they accept/.test(t), t);
    check('tree admin: no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }

  // 3. tree admin editing a CHILD and an entry with NO birthday: direct change, no approval wording
  for (const [who, label] of [['Tee Smith', 'a child'], ['Dan Smith', 'no birthday']]) {
    const mock = world('u-admin', 'member');
    const { ctx, page } = await open(browser, mock, '#/settings/tree'); await openEdit(page, who);
    const st = await page.evaluate(() => ({ nameOff: document.querySelector('#pname').disabled, hint: [...document.querySelectorAll('dialog .hint')].map(e => e.textContent).join(' | ') }));
    check(`tree admin + ${label}: name editable, hint says it changes right away, no approval wording`, !st.nameOff && /changes right away/.test(st.hint) && !/approve/.test(st.hint), JSON.stringify(st));
    await ctx.close(); }

  // 4. an entry with no account: no locked hint at all
  { const mock = world('u-admin', 'member'); const { ctx, page } = await open(browser, mock, '#/settings/tree'); await openEdit(page, 'Grandma Rose');
    const st = await page.evaluate(() => ({ nameOff: document.querySelector('#pname').disabled, hint: [...document.querySelectorAll('dialog .hint')].map(e => e.textContent).join(' | ') }));
    check('entry with no account: name editable, no "their account" hint', !st.nameOff && !/their account/.test(st.hint), JSON.stringify(st)); await ctx.close(); }

  // 5. Activity for the ADULT: request with Accept and Decline, badge counts it, Accept sends the right call
  const req = { $id: 'r1', familyId: 'famA', personId: 'pc', proposerId: 'u-admin', targetUserId: 'u-cara', oldName: 'Cara Smith', newName: 'Cara Jones', status: 'open', $createdAt: new Date(Date.now() - 3600e3).toISOString() };
  { const mock = world('u-cara', 'member', { tables: Object.assign(world('x', 'member').tables, { nameRequests: [req] }) });
    mock.user.prefs = { notifSeen: new Date().toISOString() };    // everything else already seen: only the request should count
    const { ctx, page, errors } = await open(browser, mock, '#/home');
    await page.waitForTimeout(800);
    const badge = await page.evaluate(() => { const b = document.getElementById('bell-badge'); return b && !b.hidden ? b.textContent : ''; });
    check('adult: the bell shows 1 for a name change waiting for an answer, even though everything else is "seen"', badge === '1', 'badge=' + badge);
    await page.goto('http://127.0.0.1:' + PORT + SUB + '#/activity'); await page.waitForSelector('.act-name'); await install(page, { treeNameRespond: { status: 'accepted' } });
    const txt = await page.locator('.act-name').innerText();
    check('adult: Activity says who wants to change which name to what', /Bob Admin wants to change your name in the family tree from .Cara Smith. to .Cara Jones./.test(txt), txt);
    check('adult: Accept and Decline buttons have clear names', (await page.locator('button[aria-label="Accept the new name Cara Jones"]').count()) === 1 && (await page.locator('button[aria-label="Decline the new name Cara Jones"]').count()) === 1, '');
    const stillBadge = await page.evaluate(() => { const b = document.getElementById('bell-badge'); return b && !b.hidden ? b.textContent : ''; });
    check('adult: opening Activity does not clear the badge while a request is waiting', stillBadge === '1', 'badge=' + stillBadge);
    await page.screenshot({ path: path.join(OUT, 'rename-activity-adult-phone.png') });
    await page.click('button[aria-label="Accept the new name Cara Jones"]'); await page.waitForTimeout(600);
    const cc = (await calls(page)).map(c => { const o = Object.assign({}, c); delete o.jwt; return o; });
    check('adult: Accept sends treeNameRespond with accept=true for that request only', cc.length === 1 && cc[0].accept === true && cc[0].requestId === 'r1' && cc[0].familyId === 'famA' && Object.keys(cc[0]).sort().join() === 'accept,action,familyId,requestId', JSON.stringify(cc));
    check('adult: the request disappears after answering', (await page.locator('.act-name').count()) === 0, '');
    check('adult: no page errors', errors.length === 0, errors.join('|')); await ctx.close(); }
  { const mock = world('u-cara', 'member', { tables: Object.assign(world('x', 'member').tables, { nameRequests: [req] }) });
    const { ctx, page } = await open(browser, mock, '#/activity'); await page.waitForSelector('.act-name'); await install(page, { treeNameRespond: {} });
    await page.click('button[aria-label="Decline the new name Cara Jones"]'); await page.waitForTimeout(500);
    check('adult: Decline sends accept=false', (c2 => c2.length === 1 && c2[0].accept === false)(await calls(page)), JSON.stringify(await calls(page))); await ctx.close(); }
  { const mock = world('u-cara', 'member', { tables: Object.assign(world('x', 'member').tables, { nameRequests: [req] }) });
    const { ctx, page } = await open(browser, mock, '#/activity'); await page.waitForSelector('.act-name'); await install(page, { treeNameRespond: { __deny: 'That name change has already been answered or replaced.', __code: 409, __error: 'closed' } });
    await page.click('button[aria-label="Accept the new name Cara Jones"]'); await page.waitForTimeout(500);
    check('adult: a refused answer shows the reason and keeps the request on screen', /already been answered/.test(await page.locator('.act-name').innerText()), ''); await ctx.close(); }

  // 6. Activity for the PROPOSER: waiting (with Take back) and answered
  { const answered = Object.assign({}, req, { $id: 'r2', status: 'rejected', newName: 'Cara X', $updatedAt: new Date().toISOString() });
    const mock = world('u-admin', 'member', { tables: Object.assign(world('x', 'member').tables, { nameRequests: [req, answered] }) });
    const { ctx, page } = await open(browser, mock, '#/activity'); await page.waitForSelector('.act-name'); await install(page, { treeNameCancel: {} });
    const all = await page.locator('.activity').innerText();
    check('proposer: sees "Waiting for Cara Smith to approve" and the declined result', /Waiting for Cara Smith to approve the new name .Cara Jones./.test(all) && /Cara Smith declined the new name .Cara X./.test(all), all);
    check('proposer: no Accept/Decline buttons on their own request', (await page.locator('button:has-text("Accept"), button:has-text("Decline")').count()) === 0, '');
    await page.screenshot({ path: path.join(OUT, 'rename-activity-admin-phone.png') });
    await page.click('button[aria-label="Take back the name change request for Cara Smith"]'); await page.waitForTimeout(500);
    check('proposer: Take back sends treeNameCancel', (c3 => c3.length === 1 && c3[0].requestId === 'r1' && c3[0].action === 'treeNameCancel')(await calls(page)), JSON.stringify(await calls(page))); await ctx.close(); }

  // 7. a family member who is neither side sees nothing about it; table missing does not break Activity
  { const mock = world('u-dan', 'member', { tables: Object.assign(world('x', 'member').tables, { nameRequests: [] }) });
    const { ctx, page } = await open(browser, mock, '#/activity'); await page.waitForTimeout(500);
    check('bystander: no name-change entries', (await page.locator('.act-name').count()) === 0, ''); await ctx.close(); }
  { const mock = world('u-cara', 'member'); delete mock.tables.nameRequests; mock.failRows = { 'nameRequests:famA': true };
    const { ctx, page, errors } = await open(browser, mock, '#/activity'); await page.waitForTimeout(600);
    check('table missing or failing: Activity still opens, no errors, no name entries', (await page.locator('h1:has-text("Activity")').count()) === 1 && (await page.locator('.act-name').count()) === 0 && errors.length === 0, errors.join('|')); await ctx.close(); }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

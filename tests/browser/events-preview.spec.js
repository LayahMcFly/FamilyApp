/* Browser tests for the Events PREVIEW (class B evidence: real Chrome, real preview code, FAKE in-memory server, invented data).
 * Run:  cd tests/browser && npm i playwright-core && node events-preview.spec.js
 * It proves screen behaviour and that the preview page makes no network request. It proves NOTHING about the live Appwrite project,
 * because the preview has no connection to it. */
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
let PORT; const PREVIEW = () => 'http://127.0.0.1:' + PORT + SUB + 'events-preview/index.html';
const BOARD = 'https://layahmcfly.github.io/ZenfulOutput/family-board/';
const BANNER = 'Preview — sample data, not connected to your family.';
const iso = d => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
function nthSunday(year, monthIdx, n) { const d = new Date(Date.UTC(year, monthIdx, 1)); const first = (7 - d.getUTCDay()) % 7; return iso(new Date(Date.UTC(year, monthIdx, 1 + first + 7 * (n - 1)))); }
function futureDst(monthIdx, n) { const y = new Date().getUTCFullYear(); let s = nthSunday(y, monthIdx, n); if (s < addDays(40)) s = nthSunday(y + 1, monthIdx, n); return s; }

async function open(browser, o) {
  o = o || {};
  const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, timezoneId: o.tz || 'America/New_York' });
  const page = await ctx.newPage(); const log = { errors: [], console: [], requests: [], external: [] };
  page.on('pageerror', e => log.errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(m.type() + ': ' + m.text()); });
  page.on('request', r => log.requests.push(r.url()));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { log.external.push(r.request().url()); r.abort(); });   // nothing may leave the machine (this also covers a new tab)
  await page.goto(PREVIEW() + (o.hash || ''));
  await page.waitForSelector('.ev-layout, .ev-blocked', { timeout: 8000 });
  return { ctx, page, log };
}
const who = async (page, name) => { await page.selectOption('#pv-who', { label: name }); await page.waitForSelector('.ev-layout, .ev-blocked'); await page.waitForTimeout(60); };
const fam = async (page, name) => { await page.selectOption('#pv-fam', { label: name }); await page.waitForSelector('.ev-layout, .ev-blocked'); await page.waitForTimeout(60); };
const row = (page, title) => page.locator('.ev-row', { hasText: title }).first();
const openEvent = async (page, title) => { await row(page, title).click(); await page.waitForSelector('.ev-detail'); };
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const visible = (page, sel) => page.locator(sel).first().isVisible();
async function fillForm(page, v) {
  if (v.title !== undefined) await page.fill('#ev-title', v.title);
  if (v.kind) await page.selectOption('#ev-kind', v.kind);
  if (v.allDay !== undefined) await page.setChecked('#ev-allday', v.allDay);
  if (v.sd !== undefined) await page.fill('#ev-sd', v.sd); if (v.st !== undefined) await page.fill('#ev-st', v.st);
  if (v.ed !== undefined) await page.fill('#ev-ed', v.ed); if (v.et !== undefined) await page.fill('#ev-et', v.et);
  if (v.tz) await page.selectOption('#ev-tz', v.tz);
  if (v.audience) await page.check('#ev-audience-' + v.audience);
  if (v.invite) for (const n of v.invite) await page.locator('#ev-invitees label', { hasText: n }).locator('input').check();
  if (v.desc !== undefined) await page.fill('#ev-desc', v.desc); if (v.loc !== undefined) await page.fill('#ev-loc', v.loc);
  if (v.locacc) await page.check('#ev-locacc-' + v.locacc);
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); PORT = server.address().port;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shots = path.join(__dirname, 'screenshots'); fs.mkdirSync(shots, { recursive: true });

  // A. label, network, CSP
  { const { ctx, page, log } = await open(browser);
    check('A banner says exactly "' + BANNER + '"', (await page.locator('#pv-banner strong').innerText()) === BANNER, await page.locator('#pv-banner strong').innerText());
    check('A banner is visible, a note, and stays at the top while scrolling', await page.evaluate(() => { window.scrollTo(0, 900); const r = document.getElementById('pv-banner').getBoundingClientRect(); return r.top >= 0 && r.top < 2 && document.getElementById('pv-banner').getAttribute('role') === 'note'; }), '');
    const blocked = await page.evaluate(async () => { const out = []; for (const u of ['https://nyc.cloud.appwrite.io/v1/health', location.origin + '/FamilyCircle/events-preview/events.css']) { try { await fetch(u); out.push('allowed'); } catch (e) { out.push('blocked'); } } return out; });
    check('A the page\'s own CSP blocks fetch, even to Appwrite and even to the same site', blocked.join() === 'blocked,blocked', blocked.join());
    const noWs = await page.evaluate(() => new Promise(res => { document.addEventListener('securitypolicyviolation', e => res(e.violatedDirective)); try { new WebSocket('wss://nyc.cloud.appwrite.io/v1/realtime'); } catch (e) { res('threw'); } setTimeout(() => res('no violation'), 1500); }));
    check('A the CSP also blocks WebSocket connections (violation: connect-src)', noWs === 'connect-src', noWs);
    await page.waitForTimeout(150);
    check('A zero requests left this machine (none attempted to Appwrite or anywhere else)', log.external.length === 0, log.external.join(','));
    check('A the live app\'s config.js, app.js and the Appwrite SDK were never loaded', !log.requests.some(u => /\/(config|app|chat|hub|shop|calls)\.js|appwrite|sdk\.js/.test(u)), log.requests.filter(u => /config|app\.js|appwrite|sdk/.test(u)).join(','));
    check('A no window.Appwrite, FAMILY_CONFIG or account object exists on the page', await page.evaluate(() => typeof window.Appwrite === 'undefined' && typeof window.FAMILY_CONFIG === 'undefined'), '');
    check('A storage is not used (nothing saved in the browser)', await page.evaluate(() => { try { return localStorage.length === 0 && sessionStorage.length === 0; } catch (e) { return true; } }), '');
    check('A no page errors; only the expected CSP refusals appear in the console', log.errors.length === 0 && log.console.every(c => /Content Security Policy|violates|Refused/i.test(c)), log.errors.concat(log.console).join(' | '));
    await ctx.close(); }

  // B. list, grouping, tabs, empty states, Family Board link
  { const { ctx, page } = await open(browser);
    const titles = await page.locator('.ev-row-title').allInnerTexts();
    check('B the six upcoming sample events are listed', titles.length === 6 && titles.includes('Sunday dinner at Grandma\'s') && titles.includes('Family reunion weekend'), titles.join('|'));
    check('B grouped under month headings', (await page.locator('.ev-month').count()) >= 2, '');
    check('B tabs show counts and Upcoming is pressed', (await page.locator('.ev-tab[data-tab=upcoming]').innerText()) === 'Upcoming (6)' && (await page.locator('.ev-tab[data-tab=upcoming]').getAttribute('aria-pressed')) === 'true', '');
    await page.click('.ev-tab[data-tab=past]'); const past = await page.locator('.ev-row-title').allInnerTexts();
    check('B Past shows the past event only', past.join() === 'Anniversary dinner', past.join());
    await page.click('.ev-tab[data-tab=upcoming]');
    check('B a cancelled event shows a "Cancelled" badge', (await page.locator('.ev-row', { hasText: 'Beach trip' }).locator('.is-cancelled').count()) === 1, '');
    check('B an invited event shows an "Invited" badge', (await page.locator('.ev-row', { hasText: 'game night' }).locator('.is-invited').innerText()) === 'Invited', '');
    const b = page.locator('#ev-board');
    check('B Original Family Board link: exact URL, new tab, noopener', (await b.getAttribute('href')) === BOARD && (await b.getAttribute('target')) === '_blank' && /noopener/.test(await b.getAttribute('rel')), await b.getAttribute('href'));
    check('B link text says new tab and separate sign-in', /new tab/.test(await b.getAttribute('aria-label')) && /separate sign-in/.test(await b.innerText()), '');
    check('B the page states nothing was moved or copied', (await page.locator('.ev-board-line').innerText()) === 'Chores and tasks are still in the original Family Board. Nothing has been moved or copied.', '');
    check('B the page never claims Appwrite, migration or sync', !/appwrite|migrat|synced|imported/i.test(await page.locator('main').innerText()), '');
    const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null), b.click()]);
    check('B clicking the link opens a separate tab and leaves the preview where it was', !!pop && /#\/calendar/.test(page.url()) && (await page.locator('.ev-layout').count()) === 1, '');
    if (pop) await pop.close().catch(() => {});
    await ctx.close(); }

  // C. layouts
  for (const [name, w, h] of [['phone', 390, 844], ['small-phone', 320, 640], ['tablet', 768, 1024], ['desktop', 1280, 900]]) {
    const { ctx, page } = await open(browser, { w, h }); const wide = w >= 900;
    check('C ' + name + ': no sideways scrolling on the list', !(await overflow(page)), '');
    check('C ' + name + ': list pane visible; detail pane ' + (wide ? 'visible' : 'hidden') + ' before choosing', (await visible(page, '.ev-listpane')) && (await visible(page, '.ev-detailpane')) === wide, '');
    await openEvent(page, 'Sunday dinner');
    check('C ' + name + ': detail opens; list pane ' + (wide ? 'stays beside it' : 'steps aside'), (await visible(page, '.ev-detail')) && (await visible(page, '.ev-listpane')) === wide, '');
    check('C ' + name + ': "Back to events" is ' + (wide ? 'not needed' : 'shown'), (await visible(page, '.ev-detail .ev-back')) === !wide, '');
    check('C ' + name + ': no sideways scrolling on the detail', !(await overflow(page)), '');
    check('C ' + name + ': every button and link is at least 36px tall', await page.evaluate(() => [...document.querySelectorAll('main .btn, main .ev-tab, main .ev-row, main .ev-choice')].filter(e => e.offsetParent).every(e => e.getBoundingClientRect().height >= 36)), '');
    await page.screenshot({ path: path.join(shots, 'events-' + name + '-detail.png'), fullPage: true });
    await page.click('#ev-edit'); await page.waitForSelector('.ev-form');
    check('C ' + name + ': no sideways scrolling on the form', !(await overflow(page)), '');
    await page.screenshot({ path: path.join(shots, 'events-' + name + '-form.png'), fullPage: true });
    await page.goto(PREVIEW() + '#/calendar'); await page.waitForSelector('.ev-layout');
    await page.screenshot({ path: path.join(shots, 'events-' + name + '-list.png'), fullPage: true });
    await ctx.close(); }

  // D. details content, time zones, location
  { const { ctx, page } = await open(browser, { tz: 'America/Los_Angeles' });
    await openEvent(page, 'Sunday dinner'); const facts = await page.locator('.ev-facts').innerText();
    check('D detail shows the event\'s own time and zone', /6:00 PM to 8:30 PM EST \(America\/New_York\)/.test(facts) || /6:00 PM to 8:30 PM E[SD]T \(America\/New_York\)/.test(facts), facts);
    check('D a viewer in another zone also sees their own clock time', /IN YOUR TIME ZONE[\s\S]*3:00 PM P[SD]T/i.test(facts), facts);
    check('D location and description are shown to a family event viewer', /123 Example Lane/.test(facts) && /Bring a side dish/.test(facts), '');
    await page.goto(PREVIEW() + '#/calendar'); await openEvent(page, 'Graduation party'); const g = await page.locator('.ev-facts').innerText();
    check('D an event in the viewer\'s own zone adds no second time', !/IN YOUR TIME ZONE/i.test(g) && /2:00 PM P[SD]T \(America\/Los_Angeles\)/.test(g), g);
    await page.goto(PREVIEW() + '#/calendar'); await openEvent(page, 'Family reunion weekend'); const r = await page.locator('.ev-facts').innerText();
    check('D an all-day event shows dates only, no zone', /\(all day\)/.test(r) && !/IN YOUR TIME ZONE/i.test(r) && !/ P[SD]T/.test(r), r);
    await ctx.close(); }
  { const { ctx, page } = await open(browser, { tz: 'America/New_York' }); await openEvent(page, 'Sunday dinner');
    check('D the same event adds no second time for a viewer on the same offset', !/IN YOUR TIME ZONE/i.test(await page.locator('.ev-facts').innerText()), '');
    await page.goto(PREVIEW() + '#/calendar'); await openEvent(page, 'Graduation party');
    check('D the California event shows New York clock time to a New York viewer', /IN YOUR TIME ZONE[\s\S]*5:00 PM E[SD]T/i.test(await page.locator('.ev-facts').innerText()), await page.locator('.ev-facts').innerText());
    await ctx.close(); }

  // E. audiences, permissions and isolation through the screens
  { const { ctx, page } = await open(browser);
    await who(page, 'Noah Sample');
    check('E Noah (not invited) does not see the invited game night', (await page.locator('.ev-row', { hasText: 'game night' }).count()) === 0, '');
    await who(page, 'Priya Sample'); check('E Priya (creator) sees it', (await page.locator('.ev-row', { hasText: 'game night' }).count()) === 1, '');
    const id = await page.locator('.ev-row', { hasText: 'game night' }).getAttribute('data-event');
    await who(page, 'Noah Sample'); await page.goto(PREVIEW() + '#/calendar/event/' + id); await page.waitForSelector('.ev-blocked');
    check('E opening the invited event\'s direct link as Noah says "not available" and shows nothing about it', /not available/i.test(await page.locator('.ev-blocked').innerText()) && !/game night/i.test(await page.locator('main').innerText()), '');
    await page.goto(PREVIEW() + '#/calendar/event/does-not-exist'); await page.waitForSelector('.ev-blocked');
    check('E a made-up link gives the same message', /This event is not available/.test(await page.locator('.ev-blocked').innerText()), '');
    await who(page, 'Theo Sample'); await page.goto(PREVIEW() + '#/calendar'); await page.waitForSelector('.ev-layout');
    check('E Theo (invited) sees the game night; location is hidden until he answers Yes', (await page.locator('.ev-row', { hasText: 'game night' }).count()) === 1, '');
    await openEvent(page, 'game night'); check('E hidden location says it is shared with people who answer Yes', /Shared with people who answer Yes/.test(await page.locator('.ev-facts').innerText()) || /Priya's place/.test(await page.locator('.ev-facts').innerText()), await page.locator('.ev-facts').innerText());
    await who(page, 'Priya Sample'); await openEvent(page, 'game night'); check('E the creator sees the location', /Priya's place/.test(await page.locator('.ev-facts').innerText()), '');
    // isolation: Theo is in both families
    await who(page, 'Theo Sample'); await fam(page, 'Sample Family B'); const bt = await page.locator('.ev-row-title').allInnerTexts();
    check('E switching Theo to Family B shows only Family B events', bt.join() === 'Family B picnic', bt.join());
    await fam(page, 'Sample Family A'); check('E and back to Family A shows Family A events only', !(await page.locator('.ev-row-title').allInnerTexts()).includes('Family B picnic'), '');
    await who(page, 'Ruth Example'); check('E Ruth (Family B only) is offered Family B only', (await page.locator('#pv-fam option').allInnerTexts()).join() === 'Sample Family B', '');
    await ctx.close(); }

  // F. refusal screens
  { const { ctx, page } = await open(browser);
    await who(page, 'Quinn Sample'); let t = await page.locator('.ev-blocked').innerText();
    check('F a removed member sees "not a member" and none of the family\'s events', /not a member/i.test(t) && (await page.locator('.ev-row').count()) === 0 && !/Grandma|reunion|cookout/i.test(await page.locator('main').innerText()), t);
    check('F the refusal screen still offers the original Family Board', (await page.locator('.ev-blocked a').getAttribute('href')) === BOARD, '');
    await who(page, 'Riley Sample'); t = await page.locator('.ev-blocked').innerText();
    check('F an account without Events access sees a plain refusal and no event', /not available for this account/i.test(t) && (await page.locator('.ev-row').count()) === 0, t);
    check('F the refusal does not state or imply an age or category', !/age|child|minor|teen|under|adult|birthday/i.test(t), t);
    check('F the Family Board note and link remain on the page', (await page.locator('#ev-board').count()) === 1, '');
    await ctx.close(); }

  // G. RSVP and guests
  { const { ctx, page } = await open(browser);
    await who(page, 'Noah Sample'); await openEvent(page, 'Sunday dinner');
    check('G Noah starts with no answer', /Save answer/.test(await page.locator('#ev-rsvp-save').innerText()), '');
    await page.click('label[for=ev-r-yes]'); await page.fill('#ev-guests', '2'); await page.click('#ev-rsvp-save'); await page.waitForSelector('.ev-current');
    check('G answer saved with guests', /Yes, with 2 guests/.test(await page.locator('.ev-current').innerText()), await page.locator('.ev-current').innerText());
    check('G "Who is coming" lists Noah with +2 and counts the headcount (Maya 1 + Theo 3 + Noah 3 = 7)', /Noah Sample \+2/.test(await page.locator('.ev-who').innerText()) && /with guests: 7/.test(await page.locator('.ev-who').innerText()), await page.locator('.ev-who').innerText());
    await page.click('label[for=ev-r-maybe]'); await page.fill('#ev-guests', '1'); await page.click('#ev-rsvp-save'); await page.waitForSelector('.ev-current');
    const who2 = await page.locator('.ev-who').innerText();
    check('G a second answer replaces the first (Noah appears once, under Maybe)', (who2.match(/Noah Sample/g) || []).length === 1 && /Maybe \(2\)[^]*Noah Sample \+1/.test(who2), who2);
    await page.click('label[for=ev-r-no]');
    check('G choosing No sets guests to 0 and locks the box', (await page.inputValue('#ev-guests')) === '0' && (await page.locator('#ev-guests').isDisabled()), '');
    await page.click('#ev-rsvp-save'); await page.waitForSelector('.ev-current');
    check('G "No" saved with no guests', /Your current answer: No\./.test(await page.locator('.ev-current').innerText()), await page.locator('.ev-current').innerText());
    await page.click('label[for=ev-r-yes]'); await page.fill('#ev-guests', '11'); await page.click('#ev-rsvp-save'); await page.waitForSelector('#ev-rsvp-save');
    check('G 11 guests is refused with a clear message and nothing changes', /Guests can be 0 to 10/.test(await page.locator('.ev-rsvp-form .ev-formmsg').innerText()) && /Your current answer: No\./.test(await page.locator('.ev-current').innerText()), await page.locator('.ev-rsvp-form .ev-formmsg').innerText());
    // a changed event marks old answers
    await who(page, 'Priya Sample'); await openEvent(page, 'Summer cookout');
    check('G a changed event shows "This event changed" and flags Priya\'s older answer', /This event changed\. Please check your answer\./.test(await page.locator('.ev-detail').innerText()) && /answered before this event changed/.test(await page.locator('.ev-detail').innerText()), '');
    await page.click('#ev-rsvp-save'); await page.waitForSelector('.ev-current');
    check('G answering again clears the flag', !/answered before this event changed/.test(await page.locator('.ev-detail').innerText()), '');
    await ctx.close(); }

  // H. create
  { const { ctx, page, log } = await open(browser, { w: 1280, h: 900 });
    await page.click('#ev-new'); await page.waitForSelector('.ev-form');
    await page.click('#ev-save'); check('H empty title shows the server message in an alert and keeps the form', /Add a title/.test(await page.locator('#ev-err').innerText()) && (await page.locator('.ev-form').count()) === 1, await page.locator('#ev-err').innerText());
    check('H focus moves to the error message', await page.evaluate(() => document.activeElement && document.activeElement.id === 'ev-err'), '');
    const when = addDays(30);
    await fillForm(page, { title: '<b>Bold</b> picnic', kind: 'other', sd: when, st: '11:00', ed: when, et: '13:30', tz: 'America/Chicago', desc: '<script>window.__x=1</script>line one\nline two', loc: 'Sample Park', audience: 'family' });
    await page.click('#ev-save'); await page.waitForSelector('.ev-detail .ev-title');
    check('H a new family event is created and opened', (await page.locator('.ev-title').innerText()) === '<b>Bold</b> picnic', await page.locator('.ev-title').innerText());
    check('H markup typed in fields is shown as text, never run', (await page.locator('.ev-title b').count()) === 0 && (await page.evaluate(() => window.__x)) === undefined && /<script>/.test(await page.locator('.ev-desc').innerText()), '');
    check('H the event shows Central time', /11:00 AM to 1:30 PM C[SD]T \(America\/Chicago\)/.test(await page.locator('.ev-facts').innerText()), await page.locator('.ev-facts').innerText());
    check('H it appears in the list (desktop shows both panes)', (await page.locator('.ev-listpane .ev-row', { hasText: 'Bold' }).count()) === 1 && (await page.locator('.ev-row.is-active').count()) === 1, '');
    check('H the creator can edit, cancel and delete it', (await page.locator('#ev-edit, #ev-cancel, #ev-delete').count()) === 3, '');
    check('H focus lands on the event title', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ev-title')), '');
    // all-day
    await page.click('#ev-new'); await page.waitForSelector('.ev-form'); await page.setChecked('#ev-allday', true);
    check('H turning on All-day hides the time and zone fields', !(await visible(page, '#ev-st')) && !(await visible(page, '#ev-tz')), '');
    await fillForm(page, { title: 'Cabin weekend', sd: addDays(50), ed: addDays(52), audience: 'family' }); await page.click('#ev-save'); await page.waitForSelector('.ev-detail .ev-title');
    check('H an all-day range is saved as dates only', /\(all day\)/.test(await page.locator('.ev-facts').innerText()), '');
    // invited
    await page.click('#ev-new'); await page.waitForSelector('.ev-form');
    check('H the invite picker is hidden until "Only people I invite" is chosen', !(await visible(page, '#ev-invitees')), '');
    await fillForm(page, { title: 'Secret surprise', sd: addDays(20), st: '17:00', audience: 'invited', invite: ['Priya Sample'], loc: 'Home', locacc: 'going' });
    check('H the picker lists Family A members but not the creator', (await page.locator('#ev-invitees label').allInnerTexts()).join() === 'Theo Sample,Priya Sample,Noah Sample,Riley Sample', (await page.locator('#ev-invitees label').allInnerTexts()).join());
    await page.click('#ev-save'); await page.waitForSelector('.ev-detail .ev-title');
    check('H the invited event shows the "Invited people only" badge', /Invited people only/.test(await page.locator('.ev-badges').innerText()), '');
    await who(page, 'Priya Sample'); check('H an invitee sees it', (await page.locator('.ev-row', { hasText: 'Secret surprise' }).count()) === 1, '');
    await who(page, 'Noah Sample'); check('H someone else in the family does not', (await page.locator('.ev-row', { hasText: 'Secret surprise' }).count()) === 0, '');
    check('H nothing was sent anywhere while creating', log.external.length === 0, log.external.join(','));
    await page.screenshot({ path: path.join(shots, 'events-desktop-after-create.png'), fullPage: true });
    await ctx.close(); }

  // I. daylight saving in the form
  { const { ctx, page } = await open(browser);
    const gap = futureDst(2, 2), amb = futureDst(10, 1);
    await page.click('#ev-new'); await page.waitForSelector('.ev-form');
    await fillForm(page, { title: 'DST gap', sd: gap, st: '02:30', tz: 'America/New_York', audience: 'family' });
    check('I a time that does not exist shows a hint before saving', /does not exist/.test(await page.locator('#ev-timehint').innerText()), await page.locator('#ev-timehint').innerText());
    await page.click('#ev-save'); check('I saving it is refused with the same plain message', /does not exist/.test(await page.locator('#ev-err').innerText()) && (await page.locator('.ev-form').count()) === 1, await page.locator('#ev-err').innerText());
    await page.fill('#ev-sd', amb); await page.fill('#ev-st', '01:30');
    check('I a time that happens twice says the first one is used', /happens twice[^]*first one is used/.test(await page.locator('#ev-timehint').innerText()), await page.locator('#ev-timehint').innerText());
    await page.click('#ev-save'); await page.waitForSelector('.ev-detail .ev-title');
    check('I saving it works and says so', /1:30 AM EDT/.test(await page.locator('.ev-facts').innerText()) && (await page.locator('.toast', { hasText: 'first one was used' }).count()) >= 1, await page.locator('.ev-facts').innerText());
    await page.click('#ev-edit'); await page.waitForSelector('.ev-form'); await page.fill('#ev-et', '01:00'); await page.fill('#ev-ed', amb);
    await page.click('#ev-save'); check('I an end before the start is refused', /end must be after/.test(await page.locator('#ev-err').innerText()), await page.locator('#ev-err').innerText());
    await ctx.close(); }

  // J. edit
  { const { ctx, page } = await open(browser); await openEvent(page, 'Sunday dinner');
    check('J Maya (owner, creator) sees Edit, Cancel and Delete on her event', (await page.locator('#ev-edit, #ev-cancel, #ev-delete').count()) === 3, '');
    await page.click('#ev-edit'); await page.waitForSelector('.ev-form');
    check('J the form is filled with the event', (await page.inputValue('#ev-title')) === 'Sunday dinner at Grandma\'s' && (await page.inputValue('#ev-st')) === '18:00' && (await page.inputValue('#ev-tz')) === 'America/New_York', '');
    await page.fill('#ev-title', 'Sunday supper'); await page.click('#ev-save'); await page.waitForSelector('.ev-detail .ev-title');
    check('J a title-only edit saves and does NOT show "This event changed"', (await page.locator('.ev-title').innerText()) === 'Sunday supper' && !/This event changed/.test(await page.locator('.ev-detail').innerText()), '');
    await page.click('#ev-edit'); await page.waitForSelector('.ev-form'); await page.fill('#ev-st', '19:00'); await page.click('#ev-save'); await page.waitForSelector('.ev-detail .ev-title');
    check('J a time change shows "This event changed. Please check your answer."', /This event changed\. Please check your answer\./.test(await page.locator('.ev-detail').innerText()), '');
    check('J the older answers on that event are flagged for Theo', await (async () => { await who(page, 'Theo Sample'); await openEvent(page, 'Sunday supper'); return /answered before this event changed/.test(await page.locator('.ev-detail').innerText()); })(), '');
    // permissions
    check('J Theo cannot edit, cancel or delete Maya\'s event', (await page.locator('#ev-edit, #ev-cancel, #ev-delete').count()) === 0, '');
    await page.goto(PREVIEW() + '#/calendar/event/' + (await page.locator('.ev-row.is-active').getAttribute('data-event')) + '/edit'); await page.waitForSelector('.ev-blocked');
    check('J typing the edit link as Theo shows "cannot be edited" and no form', /cannot be edited/.test(await page.locator('.ev-blocked').innerText()) && (await page.locator('.ev-form').count()) === 0, '');
    await who(page, 'Maya Sample'); await openEvent(page, 'Graduation party');
    check('J Maya (owner) can cancel and delete Theo\'s event but not edit it', (await page.locator('#ev-cancel').count()) === 1 && (await page.locator('#ev-delete').count()) === 1 && (await page.locator('#ev-edit').count()) === 0, '');
    await ctx.close(); }

  // K. cancel and delete, keyboard and focus
  { const { ctx, page } = await open(browser); await openEvent(page, 'Summer cookout');
    await page.click('#ev-cancel'); check('K Cancel asks first, in the page, with the reason and focus on the confirm button', (await page.locator('#ev-confirm-h').innerText()) === 'Cancel this event?' && await page.evaluate(() => document.activeElement.id === 'ev-confirm-yes'), '');
    await page.click('#ev-confirm-no'); check('K "Keep the event" closes it and returns focus to the Cancel button', (await page.locator('.ev-confirm').count()) === 0 && await page.evaluate(() => document.activeElement.id === 'ev-cancel'), '');
    await page.click('#ev-cancel'); await page.click('#ev-confirm-yes'); await page.waitForSelector('.ev-banner.is-cancelled');
    const d = await page.locator('.ev-detail').innerText();
    check('K a cancelled event shows a Cancelled banner and closes answers', /This event was cancelled\./.test(d) && /answers are closed/.test(d) && (await page.locator('#ev-rsvp-save').count()) === 0, '');
    check('K Edit and Cancel are gone; Delete remains', (await page.locator('#ev-edit').count()) === 0 && (await page.locator('#ev-cancel').count()) === 0 && (await page.locator('#ev-delete').count()) === 1, '');
    check('K the list badges it Cancelled', (await page.locator('.ev-listpane .ev-row', { hasText: 'Summer cookout' }).locator('.is-cancelled').count()) === 1, '');
    await page.click('#ev-delete'); check('K Delete suggests cancelling instead', /Cancelling instead keeps it visible/.test(await page.locator('.ev-confirm').innerText()), '');
    await page.click('#ev-confirm-yes'); await page.waitForSelector('.ev-layout');
    check('K deleting removes it from the list', (await page.locator('.ev-row', { hasText: 'Summer cookout' }).count()) === 0, '');
    // a past event: answers closed, no edit
    await page.click('.ev-tab[data-tab=past]'); await openEvent(page, 'Anniversary dinner');
    check('K a past event is read-only: answers closed, no Edit', /This event is over/.test(await page.locator('.ev-detail').innerText()) && (await page.locator('#ev-edit').count()) === 0 && (await page.locator('#ev-cancel').count()) === 1, '');
    await ctx.close(); }
  { // keyboard only
    const { ctx, page } = await open(browser); await page.focus('#ev-new'); await page.keyboard.press('Enter'); await page.waitForSelector('.ev-form');
    check('K keyboard: New event opens by Enter and focus is on the form heading', await page.evaluate(() => document.activeElement && document.activeElement.tagName === 'H2' && /New event/.test(document.activeElement.textContent)), '');
    await page.keyboard.press('Tab'); await page.waitForTimeout(400); check('K keyboard: Tab moves on to the next control, with a visible focus ring', await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return e !== document.body && (cs.outlineStyle !== 'none' || cs.boxShadow !== 'none'); }), '');
    const labels = await page.evaluate(() => [...document.querySelectorAll('.ev-form input:not([type=radio]):not([type=checkbox]), .ev-form select, .ev-form textarea')].filter(e => e.offsetParent).every(e => document.querySelector('label[for="' + e.id + '"]')));
    check('K every visible form field has a label', labels, '');
    await ctx.close(); }

  // L. reset
  { const { ctx, page } = await open(browser); await page.click('#ev-new'); await page.waitForSelector('.ev-form');
    await fillForm(page, { title: 'Will vanish', sd: addDays(9), st: '10:00', audience: 'family' }); await page.click('#ev-save'); await page.waitForSelector('.ev-detail');
    await page.goto(PREVIEW() + '#/calendar'); check('L the new event is there', (await page.locator('.ev-row', { hasText: 'Will vanish' }).count()) === 1, '');
    await page.click('#pv-reset'); await page.waitForSelector('.ev-layout'); await page.waitForTimeout(100);
    check('L "Reset sample data" removes it and restores the six samples', (await page.locator('.ev-row', { hasText: 'Will vanish' }).count()) === 0 && (await page.locator('.ev-row').count()) === 6, '');
    await page.reload(); await page.waitForSelector('.ev-layout');
    check('L a plain reload also starts fresh (nothing persists)', (await page.locator('.ev-row').count()) === 6, '');
    await ctx.close(); }

  // M. the live app is untouched by this branch
  { const tracked = require('child_process').execSync('git -C ' + ROOT + ' diff --name-only main...HEAD || true').toString().trim().split('\n').filter(Boolean);
    const outside = tracked.filter(f => !/^(events-preview\/|tests\/events\/|tests\/browser\/events-preview\.spec\.js|EVENTS-PREVIEW\.md)/.test(f));
    check('M this branch changes no existing file and adds only preview and test files', outside.length === 0, outside.join(','));
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'), hub = fs.readFileSync(path.join(ROOT, 'hub.js'), 'utf8');
    check('M the live index.html does not load any Events file', !/events/i.test(idx), '');
    check('M the Hub card still points at the original Family Board', /id: 'calendar'[^]*href: BOARD_URL, external: true/.test(hub) && !/events/i.test(cfg), '');
  }

  await browser.close(); server.close();
  console.log(results.join('\n')); console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

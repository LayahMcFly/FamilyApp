/* Rule tests for the Recipes PREVIEW: core checks and the in-memory fake server, with invented data only.
 * Run:  node --test tests/recipes/recipes.test.js
 * Class B evidence: they prove the preview's simulated rules. They say nothing about real accounts, privacy, storage or the original Recipe Book. */
const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../../recipes-preview/recipes-core.js'), P = require('../../recipes-preview/recipes-photos.js');
const FX = require('../../recipes-preview/recipes-fixtures.js'), F = require('../../recipes-preview/recipes-fake-server.js');
const mk = () => F.create({ now: () => 1800000000000 });
const A = 'sample-a', B = 'sample-b', Cc = 'sample-c';
const names = (s, u) => s.call(u, 'list').recipes.map(r => r.name);
const snap = (s, u) => JSON.stringify(s.call(u, 'export').backup.recipes);
const text = id => FX.text(id);
const choose = (rep, pick) => { const d = {}; rep.items.forEach(i => { if (i.needsChoice) d[i.index] = pick(i); }); return d; };

/* ---------- photos ---------- */
test('good sample photos pass and report their real size', () => {
  const want = { bowl: [640, 427], plate: [600, 400], cookies: [800, 600], tall: [400, 800] };
  for (const [k, [w, h]] of Object.entries(want)) { const r = C.checkPhoto(P[k].dataUrl); assert.equal(r.ok, true, k); assert.equal(r.w, w); assert.equal(r.h, h); assert.ok(r.bytes <= 150 * 1024); }
});
test('exactly 800px on the longest edge is allowed; portrait keeps its shape (400x800)', () => {
  assert.equal(C.checkPhoto(P.cookies.dataUrl).ok, true); const t = C.checkPhoto(P.tall.dataUrl); assert.deepEqual([t.w, t.h], [400, 800]);
});
test('each bad sample is refused for the stated reason', () => {
  const want = { 'bad-wide': ['too-large-dimensions'], 'bad-heavy': ['too-heavy'], 'bad-gif': ['unsupported-type'], 'bad-svg': ['unsupported-type'], 'bad-external': ['external-link'], 'bad-corrupt': ['unreadable'] };
  for (const [k, codes] of Object.entries(want)) { const r = C.checkPhoto(P[k].dataUrl); assert.equal(r.ok, false, k); assert.deepEqual(r.reasons.map(x => x.code), codes, k); assert.ok(r.reasons[0].message.length > 10); }
});
test('150 KB boundary: exactly 153600 bytes passes, one more byte is refused', () => {
  const raw = Buffer.from(P.bowl.dataUrl.split(',')[1], 'base64'), pad = n => 'data:image/jpeg;base64,' + Buffer.concat([raw, Buffer.alloc(n - raw.length)]).toString('base64');
  assert.equal(C.checkPhoto(pad(153600)).ok, true); const r = C.checkPhoto(pad(153601)); assert.equal(r.ok, false); assert.equal(r.reasons[0].code, 'too-heavy');
});
test('a photo can fail on size and dimensions at once, and both reasons are listed', () => {
  const raw = Buffer.from(P['bad-wide'].dataUrl.split(',')[1], 'base64'); const big = 'data:image/jpeg;base64,' + Buffer.concat([raw, Buffer.alloc(160000)]).toString('base64');
  assert.deepEqual(C.checkPhoto(big).reasons.map(x => x.code).sort(), ['too-heavy', 'too-large-dimensions']);
});
test('declared type that does not match the bytes is unreadable; non-string values are refused', () => {
  const png = P.plate.dataUrl.replace('image/png', 'image/jpeg'); assert.equal(C.checkPhoto(png).reasons[0].code, 'unreadable');
  for (const v of [5, {}, [], true]) assert.equal(C.checkPhoto(v).ok, false);
  assert.equal(C.checkPhoto('').ok, true); assert.equal(C.checkPhoto(undefined).empty, true);
  assert.equal(C.checkPhoto('javascript:alert(1)').ok, false); assert.equal(C.checkPhoto('data:text/html;base64,PGI+').ok, false);
});

/* ---------- recipe validation ---------- */
test('validateRecipe accepts a normal record and trims lines', () => {
  const v = C.validateRecipe({ name: '  Sample Tea ', ingredients: [' 1 cup water ', ''], steps: ['Boil'], tags: ['a'], fav: true });
  assert.equal(v.ok, true); assert.equal(v.value.name, 'Sample Tea'); assert.deepEqual(v.value.ingredients, ['1 cup water']); assert.equal(v.value.slug, 'sample-tea'); assert.equal(v.value.fav, true);
});
test('validateRecipe never throws and refuses wrong shapes with a reason', () => {
  for (const x of [null, undefined, 5, 'x', [], [1], {}, { name: '' }, { name: 42 }, { name: 'a', ingredients: 'x' }, { name: 'a', steps: ['a', 1] }, { name: 'a', fav: 'yes' }, { name: 'a', updated: 'x' }, { name: 'a', description: 5 }, { name: 'a'.repeat(121) }, { name: 'a', ingredients: Array(101).fill('x') }, { name: 'a', steps: ['x'.repeat(2001)] }]) {
    const v = C.validateRecipe(x); assert.equal(v.ok, false, JSON.stringify(x)); assert.ok(v.errors.length > 0);
  }
});
test('unknown fields are listed as ignored, not silently dropped', () => { const v = C.validateRecipe({ name: 'a', rating: 5, cookbookPage: 2 }); assert.equal(v.ok, true); assert.deepEqual(v.ignored, ['rating', 'cookbookPage']); assert.equal('rating' in v.value, false); });

/* ---------- whole-file checks ---------- */
test('parseBackup rejects whole files with a plain reason', () => {
  const bad = { 'not-json': /not valid JSON/, 'wrong-app': /different app/, 'wrong-version': /version 7/, 'empty-list': /empty recipe list/, 'too-many': /201 records/, 'too-big': /larger than 2 MB/ };
  for (const [id, re] of Object.entries(bad)) { const r = C.parseBackup(text(id)); assert.equal(r.ok, false, id); assert.match(r.error, re, id); }
  assert.equal(C.parseBackup('{}').ok, false); assert.equal(C.parseBackup('').ok, false); assert.equal(C.parseBackup(null).ok, false); assert.equal(C.parseBackup('{"recipes":"x"}').ok, false);
});
test('parseBackup accepts the object shape and the bare list', () => { assert.equal(C.parseBackup(text('valid-photos')).format, 'object'); assert.equal(C.parseBackup(text('bare-array')).format, 'array'); });

/* ---------- privacy (simulated) ---------- */
test('each person sees only their own recipes', () => {
  const s = mk(); assert.deepEqual(names(s, A), ['Sample Tomato Soup', 'Sample Lemon Cookies', 'Sample Pasta Night']); assert.deepEqual(names(s, B), ['Example Pancakes']); assert.deepEqual(names(s, Cc), []);
});
test('another person cannot read, edit, favourite, delete or export a recipe that is not theirs', () => {
  const s = mk(), id = s.call(A, 'list').recipes[0].id;
  assert.equal(s.call(B, 'get', { id }).code, 'not-found'); assert.equal(s.call(B, 'edit', { id, recipe: { name: 'Hijack' } }).code, 'not-found');
  assert.equal(s.call(B, 'toggleFav', { id }).code, 'not-found'); assert.equal(s.call(B, 'delete', { id }).code, 'not-found');
  assert.equal(JSON.stringify(s.call(B, 'export').backup).includes('Tomato'), false); assert.equal(s.call(A, 'get', { id }).ok, true);
});
test('unknown people and unknown actions are refused', () => { const s = mk(); assert.equal(s.call('nobody', 'list').code, 'not-signed-in'); assert.equal(s.call(A, 'nope').code, 'unknown'); assert.equal(s.call(A, '__proto__').code, 'unknown'); });

/* ---------- create / edit / delete ---------- */
test('create, edit and delete work, with a unique slug for a repeated name', () => {
  const s = mk(), a = s.call(Cc, 'create', { recipe: { name: 'Sample Jam', ingredients: ['1 cup fruit'], steps: ['Cook'] } }), b = s.call(Cc, 'create', { recipe: { name: 'Sample Jam' } });
  assert.equal(a.ok, true); assert.equal(b.recipe.slug, 'sample-jam-2'); assert.notEqual(a.recipe.id, b.recipe.id);
  const e = s.call(Cc, 'edit', { id: a.recipe.id, recipe: { name: 'Sample Jam Deluxe', ingredients: [] } }); assert.equal(e.ok, true); assert.equal(e.recipe.slug, 'sample-jam'); assert.equal(e.recipe.name, 'Sample Jam Deluxe');
  assert.equal(s.call(Cc, 'delete', { id: a.recipe.id }).ok, true); assert.deepEqual(names(s, Cc), ['Sample Jam']); assert.equal(s.call(Cc, 'delete', { id: a.recipe.id }).code, 'not-found');
});
test('a refused photo saves nothing, on create and on edit, and says why', () => {
  const s = mk(), before = snap(s, A), id = s.call(A, 'list').recipes[0].id;
  for (const k of ['bad-wide', 'bad-heavy', 'bad-gif', 'bad-svg', 'bad-external', 'bad-corrupt']) {
    const c = s.call(A, 'create', { recipe: { name: 'Sample Bad ' + k, image: P[k].dataUrl } }); assert.equal(c.ok, false, k); assert.equal(c.code, 'photo'); assert.ok(c.reasons.length >= 1);
    const e = s.call(A, 'edit', { id, recipe: { name: 'Changed', image: P[k].dataUrl } }); assert.equal(e.ok, false, k);
  }
  assert.equal(snap(s, A), before);
});
test('a good photo is stored as given and a missing name is refused', () => {
  const s = mk(), r = s.call(Cc, 'create', { recipe: { name: 'Sample With Photo', image: P.tall.dataUrl } }); assert.equal(r.recipe.image, P.tall.dataUrl);
  assert.equal(s.call(Cc, 'create', { recipe: { name: '   ' } }).ok, false); assert.equal(names(s, Cc).length, 1);
});
test('a book holds at most 200 recipes', () => {
  const s = mk(); for (let i = 0; i < 200; i++) assert.equal(s.call(Cc, 'create', { recipe: { name: 'Sample ' + i } }).ok, true);
  assert.equal(s.call(Cc, 'create', { recipe: { name: 'One more' } }).code, 'limit');
});

/* ---------- import ---------- */
test('a valid backup with photos needs no choices and keeps every photo byte for byte', () => {
  const s = mk(), rep = s.call(Cc, 'importAnalyze', { text: text('valid-photos') });
  assert.equal(rep.counts.new, 3); assert.equal(rep.items.every(i => !i.needsChoice && i.photo.status === 'ok'), true);
  const r = s.call(Cc, 'importApply', { text: text('valid-photos'), decisions: {} }); assert.equal(r.added.length, 3); assert.equal(r.photosNotImported.length, 0);
  const src = JSON.parse(text('valid-photos')).recipes, got = s.call(Cc, 'export').backup.recipes;
  src.forEach((x, i) => assert.equal(got[i].image, x.image));
  assert.equal(got.filter(x => x.image).length, 3);
});
test('analysing changes nothing', () => { const s = mk(), b = snap(s, A); for (const b2 of FX.list()) s.call(A, 'importAnalyze', { text: text(b2.id) }); assert.equal(snap(s, A), b); });
test('duplicates: the report names them and nothing imports until each has a choice', () => {
  const s = mk(), rep = s.call(A, 'importAnalyze', { text: text('duplicates') }), st = rep.items.map(i => i.status);
  assert.deepEqual(st, ['duplicate', 'duplicate', 'new', 'duplicate-in-file', 'new']); assert.deepEqual(rep.items.filter(i => i.needsChoice).map(i => i.index), [0, 1, 3]);
  const before = snap(s, A), r = s.call(A, 'importApply', { text: text('duplicates'), decisions: {} }); assert.equal(r.code, 'needs-choice'); assert.deepEqual(r.missing, [0, 1, 3]); assert.equal(snap(s, A), before);
  const half = s.call(A, 'importApply', { text: text('duplicates'), decisions: { 0: 'skip', 1: 'skip' } }); assert.equal(half.code, 'needs-choice'); assert.equal(snap(s, A), before);
});
test('duplicates: replace keeps the existing id; keep-both adds a second slug; skip leaves the book alone', () => {
  const s = mk(), idSoup = s.call(A, 'list').recipes[0].id;
  const r = s.call(A, 'importApply', { text: text('duplicates'), decisions: { 0: 'replace', 1: 'skip', 3: 'keep-both' } });
  assert.deepEqual([r.added.length, r.replaced.length, r.skipped.length], [3, 1, 1]);
  const soup = s.call(A, 'get', { id: idSoup }).recipe; assert.equal(soup.notes, 'A different version from the backup.'); assert.equal(soup.slug, 'sample-tomato-soup');
  const ls = s.call(A, 'list').recipes; assert.equal(ls.filter(x => x.name === 'Sample Granola').length, 2); assert.deepEqual(ls.filter(x => x.name === 'Sample Granola').map(x => x.slug).sort(), ['sample-granola', 'sample-granola-2']);
  assert.equal(ls.filter(x => x.name === 'Sample Lemon Cookies').length, 1);
});
test('a choice the record does not offer is refused (replace for a repeat inside the file; add for an invalid record)', () => {
  const s = mk(), b = snap(s, A);
  assert.equal(s.call(A, 'importApply', { text: text('duplicates'), decisions: { 0: 'skip', 1: 'skip', 3: 'replace' } }).code, 'needs-choice');
  assert.equal(s.call(A, 'importApply', { text: text('malformed'), decisions: choose(s.call(A, 'importAnalyze', { text: text('malformed') }), () => 'add') }).code, 'needs-choice');
  assert.equal(s.call(A, 'importApply', { text: text('duplicates'), decisions: { 0: 'bogus', 1: 'skip', 3: 'skip' } }).code, 'needs-choice'); assert.equal(snap(s, A), b);
});
test('importing the same backup twice does not create a second copy when skipped', () => {
  const s = mk(); s.call(Cc, 'importApply', { text: text('valid-photos'), decisions: {} }); const once = snap(s, Cc), rep = s.call(Cc, 'importAnalyze', { text: text('valid-photos') });
  assert.deepEqual(rep.items.map(i => i.status), ['duplicate', 'duplicate', 'duplicate']); const r = s.call(Cc, 'importApply', { text: text('valid-photos'), decisions: choose(rep, () => 'skip') });
  assert.equal(r.skipped.length, 3); assert.equal(snap(s, Cc), once);
});
test('malformed records: each is listed with a reason, must be skipped explicitly, and none is dropped silently', () => {
  const s = mk(), rep = s.call(A, 'importAnalyze', { text: text('malformed') });
  assert.equal(rep.counts.invalid, 7); assert.equal(rep.items.filter(i => i.status === 'invalid').every(i => i.errors.length > 0 && i.choices.length === 1 && i.choices[0] === 'skip' && i.needsChoice), true);
  assert.deepEqual(rep.items.find(i => i.name === 'Sample Extra Fields').ignored, ['rating', 'cookbookPage']);
  const b = snap(s, A); assert.equal(s.call(A, 'importApply', { text: text('malformed'), decisions: {} }).code, 'needs-choice'); assert.equal(snap(s, A), b);
  const r = s.call(A, 'importApply', { text: text('malformed'), decisions: choose(rep, () => 'skip') });
  assert.equal(r.added.length, 2); assert.equal(r.skipped.length, 7); assert.equal(r.added.length + r.replaced.length + r.skipped.length, rep.counts.total);
  assert.deepEqual(r.ignoredFields.map(x => x.name), ['Sample Extra Fields']);
  const ls = names(s, A); assert.ok(ls.includes('Sample Toast') && ls.includes('Sample Extra Fields')); assert.equal(ls.includes('Sample Broken List'), false);
});
test('photo problems: six photos are refused with reasons; the recipe imports without the photo only if chosen; a bad photo is never stored', () => {
  const s = mk(), rep = s.call(Cc, 'importAnalyze', { text: text('photo-problems') });
  assert.equal(rep.counts.photoRejected, 6); assert.deepEqual(rep.items.filter(i => i.needsChoice).map(i => i.index), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rep.items.slice(1).map(i => i.photo.reasons[0].code), ['too-large-dimensions', 'too-heavy', 'unsupported-type', 'unsupported-type', 'external-link', 'unreadable']);
  assert.equal(s.call(Cc, 'importApply', { text: text('photo-problems'), decisions: {} }).code, 'needs-choice'); assert.deepEqual(names(s, Cc), []);
  const d = choose(rep, i => i.index <= 3 ? 'add' : 'skip'), r = s.call(Cc, 'importApply', { text: text('photo-problems'), decisions: d });
  assert.deepEqual([r.added.length, r.skipped.length, r.photosNotImported.length], [4, 3, 3]); assert.ok(r.photosNotImported.every(x => x.reasons.length >= 1));
  const out = s.call(Cc, 'export').backup.recipes; assert.equal(out.length, 4); assert.equal(out[0].image, P.bowl.dataUrl); out.slice(1).forEach(x => assert.equal(x.image, ''));
  out.forEach(x => assert.equal(C.checkPhoto(x.image).ok, true));
});
test('file errors: nothing read, nothing changed, and an apply attempt is refused', () => {
  const s = mk(), b = snap(s, A);
  for (const id of ['not-json', 'wrong-app', 'wrong-version', 'empty-list', 'too-many', 'too-big']) {
    const rep = s.call(A, 'importAnalyze', { text: text(id) }); assert.ok(rep.fileError, id); assert.equal(s.call(A, 'importApply', { text: text(id), decisions: {} }).code, 'file', id);
  }
  assert.equal(snap(s, A), b);
});
test('an import that would pass 200 recipes is refused whole', () => {
  const s = mk(); for (let i = 0; i < 199; i++) s.call(Cc, 'create', { recipe: { name: 'Fill ' + i } }); const b = snap(s, Cc);
  assert.equal(s.call(Cc, 'importApply', { text: text('valid-photos'), decisions: {} }).code, 'limit'); assert.equal(snap(s, Cc), b);
});
test('the bare-list shape imports like the object shape', () => { const s = mk(), r = s.call(Cc, 'importApply', { text: text('bare-array'), decisions: {} }); assert.equal(r.added.length, 1); });

/* ---------- round trip ---------- */
test('round trip: export from A, import into an empty book, export again: recipes are identical field by field, photos included', () => {
  const s = mk(), out = s.call(A, 'export').backup, t = JSON.stringify(out);
  assert.equal(out.app, 'family-recipe-book'); assert.equal(out.version, 1); assert.equal(out.recipes.filter(r => r.image).length, 2);
  const rep = s.call(Cc, 'importAnalyze', { text: t }); assert.equal(rep.counts.new, 3); assert.equal(rep.items.some(i => i.needsChoice), false);
  const r = s.call(Cc, 'importApply', { text: t, decisions: {} }); assert.equal(r.added.length, 3);
  assert.deepEqual(s.call(Cc, 'export').backup.recipes, out.recipes);
});
test('round trip keeps data the preview does not show (linked recipes, update time, id)', () => {
  const s = mk(), out = s.call(A, 'export').backup, pasta = out.recipes.find(r => r.name === 'Sample Pasta Night'); assert.deepEqual(pasta.parts, ['sample-tomato-soup']); assert.equal(pasta.updated, 1760000200000);
  s.call(Cc, 'importApply', { text: JSON.stringify(out), decisions: {} }); const back = s.call(Cc, 'export').backup.recipes.find(r => r.name === 'Sample Pasta Night'); assert.deepEqual(back, pasta);
});
test('importing your own export into the same book reports every record as a duplicate and changes nothing when skipped', () => {
  const s = mk(), t = JSON.stringify(s.call(A, 'export').backup), b = snap(s, A), rep = s.call(A, 'importAnalyze', { text: t });
  assert.equal(rep.counts.duplicate, 3); s.call(A, 'importApply', { text: t, decisions: choose(rep, () => 'skip') }); assert.equal(snap(s, A), b);
});
test('export contains only the previewed person\'s recipes', () => { const s = mk(); const o = JSON.stringify(s.call(B, 'export').backup); assert.ok(o.includes('Example Pancakes')); assert.equal(o.includes('Tomato'), false); });

/* ---------- fixtures are what they say ---------- */
test('bundled fixtures are synthetic: every sample photo is classified as labelled', () => {
  for (const [k, v] of Object.entries(P)) assert.equal(C.checkPhoto(v.dataUrl).ok, v.kind === 'good', k);
  assert.equal(FX.list().length, 11);
});

/* ---------- blocked until the authorship and license questions are answered (listed so they cannot disappear) ---------- */
for (const name of ['serving scaling incl. fractions and ranges', 'ingredient check boxes and whether they reset', 'cook mode navigation and exit', 'timers: start, pause, resume, cancel, completion sound', 'cookbook PDF/EPUB output', 'real photo storage and real photo import'])
  test('BLOCKED/NOT BUILT: ' + name, { todo: true }, () => {});

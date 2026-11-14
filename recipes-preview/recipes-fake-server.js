/* Recipes preview: the FAKE server (PREVIEW CODE, not wired into the live app).
 * In-memory only. Simulates the rules proposed for private Recipes: every recipe belongs to its creator, nobody else can list, read,
 * change or delete it, and imports need an explicit choice for anything that is not plainly fine. It is NOT the real family-api and
 * proves nothing about real accounts or privacy. Nothing is stored in the browser; reload clears it. */
(function (root, factory) {
  var core = root.RecipesCore || (typeof require === 'function' ? require('./recipes-core.js') : null);
  var fx = root.RecipesFixtures || (typeof require === 'function' ? require('./recipes-fixtures.js') : null);
  var api = factory(core, fx);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RecipesFake = api;
})(typeof self !== 'undefined' ? self : this, function (C, FX) {
  'use strict';
  var VIEWERS = [
    { userId: 'sample-a', name: 'Sample Cook A', note: 'Has three sample recipes.' },
    { userId: 'sample-b', name: 'Sample Cook B', note: 'Has one sample recipe. Cannot see Sample Cook A\'s recipes.' },
    { userId: 'sample-c', name: 'Sample Cook C (empty book)', note: 'Starts with no recipes, to show the empty state and a clean import.' }
  ];
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function fail(code, message, extra) { return Object.assign({ ok: false, code: code, message: message }, extra || {}); }

  function create(opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var books = {}, counter = 0;
    VIEWERS.forEach(function (v) { books[v.userId] = []; });
    function norm(list) { return clone(list).map(function (r) { return C.validateRecipe(r).value; }); }
    if (opts.seed !== false) { books['sample-a'] = norm(FX.seed.a); books['sample-b'] = norm(FX.seed.b); }
    function nextId() { counter += 1; return 'r-' + ('000' + counter).slice(-4); }
    function book(u) { return books[u] || null; }
    function uniqueSlug(b, slug) { var s = slug, n = 1; while (b.some(function (r) { return r.slug === s; })) { n += 1; s = slug.slice(0, 55) + '-' + n; } return s; }
    function idFree(b, id) { return id && !b.some(function (r) { return r.id === id; }); }
    function summary(r) { return { id: r.id, slug: r.slug, name: r.name, description: r.description, yield: r.yield, fav: r.fav, image: r.image, categories: r.categories.slice(), tags: r.tags.slice(), updated: r.updated }; }

    function photoRejected(p) { return p && !p.ok && !p.empty; }
    function itemRejected(ph) { return ph && ph.status === 'rejected'; }
    /* Looks at a whole backup and says what would happen to each record. Changes nothing. */
    function analyze(u, text) {
      var b = book(u); if (!b) return fail('not-signed-in', 'This preview person does not exist.');
      var pb = C.parseBackup(text); if (!pb.ok) return { ok: true, fileError: pb.error, items: [], counts: { total: 0 } };
      var seen = {}, items = pb.records.map(function (raw, i) {
        var v = C.validateRecipe(raw), it = { index: i, name: raw && typeof raw === 'object' && typeof raw.name === 'string' ? raw.name.slice(0, 60) : '(no name)', errors: v.errors, ignored: v.ignored || [], photo: { status: 'none', reasons: [] } };
        if (!v.ok) { it.status = 'invalid'; it.choices = ['skip']; it.needsChoice = true; return it; }
        it.slug = v.value.slug;
        if (!v.photo.empty) it.photo = v.photo.ok ? { status: 'ok', reasons: [], bytes: v.photo.bytes, w: v.photo.w, h: v.photo.h } : { status: 'rejected', reasons: v.photo.reasons };
        var inFile = Object.prototype.hasOwnProperty.call(seen, v.value.slug), existing = b.some(function (r) { return r.slug === v.value.slug; });
        seen[v.value.slug] = true;
        if (inFile) { it.status = 'duplicate-in-file'; it.choices = ['skip', 'keep-both']; it.needsChoice = true; }
        else if (existing) { it.status = 'duplicate'; it.choices = ['skip', 'keep-both', 'replace']; it.needsChoice = true; }
        else if (itemRejected(it.photo)) { it.status = 'new'; it.choices = ['add', 'skip']; it.needsChoice = true; }
        else { it.status = 'new'; it.choices = ['add', 'skip']; it.needsChoice = false; }
        if (itemRejected(it.photo)) it.needsChoice = true;
        it.value = v.value; return it;
      });
      var counts = { total: items.length, new: 0, duplicate: 0, 'duplicate-in-file': 0, invalid: 0, photoRejected: 0, ignoredFields: 0 };
      items.forEach(function (it) { counts[it.status]++; if (itemRejected(it.photo)) counts.photoRejected++; if (it.ignored.length) counts.ignoredFields++; });
      return { ok: true, items: items, counts: counts, format: pb.format };
    }
    function publicItems(a) { return a.items.map(function (it) { var o = Object.assign({}, it); delete o.value; return o; }); }

    var actions = {
      list: function (u) { return { ok: true, recipes: book(u).map(summary) }; },
      get: function (u, body) { var r = book(u).filter(function (x) { return x.id === body.id; })[0]; return r ? { ok: true, recipe: clone(r) } : fail('not-found', 'That recipe does not exist.'); },
      create: function (u, body) {
        var b = book(u), v = C.validateRecipe(body.recipe);
        if (!v.ok) return fail('invalid', v.errors.join(' '), { errors: v.errors });
        if (photoRejected(v.photo)) return fail('photo', v.photo.reasons.map(function (r) { return r.message; }).join(' '), { reasons: v.photo.reasons });
        if (b.length >= C.LIMITS.recipes) return fail('limit', 'This book already holds ' + C.LIMITS.recipes + ' recipes.');
        var r = Object.assign({}, v.value, { id: nextId(), slug: uniqueSlug(b, v.value.slug), updated: now() });
        b.push(r); return { ok: true, recipe: clone(r) };
      },
      edit: function (u, body) {
        var b = book(u), i = b.findIndex(function (x) { return x.id === body.id; }); if (i < 0) return fail('not-found', 'That recipe does not exist.');
        var v = C.validateRecipe(body.recipe); if (!v.ok) return fail('invalid', v.errors.join(' '), { errors: v.errors });
        if (photoRejected(v.photo)) return fail('photo', v.photo.reasons.map(function (r) { return r.message; }).join(' '), { reasons: v.photo.reasons });
        var old = b[i]; b[i] = Object.assign({}, v.value, { id: old.id, slug: old.slug, parts: old.parts, updated: now() });
        return { ok: true, recipe: clone(b[i]) };
      },
      delete: function (u, body) {
        var b = book(u), i = b.findIndex(function (x) { return x.id === body.id; }); if (i < 0) return fail('not-found', 'That recipe does not exist.');
        b.splice(i, 1); return { ok: true };
      },
      toggleFav: function (u, body) { var r = book(u).filter(function (x) { return x.id === body.id; })[0]; if (!r) return fail('not-found', 'That recipe does not exist.'); r.fav = !r.fav; return { ok: true, fav: r.fav }; },
      export: function (u) { return { ok: true, backup: C.buildBackup(book(u), new Date(now()).toISOString()) }; },
      importAnalyze: function (u, body) { var a = analyze(u, body.text); if (!a.ok) return a; if (a.fileError) return a; return { ok: true, counts: a.counts, format: a.format, items: publicItems(a) }; },
      importApply: function (u, body) {
        var a = analyze(u, body.text); if (!a.ok) return a;
        if (a.fileError) return fail('file', a.fileError);
        var dec = body.decisions || {}, plan = [], missing = [];
        a.items.forEach(function (it) {
          var d = dec[String(it.index)];
          if (d === undefined && !it.needsChoice) d = 'add';
          if (d === undefined || it.choices.indexOf(d) < 0) { missing.push(it.index); return; }
          plan.push({ it: it, d: d });
        });
        if (missing.length) return fail('needs-choice', missing.length + ' record' + (missing.length === 1 ? ' still needs' : 's still need') + ' a choice. Nothing was imported.', { missing: missing });
        var b = book(u), adds = plan.filter(function (p) { return p.d === 'add' || p.d === 'keep-both'; }).length;
        if (b.length + adds > C.LIMITS.recipes) return fail('limit', 'Importing would take this book over ' + C.LIMITS.recipes + ' recipes. Nothing was imported.');
        var res = { ok: true, added: [], replaced: [], skipped: [], photosNotImported: [], ignoredFields: [] };
        plan.forEach(function (p) {
          var it = p.it, r = it.value, label = it.name;
          if (p.d === 'skip') { res.skipped.push({ index: it.index, name: label, why: it.status }); return; }
          if (it.photo.status === 'rejected') res.photosNotImported.push({ index: it.index, name: label, reasons: it.photo.reasons.map(function (x) { return x.message; }) });
          if (it.ignored.length) res.ignoredFields.push({ index: it.index, name: label, fields: it.ignored.slice() });
          if (p.d === 'replace') {
            var i = b.findIndex(function (x) { return x.slug === r.slug; });
            b[i] = Object.assign({}, r, { id: b[i].id, slug: b[i].slug, updated: r.updated || now() }); res.replaced.push({ index: it.index, name: label }); return;
          }
          var id = idFree(b, r.id) ? r.id : nextId();
          b.push(Object.assign({}, r, { id: id, slug: uniqueSlug(b, r.slug), updated: r.updated || now() })); res.added.push({ index: it.index, name: label });
        });
        return res;
      }
    };
    function call(userId, action, body) {
      if (!books[userId]) return fail('not-signed-in', 'This preview person does not exist.');
      if (!Object.prototype.hasOwnProperty.call(actions, action)) return fail('unknown', 'Unknown action.');
      try { return actions[action](userId, body || {}); } catch (e) { return fail('error', 'Something went wrong in the preview server.'); }
    }
    return { call: call, viewers: VIEWERS };
  }
  return { create: create, VIEWERS: VIEWERS };
});

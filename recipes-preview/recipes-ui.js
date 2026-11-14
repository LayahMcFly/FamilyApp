/* Recipes preview: the screens (PREVIEW CODE, not wired into the live app).
 * Talks only to the `server` object it is given (the in-memory fake in the preview). Text is always set with textContent. */
(function (root) {
  'use strict';
  var C = root.RecipesCore, FX = root.RecipesFixtures, PH = root.RecipesPhotos;
  var BLOCKED = ['Serving scaling', 'Ingredient check boxes', 'Cook mode', 'Timers'];
  var STATUS_TEXT = { 'new': 'New', duplicate: 'Already in your book', 'duplicate-in-file': 'Same name twice in this file', invalid: 'Cannot be imported' };
  var CHOICE_TEXT = { skip: 'Skip this recipe', add: 'Import it', 'keep-both': 'Keep both (add a second copy)', replace: 'Replace the one in my book' };

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k === 'value') el.value = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(el, x); }); else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
  function badge(t, cls) { return h('span', { class: 'rc-badge' + (cls ? ' ' + cls : ''), text: t }); }
  function lines(s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function csv(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

  function mount(o) {
    var server = o.server, viewers = o.viewers, main = o.main, controls = o.controls, toasts = o.toasts;
    var st = { userId: viewers[0].userId, lastExport: null, report: null, picked: 'valid-photos', decisions: {}, result: null, importText: null, confirmDelete: false };
    function api(a, b) { return server.call(st.userId, a, b || {}); }
    function toast(m) { var t = h('div', { class: 'toast', text: m }); toasts.appendChild(t); setTimeout(function () { t.remove(); }, 4000); }
    function route() {
      var p = (location.hash || '').replace(/^#\/?/, '').split('/');
      if (p[0] !== 'recipes') return { name: 'list' };
      if (p[1] === 'new') return { name: 'new' };
      if (p[1] === 'backup') return { name: 'backup' };
      if (p[1] === 'r' && p[2]) return p[3] === 'edit' ? { name: 'edit', id: p[2] } : { name: 'detail', id: p[2] };
      return { name: 'list' };
    }
    function go(hash) { if (location.hash === hash) render(true); else location.hash = hash; }
    function focusHead() { var t = main.querySelector('[data-focus]'); if (t) { t.setAttribute('tabindex', '-1'); t.focus(); } }

    function drawControls() {
      var who = h('select', { id: 'pv-who', 'aria-describedby': 'pv-note' });
      viewers.forEach(function (v) { who.appendChild(h('option', { value: v.userId, text: v.name, selected: v.userId === st.userId })); });
      who.addEventListener('change', function () { st.userId = who.value; st.report = null; st.result = null; st.decisions = {}; st.confirmDelete = false; go('#/recipes'); drawControls(); });
      var v = viewers.filter(function (x) { return x.userId === st.userId; })[0];
      controls.textContent = '';
      controls.appendChild(h('div', { class: 'pv-row' },
        h('div', null, h('label', { for: 'pv-who', text: 'Previewing as' }), who),
        h('div', { class: 'pv-reset' }, h('button', { type: 'button', class: 'btn secondary small', id: 'pv-reset', text: 'Reset sample data', onclick: function () { if (o.onReset) o.onReset(); } }))));
      controls.appendChild(h('p', { class: 'hint', id: 'pv-note', text: v.note + ' Switching person shows what that person would see.' }));
    }
    function nav(active) {
      return h('nav', { class: 'rc-nav', 'aria-label': 'Recipes preview' },
        h('a', { class: 'rc-tab', href: '#/recipes', id: 'rc-nav-recipes', 'aria-current': active === 'list' ? 'page' : null, text: 'My recipes' }),
        h('a', { class: 'rc-tab', href: '#/recipes/backup', id: 'rc-nav-backup', 'aria-current': active === 'backup' ? 'page' : null, text: 'Backup' }));
    }
    function privateNote() {
      return h('p', { class: 'rc-private-note', id: 'rc-private-note' }, badge('Private to you', 'is-private'), ' ',
        h('span', { class: 'hint', text: 'Preview label only. Real account privacy is not implemented or verified here; this page has no account.' }));
    }
    function photoEl(r, big) {
      if (!r.image) return h('div', { class: 'rc-photo rc-nophoto' + (big ? ' is-big' : ''), role: 'img', 'aria-label': 'No photo' }, h('span', { text: 'No photo' }));
      return h('div', { class: 'rc-photo' + (big ? ' is-big' : '') }, h('img', { src: r.image, alt: 'Photo of ' + r.name, loading: 'lazy' }));
    }

    /* ---------- list ---------- */
    function viewList() {
      var res = api('list'), rs = res.recipes, root = h('div', { class: 'rc-screen' });
      root.appendChild(h('div', { class: 'rc-head' }, h('h1', { text: 'My recipes', 'data-focus': '' }), h('a', { class: 'btn small', href: '#/recipes/new', id: 'rc-new', text: 'New recipe' })));
      root.appendChild(nav('list')); root.appendChild(privateNote());
      if (!rs.length) {
        root.appendChild(h('div', { class: 'card rc-empty', id: 'rc-empty' }, h('h2', { text: 'No recipes yet' }), h('p', { text: 'Add a sample recipe, or try the Backup page to import one of the bundled sample backups.' }),
          h('div', { class: 'rc-actions' }, h('a', { class: 'btn', href: '#/recipes/new', text: 'Add a recipe' }), h('a', { class: 'btn secondary', href: '#/recipes/backup', text: 'Open Backup' }))));
        return root;
      }
      root.appendChild(h('p', { class: 'hint', id: 'rc-count', text: rs.length + (rs.length === 1 ? ' recipe' : ' recipes') }));
      root.appendChild(h('ul', { class: 'rc-grid', id: 'rc-list' }, rs.map(function (r) {
        return h('li', null, h('a', { class: 'rc-card', href: '#/recipes/r/' + encodeURIComponent(r.id) }, photoEl(r, false),
          h('span', { class: 'rc-card-body' }, h('strong', { class: 'rc-card-name', text: r.name }), h('span', { class: 'rc-card-meta', text: r.yield || ' ' }),
            h('span', { class: 'rc-badges' }, r.fav ? badge('Favourite') : null, badge('Private to you', 'is-private')))));
      })));
      return root;
    }

    /* ---------- detail ---------- */
    function viewDetail(id) {
      var res = api('get', { id: id }), root = h('div', { class: 'rc-screen' });
      if (!res.ok) { root.appendChild(h('div', { class: 'card rc-blocked', id: 'rc-missing' }, h('h1', { text: 'Recipe not found', 'data-focus': '' }), h('p', { text: 'This recipe does not exist, or it is not yours to see.' }), h('a', { class: 'btn', href: '#/recipes', text: 'Back to my recipes' }))); return root; }
      var r = res.recipe;
      root.appendChild(h('p', { class: 'rc-back' }, h('a', { href: '#/recipes', text: '← My recipes' })));
      root.appendChild(h('article', { class: 'rc-recipe', id: 'rc-recipe' },
        photoEl(r, true),
        h('h1', { class: 'rc-title', text: r.name, 'data-focus': '' }),
        h('p', { class: 'rc-badges' }, r.fav ? badge('Favourite') : null, badge('Private to you', 'is-private')),
        privateNote2(),
        r.description ? h('p', { class: 'rc-desc', text: r.description }) : null,
        h('dl', { class: 'rc-facts' }, [['Makes', r.yield], ['Prep time', r.prep], ['Cook time', r.cook], ['Total time', r.total]].filter(function (f) { return f[1]; }).map(function (f) { return h('div', { class: 'rc-fact' }, h('dt', { text: f[0] }), h('dd', { text: f[1] })); })),
        h('h2', { text: 'Ingredients' }),
        r.ingredients.length ? h('ul', { class: 'rc-ings', id: 'rc-ings' }, r.ingredients.map(function (x) { return h('li', { text: x }); })) : h('p', { class: 'hint', text: 'No ingredients listed.' }),
        h('h2', { text: 'Method' }),
        r.steps.length ? h('ol', { class: 'rc-steps', id: 'rc-steps' }, r.steps.map(function (x) { return h('li', { text: x }); })) : h('p', { class: 'hint', text: 'No steps listed.' }),
        r.notes ? h('div', null, h('h2', { text: 'Notes' }), h('p', { class: 'rc-notes', text: r.notes })) : null,
        r.source ? h('p', { class: 'rc-source' }, h('strong', { text: 'Where it came from: ' }), h('span', { text: r.source })) : null,
        (r.categories.length || r.tags.length) ? h('p', { class: 'rc-badges' }, r.categories.map(function (c) { return badge(c); }), r.tags.map(function (t) { return badge('#' + t); })) : null));
      var actions = h('div', { class: 'rc-actions rc-noprint', id: 'rc-actions' },
        h('a', { class: 'btn', href: '#/recipes/r/' + encodeURIComponent(r.id) + '/edit', id: 'rc-edit', text: 'Edit' }),
        h('button', { type: 'button', class: 'btn secondary', id: 'rc-fav', 'aria-pressed': r.fav ? 'true' : 'false', text: r.fav ? 'Remove favourite' : 'Make favourite', onclick: function () { api('toggleFav', { id: id }); render(); } }),
        h('button', { type: 'button', class: 'btn secondary', id: 'rc-print', text: 'Print', onclick: function () { window.print(); } }),
        h('button', { type: 'button', class: 'btn danger', id: 'rc-delete', text: 'Delete…', onclick: function () { st.confirmDelete = true; render(); var t = document.getElementById('rc-confirm-h'); if (t) { t.setAttribute('tabindex', '-1'); t.focus(); } } }));
      root.appendChild(actions);
      if (st.confirmDelete) {
        root.appendChild(h('div', { class: 'card rc-confirm rc-noprint', id: 'rc-confirm', role: 'alertdialog', 'aria-labelledby': 'rc-confirm-h' }, h('h2', { id: 'rc-confirm-h', text: 'Delete "' + r.name + '"?' }), h('p', { text: 'This removes the sample recipe and its photo from the preview. It cannot be undone, except by resetting the sample data.' }),
          h('div', { class: 'rc-actions' }, h('button', { type: 'button', class: 'btn danger', id: 'rc-delete-yes', text: 'Delete this recipe', onclick: function () { api('delete', { id: id }); st.confirmDelete = false; toast('Recipe deleted.'); go('#/recipes'); } }),
            h('button', { type: 'button', class: 'btn secondary', id: 'rc-delete-no', text: 'Keep it', onclick: function () { st.confirmDelete = false; render(); var b = document.getElementById('rc-delete'); if (b) b.focus(); } }))));
      }
      root.appendChild(h('section', { class: 'card rc-blocked rc-noprint', id: 'rc-blocked', 'aria-labelledby': 'rc-blocked-h' }, h('h2', { id: 'rc-blocked-h', text: 'Not in this preview' }),
        h('p', { text: 'These Recipe Book features are blocked until the authorship and license questions are answered. There are no controls for them here.' }),
        h('ul', null, BLOCKED.map(function (b) { return h('li', { text: b }); }))));
      return root;
    }
    function privateNote2() { return h('p', { class: 'hint rc-noprint', text: 'Preview label only. Real account privacy is not implemented or verified here.' }); }

    /* ---------- editor ---------- */
    function viewEditor(id) {
      var r = { name: '', description: '', yield: '', prep: '', cook: '', total: '', ingredients: [], steps: [], categories: [], tags: [], notes: '', source: '', image: '', fav: false };
      var root = h('div', { class: 'rc-screen' });
      if (id) { var g = api('get', { id: id }); if (!g.ok) return viewDetail(id); r = g.recipe; }
      var chosenKey = r.image ? '__keep' : '', imageValue = r.image;
      var msg = h('p', { class: 'rc-formmsg', id: 'rc-formmsg', role: 'alert' }), pstatus = h('p', { class: 'hint', id: 'rc-photo-status', role: 'status' }), prev = h('div', { class: 'rc-photo-prev', id: 'rc-photo-prev' });
      function showPrev() { prev.textContent = ''; if (imageValue && C.checkPhoto(imageValue).ok) prev.appendChild(photoEl({ image: imageValue, name: r.name || 'this recipe' }, false)); }
      var sel = h('select', { id: 'f-photo', 'aria-describedby': 'rc-photo-status' }, h('option', { value: '', text: 'No photo' }),
        r.image ? h('option', { value: '__keep', text: 'Keep the current photo', selected: true }) : null,
        Object.keys(PH).map(function (k) { return h('option', { value: k, text: (PH[k].kind === 'bad' ? 'Problem sample: ' : 'Sample photo: ') + PH[k].label }); }));
      sel.addEventListener('change', function () {
        var k = sel.value; msg.textContent = '';
        if (k === '') { imageValue = ''; pstatus.textContent = 'No photo will be saved.'; }
        else if (k === '__keep') { imageValue = r.image; pstatus.textContent = 'The current photo stays.'; }
        else { imageValue = PH[k].dataUrl; var c = C.checkPhoto(imageValue); pstatus.textContent = c.ok ? 'This sample photo is ' + c.w + 'x' + c.h + ' pixels and ' + Math.round(c.bytes / 1024) + ' KB, within the preview limits. ' + PH[k].note : 'This photo will be refused when you save. ' + c.reasons.map(function (x) { return x.message; }).join(' '); }
        showPrev();
      });
      pstatus.textContent = r.image ? 'The current photo stays unless you pick another.' : 'Preview limits: JPEG or PNG, at most 800 pixels on the longest edge and 150 KB. These are preview limits only, not a decided photo policy.';
      showPrev();
      function field(label, idn, el) { return h('div', { class: 'rc-field' }, h('label', { for: idn, text: label }), el); }
      var f = {
        name: h('input', { id: 'f-name', type: 'text', value: r.name, maxlength: 120, required: true }),
        desc: h('textarea', { id: 'f-desc', rows: 3 }), yield_: h('input', { id: 'f-yield', type: 'text', value: r.yield, placeholder: '4 servings' }),
        prep: h('input', { id: 'f-prep', type: 'text', value: r.prep }), cook: h('input', { id: 'f-cook', type: 'text', value: r.cook }), total: h('input', { id: 'f-total', type: 'text', value: r.total }),
        ings: h('textarea', { id: 'f-ings', rows: 6 }), steps: h('textarea', { id: 'f-steps', rows: 6 }), cats: h('input', { id: 'f-cats', type: 'text', value: r.categories.join(', ') }),
        tags: h('input', { id: 'f-tags', type: 'text', value: r.tags.join(', ') }), notes: h('textarea', { id: 'f-notes', rows: 3 }), source: h('input', { id: 'f-source', type: 'text', value: r.source })
      };
      f.desc.value = r.description; f.ings.value = r.ingredients.join('\n'); f.steps.value = r.steps.join('\n'); f.notes.value = r.notes;
      var form = h('form', { class: 'card rc-form', id: 'rc-form', novalidate: true },
        field('Recipe name', 'f-name', f.name), field('A few words about it', 'f-desc', f.desc),
        h('div', { class: 'rc-field' }, h('label', { for: 'f-photo', text: 'Photo (sample photos only)' }), sel, pstatus, prev),
        h('div', { class: 'rc-pair' }, field('Makes', 'f-yield', f.yield_), field('Prep time', 'f-prep', f.prep), field('Cook time', 'f-cook', f.cook), field('Total time', 'f-total', f.total)),
        field('Ingredients (one per line)', 'f-ings', f.ings), field('Method (one step per line)', 'f-steps', f.steps),
        h('div', { class: 'rc-pair' }, field('Categories (commas between)', 'f-cats', f.cats), field('Tags (commas between)', 'f-tags', f.tags)),
        field('Notes', 'f-notes', f.notes), field('Where it came from (text)', 'f-source', f.source), msg,
        h('div', { class: 'rc-actions' }, h('button', { type: 'submit', class: 'btn', id: 'rc-save', text: 'Save to the preview' }), h('a', { class: 'btn secondary', id: 'rc-cancel', href: id ? '#/recipes/r/' + encodeURIComponent(id) : '#/recipes', text: 'Cancel' })));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var rec = { name: f.name.value, description: f.desc.value, yield: f.yield_.value, prep: f.prep.value, cook: f.cook.value, total: f.total.value, ingredients: lines(f.ings.value), steps: lines(f.steps.value),
          categories: csv(f.cats.value), tags: csv(f.tags.value), notes: f.notes.value, source: f.source.value, image: imageValue, fav: r.fav, parts: r.parts || [] };
        var res = id ? api('edit', { id: id, recipe: rec }) : api('create', { recipe: rec });
        if (!res.ok) { msg.textContent = (res.code === 'photo' ? 'The photo was refused, so nothing was saved. ' : 'Nothing was saved. ') + res.message; msg.focus && msg.setAttribute('tabindex', '-1'); msg.focus(); return; }
        toast(id ? 'Changes saved to the preview.' : 'Recipe added to the preview.'); go('#/recipes/r/' + encodeURIComponent(res.recipe.id));
      });
      root.appendChild(h('p', { class: 'rc-back' }, h('a', { href: id ? '#/recipes/r/' + encodeURIComponent(id) : '#/recipes', text: '← Back' })));
      root.appendChild(h('h1', { text: id ? 'Edit this recipe' : 'A new recipe', 'data-focus': '' })); root.appendChild(form);
      return root;
    }

    /* ---------- backup ---------- */
    function viewBackup() {
      var root = h('div', { class: 'rc-screen' });
      root.appendChild(h('div', { class: 'rc-head' }, h('h1', { text: 'Backup', 'data-focus': '' })));
      root.appendChild(nav('backup'));
      root.appendChild(h('div', { class: 'card rc-honest', id: 'rc-honest' }, h('p', { class: 'rc-strong', text: 'Preview only. This is not a migration and not a claim of full compatibility with the original Recipe Book.' }),
        h('p', { text: 'Only the bundled sample backups below can be tried. There is no file upload, so no real backup can be read. The preview keeps these recipe fields: name, description, makes, times, ingredients, method, categories, tags, notes, source, photo, favourite, plus id, update time and linked recipes, which are kept in the data and written back on export but not shown on any screen. Anything else found in a backup is listed in the import report as ignored. Deletion records, timers and sign-in data are not part of the original backup file and are not handled.' })));
      // export
      var ex = h('section', { class: 'card', 'aria-labelledby': 'rc-ex-h' }, h('h2', { id: 'rc-ex-h', text: 'Export' }), h('p', { text: 'Writes the recipes of the person you are previewing as, in the original backup file shape, including photos.' }));
      var exOut = h('div', { id: 'rc-export-out', role: 'status' });
      ex.appendChild(h('div', { class: 'rc-actions' }, h('button', { type: 'button', class: 'btn', id: 'rc-export', text: 'Export my recipes', onclick: function () {
        var r = api('export'); st.lastExport = JSON.stringify(r.backup, null, 1);
        var withPhoto = r.backup.recipes.filter(function (x) { return x.image; }).length;
        exOut.textContent = ''; add(exOut, [h('p', { id: 'rc-export-summary', text: 'Exported ' + r.backup.recipes.length + (r.backup.recipes.length === 1 ? ' recipe' : ' recipes') + ', ' + withPhoto + ' with a photo, ' + Math.round(st.lastExport.length / 1024) + ' KB of text. Held in memory only until you reload.' }),
          h('div', { class: 'rc-actions' }, h('button', { type: 'button', class: 'btn secondary', id: 'rc-download', text: 'Download as a file', onclick: function () { download(st.lastExport); } }), h('button', { type: 'button', class: 'btn secondary', id: 'rc-use-export', text: 'Use this export in the import test below', onclick: function () { st.picked = '__export'; st.report = null; st.result = null; render(); } }))]);
      } })));
      ex.appendChild(exOut); root.appendChild(ex);
      // import
      var im = h('section', { class: 'card', 'aria-labelledby': 'rc-im-h' }, h('h2', { id: 'rc-im-h', text: 'Import a bundled sample backup' }));
      var pick = h('select', { id: 'rc-pick' }, FX.list().map(function (b) { return h('option', { value: b.id, text: b.label, selected: st.picked === b.id }); }), st.lastExport ? h('option', { value: '__export', text: 'My last export (this preview)', selected: st.picked === '__export' }) : null);
      var what = h('p', { class: 'hint', id: 'rc-pick-what' });
      function whatText() { if (pick.value === '__export') return 'The text you exported a moment ago, to try a round trip.'; var b = FX.list().filter(function (x) { return x.id === pick.value; })[0]; return b ? b.what : ''; }
      what.textContent = whatText();
      pick.addEventListener('change', function () { st.picked = pick.value; st.report = null; st.result = null; st.decisions = {}; what.textContent = whatText(); render(); });
      im.appendChild(h('label', { for: 'rc-pick', text: 'Sample backup' })); im.appendChild(pick); im.appendChild(what);
      im.appendChild(h('div', { class: 'rc-actions' }, h('button', { type: 'button', class: 'btn', id: 'rc-check', text: 'Check this backup', onclick: function () {
        st.importText = pick.value === '__export' ? st.lastExport : FX.text(pick.value); st.decisions = {}; st.result = null;
        var r = api('importAnalyze', { text: st.importText }); st.report = r; render(); setTimeout(function () { var t = document.getElementById('rc-report-h'); if (t) { t.setAttribute('tabindex', '-1'); t.focus(); } }, 0);
      } })));
      root.appendChild(im);
      if (st.report) root.appendChild(reportView());
      if (st.result) root.appendChild(resultView());
      return root;
    }
    function download(text) {
      var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: 'sample-recipes-backup.json' }); document.body.appendChild(a); a.click(); a.remove();
    }
    function reportView() {
      var r = st.report, box = h('section', { class: 'card rc-report', id: 'rc-report', 'aria-labelledby': 'rc-report-h' }, h('h2', { id: 'rc-report-h', text: 'Import check' }));
      if (!r.ok) { box.appendChild(h('p', { class: 'rc-err', text: r.message })); return box; }
      if (r.fileError) { box.appendChild(h('p', { class: 'rc-err', id: 'rc-file-error', role: 'alert', text: r.fileError })); box.appendChild(h('p', { text: 'The whole file was refused. Nothing was read and nothing was imported.' })); return box; }
      var c = r.counts;
      box.appendChild(h('p', { id: 'rc-counts', text: c.total + ' records: ' + c.new + ' new, ' + c.duplicate + ' already in your book, ' + c['duplicate-in-file'] + ' repeated inside the file, ' + c.invalid + ' cannot be imported. ' + c.photoRejected + ' with a photo that cannot be kept; ' + c.ignoredFields + ' with fields the preview ignores.' }));
      var needed = r.items.filter(function (i) { return i.needsChoice; });
      var invalid = needed.filter(function (i) { return i.status === 'invalid'; });
      if (invalid.length) box.appendChild(h('div', { class: 'rc-actions' }, h('button', { type: 'button', class: 'btn secondary small', id: 'rc-skip-invalid', text: 'Skip all ' + invalid.length + ' records that cannot be imported', onclick: function () { invalid.forEach(function (i) { st.decisions[i.index] = 'skip'; }); render(); } })));
      box.appendChild(h('ol', { class: 'rc-items', id: 'rc-items' }, r.items.map(function (it) {
        var li = h('li', { class: 'rc-item is-' + it.status, 'data-index': String(it.index) },
          h('p', { class: 'rc-item-head' }, h('strong', { text: (it.index + 1) + '. ' + it.name }), ' ', badge(STATUS_TEXT[it.status], it.status === 'invalid' ? 'is-bad' : '')));
        if (it.errors.length) li.appendChild(h('ul', { class: 'rc-reasons' }, it.errors.map(function (e) { return h('li', { text: e }); })));
        if (it.photo.status === 'ok') li.appendChild(h('p', { class: 'hint', text: 'Photo: kept (' + it.photo.w + 'x' + it.photo.h + ', ' + Math.round(it.photo.bytes / 1024) + ' KB).' }));
        if (it.photo.status === 'rejected') li.appendChild(h('div', { class: 'rc-photoprob' }, h('p', { class: 'rc-strong', text: 'Photo cannot be kept:' }), h('ul', { class: 'rc-reasons' }, it.photo.reasons.map(function (e) { return h('li', { text: e.message }); }))));
        if (it.ignored.length) li.appendChild(h('p', { class: 'hint', text: 'Fields the preview ignores for this record: ' + it.ignored.join(', ') + '.' }));
        if (it.needsChoice) {
          var rej = it.photo.status === 'rejected', cur = st.decisions[it.index] || '', sid = 'rc-choice-' + it.index;
          var s = h('select', { id: sid, 'data-index': String(it.index) }, h('option', { value: '', text: 'Choose…' }), it.choices.map(function (ch) {
            var t = CHOICE_TEXT[ch]; if (rej && ch !== 'skip') t += ' (without the photo)'; return h('option', { value: ch, text: t, selected: cur === ch });
          }));
          s.addEventListener('change', function () { if (s.value) st.decisions[it.index] = s.value; else delete st.decisions[it.index]; render(); });
          li.appendChild(h('div', { class: 'rc-field' }, h('label', { for: sid, text: 'What should happen to "' + it.name + '"?' }), s));
        } else li.appendChild(h('p', { class: 'hint', text: 'Will be imported as a new recipe.' }));
        return li;
      })));
      var missing = needed.filter(function (i) { return !st.decisions[i.index]; }).length;
      box.appendChild(h('p', { class: 'hint', id: 'rc-need', role: 'status', text: missing ? missing + ' record' + (missing === 1 ? ' needs' : 's need') + ' a choice before anything can be imported.' : 'Every choice is made. Nothing has been imported yet.' }));
      var go_ = h('button', { type: 'button', class: 'btn', id: 'rc-apply', text: 'Import now', disabled: missing ? true : null, onclick: function () {
        var res = api('importApply', { text: st.importText, decisions: st.decisions });
        if (!res.ok) { toast(res.message); return; }
        st.result = res; st.report = null; st.decisions = {}; render(); setTimeout(function () { var t = document.getElementById('rc-result-h'); if (t) { t.setAttribute('tabindex', '-1'); t.focus(); } }, 0);
      } });
      box.appendChild(h('div', { class: 'rc-actions' }, go_, h('button', { type: 'button', class: 'btn secondary', id: 'rc-cancel-import', text: 'Cancel import', onclick: function () { st.report = null; st.decisions = {}; render(); } })));
      return box;
    }
    function resultView() {
      var r = st.result, box = h('section', { class: 'card rc-result', id: 'rc-result', 'aria-labelledby': 'rc-result-h' }, h('h2', { id: 'rc-result-h', text: 'Import finished' }));
      box.appendChild(h('p', { id: 'rc-result-summary', text: r.added.length + ' added, ' + r.replaced.length + ' replaced, ' + r.skipped.length + ' skipped by your choice. ' + r.photosNotImported.length + ' photos were not imported.' }));
      function list(title, items, fmt) { if (!items.length) return null; return h('div', null, h('h3', { text: title }), h('ul', null, items.map(function (x) { return h('li', { text: fmt(x) }); }))); }
      add(box, [list('Added', r.added, function (x) { return x.name; }), list('Replaced', r.replaced, function (x) { return x.name; }), list('Skipped', r.skipped, function (x) { return x.name + ' (' + STATUS_TEXT[x.why] + ')'; }),
        list('Photos not imported', r.photosNotImported, function (x) { return x.name + ': ' + x.reasons.join(' '); }), list('Fields ignored', r.ignoredFields, function (x) { return x.name + ': ' + x.fields.join(', '); })]);
      box.appendChild(h('div', { class: 'rc-actions' }, h('a', { class: 'btn', href: '#/recipes', id: 'rc-see', text: 'See my recipes' })));
      return box;
    }

    /* render(fromRoute): a route change moves focus to the new heading (not on the very first load, so the skip link stays first).
       An in-place redraw (a choice made, a button pressed) puts focus and scroll position back where they were. */
    function render(fromRoute) {
      var r = route(), keepId = !fromRoute && document.activeElement && main.contains(document.activeElement) ? document.activeElement.id : '', y = window.scrollY;
      main.textContent = '';
      var el = r.name === 'new' ? viewEditor(null) : r.name === 'edit' ? viewEditor(r.id) : r.name === 'detail' ? viewDetail(r.id) : r.name === 'backup' ? viewBackup() : viewList();
      if (r.name !== 'detail') st.confirmDelete = false;
      main.appendChild(el);
      if (fromRoute === true && !st.first) focusHead();
      else if (keepId) { var k = document.getElementById(keepId); if (k) { k.focus({ preventScroll: true }); window.scrollTo(0, y); } }
      st.first = false;
    }
    st.first = true;
    window.addEventListener('hashchange', function () { render(true); });
    drawControls(); render(false);
    return { state: st, render: render };
  }
  root.RecipesUI = { mount: mount };
})(typeof self !== 'undefined' ? self : this);

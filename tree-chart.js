/*
 * tree-chart.js — draws the family tree with the open-source "family-chart" library.
 *
 *   family-chart v0.9.0  (c) 2021 Donat Soric, MIT License  (see vendor/LICENSE-family-chart.txt)
 *   d3 v7.9.0            (c) 2010-2023 Mike Bostock, ISC License (see vendor/LICENSE-d3.txt)
 *
 * What this file does:  turns your people (rows from the Appwrite `people` table) into the
 * shape the library wants, draws them, and lets the person tap, drag and zoom.
 *
 * What this file does NOT do:  save anything, call Appwrite, check who may see what, or
 * send data anywhere. The library has no network or storage code at all. Saving and
 * permissions stay in app.js and the family-api Function, exactly as before.
 *
 * Limits of the library that this file works around (nothing is silently dropped):
 *  - A person can have at most TWO parents on screen. People with more (for example birth
 *    parents plus adoptive parents) are drawn with one set at a time. The "lens" picks the
 *    set ("birth" or "raised"), every card says how many links are not drawn, and the
 *    side panel in app.js always lists every parent with its kind.
 *  - The library draws one person's ancestors, descendants and partners at a time.
 *    Everyone else is one tap (or the "Jump to" menu) away.
 *  - All parent links look the same on screen. The kind (birth, adoptive, step, foster,
 *    guardian) is shown as text, not as a different line style.
 *  - Card text is put into the page as HTML by the library, so every piece of text is
 *    escaped here first (esc()).
 */
(function () {
  'use strict';

  var KINDS = ['birth', 'adoptive', 'step', 'foster', 'guardian'];
  var KIND_LABEL = { birth: 'Birth parent', adoptive: 'Adoptive parent', step: 'Step-parent', foster: 'Foster parent', guardian: 'Guardian' };
  var KIND_SHORT = { birth: 'Birth', adoptive: 'Adoptive', step: 'Step', foster: 'Foster', guardian: 'Guardian' };

  /* ---------- small helpers ---------- */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // parentKinds is stored as a small JSON text like {"<parentId>":"adoptive"}. Anything unreadable counts as "birth".
  function parseKinds(p) {
    var raw = p && p.parentKinds, out = {};
    if (!raw) return out;
    try {
      var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        Object.keys(o).forEach(function (k) { if (KINDS.indexOf(o[k]) !== -1) out[k] = o[k]; });
      }
    } catch (e) { /* keep {} */ }
    return out;
  }

  function genderCode(g) { return g === 'Female' ? 'F' : g === 'Male' ? 'M' : ''; }

  // Priority of kinds for each lens. "birth" shows birth parents when a person has any; "raised" shows
  // the people who raised them (adoptive, guardian, foster, step) when a person has any.
  var LENS = {
    birth:  { first: ['birth'], rest: ['adoptive', 'guardian', 'foster', 'step'] },
    raised: { first: ['adoptive', 'guardian', 'foster', 'step'], rest: ['birth'] }
  };

  /* ---------- people -> library data ---------- */
  // Returns { data, byId, hiddenParents, hiddenKids } . `people` are Appwrite rows (use $id).
  function toChartData(people, lens) {
    var L = LENS[lens] || LENS.birth;
    var byId = {};
    people.forEach(function (p) { byId[p.$id] = p; });

    // partners, made two-sided, without self-links
    var partners = {};
    people.forEach(function (p) { partners[p.$id] = {}; });
    people.forEach(function (p) {
      (p.partnerIds || []).forEach(function (q) {
        if (q !== p.$id && byId[q]) { partners[p.$id][q] = true; partners[q][p.$id] = true; }
      });
    });

    var shown = {}, hiddenParents = {};
    // Does `ancestor` already appear above `person` in what we have chosen so far? (cycle guard)
    function isAbove(ancestor, person) {
      var seen = {}, stack = (shown[person] || []).slice();
      while (stack.length) {
        var id = stack.pop();
        if (id === ancestor) return true;
        if (seen[id]) continue; seen[id] = true;
        (shown[id] || []).forEach(function (x) { stack.push(x); });
      }
      return false;
    }
    people.forEach(function (c) {
      var kinds = parseKinds(c);
      var links = (c.parentIds || []).filter(function (id) { return id !== c.$id && byId[id]; })
        .map(function (id) { return { id: id, kind: kinds[id] || 'birth' }; });
      var first = links.filter(function (l) { return L.first.indexOf(l.kind) !== -1; });
      var pool = first.length ? first : links;
      var order = L.first.concat(L.rest);
      pool = pool.slice().sort(function (a, b) { return order.indexOf(a.kind) - order.indexOf(b.kind); });
      var pick = [], hide = [];
      links.forEach(function (l) { hide.push(l); });
      pool.forEach(function (l) {
        if (pick.length >= 2) return;
        // a parent who is also this person's partner, or who would make a loop, is never drawn as a parent
        if (partners[c.$id][l.id]) return;
        pick.push(l);
      });
      shown[c.$id] = pick.map(function (l) { return l.id; });
      hiddenParents[c.$id] = hide.filter(function (l) { return shown[c.$id].indexOf(l.id) === -1; });
    });
    // loop guard: drop any link that points back down at its own descendant
    people.forEach(function (c) {
      shown[c.$id] = shown[c.$id].filter(function (pid) {
        var ok = !isAbove(c.$id, pid);
        if (!ok) hiddenParents[c.$id].push({ id: pid, kind: parseKinds(c)[pid] || 'birth' });
        return ok;
      });
    });

    var kids = {}, hiddenKids = {};
    people.forEach(function (c) {
      shown[c.$id].forEach(function (pid) { (kids[pid] = kids[pid] || []).push(c.$id); });
      hiddenParents[c.$id].forEach(function (l) { hiddenKids[l.id] = (hiddenKids[l.id] || 0) + 1; });
    });

    var data = people.map(function (p) {
      return {
        id: p.$id,
        data: {
          name: p.name || 'Unnamed',
          gender: genderCode(p.gender),
          birthday: p.birthday || '',
          moreParents: hiddenParents[p.$id].length,
          moreKids: hiddenKids[p.$id] || 0
        },
        rels: { parents: shown[p.$id].slice(), spouses: Object.keys(partners[p.$id]), children: (kids[p.$id] || []).slice() }
      };
    });
    return { data: data, byId: byId, hiddenParents: hiddenParents, hiddenKids: hiddenKids };
  }

  /* ---------- loading the library (only when the tree is opened) ---------- */
  var loading = null;
  function addScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function addCss(href) {
    return new Promise(function (resolve) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href;
      l.onload = function () { resolve(); };
      l.onerror = function () { resolve(); };   // the tree still works, only unstyled
      document.head.appendChild(l);
    });
  }
  function loadLibraries() {
    if (window.f3 && window.d3) return Promise.resolve();
    if (loading) return loading;
    var v = (window.FAMILY_CONFIG && window.FAMILY_CONFIG.version) || '1';
    loading = addScript('vendor/d3.min.js?v=' + v)
      .then(function () { return addScript('vendor/family-chart.min.js?v=' + v); })
      .then(function () { return addCss('vendor/family-chart.css?v=' + v); })
      .catch(function (e) { loading = null; throw e; });
    return loading;
  }

  /* ---------- drawing ---------- */
  // opts: { people, mainId, lens, avatar(person) -> element, onSelect(personId), onUpdate({shown,total}) }
  async function mount(container, opts) {
    await loadLibraries();
    var f3 = window.f3;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var people = opts.people, lens = opts.lens || 'birth', main = opts.mainId;
    var built = toChartData(people, lens);
    var chart, card, alive = true;

    container.classList.add('f3');
    container.textContent = '';

    function cardHtml(d) {
      var p = d.data.data, id = d.data.id;
      var extra = [];
      if (p.moreParents) extra.push('+' + p.moreParents + (p.moreParents === 1 ? ' parent' : ' parents') + ' not drawn');
      if (p.moreKids) extra.push('+' + p.moreKids + (p.moreKids === 1 ? ' child' : ' children') + ' not drawn');
      return '<div class="card-inner f3-pcard" role="button" tabindex="0" data-person="' + esc(id) + '" aria-label="' + esc(p.name) + '. Show family.">' +
        '<span class="f3-av" data-av="' + esc(id) + '"></span>' +
        '<span class="f3-txt"><span class="f3-nm">' + esc(p.name) + '</span>' +
        (extra.length ? '<span class="f3-more">' + esc(extra.join(' · ')) + '</span>' : '') + '</span></div>';
    }

    function setData(newPeople, newLens, newMain) {
      people = newPeople || people; lens = newLens || lens; main = newMain || main;
      built = toChartData(people, lens);
    }

    function build() {
      chart = f3.createChart(container, built.data)
        .setTransitionTime(reduce ? 0 : 500)
        .setCardXSpacing(190).setCardYSpacing(110)
        .setOrientationVertical()
        .setSingleParentEmptyCard(false)
        .setShowSiblingsOfMain(true);
      card = chart.setCardHtml()
        .setStyle('default')
        .setMiniTree(false)
        .setCardDim({ w: 170, h: 56, text_x: 0, text_y: 0, img_w: 0, img_h: 0, img_x: 0, img_y: 0 })
        .setCardInnerHtmlCreator(cardHtml)
        .setOnCardClick(function (e, d) { go(d.data.id, true); })
        .setOnCardUpdate(function () {
          var host = this;
          var slots = host.querySelectorAll('.f3-av');
          for (var i = 0; i < slots.length; i++) {
            var s = slots[i];
            if (s.firstChild) continue;
            var person = built.byId[s.getAttribute('data-av')];
            if (person && opts.avatar) s.appendChild(opts.avatar(person));
          }
        });
      chart.setAfterUpdate(report);
      chart.updateMainId(main);
      chart.updateTree({ initial: true });
    }

    function report() {
      if (!alive || !opts.onUpdate) return;
      try {
        var t = chart.store.getTree();
        var ids = {};
        (t && t.data || []).forEach(function (n) { if (n.data && n.data.id && built.byId[n.data.id]) ids[n.data.id] = true; });
        opts.onUpdate({ shown: Object.keys(ids).length, total: people.length });
      } catch (e) { /* the counter is a nicety */ }
    }

    function go(id, fromClick) {
      if (!built.byId[id]) return;
      main = id;
      chart.updateMainId(id);
      chart.updateTree({});
      if (opts.onSelect) opts.onSelect(id, !!fromClick);
    }

    container.addEventListener('keydown', function (ev) {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target && ev.target.classList && ev.target.classList.contains('f3-pcard')) {
        ev.preventDefault(); ev.target.click();
      }
    });

    build();

    return {
      focus: function (id) { go(id, false); },
      setLens: function (l) { setData(null, l, null); chart.updateData(built.data); chart.updateMainId(main); chart.updateTree({}); },
      zoom: function (amount) { f3.handlers.manualZoom({ amount: amount, svg: chart.svg, transition_time: reduce ? 0 : 250 }); },
      fit: function () { chart.updateTree({ tree_position: 'fit' }); },
      destroy: function () { alive = false; container.textContent = ''; container.classList.remove('f3'); }
    };
  }

  window.FamilyTreeChart = {
    mount: mount,
    toChartData: toChartData,      // exported so it can be tested without a browser
    parseKinds: parseKinds,
    esc: esc,
    KINDS: KINDS,
    KIND_LABEL: KIND_LABEL,
    KIND_SHORT: KIND_SHORT
  };
}());

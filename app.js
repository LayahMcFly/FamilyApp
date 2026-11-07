/*
 * Family Circle — app.js
 * Plain JavaScript (no build step). Talks to Appwrite through the official Web SDK
 * (pinned to 29.2.0 in index.html). The file is arranged in numbered sections:
 *   1 Helpers   2 Setup checks   3 Appwrite connection   4 Appearance   5 State & errors
 *   6 Media loading   7 Auth screens   8 App shell & router   9 Posts & feeds
 *   10 Create post   11 Family   12 Settings   13 Start-up
 *
 * SECURITY NOTES FOR THE CURIOUS
 * - Nothing typed by a person is ever inserted as HTML. We always use textContent
 *   (via the h() helper), so a post cannot inject a script.
 * - Who may read or change data is decided by Appwrite permissions on the server
 *   (see the Setup Guide). The checks in this file only decide what to SHOW.
 */
(function () {
  'use strict';

  var CFG = window.FAMILY_CONFIG || {};
  var L = CFG.limits || {};
  var T = CFG.tables || {};
  var root = document.getElementById('app');

  /* =====================================================================
   * 1. HELPERS
   * ===================================================================== */

  // h('div', {class:'x', onclick: fn}, 'text', childElement) -> element. Text is always escaped.
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    home: ['M3 11.5 12 4l9 7.5', 'M5.5 10v10h13V10'],
    plus: ['M12 5v14', 'M5 12h14'],
    shorts: ['M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M10.5 9.5v5l4-2.5z'],
    bookmark: ['M6 4h12v17l-6-4-6 4z'],
    users: ['M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20', 'M10 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z', 'M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3', 'M15.5 4.8a3.2 3.2 0 0 1 0 6.1'],
    settings: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 5v4', 'M8 15v4'],
    heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
    comment: ['M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'],
    edit: ['M4 20h4L19 9l-4-4L4 16z'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13']
  };
  function icon(name) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    (ICONS[name] || []).forEach(function (d) {
      var p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    });
    return s;
  }

  function toast(msg) {
    var box = document.getElementById('toasts');
    var t = h('div', { class: 'toast', text: msg });
    box.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4500);
  }

  function alertBox(kind, msg) { return h('div', { class: 'alert ' + kind, role: kind === 'error' ? 'alert' : 'status', text: msg }); }
  function showAlert(holder, kind, msg) { clear(holder); if (msg) holder.appendChild(alertBox(kind, msg)); }

  // Runs fn while the button shows a busy state; prevents double-clicks.
  async function busy(btn, fn, busyText) {
    if (btn.disabled) return;
    var label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (busyText) btn.textContent = busyText;
    try { return await fn(); }
    finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = label;
    }
  }

  function field(id, label, type, opts) {
    opts = opts || {};
    var input = type === 'textarea'
      ? h('textarea', { id: id, name: id, rows: opts.rows || 4, maxlength: opts.maxlength, placeholder: opts.placeholder, required: opts.required })
      : h('input', { id: id, name: id, type: type, autocomplete: opts.autocomplete, maxlength: opts.maxlength, minlength: opts.minlength, placeholder: opts.placeholder, required: opts.required, value: opts.value });
    return { wrap: h('div', null, h('label', { for: id, text: label }), input, opts.hint ? h('div', { class: 'hint', text: opts.hint }) : null), input: input };
  }

  function timeAgo(iso) {
    var d = new Date(iso), s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 7 * 86400) return Math.floor(s / 86400) + ' d ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function fmtMB(bytes) { return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB'; }
  function baseUrl() { return location.origin + location.pathname; }   // this page, without ?query or #hash
  function initials(name) { var p = String(name || '?').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }

  /* =====================================================================
   * 2. SETUP CHECKS (friendly screens instead of a broken page)
   * ===================================================================== */

  function configProblems() {
    var p = [];
    if (!CFG.endpoint || /REGION|YOUR_/i.test(CFG.endpoint)) p.push('endpoint (your Appwrite API endpoint)');
    if (!CFG.projectId || /YOUR_/i.test(CFG.projectId)) p.push('projectId (your Appwrite project ID)');
    if (!CFG.databaseId) p.push('databaseId');
    if (!CFG.bucketId) p.push('bucketId');
    ['profiles', 'posts', 'comments', 'reactions', 'bookmarks'].forEach(function (k) { if (!T[k]) p.push('tables.' + k); });
    return p;
  }

  function screenMessage(title, paragraphs, extra) {
    clear(root).appendChild(h('div', { class: 'center-card' },
      h('img', { src: 'favicon.svg', width: 56, height: 56, alt: '' }),
      h('h1', { text: title }),
      paragraphs.map(function (t) { return h('p', { class: 'muted', text: t }); }),
      extra || null));
  }

  /* =====================================================================
   * 3. APPWRITE CONNECTION
   * ===================================================================== */

  var A, client, account, teams, db, storage, Query, ID, Permission, Role;
  function initAppwrite() {
    A = window.Appwrite;
    client = new A.Client().setEndpoint(CFG.endpoint).setProject(CFG.projectId);
    account = new A.Account(client);
    teams = new A.Teams(client);
    db = new A.TablesDB(client);
    storage = new A.Storage(client);
    Query = A.Query; ID = A.ID; Permission = A.Permission; Role = A.Role;
  }

  // Convenience wrappers so every call looks the same.
  function listRows(table, queries) { return db.listRows({ databaseId: CFG.databaseId, tableId: T[table], queries: queries || [] }); }
  function getRow(table, id) { return db.getRow({ databaseId: CFG.databaseId, tableId: T[table], rowId: id }); }
  function createRow(table, id, data, permissions) { return db.createRow({ databaseId: CFG.databaseId, tableId: T[table], rowId: id, data: data, permissions: permissions }); }
  function updateRow(table, id, data) { return db.updateRow({ databaseId: CFG.databaseId, tableId: T[table], rowId: id, data: data }); }
  function deleteRow(table, id) { return db.deleteRow({ databaseId: CFG.databaseId, tableId: T[table], rowId: id }); }

  async function listAllRows(table, baseQueries, max) {
    var out = [], cursor = null;
    while (out.length < max) {
      var q = baseQueries.slice();
      q.push(Query.limit(100));
      if (cursor) q.push(Query.cursorAfter(cursor));
      var res = await listRows(table, q);
      out = out.concat(res.rows);
      if (res.rows.length < 100) break;
      cursor = res.rows[res.rows.length - 1].$id;
    }
    return out;
  }

  // Permissions that the APP attaches to rows/files it creates (a browser can only
  // grant roles it holds itself: "my user" and "my team").
  function permsShared(uid) {
    return [Permission.read(Role.team(CFG.teamId)), Permission.update(Role.user(uid)), Permission.delete(Role.user(uid))];
  }
  function permsReaction(uid) {
    return [Permission.read(Role.team(CFG.teamId)), Permission.delete(Role.user(uid))];
  }
  function permsPrivate(uid) {
    return [Permission.read(Role.user(uid)), Permission.update(Role.user(uid)), Permission.delete(Role.user(uid))];
  }

  /* =====================================================================
   * 4. APPEARANCE (light/dark/system + preset + accent)
   * ===================================================================== */

  var PREF_KEY = 'fc_appearance';
  var MODES = ['system', 'light', 'dark'];
  var PRESETS = [
    { id: 'default', name: 'Default', note: 'Clean blue and slate' },
    { id: 'neutral', name: 'Neutral', note: 'Cream, sage, warm gray' },
    { id: 'girly', name: 'Girly', note: 'Blush, lavender, soft corners' },
    { id: 'boyish', name: 'Boyish', note: 'Navy, forest, charcoal' }
  ];
  var ACCENTS = [
    { name: 'Blue', hex: '#2563eb' }, { name: 'Teal', hex: '#0f766e' }, { name: 'Green', hex: '#15803d' },
    { name: 'Amber', hex: '#b45309' }, { name: 'Rose', hex: '#be185d' }, { name: 'Purple', hex: '#7c3aed' }, { name: 'Slate', hex: '#475569' }
  ];
  var prefs = loadLocalPrefs();

  function sanitizePrefs(p) {
    p = p || {};
    return {
      mode: MODES.indexOf(p.mode) >= 0 ? p.mode : 'system',
      preset: PRESETS.some(function (x) { return x.id === p.preset; }) ? p.preset : 'default',
      accent: /^#[0-9a-fA-F]{6}$/.test(p.accent || '') ? p.accent.toLowerCase() : ''
    };
  }
  function loadLocalPrefs() {
    try { return sanitizePrefs(JSON.parse(localStorage.getItem(PREF_KEY))); } catch (e) { return sanitizePrefs(); }
  }
  function lum(hex) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(hex, toward, amt) {
    var out = '#';
    for (var i = 1; i <= 5; i += 2) {
      var a = parseInt(hex.substr(i, 2), 16), b = parseInt(toward.substr(i, 2), 16);
      out += ('0' + Math.round(a + (b - a) * amt).toString(16)).slice(-2);
    }
    return out;
  }
  function applyPrefs() {
    var el = document.documentElement;
    el.setAttribute('data-theme', prefs.mode);
    el.setAttribute('data-preset', prefs.preset);
    ['--accent', '--accent-text', '--on-accent'].forEach(function (v) { el.style.removeProperty(v); });
    if (!prefs.accent) return;
    var dark = prefs.mode === 'dark' || (prefs.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var surface = (getComputedStyle(el).getPropertyValue('--surface') || (dark ? '#131c2e' : '#ffffff')).trim();
    if (!/^#[0-9a-f]{6}$/i.test(surface)) surface = dark ? '#131c2e' : '#ffffff';
    var text = prefs.accent, n = 0;
    while (contrast(text, surface) < 4.5 && n++ < 20) text = mix(text, dark ? '#ffffff' : '#000000', 0.1);
    el.style.setProperty('--accent', prefs.accent);
    el.style.setProperty('--accent-text', text);
    el.style.setProperty('--on-accent', contrast(prefs.accent, '#ffffff') >= contrast(prefs.accent, '#000000') ? '#ffffff' : '#000000');
  }
  var syncTimer = null;
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode: ignore */ }
    applyPrefs();
    if (S.user) {                                    // sync to the signed-in account (debounced)
      clearTimeout(syncTimer);
      syncTimer = setTimeout(function () {
        var merged = Object.assign({}, S.user.prefs || {}, { appearance: prefs });
        account.updatePrefs({ prefs: merged }).then(function (u) { S.user = u; }).catch(function () { /* local copy still works */ });
      }, 700);
    }
  }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onMq = function () { if (prefs.mode === 'system') applyPrefs(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
  }

  /* =====================================================================
   * 5. STATE & FRIENDLY ERRORS
   * ===================================================================== */

  var S = {
    user: null, isMember: false, isOwner: false, memberError: null,
    profile: null,                 // my profile row
    profiles: new Map(),           // userId -> profile row (cache)
    saved: new Map(),              // postId -> my bookmark row id
    avatarUrls: new Map(),         // fileId -> Promise<objectURL>
    blobs: [],                     // object URLs for the current view (revoked on navigation)
    io: null,                      // IntersectionObserver for lazy media
    jwt: null, jwtAt: 0,
    nav: 0,                        // increases on every navigation; async work compares to it
    notice: null, pending: null, authMode: 'signin'
  };

  function resetState() {
    revokeBlobs();
    S.avatarUrls.forEach(function (p) { p.then(function (u) { URL.revokeObjectURL(u); }).catch(function () {}); });
    S.avatarUrls = new Map();
    S.user = null; S.isMember = false; S.isOwner = false; S.memberError = null; S.profile = null;
    S.profiles = new Map(); S.saved = new Map(); S.jwt = null; S.jwtAt = 0; S.notice = null; S.pending = null;
    clearTimeout(syncTimer);
    try { sessionStorage.clear(); } catch (e) {}
    try { localStorage.removeItem('cookieFallback'); } catch (e) {}   // the SDK's session fallback
  }

  function friendly(e) {
    if (!e) return 'Something went wrong. Please try again.';
    var msg = e.message || '', type = e.type || '', code = e.code;
    if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg)) {
      return "We couldn't reach Appwrite. Check your internet connection. If this keeps happening, the endpoint in config.js may be wrong or this website's hostname may not be added as a Web platform in Appwrite.";
    }
    var byType = {
      user_invalid_credentials: "That email and password don't match. Please try again.",
      user_already_exists: 'There is already an account with that email. Try signing in instead.',
      user_not_found: "We couldn't find that account.",
      user_invalid_token: 'That link is no longer valid. It may have expired or already been used.',
      user_blocked: 'This account is blocked. Please ask the family admin.',
      general_rate_limit_exceeded: 'Too many tries in a short time. Please wait a minute and try again.',
      password_recently_used: 'Please choose a password you have not used recently.',
      password_personal_data: "That password is too close to your name or email. Please choose another.",
      project_paused: 'The Appwrite project is paused. Free projects pause after a week without Console activity. Open the Appwrite Console and resume it.',
      storage_invalid_file_size: 'That file is larger than the server allows.',
      storage_file_type_unsupported: 'The server does not accept that file type.',
      storage_file_empty: 'That file appears to be empty.',
      general_unauthorized_scope: "You don't have permission to do that.",
      user_unauthorized: "You don't have permission to do that."
    };
    if (byType[type]) return byType[type];
    if (code === 401) return "You don't have permission to do that. If you were just approved, sign out and back in.";
    if (code === 404) return "We couldn't find that. It may have been deleted.";
    if (code === 409) return 'That already exists.';
    if (code === 429) return 'Too many tries in a short time. Please wait a minute and try again.';
    return msg || 'Something went wrong. Please try again.';
  }
  function isUnauthorized(e) { return e && (e.code === 401 || e.code === 403); }

  /* =====================================================================
   * 6. MEDIA LOADING
   * Family media is private, so <img src="appwrite-url"> would not work (an <img>
   * tag cannot prove who you are). Instead we ask Appwrite for a short-lived login
   * token (JWT), download the file with fetch(), and show it from memory (a blob:
   * URL that only exists in this browser tab). Nothing is saved to disk or to the
   * browser cache, and everything is released when you leave the screen.
   * ===================================================================== */

  var OK_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
  var OK_VIDEO = ['video/mp4', 'video/quicktime', 'video/webm'];

  async function getJwt() {
    if (S.jwt && Date.now() - S.jwtAt < 10 * 60 * 1000) return S.jwt;   // tokens last 15 minutes
    var r = await account.createJWT();
    S.jwt = r.jwt; S.jwtAt = Date.now();
    return S.jwt;
  }
  async function fetchMedia(fileId) {
    var url = storage.getFileView({ bucketId: CFG.bucketId, fileId: fileId });
    var res = await fetch(url, {
      headers: { 'X-Appwrite-Project': CFG.projectId, 'X-Appwrite-JWT': await getJwt() },
      credentials: 'omit', cache: 'no-store'
    });
    if (!res.ok) { var err = new Error('Could not load the file (error ' + res.status + ').'); err.code = res.status; throw err; }
    return res.blob();
  }
  function blobUrl(blob, mime) {
    var u = URL.createObjectURL(new Blob([blob], { type: mime }));
    S.blobs.push(u);
    return u;
  }
  function revokeBlobs() {
    S.blobs.forEach(function (u) { URL.revokeObjectURL(u); });
    S.blobs = [];
    if (S.io) { S.io.disconnect(); S.io = null; }
  }
  // Calls fn() when el scrolls near the screen (so we do not download photos nobody sees).
  function lazy(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    if (!S.io) {
      S.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          S.io.unobserve(en.target);
          var f = en.target.__load; en.target.__load = null;
          if (f) f();
        });
      }, { rootMargin: '300px' });
    }
    el.__load = fn;
    S.io.observe(el);
  }
  function spinnerLine(text) { return h('div', null, h('span', { class: 'spinner sm', 'aria-hidden': 'true' }), ' ', text); }

  function imageBlock(post) {
    var token = S.nav;
    var mime = OK_IMAGE.indexOf(post.mediaMime) >= 0 ? post.mediaMime : 'image/jpeg';
    var box = h('div', { class: 'media placeholder' }, spinnerLine('Loading photo…'));
    function load() {
      clear(box); box.className = 'media placeholder'; box.appendChild(spinnerLine('Loading photo…'));
      fetchMedia(post.mediaFileId).then(function (blob) {
        if (token !== S.nav) return;
        clear(box); box.className = 'media';
        box.appendChild(h('img', { src: blobUrl(blob, mime), alt: 'Photo shared by the family', loading: 'lazy' }));
      }).catch(function (e) {
        if (token !== S.nav) return;
        clear(box);
        box.appendChild(h('div', null, h('p', { text: "Couldn't load this photo." }), h('button', { class: 'btn secondary small', type: 'button', onclick: load, text: 'Try again' })));
      });
    }
    lazy(box, load);
    return box;
  }

  function videoBlock(post, vertical) {
    var token = S.nav;
    var mime = OK_VIDEO.indexOf(post.mediaMime) >= 0 ? post.mediaMime : 'video/mp4';
    var box = h('div', { class: 'media' + (vertical ? ' vertical' : '') });
    function showButton(errText) {
      clear(box); box.className = 'media placeholder' + (vertical ? ' vertical' : '');
      box.appendChild(h('div', null,
        errText ? h('p', { text: errText }) : null,
        h('button', { class: 'btn', type: 'button', onclick: start, text: 'Play video' + (post.mediaSize ? ' (' + fmtMB(post.mediaSize) + ')' : '') }),
        h('p', { class: 'hint', text: 'Videos download only when you tap play, to save data.' })));
    }
    function start() {
      clear(box); box.className = 'media placeholder' + (vertical ? ' vertical' : '');
      box.appendChild(spinnerLine('Downloading video…'));
      fetchMedia(post.mediaFileId).then(function (blob) {
        if (token !== S.nav) return;
        clear(box); box.className = 'media' + (vertical ? ' vertical' : '');
        var v = h('video', { src: blobUrl(blob, mime), controls: true, playsinline: true, preload: 'auto', 'aria-label': 'Family video' });
        box.appendChild(v);
        var p = v.play(); if (p && p.catch) p.catch(function () { /* the person can press play */ });
      }).catch(function (e) { if (token === S.nav) showButton("Couldn't load this video. " + (e.code === 401 ? 'You may not have access.' : 'Please try again.')); });
    }
    showButton();
    return box;
  }
  // Only one video plays at a time.
  document.addEventListener('play', function (ev) {
    if (!ev.target || ev.target.tagName !== 'VIDEO') return;
    Array.prototype.forEach.call(document.querySelectorAll('video'), function (v) { if (v !== ev.target) v.pause(); });
  }, true);

  function avatarUrl(fileId) {
    if (!S.avatarUrls.has(fileId)) {
      S.avatarUrls.set(fileId, fetchMedia(fileId).then(function (b) { return URL.createObjectURL(new Blob([b], { type: 'image/jpeg' })); })
        .catch(function (e) { S.avatarUrls.delete(fileId); throw e; }));
    }
    return S.avatarUrls.get(fileId);
  }
  function avatarEl(profile, extraClass) {
    var el = h('div', { class: 'avatar ' + (extraClass || ''), 'aria-hidden': 'true' }, initials(profile ? profile.displayName : '?'));
    if (profile && profile.avatarFileId) {
      avatarUrl(profile.avatarFileId).then(function (u) { clear(el); el.appendChild(h('img', { src: u, alt: '' })); }).catch(function () { /* keep initials */ });
    }
    return el;
  }

  /* =====================================================================
   * 7. SESSION, AUTH SCREENS, ACCESS SCREENS
   * ===================================================================== */

  async function loadSaved() {
    S.saved = new Map();
    var rows = await listAllRows('bookmarks', [Query.equal('userId', [S.user.$id]), Query.orderAsc('$createdAt')], 1000);
    rows.forEach(function (r) { S.saved.set(r.postId, r.$id); });
  }

  async function loadSession() {
    S.user = null; S.isMember = false; S.isOwner = false; S.profile = null; S.memberError = null;
    try { S.user = await account.get(); }
    catch (e) { if (!isUnauthorized(e)) S.notice = { kind: 'error', text: friendly(e) }; return; }

    var ap = S.user.prefs && S.user.prefs.appearance;      // appearance saved on the account wins
    if (ap) { prefs = sanitizePrefs(ap); try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} applyPrefs(); }

    if (!CFG.teamId) return;
    try {
      var res = await teams.listMemberships({ teamId: CFG.teamId, queries: [Query.limit(100)] });
      var mine = res.memberships.filter(function (m) { return m.userId === S.user.$id && m.confirm; })[0];
      S.isMember = !!mine;
      S.isOwner = !!mine && mine.roles.indexOf('owner') >= 0;
    } catch (e) {
      if (!isUnauthorized(e) && e.code !== 404) S.memberError = e;   // 401/404 simply means "not a member"
    }
    if (S.isMember && !S.memberError) {
      try {
        S.profile = await getRow('profiles', S.user.$id);
        S.profiles.set(S.user.$id, S.profile);
        await loadSaved();
      } catch (e) { if (e.code !== 404) S.memberError = e; }
    }
  }

  function readActionParams() {
    var q = new URLSearchParams(location.search);
    if (!q.get('action')) return null;
    var a = { action: q.get('action'), userId: q.get('userId'), secret: q.get('secret'), teamId: q.get('teamId'), membershipId: q.get('membershipId') };
    history.replaceState(null, '', location.pathname + location.hash);   // remove secrets from the address bar
    return a;
  }

  async function handleAction(a) {
    try {
      if (a.action === 'verify' && a.userId && a.secret) {
        await account.updateVerification({ userId: a.userId, secret: a.secret });
        S.notice = { kind: 'ok', text: 'Your email is verified. Thank you!' };
      } else if (a.action === 'recover' && a.userId && a.secret) {
        S.pending = { type: 'recover', userId: a.userId, secret: a.secret };
      } else if (a.action === 'invite' && a.teamId && a.membershipId && a.userId && a.secret) {
        await teams.updateMembershipStatus({ teamId: a.teamId, membershipId: a.membershipId, userId: a.userId, secret: a.secret });
        S.notice = { kind: 'ok', text: 'Invitation accepted. Welcome to the family!' };
      }
    } catch (e) {
      var what = a.action === 'invite' ? 'invitation' : a.action === 'verify' ? 'verification' : 'reset';
      S.notice = { kind: 'error', text: 'That ' + what + " link didn't work. It may have expired or been used already. " + (a.action === 'invite' ? 'Ask the family admin to send a new invitation.' : 'Please request a new one.') };
    }
  }

  function takeNotice() {
    var n = S.notice; S.notice = null;
    return n ? alertBox(n.kind, n.text) : null;
  }

  function authCard(title, lead) {
    var body = h('div', { class: 'card' });
    clear(root).appendChild(h('main', { class: 'auth-wrap', id: 'main' },
      h('img', { class: 'logo', src: 'favicon.svg', alt: '' }),
      h('h1', { text: title }),
      lead ? h('p', { class: 'lead', text: lead }) : null,
      takeNotice(),
      body));
    document.title = title + ' · ' + (CFG.appName || 'Family Circle');
    return body;
  }

  function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  function render() {
    revokeBlobs();
    S.main = null;
    if (S.pending && S.pending.type === 'recover') return renderReset();
    if (!S.user) return S.authMode === 'signup' ? renderSignUp() : S.authMode === 'forgot' ? renderForgot() : renderSignIn();
    if (S.memberError) return renderConnectionProblem();
    if (!CFG.teamId) return renderBootstrap();
    if (!S.isMember) return renderWaiting();
    if (!S.profile) return renderProfileSetup();
    renderShell();
    route(true);
  }

  function renderSignIn() {
    var email = field('email', 'Email', 'email', { autocomplete: 'email', required: true });
    var pw = field('password', 'Password', 'password', { autocomplete: 'current-password', required: true });
    var msg = h('div');
    var btn = h('button', { class: 'btn block', type: 'submit', text: 'Sign in' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var e = email.input.value.trim(), p = pw.input.value;
      if (!emailOk(e)) return showAlert(msg, 'error', 'Please enter a valid email address.');
      if (!p) return showAlert(msg, 'error', 'Please enter your password.');
      showAlert(msg, 'error', '');
      busy(btn, async function () {
        try {
          await account.createEmailPasswordSession({ email: e, password: p });
          await loadSession(); render();
        } catch (err) { showAlert(msg, 'error', friendly(err)); }
      }, 'Signing in…');
    } }, email.wrap, pw.wrap, msg, h('div', { class: 'stack' }, btn));
    var card = authCard('Welcome back', 'Sign in to our private family space.');
    card.appendChild(form);
    card.appendChild(h('div', { class: 'row between', style: null },
      h('button', { class: 'link-btn', type: 'button', text: 'Forgot password?', onclick: function () { S.authMode = 'forgot'; render(); } }),
      h('button', { class: 'link-btn', type: 'button', text: 'Create an account', onclick: function () { S.authMode = 'signup'; render(); } })));
    card.appendChild(h('p', { class: 'hint', text: 'Creating an account does not give access by itself. A family admin must invite you first.' }));
  }

  function renderSignUp() {
    var name = field('name', 'Your name', 'text', { autocomplete: 'name', required: true, maxlength: 60, hint: 'This is the name your family will see.' });
    var email = field('email', 'Email', 'email', { autocomplete: 'email', required: true, hint: 'Use the same email your family admin will invite.' });
    var pw = field('password', 'Password', 'password', { autocomplete: 'new-password', required: true, minlength: 8, hint: 'At least 8 characters.' });
    var msg = h('div');
    var btn = h('button', { class: 'btn block', type: 'submit', text: 'Create account' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var n = name.input.value.trim(), e = email.input.value.trim(), p = pw.input.value;
      if (!n) return showAlert(msg, 'error', 'Please enter your name.');
      if (!emailOk(e)) return showAlert(msg, 'error', 'Please enter a valid email address.');
      if (p.length < 8) return showAlert(msg, 'error', 'Your password needs at least 8 characters.');
      showAlert(msg, 'error', '');
      busy(btn, async function () {
        try {
          await account.create({ userId: ID.unique(), email: e, password: p, name: n });
          await account.createEmailPasswordSession({ email: e, password: p });
          var sent = true;
          try { await account.createVerification({ url: baseUrl() + '?action=verify' }); } catch (x) { sent = false; }
          S.notice = { kind: 'ok', text: sent ? 'Account created. We sent a verification link to ' + e + '.' : 'Account created. We could not send the verification email yet; you can resend it below.' };
          await loadSession(); render();
        } catch (err) { showAlert(msg, 'error', friendly(err)); }
      }, 'Creating account…');
    } }, name.wrap, email.wrap, pw.wrap, msg, h('div', { class: 'stack' }, btn));
    var card = authCard('Create your account', 'Step one of joining the family space.');
    card.appendChild(form);
    card.appendChild(h('p', null, h('button', { class: 'link-btn', type: 'button', text: 'I already have an account', onclick: function () { S.authMode = 'signin'; render(); } })));
  }

  function renderForgot() {
    var email = field('email', 'Email', 'email', { autocomplete: 'email', required: true });
    var msg = h('div');
    var btn = h('button', { class: 'btn block', type: 'submit', text: 'Send reset link' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var e = email.input.value.trim();
      if (!emailOk(e)) return showAlert(msg, 'error', 'Please enter a valid email address.');
      busy(btn, async function () {
        try {
          await account.createRecovery({ email: e, url: baseUrl() + '?action=recover' });
          showAlert(msg, 'ok', 'If that email has an account, a reset link is on its way. Check your inbox (and spam folder).');
        } catch (err) { showAlert(msg, 'error', friendly(err)); }
      }, 'Sending…');
    } }, email.wrap, msg, h('div', { class: 'stack' }, btn));
    var card = authCard('Reset your password', "We'll email you a link to choose a new one.");
    card.appendChild(form);
    card.appendChild(h('p', null, h('button', { class: 'link-btn', type: 'button', text: 'Back to sign in', onclick: function () { S.authMode = 'signin'; render(); } })));
  }

  function renderReset() {
    var pw = field('password', 'New password', 'password', { autocomplete: 'new-password', required: true, minlength: 8, hint: 'At least 8 characters.' });
    var msg = h('div');
    var btn = h('button', { class: 'btn block', type: 'submit', text: 'Save new password' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      if (pw.input.value.length < 8) return showAlert(msg, 'error', 'Your password needs at least 8 characters.');
      busy(btn, async function () {
        try {
          await account.updateRecovery({ userId: S.pending.userId, secret: S.pending.secret, password: pw.input.value });
          S.pending = null; S.authMode = 'signin';
          S.notice = { kind: 'ok', text: 'Password updated. Please sign in.' };
          render();
        } catch (err) { showAlert(msg, 'error', friendly(err)); }
      }, 'Saving…');
    } }, pw.wrap, msg, h('div', { class: 'stack' }, btn));
    authCard('Choose a new password').appendChild(form);
  }

  function renderConnectionProblem() {
    var card = authCard("We couldn't check your access", friendly(S.memberError));
    card.appendChild(h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: function (ev) { busy(ev.currentTarget, async function () { await loadSession(); render(); }); } }),
      h('button', { class: 'btn secondary', type: 'button', text: 'Sign out', onclick: signOut })));
  }

  function resendVerificationButton() {
    return h('button', { class: 'btn secondary small', type: 'button', text: 'Resend verification email', onclick: function (ev) {
      busy(ev.currentTarget, async function () {
        try { await account.createVerification({ url: baseUrl() + '?action=verify' }); toast('Verification email sent.'); }
        catch (e) { toast(friendly(e)); }
      });
    } });
  }

  function renderWaiting() {
    var card = authCard('Waiting for family access', 'Your account is ready, but you cannot see anything yet.');
    card.appendChild(h('p', null, 'Signed in as ', h('strong', { text: S.user.email }), '.'));
    card.appendChild(h('p', { text: 'A family admin needs to invite this email address. When the invitation email arrives, open the link in it. After that, come back here.' }));
    if (!S.user.emailVerification) {
      card.appendChild(h('div', { class: 'alert' }, h('p', { text: 'Your email is not verified yet. Check your inbox for the verification link.' }), resendVerificationButton()));
    }
    card.appendChild(h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Check again', onclick: function (ev) { busy(ev.currentTarget, async function () { await loadSession(); render(); }); } }),
      h('button', { class: 'btn secondary', type: 'button', text: 'Sign out', onclick: signOut })));
  }

  // First-time setup only: shown while config.js has an empty teamId.
  function renderBootstrap() {
    var card = authCard('One-time setup: create the family team', 'Only the family admin (you) should do this, once.');
    var msg = h('div');
    card.appendChild(h('p', { text: 'The family team is the list of people allowed to see posts. Creating it makes your account its owner, which lets you invite relatives.' }));
    card.appendChild(msg);
    card.appendChild(h('button', { class: 'btn block', type: 'button', text: 'Create the family team', onclick: function (ev) {
      busy(ev.currentTarget, async function () {
        try {
          var t = await teams.create({ teamId: ID.unique(), name: 'Family' });
          clear(card);
          card.appendChild(h('h2', { text: 'Team created' }));
          card.appendChild(h('p', { text: 'Copy this Team ID into config.js (the teamId line), upload config.js again, and use the same ID when you set the table and bucket permissions in the Setup Guide.' }));
          card.appendChild(h('input', { type: 'text', readonly: true, value: t.$id, 'aria-label': 'Team ID', onfocus: function (e) { e.target.select(); } }));
          card.appendChild(h('p', { class: 'hint', text: 'You can also find it later in the Appwrite Console under Auth > Teams.' }));
        } catch (e) { showAlert(msg, 'error', friendly(e)); }
      }, 'Creating…');
    } }));
    card.appendChild(h('p', null, h('button', { class: 'link-btn', type: 'button', text: 'Sign out', onclick: signOut })));
  }

  function renderProfileSetup() {
    var name = field('displayName', 'Display name', 'text', { required: true, maxlength: 60, value: S.user.name || '', hint: 'Your family will see this name.' });
    var file = h('input', { id: 'avatar', type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    var msg = h('div');
    var btn = h('button', { class: 'btn block', type: 'submit', text: 'Save and continue' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var n = name.input.value.trim();
      if (!n) return showAlert(msg, 'error', 'Please enter a display name.');
      busy(btn, async function () {
        var uploaded = null;
        try {
          var avatarId = null;
          if (file.files[0]) {
            var f = await imageToJpegFile(file.files[0], L.avatarEdge || 256, 0.85, true, 'avatar.jpg');
            uploaded = await uploadFile(f);
            avatarId = uploaded.$id;
          }
          var data = { displayName: n };
          if (avatarId) data.avatarFileId = avatarId;
          S.profile = await createRow('profiles', S.user.$id, data, permsShared(S.user.$id));
          S.profiles.set(S.user.$id, S.profile);
          await loadSaved(); render();
        } catch (e) {
          if (uploaded) storage.deleteFile({ bucketId: CFG.bucketId, fileId: uploaded.$id }).catch(function () {});
          if (e.code === 409) { try { S.profile = await getRow('profiles', S.user.$id); render(); return; } catch (x) { /* fall through */ } }
          showAlert(msg, 'error', friendly(e));
        }
      }, 'Saving…');
    } }, name.wrap,
      h('div', null, h('label', { for: 'avatar', text: 'Profile picture (optional)' }), file, h('div', { class: 'hint', text: 'It will be shrunk to a small square before upload.' })),
      msg, h('div', { class: 'stack' }, btn));
    authCard('Welcome! Set up your profile', 'Just a name is enough. No birthdays or addresses needed.').appendChild(form);
  }

  async function signOut() {
    try { await account.deleteSession({ sessionId: 'current' }); } catch (e) { /* already signed out */ }
    resetState();
    S.authMode = 'signin';
    location.hash = '';
    render();
  }

  /* =====================================================================
   * 8. APP SHELL & ROUTER
   * ===================================================================== */

  var NAV = [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'create', label: 'Create', icon: 'plus' },
    { id: 'shorts', label: 'Shorts', icon: 'shorts' },
    { id: 'saved', label: 'Saved', icon: 'bookmark' },
    { id: 'family', label: 'Family', icon: 'users' },
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ];
  var VIEWS = {};

  function renderShell() {
    S.main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
    var nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, h('ul', null, NAV.map(function (n) {
      return h('li', null, h('a', { href: '#/' + n.id, 'data-route': n.id }, icon(n.icon), h('span', { text: n.label })));
    })));
    var top = h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' },
      h('div', { class: 'brand' }, h('img', { src: 'favicon.svg', alt: '' }), h('span', { text: CFG.appName || 'Family Circle' })),
      h('button', { class: 'btn ghost small', type: 'button', text: 'Sign out', onclick: signOut })));
    var banner = null;
    if (!S.user.emailVerification) {
      banner = h('div', { class: 'main', style: null }, h('div', { class: 'alert' }, h('p', { text: 'Please verify your email. The link was sent when you signed up.' }), resendVerificationButton()));
      banner.style.paddingBottom = '0';
    }
    clear(root).appendChild(h('div', { class: 'shell' }, nav, h('div', { class: 'shell-body' }, top, banner, S.main)));
    var n = takeNotice(); if (n) toast(n.textContent);
  }

  function route(first) {
    if (!S.main || !S.user || !S.isMember || !S.profile) return;
    var name = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
    if (!VIEWS[name]) name = 'home';
    S.nav++;
    var token = S.nav;
    revokeBlobs();
    clear(S.main);
    Array.prototype.forEach.call(document.querySelectorAll('.nav a'), function (a) {
      if (a.getAttribute('data-route') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var label = NAV.filter(function (n) { return n.id === name; })[0].label;
    document.title = label + ' · ' + (CFG.appName || 'Family Circle');
    Promise.resolve().then(function () { return VIEWS[name](S.main, token); }).catch(function (e) {
      if (token === S.nav) clear(S.main).appendChild(alertBox('error', friendly(e)));
    });
    if (!first) { S.main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }

  /* =====================================================================
   * 9. POSTS & FEEDS
   * ===================================================================== */

  function confirmDialog(title, message, confirmLabel) {
    return new Promise(function (resolve) {
      if (!window.HTMLDialogElement || !document.createElement('dialog').showModal) { resolve(window.confirm(title + '\n\n' + message)); return; }
      var dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
      var ok = h('button', { class: 'btn danger', type: 'button', text: confirmLabel });
      var cancel = h('button', { class: 'btn secondary', type: 'button', text: 'Cancel' });
      function done(v) { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); resolve(v); }
      ok.addEventListener('click', function () { done(true); });
      cancel.addEventListener('click', function () { done(false); });
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      dlg.appendChild(h('h2', { id: 'dlg-title', text: title }));
      dlg.appendChild(h('p', { text: message }));
      dlg.appendChild(h('div', { class: 'row' }, cancel, ok));
      document.body.appendChild(dlg);
      dlg.showModal();
      cancel.focus();
    });
  }

  async function ensureProfiles(ids) {
    var need = ids.filter(function (id, i) { return ids.indexOf(id) === i && !S.profiles.has(id); });
    for (var i = 0; i < need.length; i += 100) {
      var chunk = need.slice(i, i + 100);
      var r = await listRows('profiles', [Query.equal('$id', chunk), Query.limit(100)]);
      r.rows.forEach(function (x) { S.profiles.set(x.$id, x); });
    }
    need.forEach(function (id) { if (!S.profiles.has(id)) S.profiles.set(id, null); });
  }

  // Loads authors, like counts and comment counts for a page of posts.
  async function decorate(posts) {
    var ids = posts.map(function (p) { return p.$id; });
    var reactions = [], comments = [];
    await Promise.all([
      ensureProfiles(posts.map(function (p) { return p.authorId; })),
      listRows('reactions', [Query.equal('postId', ids), Query.limit(500)]).then(function (r) { reactions = r.rows; }),
      listRows('comments', [Query.equal('postId', ids), Query.select(['postId']), Query.limit(500)]).then(function (r) { comments = r.rows; })
    ]);
    var meta = {};
    ids.forEach(function (id) { meta[id] = { likes: 0, reactionId: null, comments: 0 }; });
    reactions.forEach(function (r) { var m = meta[r.postId]; if (!m) return; m.likes++; if (r.userId === S.user.$id) m.reactionId = r.$id; });
    comments.forEach(function (c) { var m = meta[c.postId]; if (m) m.comments++; });
    return meta;
  }

  function pageSize() { return L.pageSize || 10; }

  async function fetchPostsPage(kind, cursor) {
    var q = [Query.orderDesc('$createdAt'), Query.limit(pageSize())];
    if (kind) q.push(Query.equal('kind', [kind]));
    if (cursor) q.push(Query.cursorAfter(cursor));
    var rows = (await listRows('posts', q)).rows;
    return { posts: rows, cursor: rows.length ? rows[rows.length - 1].$id : cursor, done: rows.length < pageSize() };
  }

  async function fetchSavedPage(cursor) {
    var q = [Query.equal('userId', [S.user.$id]), Query.orderDesc('$createdAt'), Query.limit(pageSize())];
    if (cursor) q.push(Query.cursorAfter(cursor));
    var rows = (await listRows('bookmarks', q)).rows;
    if (!rows.length) return { posts: [], cursor: cursor, done: true };
    var ids = rows.map(function (b) { return b.postId; });
    var found = (await listRows('posts', [Query.equal('$id', ids), Query.limit(ids.length)])).rows;
    var byId = {}; found.forEach(function (p) { byId[p.$id] = p; });
    var posts = [];
    rows.forEach(function (b) {
      if (byId[b.postId]) posts.push(byId[b.postId]);
      else { S.saved.delete(b.postId); deleteRow('bookmarks', b.$id).catch(function () {}); }   // post was deleted: tidy my bookmark
    });
    return { posts: posts, cursor: rows[rows.length - 1].$id, done: rows.length < pageSize() };
  }

  // Shows posts in pages with a "Load more" button.
  function pagedFeed(token, container, fetchPage, opts) {
    var list = h('div', { class: opts.className || '' });
    var status = h('div', { 'aria-live': 'polite' });
    var more = h('button', { class: 'btn secondary block', type: 'button', text: 'Load more', hidden: true });
    container.appendChild(list); container.appendChild(status); container.appendChild(h('div', { class: 'stack' }, more));
    var st = { cursor: null, done: false, loading: false, count: 0 };

    async function load() {
      if (st.loading || st.done) return;
      st.loading = true; more.disabled = true;
      clear(status); status.appendChild(h('div', { class: 'empty' }, spinnerLine('Loading…')));
      try {
        var page;
        do {
          page = await fetchPage(st.cursor);
          if (token !== S.nav) return;
          st.cursor = page.cursor; st.done = page.done;
        } while (!page.posts.length && !st.done);
        var meta = page.posts.length ? await decorate(page.posts) : {};
        if (token !== S.nav) return;
        page.posts.forEach(function (p) { list.appendChild(postCard(p, meta[p.$id], opts.variant, opts)); });
        st.count += page.posts.length;
        clear(status);
        if (!st.count) status.appendChild(h('div', { class: 'empty' }, h('p', { text: opts.emptyTitle }), h('p', { class: 'small', text: opts.emptyHint || '' }), opts.emptyAction || null));
      } catch (e) {
        if (token !== S.nav) return;
        clear(status);
        status.appendChild(alertBox('error', friendly(e)));
        status.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Try again', onclick: function () { st.loading = false; load(); } }));
      } finally {
        st.loading = false; more.disabled = false; more.hidden = st.done;
      }
    }
    more.addEventListener('click', load);
    return load();
  }

  VIEWS.home = function (main, token) {
    main.appendChild(h('h1', { text: 'Home' }));
    return pagedFeed(token, main, function (c) { return fetchPostsPage(null, c); }, {
      emptyTitle: 'No posts yet.', emptyHint: 'Be the first to share something with the family.',
      emptyAction: h('a', { class: 'btn', href: '#/create', text: 'Create a post' })
    });
  };
  VIEWS.shorts = function (main, token) {
    main.appendChild(h('h1', { text: 'Shorts' }));
    main.appendChild(h('p', { class: 'muted small', text: 'Short vertical videos. They download only when you tap play.' }));
    return pagedFeed(token, main, function (c) { return fetchPostsPage('short', c); }, {
      className: 'shorts', variant: 'short', emptyTitle: 'No Shorts yet.', emptyHint: 'Record a short vertical video (up to ' + (L.shortMaxSeconds || 60) + ' seconds) and share it.',
      emptyAction: h('a', { class: 'btn', href: '#/create', text: 'Create a Short' })
    });
  };
  VIEWS.saved = function (main, token) {
    main.appendChild(h('h1', { text: 'Saved' }));
    main.appendChild(h('p', { class: 'muted small', text: 'Only you can see what you save.' }));
    return pagedFeed(token, main, fetchSavedPage, {
      emptyTitle: 'Nothing saved yet.', emptyHint: 'Tap the bookmark on any post to keep it here.',
      onUnsave: function (card) { if (card.parentNode) card.parentNode.removeChild(card); }
    });
  };

  function actionBtn(iconName, label, onclick) {
    var count = h('span', { class: 'count' });
    var b = h('button', { class: 'act', type: 'button', onclick: onclick }, icon(iconName), count);
    b.setCount = function (n, aria, pressed) {
      count.textContent = n === null || n === undefined ? '' : String(n);
      b.setAttribute('aria-label', aria);
      if (pressed !== undefined) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    };
    return b;
  }

  function postCard(post, meta, variant, hooks) {
    hooks = hooks || {};
    var uid = S.user.$id;
    var st = { likes: meta ? meta.likes : 0, reactionId: meta ? meta.reactionId : null, comments: meta ? meta.comments : 0, busy: false };
    var prof = S.profiles.get(post.authorId) || null;
    var name = prof ? prof.displayName : 'Family member';
    var isMine = post.authorId === uid;
    var card = h('article', { class: 'card' + (variant === 'short' ? ' short' : ''), 'aria-label': 'Post by ' + name });

    // header
    var edited = new Date(post.$updatedAt) - new Date(post.$createdAt) > 3000;
    var kindLabel = { photo: 'Photo', video: 'Video', short: 'Short' }[post.kind];
    card.appendChild(h('div', { class: 'post-head' }, avatarEl(prof),
      h('div', { class: 'who' }, h('div', { class: 'name', text: name }),
        h('div', { class: 'small muted' }, h('time', { datetime: post.$createdAt, title: new Date(post.$createdAt).toLocaleString(), text: timeAgo(post.$createdAt) }), edited ? ' · edited' : '')),
      kindLabel ? h('span', { class: 'badge', text: kindLabel }) : null));

    // text (can be swapped for an editor)
    var bodyHolder = h('div');
    function showBody() { clear(bodyHolder); if (post.body) bodyHolder.appendChild(h('p', { class: 'post-body', text: post.body })); }
    showBody();
    card.appendChild(bodyHolder);

    // media
    if (post.mediaFileId) {
      if (post.kind === 'photo') card.appendChild(imageBlock(post));
      else if (post.kind === 'video' || post.kind === 'short') card.appendChild(videoBlock(post, post.kind === 'short'));
    }

    // actions
    var like = actionBtn('heart', 'Like', function () { toggleLike(); });
    var cmt = actionBtn('comment', 'Comments', function () { toggleComments(); });
    var save = actionBtn('bookmark', 'Save', function () { toggleSave(); });
    function paintLike() { like.setCount(st.likes, (st.reactionId ? 'Remove your like. ' : 'Like. ') + st.likes + ' likes', !!st.reactionId); }
    function paintCmt() { cmt.setCount(st.comments, 'Comments. ' + st.comments + ' so far', undefined); cmt.setAttribute('aria-expanded', commentsEl ? 'true' : 'false'); }
    function paintSave() { save.setCount(null, S.saved.has(post.$id) ? 'Remove from saved' : 'Save for later', S.saved.has(post.$id)); }
    var actions = h('div', { class: 'actions' }, like, cmt, save);
    if (isMine) {
      actions.appendChild(h('button', { class: 'act', type: 'button', 'aria-label': 'Edit your post text', onclick: startEdit }, icon('edit')));
    }
    if (isMine || S.isOwner) {
      actions.appendChild(h('button', { class: 'act', type: 'button', 'aria-label': isMine ? 'Delete your post' : 'Remove this post as family admin', onclick: removePost }, icon('trash')));
    }
    card.appendChild(actions);
    var commentsEl = null;
    paintLike(); paintCmt(); paintSave();

    async function toggleLike() {
      if (st.busy) return; st.busy = true;
      try {
        if (st.reactionId) {
          await deleteRow('reactions', st.reactionId); st.reactionId = null; st.likes = Math.max(0, st.likes - 1);
        } else {
          try {
            var row = await createRow('reactions', ID.unique(), { postId: post.$id, userId: uid, reactionKey: post.$id + '_' + uid }, permsReaction(uid));
            st.reactionId = row.$id; st.likes++;
          } catch (e) {
            if (e.code !== 409) throw e;      // already liked from another device: find that like
            var existing = (await listRows('reactions', [Query.equal('postId', [post.$id]), Query.limit(500)])).rows.filter(function (r) { return r.userId === uid; })[0];
            if (existing) st.reactionId = existing.$id;
          }
        }
      } catch (e) { toast(friendly(e)); }
      st.busy = false; paintLike();
    }

    async function toggleSave() {
      if (st.busy) return; st.busy = true;
      try {
        if (S.saved.has(post.$id)) {
          await deleteRow('bookmarks', S.saved.get(post.$id)); S.saved.delete(post.$id);
          if (hooks.onUnsave) hooks.onUnsave(card);
        } else {
          try {
            var row = await createRow('bookmarks', ID.unique(), { userId: uid, postId: post.$id, bookmarkKey: uid + '_' + post.$id }, permsPrivate(uid));
            S.saved.set(post.$id, row.$id);
          } catch (e) {
            if (e.code !== 409) throw e;
            var all = await listAllRows('bookmarks', [Query.equal('userId', [uid]), Query.orderAsc('$createdAt')], 1000);
            all.forEach(function (r) { S.saved.set(r.postId, r.$id); });
          }
        }
      } catch (e) { toast(friendly(e)); }
      st.busy = false; paintSave();
    }

    function toggleComments() {
      if (commentsEl) { card.removeChild(commentsEl); commentsEl = null; paintCmt(); return; }
      commentsEl = commentsPanel(post, st, paintCmt);
      card.appendChild(commentsEl); paintCmt();
    }

    function startEdit() {
      var ta = h('textarea', { maxlength: L.bodyMax || 2000, 'aria-label': 'Edit post text' });
      ta.value = post.body || '';
      var msg = h('div');
      var saveBtn = h('button', { class: 'btn small', type: 'button', text: 'Save' });
      var cancelBtn = h('button', { class: 'btn secondary small', type: 'button', text: 'Cancel', onclick: showBody });
      saveBtn.addEventListener('click', function () {
        var text = ta.value.trim();
        if (!text && !post.mediaFileId) return showAlert(msg, 'error', 'A text post needs some text.');
        busy(saveBtn, async function () {
          try {
            var updated = await updateRow('posts', post.$id, { body: text });
            post.body = text; post.$updatedAt = updated.$updatedAt; showBody();
            toast('Post updated.');
          } catch (e) { showAlert(msg, 'error', friendly(e)); }
        }, 'Saving…');
      });
      clear(bodyHolder);
      bodyHolder.appendChild(ta); bodyHolder.appendChild(msg);
      bodyHolder.appendChild(h('div', { class: 'row' }, saveBtn, cancelBtn));
      ta.focus();
    }

    async function removePost() {
      var ok = await confirmDialog('Delete this post?',
        isMine ? 'This removes the post, its comments and likes, and any photo or video. It cannot be undone.'
               : 'You are removing a relative\'s post as the family admin. This removes its comments, likes and media too. It cannot be undone.', 'Delete');
      if (!ok) return;
      card.setAttribute('aria-busy', 'true');
      try { await deleteRow('posts', post.$id); }
      catch (e) { card.removeAttribute('aria-busy'); toast(friendly(e)); return; }
      if (card.parentNode) card.parentNode.removeChild(card);
      var left = await cleanupAfterPostDelete(post);
      toast(left ? 'Post deleted. ' + left + ' comment(s) or like(s) from others could not be removed by you; they stay hidden and the admin can clean them up on the Family page.' : 'Post deleted.');
    }
    return card;
  }

  // After a post row is gone, remove what belonged to it (best effort).
  async function cleanupAfterPostDelete(post) {
    var uid = S.user.$id, left = 0, tasks = [];
    if (post.mediaFileId) tasks.push(storage.deleteFile({ bucketId: CFG.bucketId, fileId: post.mediaFileId }).catch(function () { left++; }));
    var comments = [], reactions = [];
    try { comments = await listAllRows('comments', [Query.equal('postId', [post.$id]), Query.orderAsc('$createdAt')], 500); } catch (e) {}
    try { reactions = await listAllRows('reactions', [Query.equal('postId', [post.$id]), Query.orderAsc('$createdAt')], 500); } catch (e) {}
    comments.forEach(function (c) {
      if (c.authorId === uid || S.isOwner) tasks.push(deleteRow('comments', c.$id).catch(function () { left++; })); else left++;
    });
    reactions.forEach(function (r) {
      if (r.userId === uid || S.isOwner) tasks.push(deleteRow('reactions', r.$id).catch(function () { left++; })); else left++;
    });
    if (S.saved.has(post.$id)) { tasks.push(deleteRow('bookmarks', S.saved.get(post.$id)).catch(function () {})); S.saved.delete(post.$id); }
    await Promise.all(tasks);
    return left;
  }

  function commentsPanel(post, st, onCount) {
    var uid = S.user.$id;
    var list = h('div'), status = h('div'), msg = h('div');
    var ta = h('textarea', { rows: 2, maxlength: L.commentMax || 500, 'aria-label': 'Write a comment', placeholder: 'Write a comment…' });
    var send = h('button', { class: 'btn small', type: 'submit', text: 'Comment' });
    var wrap = h('div', { class: 'comments' }, list, status);

    function commentItem(c) {
      var p = S.profiles.get(c.authorId) || null;
      var del = null;
      var item = h('div', { class: 'comment' });
      if (c.authorId === uid || S.isOwner) {
        del = h('button', { class: 'link-btn small', type: 'button', text: 'Delete', 'aria-label': 'Delete this comment', onclick: async function () {
          var ok = await confirmDialog('Delete this comment?', 'This cannot be undone.', 'Delete');
          if (!ok) return;
          try { await deleteRow('comments', c.$id); if (item.parentNode) item.parentNode.removeChild(item); st.comments = Math.max(0, st.comments - 1); onCount(); }
          catch (e) { toast(friendly(e)); }
        } });
      }
      item.appendChild(avatarEl(p));
      item.appendChild(h('div', { class: 'bubble' },
        h('div', { class: 'small' }, h('strong', { text: p ? p.displayName : 'Family member' }), ' ', h('span', { class: 'muted', text: timeAgo(c.$createdAt) })),
        h('div', { class: 'comment-body', text: c.body }), del));
      return item;
    }

    status.appendChild(spinnerLine('Loading comments…'));
    (async function () {
      try {
        var rows = await listAllRows('comments', [Query.equal('postId', [post.$id]), Query.orderAsc('$createdAt')], 200);
        await ensureProfiles(rows.map(function (c) { return c.authorId; }));
        clear(status);
        rows.forEach(function (c) { list.appendChild(commentItem(c)); });
        if (!rows.length) status.appendChild(h('p', { class: 'muted small', text: 'No comments yet.' }));
        st.comments = rows.length; onCount();
      } catch (e) { clear(status); status.appendChild(alertBox('error', friendly(e))); }
    })();

    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var text = ta.value.trim();
      if (!text) return showAlert(msg, 'error', 'Write a comment first.');
      busy(send, async function () {
        try {
          var row = await createRow('comments', ID.unique(), { postId: post.$id, authorId: uid, body: text }, permsShared(uid));
          S.profiles.set(uid, S.profile);
          clear(status); list.appendChild(commentItem(row));
          ta.value = ''; showAlert(msg, 'error', '');
          st.comments++; onCount();
        } catch (e) { showAlert(msg, 'error', friendly(e)); }
      }, 'Posting…');
    } }, ta, msg, h('div', { class: 'row' }, send));
    wrap.appendChild(form);
    return wrap;
  }

  /* =====================================================================
   * 10. CREATE POST (text, photo, video, short) + upload helpers
   * ===================================================================== */

  function uploadFile(file, onProgress) {
    return storage.createFile({
      bucketId: CFG.bucketId, fileId: ID.unique(), file: file,
      permissions: [Permission.read(Role.team(CFG.teamId)), Permission.delete(Role.user(S.user.$id))],
      onProgress: onProgress
    });
  }

  function decodeWithImg(file) {
    return new Promise(function (resolve, reject) {
      var u = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(u); reject(new Error('decode')); };
      img.src = u;
    });
  }
  // Shrinks a picture in the browser and re-saves it as JPEG. This also removes hidden
  // camera data such as GPS location, because only the pixels are copied.
  async function imageToJpegFile(file, maxEdge, quality, square, name) {
    if (file.type === 'image/gif') throw new Error('Animated GIFs are not supported. Please choose a JPEG, PNG or WebP photo.');
    if (file.size > 40 * 1048576) throw new Error('That photo is over 40 MB. Please choose a smaller one.');
    var bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e1) {
      try { bmp = await decodeWithImg(file); }
      catch (e2) { throw new Error("Your browser couldn't open that photo. Try a JPEG or PNG. On iPhone, set Camera > Formats to Most Compatible."); }
    }
    var sw = bmp.width, sh = bmp.height, sx = 0, sy = 0;
    if (square) { var s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = s; sh = s; }
    var scale = Math.min(1, maxEdge / Math.max(sw, sh));
    var w = Math.max(1, Math.round(sw * scale)), hh = Math.max(1, Math.round(sh * scale));
    var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hh;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, hh);
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hh);
    if (bmp.close) bmp.close();
    var blob = await new Promise(function (r) { canvas.toBlob(r, 'image/jpeg', quality); });
    if (!blob) throw new Error("We couldn't prepare that photo. Please try a different one.");
    return new File([blob], name, { type: 'image/jpeg' });
  }

  function videoMime(file) {
    if (OK_VIDEO.indexOf(file.type) >= 0) return file.type;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    return { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }[ext] || null;
  }
  function probeVideo(file) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video'), u = URL.createObjectURL(file);
      v.preload = 'metadata';
      v.onloadedmetadata = function () { var r = { duration: v.duration, w: v.videoWidth, h: v.videoHeight }; URL.revokeObjectURL(u); resolve(r); };
      v.onerror = function () { URL.revokeObjectURL(u); reject(new Error("Your browser couldn't read that video.")); };
      v.src = u;
    });
  }

  VIEWS.create = function (main) {
    var kind = 'text', file = null, draft = '', previewUrl = null;
    var KINDS = [{ id: 'text', label: 'Text' }, { id: 'photo', label: 'Photo' }, { id: 'video', label: 'Video' }, { id: 'short', label: 'Short' }];
    var holder = h('div');
    main.appendChild(h('h1', { text: 'Create a post' }));
    main.appendChild(holder);

    function dropPreview() { if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; } }

    function build() {
      dropPreview(); clear(holder);
      var tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Post type' }, KINDS.map(function (k) {
        return h('button', { class: 'tab', type: 'button', 'aria-pressed': k.id === kind ? 'true' : 'false', text: k.label, onclick: function () { draft = ta.value; kind = k.id; file = null; build(); } });
      }));
      var ta = h('textarea', { id: 'body', maxlength: L.bodyMax || 2000, rows: 5, placeholder: kind === 'text' ? "What's on your mind?" : 'Add a caption (optional)' });
      ta.value = draft;
      var msg = h('div'), info = h('div', { class: 'hint' }), prev = h('div', { class: 'preview' });
      var bar = h('progress', { max: 100, value: 0, hidden: true, 'aria-label': 'Upload progress' });
      var fileInput = null;

      if (kind !== 'text') {
        var accept = kind === 'photo' ? 'image/jpeg,image/png,image/webp,image/heic,image/heif' : 'video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm';
        fileInput = h('input', { id: 'file', type: 'file', accept: accept });
        info.textContent = kind === 'photo'
          ? 'Photos are shrunk to ' + (L.imageMaxEdge || 1600) + ' pixels on the long side before upload, which saves space.'
          : 'Up to ' + (L.videoMaxMB || 25) + ' MB' + (kind === 'short' ? ', ' + (L.shortMaxSeconds || 60) + ' seconds or less, and vertical (taller than wide)' : '') + '. Videos are uploaded as they are, not compressed.';
        fileInput.addEventListener('change', async function () {
          file = null; dropPreview(); clear(prev); showAlert(msg, 'error', '');
          var f = fileInput.files[0]; if (!f) return;
          try {
            if (kind === 'photo') {
              if (f.type === 'image/gif') throw new Error('Animated GIFs are not supported. Please choose a JPEG, PNG or WebP photo.');
              previewUrl = URL.createObjectURL(f);
              prev.appendChild(h('img', { src: previewUrl, alt: 'Preview of your photo', style: null }));
              prev.firstChild.style.maxHeight = '260px'; prev.firstChild.style.borderRadius = '10px';
            } else {
              var mime = videoMime(f);
              if (!mime) throw new Error('Please choose an MP4, MOV or WebM video.');
              if (f.size > (L.videoMaxMB || 25) * 1048576) throw new Error('That video is ' + fmtMB(f.size) + '. The limit is ' + (L.videoMaxMB || 25) + ' MB. Try recording a shorter clip or at a lower quality.');
              var meta = await probeVideo(f);
              if (kind === 'short') {
                if (meta.duration > (L.shortMaxSeconds || 60) + 0.5) throw new Error('Shorts must be ' + (L.shortMaxSeconds || 60) + ' seconds or less. This one is ' + Math.round(meta.duration) + ' seconds.');
                if (meta.h <= meta.w) throw new Error('Shorts must be vertical (taller than wide). Use the Video tab for this one.');
              }
              prev.appendChild(h('p', { class: 'small', text: f.name + ' · ' + fmtMB(f.size) + ' · ' + Math.round(meta.duration) + ' seconds' }));
            }
            file = f;
          } catch (e) { fileInput.value = ''; showAlert(msg, 'error', e.message || friendly(e)); }
        });
      }

      var btn = h('button', { class: 'btn block', type: 'submit', text: 'Post' });
      var form = h('form', { novalidate: true, class: 'card', onsubmit: function (ev) {
        ev.preventDefault();
        var text = ta.value.trim(), uid = S.user.$id;
        if (kind === 'text' && !text) return showAlert(msg, 'error', 'Write something first.');
        if (kind !== 'text' && !file) return showAlert(msg, 'error', 'Please choose a ' + (kind === 'photo' ? 'photo' : 'video') + ' first.');
        if (text.length > (L.bodyMax || 2000)) return showAlert(msg, 'error', 'That is too long. The limit is ' + (L.bodyMax || 2000) + ' characters.');
        showAlert(msg, 'error', '');
        busy(btn, async function () {
          var uploaded = null;
          try {
            var data = { authorId: uid, kind: kind };
            if (text) data.body = text;
            function onProg(p) { bar.hidden = false; bar.value = Math.round(p.progress || 0); }
            if (kind === 'photo') {
              btn.textContent = 'Preparing photo…';
              var jf = await imageToJpegFile(file, L.imageMaxEdge || 1600, L.imageQuality || 0.82, false, 'photo.jpg');
              btn.textContent = 'Uploading…';
              uploaded = await uploadFile(jf, onProg);
              data.mediaFileId = uploaded.$id; data.mediaMime = 'image/jpeg'; data.mediaSize = jf.size;
            } else if (kind === 'video' || kind === 'short') {
              var mime = videoMime(file);
              var ext = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[mime];
              btn.textContent = 'Uploading…';
              uploaded = await uploadFile(new File([file], 'video.' + ext, { type: mime }), onProg);
              data.mediaFileId = uploaded.$id; data.mediaMime = mime; data.mediaSize = file.size;
            }
            await createRow('posts', ID.unique(), data, permsShared(uid));
            S.profiles.set(uid, S.profile);
            toast('Posted!');
            location.hash = kind === 'short' ? '#/shorts' : '#/home';
          } catch (e) {
            if (uploaded) storage.deleteFile({ bucketId: CFG.bucketId, fileId: uploaded.$id }).catch(function () {});   // do not leave an orphan file
            bar.hidden = true;
            showAlert(msg, 'error', e.message && !e.type ? e.message : friendly(e));
          }
        }, 'Posting…');
      } },
        h('label', { for: 'body', text: kind === 'text' ? 'Your note' : 'Caption' }), ta,
        fileInput ? h('div', null, h('label', { for: 'file', text: kind === 'photo' ? 'Photo' : kind === 'short' ? 'Short video' : 'Video' }), fileInput, info, prev) : null,
        bar, msg, h('div', { class: 'stack' }, btn));
      holder.appendChild(tabs); holder.appendChild(form);
    }
    build();
  };

  /* =====================================================================
   * 11. FAMILY (member list + admin tools for the team owner)
   * ===================================================================== */

  VIEWS.family = async function (main, token) {
    main.appendChild(h('h1', { text: 'Family' }));
    var listBox = h('div', { class: 'card' }, spinnerLine('Loading…'));
    main.appendChild(listBox);
    var rows = await listAllRows('profiles', [Query.orderAsc('$createdAt')], 200);
    if (token !== S.nav) return;
    rows.forEach(function (r) { S.profiles.set(r.$id, r); });
    clear(listBox);
    listBox.appendChild(h('h2', { text: rows.length + (rows.length === 1 ? ' member' : ' members') }));
    rows.forEach(function (r) {
      listBox.appendChild(h('div', { class: 'member' }, avatarEl(r), h('div', { class: 'grow' }, h('strong', { text: r.displayName }), r.$id === S.user.$id ? h('span', { class: 'badge', text: ' You' }) : null)));
    });
    if (S.isOwner) renderAdminTools(main, token);
    else main.appendChild(h('p', { class: 'muted small', text: 'To add a relative, ask the family admin to invite their email address.' }));
  };

  function renderAdminTools(main, token) {
    // ---- invite ----
    var email = field('inviteEmail', 'Relative\'s email', 'email', { required: true, autocomplete: 'off' });
    var name = field('inviteName', 'Their name (optional)', 'text', { maxlength: 60, autocomplete: 'off' });
    var msg = h('div');
    var btn = h('button', { class: 'btn', type: 'submit', text: 'Send invitation' });
    var memberBox = h('div', { class: 'card' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var e = email.input.value.trim();
      if (!emailOk(e)) return showAlert(msg, 'error', 'Please enter a valid email address.');
      busy(btn, async function () {
        try {
          await teams.createMembership({ teamId: CFG.teamId, roles: ['member'], email: e, name: name.input.value.trim() || undefined, url: baseUrl() + '?action=invite' });
          showAlert(msg, 'ok', 'Invitation sent to ' + e + '. They need to open the link in the email.');
          email.input.value = ''; name.input.value = '';
          loadMemberships();
        } catch (err) { showAlert(msg, 'error', friendly(err)); }
      }, 'Sending…');
    } }, email.wrap, name.wrap, msg, h('div', { class: 'stack' }, btn));
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Invite a relative' },
      h('h2', { text: 'Invite a relative' }),
      h('p', { class: 'muted small', text: 'Only you (the team owner) can do this. Ask them to create an account first with the same email, then send the invitation.' }), form));

    // ---- memberships ----
    main.appendChild(memberBox);
    async function loadMemberships() {
      clear(memberBox); memberBox.appendChild(h('h2', { text: 'Invitations and members' })); memberBox.appendChild(spinnerLine('Loading…'));
      try {
        var res = await teams.listMemberships({ teamId: CFG.teamId, queries: [Query.limit(100)] });
        if (token !== S.nav) return;
        clear(memberBox); memberBox.appendChild(h('h2', { text: 'Invitations and members' }));
        res.memberships.forEach(function (m) {
          var self = m.userId === S.user.$id;
          memberBox.appendChild(h('div', { class: 'member' },
            h('div', { class: 'grow' }, h('strong', { text: m.userName || m.userEmail || 'Family member' }),
              h('div', { class: 'small muted', text: (m.userEmail && m.userName ? m.userEmail + ' · ' : '') + (m.confirm ? 'Joined' : 'Invited, not accepted yet') + (m.roles.indexOf('owner') >= 0 ? ' · Owner' : '') })),
            self ? null : h('button', { class: 'btn secondary small', type: 'button', text: 'Remove', 'aria-label': 'Remove ' + (m.userName || m.userEmail || 'this member') + ' from the family', onclick: async function () {
              var ok = await confirmDialog('Remove this person?', 'They will lose access to all family posts and media right away. Their own posts stay unless deleted.', 'Remove');
              if (!ok) return;
              try { await teams.deleteMembership({ teamId: CFG.teamId, membershipId: m.$id }); toast('Removed.'); loadMemberships(); }
              catch (e) { toast(friendly(e)); }
            } })));
        });
      } catch (e) { clear(memberBox); memberBox.appendChild(alertBox('error', friendly(e))); }
    }
    loadMemberships();

    // ---- orphan cleanup ----
    var out = h('div', { class: 'small muted', 'aria-live': 'polite' });
    var cbtn = h('button', { class: 'btn secondary', type: 'button', text: 'Clean up leftovers', onclick: function () {
      busy(cbtn, async function () {
        try {
          out.textContent = 'Checking posts…';
          var posts = await listAllRows('posts', [Query.select(['$id']), Query.orderAsc('$createdAt')], 5000);
          var live = {}; posts.forEach(function (p) { live[p.$id] = true; });
          var removed = 0;
          for (var t = 0; t < 2; t++) {
            var table = t === 0 ? 'comments' : 'reactions';
            out.textContent = 'Checking ' + table + '…';
            var rows = await listAllRows(table, [Query.select(['postId']), Query.orderAsc('$createdAt')], 5000);
            for (var i = 0; i < rows.length; i++) {
              if (!live[rows[i].postId]) { try { await deleteRow(table, rows[i].$id); removed++; } catch (e) { /* skip */ } }
            }
          }
          out.textContent = removed ? 'Removed ' + removed + ' leftover item(s).' : 'Nothing to clean up.';
        } catch (e) { out.textContent = friendly(e); }
      }, 'Cleaning…');
    } });
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Admin cleanup' },
      h('h2', { text: 'Housekeeping' }),
      h('p', { class: 'muted small', text: 'When someone deletes a post, other people\'s comments and likes on it cannot be removed by that person. They stay hidden. This button deletes them for good.' }),
      cbtn, out));
  }

  /* =====================================================================
   * 12. SETTINGS (profile, appearance, account)
   * ===================================================================== */

  VIEWS.settings = function (main) {
    main.appendChild(h('h1', { text: 'Settings' }));

    // ---- profile ----
    var name = field('displayName', 'Display name', 'text', { required: true, maxlength: 60, value: S.profile.displayName });
    var pmsg = h('div');
    var avatarBox = h('div', { class: 'row' });
    function paintAvatar() { clear(avatarBox); avatarBox.appendChild(avatarEl(S.profile, 'lg')); }
    paintAvatar();
    var file = h('input', { id: 'newAvatar', type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choose a new profile picture' });
    var saveName = h('button', { class: 'btn', type: 'submit', text: 'Save name' });
    var removeAv = h('button', { class: 'btn secondary small', type: 'button', text: 'Remove picture' });

    async function setAvatar(fileId) {
      var old = S.profile.avatarFileId;
      var row = await db.updateRow({ databaseId: CFG.databaseId, tableId: T.profiles, rowId: S.user.$id, data: { avatarFileId: fileId } });
      S.profile = row; S.profiles.set(S.user.$id, row);
      if (old) storage.deleteFile({ bucketId: CFG.bucketId, fileId: old }).catch(function () {});
      paintAvatar();
    }
    file.addEventListener('change', async function () {
      var f = file.files[0]; if (!f) return;
      showAlert(pmsg, 'error', '');
      var up = null;
      try {
        toast('Uploading picture…');
        up = await uploadFile(await imageToJpegFile(f, L.avatarEdge || 256, 0.85, true, 'avatar.jpg'));
        await setAvatar(up.$id);
        toast('Picture updated.');
      } catch (e) {
        if (up) storage.deleteFile({ bucketId: CFG.bucketId, fileId: up.$id }).catch(function () {});
        showAlert(pmsg, 'error', e.message && !e.type ? e.message : friendly(e));
      }
      file.value = '';
    });
    removeAv.addEventListener('click', function () {
      if (!S.profile.avatarFileId) return toast('You have no picture to remove.');
      busy(removeAv, async function () {
        try {
          var old = S.profile.avatarFileId;
          var row = await db.updateRow({ databaseId: CFG.databaseId, tableId: T.profiles, rowId: S.user.$id, data: { avatarFileId: null } });
          S.profile = row; S.profiles.set(S.user.$id, row);
          storage.deleteFile({ bucketId: CFG.bucketId, fileId: old }).catch(function () {});
          paintAvatar(); toast('Picture removed.');
        } catch (e) { showAlert(pmsg, 'error', friendly(e)); }
      });
    });
    var pform = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var n = name.input.value.trim();
      if (!n) return showAlert(pmsg, 'error', 'Your display name cannot be empty.');
      busy(saveName, async function () {
        try { S.profile = await updateRow('profiles', S.user.$id, { displayName: n }); S.profiles.set(S.user.$id, S.profile); showAlert(pmsg, 'ok', 'Saved.'); }
        catch (e) { showAlert(pmsg, 'error', friendly(e)); }
      }, 'Saving…');
    } }, name.wrap, pmsg, h('div', { class: 'stack' }, saveName));
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Profile' }, h('h2', { text: 'Profile' }), avatarBox,
      h('div', null, h('label', { for: 'newAvatar', text: 'Profile picture' }), file, h('div', { class: 'hint', text: 'Shrunk to a small square before upload. Optional.' })),
      h('div', { class: 'stack' }, removeAv), pform));

    // ---- appearance ----
    var look = h('section', { class: 'card', 'aria-label': 'Appearance' });
    main.appendChild(look);
    function paintLook() {
      clear(look);
      look.appendChild(h('h2', { text: 'Appearance' }));
      look.appendChild(h('h3', { text: 'Light or dark' }));
      look.appendChild(h('div', { class: 'tabs', role: 'group', 'aria-label': 'Light or dark mode' }, [['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']].map(function (m) {
        return h('button', { class: 'tab', type: 'button', text: m[1], 'aria-pressed': prefs.mode === m[0] ? 'true' : 'false', onclick: function () { prefs.mode = m[0]; savePrefs(); paintLook(); } });
      })));
      look.appendChild(h('h3', { text: 'Style' }));
      look.appendChild(h('div', { class: 'choice-grid', role: 'group', 'aria-label': 'Style preset' }, PRESETS.map(function (p) {
        return h('button', { class: 'choice', type: 'button', 'aria-pressed': prefs.preset === p.id ? 'true' : 'false', onclick: function () { prefs.preset = p.id; savePrefs(); paintLook(); } },
          h('strong', { text: p.name }), h('div', { class: 'small muted', text: p.note }));
      })));
      look.appendChild(h('h3', { text: 'Accent color' }));
      var sw = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Accent color' });
      sw.appendChild(h('button', { class: 'swatch none', type: 'button', 'aria-label': 'Use the style\'s own color', 'aria-pressed': prefs.accent ? 'false' : 'true', onclick: function () { prefs.accent = ''; savePrefs(); paintLook(); } }));
      ACCENTS.forEach(function (a) {
        var b = h('button', { class: 'swatch', type: 'button', 'aria-label': a.name, 'aria-pressed': prefs.accent === a.hex ? 'true' : 'false', onclick: function () { prefs.accent = a.hex; savePrefs(); paintLook(); } });
        b.style.background = a.hex; sw.appendChild(b);
      });
      var custom = h('input', { type: 'color', 'aria-label': 'Pick a custom accent color', value: prefs.accent || '#2563eb' });
      custom.addEventListener('change', function () { prefs.accent = custom.value.toLowerCase(); savePrefs(); paintLook(); });
      sw.appendChild(custom);
      look.appendChild(sw);
      look.appendChild(h('p', { class: 'hint', text: 'Saved on this device and on your account, so it follows you to your other devices.' }));
    }
    paintLook();

    // ---- account ----
    var amsg = h('div');
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Account' },
      h('h2', { text: 'Account' }),
      h('p', null, 'Signed in as ', h('strong', { text: S.user.email }), S.user.emailVerification ? ' (email verified)' : ' (email not verified)'),
      S.user.emailVerification ? null : h('div', { class: 'stack' }, resendVerificationButton()),
      h('div', { class: 'stack' }, h('button', { class: 'btn secondary', type: 'button', text: 'Email me a password reset link', onclick: function (ev) {
        busy(ev.currentTarget, async function () {
          try { await account.createRecovery({ email: S.user.email, url: baseUrl() + '?action=recover' }); showAlert(amsg, 'ok', 'Reset link sent. Check your inbox.'); }
          catch (e) { showAlert(amsg, 'error', friendly(e)); }
        });
      } })), amsg,
      h('div', { class: 'stack' }, h('button', { class: 'btn danger', type: 'button', text: 'Sign out', onclick: signOut }))));

    main.appendChild(h('section', { class: 'card', 'aria-label': 'About privacy' },
      h('h2', { text: 'About privacy' }),
      h('p', { class: 'small muted', text: 'Posts and media are visible only to approved family members. Nothing is public. No ads, no trackers, no face recognition or AI photo processing. Please remember that anyone who can see a photo could still take a screenshot or share it, so share thoughtfully.' })));
  };

  /* =====================================================================
   * 13. START-UP
   * ===================================================================== */

  async function boot() {
    applyPrefs();
    if (!window.Appwrite || !window.Appwrite.Client || !window.Appwrite.TablesDB) {
      return screenMessage("We couldn't load the Appwrite library", [
        'This page needs a small code library from cdn.jsdelivr.net. Check your internet connection, or any ad/content blocker, and refresh.'
      ]);
    }
    var problems = configProblems();
    if (problems.length) {
      return screenMessage('Setup required', [
        'This app is not connected to Appwrite yet, so nothing has been loaded or saved.',
        'Open config.js and replace the placeholder values for:'
      ], h('ul', { style: null }, problems.map(function (p) { return h('li', { text: p }); })));
    }
    initAppwrite();
    var action = readActionParams();
    if (action) await handleAction(action);
    await loadSession();
    window.addEventListener('hashchange', function () { route(false); });
    render();
  }

  boot().catch(function (e) {
    screenMessage('Something went wrong', [friendly(e)], h('button', { class: 'btn', type: 'button', text: 'Reload', onclick: function () { location.reload(); } }));
  });
})();

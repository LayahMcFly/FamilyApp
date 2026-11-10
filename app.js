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
  (function footer() {
    var f = document.getElementById('site-footer'); if (!f) return;
    var C = window.FAMILY_CONFIG || {};
    var link = function (href, text) { var el = document.createElement('a'); el.href = href; el.textContent = text; el.target = '_blank'; el.rel = 'noopener noreferrer'; return el; };
    var line = document.createElement('p');
    line.appendChild(document.createTextNode((C.appName || 'Family Circle') + ' v' + (C.version || '1.0.0')));
    f.appendChild(line);
    if (C.tagline) { var tg = document.createElement('p'); tg.textContent = C.tagline; f.insertBefore(tg, line); tg.className = 'tagline'; }
    if (C.feedbackUrl) {
      var l2 = document.createElement('p');
      l2.appendChild(document.createTextNode('Feedback, bug or problem? '));
      l2.appendChild(link(C.feedbackUrl, 'Tell me on GitHub'));
      if (C.githubUrl) { l2.appendChild(document.createTextNode(' · ')); l2.appendChild(link(C.githubUrl, 'My GitHub')); }
      f.appendChild(l2);
    }
  })();

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
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    volume: ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9a4 4 0 0 1 0 6', 'M19 6.5a8 8 0 0 1 0 11'],
    mute: ['M4 9v6h4l5 4V5L8 9z', 'M17 9.5l5 5', 'M22 9.5l-5 5']
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
  function fmtBytes(b) { return b >= 1073741824 ? (b / 1073741824).toFixed(1).replace(/\.0$/, '') + ' GB' : fmtMB(b); }
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
    if (!CFG.functionId) p.push('functionId (the ID of your family-api function)');
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

  var A, client, account, teams, functions, db, storage, Query, ID, Permission, Role;
  function initAppwrite() {
    A = window.Appwrite;
    client = new A.Client().setEndpoint(CFG.endpoint).setProject(CFG.projectId);
    account = new A.Account(client);
    teams = new A.Teams(client);
    functions = new A.Functions(client);
    db = new A.TablesDB(client);
    storage = new A.Storage(client);
    Query = A.Query; ID = A.ID; Permission = A.Permission; Role = A.Role;
  }

  // Read-only database wrappers. The browser holds NO table-level write permission, so it
  // cannot create, change or delete a single row. Every write goes through api() below.
  function listRows(table, queries) { return db.listRows({ databaseId: CFG.databaseId, tableId: T[table], queries: queries || [] }); }

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

  // Calls the family-api function. The function works out who you are from your own login
  // token and re-checks on the server that you belong to the family named in the request,
  // so a forged family ID simply gets a 403.
  async function api(action, payload) {
    var body = Object.assign({ action: action, jwt: await getJwt() }, payload || {});
    var ex = await functions.createExecution({ functionId: CFG.functionId, body: JSON.stringify(body), async: false, xpath: '/', method: 'POST' });
    var json = null;
    try { json = JSON.parse(ex.responseBody || 'null'); } catch (e) { json = null; }
    if (!json || typeof json !== 'object') {
      var bad = new Error('The family service did not answer correctly. It may be starting up or may have run out of time. Please try again.');
      bad.code = ex.responseStatusCode || 500; throw bad;
    }
    if (!json.ok) {
      var err = new Error(json.message || 'Something went wrong.');
      err.code = ex.responseStatusCode; err.apiCode = json.error; throw err;
    }
    return json;
  }

  // Permissions the browser attaches to a file it uploads. "update" for my own user id is the
  // proof of ownership that the function checks before it attaches the file to a post; the
  // function then rewrites the permissions so only the family team can read the file.
  function uploadPerms(familyId, uid) {
    return [Permission.read(Role.team(familyId)), Permission.update(Role.user(uid)), Permission.delete(Role.user(uid))];
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

  var FAM_KEY = 'fc_last_family';       // only a PREFERENCE; it is checked against the server's list
  var S = {
    user: null,
    families: [],                  // [{id, name, role}] as verified by the family-api function
    canCreateFamily: true, maxOwned: 3,
    familyId: null, role: null,    // the ACTIVE family
    isOwner: false, memberError: null,
    profile: null,                 // my profile in the active family
    profiles: new Map(),           // userId -> profile row, for the active family only
    profilesAt: 0,
    saved: new Map(),              // postId -> my bookmark row id (active family only)
    avatarUrls: new Map(),         // fileId -> Promise<objectURL>
    blobs: [],                     // object URLs for the current view (revoked on navigation)
    io: null,                      // IntersectionObserver for lazy media
    jwt: null, jwtAt: 0,
    nav: 0,                        // increases on every navigation; async work compares to it
    validatedAt: 0, preferFamily: null,
    notice: null, pending: null, authMode: 'signin'
  };

  // Forget everything that belongs to the active family (used when switching, leaving, signing out).
  function clearFamilyData() {
    S.nav++;
    revokeBlobs();
    S.avatarUrls.forEach(function (p) { p.then(function (u) { URL.revokeObjectURL(u); }).catch(function () {}); });
    S.avatarUrls = new Map();
    S.profile = null; S.profiles = new Map(); S.profilesAt = 0; S.saved = new Map(); S.usage = null;
    S.familyId = null; S.role = null; S.isOwner = false;
    if (S.main) clear(S.main);
  }

  function resetState() {
    clearFamilyData();
    S.user = null; S.families = []; S.canCreateFamily = true; S.memberError = null;
    S.jwt = null; S.jwtAt = 0; S.notice = null; S.pending = null; S.preferFamily = null; S.validatedAt = 0;
    clearTimeout(syncTimer);
    try { sessionStorage.clear(); } catch (e) {}
    try { localStorage.removeItem(FAM_KEY); } catch (e) {}
    try { localStorage.removeItem('cookieFallback'); } catch (e) {}   // the SDK's session fallback
  }

  function friendly(e) {
    if (!e) return 'Something went wrong. Please try again.';
    var msg = e.message || '', type = e.type || '', code = e.code;
    if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg)) {
      return "We couldn't reach Appwrite. Check your internet connection. If this keeps happening, the endpoint in config.js may be wrong or this website's hostname may not be added as a Web platform in Appwrite.";
    }
    if (e.apiCode) return msg;                       // a clear message written by the family-api function
    var byType = {
      function_not_found: 'The family-api function was not found. Check functionId in config.js and that the function is deployed (see the Setup Guide).',
      user_invalid_credentials: "That email and password don't match. Please try again.",
      user_already_exists: 'There is already an account with that email. Try signing in instead.',
      user_not_found: "We couldn't find that account.",
      user_invalid_token: 'That link is no longer valid. It may have expired or already been used.',
      user_blocked: 'This account is blocked.',
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
    if (S.reelIO) { S.reelIO.disconnect(); S.reelIO = null; }
    if (S.sentinelIO) { S.sentinelIO.disconnect(); S.sentinelIO = null; }
    S.reelLoaded = [];
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

  // ----- Shorts: videos start by themselves when they fill the screen, like a scrolling video feed -----
  S.muted = false;                       // sound is tried first; if the browser refuses, we fall back to muted
  function syncSound() {
    Array.prototype.forEach.call(document.querySelectorAll('.reel-media'), function (b) {
      var v = b.querySelector('video'); if (v) v.muted = S.muted;
      if (b.__paintSound) b.__paintSound();
    });
  }
  function observeReel(box) {
    if (!('IntersectionObserver' in window)) { box.__activate(); return; }
    if (!S.reelIO) {
      S.reelIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.intersectionRatio >= 0.6) en.target.__activate(); else en.target.__deactivate(); });
      }, { root: S.main, threshold: [0, 0.6, 1] });
    }
    S.reelIO.observe(box);
  }
  function reelVideo(post, mime) {
    var token = S.nav;
    var box = h('div', { class: 'media placeholder reel-media' });
    var st = { v: null, url: null, loading: null, active: false, wantPlay: false };
    var fill = h('div', { class: 'fill' });
    var bar = h('div', { class: 'reel-progress' }, fill);
    var snd = h('button', { class: 'reel-sound', type: 'button', onclick: function (ev) { ev.stopPropagation(); S.muted = !S.muted; syncSound(); } });
    box.__paintSound = function () {
      clear(snd); snd.appendChild(icon(S.muted ? 'mute' : 'volume'));
      snd.setAttribute('aria-label', S.muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
    };
    function playNow() {
      var v = st.v; if (!v) return;
      v.muted = S.muted;
      var p = v.play();
      if (p && p.catch) p.catch(function () {
        if (v.muted) return;               // the person can tap to play
        S.muted = true; syncSound();       // the browser blocks sound before a tap: start silent
        var q = v.play(); if (q && q.catch) q.catch(function () {});
      });
    }
    function wait(text) { clear(box); box.className = 'media placeholder reel-media'; box.appendChild(spinnerLine(text)); }
    function fail(e) {
      clear(box); box.className = 'media placeholder reel-media';
      box.appendChild(h('div', null, h('p', { text: "Couldn't load this video. " + (e && e.code === 401 ? 'You may not have access.' : 'Please try again.') }),
        h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: function (ev) { ev.stopPropagation(); load(true); } })));
    }
    function trackLoaded() {
      S.reelLoaded = (S.reelLoaded || []).filter(function (b) { return b !== box; });
      S.reelLoaded.push(box);
      if (S.reelLoaded.length > 4) {        // keep memory small: let go of the oldest video that is not on screen
        for (var i = 0; i < S.reelLoaded.length - 1; i++) { if (S.reelLoaded[i].__unload()) { S.reelLoaded.splice(i, 1); break; } }
      }
    }
    function load(play) {
      if (st.v) { if (play) playNow(); return; }
      if (st.loading) { st.wantPlay = st.wantPlay || play; return; }
      st.wantPlay = play; wait('Loading…');
      st.loading = fetchMedia(post.mediaFileId).then(function (blob) {
        st.loading = null;
        if (token !== S.nav) return;
        st.url = URL.createObjectURL(new Blob([blob], { type: mime }));
        clear(box); box.className = 'media reel-media';
        var v = h('video', { src: st.url, loop: true, playsinline: true, preload: 'auto', 'aria-label': 'Family video' });
        v.muted = S.muted;
        v.addEventListener('timeupdate', function () { if (v.duration) fill.style.width = (v.currentTime / v.duration * 100) + '%'; });
        box.appendChild(v); box.appendChild(snd); box.appendChild(bar); box.__paintSound();
        st.v = v; trackLoaded();
        if (st.wantPlay && st.active) playNow();
      }).catch(function (e) { st.loading = null; if (token === S.nav) fail(e); });
    }
    box.addEventListener('click', function () { if (!st.v) return; if (st.v.paused) playNow(); else st.v.pause(); });
    box.__activate = function () {
      st.active = true;
      if (st.v) playNow(); else load(true);
      var card = box.closest ? box.closest('.reel') : null, nx = card && card.nextElementSibling;
      var m = nx && nx.querySelector ? nx.querySelector('.reel-media') : null;
      if (m && m.__prefetch) m.__prefetch();          // get the next video ready so the swipe feels instant
    };
    box.__deactivate = function () { st.active = false; if (st.v) st.v.pause(); };
    box.__prefetch = function () { load(false); };
    box.__unload = function () {
      if (st.active) return false;
      if (st.v) { st.v.pause(); st.v.removeAttribute('src'); st.v.load(); }
      if (st.url) URL.revokeObjectURL(st.url);
      st.url = null; st.v = null; wait('Loading…');
      return true;
    };
    wait('Loading…');
    observeReel(box);
    return box;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) Array.prototype.forEach.call(document.querySelectorAll('video'), function (v) { v.pause(); });
  });
  document.addEventListener('keydown', function (ev) {          // arrow keys move between Shorts on a computer
    if (!S.main || !S.main.classList.contains('reels-main')) return;
    var t = ev.target && ev.target.tagName; if (t === 'TEXTAREA' || t === 'INPUT' || t === 'SELECT') return;
    var r = S.main.querySelector('.reel'); if (!r) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); S.main.scrollBy({ top: (ev.key === 'ArrowDown' ? 1 : -1) * r.offsetHeight, behavior: 'smooth' }); }
  });

  function videoBlock(post, vertical) {
    var token = S.nav;
    var mime = OK_VIDEO.indexOf(post.mediaMime) >= 0 ? post.mediaMime : 'video/mp4';
    if (vertical) return reelVideo(post, mime);
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
    var fid = S.familyId;
    var rows = await listAllRows('bookmarks', [Query.equal('userId', [S.user.$id]), Query.equal('familyId', [fid]), Query.orderAsc('$createdAt')], 1000);
    if (fid !== S.familyId) return;
    S.saved = new Map();
    rows.forEach(function (r) { S.saved.set(r.postId, r.collectionId || ''); });   // value = which library ('' = Saved for later)
  }

  // Everyone's profile in the ACTIVE family (names and pictures). Rows from other families are never requested.
  async function loadProfiles() {
    var fid = S.familyId;
    var rows = await listAllRows('profiles', [Query.equal('familyId', [fid]), Query.orderAsc('$createdAt')], 500);
    if (fid !== S.familyId) return;
    var m = new Map();
    rows.forEach(function (r) { m.set(r.userId, r); });
    S.profiles = m; S.profilesAt = Date.now();
    S.profile = m.get(S.user.$id) || null;
  }

  // Asks the server which families I truly belong to (confirmed members of registered Teams).
  async function loadFamilies() {
    var r = await api('listFamilies');
    S.families = r.families || [];
    S.canCreateFamily = !!r.canCreateFamily;
    S.maxOwned = r.maxOwnedFamilies || 3;
  }

  // Chooses the family to open: an invitation just accepted, else the last one used, else the first.
  // Both hints are checked against the server's list, so a stale or edited value is harmless.
  function pickFamily() {
    var ids = S.families.map(function (f) { return f.id; });
    var want = S.preferFamily; S.preferFamily = null;
    if (!want || ids.indexOf(want) < 0) { try { want = localStorage.getItem(FAM_KEY); } catch (e) { want = null; } }
    if (!want || ids.indexOf(want) < 0) want = ids[0] || null;
    return want;
  }

  // Opens one family. Only works for a family in the server-verified list; clears the previous family first.
  async function enterFamily(id) {
    clearFamilyData();
    var f = S.families.filter(function (x) { return x.id === id; })[0];
    if (!f) return false;
    S.familyId = id; S.role = f.role; S.isOwner = f.role === 'owner';
    try { localStorage.setItem(FAM_KEY, id); } catch (e) {}
    await loadProfiles();
    if (S.familyId !== id) return false;
    if (S.profile) await loadSaved();
    S.validatedAt = Date.now();
    return true;
  }

  function currentFamily() { return S.families.filter(function (f) { return f.id === S.familyId; })[0] || null; }

  // Re-asks the server whether I still belong to the active family. False means I do not (any more).
  async function revalidate() {
    await loadFamilies();
    var f = currentFamily();
    if (!f) {
      var next = pickFamily();
      clearFamilyData();
      if (next) await enterFamily(next);
      S.notice = { kind: 'error', text: 'You are no longer a member of that family.' };
      return false;
    }
    S.role = f.role; S.isOwner = f.role === 'owner'; S.validatedAt = Date.now();
    return true;
  }

  async function afterMembershipChange() {
    await loadFamilies();
    var id = pickFamily();
    clearFamilyData();
    if (id) await enterFamily(id);
    history.replaceState(null, '', location.pathname + '#/home');
    render();
  }

  async function switchFamily(id) {
    if (id === S.familyId) return;
    var tok = ++S.nav;
    if (S.main) { clear(S.main); S.main.appendChild(h('div', { class: 'empty' }, spinnerLine('Opening family…'))); }
    try {
      await loadFamilies();                       // the server re-checks my membership before anything loads
      if (!(await enterFamily(id))) {
        var fallback = pickFamily();
        if (fallback) await enterFamily(fallback);
        S.notice = { kind: 'error', text: 'You are not a member of that family.' };
      }
      history.replaceState(null, '', location.pathname + '#/home');
    } catch (e) { S.memberError = e; }
    if (tok > S.nav) S.nav = tok;
    render();
  }

  async function loadSession() {
    clearFamilyData();
    S.user = null; S.families = []; S.memberError = null;
    try { S.user = await account.get(); }
    catch (e) { if (!isUnauthorized(e)) S.notice = { kind: 'error', text: friendly(e) }; return; }

    var ap = S.user.prefs && S.user.prefs.appearance;      // appearance saved on the account wins
    if (ap) { prefs = sanitizePrefs(ap); try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} applyPrefs(); }

    if (!S.user.emailVerification) return;                  // the server refuses family actions until the email is verified
    try {
      await loadFamilies();
      var id = pickFamily();
      if (id) await enterFamily(id);
    } catch (e) { S.memberError = e; }
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
        S.preferFamily = a.teamId;
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
      (CFG.tagline ? h('p', { class: 'tagline', text: CFG.tagline }) : null),
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
    if (!S.user.emailVerification) return renderVerifyEmail();
    if (!S.families.length || !S.familyId) return renderOnboarding();
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
    card.appendChild(h('p', { class: 'hint', text: 'New here? Create an account and verify your email. Then you can start your own family space or accept an invitation from a family owner.' }));
  }

  function renderSignUp() {
    var name = field('name', 'Your name', 'text', { autocomplete: 'name', required: true, maxlength: 60, hint: 'This is the name your family will see.' });
    var email = field('email', 'Email', 'email', { autocomplete: 'email', required: true, hint: 'If a family owner will invite you, use the email address they have.' });
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

  function renderVerifyEmail() {
    var card = authCard('Verify your email', 'We confirm your email before you can create or join a family.');
    card.appendChild(h('p', null, 'Signed in as ', h('strong', { text: S.user.email }), '. Open the link in the email we sent, then press the button below.'));
    card.appendChild(h('div', { class: 'stack' }, resendVerificationButton()));
    card.appendChild(h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'I verified it, continue', onclick: function (ev) { busy(ev.currentTarget, async function () { await loadSession(); render(); }); } }),
      h('button', { class: 'btn secondary', type: 'button', text: 'Sign out', onclick: signOut })));
  }

  // A signed-in person who is in no family yet: they can start one or wait for an invitation.
  function renderOnboarding() {
    var card = authCard('Welcome to ' + (CFG.appName || 'Family Circle'), 'You are not in a family space yet. Start your own, or join one you were invited to.');
    card.appendChild(familyCreateCard('Create your family', 'You become its owner and can invite relatives by email. Your family\'s posts, photos and members stay private to your family.'));
    card.appendChild(h('section', { class: 'card inner', 'aria-label': 'Join with an invitation' },
      h('h2', { text: 'Joining a family that invited you?' }),
      h('p', { text: 'Open the link in the invitation email while you are signed in as ' + S.user.email + '. If the invitation went to a different email address, ask the owner to send it again to this one. After you accept, press the button below.' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn secondary', type: 'button', text: 'Check for my invitation', onclick: function (ev) { busy(ev.currentTarget, async function () { await loadSession(); render(); }); } }),
        h('button', { class: 'btn ghost', type: 'button', text: 'Sign out', onclick: signOut }))));
  }

  // Shared by the onboarding screen and the "Create another family" page.
  function familyCreateCard(title, lead) {
    var name = field('familyName', 'Family name', 'text', { required: true, maxlength: 60, placeholder: 'The Rivera family', hint: 'Everyone you invite will see this name.' });
    var msg = h('div');
    var btn = h('button', { class: 'btn block', type: 'submit', text: 'Create family' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var n = name.input.value.trim();
      if (!n) return showAlert(msg, 'error', 'Please enter a family name.');
      if (!S.canCreateFamily) return showAlert(msg, 'error', 'You already own the maximum number of families (' + S.maxOwned + ').');
      showAlert(msg, 'error', '');
      busy(btn, async function () {
        try { await createFamilyFlow(n); }
        catch (e) { showAlert(msg, 'error', e.message && !e.type ? e.message : friendly(e)); }
      }, 'Creating…');
    } }, name.wrap, msg, h('div', { class: 'stack' }, btn));
    return h('section', { class: 'card inner', 'aria-label': title }, h('h2', { text: title }), lead ? h('p', { class: 'muted', text: lead }) : null, form);
  }

  // 1) the browser creates the Appwrite Team (so I become its owner), 2) the function registers it as a family.
  async function createFamilyFlow(name) {
    var team = await teams.create({ teamId: ID.unique(), name: name });
    try { await api('registerFamily', { teamId: team.$id }); }
    catch (e) { teams.delete({ teamId: team.$id }).catch(function () {}); throw e; }     // do not leave an unregistered team behind
    S.preferFamily = team.$id;
    await loadFamilies();
    await enterFamily(team.$id);
    history.replaceState(null, '', location.pathname + '#/home');
    render();
  }

  function renderProfileSetup() {
    var fam = currentFamily();
    var name = field('displayName', 'Display name', 'text', { required: true, maxlength: 60, value: S.user.name || '', hint: 'Only members of ' + (fam ? fam.name : 'this family') + ' will see this name.' });
    var file = h('input', { id: 'avatar', type: 'file', accept: 'image/jpeg,image/png,image/webp' });
    var msg = h('div');
    var btn = h('button', { class: 'btn block', type: 'submit', text: 'Save and continue' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var n = name.input.value.trim();
      if (!n) return showAlert(msg, 'error', 'Please enter a display name.');
      var fid = S.familyId;
      busy(btn, async function () {
        var uploaded = null;
        try {
          var payload = { familyId: fid, displayName: n };
          if (file.files[0]) {
            var f = await imageToJpegFile(file.files[0], L.avatarEdge || 256, 0.85, true, 'avatar.jpg');
            uploaded = await uploadFile(f);
            payload.avatarFileId = uploaded.$id;
          }
          var r = await api('saveProfile', payload);
          if (fid !== S.familyId) return;
          S.profile = Object.assign({ $id: r.profile.id }, r.profile); S.profiles.set(S.user.$id, S.profile);
          await loadSaved(); render();
        } catch (e) {
          if (uploaded) storage.deleteFile({ bucketId: CFG.bucketId, fileId: uploaded.$id }).catch(function () {});
          showAlert(msg, 'error', e.message && !e.type ? e.message : friendly(e));
        }
      }, 'Saving…');
    } }, name.wrap,
      h('div', null, h('label', { for: 'avatar', text: 'Profile picture (optional)' }), file, h('div', { class: 'hint', text: 'It will be shrunk to a small square before upload.' })),
      msg, h('div', { class: 'stack' }, btn));
    var card = authCard('Set up your profile' + (fam ? ' in ' + fam.name : ''), 'Just a name is enough. No birthdays or addresses needed.');
    card.appendChild(form);
    if (S.families.length > 1) card.appendChild(h('p', { class: 'hint', text: 'You can pick a different name in each family.' }));
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

  function familySwitcher() {
    var cur = currentFamily();
    if (S.families.length < 2 && !S.canCreateFamily) return h('span', { class: 'fam-name', text: cur ? cur.name : '' });
    var sel = h('select', { class: 'fam-select', 'aria-label': 'Choose family' }, S.families.map(function (f) {
      return h('option', { value: f.id, text: f.name + (f.role === 'owner' ? ' (owner)' : ''), selected: f.id === S.familyId });
    }));
    if (S.canCreateFamily) sel.appendChild(h('option', { value: '__new', text: '+ Create another family…' }));
    sel.addEventListener('change', function () {
      var v = sel.value;
      sel.value = S.familyId;
      if (v === '__new') { location.hash = '#/newfamily'; return; }
      switchFamily(v);
    });
    return sel;
  }

  function renderShell() {
    S.main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
    var nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, h('ul', null, NAV.map(function (n) {
      return h('li', null, h('a', { href: '#/' + n.id, 'data-route': n.id }, icon(n.icon), h('span', { text: n.label })));
    })));
    var top = h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' },
      h('div', { class: 'brand' }, h('img', { src: 'favicon.svg', alt: '' }), h('span', { text: CFG.appName || 'Family Circle' })),
      familySwitcher()));
    clear(root).appendChild(h('div', { class: 'shell' }, nav, h('div', { class: 'shell-body' }, top, S.main)));
    var n = takeNotice(); if (n) toast(n.textContent);
  }

  var REVALIDATE_MS = 5 * 60 * 1000;

  function route(first) {
    if (!S.main || !S.user || !S.familyId || !S.profile) return;
    // Before showing family content again after a while, ask the server whether I am still a member.
    if (Date.now() - S.validatedAt > REVALIDATE_MS) {
      var tok = ++S.nav;
      clear(S.main); S.main.appendChild(h('div', { class: 'empty' }, spinnerLine('Checking your access…')));
      revalidate().then(function (ok) {
        if (tok !== S.nav) return;
        if (!ok) return render();
        route(first);
      }).catch(function (e) {
        if (tok === S.nav) clear(S.main).appendChild(alertBox('error', friendly(e)));
      });
      return;
    }
    var name = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
    if (!VIEWS[name]) name = 'home';
    S.nav++;
    var token = S.nav;
    revokeBlobs();
    clear(S.main);
    S.main.classList.toggle('reels-main', name === 'shorts');
    Array.prototype.forEach.call(document.querySelectorAll('.nav a'), function (a) {
      if (a.getAttribute('data-route') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var meta = NAV.filter(function (n) { return n.id === name; })[0];
    document.title = (meta ? meta.label : 'New family') + ' · ' + (CFG.appName || 'Family Circle');
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

  /* ---- Saved libraries: names live in my own account settings, each saved post points to one ---- */
  var LATER_NAME = 'Saved for later';
  function libs() { var all = S.user && S.user.prefs && S.user.prefs.libraries; return all && all[S.familyId] ? all[S.familyId].slice() : []; }
  function libOf(postId) { var c = S.saved.get(postId) || ''; return libs().some(function (l) { return l.id === c; }) ? c : ''; }   // a deleted library falls back to Saved for later
  function libName(id) { var l = libs().filter(function (x) { return x.id === id; })[0]; return l ? l.name : LATER_NAME; }
  async function writeLibs(list) {
    var all = Object.assign({}, (S.user.prefs && S.user.prefs.libraries) || {});
    all[S.familyId] = list;
    S.user = await account.updatePrefs({ prefs: Object.assign({}, S.user.prefs || {}, { libraries: all }) });
  }
  function cleanLibName(raw, exceptId) {
    var n = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!n) throw new Error('Give the library a name.');
    if (n.length > 30) throw new Error('Library names can be up to 30 characters.');
    if (n.toLowerCase() === LATER_NAME.toLowerCase() || libs().some(function (l) { return l.id !== exceptId && l.name.toLowerCase() === n.toLowerCase(); })) throw new Error('You already have a library with that name.');
    return n;
  }
  async function addLibrary(name) {
    var list = libs();
    if (list.length >= 20) throw new Error('You can have up to 20 libraries.');
    var l = { id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: cleanLibName(name) };
    list.push(l); await writeLibs(list); return l;
  }
  function nameDialog(title, value, label, onSubmit) {
    return new Promise(function (resolve) {
      var dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
      var inp = h('input', { type: 'text', maxlength: 30, 'aria-label': 'Library name', placeholder: 'For example: Recipes' });
      inp.value = value || '';
      var msg = h('div'), ok = h('button', { class: 'btn', type: 'submit', text: label }), cancel = h('button', { class: 'btn secondary', type: 'button', text: 'Cancel' });
      function done(v) { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); resolve(v); }
      cancel.addEventListener('click', function () { done(false); });
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      dlg.appendChild(h('form', { novalidate: true, onsubmit: function (ev) {
        ev.preventDefault();
        busy(ok, async function () { try { await onSubmit(inp.value); done(true); } catch (e) { showAlert(msg, 'error', e.message && !e.type ? e.message : friendly(e)); } }, 'Saving…');
      } }, h('h2', { id: 'dlg-title', text: title }), inp, msg, h('div', { class: 'row' }, cancel, ok)));
      document.body.appendChild(dlg); dlg.showModal(); inp.focus(); inp.select();
    });
  }
  // The sheet that opens when you tap the bookmark on a post you already saved.
  function savePicker(post, card, hooks, repaint) {
    var dlg = h('dialog', { class: 'sheet-dialog', 'aria-labelledby': 'dlg-title' });
    var list = h('div', { class: 'lib-list' }), msg = h('div');
    function close() { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }
    async function moveTo(id) {
      await api('setBookmarkCollection', { familyId: S.familyId, postId: post.$id, collectionId: id });
      S.saved.set(post.$id, id); repaint();
      if (hooks.onSaveChange) hooks.onSaveChange(card, id);
      toast('Saved to ' + libName(id) + '.');
    }
    function row(id, name) {
      var here = libOf(post.$id) === id;
      return h('button', { class: 'lib-row', type: 'button', 'aria-pressed': here ? 'true' : 'false', onclick: async function () {
        if (here) return close();
        try { await moveTo(id); close(); } catch (e) { showAlert(msg, 'error', e.message && !e.type && !e.apiCode ? e.message : friendly(e)); }
      } }, h('span', { text: name }), here ? h('span', { class: 'lib-here', text: 'Saved here' }) : null);
    }
    list.appendChild(row('', LATER_NAME));
    libs().forEach(function (l) { list.appendChild(row(l.id, l.name)); });
    var add = h('button', { class: 'btn secondary block', type: 'button', text: 'New library', onclick: function () {
      close();
      nameDialog('New library', '', 'Create and save here', async function (name) { var l = await addLibrary(name); await moveTo(l.id); });
    } });
    var remove = h('button', { class: 'btn danger block', type: 'button', text: 'Remove from saved', onclick: async function () {
      try {
        var r = await api('toggleBookmark', { familyId: S.familyId, postId: post.$id });
        if (!r.saved) { S.saved.delete(post.$id); repaint(); if (hooks.onUnsave) hooks.onUnsave(card); toast('Removed from saved.'); }
        close();
      } catch (e) { showAlert(msg, 'error', friendly(e)); }
    } });
    var closeBtn = h('button', { class: 'btn secondary block', type: 'button', text: 'Close', onclick: close });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.appendChild(h('h2', { id: 'dlg-title', text: 'Save to' }));
    dlg.appendChild(list); dlg.appendChild(msg);
    dlg.appendChild(h('div', { class: 'stack' }, add, remove, closeBtn));
    document.body.appendChild(dlg); dlg.showModal();
  }

  async function ensureProfiles(ids) {
    var missing = ids.some(function (id) { return !S.profiles.has(id); });
    if (missing && Date.now() - S.profilesAt > 30000) await loadProfiles();   // a new member may have joined
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
    ids.forEach(function (id) { meta[id] = { likes: 0, liked: false, comments: 0 }; });
    reactions.forEach(function (r) { var m = meta[r.postId]; if (!m) return; m.likes++; if (r.userId === S.user.$id) m.liked = true; });
    comments.forEach(function (c) { var m = meta[c.postId]; if (m) m.comments++; });
    return meta;
  }

  function pageSize() { return L.pageSize || 10; }

  async function fetchPostsPage(kind, cursor) {
    var q = [Query.equal('familyId', [S.familyId]), Query.orderDesc('$createdAt'), Query.limit(pageSize())];
    if (kind) q.push(Query.equal('kind', [kind]));
    if (cursor) q.push(Query.cursorAfter(cursor));
    var rows = (await listRows('posts', q)).rows;
    return { posts: rows, cursor: rows.length ? rows[rows.length - 1].$id : cursor, done: rows.length < pageSize() };
  }

  // One library at a time. The list of what I saved is already in memory (S.saved), newest first.
  async function fetchSavedPage(cursor, lib) {
    var ids = [];
    S.saved.forEach(function (c, pid) { if (libOf(pid) === (lib || '')) ids.push(pid); });
    ids.reverse();
    var start = cursor ? Number(cursor) : 0, slice = ids.slice(start, start + pageSize());
    if (!slice.length) return { posts: [], cursor: cursor, done: true };
    var found = (await listRows('posts', [Query.equal('$id', slice), Query.limit(slice.length)])).rows;
    var byId = {}; found.forEach(function (p) { byId[p.$id] = p; });
    var posts = [];
    slice.forEach(function (pid) {
      if (byId[pid] && byId[pid].familyId === S.familyId) posts.push(byId[pid]);
      else S.saved.delete(pid);          // the post is gone (the server removes bookmarks with it)
    });
    return { posts: posts, cursor: String(start + slice.length), done: start + slice.length >= ids.length };
  }

  // Shows posts in pages with a "Load more" button.
  function pagedFeed(token, container, fetchPage, opts) {
    var list = h('div', { class: opts.className || '' });
    var status = h('div', { 'aria-live': 'polite' });
    var more = h('button', { class: 'btn secondary block', type: 'button', text: 'Load more', hidden: true });
    var sentinel = opts.infinite ? h('div', { class: 'sentinel', 'aria-hidden': 'true' }) : null;
    container.appendChild(list); if (sentinel) container.appendChild(sentinel); container.appendChild(status); container.appendChild(h('div', { class: 'stack' }, more));
    var st = { cursor: null, done: false, loading: false, count: 0 };
    var sio = null;

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
        else if (opts.infinite && st.done) status.appendChild(h('div', { class: 'reels-end' }, h('p', { text: "You're all caught up." }),
          h('button', { class: 'btn secondary small', type: 'button', text: 'Back to the top', onclick: function () { container.scrollTo({ top: 0, behavior: 'smooth' }); } })));
      } catch (e) {
        if (token !== S.nav) return;
        clear(status);
        status.appendChild(alertBox('error', friendly(e)));
        status.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Try again', onclick: function () { st.loading = false; load(); } }));
      } finally {
        st.loading = false; more.disabled = false; more.hidden = st.done || !!opts.infinite;
        if (sio && !st.done) { sio.unobserve(sentinel); sio.observe(sentinel); }      // check again whether the end is still close
      }
    }
    more.addEventListener('click', load);
    if (sentinel && 'IntersectionObserver' in window) {
      sio = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) load(); }, { rootMargin: '900px' });
      sio.observe(sentinel); S.sentinelIO = sio;
    }
    return load();
  }

  VIEWS.home = function (main, token) {
    main.appendChild(h('h1', { class: 'sr-only', text: 'Home' }));
    var people = Array.from(S.profiles.values());
    if (people.length) {
      main.appendChild(h('div', { class: 'stories', role: 'list', 'aria-label': 'Family members' }, people.map(function (p) {
        var first = String(p.displayName || '').split(' ')[0];
        return h('div', { class: 'story', role: 'listitem' }, h('div', { class: 'ring' }, avatarEl(p, 'lg')), h('span', { text: p.userId === S.user.$id ? 'You' : first }));
      })));
    }
    return pagedFeed(token, main, function (c) { return fetchPostsPage(null, c); }, {
      emptyTitle: 'No posts yet.', emptyHint: 'Be the first to share something with the family.',
      emptyAction: h('a', { class: 'btn', href: '#/create', text: 'Create a post' })
    });
  };
  VIEWS.shorts = function (main, token) {
    main.appendChild(h('h1', { class: 'sr-only', text: 'Shorts' }));
    main.appendChild(h('div', { class: 'reels-top' }, h('span', { text: 'Shorts' })));
    return pagedFeed(token, main, function (c) { return fetchPostsPage('short', c); }, {
      className: 'shorts', variant: 'short', infinite: true, emptyTitle: 'No Shorts yet.', emptyHint: 'Record a short vertical video (up to ' + (L.shortMaxSeconds || 60) + ' seconds) and share it.',
      emptyAction: h('a', { class: 'btn', href: '#/create', text: 'Create a Short' })
    });
  };
  VIEWS.saved = function (main, token) {
    var sel = S.savedTab || '';
    if (sel && !libs().some(function (l) { return l.id === sel; })) sel = '';
    main.appendChild(h('h1', { text: 'Saved' }));
    main.appendChild(h('p', { class: 'muted small', text: 'Only you can see what you save, and what you name your libraries.' }));
    var chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Libraries' }), manage = h('div', { class: 'row' }), holder = h('div');
    main.appendChild(chips); main.appendChild(manage); main.appendChild(holder);

    function drawChips() {
      clear(chips); clear(manage);
      function chip(id, name) {
        chips.appendChild(h('button', { class: 'chip', type: 'button', 'aria-pressed': id === sel ? 'true' : 'false', text: name, onclick: function () { sel = id; S.savedTab = id; show(); } }));
      }
      chip('', LATER_NAME);
      libs().forEach(function (l) { chip(l.id, l.name); });
      chips.appendChild(h('button', { class: 'chip add', type: 'button', text: '+ New library', onclick: function () {
        nameDialog('New library', '', 'Create', async function (n) { var l = await addLibrary(n); sel = l.id; S.savedTab = l.id; }).then(function (ok) { if (ok) show(); });
      } }));
      if (sel) {
        manage.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Rename', onclick: function () {
          nameDialog('Rename library', libName(sel), 'Rename', async function (n) {
            var list = libs(), l = list.filter(function (x) { return x.id === sel; })[0];
            l.name = cleanLibName(n, sel); await writeLibs(list);
          }).then(function (ok) { if (ok) show(); });
        } }));
        manage.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Delete library', onclick: async function () {
          var ok = await confirmDialog('Delete "' + libName(sel) + '"?', 'The posts inside are not deleted. They move back to ' + LATER_NAME + '.', 'Delete library');
          if (!ok) return;
          try { await writeLibs(libs().filter(function (l) { return l.id !== sel; })); sel = ''; S.savedTab = ''; show(); } catch (e) { toast(friendly(e)); }
        } }));
      }
    }
    function dropCard(card) { if (card.parentNode) card.parentNode.removeChild(card); }
    function show() {
      clear(holder); drawChips();
      return pagedFeed(token, holder, function (c) { return fetchSavedPage(c, sel); }, {
        emptyTitle: sel ? 'Nothing in this library yet.' : 'Nothing saved yet.',
        emptyHint: sel ? 'Tap the bookmark on a saved post and choose this library.' : 'Tap the bookmark on any post to keep it here.',
        onUnsave: dropCard,
        onSaveChange: function (card, id) { if (id !== sel) dropCard(card); }
      });
    }
    return show();
  };


  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  function actionBtn(iconName, label, onclick) {
    var count = h('span', { class: 'count' });
    var b = h('button', { class: 'act', type: 'button', onclick: onclick }, icon(iconName), count);
    b.setCount = function (n, aria, pressed) {
      count.textContent = n === null || n === undefined ? '' : compact(n);
      b.setAttribute('aria-label', aria);
      if (pressed !== undefined) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    };
    return b;
  }

  function postCard(post, meta, variant, hooks) {
    hooks = hooks || {};
    var uid = S.user.$id;
    var st = { likes: meta ? meta.likes : 0, liked: meta ? meta.liked : false, comments: meta ? meta.comments : 0, busy: false };
    var prof = S.profiles.get(post.authorId) || null;
    var name = prof ? prof.displayName : 'Family member';
    var isMine = post.authorId === uid;
    var isReel = variant === 'short';
    var info = isReel ? h('div', { class: 'reel-info' }) : null;
    var card = h('article', { class: isReel ? 'reel short' : 'card', 'aria-label': 'Post by ' + name });

    // header
    var edited = new Date(post.$updatedAt) - new Date(post.$createdAt) > 3000;
    var kindLabel = { photo: 'Photo', video: 'Video', short: 'Short' }[post.kind];
    (isReel ? info : card).appendChild(h('div', { class: 'post-head' }, avatarEl(prof),
      h('div', { class: 'who' }, h('div', { class: 'name', text: name }),
        h('div', { class: 'small muted' }, h('time', { datetime: post.$createdAt, title: new Date(post.$createdAt).toLocaleString(), text: timeAgo(post.$createdAt) }), edited ? ' · edited' : '')),
      kindLabel ? h('span', { class: 'badge', text: kindLabel }) : null));

    // text (can be swapped for an editor)
    var bodyHolder = h('div');
    function showBody() { clear(bodyHolder); if (post.body) bodyHolder.appendChild(h('p', { class: 'post-body' }, isReel ? null : h('strong', { class: 'cap-name', text: name }), isReel ? '' : ' ', post.body)); }
    showBody();
    if (isReel) info.appendChild(bodyHolder);
    else if (!post.mediaFileId) card.appendChild(bodyHolder);   // text-only posts: text first; media posts: caption goes under the buttons

    // media
    if (post.mediaFileId) {
      if (post.kind === 'photo') card.appendChild(imageBlock(post));
      else if (post.kind === 'video' || post.kind === 'short') card.appendChild(videoBlock(post, post.kind === 'short'));
    }

    // actions
    var like = actionBtn('heart', 'Like', function () { toggleLike(); });
    var cmt = actionBtn('comment', 'Comments', function () { toggleComments(); });
    var save = actionBtn('bookmark', 'Save', function () { toggleSave(); });
    save.className = 'act save';
    function paintLike() { like.setCount(st.likes, (st.liked ? 'Remove your like. ' : 'Like. ') + st.likes + ' likes', !!st.liked); }
    function paintCmt() { cmt.setCount(st.comments, 'Comments. ' + st.comments + ' so far', undefined); cmt.setAttribute('aria-expanded', commentsEl ? 'true' : 'false'); }
    function paintSave() { save.setCount(null, S.saved.has(post.$id) ? 'Saved in ' + libName(libOf(post.$id)) + '. Change library or remove' : 'Save for later', S.saved.has(post.$id)); }
    var actions = h('div', { class: 'actions' }, like, cmt, save);
    if (isMine) {
      actions.appendChild(h('button', { class: 'act', type: 'button', 'aria-label': 'Edit your post text', onclick: startEdit }, icon('edit')));
    }
    if (isMine || S.isOwner) {
      actions.appendChild(h('button', { class: 'act', type: 'button', 'aria-label': isMine ? 'Delete your post' : 'Remove this post as family admin', onclick: removePost }, icon('trash')));
    }
    card.appendChild(actions);
    if (isReel) {
      info.appendChild(h('button', { class: 'reel-comment', type: 'button', text: 'Add comment…', onclick: function () { toggleComments(); } }));
      card.appendChild(info);
    } else if (post.mediaFileId) card.appendChild(bodyHolder);
    var commentsEl = null;
    paintLike(); paintCmt(); paintSave();

    async function toggleLike() {
      if (st.busy) return; st.busy = true;
      try {
        var r = await api('toggleReaction', { familyId: S.familyId, postId: post.$id });
        if (r.liked && !st.liked) st.likes++;
        if (!r.liked && st.liked) st.likes = Math.max(0, st.likes - 1);
        st.liked = r.liked;
      } catch (e) { toast(friendly(e)); }
      st.busy = false; paintLike();
      if (st.liked) { like.classList.add('pop'); setTimeout(function () { like.classList.remove('pop'); }, 450); }
    }

    async function toggleSave() {
      if (st.busy) return;
      if (S.saved.has(post.$id)) { savePicker(post, card, hooks, paintSave); return; }   // already saved: choose a library or remove
      st.busy = true;
      try {
        var r = await api('toggleBookmark', { familyId: S.familyId, postId: post.$id });
        if (r.saved) { S.saved.set(post.$id, ''); toast('Saved to ' + LATER_NAME + '. Tap the bookmark again to choose a library.'); }
        else { S.saved.delete(post.$id); if (hooks.onUnsave) hooks.onUnsave(card); }
      } catch (e) { toast(friendly(e)); }
      st.busy = false; paintSave();
    }

    function toggleComments() {
      if (commentsEl) { card.removeChild(commentsEl); commentsEl = null; paintCmt(); return; }
      commentsEl = commentsPanel(post, st, paintCmt);
      if (isReel) {
        commentsEl = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Comments' },
          h('div', { class: 'sheet-head' }, h('strong', { text: 'Comments' }), h('button', { class: 'btn secondary small', type: 'button', text: 'Close', onclick: toggleComments })), commentsEl);
      }
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
            await api('editPost', { familyId: S.familyId, postId: post.$id, body: text });
            post.body = text; post.$updatedAt = new Date().toISOString(); showBody();
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
               : 'You are removing a relative\'s post as a family owner. This removes its comments, likes and media too. It cannot be undone.', 'Delete');
      if (!ok) return;
      card.setAttribute('aria-busy', 'true');
      try {
        var done = false, n = 0;
        while (!done && n++ < 20) { done = (await api('deletePost', { familyId: S.familyId, postId: post.$id })).done; }   // the server removes comments, likes, saves and media too
        if (!done) throw new Error('That is taking longer than expected. Press delete again to finish.');
      } catch (e) { card.removeAttribute('aria-busy'); toast(e.message && !e.type ? e.message : friendly(e)); return; }
      S.saved.delete(post.$id); S.usage = null;
      if (card.parentNode) card.parentNode.removeChild(card);
      toast('Post deleted.');
    }
    return card;
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
          try { await api('deleteComment', { familyId: S.familyId, commentId: c.$id }); if (item.parentNode) item.parentNode.removeChild(item); st.comments = Math.max(0, st.comments - 1); onCount(); }
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
          var made = await api('createComment', { familyId: S.familyId, postId: post.$id, body: text });
          var row = { $id: made.commentId, authorId: uid, body: text, $createdAt: new Date().toISOString() };
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
      permissions: uploadPerms(S.familyId, S.user.$id),
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

  // How much photo and video space this family has used. The server is the authority on the limit.
  async function getUsage(force) {
    var u = S.usage;
    if (!force && u && u.familyId === S.familyId && Date.now() - u.at < 60000) return u.data;
    var fid = S.familyId;
    var r = await api('familyUsage', { familyId: fid });
    S.usage = { familyId: fid, at: Date.now(), data: r };
    return r;
  }
  async function renderUsage(box, withPolicy) {
    clear(box);
    try {
      var u = await getUsage();
      clear(box);
      var pct = Math.min(100, Math.round(u.usedBytes * 100 / Math.max(1, u.limitBytes)));
      box.appendChild(h('p', { class: 'small', text: 'Your family has used ' + fmtBytes(u.usedBytes) + ' of ' + fmtBytes(u.limitBytes) + ' of photo and video space.' }));
      box.appendChild(h('progress', { class: 'meter', max: 100, value: pct, 'aria-label': 'Family storage used: ' + pct + ' percent' }));
      if (withPolicy) box.appendChild(h('p', { class: 'hint', text: 'Nothing is deleted automatically. If the space fills up, new photos and videos pause and everything already shared stays. Text posts always work. This service is free to use, and the limit is a setting that may change as it grows.' }));
    } catch (e) { clear(box); }   // the explainer simply shows without the numbers
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
      var msg = h('div'), info = h('div', { class: 'hint' }), prev = h('div', { class: 'preview' }), limitsBox = h('div', { class: 'limits' });
      var bar = h('progress', { max: 100, value: 0, hidden: true, 'aria-label': 'Upload progress' });
      var fileInput = null;

      if (kind !== 'text') {
        var accept = kind === 'photo' ? 'image/jpeg,image/png,image/webp,image/heic,image/heif' : 'video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm';
        fileInput = h('input', { id: 'file', type: 'file', accept: accept });
        renderUsage(limitsBox, true);
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
            try {
              var uu = await getUsage();
              var est = kind === 'photo' ? Math.min(f.size, 1.5 * 1048576) : f.size;
              if (uu.usedBytes + est > uu.limitBytes) throw new Error('Your family has ' + fmtBytes(Math.max(0, uu.limitBytes - uu.usedBytes)) + ' of photo and video space left, and this file needs about ' + fmtBytes(est) + '. Nothing was uploaded and nothing has been deleted. You can remove posts you no longer need, or ask the family owner.');
            } catch (e2) { if (e2 && e2.message && !e2.type && !e2.apiCode && e2.name === 'Error') throw e2; }   // if the usage check itself fails, the server still checks on posting
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
        var fid = S.familyId;
        busy(btn, async function () {
          var uploaded = null;
          try {
            var payload = { familyId: fid, kind: kind, body: text };
            function onProg(p) { bar.hidden = false; bar.value = Math.round(p.progress || 0); }
            if (kind === 'photo') {
              btn.textContent = 'Preparing photo…';
              var jf = await imageToJpegFile(file, L.imageMaxEdge || 1600, L.imageQuality || 0.82, false, 'photo.jpg');
              btn.textContent = 'Uploading…';
              uploaded = await uploadFile(jf, onProg);
              payload.mediaFileId = uploaded.$id;
            } else if (kind === 'video' || kind === 'short') {
              var mime = videoMime(file);
              var ext = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[mime];
              btn.textContent = 'Uploading…';
              uploaded = await uploadFile(new File([file], 'video.' + ext, { type: mime }), onProg);
              payload.mediaFileId = uploaded.$id;
            }
            btn.textContent = 'Posting…';
            if (fid !== S.familyId) throw new Error('You switched families while uploading. Nothing was posted.');
            await api('createPost', payload);
            S.profiles.set(uid, S.profile); S.usage = null;
            toast('Posted!');
            location.hash = kind === 'short' ? '#/shorts' : '#/home';
          } catch (e) {
            if (uploaded) storage.deleteFile({ bucketId: CFG.bucketId, fileId: uploaded.$id }).catch(function () {});   // best effort; the server also sweeps leftovers
            bar.hidden = true;
            showAlert(msg, 'error', e.message && !e.type ? e.message : friendly(e));
          }
        }, 'Posting…');
      } },
        h('label', { for: 'body', text: kind === 'text' ? 'Your note' : 'Caption' }), ta,
        fileInput ? h('div', null, h('label', { for: 'file', text: kind === 'photo' ? 'Photo' : kind === 'short' ? 'Short video' : 'Video' }), fileInput, info, limitsBox, prev) : null,
        bar, msg, h('div', { class: 'stack' }, btn));
      holder.appendChild(tabs); holder.appendChild(form);
    }
    build();
  };

  /* =====================================================================
   * 11. FAMILY (members, invitations, leaving, deleting) + CREATE ANOTHER FAMILY
   * ===================================================================== */

  VIEWS.newfamily = function (main) {
    main.appendChild(h('h1', { text: 'Create another family' }));
    if (!S.canCreateFamily) {
      main.appendChild(h('div', { class: 'card' }, h('p', { text: 'You already own the maximum number of families (' + S.maxOwned + '). Delete one you no longer need, or ask another family\'s owner to make you an owner there.' })));
      return;
    }
    main.appendChild(familyCreateCard('Name your new family', 'You become its owner. It has its own members, posts and photos, completely separate from your other families.'));
  };

  VIEWS.family = async function (main, token) {
    var fam = currentFamily();
    main.appendChild(h('h1', { text: fam ? fam.name : 'Family' }));
    var listBox = h('div', { class: 'card' }, spinnerLine('Loading…'));
    main.appendChild(listBox);
    var res = await teams.listMemberships({ teamId: S.familyId, queries: [Query.limit(100)] });
    if (token !== S.nav) return;
    await loadProfiles();
    if (token !== S.nav) return;
    var joined = res.memberships.filter(function (m) { return m.confirm; });
    var me = joined.filter(function (m) { return m.userId === S.user.$id; })[0];
    if (!me) { S.validatedAt = 0; return route(false); }           // not a member any more: re-check with the server
    clear(listBox);
    var storageBox = h('div');
    main.appendChild(h('div', { class: 'card' }, h('h2', { text: 'Photo and video space' }), storageBox));
    renderUsage(storageBox, true);
    listBox.appendChild(h('h2', { text: joined.length + (joined.length === 1 ? ' member' : ' members') }));
    joined.forEach(function (m) {
      var p = S.profiles.get(m.userId) || null;
      var isOwnerRow = m.roles.indexOf('owner') >= 0;
      listBox.appendChild(h('div', { class: 'member' }, avatarEl(p || { displayName: m.userName || '?' }),
        h('div', { class: 'grow' }, h('strong', { text: p ? p.displayName : (m.userName || 'Family member') }),
          m.userId === S.user.$id ? h('span', { class: 'badge', text: ' You' }) : null,
          isOwnerRow ? h('span', { class: 'badge', text: ' Owner' }) : null)));
    });
    if (S.isOwner) renderAdminTools(main, token);
    else main.appendChild(h('p', { class: 'muted small', text: 'To add a relative, ask a family owner to invite their email address.' }));
    renderLeaveAndDelete(main, me, joined);
  };

  function renderAdminTools(main, token) {
    var fid = S.familyId;
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
          await teams.createMembership({ teamId: fid, roles: ['member'], email: e, name: name.input.value.trim() || undefined, url: baseUrl() + '?action=invite' });
          showAlert(msg, 'ok', 'Invitation sent to ' + e + '. They need to open the link in the email while signed in with that address.');
          email.input.value = ''; name.input.value = '';
          loadMemberships();
        } catch (err) { showAlert(msg, 'error', friendly(err)); }
      }, 'Sending…');
    } }, email.wrap, name.wrap, msg, h('div', { class: 'stack' }, btn));
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Invite a relative' },
      h('h2', { text: 'Invite a relative' }),
      h('p', { class: 'muted small', text: 'Only family owners can do this. Ask them to create an account and verify their email first, then send the invitation to that same address.' }), form));

    // ---- invitations and members ----
    main.appendChild(memberBox);
    async function loadMemberships() {
      clear(memberBox); memberBox.appendChild(h('h2', { text: 'Invitations and members' })); memberBox.appendChild(spinnerLine('Loading…'));
      try {
        var res = await teams.listMemberships({ teamId: fid, queries: [Query.limit(100)] });
        if (token !== S.nav) return;
        clear(memberBox); memberBox.appendChild(h('h2', { text: 'Invitations and members' }));
        res.memberships.forEach(function (m) {
          var self = m.userId === S.user.$id;
          var label = m.userName || m.userEmail || 'Family member';
          var isOwnerRow = m.roles.indexOf('owner') >= 0;
          memberBox.appendChild(h('div', { class: 'member' },
            h('div', { class: 'grow' }, h('strong', { text: label }),
              h('div', { class: 'small muted', text: (m.userEmail && m.userName ? m.userEmail + ' · ' : '') + (m.confirm ? 'Joined' : 'Invited, not accepted yet') + (isOwnerRow ? ' · Owner' : '') })),
            (m.confirm && !isOwnerRow) ? h('button', { class: 'btn secondary small', type: 'button', text: 'Make owner', 'aria-label': 'Make ' + label + ' an owner', onclick: async function () {
              var ok = await confirmDialog('Make ' + label + ' an owner?', 'Owners can invite and remove people, delete any post, and delete the whole family.', 'Make owner');
              if (!ok) return;
              try { await teams.updateMembership({ teamId: fid, membershipId: m.$id, roles: ['owner'] }); toast('Done.'); loadMemberships(); }
              catch (e) { toast(friendly(e)); }
            } }) : null,
            self ? null : h('button', { class: 'btn secondary small', type: 'button', text: m.confirm ? 'Remove' : 'Cancel invite', 'aria-label': (m.confirm ? 'Remove ' : 'Cancel the invitation for ') + label, onclick: async function () {
              var ok = await confirmDialog(m.confirm ? 'Remove this person?' : 'Cancel this invitation?', m.confirm ? 'They lose access to all of this family\'s posts and media right away. Their own posts stay unless deleted.' : 'The invitation link will stop working.', m.confirm ? 'Remove' : 'Cancel invite');
              if (!ok) return;
              try { await teams.deleteMembership({ teamId: fid, membershipId: m.$id }); toast('Removed.'); loadMemberships(); }
              catch (e) { toast(friendly(e)); }
            } })));
        });
      } catch (e) { clear(memberBox); memberBox.appendChild(alertBox('error', friendly(e))); }
    }
    loadMemberships();
  }

  function renderLeaveAndDelete(main, me, joined) {
    var fam = currentFamily(), fid = S.familyId;
    var owners = joined.filter(function (m) { return m.roles.indexOf('owner') >= 0; });
    var lmsg = h('div');
    var leaveCard = h('section', { class: 'card', 'aria-label': 'Leave this family' }, h('h2', { text: 'Leave this family' }));
    if (S.isOwner && owners.length <= 1) {
      leaveCard.appendChild(h('p', { class: 'muted small', text: 'You are the only owner. Make another member an owner first, or delete the family below.' }));
    } else {
      leaveCard.appendChild(h('p', { class: 'muted small', text: 'You will lose access to this family right away. Your posts and comments stay here unless you delete them first.' }));
      leaveCard.appendChild(lmsg);
      leaveCard.appendChild(h('div', { class: 'stack' }, h('button', { class: 'btn secondary', type: 'button', text: 'Leave ' + (fam ? fam.name : 'family'), onclick: function (ev) {
        var btn = ev.currentTarget;
        busy(btn, async function () {
          var ok = await confirmDialog('Leave ' + (fam ? fam.name : 'this family') + '?', 'You can only come back if an owner invites you again.', 'Leave');
          if (!ok) return;
          try {
            await teams.deleteMembership({ teamId: fid, membershipId: me.$id });
            S.notice = { kind: 'ok', text: 'You left the family.' };
            await afterMembershipChange();
          } catch (e) { showAlert(lmsg, 'error', friendly(e)); }
        });
      } })));
    }
    main.appendChild(leaveCard);

    if (!S.isOwner) return;
    var dmsg = h('div');
    var confirmInput = h('input', { id: 'delConfirm', type: 'text', autocomplete: 'off', placeholder: fam ? fam.name : '', 'aria-label': 'Type the family name to confirm' });
    var delBtn = h('button', { class: 'btn danger', type: 'button', text: 'Delete this family for everyone', disabled: true });
    confirmInput.addEventListener('input', function () { delBtn.disabled = !fam || confirmInput.value.trim() !== fam.name; });
    delBtn.addEventListener('click', function () {
      busy(delBtn, async function () {
        var ok = await confirmDialog('Delete ' + fam.name + '?', 'All posts, comments, likes, photos, videos, profiles and members of this family are removed permanently. This cannot be undone.', 'Delete everything');
        if (!ok) return;
        try {
          var done = false, n = 0;
          while (!done && n++ < 300) { done = (await api('deleteFamily', { familyId: fid })).done; showAlert(dmsg, 'ok', 'Deleting… this can take a minute for large families.'); }
          if (!done) throw new Error('Not finished yet. Press the button again to continue.');
          S.notice = { kind: 'ok', text: 'The family was deleted.' };
          await afterMembershipChange();
        } catch (e) { showAlert(dmsg, 'error', e.message && !e.type ? e.message : friendly(e)); }
      }, 'Deleting…');
    });
    main.appendChild(h('section', { class: 'card danger-zone', 'aria-label': 'Delete this family' },
      h('h2', { text: 'Delete this family' }),
      h('p', { class: 'muted small', text: 'Type the family name (' + (fam ? fam.name : '') + ') to enable the button.' }),
      confirmInput, dmsg, h('div', { class: 'stack' }, delBtn)));
  }

  /* =====================================================================
   * 12. SETTINGS (profile, appearance, account)
   * ===================================================================== */

  VIEWS.settings = function (main) {
    main.appendChild(h('h1', { text: 'Settings' }));

    // ---- profile (per family) ----
    var fam = currentFamily();
    var name = field('displayName', 'Display name', 'text', { required: true, maxlength: 60, value: S.profile.displayName });
    var pmsg = h('div');
    var avatarBox = h('div', { class: 'row' });
    function paintAvatar() { clear(avatarBox); avatarBox.appendChild(avatarEl(S.profile, 'lg')); }
    paintAvatar();
    var file = h('input', { id: 'newAvatar', type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choose a new profile picture' });
    var saveName = h('button', { class: 'btn', type: 'submit', text: 'Save name' });
    var removeAv = h('button', { class: 'btn secondary small', type: 'button', text: 'Remove picture' });
    var fid = S.familyId;

    async function saveProfile(extra) {
      var r = await api('saveProfile', Object.assign({ familyId: fid, displayName: S.profile.displayName }, extra));
      if (fid !== S.familyId) return;
      S.profile = Object.assign({}, S.profile, r.profile); S.profiles.set(S.user.$id, S.profile);
    }
    file.addEventListener('change', async function () {
      var f = file.files[0]; if (!f) return;
      showAlert(pmsg, 'error', '');
      var up = null;
      try {
        toast('Uploading picture…');
        up = await uploadFile(await imageToJpegFile(f, L.avatarEdge || 256, 0.85, true, 'avatar.jpg'));
        await saveProfile({ avatarFileId: up.$id });
        paintAvatar();
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
        try { await saveProfile({ avatarFileId: '' }); paintAvatar(); toast('Picture removed.'); }
        catch (e) { showAlert(pmsg, 'error', friendly(e)); }
      });
    });
    var pform = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var n = name.input.value.trim();
      if (!n) return showAlert(pmsg, 'error', 'Your display name cannot be empty.');
      busy(saveName, async function () {
        try {
          var r = await api('saveProfile', { familyId: fid, displayName: n });
          S.profile = Object.assign({}, S.profile, r.profile); S.profiles.set(S.user.$id, S.profile);
          showAlert(pmsg, 'ok', 'Saved.');
        } catch (e) { showAlert(pmsg, 'error', friendly(e)); }
      }, 'Saving…');
    } }, name.wrap, pmsg, h('div', { class: 'stack' }, saveName));
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Profile' }, h('h2', { text: 'Profile' }),
      h('p', { class: 'hint', text: 'This name and picture are shown only in ' + (fam ? fam.name : 'this family') + '. Each family has its own profile.' }),
      avatarBox,
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
      h('p', { class: 'small muted', text: 'Posts and media are visible only to members of the family they were shared in. Other families cannot see them, and nothing is public. No ads, no trackers, no face recognition or AI photo processing. Please remember that anyone who can see a photo could still take a screenshot or share it, so share thoughtfully.' })));
  };

  /* =====================================================================
   * 13. START-UP
   * ===================================================================== */

  async function boot() {
    applyPrefs();
    if (!window.Appwrite || !window.Appwrite.Client || !window.Appwrite.TablesDB || !window.Appwrite.Functions) {
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

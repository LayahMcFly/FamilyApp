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
    phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z'],
    video: ['M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M15 10.5l6-3.5v10l-6-3.5'],
    palette: ['M12 3a9 9 0 1 0 0 18c1.3 0 1.9-.9 1.5-2-.4-1.1.3-2 1.4-2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z', 'M7.8 12.2a.9.9 0 1 0 0-.01', 'M10 7.8a.9.9 0 1 0 0-.01', 'M14.4 7.8a.9.9 0 1 0 0-.01'],
    bag: ['M5 8h14l-1 12H6z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
    cart: ['M3 4h2.5l2.2 10.5h9.6L19.5 8H6.6', 'M9.5 19.2a.9.9 0 1 0 0-.01', 'M16.5 19.2a.9.9 0 1 0 0-.01'],
    users: ['M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20', 'M10 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z', 'M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.3', 'M15.5 4.8a3.2 3.2 0 0 1 0 6.1'],
    settings: ['M4 7h10', 'M18 7h2', 'M4 17h2', 'M10 17h10', 'M16 5v4', 'M8 15v4'],
    heart: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
    comment: ['M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'],
    edit: ['M4 20h4L19 9l-4-4L4 16z'],
    trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
    volume: ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9a4 4 0 0 1 0 6', 'M19 6.5a8 8 0 0 1 0 11'],
    mute: ['M4 9v6h4l5 4V5L8 9z', 'M17 9.5l5 5', 'M22 9.5l-5 5'],
    pin: ['M9 4h6l-1 6 3 3H7l3-3z', 'M12 13v7'],
    bell: ['M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z', 'M10 21h4'],
    tree: ['M12 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z', 'M5 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4z', 'M19 17a2 2 0 1 1 0 4 2 2 0 0 1 0-4z', 'M12 7v4', 'M5 17v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2'],
    user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'],
    eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    back: ['M15 5l-7 7 7 7'],
    lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    repost: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
    send: ['M22 3 9.5 14.5', 'M22 3l-7 18-5.5-6.5L3 9z'],
    play: ['M7 4.5v15l13-7.5z'],
    pause: ['M8 5v14', 'M16 5v14'],
    fullscreen: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
    up: ['M12 19V5', 'M6 11l6-6 6 6'], down: ['M12 5v14', 'M6 13l6 6 6-6'], left: ['M15 6l-6 6 6 6'], right: ['M9 6l6 6-6 6'],
    pencil: ['M4 20l1-4 11-11 3 3L8 19z', 'M14 7l3 3'], x: ['M6 6l12 12', 'M18 6 6 18'],
    flame: ['M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .2 1.2.8 2 1.7 2.3C10.2 8.5 10.5 5.5 12 3z']
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

  // The "Maintenance" screen: shown while the owner is updating (the switch is the file maintenance.json) or while the server is being redeployed.
  function maintenanceScreen(message) {
    screenMessage('Maintenance', [message || 'Family Circle is being updated. This page will open again by itself in a moment.'],
      h('div', { class: 'ld' }, loaderArt('gear'), h('span', { class: 'sr-only', text: 'Loading' })));
  }
  async function maintenanceFlag() {
    try {
      var r = await fetch('maintenance.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      var j = await r.json();
      if (!j || j.on !== true) return null;
      if (j.until && Date.now() > Date.parse(j.until)) return null;   // switches itself off if it is ever left on
      return { message: String(j.message || '').slice(0, 240) };
    } catch (e) { return null; }
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
    ['--accent', '--accent-text', '--on-accent', '--bg', '--surface', '--surface-2', '--border'].forEach(function (v) { el.style.removeProperty(v); });
    if (!prefs.accent) return;
    var dark = prefs.mode === 'dark' || (prefs.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    // Default style in light mode only: the page background takes on the chosen color (a light tint of it).
    if (!dark && prefs.preset === 'default') {
      el.style.setProperty('--bg', mix(prefs.accent, '#ffffff', 0.86));
      el.style.setProperty('--surface', mix(prefs.accent, '#ffffff', 0.86));
      el.style.setProperty('--surface-2', mix(prefs.accent, '#ffffff', 0.74));
      el.style.setProperty('--border', mix(prefs.accent, '#ffffff', 0.58));
    }
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
    if (window.FCChat) window.FCChat.stop();   // closes the chat connection and drops its messages from memory
    S.shop = null;   // carts, designs, orders and the catalog belong to one person in one family
    S.profile = null; S.profiles = new Map(); S.profilesAt = 0; S.origs = new Map(); S.saved = new Map(); S.usage = null;
    S.familyId = null; S.role = null; S.isOwner = false; S.ringRole = new Map();
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
  /* ---------- photos and videos kept on this device after the first view (browser Cache, private to this site) ---------- */
  var MEDIA_CACHE = 'fc-media-v1';
  function keepOn() { try { return localStorage.getItem('fc_keepmedia') !== 'off'; } catch (e) { return true; } }
  function cacheCapBytes() { return (CFG.mediaCacheMB || 300) * 1048576; }
  function cacheReq(id) { return new Request(location.origin + '/__fc_media/' + encodeURIComponent(id)); }
  async function mediaCacheGet(id) {
    if (!window.caches || !keepOn()) return null;
    try { var c = await caches.open(MEDIA_CACHE), r = await c.match(cacheReq(id)); return r ? await r.blob() : null; } catch (e) { return null; }
  }
  async function mediaCacheHas(id) {
    if (!window.caches || !keepOn()) return false;
    try { var c = await caches.open(MEDIA_CACHE); return !!(await c.match(cacheReq(id))); } catch (e) { return false; }
  }
  async function mediaCacheInfo() {
    var out = { count: 0, bytes: 0, items: [] };
    if (!window.caches) return out;
    try {
      var c = await caches.open(MEDIA_CACHE), keys = await c.keys();
      for (var i = 0; i < keys.length; i++) { var r = await c.match(keys[i]); if (!r) continue; var n = Number(r.headers.get('x-size') || 0); out.count++; out.bytes += n; out.items.push({ req: keys[i], size: n, saved: Number(r.headers.get('x-saved') || 0) }); }
    } catch (e) { /* the browser may block it */ }
    return out;
  }
  async function mediaCachePut(id, blob) {
    if (!window.caches || !keepOn() || !blob || blob.size > cacheCapBytes()) return;
    try {
      var c = await caches.open(MEDIA_CACHE);
      await c.put(cacheReq(id), new Response(blob, { headers: { 'content-type': blob.type || 'application/octet-stream', 'x-size': String(blob.size), 'x-saved': String(Date.now()) } }));
      var info = await mediaCacheInfo();
      if (info.bytes > cacheCapBytes()) {          // only the oldest local copies are dropped; nothing in the cloud is touched
        info.items.sort(function (a, b) { return a.saved - b.saved; });
        for (var i = 0; i < info.items.length && info.bytes > cacheCapBytes(); i++) { if (info.items[i].req.url.indexOf(encodeURIComponent(id)) >= 0) continue; await c.delete(info.items[i].req); info.bytes -= info.items[i].size; }
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    } catch (e) { /* out of room on this device: the file simply is not kept */ }
  }
  async function mediaCacheClear() { try { if (window.caches) await caches.delete(MEDIA_CACHE); } catch (e) {} }

  // keep = true keeps a copy on this device so the same photo or video is not downloaded again
  async function fetchMedia(fileId, keep, bucketId) {
    if (keep && !bucketId) { var hit = await mediaCacheGet(fileId); if (hit) return hit; }
    var url = storage.getFileView({ bucketId: bucketId || CFG.bucketId, fileId: fileId });
    var res = await fetch(url, {
      headers: { 'X-Appwrite-Project': CFG.projectId, 'X-Appwrite-JWT': await getJwt() },
      credentials: 'omit', cache: 'no-store'
    });
    if (!res.ok) { var err = new Error('Could not load the file (error ' + res.status + ').'); err.code = res.status; throw err; }
    var blob = await res.blob();
    if (keep && !bucketId) mediaCachePut(fileId, blob);
    return blob;
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
  /* ---------- LOADING SCENES: each part of the site has its own small animation (see .ld in styles.css) ---------- */
  var LOADER_ART = {
  "site": "<circle cx=\"32\" cy=\"32\" r=\"21\" fill=\"none\" stroke=\"currentColor\" stroke-opacity=\".2\" stroke-width=\"2\" stroke-dasharray=\"2 5\"/><g class=\"ld-orbit\"><circle cx=\"32\" cy=\"11\" r=\"5\"/><circle cx=\"53\" cy=\"27\" r=\"4\" opacity=\".75\"/><circle cx=\"45\" cy=\"52\" r=\"4.5\" opacity=\".85\"/><circle cx=\"19\" cy=\"52\" r=\"4\" opacity=\".7\"/><circle cx=\"11\" cy=\"27\" r=\"4.5\" opacity=\".9\"/></g><path class=\"ld-beat\" d=\"M32 45C21 37 19 29 24 26c4-2 7 0 8 3 1-3 4-5 8-3 5 3 3 11-8 19z\"/>",
  "cart": "<rect class=\"ld-drop d1\" x=\"21\" y=\"4\" width=\"10\" height=\"10\" rx=\"2\"/><circle class=\"ld-drop d2\" cx=\"40\" cy=\"9\" r=\"5.5\"/><path class=\"ld-drop d3\" d=\"M12 4l3 6h-6z\"/><g class=\"ld-roll\"><path d=\"M6 14h8l6 26h25l6-19H17\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"24\" cy=\"49\" r=\"4.5\"/><circle cx=\"42\" cy=\"49\" r=\"4.5\"/></g>",
  "orders": "<g class=\"ld-box\"><rect x=\"13\" y=\"28\" width=\"38\" height=\"25\" rx=\"3\"/><rect x=\"29\" y=\"28\" width=\"6\" height=\"25\" fill=\"#fff\" fill-opacity=\".35\"/></g><g class=\"ld-lid\"><rect x=\"11\" y=\"20\" width=\"42\" height=\"8\" rx=\"2.5\"/></g><path class=\"ld-rise\" d=\"M32 24C27 20 26 16 28 14c2-1 3.500 0 4 1.500.5-1.500 2-2.500 4-1.500 2 2 1 6-4 10z\"/>",
  "profile": "<circle class=\"ld-ring\" cx=\"32\" cy=\"32\" r=\"26\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"4\" stroke-linecap=\"round\"/><circle cx=\"32\" cy=\"26\" r=\"8\"/><path d=\"M17 50c1-9 7-13 15-13s14 4 15 13c-4 5-9 7-15 7s-11-2-15-7z\"/>",
  "saved": "<path class=\"ld-mark\" d=\"M20 8h24v46L32 44 20 54z\"/><path class=\"ld-spark\" d=\"M50 12l1.500 4 4 1.500-4 1.500L50 23l-1.500-4-4-1.500 4-1.500z\"/>",
  "feed": "<rect class=\"ld-card c1\" x=\"10\" y=\"8\" width=\"44\" height=\"14\" rx=\"4\"/><rect class=\"ld-card c2\" x=\"10\" y=\"26\" width=\"44\" height=\"14\" rx=\"4\"/><rect class=\"ld-card c3\" x=\"10\" y=\"44\" width=\"44\" height=\"14\" rx=\"4\"/>",
  "shorts": "<rect x=\"19\" y=\"4\" width=\"26\" height=\"56\" rx=\"6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.500\"/><path class=\"ld-play\" d=\"M28 22l11 8-11 8z\"/><rect class=\"ld-prog\" x=\"24\" y=\"50\" width=\"16\" height=\"3\" rx=\"1.500\"/>",
  "tree": "<path d=\"M32 58V30M32 44l-9-8M32 38l9-9\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.500\" stroke-linecap=\"round\"/><circle class=\"ld-leaf l1\" cx=\"32\" cy=\"22\" r=\"8\"/><circle class=\"ld-leaf l2\" cx=\"21\" cy=\"31\" r=\"6.500\"/><circle class=\"ld-leaf l3\" cx=\"43\" cy=\"27\" r=\"6.500\"/><circle class=\"ld-leaf l4\" cx=\"14\" cy=\"22\" r=\"5\"/><circle class=\"ld-leaf l5\" cx=\"50\" cy=\"16\" r=\"5\"/>",
  "bell": "<g class=\"ld-swing\"><path d=\"M32 8c-9 0-14 7-14 16v10l-5 7h38l-5-7V24c0-9-5-16-14-16z\"/><circle class=\"ld-clap\" cx=\"32\" cy=\"53\" r=\"4.500\"/></g>",
  "gear": "<g class=\"ld-spin\"><circle cx=\"32\" cy=\"32\" r=\"19\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"7\" stroke-dasharray=\"7.500 7.130\"/><circle cx=\"32\" cy=\"32\" r=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"5\"/></g><circle cx=\"32\" cy=\"32\" r=\"5\"/>",
  "comments": "<path d=\"M10 12h44a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4H30l-10 10V42h-10a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z\"/><circle class=\"ld-dot a\" cx=\"22\" cy=\"27\" r=\"3\" fill=\"#fff\"/><circle class=\"ld-dot b\" cx=\"32\" cy=\"27\" r=\"3\" fill=\"#fff\"/><circle class=\"ld-dot c\" cx=\"42\" cy=\"27\" r=\"3\" fill=\"#fff\"/>",
  "photo": "<rect x=\"8\" y=\"10\" width=\"48\" height=\"44\" rx=\"5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.500\"/><circle class=\"ld-sun\" cx=\"23\" cy=\"25\" r=\"5\"/><path class=\"ld-hill\" d=\"M12 48l14-14 9 9 8-8 9 13\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.500\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>",
  "video": "<rect x=\"19\" y=\"4\" width=\"26\" height=\"56\" rx=\"6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.500\"/><path class=\"ld-play\" d=\"M28 22l11 8-11 8z\"/><rect class=\"ld-prog\" x=\"24\" y=\"50\" width=\"16\" height=\"3\" rx=\"1.500\"/>"
};
  var LOADER_FOR_VIEW = { home: 'feed', post: 'feed', shorts: 'shorts', saved: 'saved', profile: 'profile', settings: 'gear', shop: 'cart', orders: 'orders', tree: 'tree', family: 'tree', activity: 'bell', create: 'photo' };
  function loaderKind(kind) {
    if (kind && LOADER_ART[kind]) return kind;
    var v = S.main && S.main.getAttribute('data-view');
    return LOADER_FOR_VIEW[v] || 'site';
  }
  function loaderArt(kind) {
    var k = loaderKind(kind), art = document.createElement('span');
    art.className = 'ld-art ld-' + k; art.setAttribute('aria-hidden', 'true');
    art.innerHTML = '<svg viewBox="0 0 64 64" width="100%" height="100%" fill="currentColor" focusable="false">' + LOADER_ART[k] + '</svg>';
    return art;
  }
  function spinnerLine(text, kind) { return h('div', { class: 'ld', role: 'status' }, loaderArt(kind), h('span', { class: 'ld-text', text: text })); }

  function imageBlock(post) {
    var token = S.nav;
    var mime = OK_IMAGE.indexOf(post.mediaMime) >= 0 ? post.mediaMime : 'image/jpeg';
    var box = h('div', { class: 'media placeholder' }, spinnerLine('Loading photo…', 'photo'));
    function load() {
      clear(box); box.className = 'media placeholder'; box.appendChild(spinnerLine('Loading photo…', 'photo'));
      fetchMedia(post.mediaFileId, true).then(function (blob) {
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
  S.muted = true;                        // every video starts silent after a page load; once someone turns sound on, it stays on until the tab is reloaded
  function syncSound() {
    Array.prototype.forEach.call(document.querySelectorAll('.reel-media'), function (b) {
      var v = b.querySelector('video'); if (v) v.muted = S.muted;
      if (b.__paintSound) b.__paintSound();
    });
  }
  // Autoplay Shorts is a per-device switch in Settings (on by default). Off means: tap to download and play.
  // Until the person chooses, Shorts do not download by themselves on mobile data, a slow connection or when the phone's data saver is on.
  function dataSaverDevice() { var c = navigator.connection; return !!(c && (c.saveData || c.type === 'cellular' || /(^|-)2g$/.test(c.effectiveType || ''))); }
  function autoplayChosen() { try { var v = localStorage.getItem('fc_autoplay'); return v === 'on' || v === 'off'; } catch (e) { return false; } }
  function autoplayOn() { try { var v = localStorage.getItem('fc_autoplay'); if (v === 'on') return true; if (v === 'off') return false; } catch (e) { /* fall through */ } return !dataSaverDevice(); }
  function observeReel(box) {
    if (!('IntersectionObserver' in window)) { box.__activate(); return; }
    if (!S.reelIO) {
      S.reelIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.intersectionRatio >= 0.6) en.target.__activate(); else en.target.__deactivate(); });
      }, { root: S.main, threshold: [0, 0.6, 1] });
    }
    S.reelIO.observe(box);
  }
  function captionProgress() {
    var line = h('p', { text: 'Starting…' }), bar = h('progress', { max: 100 }); bar.hidden = true;
    var dlg = h('dialog', { class: 'sheet-dialog', 'aria-label': 'Making captions' }, h('div', { class: 'stack' },
      h('strong', { text: 'Making captions' }), line, bar,
      h('p', { class: 'small muted', text: 'This happens on your phone. The sound of the video is not sent anywhere. Keep this page open.' })));
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); });
    document.body.appendChild(dlg); dlg.showModal();
    return {
      say: function (t, pct) { line.textContent = t; if (pct == null) bar.hidden = true; else { bar.hidden = false; bar.value = pct; } },
      close: function () { try { dlg.close(); } catch (e) {} if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }
    };
  }
  // Returns the cue list, or null if it could not be made (the reason is shown to the person).
  async function makeCaptionCues(blob) {
    if (!window.Captions) { toast('Captions are not available right now.'); return null; }
    var pg = captionProgress();
    try {
      var r = await window.Captions.transcribe(blob, { onStatus: pg.say });
      if (r.cut) toast('This video is long, so only the first part is captioned.');
      return r.cues;
    } catch (e) {
      var offline = e && /fetch|network|load failed|Failed to/i.test(String(e.message || e));
      toast(offline ? 'Could not download the speech model. Check your connection and try again.' : (e && e.message ? e.message : 'Captions could not be made on this device.'));
      return null;
    } finally { pg.close(); }
  }

  /* ---------- automatic captions: a "CC" button over the video, using the lines saved with the post ---------- */
  function ccOn() { try { return localStorage.getItem('fc_cc') !== 'off'; } catch (e) { return true; } }

  /* ---------- OUR OWN VIDEO PLAYER (replaces the browser's plain controls) ---------- */
  function clock(t) { t = Math.max(0, Math.floor(t || 0)); var m = Math.floor(t / 60), s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  /** Stops the browser from adding its own controls bar, three-dot menu, full-screen, picture-in-picture or cast button. */
  function noNativeUi(v) {
    v.controls = false; v.removeAttribute('controls');
    v.setAttribute('controlsList', 'nodownload nofullscreen noremoteplayback noplaybackrate');
    v.setAttribute('disablePictureInPicture', ''); v.setAttribute('disableRemotePlayback', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.setAttribute('x-webkit-airplay', 'deny');
    try { v.disablePictureInPicture = true; v.disableRemotePlayback = true; } catch (e) { /* older browser */ }
    v.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    v.addEventListener('enterpictureinpicture', function () { try { document.exitPictureInPicture(); } catch (e) { /* ok */ } });
    v.addEventListener('webkitbeginfullscreen', function () { try { v.webkitExitFullscreen(); } catch (e) { /* ok */ } });
  }
  function customPlayer(v, box) {
    v.controls = false; v.removeAttribute('controls');
    noNativeUi(v);
    v.muted = S.muted;
    box.classList.add('player');
    var old = box.querySelector('.pl-ui'); if (old) box.removeChild(old);
    var big = h('button', { class: 'pl-big', type: 'button', 'aria-label': 'Play video', onclick: function (ev) { ev.stopPropagation(); toggle(); } }, icon('play'));
    var playBtn = h('button', { class: 'pl-btn', type: 'button', 'aria-label': 'Play', onclick: function (ev) { ev.stopPropagation(); toggle(); } });
    var seek = h('input', { class: 'pl-seek', type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Seek' });
    var time = h('span', { class: 'pl-time', text: '0:00 / 0:00' });
    var muteBtn = h('button', { class: 'pl-btn', type: 'button', onclick: function (ev) { ev.stopPropagation(); v.muted = !v.muted; S.muted = v.muted; paintMute(); } });
    var speed = h('button', { class: 'pl-btn pl-speed', type: 'button', 'aria-label': 'Playback speed 1x', text: '1x', onclick: function (ev) {
      ev.stopPropagation(); var list = [1, 1.5, 2, 0.5], i = (list.indexOf(v.playbackRate) + 1) % list.length; v.playbackRate = list[i];
      speed.textContent = list[i] + 'x'; speed.setAttribute('aria-label', 'Playback speed ' + list[i] + 'x');
    } });
    var fsBtn = h('button', { class: 'pl-btn', type: 'button', 'aria-label': 'Full screen', onclick: function (ev) {
      ev.stopPropagation();
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (box.requestFullscreen) box.requestFullscreen().catch(function () {});
      else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();      // iPhone plays full screen in its own player
    } }, icon('fullscreen'));
    var bar = h('div', { class: 'pl-bar' }, playBtn, seek, time, speed, muteBtn, fsBtn);
    var ui = h('div', { class: 'pl-ui' }, big, bar);
    box.appendChild(ui);
    var hideT = null, dragging = false;
    function toggle() { if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); wake(); }
    function paintPlay() {
      var paused = v.paused || v.ended;
      clear(playBtn); playBtn.appendChild(icon(paused ? 'play' : 'pause')); playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
      big.setAttribute('aria-label', paused ? 'Play video' : 'Pause video');
      box.classList.toggle('is-paused', paused);
    }
    function paintMute() {
      clear(muteBtn); muteBtn.appendChild(icon(v.muted ? 'mute' : 'volume')); muteBtn.setAttribute('aria-label', v.muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off');
    }
    function paintTime() {
      var d = isFinite(v.duration) ? v.duration : 0;
      if (!dragging) { var pct = d ? v.currentTime / d : 0; seek.value = Math.round(pct * 1000); seek.style.setProperty('--pct', (pct * 100).toFixed(1) + '%'); }
      time.textContent = clock(v.currentTime) + ' / ' + clock(d);
      seek.setAttribute('aria-valuetext', clock(v.currentTime) + ' of ' + clock(d));
    }
    function wake() {
      box.classList.add('show-ui'); clearTimeout(hideT);
      if (!v.paused) hideT = setTimeout(function () { if (!box.contains(document.activeElement) || document.activeElement === v) box.classList.remove('show-ui'); }, 2800);
    }
    seek.addEventListener('input', function () {
      dragging = true; var d = isFinite(v.duration) ? v.duration : 0; v.currentTime = d * seek.value / 1000;
      seek.style.setProperty('--pct', (seek.value / 10) + '%'); time.textContent = clock(v.currentTime) + ' / ' + clock(d); wake();
    });
    seek.addEventListener('change', function () { dragging = false; });
    seek.addEventListener('click', function (ev) { ev.stopPropagation(); });
    v.addEventListener('play', function () { paintPlay(); wake(); });
    v.addEventListener('pause', function () { paintPlay(); wake(); });
    v.addEventListener('ended', paintPlay);
    v.addEventListener('timeupdate', paintTime);
    v.addEventListener('loadedmetadata', paintTime);
    v.addEventListener('durationchange', paintTime);
    v.addEventListener('volumechange', paintMute);
    box.addEventListener('click', function (ev) {
      if (ev.target.closest('.pl-bar, .cc-btn')) return;
      if (box.classList.contains('show-ui') && !v.paused) { toggle(); } else if (v.paused) toggle(); else wake();
    });
    box.addEventListener('mousemove', wake);
    box.addEventListener('keydown', function (ev) {
      if (ev.target.closest && ev.target.closest('input')) return;
      if (ev.key === ' ' && ev.target === box) { ev.preventDefault(); toggle(); }
    });
    box.addEventListener('focusin', wake);
    paintPlay(); paintMute(); paintTime(); box.classList.add('show-ui');
  }

  function applyCaptions(v, box, post) {
    Array.prototype.forEach.call(v.querySelectorAll('track'), function (t) { if (t.__url) URL.revokeObjectURL(t.__url); v.removeChild(t); });
    var old = box.querySelector('.cc-btn'); if (old) box.removeChild(old);
    var reelEl = box.closest ? box.closest('.reel') : null, holder0 = reelEl || box;
    Array.prototype.forEach.call(holder0.querySelectorAll('.cc-line'), function (x) { x.parentNode.removeChild(x); });
    var cues = window.Captions ? window.Captions.parse(post.captions) : [];
    post.__cc = { v: v, box: box };
    if (!cues.length) return;
    var tr = document.createElement('track');
    tr.kind = 'captions'; tr.srclang = 'en'; tr.label = 'English (automatic)';
    tr.__url = URL.createObjectURL(new Blob([window.Captions.toVtt(cues, box.classList.contains('reel-media') ? 'line:68% position:42% size:70% align:center' : '')], { type: 'text/vtt' }));
    tr.src = tr.__url; v.appendChild(tr);
    // The words are drawn by the page, not the browser, so they can wear the person's appearance style (colors, corners, font).
    var line = h('div', { class: 'cc-line', 'aria-hidden': 'true', hidden: true }, h('span', { class: 'cc-text' }));
    // On a Short the words sit at the top of the info block, so they appear right above the poster's name and picture.
    var info = reelEl && reelEl.querySelector('.reel-info');
    if (info) { line.classList.add('in-info'); info.insertBefore(line, info.firstChild); } else box.appendChild(line);
    var shown = true;
    function showCue() {
      var a = tr.track.activeCues, t = '';
      for (var i = 0; a && i < a.length; i++) t += (t ? ' ' : '') + a[i].text;
      line.firstChild.textContent = t; line.hidden = !(shown && t);
    }
    // The words are drawn by the page. Some phones switch the browser's own captions on again after load (an accessibility setting), which showed every line twice, so keep the built-in ones hidden.
    function hush() { for (var k = 0; k < v.textTracks.length; k++) if (v.textTracks[k].mode === 'showing') v.textTracks[k].mode = 'hidden'; }
    tr.track.mode = 'hidden';
    try { v.textTracks.addEventListener('change', hush); } catch (e) {}
    ['loadedmetadata', 'loadeddata', 'play', 'playing', 'seeked'].forEach(function (n) { v.addEventListener(n, hush); });
    tr.track.addEventListener('cuechange', function () { hush(); });
    tr.track.addEventListener('cuechange', showCue);
    function paint(on) {
      shown = on; showCue();
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Captions are on. Turn captions off' : 'Captions are off. Turn captions on');
      btn.classList.toggle('on', on);
    }
    var btn = h('button', { class: 'cc-btn', type: 'button', text: 'CC', onclick: function (ev) {
      ev.stopPropagation();
      var on = !shown;
      try { localStorage.setItem('fc_cc', on ? 'on' : 'off'); } catch (e) {}
      paint(on);
    } });
    box.appendChild(btn); paint(ccOn());
  }

  function reelVideo(post, mime) {
    var token = S.nav;
    var box = h('div', { class: 'media placeholder reel-media' });
    var st = { v: null, url: null, loading: null, active: false, wantPlay: false, kept: false };
    mediaCacheHas(post.mediaFileId).then(function (k) { st.kept = k; if (k && st.active && !st.v) load(true); });
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
    function wait(text) { clear(box); box.className = 'media placeholder reel-media'; box.appendChild(spinnerLine(text, 'shorts')); }
    function idle() {                    // autoplay is off: nothing downloads until the person taps
      clear(box); box.className = 'media placeholder reel-media';
      box.appendChild(h('div', null,
        h('button', { class: 'btn', type: 'button', text: 'Play video' + (post.mediaSize ? ' (' + fmtMB(post.mediaSize) + ')' : ''), onclick: function (ev) { ev.stopPropagation(); load(true); } }),
        h('p', { class: 'hint', text: autoplayChosen() ? 'Autoplay is off, so this video downloads only when you tap play. You can change this in Settings.' : 'You seem to be on mobile data, so videos wait for a tap to save your data. You can turn autoplay on in Settings, under Storage and downloads.' })));
    }
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
      st.loading = fetchMedia(post.mediaFileId, true).then(function (blob) {
        st.loading = null;
        if (token !== S.nav) return;
        st.url = URL.createObjectURL(new Blob([blob], { type: mime }));
        clear(box); box.className = 'media reel-media';
        var v = h('video', { src: st.url, loop: true, playsinline: true, preload: 'auto', 'aria-label': 'Family video' });
        noNativeUi(v);
        v.muted = S.muted;
        v.addEventListener('loadedmetadata', function () { box.classList.toggle('wide', v.videoWidth > v.videoHeight); });   // landscape videos are shown whole, not cropped
        var lastT = 0;
        v.addEventListener('timeupdate', function () {
          if (v.duration) fill.style.width = (v.currentTime / v.duration * 100) + '%';
          var t = v.currentTime, d = v.duration;
          if (d > 1 && lastT > d - 0.7 && t < 0.7 && lastT > t) box.dispatchEvent(new CustomEvent('reelloop', { bubbles: true }));   // the Short just started over
          lastT = t;
        });
        // Wide videos: a blurred, zoomed copy of the picture fills the empty space above and below (drawn small, so it costs almost nothing).
        var bg = h('canvas', { class: 'reel-bg', width: 48, height: 86, 'aria-hidden': 'true' }), bgx = bg.getContext('2d'), bgRaf = 0;
        function paintBg() {
          if (!v.videoWidth || !box.classList.contains('wide')) return;
          var cw = bg.width, ch = bg.height, k = Math.max(cw / v.videoWidth, ch / v.videoHeight), dw = v.videoWidth * k, dh = v.videoHeight * k;
          try { bgx.drawImage(v, (cw - dw) / 2, (ch - dh) / 2, dw, dh); } catch (e) { /* not ready yet */ }
        }
        function bgLoop() { paintBg(); bgRaf = v.paused || v.ended ? 0 : requestAnimationFrame(bgLoop); }
        v.addEventListener('play', function () { cancelAnimationFrame(bgRaf); bgLoop(); });
        ['loadeddata', 'seeked', 'pause', 'loadedmetadata'].forEach(function (n) { v.addEventListener(n, paintBg); });
        box.appendChild(bg); box.appendChild(v); box.appendChild(snd); box.appendChild(bar); box.__paintSound(); applyCaptions(v, box, post);
        st.v = v; trackLoaded();
        if (st.wantPlay && st.active) playNow();
      }).catch(function (e) { st.loading = null; if (token === S.nav) fail(e); });
    }
    // Press and hold the video to pause it; let go and it carries on. Holding never selects or highlights anything.
    var holdTimer = null, held = false, heldWasPlaying = false;
    function endHold() { clearTimeout(holdTimer); if (held) { held = false; if (heldWasPlaying && st.v && st.active) playNow(); heldWasPlaying = false; } }
    box.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest && ev.target.closest('button, a, input, .pl-ui')) return;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () { if (!st.v) return; held = true; heldWasPlaying = !st.v.paused; st.v.pause(); clearTimeout(tapTimer); }, 220);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { box.addEventListener(n, endHold); });
    box.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    var lastTap = 0, tapTimer = null, holdSwallow = 0;
    box.addEventListener('pointerup', function () { if (held) holdSwallow = Date.now(); }, true);
    box.addEventListener('click', function (ev) {
      if (Date.now() - holdSwallow < 400) { holdSwallow = 0; return; }      // the tap that ends a hold is not a tap
      var now = Date.now();
      if (box.__dbl && now - lastTap < 300) {            // double tap: send a heart, never pause
        clearTimeout(tapTimer); lastTap = 0;
        var r = box.getBoundingClientRect(); box.__dbl(ev.clientX - r.left, ev.clientY - r.top); return;
      }
      lastTap = now;
      if (!st.v) return;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () { if (!st.v) return; if (st.v.paused) playNow(); else st.v.pause(); }, box.__dbl ? 280 : 0);
    });
    box.__activate = function () {
      st.active = true;
      if (st.v) playNow(); else if (autoplayOn() || st.kept) load(true);
      if (!autoplayOn()) return;
      var card = box.closest ? box.closest('.reel') : null, nx = card && card.nextElementSibling;
      var m = nx && nx.querySelector ? nx.querySelector('.reel-media') : null;
      if (m && m.__prefetch) m.__prefetch();          // get the next video ready so the swipe feels instant
    };
    // Scrolling away stops the video and rewinds it, so it starts from the beginning when you scroll back.
    box.__deactivate = function () { st.active = false; box.dispatchEvent(new CustomEvent('reelreset', { bubbles: true })); if (st.v) { st.v.pause(); try { st.v.currentTime = 0; } catch (e) {} } };
    box.__prefetch = function () { load(false); };
    box.__unload = function () {
      if (st.active) return false;
      if (st.v) { st.v.pause(); st.v.removeAttribute('src'); st.v.load(); }
      if (st.url) URL.revokeObjectURL(st.url);
      st.url = null; st.v = null; if (autoplayOn()) wait('Loading…'); else idle();
      return true;
    };
    if (autoplayOn()) wait('Loading…'); else idle();
    observeReel(box);
    return box;
  }

  /* ---------- animated tab icon: the rainbow turns (drawn frame by frame, so it moves in every desktop browser) ---------- */
  (function animateFavicon() {
    try {
      if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var PATH = new Path2D('M13.691999999999997 50.538000000000004Q11.253999999999998 50.354 10.494999999999997 49.342Q9.735999999999997 48.33 9.735999999999997 46.812000000000005Q9.735999999999997 45.11 10.333999999999996 42.718Q10.931999999999997 40.326 11.897999999999996 37.612Q12.863999999999997 34.898 14.013999999999998 32.230000000000004Q13.507999999999997 32.276 12.426999999999996 32.368Q11.345999999999997 32.46 10.218999999999998 32.575Q9.091999999999997 32.69 8.401999999999997 32.828Q8.539999999999997 31.402 9.482999999999997 30.597Q10.425999999999997 29.792 11.920999999999996 29.424Q13.415999999999997 29.056 15.163999999999996 29.01Q16.359999999999996 25.698 17.624999999999996 22.547Q18.889999999999997 19.396 20.177999999999997 16.774Q19.901999999999997 16.728 19.534 16.705000000000002Q19.165999999999997 16.682000000000002 18.522 16.682000000000002Q15.715999999999998 16.682000000000002 14.174999999999997 17.28Q12.633999999999997 17.878 12.058999999999997 18.982Q11.483999999999996 20.086000000000002 11.483999999999996 21.696Q11.483999999999996 22.846 11.713999999999995 23.789Q11.943999999999996 24.732000000000003 12.403999999999996 25.836000000000002Q10.241999999999997 25.468 9.321999999999997 24.433Q8.401999999999997 23.398000000000003 8.401999999999997 21.834000000000003Q8.401999999999997 19.442 10.172999999999996 17.602Q11.943999999999996 15.762 14.956999999999997 14.704Q17.97 13.646 21.741999999999997 13.646Q24.179999999999996 13.646 26.617999999999995 13.968Q29.055999999999997 14.29 31.171999999999997 14.29Q32.321999999999996 14.29 33.379999999999995 14.129000000000001Q34.437999999999995 13.968000000000004 35.818 13.600000000000001Q33.61 16.038 32.206999999999994 16.866Q30.803999999999995 17.694000000000003 29.469999999999995 17.694000000000003Q28.365999999999996 17.694000000000003 26.617999999999995 17.395000000000003Q24.869999999999997 17.096000000000004 22.845999999999997 16.958000000000002Q22.247999999999998 18.430000000000003 21.557999999999996 20.362000000000002Q20.867999999999995 22.294 20.154999999999994 24.502000000000002Q19.441999999999997 26.71 18.705999999999996 29.056Q21.097999999999995 29.240000000000002 23.029999999999994 29.470000000000002Q24.961999999999996 29.700000000000003 27.307999999999996 29.792Q26.755999999999997 30.528000000000002 26.180999999999997 30.965000000000003Q25.605999999999998 31.402 24.662999999999997 31.586000000000002Q23.719999999999995 31.770000000000003 22.086999999999996 31.862000000000002Q20.453999999999997 31.954 17.831999999999997 32.0Q17.464 33.38 17.049999999999997 34.806Q16.635999999999996 36.232 16.336999999999996 37.244Q16.037999999999997 38.256 15.945999999999996 38.486000000000004Q14.657999999999996 42.902 14.174999999999997 45.685Q13.691999999999997 48.468 13.691999999999997 50.538000000000004Z M40.556 50.538000000000004Q37.059999999999995 50.538000000000004 34.82899999999999 48.882000000000005Q32.598 47.226 31.563 44.604Q30.528 41.982 30.528 39.176Q30.528 35.542 31.631999999999998 31.885Q32.736 28.228 34.691 24.916000000000004Q36.646 21.604000000000003 39.129999999999995 19.028000000000002Q41.614 16.452 44.443 14.957000000000003Q47.272 13.462000000000003 50.077999999999996 13.462000000000003Q52.102 13.462000000000003 53.482 14.405000000000003Q54.861999999999995 15.348000000000003 54.861999999999995 17.648000000000003Q54.861999999999995 19.028000000000002 54.379 20.730000000000004Q53.896 22.432000000000002 53.091 24.019000000000002Q52.286 25.606 51.274 26.618000000000002Q50.262 27.630000000000003 49.20399999999999 27.630000000000003Q48.744 27.630000000000003 48.238 27.308Q47.732 26.986 47.318 26.204Q48.007999999999996 25.422 48.882 24.295Q49.756 23.168000000000003 50.538 21.903000000000002Q51.31999999999999 20.638 51.82599999999999 19.419000000000004Q52.331999999999994 18.200000000000003 52.331999999999994 17.28Q52.331999999999994 16.452 51.87199999999999 15.969000000000001Q51.41199999999999 15.486 50.262 15.486Q48.238 15.486 46.099 17.004Q43.959999999999994 18.522000000000002 41.982 21.075000000000003Q40.004 23.628 38.417 26.779000000000003Q36.83 29.930000000000003 35.91 33.265Q34.989999999999995 36.6 34.989999999999995 39.59Q34.989999999999995 41.798 35.657 43.79900000000001Q36.324 45.800000000000004 37.796 47.065Q39.268 48.33 41.66 48.33Q44.144 48.33 46.605 46.95Q49.065999999999995 45.57 51.113 43.316Q53.16 41.062 54.402 38.486000000000004L55.598 39.268Q53.988 42.35 51.733999999999995 44.903000000000006Q49.48 47.456 46.650999999999996 48.997Q43.821999999999996 50.538000000000004 40.556 50.538000000000004Z');
      var cv = document.createElement('canvas'); cv.width = cv.height = 64;
      var cx = cv.getContext('2d'); if (!cx || !cv.toDataURL) return;
      var PAL = {
        '': ['#ff3b6b', '#ff8a1f', '#ffd60a', '#3ddc84', '#22b8ff', '#7c4dff', '#e040fb', '#ff3b6b'],
        married: ['#f7d774', '#c98a14', '#fff0b0', '#b87a10', '#f7d774', '#ffe9a0', '#c98a14', '#f7d774'],
        grand: ['#8fa7d8', '#f4f8ff', '#6f8fd0', '#d9e4ff', '#a28bdc', '#f4f8ff', '#8fa7d8', '#8fa7d8']
      };
      var link = null, a = 0, timer = null;
      function frame() {
        cx.clearRect(0, 0, 64, 64);
        var COLORS = window.FC_RING_COLORS || PAL[document.documentElement.getAttribute('data-ring') || ''] || PAL[''];
        var g = cx.createConicGradient ? cx.createConicGradient(a, 32, 32) : cx.createLinearGradient(0, 0, 64, 64);
        COLORS.forEach(function (c, i) { g.addColorStop(i / (COLORS.length - 1), c); });
        cx.fillStyle = g;
        cx.beginPath(); if (cx.roundRect) cx.roundRect(0, 0, 64, 64, 16); else cx.rect(0, 0, 64, 64); cx.fill();
        cx.lineJoin = 'round'; cx.lineWidth = 2.4; cx.strokeStyle = '#2a1456'; cx.stroke(PATH);
        cx.fillStyle = '#fff'; cx.fill(PATH);
        if (!link) {
          Array.prototype.forEach.call(document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]'), function (l) { l.parentNode.removeChild(l); });
          link = document.createElement('link'); link.rel = 'icon'; link.type = 'image/png'; document.head.appendChild(link);
        }
        if (window.FC_UNREAD > 0) {   // red dot for unread chat messages
          cx.beginPath(); cx.arc(48, 16, 15, 0, 6.2832); cx.fillStyle = '#fff'; cx.fill();
          cx.beginPath(); cx.arc(48, 16, 11.5, 0, 6.2832); cx.fillStyle = '#e5173f'; cx.fill();
        }
        link.href = cv.toDataURL('image/png');
        a += 0.05;   // a full turn takes about 15 seconds
      }
      function run() { if (timer || document.hidden) return; frame(); timer = setInterval(frame, 120); }
      function stop() { clearInterval(timer); timer = null; }
      document.addEventListener('fc-chat-unread', function () {
        frame();   // repaint once, even in a background tab
        document.title = document.title.replace(/^\(\d+\+?\) /, '');
        var n = window.FC_UNREAD || 0; if (n > 0) document.title = '(' + (n > 99 ? '99+' : n) + ') ' + document.title;
      });
      document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else run(); });
      run();
    } catch (e) {}
  })();
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
        h('p', { class: 'hint', text: 'Videos download only when you tap play, to save data. After that, this device keeps a copy so it does not download again.' })));
    }
    function start(play) {
      clear(box); box.className = 'media placeholder' + (vertical ? ' vertical' : '');
      box.appendChild(spinnerLine(play === false ? 'Opening video…' : 'Downloading video…', 'video'));
      fetchMedia(post.mediaFileId, true).then(function (blob) {
        if (token !== S.nav) return;
        clear(box); box.className = 'media' + (vertical ? ' vertical' : '');
        var v = h('video', { src: blobUrl(blob, mime), playsinline: true, preload: 'auto', 'aria-label': 'Family video' });
        box.appendChild(v); customPlayer(v, box); applyCaptions(v, box, post);
        var ringKind = S.ringRole && S.ringRole.get(post.authorId); if (ringKind) box.setAttribute('data-ring', ringKind); else box.removeAttribute('data-ring');   // the play button wears the poster's ring colors
        if (play !== false) { var p = v.play(); if (p && p.catch) p.catch(function () { /* the person can press play */ }); }
      }).catch(function (e) { if (token === S.nav) showButton("Couldn't load this video. " + (e.code === 401 ? 'You may not have access.' : 'Please try again.')); });
    }
    showButton();
    mediaCacheHas(post.mediaFileId).then(function (kept) { if (kept && token === S.nav) start(false); });   // already on this device: show it without a new download
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
  // No picture: one cursive letter on a gradient of the person's favorite color. Without a favorite color, the theme's own colors are used.
  function firstLetter(name) { var t = String(name || '?').trim(); return (t ? Array.from(t)[0] : '?').toUpperCase(); }
  var colorProbe = null;
  function rgbOf(c) {
    try {
      if (!colorProbe) { var cv = document.createElement('canvas'); cv.width = cv.height = 1; colorProbe = cv.getContext('2d', { willReadFrequently: true }); }
      colorProbe.clearRect(0, 0, 1, 1); colorProbe.fillStyle = '#000'; colorProbe.fillStyle = c; colorProbe.fillRect(0, 0, 1, 1);
      var d = colorProbe.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
    } catch (e) { return null; }
  }
  function favoriteColors(profile) {
    var out = [];
    aboutOf(profile).forEach(function (c) {
      if (c.key !== 'colors') return;
      (c.items || []).forEach(function (it) {
        var t = String(it || '').trim().toLowerCase().replace(/\s+/g, '');
        if (t && out.length < 2 && window.CSS && CSS.supports('color', t) && t !== 'inherit' && t !== 'initial' && t !== 'unset' && t !== 'currentcolor') out.push(t);
      });
    });
    return out;
  }
  function paintInitialAvatar(el, profile) {
    var cols = profile ? favoriteColors(profile) : [];
    if (!cols.length) return;   // theme gradient from the stylesheet
    var a = cols[0], b = cols[1] || 'color-mix(in srgb, ' + a + ' 65%, #000)';
    el.style.background = 'linear-gradient(135deg, ' + a + ', ' + b + ')';
    var rgb = rgbOf(a), lum = rgb ? (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) : 0;
    el.style.color = lum > 170 ? '#2a1a3a' : '#fff';
  }
  function avatarEl(profile, extraClass) {
    var role = profile && S.ringRole ? S.ringRole.get(profile.userId) : '';   // 'grand' or 'married' (from the family tree); everyone else keeps the rainbow
    var mine = profile ? ringColorsOf(profile) : [], custom = mine.length >= 2 ? ringClassFor(mine) : '';
    var noPic = !(profile && profile.avatarFileId);
    // Until a picture is showing (still loading, or it could not be loaded) the avatar always shows the first letter in the script font.
    var el = h('div', { class: 'avatar ' + (extraClass || '') + (custom ? ' ' + custom : (role ? ' ring-' + role : '')) + ' initial', 'aria-hidden': 'true' }, firstLetter(profile ? profile.displayName : '?'));
    paintInitialAvatar(el, profile);
    if (profile && profile.avatarFileId) {
      avatarUrl(profile.avatarFileId).then(function (u) { clear(el); el.classList.remove('initial'); el.appendChild(h('img', { src: u, alt: '' })); }).catch(function () { /* keep the letter */ });
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
    S.profile = m.get(S.user.$id) || null; applyRingTheme();
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
    try {
      var tr = await loadTree(false);   // the tree decides ring colors
      // If someone invited me and made a tree entry for me, it becomes mine now that I have joined.
      if (tr.people.some(function (x) { return x.inviteMembershipId && !x.userId; })) {
        var cl = await api('claimInvite', { familyId: id, me: (S.user.prefs && S.user.prefs.aboutMe) || undefined });
        if (cl && cl.claimed) await loadTree(true);
      }
    } catch (e) { S.ringRole = S.ringRole || new Map(); }
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
    if (S.main) { clear(S.main); S.main.appendChild(h('div', { class: 'empty' }, spinnerLine('Opening family…', 'site'))); }
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
    document.title = ((window.FC_UNREAD > 0) ? '(' + (window.FC_UNREAD > 99 ? '99+' : window.FC_UNREAD) + ') ' : '') + title + ' · ' + (CFG.appName || 'Family Circle');
    return body;
  }

  function emailOk(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  function render() {
    revokeBlobs(); applyRingTheme();
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

  var retryTimer = null;
  function renderConnectionProblem() {
    clearTimeout(retryTimer);
    var card = authCard('Maintenance', 'Family Circle can\u2019t reach its server right now. It may be getting an update. This page tries again by itself every 15 seconds.');
    card.appendChild(h('div', { class: 'ld' }, loaderArt('site'), h('span', { class: 'sr-only', text: 'Trying again' })));
    card.appendChild(h('p', { class: 'small muted', text: friendly(S.memberError) }));
    card.appendChild(h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Try again now', onclick: function (ev) { busy(ev.currentTarget, async function () { await loadSession(); render(); }); } }),
      h('button', { class: 'btn secondary', type: 'button', text: 'Sign out', onclick: signOut })));
    retryTimer = setTimeout(async function () { if (!S.memberError) return; await loadSession(); render(); }, 15000);
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
    await mediaCacheClear();     // photos and videos kept on this device are removed when you sign out
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
    { id: 'shorts', label: 'Shorts', icon: 'shorts' },
    { id: 'create', label: 'Create', icon: 'plus' },
    { id: 'tree', label: 'Family Tree', icon: 'tree' },
    { id: 'saved', label: 'Saved', icon: 'bookmark' },
    { id: 'profile', label: 'Profile', icon: 'user' }
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

  function shopEnabled() { return !!(window.FCShop && CFG.shopFunctionId && CFG.shopEnabled !== false); }
  function renderShell() {
    S.main = h('main', { id: 'main', class: 'main', tabindex: '-1' });
    var chatOn = !!(window.FCChat && CFG.chatEnabled !== false);
    var nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, h('ul', null, NAV.map(function (n) {
      if (n.id === 'create' && chatOn) return h('li', { class: 'nav-create' }, window.FCChat.navItem());   // the center item of the same five: its small handle opens the quick-actions panel
      var li = h('li', n.id === 'saved' ? { class: 'nav-saved' } : null, h('a', { href: n.href || '#/' + n.id, 'data-route': n.id }, icon(n.icon), h('span', { text: n.label })));
      return li;
    })));
    if (chatOn) window.FCChat.mountPanel();
    var top = h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' },
      h('a', { class: 'brand', href: '#/home', 'aria-label': (CFG.appName || 'Family Circle') + ', go to Home', onclick: function () { if (/^#\/home\/?$/.test(location.hash)) window.scrollTo({ top: 0, behavior: 'smooth' }); } }, h('img', { src: 'favicon.svg', alt: '' }), h('span', { text: CFG.appName || 'Family Circle' })),
      shopEnabled() ? h('a', { class: 'bell shop-btn', id: 'shop-btn', href: '#/shop', 'aria-label': 'Shop for photo gifts', title: 'Shop' }, icon('bag'), h('span', { class: 'shop-btn-label', text: 'Shop' })) : null,
      h('a', { class: 'bell', id: 'bell', href: '#/activity', 'aria-label': 'Activity', onclick: function (ev) {
        if (/^#\/activity/.test(location.hash)) { ev.preventDefault(); location.hash = S.beforeActivity || '#/home'; }
      } }, icon('bell'), h('span', { class: 'bell-badge', id: 'bell-badge', hidden: true, text: '0' })),
      h('a', { class: 'bell theme-btn', id: 'theme-btn', href: '#/settings/appearance', 'aria-label': 'Change theme: light or dark, style and color', title: 'Theme' }, icon('palette')),
      h('a', { class: 'bell saved-btn', id: 'saved-btn', href: '#/saved', 'aria-label': 'Saved posts', title: 'Saved' }, icon('bookmark'))));
    clear(root).appendChild(h('div', { class: 'shell' }, nav, h('div', { class: 'shell-body' }, top, S.main)));
    var n = takeNotice(); if (n) toast(n.textContent);
  }

  var REVALIDATE_MS = 5 * 60 * 1000;

  function route(first) {
    if (!S.main || !S.user || !S.familyId || !S.profile) return;
    // Before showing family content again after a while, ask the server whether I am still a member.
    if (Date.now() - S.validatedAt > REVALIDATE_MS) {
      var tok = ++S.nav;
      clear(S.main); S.main.appendChild(h('div', { class: 'empty' }, spinnerLine('Checking your access…', 'site')));
      revalidate().then(function (ok) {
        if (tok !== S.nav) return;
        if (!ok) return render();
        route(first);
      }).catch(function (e) {
        if (tok === S.nav) clear(S.main).appendChild(alertBox('error', friendly(e)));
      });
      return;
    }
    var segs = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0].split('/');
    var name = segs[0], param = segs[1] || '', param2 = segs[2] || '', param3 = segs[3] || '';
    if (!VIEWS[name]) name = 'home';
    S.nav++;
    var token = S.nav;
    revokeBlobs();
    clear(S.main);
    S.main.classList.toggle('reels-main', name === 'shorts');
    S.main.setAttribute('data-view', name || '');
    document.body.classList.remove('sheet-open', 'chat-mode');
    if (window.FCChat && name !== 'chat' && name !== 'dms') window.FCChat.stop();   // leaving chat closes its realtime connection
    var navName = name === 'settings' ? 'profile' : (name === 'chat' || name === 'dms') ? 'create' : name;
    var savedBtn = document.getElementById('saved-btn');
    if (savedBtn) { if (name === 'saved') savedBtn.setAttribute('aria-current', 'page'); else savedBtn.removeAttribute('aria-current'); }
    Array.prototype.forEach.call(document.querySelectorAll('.nav [data-route]'), function (a) {
      if (a.getAttribute('data-route') === navName) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var meta = NAV.filter(function (n) { return n.id === name; })[0];
    document.title = ((window.FC_UNREAD > 0) ? '(' + (window.FC_UNREAD > 99 ? '99+' : window.FC_UNREAD) + ') ' : '') + (meta ? meta.label : ({ activity: 'Activity', post: 'Post', settings: 'Settings', chat: 'Family chat', dms: 'Direct messages' }[name] || 'New family')) + ' · ' + (CFG.appName || 'Family Circle');
    Promise.resolve().then(function () { return VIEWS[name](S.main, token, param, param2, param3); }).catch(function (e) {
      if (token === S.nav) clear(S.main).appendChild(alertBox('error', friendly(e)));
    });
    if (!first) { S.main.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    if (name !== 'activity') S.beforeActivity = location.hash || '#/home';
    var hNow = location.hash || '#/home';   // remember the page I came from, so "back" on a settings page returns there
    if (hNow !== S.curHash) { S.prevHash = S.curHash || ''; S.curHash = hNow; }
    refreshBadge(false);
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
    var origIds = [];
    posts.forEach(function (p) { if (p.kind === 'repost' && p.repostOfId && origIds.indexOf(p.repostOfId) === -1) origIds.push(p.repostOfId); });
    var origs = [];
    if (origIds.length) {
      try { origs = (await listRows('posts', [Query.equal('$id', origIds), Query.limit(origIds.length)])).rows; } catch (e) { origs = []; }
      origs = origs.filter(function (o) { return o.familyId === S.familyId; });
    }
    S.origs = S.origs || new Map();
    origIds.forEach(function (id) { S.origs.set(id, null); });
    origs.forEach(function (o) { S.origs.set(o.$id, o); });
    await Promise.all([
      ensureProfiles(posts.map(function (p) { return p.authorId; }).concat(origs.map(function (o) { return o.authorId; }))),
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
    if (kind) q.push(Query.equal('kind', Array.isArray(kind) ? kind : [kind]));
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
        page.posts.forEach(function (p) {
          if (opts.textRows && !p.mediaFileId) {
            // Text posts gather into a sideways-scrolling row (10 per row, then a new row), sitting between the photo and video posts.
            var last = list.lastElementChild;
            if (!(last && last.classList.contains('text-row') && last.__n < (L.textRowMax || 10))) {
              var track = h('div', { class: 'text-track' });
              last = h('section', { class: 'text-row', 'aria-label': 'Text posts. Scroll sideways to see more.', tabindex: '0' }, track);
              last.__n = 0; last.__track = track; list.appendChild(last);
            }
            last.__track.appendChild(postCard(p, meta[p.$id], 'tile', opts)); last.__n++;
          } else list.appendChild(postCard(p, meta[p.$id], opts.variant, opts));
        });
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


  /* =====================================================================
   * TRENDING + ACTIVITY (notifications are worked out from existing rows; nothing extra is stored
   * except the time I last opened Activity, kept in my account prefs as notifSeen)
   * ===================================================================== */

  async function memberCount() {
    var c = S.memberCache;
    if (c && c.fid === S.familyId && Date.now() - c.at < 5 * 60 * 1000) return c.n;
    var res = await teams.listMemberships({ teamId: S.familyId, queries: [Query.limit(100)] });
    var n = res.memberships.filter(function (m) { return m.confirm; }).length;
    S.memberCache = { fid: S.familyId, at: Date.now(), n: n };
    return n;
  }

  // A post is trending when enough OTHER family members liked it: half of the others (at least 2, or everyone if the family is tiny).
  async function getTrending(force) {
    var c = S.trend;
    if (!force && c && c.fid === S.familyId && Date.now() - c.at < 60000) return c;
    var out = { fid: S.familyId, at: Date.now(), items: [], ids: new Set() };
    try {
      var others = Math.max(0, (await memberCount()) - 1);
      if (others >= 1) {
        var need = Math.min(others, Math.max(L.trendingMin || 2, Math.ceil(others * (L.trendingShare || 0.5))));
        var since = Date.now() - (L.trendingDays || 14) * 86400000;
        var rows = await listAllRows('reactions', [Query.equal('familyId', [S.familyId]), Query.orderDesc('$createdAt')], 300);
        var per = {};
        rows.forEach(function (r) { if (new Date(r.$createdAt).getTime() >= since) (per[r.postId] = per[r.postId] || []).push(r); });
        var cand = Object.keys(per).filter(function (id) { return per[id].length >= need; }).slice(0, 100);
        if (cand.length) {
          var posts = (await listRows('posts', [Query.equal('$id', cand), Query.limit(100)])).rows;
          await ensureProfiles(posts.map(function (p) { return p.authorId; }));
          posts.forEach(function (p) {
            if (p.familyId !== S.familyId) return;
            var likes = (per[p.$id] || []).filter(function (r) { return r.userId !== p.authorId; })
              .sort(function (a, b) { return new Date(a.$createdAt) - new Date(b.$createdAt); });
            if (likes.length < need) return;
            out.items.push({ post: p, count: likes.length, at: likes[need - 1].$createdAt });
            out.ids.add(p.$id);
          });
          out.items.sort(function (a, b) { return b.count - a.count || new Date(b.at) - new Date(a.at); });
        }
      }
    } catch (e) { /* trending is a bonus; never block the feed */ }
    S.trend = out;
    return out;
  }

  function trendingStrip(t) {
    if (!t.items.length) return null;
    return h('section', { class: 'trending', 'aria-label': 'Trending in the family' },
      h('h2', { class: 'trend-title' }, icon('flame'), ' Trending in the family'),
      h('div', { class: 'trend-row' }, t.items.slice(0, 5).map(function (it) {
        var p = S.profiles.get(it.post.authorId);
        var snippet = it.post.body ? String(it.post.body).slice(0, 70) : ({ photo: 'A photo', video: 'A video', short: 'A Short' }[it.post.kind] || 'A post');
        return h('a', { class: 'trend-card', href: '#/post/' + it.post.$id },
          h('strong', { text: p ? p.displayName : 'Family member' }),
          h('span', { class: 'trend-snip', text: snippet }),
          h('span', { class: 'small muted', text: it.count + ' family members liked this' }));
      })));
  }

  async function getActivity() {
    var me = S.user.$id, items = [];
    var posts = (await listRows('posts', [Query.equal('familyId', [S.familyId]), Query.equal('authorId', [me]), Query.orderDesc('$createdAt'), Query.limit(40)])).rows;
    var mine = {}; posts.forEach(function (p) { mine[p.$id] = p; });
    var ids = posts.map(function (p) { return p.$id; });
    var results = await Promise.all([
      ids.length ? listRows('reactions', [Query.equal('postId', ids), Query.orderDesc('$createdAt'), Query.limit(100)]) : { rows: [] },
      ids.length ? listRows('comments', [Query.equal('postId', ids), Query.orderDesc('$createdAt'), Query.limit(100)]) : { rows: [] },
      listRows('comments', [Query.equal('familyId', [S.familyId]), Query.equal('authorId', [me]), Query.orderDesc('$updatedAt'), Query.limit(40)]),
      getTrending(false)
    ]);
    var reacts = results[0].rows, coms = results[1].rows, myComs = results[2].rows, trend = results[3];
    var who = [];
    reacts.forEach(function (r) { who.push(r.userId); });
    coms.forEach(function (c) { who.push(c.authorId); });
    myComs.forEach(function (c) { (c.likedBy || []).forEach(function (u) { who.push(u); }); });
    await ensureProfiles(who);
    function nm(id) { var p = S.profiles.get(id); return p ? p.displayName : 'A family member'; }
    reacts.forEach(function (r) { if (r.userId !== me) items.push({ type: 'like', postId: r.postId, at: r.$createdAt, text: nm(r.userId) + ' liked your post' }); });
    coms.forEach(function (c) { if (c.authorId !== me) items.push({ type: 'comment', postId: c.postId, at: c.$createdAt, text: nm(c.authorId) + ' commented: ' + String(c.body).slice(0, 80) }); });
    myComs.forEach(function (c) {
      var others = (c.likedBy || []).filter(function (u) { return u !== me; });
      if (others.length) items.push({ type: 'clike', postId: c.postId, at: c.$updatedAt, text: (others.length === 1 ? nm(others[0]) : nm(others[0]) + ' and ' + (others.length - 1) + ' more') + ' liked your comment' });
    });
    trend.items.forEach(function (it) { if (mine[it.post.$id]) items.push({ type: 'trend', postId: it.post.$id, at: it.at, text: 'Your post is trending in the family' }); });
    // New members: someone accepted their invitation and joined this family in the last 30 days.
    try {
      var ms = (await teams.listMemberships({ teamId: S.familyId, queries: [Query.limit(100)] })).memberships;
      var mine0 = ms.filter(function (m) { return m.userId === me && m.joined; })[0];
      var cutoff = Math.max(Date.now() - 30 * 86400000, mine0 ? new Date(mine0.joined).getTime() : 0);   // only people who joined after I did
      var joined = ms.filter(function (m) { return m.confirm && m.userId !== me && m.joined && new Date(m.joined).getTime() > cutoff; });
      await ensureProfiles(joined.map(function (m) { return m.userId; }));
      joined.forEach(function (m) {
        var pr = S.profiles.get(m.userId), name = (pr && pr.displayName) || m.userName || 'A new family member';
        items.push({ type: 'join', href: '#/profile/' + m.userId, at: m.joined, text: name + ' accepted the invitation and joined ' + famName() });
      });
    } catch (e) { /* the list of people is not available right now; the other entries still show */ }
    items.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });
    return items.slice(0, 60);
  }

  function setBadge(n) {
    var b = document.getElementById('bell-badge'); if (!b) return;
    b.textContent = n > 9 ? '9+' : String(n); b.hidden = !n;
    var bell = document.getElementById('bell');
    if (bell) bell.setAttribute('aria-label', n ? 'Activity, ' + n + ' new' : 'Activity');
  }
  function seenAt() { var v = S.user && S.user.prefs && S.user.prefs.notifSeen; return v ? new Date(v).getTime() : 0; }
  async function refreshBadge(force) {
    if (!S.user || !S.familyId) return;
    if (!force && S.badgeAt && Date.now() - S.badgeAt < 60000) return;
    S.badgeAt = Date.now();
    try {
      var items = await getActivity(), seen = seenAt();
      setBadge(items.filter(function (i) { return new Date(i.at).getTime() > seen; }).length);
    } catch (e) { /* quiet */ }
  }

  VIEWS.activity = async function (main, token) {
    main.appendChild(h('h1', { text: 'Activity' }));
    main.appendChild(h('p', { class: 'muted small', text: 'Likes and comments on your posts, likes on your comments, when a post of yours is trending, and when someone new joins the family. These show while the app is open; the app cannot send alerts when it is closed.' }));
    var box = h('div', { class: 'activity' }, spinnerLine('Loading…'));
    main.appendChild(box);
    var items = await getActivity();
    if (token !== S.nav) return;
    var seen = seenAt();
    clear(box);
    if (!items.length) box.appendChild(h('div', { class: 'empty' }, h('p', { text: 'Nothing yet. When someone likes or comments on your post, or a new person joins the family, it shows up here.' })));
    items.forEach(function (it) {
      var fresh = new Date(it.at).getTime() > seen;
      box.appendChild(h('a', { class: 'act-item' + (fresh ? ' fresh' : ''), href: it.href || ('#/post/' + it.postId) },
        h('span', { class: 'act-ico' }, icon(it.type === 'comment' ? 'comment' : it.type === 'trend' ? 'flame' : it.type === 'join' ? 'users' : 'heart')),
        h('span', { class: 'act-text', text: it.text }),
        h('span', { class: 'small muted', text: timeAgo(it.at) })));
    });
    var demo = h('div'), demoBtn = h('button', { class: 'btn secondary small', type: 'button', text: 'See an example of what shows up here' });
    demoBtn.setAttribute('aria-expanded', 'false');
    demoBtn.addEventListener('click', function () {
      if (demoBtn.getAttribute('aria-expanded') === 'true') { clear(demo); demoBtn.setAttribute('aria-expanded', 'false'); demoBtn.textContent = 'See an example of what shows up here'; return; }
      demoBtn.setAttribute('aria-expanded', 'true'); demoBtn.textContent = 'Hide the example';
      var rows = [['heart', 'Grandma Rose liked your post', '2 min ago'], ['comment', 'Uncle Dev commented: Those look delicious!', '10 min ago'], ['heart', 'Uncle Dev and 1 more liked your comment', '1 h ago'], ['flame', 'Your post is trending in the family', '3 h ago']];
      clear(demo);
      demo.appendChild(h('p', { class: 'small muted', text: 'Example only. These are not real. Real ones appear when other family members like or comment.' }));
      rows.forEach(function (r) { demo.appendChild(h('div', { class: 'act-item fresh' }, h('span', { class: 'act-ico' }, icon(r[0])), h('span', { class: 'act-text', text: r[1] }), h('span', { class: 'small muted', text: r[2] }))); });
    });
    main.appendChild(h('div', { class: 'row' }, demoBtn)); main.appendChild(demo);
    var now = new Date().toISOString();
    S.badgeAt = Date.now(); setBadge(0);
    try { S.user = await account.updatePrefs({ prefs: Object.assign({}, S.user.prefs || {}, { notifSeen: now }) }); } catch (e) { /* badge will return; harmless */ }
  };

  VIEWS.post = async function (main, token, id, famParam) {
    // A shared link carries the family id; if I belong to that family, open it there. Otherwise nothing is revealed.
    if (famParam && famParam !== S.familyId && S.families.some(function (f) { return f.id === famParam; })) {
      history.replaceState(null, '', location.pathname + '#/post/' + id + '/' + famParam);
      await switchFamily(famParam);
      location.hash = '#/post/' + id;
      return;
    }
    main.appendChild(h('p', null, h('a', { class: 'link-btn back-btn', href: '#/home', text: 'Back to Home' })));
    var holder = h('div', null, spinnerLine('Loading…'));
    main.appendChild(holder);
    var rows = id ? (await listRows('posts', [Query.equal('$id', [id]), Query.limit(1)])).rows : [];
    if (token !== S.nav) return;
    clear(holder);
    var post = rows[0];
    if (!post || post.familyId !== S.familyId) { holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'That post is not available. It may have been deleted.' }))); return; }
    var meta = await decorate([post]);
    if (token !== S.nav) return;
    holder.appendChild(postCard(post, meta[post.$id], null, { inlineComments: true }));
  };

  VIEWS.home = async function (main, token) {
    main.appendChild(h('h1', { class: 'family-title', text: famName() }));
    var people = Array.from(S.profiles.values());
    var trend = await getTrending(false);
    if (token !== S.nav) return;
    if (people.length) {
      main.appendChild(h('div', { class: 'stories', role: 'list', 'aria-label': 'Family members' }, people.map(function (p) {
        var first = String(p.displayName || '').split(' ')[0];
        return h('a', { class: 'story', role: 'listitem', href: '#/profile/' + p.userId, 'aria-label': 'Open ' + (p.userId === S.user.$id ? 'your' : first + '\u2019s') + ' profile' }, h('div', { class: 'ring' }, avatarEl(p, 'lg')), h('span', { text: p.userId === S.user.$id ? 'You' : first }));
      })));
    }
    append(main, trendingStrip(trend));
    return pagedFeed(token, main, function (c) { return fetchPostsPage(null, c); }, {
      textRows: true,
      emptyTitle: 'No posts yet.', emptyHint: 'Be the first to share something with the family.',
      emptyAction: h('a', { class: 'btn', href: '#/create', text: 'Create a post' })
    });
  };
  VIEWS.shorts = function (main, token) {
    main.appendChild(h('h1', { class: 'sr-only', text: 'Shorts' }));
    main.appendChild(h('div', { class: 'reels-top' }, h('a', { class: 'reels-back', href: '#/home', 'aria-label': 'Back to Home' }, icon('back')), h('span', { text: 'Shorts' })));
    return pagedFeed(token, main, function (c) { return fetchPostsPage(['short', 'video'], c); }, {
      className: 'shorts', variant: 'short', infinite: true, emptyTitle: 'No videos yet.', emptyHint: 'Post a video or record a short vertical video (up to ' + (L.shortMaxSeconds || 60) + ' seconds) and share it.',
      emptyAction: h('a', { class: 'btn', href: '#/create', text: 'Create a Short' })
    });
  };
  /* ---------- saved links: circles at the top of Saved (kept on my account, so they follow me to every device) ---------- */
  var MAX_LINKS = 30;
  function linkList() { var l = S.user && S.user.prefs && S.user.prefs.links; return Array.isArray(l) ? l.filter(function (x) { return x && typeof x.u === 'string'; }) : []; }
  async function writeLinks(list) {
    if (JSON.stringify(list).length > 58000) throw new Error('That is too many links for your account to remember. Remove one first.');
    S.user = await account.updatePrefs({ prefs: Object.assign({}, S.user.prefs || {}, { links: list }) });
  }
  function normLink(v) {
    v = String(v || '').trim(); if (!v) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
    try { var u = new URL(v); if (u.protocol !== 'https:' && u.protocol !== 'http:') return ''; if (!/\./.test(u.hostname)) return ''; return u.toString(); } catch (e) { return ''; }
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
  function shrinkIcon(uri) {   // a 40 px copy keeps the whole list small enough to sync
    return new Promise(function (resolve) {
      if (!uri) return resolve('');
      var im = new Image();
      im.onload = function () {
        try {
          var cv = document.createElement('canvas'); cv.width = cv.height = 40; var cx = cv.getContext('2d');
          cx.drawImage(im, 0, 0, 40, 40); var out = cv.toDataURL('image/png'); resolve(out.length < 4500 ? out : '');
        } catch (e) { resolve(''); }
      };
      im.onerror = function () { resolve(''); }; im.src = uri;
    });
  }
  // The dialog for adding or editing one link. item is null when adding.
  function linkDialog(item, onDone) {
    var dlg = h('dialog', { 'aria-labelledby': 'ld-title' });
    var url = h('input', { type: 'text', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Link', placeholder: 'Paste a link', autocomplete: 'off', maxlength: 500 });
    var name = h('input', { type: 'text', 'aria-label': 'Name', placeholder: item ? 'Name' : 'Name (filled in for you)', maxlength: 40 });
    url.value = item ? item.u : ''; name.value = item ? item.t : '';
    var msg = h('div'), ok = h('button', { class: 'btn', type: 'submit', text: item ? 'Save' : 'Save link' }), cancel = h('button', { class: 'btn secondary', type: 'button', text: 'Cancel' });
    function close() { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }
    cancel.addEventListener('click', close);
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    var del = item ? h('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: function () {
      busy(del, async function () { try { await writeLinks(linkList().filter(function (x) { return x.id !== item.id; })); close(); onDone(); } catch (e) { showAlert(msg, 'error', errText(e)); } });
    } }) : null;
    dlg.appendChild(h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var u = normLink(url.value); if (!u) return showAlert(msg, 'error', 'Please paste a full link, like https://example.com');
      busy(ok, async function () {
        try {
          var list = linkList(), t = name.value.trim(), ic = item ? item.i : '';
          if (!item && list.length >= MAX_LINKS) throw new Error('You can keep up to ' + MAX_LINKS + ' links. Remove one first.');
          if (!item || u !== item.u) {   // a new address: look up its title and icon
            var info = null; try { info = await api('linkInfo', { familyId: S.familyId, url: u }); } catch (e) { info = null; }
            if (info) { if (!t && info.title) t = info.title; ic = await shrinkIcon(info.icon); } else ic = '';
          }
          if (!t) t = hostOf(u);
          t = t.slice(0, 40);
          if (item) list = list.map(function (x) { return x.id === item.id ? { id: x.id, u: u, t: t, i: ic } : x; });
          else list.push({ id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), u: u, t: t, i: ic });
          await writeLinks(list); close(); onDone();
        } catch (e) { showAlert(msg, 'error', errText(e)); }
      }, item ? 'Saving…' : 'Looking it up…');
    } }, h('h2', { id: 'ld-title', text: item ? 'Edit link' : 'Save a link' }),
      h('p', { class: 'hint', text: item ? 'Change the name or the address.' : 'Paste the address. The name and the little icon are filled in for you.' }),
      url, name, msg, h('div', { class: 'row' }, cancel, del, ok)));
    document.body.appendChild(dlg); dlg.showModal(); url.focus();
  }
  function linksRow() {
    var wrap = h('section', { class: 'links-section', 'aria-label': 'Saved links' }), editing = false;
    function paint() {
      clear(wrap);
      var list = linkList();
      wrap.appendChild(h('div', { class: 'links-head' }, h('h2', { text: 'Links' }),
        list.length ? h('button', { class: 'link-btn small', type: 'button', text: editing ? 'Done' : 'Edit', onclick: function () { editing = !editing; paint(); } }) : null));
      var row = h('div', { class: 'link-row' });
      row.appendChild(h('button', { class: 'link-item', type: 'button', 'aria-label': 'Add a link', onclick: function () { linkDialog(null, paint); } },
        h('span', { class: 'link-circle add' }, icon('plus')), h('span', { class: 'link-name', text: 'Add' })));
      list.forEach(function (x) {
        var circle = h('span', { class: 'link-circle' + (editing ? ' editing' : '') }, x.i ? h('img', { src: x.i, alt: '', width: 40, height: 40 }) : h('span', { class: 'link-letter', text: (x.t || hostOf(x.u)).charAt(0).toUpperCase() }));
        if (editing) circle.appendChild(h('span', { class: 'link-pencil', 'aria-hidden': 'true' }, icon('edit')));
        var inner = [circle, h('span', { class: 'link-name', text: x.t || hostOf(x.u) })];
        row.appendChild(editing
          ? h('button', { class: 'link-item', type: 'button', 'aria-label': 'Edit ' + x.t, onclick: function () { linkDialog(x, paint); } }, inner)
          : h('a', { class: 'link-item', href: x.u, target: '_blank', rel: 'noopener noreferrer', 'aria-label': x.t + ', opens in a new tab' }, inner));
      });
      wrap.appendChild(row);
    }
    paint();
    return wrap;
  }

  VIEWS.saved = function (main, token) {
    var sel = S.savedTab || '';
    if (sel && !libs().some(function (l) { return l.id === sel; })) sel = '';
    main.appendChild(h('h1', { text: 'Saved' }));
    main.appendChild(h('p', { class: 'muted small', text: 'Only you can see what you save, and what you name your libraries.' }));
    main.appendChild(linksRow());
    main.appendChild(h('h2', { class: 'links-posts-h', text: 'Saved posts' }));
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
  // Swipe a bottom sheet down to close it (grab the top bar, or pull down while its list is scrolled to the top).
  function sheetDrag(sheet, close) {
    var y0 = null, dy = 0, t0 = 0, mode = null, noDrag = false, moved = false;
    function setY(v) { sheet.style.transform = v ? 'translateY(' + v + 'px)' : ''; if (v && v < 400) fadeBack(Math.max(0.2, 1 - v / 400)); }
    function fadeBack(o) { var bk = sheet.previousElementSibling; if (bk && bk.classList.contains('sheet-backdrop')) { bk.style.transition = 'opacity .2s'; bk.style.opacity = String(o); } }
    function start(y, fromHead, target) { y0 = y; dy = 0; moved = false; noDrag = !fromHead && !!(target && target.closest && target.closest('textarea, input, button, a, .comment-form, .emoji-strip')); t0 = Date.now(); mode = fromHead ? 'head' : 'body'; sheet.style.transition = 'none'; }
    function move(y, ev) {
      if (y0 === null) return;
      var d = y - y0;
      if (noDrag) return;                       // pressed on the comment box, a button or an emoji: that is a tap, never a drag
      if (!moved) { if (Math.abs(d) < 12) return; moved = true; }   // a finger always wobbles a little; only a real pull moves the sheet (and only then is the tap cancelled)
      var sc = sheet.querySelector('.c-scroll'), top = sc ? sc.scrollTop : sheet.scrollTop;
      if (mode === 'body' && (top > 0 || d <= 0)) { if (d <= 0) return; if (top > 0) { y0 = y; return; } }
      dy = Math.max(0, d); setY(dy); if (ev && ev.cancelable) ev.preventDefault();
    }
    function end() {
      if (y0 === null) return; y0 = null;
      var fast = dy / Math.max(1, Date.now() - t0) > 0.6;
      sheet.style.transition = 'transform .2s ease';
      if (moved && (dy > 110 || (fast && dy > 60))) {
        sheet.classList.add('dragged');   // already sliding away under the finger: do not replay the close animation
        setY(sheet.offsetHeight + 40); fadeBack(0); setTimeout(close, 200);
      } else { setY(0); fadeBack(1); }
    }
    var head = sheet.querySelector('.sheet-head');
    sheet.addEventListener('touchstart', function (ev) {
      var t = ev.touches[0]; start(t.clientY, !!(head && head.contains(ev.target)), ev.target);
    }, { passive: true });
    sheet.addEventListener('touchmove', function (ev) { move(ev.touches[0].clientY, ev); }, { passive: false });
    sheet.addEventListener('touchend', end);
    // If the browser takes the gesture over (it starts scrolling the page behind) it cancels the touch: put the sheet back, never close it.
    sheet.addEventListener('touchcancel', function () { if (y0 === null) return; y0 = null; dy = 0; sheet.style.transition = 'transform .2s ease'; setY(0); fadeBack(1); });
    // mouse / pen: drag the top bar
    if (head) {
      head.addEventListener('pointerdown', function (ev) { if (ev.pointerType === 'touch' || ev.target.closest('button')) return; head.setPointerCapture(ev.pointerId); start(ev.clientY, true); });
      head.addEventListener('pointermove', function (ev) { if (ev.pointerType !== 'touch') move(ev.clientY, ev); });
      head.addEventListener('pointerup', function (ev) { if (ev.pointerType !== 'touch') end(); });
    }
  }
  // A quick burst of confetti (after posting). Skipped for people who asked their device for less motion.
  function confetti() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = ['#ff3b6b', '#ff8a1f', '#ffd60a', '#3ddc84', '#22b8ff', '#7c4dff', '#e040fb'];
    var box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (var i = 0; i < 36; i++) {
      var bit = h('i'), a = (Math.random() - 0.5) * Math.PI * 1.1, v = 180 + Math.random() * 260;
      bit.style.background = colors[i % colors.length];
      bit.style.setProperty('--dx', Math.round(Math.sin(a) * v) + 'px');
      bit.style.setProperty('--dy', Math.round(-Math.cos(a) * v * 0.9) + 'px');
      bit.style.setProperty('--rot', Math.round(Math.random() * 720 - 360) + 'deg');
      bit.style.animationDelay = Math.round(Math.random() * 120) + 'ms';
      box.appendChild(bit);
    }
    document.body.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 1900);
  }
  // The big heart that pops up where you double-tapped.
  function heartBurst(box, x, y) {
    var b = h('div', { class: 'heart-burst', 'aria-hidden': 'true' }, icon('heart'));
    b.style.left = x + 'px'; b.style.top = y + 'px';
    box.appendChild(b); setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 850);
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


  /* ---------- REPOST + SHARE ---------- */
  function longDate(iso) { return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); }

  // The box inside a repost: the original post, with its own date.
  function originalBox(post) {
    var o = S.origs && S.origs.get(post.repostOfId);
    var box = h('div', { class: 'orig-box' });
    if (!o) { box.appendChild(h('p', { class: 'muted', text: 'The original post was removed.' })); return box; }
    var pr = S.profiles.get(o.authorId) || null, nm = pr ? pr.displayName : 'Family member';
    box.appendChild(h('div', { class: 'orig-head' }, avatarEl(pr), h('div', { class: 'who' },
      h('a', { class: 'member-link', href: '#/profile/' + o.authorId, text: nm }),
      h('div', { class: 'small muted' }, 'Originally posted ', h('time', { datetime: o.$createdAt, text: longDate(o.$createdAt) }), (Date.now() - new Date(o.$createdAt).getTime() < 7 * 86400000) ? ' · ' + timeAgo(o.$createdAt) : ''))));
    if (o.body) box.appendChild(h('p', { class: 'post-body', text: o.body }));
    if (o.mediaFileId) {
      if (o.kind === 'photo') box.appendChild(imageBlock(o));
      else if (o.kind === 'video' || o.kind === 'short') box.appendChild(videoBlock(o, false));
    }
    box.appendChild(h('a', { class: 'link-btn', href: '#/post/' + o.$id, text: 'Open the original post' }));
    return box;
  }

  function repostDialog(post) {
    var base = (post.kind === 'repost' && post.repostOfId && S.origs && S.origs.get(post.repostOfId)) || post;
    textDialog('Remind the family of this day', 'Remember this day?', 'Repost', { multiline: true, max: 500, aria: 'Your note on the repost',
      hint: 'The repost shows the original date (' + longDate(base.$createdAt) + ') and today’s date. Only members of ' + famName() + ' can see it.' },
      async function (v) {
        await api('repostPost', { familyId: S.familyId, postId: post.$id, body: v });
        S.feedDirty = true; toast('Reposted to ' + famName() + '.');
        if (location.hash === '#/home' || location.hash === '' || location.hash === '#/') route();
      });
  }

  function shareLink(post) { return baseUrl() + '#/post/' + post.$id + '/' + S.familyId; }

  function shareDialog(post) {
    var link = shareLink(post);
    var dlg = h('dialog', { class: 'sheet-dialog', 'aria-labelledby': 'dlg-title' });
    function close() { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    var field = h('input', { type: 'text', readonly: true, 'aria-label': 'Link to this post', value: link });
    var msg = h('div');
    var canShare = typeof navigator.share === 'function';
    dlg.appendChild(h('h2', { id: 'dlg-title', text: 'Share with family only' }));
    dlg.appendChild(h('p', { class: 'hint', text: 'This link holds no photo, video or text. It opens only for people who are signed in and are members of ' + famName() + '. Anyone else sees “That post is not available.”' }));
    dlg.appendChild(field); dlg.appendChild(msg);
    dlg.appendChild(h('div', { class: 'stack' },
      h('button', { class: 'btn block', type: 'button', text: 'Copy link', onclick: async function () {
        try { await navigator.clipboard.writeText(link); showAlert(msg, 'ok', 'Link copied.'); }
        catch (e) { field.focus(); field.select(); showAlert(msg, 'ok', 'Select the link above and copy it.'); }
      } }),
      canShare ? h('button', { class: 'btn secondary block', type: 'button', text: 'Send with…', onclick: function () {
        navigator.share({ title: famName(), text: 'A post from ' + famName() + ' (family members only)', url: link }).catch(function () {});
      } }) : null,
      h('button', { class: 'btn ghost block', type: 'button', text: 'Close', onclick: close })));
    document.body.appendChild(dlg); dlg.showModal();
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
    var isTile = variant === 'tile';
    var card = h('article', { class: isReel ? 'reel short' : (isTile ? 'card tile' : 'card'), 'aria-label': 'Post by ' + name });

    // header
    // "edited" comes from editedAt, which only an edit to the text sets. Until that column exists, fall back to the old guess.
    function isEdited() { return post.editedAt ? true : (post.editedAt === undefined && !post.pinnedCommentIds && new Date(post.$updatedAt) - new Date(post.$createdAt) > 3000); }
    var editedEl = h('span', { class: 'edited', text: ' \u00B7 edited', hidden: !isEdited() });
    function paintEdited() { editedEl.hidden = !isEdited(); }
    var kindLabel = { photo: 'Photo', video: 'Video', short: 'Short', repost: 'Reposted' }[post.kind];
    var wrap = (!isReel && post.mediaFileId) ? h('div', { class: 'media-wrap' }) : null;   // photo/video posts: the name sits on top of the picture, like Instagram
    var headEl = h('div', { class: 'post-head' + (wrap ? ' overlay' : '') }, avatarEl(prof),
      h('div', { class: 'who' }, h('div', { class: 'name' }, h('a', { class: 'member-link', href: '#/profile/' + post.authorId, text: name })),
        h('div', { class: 'small muted' }, post.kind === 'repost' ? 'Reposted ' : null, h('time', { datetime: post.$createdAt, title: new Date(post.$createdAt).toLocaleString(), text: timeAgo(post.$createdAt) }), editedEl)),
      S.trend && S.trend.ids.has(post.$id) ? h('span', { class: 'badge hot' }, icon('flame'), ' Trending') : null,
      kindLabel ? h('span', { class: 'badge', text: kindLabel }) : null);
    if (wrap) wrap.appendChild(headEl); else (isReel ? info : card).appendChild(headEl);

    // text (can be swapped for an editor)
    var bodyHolder = h('div');
    function showBody() { clear(bodyHolder); if (post.body) bodyHolder.appendChild(h('p', { class: 'post-body' }, (isReel || isTile) ? null : h('strong', { class: 'cap-name', text: name }), (isReel || isTile) ? '' : ' ', post.body)); if (isTile && post.body && post.body.length > 200) bodyHolder.appendChild(h('a', { class: 'tile-more', href: '#/post/' + post.$id, text: 'more' })); }
    showBody();
    if (isReel) info.appendChild(bodyHolder);
    else if (!post.mediaFileId) card.appendChild(bodyHolder);   // text-only posts: text first; media posts: caption goes under the buttons
    if (post.kind === 'repost') card.appendChild(originalBox(post));

    // media
    if (post.mediaFileId) {
      var tgt = wrap || card;
      if (post.kind === 'photo') tgt.appendChild(imageBlock(post));
      else if (post.kind === 'video' || post.kind === 'short') tgt.appendChild(videoBlock(post, post.kind === 'short' || isReel));
      if (wrap) card.appendChild(wrap);
    }
    // double tap the picture or the Short to like it (it only ever adds a like, like Instagram)
    function doubleTapLike(x, y, box) { heartBurst(box, x, y); if (!st.liked) toggleLike(); }
    (function () {
      var mb = card.querySelector('.media'); if (!mb) return;
      if (post.kind === 'short' || isReel) mb.__dbl = function (x, y) { doubleTapLike(x, y, mb); };
      else if (post.kind === 'photo') {
        var last = 0;
        mb.addEventListener('click', function (ev) {
          var now = Date.now(); if (now - last < 300) { last = 0; var r = mb.getBoundingClientRect(); doubleTapLike(ev.clientX - r.left, ev.clientY - r.top, mb); } else last = now;
        });
      }
    })();

    // actions
    var like = actionBtn('heart', 'Like', function () { toggleLike(); });
    var cmt = actionBtn('comment', 'Comments', function () { toggleComments(); });
    var rep = actionBtn('repost', 'Repost: remember this day?', function () { repostDialog(post); });
    var shr = actionBtn('send', 'Share link, family only', function () { shareDialog(post); });
    rep.setCount(null, 'Repost: remind the family of this day'); shr.setCount(null, 'Share link, family members only');
    var save = actionBtn('bookmark', 'Save', function () { toggleSave(); });
    save.className = 'act save';
    function paintLike() { like.setCount(st.likes, (st.liked ? 'Remove your like. ' : 'Like. ') + st.likes + ' likes', !!st.liked); }
    function paintCmt() { cmt.setCount(st.comments, 'Comments. ' + st.comments + ' so far', undefined); cmt.setAttribute('aria-expanded', commentsEl ? 'true' : 'false'); }
    function paintSave() { save.setCount(null, S.saved.has(post.$id) ? 'Saved in ' + libName(libOf(post.$id)) + '. Change library or remove' : 'Save for later', S.saved.has(post.$id)); }
    var actions = h('div', { class: 'actions' }, like, cmt, rep, shr, save);
    async function downloadMedia() {
      try {
        toast('Getting your file…');
        var blob = await fetchMedia(post.mediaFileId, true);
        var mime = post.mediaMime || blob.type || (post.kind === 'photo' ? 'image/jpeg' : 'video/mp4');
        var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[mime] || 'bin';
        var u = URL.createObjectURL(new Blob([blob], { type: mime }));
        var a = h('a', { href: u, download: 'family-circle-' + String(post.$createdAt || '').slice(0, 10) + '.' + ext });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      } catch (e) { toast(friendly(e)); }
    }
    async function saveCaptions(cues, doneText) {
      try {
        var r = await api('setCaptions', { familyId: S.familyId, postId: post.$id, captions: cues });
        post.captions = r.captions || '';
        if (post.__cc) applyCaptions(post.__cc.v, post.__cc.box, post);
        toast(doneText + (post.captions && !post.__cc ? ' They show the next time the video loads.' : ''));
      } catch (e) { toast(friendly(e)); }
    }
    async function addCaptionsToPost() {
      try { toast('Getting the video…'); var blob = await fetchMedia(post.mediaFileId, true); }
      catch (e) { return toast(friendly(e)); }
      var cues = await makeCaptionCues(blob);
      if (cues) await saveCaptions(cues, 'Captions saved.');
    }
    function openMore() {
      var dlg = h('dialog', { class: 'sheet-dialog', 'aria-label': 'More options' }, h('div', { class: 'stack' },
        post.mediaFileId ? h('button', { class: 'btn secondary block', type: 'button', text: post.kind === 'photo' ? 'Download photo' : 'Download video', onclick: function () { dlg.close(); downloadMedia(); } }) : null,
        isMine ? h('button', { class: 'btn secondary block', type: 'button', text: 'Edit caption', onclick: function () { dlg.close(); startEdit(); } }) : null,
        (post.kind === 'photo' && post.mediaFileId && shopEnabled()) ? h('button', { class: 'btn secondary block', type: 'button', text: 'Make a gift', onclick: function () { dlg.close(); location.hash = '#/shop/gift/' + post.$id; } }) : null,
        (isMine && post.kind === 'photo' && shopEnabled()) ? h('button', { class: 'btn secondary block', type: 'button', text: 'Allow gifts with this photo…', onclick: function () { dlg.close(); window.FCShop.giftSettingDialog(post); } }) : null,
        (isMine && (post.kind === 'video' || post.kind === 'short')) ? h('button', { class: 'btn secondary block', type: 'button', text: post.captions ? 'Make the captions again' : 'Add automatic captions', onclick: function () { dlg.close(); addCaptionsToPost(); } }) : null,
        (isMine && post.captions) ? h('button', { class: 'btn secondary block', type: 'button', text: 'Remove captions', onclick: function () { dlg.close(); saveCaptions([], 'Captions removed.'); } }) : null,
        (isMine || S.isOwner) ? h('button', { class: 'btn secondary block danger-text', type: 'button', text: isMine ? 'Delete' : 'Remove as family admin', onclick: function () { dlg.close(); removePost(); } }) : null,
        h('button', { class: 'btn ghost block', type: 'button', text: 'Cancel', onclick: function () { dlg.close(); } })));
      dlg.addEventListener('close', function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); });
      document.body.appendChild(dlg); dlg.showModal();
    }
    {
      var moreBtn = h('button', { class: isReel ? 'act' : 'more-btn', type: 'button', 'aria-label': 'More options for this post', onclick: openMore }, icon('more'));
      if (isReel) actions.appendChild(moreBtn); else headEl.appendChild(moreBtn);
    }
    card.appendChild(actions);
    if (isReel) {
      info.appendChild(h('button', { class: 'reel-comment', type: 'button', text: 'Add comment…', onclick: function () { toggleComments(); } }));
      // When the Short starts over, a top comment slides up just above the poster's picture (only if there is one).
      // It grows from zero height, so the captions above it are pushed up smoothly instead of jumping.
      var popBtn = h('button', { class: 'reel-pop-btn', type: 'button', 'aria-label': 'Open comments', onclick: function () { toggleComments(); } });
      var pop = h('div', { class: 'reel-pop', 'aria-hidden': 'true' }, h('div', null, popBtn));
      pop.inert = true;
      info.insertBefore(pop, headEl);
      var popWant = false, popRow = null, popCount = -1, popBusy = false;
      function hidePop() { popWant = false; pop.classList.remove('on'); pop.inert = true; pop.setAttribute('aria-hidden', 'true'); }
      async function showPop() {
        popWant = true;
        if (pop.classList.contains('on') || popBusy || !st.comments) return;
        if (popCount !== st.comments) {
          popBusy = true;
          try {
            var r = await listRows('comments', [Query.equal('postId', [post.$id]), Query.orderDesc('$createdAt'), Query.limit(25)]);
            var pins = String(post.pinnedCommentIds || '').split(',').filter(Boolean);
            var rows = r.rows || [], isTop = function (x) { return !x.parentId && !/^@/.test(x.body || ''); };
            popRow = rows.filter(function (x) { return pins.indexOf(x.$id) !== -1; })[0] || rows.filter(isTop)[0] || rows[0] || null;
            popCount = st.comments;
          } catch (e) { popRow = null; }
          popBusy = false;
        }
        if (!popWant || !popRow) return;
        var pr = S.profiles.get(popRow.authorId) || null;
        clear(popBtn);
        popBtn.appendChild(avatarEl(pr));
        popBtn.appendChild(h('span', { class: 'pop-txt' }, h('strong', { text: (pr ? pr.displayName : 'Family member') + ' ' }), popRow.body));
        pop.inert = false; pop.removeAttribute('aria-hidden'); pop.classList.add('on');
      }
      card.addEventListener('reelloop', showPop);
      card.addEventListener('reelreset', hidePop);
      card.appendChild(info);
    } else if (post.mediaFileId) { card.appendChild(bodyHolder); card.appendChild(h('div', { class: 'post-date', text: new Date(post.$createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) })); }
    var commentsEl = null, focusAt = 0;   // focusAt: when the comment box last got focus (see toggleComments)
    paintLike(); paintCmt(); paintSave();
    // On a post's own page the comments are already open right underneath it, so there is no comment button.
    if (hooks.inlineComments) {
      if (cmt.parentNode) cmt.parentNode.removeChild(cmt);
      commentsEl = commentsPanel(post, st, paintCmt); commentsEl.classList.add('inline-comments');
      card.appendChild(commentsEl);
    }

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

    var backEl = null, closingSheet = false;
    function toggleComments(why) {
      if (isTile) { location.hash = '#/post/' + post.$id; return; }
      if (commentsEl) {
        if (closingSheet) return;
        if (Date.now() - focusAt < 900) return;   // the phone keyboard shifts the layout and can re-deliver the tap on the comment box to whatever is now under it (the Comments button, the dimmed area); that must not close the sheet
        closingSheet = true;
        var sh = commentsEl, bk = backEl;
        if (!sh.classList.contains('dragged')) { sh.classList.add('closing'); if (bk) bk.classList.add('closing'); }   // slide back down, then remove
        var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        setTimeout(function () {
          if (sh.parentNode) sh.parentNode.removeChild(sh); if (bk && bk.parentNode) bk.parentNode.removeChild(bk);
          if (commentsEl === sh) { commentsEl = null; backEl = null; }
          closingSheet = false; document.body.classList.remove('sheet-open'); paintCmt();
        }, reduce ? 0 : 230);
        return;
      }
      document.body.classList.add('sheet-open');
      // Comments open as a sheet from the bottom on every kind of post, like Instagram: dimmed page behind, list in the middle, emoji row and box at the bottom.
      var panel = commentsPanel(post, st, paintCmt);
      commentsEl = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Comments' },
        h('div', { class: 'sheet-head' }, h('strong', { text: 'Comments' }), h('button', { class: 'btn secondary small', type: 'button', text: 'Close', onclick: function () { focusAt = 0; toggleComments('the Close button'); } })), panel);
      // The backdrop closes the sheet only for a real tap that STARTED on it. When the phone keyboard opens the layout shifts and the browser can
      // deliver the tap on the text box again at the old spot, which now lands on the backdrop; without a matching press there, that is ignored.
      var pressedBack = 0;
      backEl = h('div', { class: 'sheet-backdrop', onpointerdown: function () { pressedBack = Date.now(); }, onclick: function () { var ok = pressedBack && Date.now() - pressedBack < 1500; pressedBack = 0; if (ok) toggleComments('tap on the dimmed area behind the sheet'); } });
      commentsEl.addEventListener('focusin', function (ev) { if (ev.target && /^(TEXTAREA|INPUT)$/.test(ev.target.tagName)) focusAt = Date.now(); });   // only the comment box counts, not the Close button
      card.appendChild(backEl); card.appendChild(commentsEl); paintCmt();
      sheetDrag(commentsEl, function () { if (commentsEl) toggleComments('swipe down'); });
      // Keep the whole sheet, including the comment box and the Post button, inside what the phone really shows (browser bars and the keyboard change that).
      (function (sh) {
        var vv = window.visualViewport; if (!vv) return;
        function fit() {
          if (!sh.parentNode) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); return; }
          // Place the sheet by its TOP edge in the page's own coordinates: the bottom of what is really visible (above the keyboard) minus the sheet height.
          var layoutH = document.documentElement.clientHeight || window.innerHeight, keys = vv.height < layoutH * 0.8;
          var hh = keys ? Math.max(200, vv.height - 56) : Math.min(vv.height * 0.76, Math.max(240, vv.height - 80));
          var top = Math.max(0, vv.offsetTop + vv.height - hh);
          sh.style.bottom = 'auto'; sh.style.top = top + 'px'; sh.style.height = hh + 'px'; sh.style.maxHeight = 'none';
          if (backEl) backEl.style.bottom = (layoutH - top) + 'px';   // the tap-to-close area stops where the sheet starts, so it can never sit on top of the sheet
        }
        vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit();
      })(commentsEl);
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
            var er = await api('editPost', { familyId: S.familyId, postId: post.$id, body: text });
            post.body = text; post.$updatedAt = new Date().toISOString();
            if (er.edited) post.editedAt = post.$updatedAt;
            showBody(); paintEdited();
            toast(er.edited ? 'Post updated.' : 'No changes to save.');
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
    var ta = h('textarea', { rows: 1, class: 'comment-input', maxlength: L.commentMax || 500, 'aria-label': 'Write a comment', placeholder: 'Join the conversation…' });
    // Keep what is typed (or the hint) on one line by making the letters smaller, down to 12 px. Past that, the box grows taller instead.
    var fitCtx = document.createElement('canvas').getContext('2d'), fitBase = 0;
    function fitComment() {
      var cs = getComputedStyle(ta), avail = ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      if (!(avail > 0)) return;
      if (!fitBase) { ta.style.fontSize = ''; fitBase = parseFloat(getComputedStyle(ta).fontSize) || 16; }
      var lines = String(ta.value || ta.placeholder).split('\n'), size = fitBase;
      for (; size > 12; size -= 0.5) {
        fitCtx.font = cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily;
        if (lines.every(function (l) { return fitCtx.measureText(l).width <= avail; })) break;
      }
      ta.style.fontSize = size + 'px';
      ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px';
    }
    ta.addEventListener('input', fitComment);
    ta.addEventListener('focus', fitComment);
    if (window.ResizeObserver) { var fitRO = new ResizeObserver(function () { fitComment(); }); fitRO.observe(ta); }
    else setTimeout(fitComment, 50);
    var send = h('button', { class: 'btn small comment-send', type: 'submit', text: 'Post' });
    var scroller = h('div', { class: 'c-scroll' }, list, status);
    var wrap = h('div', { class: 'comments' }, scroller);

    function pinnedIds() { return String(post.pinnedCommentIds || '').split(',').filter(Boolean); }
    function isPinned(c) { return pinnedIds().indexOf(c.$id) !== -1; }
    var isAuthor = post.authorId === uid;
    var open = {};
    // Where the server has not saved who a reply belongs to, a comment that starts with "@Name" is shown as a reply to that person's latest earlier comment.
    function guessParents(rows) {
      var ids = {}; rows.forEach(function (c) { ids[c.$id] = c; });
      rows.forEach(function (c, i) {
        c.__parent = null;
        if (c.parentId && ids[c.parentId]) return;
        var m = /^@(\S+)/.exec(c.body || ''); if (!m) return;
        var tag = m[1].toLowerCase();
        for (var j = i - 1; j >= 0; j--) {
          var o = rows[j], pr = S.profiles.get(o.authorId);
          if (pr && String(pr.displayName || '').split(' ')[0].toLowerCase() === tag && !(o.parentId && ids[o.parentId]) && !o.__parent) { c.__parent = o.$id; return; }
        }
      });
    }
    function parentOf(c) { return c.parentId || c.__parent || null; }
    function redraw(rows) {
      clear(list);
      guessParents(rows);
      var pins = pinnedIds(), ids = {};
      rows.forEach(function (c) { ids[c.$id] = true; });
      var tops = rows.filter(function (c) { return !parentOf(c) || !ids[parentOf(c)]; });   // replies whose comment was deleted show as normal comments
      var sorted = tops.filter(function (c) { return pins.indexOf(c.$id) !== -1; })
        .concat(tops.filter(function (c) { return pins.indexOf(c.$id) === -1; }));
      sorted.forEach(function (c) {
        list.appendChild(commentItem(c, rows));
        var kids = rows.filter(function (r) { return parentOf(r) === c.$id; });
        if (!kids.length) return;
        if (!open[c.$id]) {
          list.appendChild(h('button', { class: 'view-replies', type: 'button', text: 'View ' + kids.length + (kids.length === 1 ? ' reply' : ' replies'), onclick: function () { open[c.$id] = true; redraw(rows); } }));
        } else {
          kids.forEach(function (r) { list.appendChild(commentItem(r, rows)); });
          list.appendChild(h('button', { class: 'view-replies', type: 'button', text: 'Hide replies', onclick: function () { open[c.$id] = false; redraw(rows); } }));
        }
      });
    }
    var replyTo = null, replyBar = h('div', { class: 'reply-bar', hidden: true });
    function setReply(c) {
      replyTo = c; clear(replyBar);
      if (!c) { replyBar.hidden = true; return; }
      var pr = S.profiles.get(c.authorId), nm = pr ? pr.displayName : 'Family member';
      replyBar.hidden = false;
      replyBar.appendChild(h('span', { class: 'small', text: 'Replying to ' + nm }));
      replyBar.appendChild(h('button', { class: 'link-btn small', type: 'button', text: 'Cancel', 'aria-label': 'Cancel reply', onclick: function () { setReply(null); ta.value = ''; } }));
      var tag = '@' + nm.split(' ')[0] + ' ';
      if (ta.value.indexOf(tag) !== 0) ta.value = tag + ta.value;
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    function commentItem(c, rows) {
      var p = S.profiles.get(c.authorId) || null;
      var del = null, pin = null;
      var item = h('div', { class: 'comment' + (isPinned(c) ? ' pinned' : '') });
      var liked = Array.isArray(c.likedBy) ? c.likedBy.slice() : [];
      var likeBtn = h('button', { class: 'like-c', type: 'button' });
      var badge = h('span', { class: 'author-liked', hidden: true, title: 'Liked by the author' });
      function paintC() {
        var on = liked.indexOf(uid) !== -1;
        clear(likeBtn); likeBtn.appendChild(icon('heart'));
        if (liked.length) likeBtn.appendChild(h('span', { class: 'n', text: String(liked.length) }));
        var byAuthor = liked.indexOf(post.authorId) !== -1 && c.authorId !== post.authorId;
        badge.hidden = !byAuthor; clear(badge);
        if (byAuthor) { badge.appendChild(avatarEl(S.profiles.get(post.authorId) || null)); badge.appendChild(icon('heart')); }
        likeBtn.classList.toggle('on', on);
        likeBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        likeBtn.setAttribute('aria-label', (on ? 'Remove your like from this comment. ' : 'Like this comment. ') + liked.length + ' likes');
      }
      likeBtn.addEventListener('click', async function () {
        if (likeBtn.disabled) return; likeBtn.disabled = true;
        try {
          var r = await api('toggleCommentLike', { familyId: S.familyId, commentId: c.$id });
          liked = liked.filter(function (x) { return x !== uid; });
          if (r.liked) liked.push(uid);
          c.likedBy = liked;
        } catch (e) { toast(friendly(e)); }
        likeBtn.disabled = false; paintC();
      });
      paintC();
      if (isAuthor) {
        pin = h('button', { class: 'link-btn small', type: 'button', text: isPinned(c) ? 'Unpin' : 'Pin', 'aria-label': isPinned(c) ? 'Unpin this comment' : 'Pin this comment to the top', onclick: async function () {
          try {
            var r = await api('pinComment', { familyId: S.familyId, postId: post.$id, commentId: c.$id, pinned: !isPinned(c) });
            post.pinnedCommentIds = r.pinned.join(',');
            if (rows) redraw(rows);
          } catch (e) { toast(friendly(e)); }
        } });
      }
      if (c.authorId === uid || S.isOwner) {
        del = h('button', { class: 'link-btn small', type: 'button', text: 'Delete', 'aria-label': 'Delete this comment', onclick: async function () {
          var ok = await confirmDialog('Delete this comment?', 'This cannot be undone.', 'Delete');
          if (!ok) return;
          try {
            await api('deleteComment', { familyId: S.familyId, commentId: c.$id });
            if (rows) { var i = rows.indexOf(c); if (i !== -1) rows.splice(i, 1); }
            if (item.parentNode) item.parentNode.removeChild(item); st.comments = Math.max(0, st.comments - 1); onCount();
          }
          catch (e) { toast(friendly(e)); }
        } });
      }
      var replyBtn = h('button', { class: 'link-btn small', type: 'button', text: 'Reply', 'aria-label': 'Reply to ' + (p ? p.displayName : 'this comment'), onclick: function () { setReply(c); } });
      if (parentOf(c) && rows && rows.some(function (r) { return r.$id === parentOf(c); })) item.classList.add('reply');
      item.appendChild(avatarEl(p));
      item.appendChild(h('div', { class: 'bubble' },
        isPinned(c) ? h('div', { class: 'pin-flag small' }, icon('pin'), ' Pinned by the author') : null,
        h('div', { class: 'chead' }, h('strong', { text: p ? p.displayName : 'Family member' }), h('span', { class: 'muted', text: timeAgo(c.$createdAt) }),
          c.authorId === post.authorId ? h('span', { class: 'muted', text: '\u2022 Author' }) : null, badge),
        h('div', { class: 'comment-body', text: c.body }),
        h('div', { class: 'comment-actions' }, replyBtn, pin, del)));
      item.appendChild(likeBtn);
      return item;
    }
    var loaded = [];

    status.appendChild(spinnerLine('Loading comments…', 'comments'));
    (async function () {
      try {
        var rows = await listAllRows('comments', [Query.equal('postId', [post.$id]), Query.orderAsc('$createdAt')], 200);
        await ensureProfiles(rows.map(function (c) { return c.authorId; }));
        clear(status);
        loaded = rows; redraw(loaded);
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
          var made = await api('createComment', { familyId: S.familyId, postId: post.$id, body: text, parentId: replyTo ? replyTo.$id : undefined });
          var row = { $id: made.commentId, authorId: uid, body: text, likedBy: [], parentId: made.parentId || undefined, $createdAt: new Date().toISOString() };
          S.profiles.set(uid, S.profile);
          if (!row.parentId && replyTo) row.__parent = parentOf(replyTo) || replyTo.$id;
          clear(status); loaded.push(row); guessParents(loaded); if (parentOf(row)) open[parentOf(row)] = true; redraw(loaded);
          setReply(null); ta.value = ''; ta.style.height = 'auto'; fitComment(); showAlert(msg, 'error', '');
          st.comments++; onCount();
        } catch (e) { showAlert(msg, 'error', friendly(e)); }
      }, 'Posting…');
    } }, replyBar, h('div', { class: 'emoji-row', role: 'group', 'aria-label': 'Quick emojis' }, ['\u2764\uFE0F', '\uD83D\uDE4C', '\uD83D\uDD25', '\uD83D\uDC4F', '\uD83D\uDE22', '\uD83D\uDE0D', '\uD83D\uDE2E', '\uD83D\uDE02'].map(function (em) {
      return h('button', { class: 'emoji', type: 'button', text: em, 'aria-label': 'Add ' + em, onclick: function () {
        var a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd;
        if (ta.value.length + em.length > (L.commentMax || 500)) return;
        ta.value = ta.value.slice(0, a) + em + ta.value.slice(b); ta.focus(); ta.setSelectionRange(a + em.length, a + em.length);
        ta.dispatchEvent(new Event('input'));
      } });
    })), h('div', { class: 'comment-row' }, avatarEl(S.profile), ta, send), msg);
    form.className = 'comment-form';
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
      var ccBox = null, ccRow = null, origFile = null, editState = null;
      var giftBox = null, giftRow = null;
      if (kind === 'photo' && shopEnabled()) {
        giftBox = h('input', { type: 'checkbox', id: 'gift-ok' });
        giftRow = h('div', null, h('label', { class: 'check', for: 'gift-ok' }, giftBox, ' Let family order gifts with this photo'),
          h('p', { class: 'hint', text: 'Off unless you turn it on. If you do, the photo is shared with Printify to make a gift only when a family member orders one. You can change this later from the ⋯ menu.' }));
      }
      function openEditor(f) {
        if (!window.VideoEditor) return Promise.resolve({ kind: 'original', file: f });
        return window.VideoEditor.open(f, {
          maxBytes: (L.videoMaxMB || 15) * 1048576, maxInputBytes: (CFG.editorMaxInputMB || 300) * 1048576, maxSeconds: CFG.editorMaxSeconds || 300,
          shortMaxSeconds: kind === 'short' ? (L.shortMaxSeconds || 60) : 0, requireVertical: kind === 'short', initial: editState, fileName: 'video'
        });
      }
      if (kind === 'video' || kind === 'short') {
        ccBox = h('input', { type: 'checkbox', id: 'cc-make' });
        ccRow = h('div', null, h('label', { class: 'check', for: 'cc-make' }, ccBox, ' Add automatic captions'),
          h('p', { class: 'hint', text: 'English only. Made on your phone before posting, so it adds a minute or so. The first time, it downloads a speech model (about 80 MB, once). Not perfect, so watch the captions once.' }));
      }

      if (kind !== 'text') {
        var accept = kind === 'photo' ? 'image/jpeg,image/png,image/webp,image/heic,image/heif' : 'video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm';
        fileInput = h('input', { id: 'file', type: 'file', accept: accept });
        renderUsage(limitsBox, true);
        info.textContent = kind === 'photo'
          ? 'Photos are shrunk to ' + (L.imageMaxEdge || 1600) + ' pixels on the long side before upload, which saves space.'
          : 'Up to ' + (L.videoMaxMB || 15) + ' MB' + (kind === 'short' ? ', ' + (L.shortMaxSeconds || 60) + ' seconds or less, and vertical (taller than wide)' : '') + '. When you choose a video, an editor opens on your device (trim, cut sections out, adjust colors). Nothing is uploaded until you finish editing and tap Export and post, and only the edited video is uploaded and posted.';
        fileInput.addEventListener('change', async function (ev) {
          var autoPost = false;
          var again = ev && ev.isTrusted === false && origFile, keep = again ? { file: file, orig: origFile, state: editState } : null;
          if (!again) { origFile = null; editState = null; }
          file = null; dropPreview(); clear(prev); showAlert(msg, 'error', '');
          var f = (ev && ev.isTrusted === false && origFile) ? origFile : fileInput.files[0]; if (!f) return;
          try {
            if (kind === 'photo') {
              if (f.type === 'image/gif') throw new Error('Animated GIFs are not supported. Please choose a JPEG, PNG or WebP photo.');
              previewUrl = URL.createObjectURL(f);
              prev.appendChild(h('img', { src: previewUrl, alt: 'Preview of your photo', style: null }));
              prev.firstChild.style.maxHeight = '260px'; prev.firstChild.style.borderRadius = '10px';
            } else {
              var mime = videoMime(f);
              if (!mime) throw new Error('Please choose an MP4, MOV or WebM video.');
              // Nothing is uploaded here. The editing screen opens first, and only the edited result can be posted.
              var res = await openEditor(f);
              if (!res) {
                if (keep) { res = { kind: 'edited', file: keep.file, duration: keep.state.duration }; origFile = keep.orig; editState = keep.state; }   // canceled "Edit again": keep what was ready
                else { fileInput.value = ''; return; }
              }
              if (res.kind === 'edited') {
                file = res.file; origFile = origFile || f; if (res.state) editState = res;
                prev.appendChild(h('p', { class: 'small', text: 'Edited video ready: ' + fmtMB(res.file.size) + ' · ' + Math.round(res.duration) + ' seconds. It is being posted now.' }));
                prev.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Edit again', onclick: function () { fileInput.dispatchEvent(new Event('change')); } }));
                if (res.state && !keep) autoPost = true;                 // fresh export: upload and post right away
              } else {
                if (f.size > (L.videoMaxMB || 15) * 1048576) throw new Error('That video is ' + fmtMB(f.size) + '. The limit is ' + (L.videoMaxMB || 15) + ' MB.');
                var meta = await probeVideo(f);
                if (kind === 'short') {
                  if (meta.duration > (L.shortMaxSeconds || 60) + 0.5) throw new Error('Shorts must be ' + (L.shortMaxSeconds || 60) + ' seconds or less. This one is ' + Math.round(meta.duration) + ' seconds.');
                  if (meta.h <= meta.w) throw new Error('Shorts must be vertical (taller than wide). Use the Video tab for this one.');
                }
                file = f; origFile = f; editState = null;
                prev.appendChild(h('p', { class: 'small', text: f.name + ' · ' + fmtMB(f.size) + ' · ' + Math.round(meta.duration) + ' seconds (not edited)' }));
                autoPost = true;
              }
            }
            try {
              var uu = await getUsage();
              var est = kind === 'photo' ? Math.min(f.size, 1.5 * 1048576) : file.size;
              if (uu.usedBytes + est > uu.limitBytes) throw new Error('Your family has ' + fmtBytes(Math.max(0, uu.limitBytes - uu.usedBytes)) + ' of photo and video space left, and this file needs about ' + fmtBytes(est) + '. Nothing was uploaded and nothing has been deleted. You can remove posts you no longer need, or ask the family owner.');
            } catch (e2) { if (e2 && e2.message && !e2.type && !e2.apiCode && e2.name === 'Error') throw e2; }   // if the usage check itself fails, the server still checks on posting
            if (kind === 'photo') file = f;
            if (autoPost && file) setTimeout(function () { if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); }, 50);
          } catch (e) { file = null; origFile = null; editState = null; clear(prev); fileInput.value = ''; showAlert(msg, 'error', e.message || friendly(e)); }
        });
      }

      var btn = h('button', { class: 'btn block', type: 'submit', text: 'Post' });
      var cancelled = false, posting = false;
      var cancelBtn = h('button', { class: 'btn secondary block', type: 'button', text: 'Cancel', onclick: function () {
        if (posting) { cancelled = true; cancelBtn.disabled = true; cancelBtn.textContent = 'Canceling…'; return; }
        dropPreview(); location.hash = '#/home';
      } });
      var form = h('form', { novalidate: true, class: 'card', onsubmit: function (ev) {
        ev.preventDefault();
        var text = ta.value.trim(), uid = S.user.$id;
        if (kind === 'text' && !text) return showAlert(msg, 'error', 'Write something first.');
        if (kind !== 'text' && !file) return showAlert(msg, 'error', 'Please choose a ' + (kind === 'photo' ? 'photo' : 'video') + ' first.');
        if ((kind === 'video' || kind === 'short') && file.size > (L.videoMaxMB || 15) * 1048576) return showAlert(msg, 'error', 'This video is ' + fmtMB(file.size) + ', over the ' + (L.videoMaxMB || 15) + ' MB limit, so it cannot be posted. Edit it smaller or cut it shorter.');
        if (text.length > (L.bodyMax || 2000)) return showAlert(msg, 'error', 'That is too long. The limit is ' + (L.bodyMax || 2000) + ' characters.');
        showAlert(msg, 'error', '');
        var fid = S.familyId;
        cancelled = false; posting = true; cancelBtn.textContent = 'Cancel upload';
        busy(btn, async function () {
          var uploaded = null;
          function chk() { if (cancelled) throw new Error('__cancelled'); }
          try {
            var payload = { familyId: fid, kind: kind, body: text };
            function onProg(p) { bar.hidden = false; bar.value = Math.round(p.progress || 0); }
            if (kind === 'photo') {
              btn.textContent = 'Preparing photo…';
              var jf = await imageToJpegFile(file, L.imageMaxEdge || 1600, L.imageQuality || 0.82, false, 'photo.jpg');
              btn.textContent = 'Uploading…';
              chk();
              uploaded = await uploadFile(jf, onProg); chk();
              payload.mediaFileId = uploaded.$id;
            } else if (kind === 'video' || kind === 'short') {
              var mime = videoMime(file);
              var ext = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[mime];
              if (ccBox && ccBox.checked) {
                btn.textContent = 'Making captions…';
                var cc = await makeCaptionCues(file); chk();
                if (cc) payload.captions = cc; else toast('Posting without captions. You can add them later from the ⋯ menu.');
              }
              btn.textContent = 'Uploading…';
              chk();
              uploaded = await uploadFile(new File([file], 'video.' + ext, { type: mime }), onProg); chk();
              payload.mediaFileId = uploaded.$id;
            }
            btn.textContent = 'Posting…'; cancelBtn.disabled = true; chk();
            if (fid !== S.familyId) throw new Error('You switched families while uploading. Nothing was posted.');
            var made = await api('createPost', payload);
            if (kind === 'photo' && giftBox && giftBox.checked && shopEnabled()) { var mid = made && (made.postId || (made.post && made.post.$id) || (made.row && made.row.$id) || made.id); if (mid) await window.FCShop.setGiftAfterPost(mid, true); }
            S.profiles.set(uid, S.profile); S.usage = null;
            toast('Posted!'); confetti();
            location.hash = kind === 'short' ? '#/shorts' : '#/home';
          } catch (e) {
            if (uploaded) storage.deleteFile({ bucketId: CFG.bucketId, fileId: uploaded.$id }).catch(function () {});   // best effort; the server also sweeps leftovers
            bar.hidden = true; posting = false; cancelBtn.disabled = false; cancelBtn.textContent = 'Cancel';
            if (e && e.message === '__cancelled') { toast('Upload canceled. Nothing was posted.'); draft = ta.value; file = null; build(); return; }
            showAlert(msg, 'error', e.message && !e.type ? e.message : friendly(e));
          }
        }, 'Posting…');
      } },
        h('label', { for: 'body', text: kind === 'text' ? 'Your note' : 'Caption' }), ta,
        fileInput ? h('div', null, h('label', { for: 'file', text: kind === 'photo' ? 'Photo' : kind === 'short' ? 'Short video' : 'Video' }), fileInput, info, limitsBox, prev) : null,
        ccRow, giftRow, bar, msg, h('div', { class: 'stack' }, btn, cancelBtn));
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

  // The Family screen now lives in Settings. Old links and bookmarks still land in the right place.
  VIEWS.family = function (main, token, tab, personId) {
    location.replace(tab === 'tree' ? '#/tree' + (personId ? '/' + personId : '') : '#/settings/family');
  };

  /* ---------- FAMILY TREE PAGE (bottom bar): a view-only tree drawn by family-chart (see tree-chart.js) ---------- */
  var KIND_LABEL = { birth: 'Birth parent', adoptive: 'Adoptive parent', step: 'Step-parent', foster: 'Foster parent', guardian: 'Guardian' };
  function kindsOf(p) { return window.FamilyTreeChart ? window.FamilyTreeChart.parseKinds(p) : {}; }
  function kindTag(kind) { return kind && kind !== 'birth' ? h('span', { class: 'kind-tag', text: KIND_LABEL[kind] || kind }) : null; }

  VIEWS.tree = async function (main, token, focusId) {
    main.appendChild(h('h1', { text: 'Family Tree' }));
    var holder = h('div', { class: 'tree-box' }, spinnerLine('Loading the family tree…', 'tree'));
    main.appendChild(holder);
    var tree;
    try { tree = await loadTree(true); }
    catch (e) { clear(holder).appendChild(alertBox('error', e && e.code === 404 ? 'The family tree needs one more setup step: create the people and suggestions tables (see the Setup Guide).' : friendly(e))); return; }
    if (token !== S.nav) return;
    clear(holder);
    var people = tree.people;
    holder.appendChild(h('p', { class: 'hint' }, 'Only members of ' + famName() + ' can see this tree. To change who is who, or to suggest a correction, go to ',
      h('a', { class: 'inline-btn', href: '#/settings/tree', text: 'Edit in Settings' }), '.'));
    if (!people.length) {
      holder.appendChild(h('div', { class: 'empty' }, h('p', { text: 'No one is in the family tree yet.' }),
        h('p', { class: 'muted small', text: 'An owner or tree admin can start it in Settings.' }), h('a', { class: 'btn', href: '#/settings/tree', text: 'Open family tree settings' })));
      return;
    }
    if (!window.FamilyTreeChart) { holder.appendChild(alertBox('error', 'The tree drawing code did not load (tree-chart.js). Check that the file was uploaded next to index.html, then refresh.')); return; }
    var byId = {}; people.forEach(function (p) { byId[p.$id] = p; });
    var oldest = people.slice().sort(function (a, b) { return new Date(a.$createdAt) - new Date(b.$createdAt); })[0];
    var mine = personFor(tree, S.user.$id);
    var startId = focusId && byId[focusId] ? focusId : (mine ? mine.$id : oldest.$id);
    var mixed = people.some(function (p) { var k = kindsOf(p); return Object.keys(k).some(function (x) { return k[x] !== 'birth'; }); });

    // toolbar: jump to a person, and (only when the family has adoptive/step/foster links) which parents to draw
    var jump = h('select', { id: 'tree-jump', 'aria-label': 'Jump to a person' },
      people.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).map(function (p) { return h('option', { value: p.$id, text: p.name }); }));
    jump.value = startId;
    var bar = h('div', { class: 'tree-bar' }, h('div', { class: 'grow' }, h('label', { for: 'tree-jump', class: 'small muted', text: 'Jump to' }), jump));
    var lensSel = null;
    if (mixed) {
      lensSel = h('select', { id: 'tree-lens', 'aria-label': 'Which parents to draw' },
        h('option', { value: 'birth', text: 'Draw birth parents' }), h('option', { value: 'raised', text: 'Draw the parents who raised them' }));
      bar.appendChild(h('div', { class: 'grow' }, h('label', { for: 'tree-lens', class: 'small muted', text: 'Parents shown' }), lensSel));
    }
    var editing = false, canToggle = canEditTree() || !!mine;
    var editBtn = canToggle ? h('button', { class: 'btn secondary small', type: 'button', 'aria-pressed': 'false', text: 'Edit', onclick: function () { editing = !editing; editBtn.setAttribute('aria-pressed', String(editing)); editBtn.textContent = editing ? 'Done editing' : 'Edit'; if (addBtn) addBtn.hidden = !editing; if (ctl && ctl.mainId) select(jump.value); } }) : null;
    var addBtn = null;
    if (canEditTree()) bar.appendChild(addBtn = h('button', { class: 'btn small tree-add', type: 'button', text: '+ Add person', onclick: function () { personDialog(null, tree, function () { S.tree = null; route(false); }, { lite: true }); } }));
    if (addBtn) addBtn.hidden = true;
    if (editBtn) bar.appendChild(editBtn);
    holder.appendChild(bar);

    var chartEl = h('div', { class: 'tree-chart', role: 'group', 'aria-label': 'Family tree. Drag to move around. Use the plus and minus buttons to zoom. Press Tab to move through the people, then Enter to choose one.' });
    var ctl = null;
    var tools = h('div', { class: 'tree-tools' },
      h('button', { class: 'tool', type: 'button', 'aria-label': 'Zoom in', text: '+', onclick: function () { if (ctl) ctl.zoom(1.3); } }),
      h('button', { class: 'tool', type: 'button', 'aria-label': 'Zoom out', text: '−', onclick: function () { if (ctl) ctl.zoom(0.77); } }),
      h('button', { class: 'tool', type: 'button', 'aria-label': 'Show the whole tree', text: 'Fit', onclick: function () { if (ctl) ctl.fit(); } }),
      mine ? h('button', { class: 'tool', type: 'button', 'aria-label': 'Go back to me in the tree', title: 'Back to me', text: 'Me', onclick: function () { if (ctl) ctl.focus(mine.$id); select(mine.$id); } }) : null);
    holder.appendChild(h('div', { class: 'tree-stage' }, chartEl, tools));
    var count = h('p', { class: 'hint tree-count', 'aria-live': 'polite' });
    holder.appendChild(count);
    holder.appendChild(h('p', { class: 'hint', text: 'Drag to move around. Pinch or use + and − to zoom. Tap a person to centre the tree on them and see their parents, partners and children.' + (mine ? ' Lost? Press “Me” to come back to yourself.' : '') }));
    var panel = h('section', { class: 'card tree-panel', 'aria-live': 'polite', 'aria-label': 'Selected person' });
    holder.appendChild(panel);
    // People with no parent, partner or child link never appear around anyone else, so list them where they can be seen and tapped.
    var loose = people.filter(function (p) {
      return !(p.parentIds || []).some(function (x) { return byId[x]; }) && !(p.partnerIds || []).some(function (x) { return byId[x]; }) && !people.some(function (c) { return (c.parentIds || []).indexOf(p.$id) !== -1; });
    });
    if (loose.length && loose.length < people.length || loose.length > 1) {
      holder.insertBefore(h('div', { class: 'card tree-loose' },
        h('strong', { text: 'Not connected to the tree yet' }),
        h('p', { class: 'small muted', text: 'These people have no parent, partner or child linked, so the picture cannot place them. ' + (canEditTree() ? 'Tap one, then the pencil, to link them.' : 'Ask an owner or tree admin to link them.') }),
        h('div', { class: 'rel-list' }, loose.map(function (p) {
          return h('button', { class: 'chip', type: 'button', onclick: function () { if (ctl) ctl.focus(p.$id); select(p.$id); } }, p.name);
        }))), count);
    }

    function relatives(id) {
      var p = byId[id], kinds = kindsOf(p);
      var parents = (p.parentIds || []).filter(function (x) { return byId[x]; }).map(function (x) { return { id: x, kind: kinds[x] || 'birth' }; });
      var partners = (p.partnerIds || []).filter(function (x) { return byId[x]; });
      var kids = people.filter(function (c) { return (c.parentIds || []).indexOf(id) !== -1; }).map(function (c) { return { id: c.$id, kind: kindsOf(c)[id] || 'birth' }; });
      var pids = parents.map(function (x) { return x.id; });
      var sibs = people.filter(function (c) { return c.$id !== id && (c.parentIds || []).some(function (x) { return pids.indexOf(x) !== -1; }); }).map(function (c) { return c.$id; });
      return { parents: parents, partners: partners, children: kids, siblings: sibs };
    }
    function fmtBirthday(b) {
      b = String(b || ''); if (b.length !== 10) return b.length === 4 ? 'Born in ' + b : '';
      var d = new Date(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
      return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    }
    function personDetails(p, prof) {
      var box = h('div', { class: 'tree-details' }), a = ageOf(p), rows = [];
      if (prof && prof.bio) box.appendChild(h('p', { class: 'tree-bio', text: prof.bio }));
      if (a && a.n >= 0) rows.push(['Age', (a.approx ? 'About ' : '') + (a.n < 2 ? (a.n === 1 ? '1 year old' : 'Under 1') : a.n + ' years old')]);
      if (p.gender) rows.push(['Gender', p.gender]);
      var bd = fmtBirthday(p.birthday); if (bd) rows.push(['Birthday', bd]);
      var ad = prof ? addressOf(prof) : ''; if (ad) rows.push(['Address', ad]);
      if (rows.length) box.appendChild(h('dl', { class: 'tree-facts' }, rows.map(function (r) { return h('div', null, h('dt', { text: r[0] }), h('dd', { text: r[1] })); })));
      var cats = prof ? visibleAbout(prof).filter(function (c) { return c.items && c.items.length; }) : [];
      cats.forEach(function (c) {
        box.appendChild(h('div', { class: 'rel-group' }, h('strong', { text: c.title }), h('ul', { class: 'tags' }, c.items.map(function (i) { return h('li', { class: 'tag', text: i }); }))));
      });
      if (!box.childNodes.length) box.appendChild(h('p', { class: 'muted small', text: p.userId ? p.name + ' has not added details yet.' : 'No details added for ' + p.name + ' yet.' }));
      return box;
    }
    function select(id) {
      var p = byId[id], r = relatives(id);
      jump.value = id;
      clear(panel);
      var prof = p.userId ? S.profiles.get(p.userId) : null;
      var actions = [];
      if (ctl && ctl.mainId && ctl.mainId() !== p.$id) actions.push(h('button', { class: 'btn secondary small', type: 'button', text: 'Center tree here', onclick: function () { ctl.focus(p.$id); select(p.$id); } }));
      actions.push(h('button', { class: 'btn secondary small', type: 'button', text: 'Suggest a change', onclick: function () { sendSuggestion(p.$id); } }));
      if (editing && (canEditTree() || p.userId === S.user.$id)) actions.push(h('button', { class: 'edit-pencil', type: 'button', 'aria-label': 'Edit ' + p.name, title: 'Edit ' + p.name, onclick: function () { personDialog(p, tree, function (nid) { S.tree = null; route(false); }); } }, icon('edit')));
      var pLink = p.userId ? '#/profile/' + p.userId : null, pAv = avatarEl(prof || { displayName: p.name });
      panel.appendChild(h('div', { class: 'tree-who' }, pLink ? h('a', { class: 'avatar-link', href: pLink, 'aria-label': 'Open ' + p.name + '’s profile' }, pAv) : pAv, h('div', { class: 'grow' }, h('h2', null, pLink ? h('a', { class: 'name-link', href: pLink, text: p.name }) : p.name), detailLine(p) ? h('div', { class: 'small muted', text: detailLine(p) }) : null)));
      panel.appendChild(h('div', { class: 'row' }, actions));
      panel.appendChild(personDetails(p, prof));
      if (!p.userId && S.isOwner) {   // someone in the tree who has no account yet (for example a parent): invite them from here
        if (p.inviteMembershipId) panel.appendChild(h('p', { class: 'small muted', text: 'An invitation is waiting for ' + p.name + '. When they accept it, this entry becomes their own. Manage invitations in Settings \u2192 Family.' }));
        else panel.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', text: 'Invite ' + p.name + ' by email', onclick: function () {
          inviteTreePerson(p);
        } })));
      }
      if (editing && canEditTree()) {
        var addRow = h('div', { class: 'tree-addrel' }, h('strong', { class: 'small tree-addrel-title', text: 'Add a relative' }));
        [['parent', 'Parent'], ['partner', 'Partner'], ['child', 'Child'], ['sibling', 'Sibling']].forEach(function (o) {
          addRow.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: '+ ' + o[1], onclick: function () { personDialog(null, tree, function () { S.tree = null; route(false); }, { relation: o[0], of: p, lite: true }); } }));
        });
        panel.appendChild(addRow);
      }
      function group(label, items) {
        if (!items.length) return;
        panel.appendChild(h('div', { class: 'rel-group' }, h('strong', { text: label }), h('div', { class: 'rel-list' }, items.map(function (it) {
          return h('button', { class: 'chip', type: 'button', onclick: function () { if (ctl) ctl.focus(it.id); select(it.id); } }, byId[it.id].name, kindTag(it.kind));
        }))));
      }
      group(r.parents.length > 1 ? 'Parents' : 'Parent', r.parents);
      group(r.partners.length > 1 ? 'Partners' : 'Partner', r.partners.map(function (x) { return { id: x }; }));
      group(r.children.length > 1 ? 'Children' : 'Child', r.children);
      group(r.siblings.length > 1 ? 'Siblings' : 'Sibling', r.siblings.map(function (x) { return { id: x }; }));
      if (!r.parents.length && !r.partners.length && !r.children.length) panel.appendChild(h('p', { class: 'muted small', text: 'No relatives linked to ' + p.name + ' in the tree yet.' }));
    }
    jump.addEventListener('change', function () { if (ctl) ctl.focus(jump.value); select(jump.value); });
    if (lensSel) lensSel.addEventListener('change', function () { if (ctl) ctl.setLens(lensSel.value); });

    try {
      ctl = await window.FamilyTreeChart.mount(chartEl, {
        people: people, mainId: startId, lens: 'birth',
        avatar: function (person) { return avatarEl(person.userId ? (S.profiles.get(person.userId) || { displayName: person.name }) : { displayName: person.name }); },
        onSelect: function (id) { select(id); },
        onUpdate: function (n) {
          count.textContent = n.shown >= n.total ? 'Showing all ' + n.total + (n.total === 1 ? ' person.' : ' people.') : 'Showing ' + n.shown + ' of ' + n.total + ' people around the person you chose. Tap anyone, or use “Jump to”, to see the rest.';
        }
      });
    } catch (e) {
      clear(chartEl).appendChild(alertBox('error', 'The tree picture could not be drawn (' + friendly(e) + '). Your family tree is safe. You can still see everyone in Settings.'));
      chartEl.appendChild(h('a', { class: 'btn', href: '#/settings/tree', text: 'Open the list view' }));
      return;
    }
    if (token !== S.nav) { ctl.destroy(); return; }
    select(startId);
  };

  // Settings > Family and members: the member list and everything about managing it.
  async function settingsFamilyHub(main, token, tab, personId) {
    if (tab === 'tree') { location.replace('#/settings/tree' + (personId ? '/' + personId : '')); return; }
    main.appendChild(h('a', { class: 'btn secondary', href: '#/tree', text: 'Open the Family Tree' }));
    await familyMembers(main, token);
    if (token !== S.nav) return;
    return settingsFamily(main, token);
  }

  async function familyMembers(main, token) {
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
    listBox.appendChild(h('h2', { text: joined.length + (joined.length === 1 ? ' member' : ' members') }));
    try { if (!S.tree) await loadTree(true); } catch (e) { /* the tree is only used to fill in names and pictures */ }
    if (token !== S.nav) return;
    var tpeople = (S.tree && S.tree.people) || [];
    function treeMatch(m) {   // the tree entry that belongs to this membership: by account, by the invitation, or (last) by the same name
      var hit = tpeople.filter(function (x) { return x.userId === m.userId || (x.inviteMembershipId && x.inviteMembershipId === m.$id); })[0];
      if (!hit && m.userName) hit = tpeople.filter(function (x) { return x.userId && String(x.name).trim().toLowerCase() === String(m.userName).trim().toLowerCase(); })[0];
      return hit || null;
    }
    joined.forEach(function (m) {
      var tp = treeMatch(m);
      var p = S.profiles.get(m.userId) || (tp && tp.userId ? S.profiles.get(tp.userId) : null) || null;
      var isOwnerRow = m.roles.indexOf('owner') >= 0;
      var isTA = !!(p && p.treeAdmin === true);
      // Someone who joined but has not finished "Set up your profile" has no saved name or picture. Show the best name we know.
      var treeName = (tp && tp.name) || '';
      var shownName = (p && p.displayName) || m.userName || treeName || '';
      listBox.appendChild(h('div', { class: 'member' }, avatarEl(p || { displayName: shownName || '?' }),
        h('div', { class: 'grow' }, p ? h('a', { class: 'member-link', href: '#/profile/' + (p.userId || m.userId) }, h('strong', { text: p.displayName })) : h('strong', { text: shownName || 'Family member' }),
          m.userId === S.user.$id ? h('span', { class: 'badge', text: ' You' }) : null,
          isOwnerRow ? h('span', { class: 'badge', text: ' Owner' }) : null,
          isTA && !isOwnerRow ? h('span', { class: 'badge', text: ' Tree admin' }) : null,
          p ? null : h('div', { class: 'small muted', text: shownName ? 'Has not set up their profile yet, so there is no picture.' : 'Has not set up their profile yet, so there is no name or picture. They add them when they open the app and finish "Set up your profile".' }))));
    });
  }

  // Settings > Family and members: everything about managing who belongs to the active family.
  async function settingsFamily(main, token) {
    main.appendChild(h('p', { class: 'muted small', text: 'For ' + famName() + '. Each family you belong to has its own settings.' }));
    var holder = h('div', null, spinnerLine('Loading\u2026'));
    main.appendChild(holder);
    var res = await teams.listMemberships({ teamId: S.familyId, queries: [Query.limit(100)] });
    if (token !== S.nav) return;
    await loadProfiles();
    try { if (!S.tree) await loadTree(true); } catch (e) { /* only used to fill in names and pictures */ }
    if (token !== S.nav) return;
    var joined = res.memberships.filter(function (m) { return m.confirm; });
    var me = joined.filter(function (m) { return m.userId === S.user.$id; })[0];
    if (!me) { S.validatedAt = 0; return route(false); }
    clear(holder);
    if (S.isOwner) {
      renderAdminTools(main, token);
      var ta = h('section', { class: 'card', 'aria-label': 'Family tree admins' }, h('h2', { text: 'Family tree admins' }),
        h('p', { class: 'muted small', text: 'Tree admins can change the family tree, the same as owners. They do not get any other owner powers.' }));
      var others = joined.filter(function (m) { return m.roles.indexOf('owner') < 0; });
      if (!others.length) ta.appendChild(h('p', { class: 'muted small', text: 'No other members yet.' }));
      others.forEach(function (m) {
        var p = S.profiles.get(m.userId) || null;
        if (!p) return;
        var isTA = p.treeAdmin === true;
        ta.appendChild(h('div', { class: 'member' }, avatarEl(p), h('div', { class: 'grow' }, h('strong', { text: p.displayName }), isTA ? h('span', { class: 'badge', text: ' Tree admin' }) : null),
          h('button', { class: 'btn secondary small', type: 'button', text: isTA ? 'Remove' : 'Make tree admin', 'aria-label': (isTA ? 'Remove tree admin from ' : 'Make tree admin: ') + p.displayName, onclick: function (ev) {
            busy(ev.currentTarget, async function () {
              try {
                var r = await api('setTreeAdmin', { familyId: S.familyId, userId: m.userId, admin: !isTA });
                p.treeAdmin = r.admin; toast(r.admin ? p.displayName + ' can now manage the family tree.' : 'Tree admin removed.'); route(false);
              } catch (e) { toast(errText(e)); }
            });
          } })));
      });
      main.appendChild(ta);
    } else {
      main.appendChild(h('div', { class: 'card' }, h('p', { text: 'Only family owners can invite or remove people. To add a relative, ask an owner to invite their email address.' })));
    }
    renderLeaveAndDelete(main, me, joined);
  }

  function renderAdminTools(main, token) {
    var fid = S.familyId;
    // ---- rename ----
    var rn = h('section', { class: 'card', 'aria-label': 'Family name' }, h('h2', { text: 'Family name' }),
      h('p', { class: 'muted small', text: 'Everyone in the family sees this name. Only owners can change it.' }),
      h('div', { class: 'row' }, h('strong', { text: famName() }),
        h('button', { class: 'btn secondary small', type: 'button', text: 'Rename family', onclick: async function () {
          var ok = await textDialog('Rename family', famName(), 'Save', { max: 60, aria: 'Family name' }, async function (v) {
            if (!v) throw new Error('Please type a name for your family.');
            await teams.updateName({ teamId: fid, name: v });
          });
          if (ok) { await loadFamilies(); render(); }
        } })));
    main.appendChild(rn);
    // ---- invite ----
    var email = field('inviteEmail', 'Relative\'s email', 'email', { required: true, autocomplete: 'off' });
    var name = field('inviteName', 'Their name', 'text', { maxlength: 60, autocomplete: 'off', required: true });
    function sel(id, label, opts) { var el = h('select', { id: id, name: id }, opts.map(function (o) { return h('option', { value: o[0], text: o[1] }); })); return { el: el, wrap: h('div', null, h('label', { for: id, text: label }), el) }; }
    var rel = sel('inviteRelation', 'They are my…', [['', 'Choose one'], ['parent', 'Parent'], ['child', 'Child'], ['sibling', 'Sibling'], ['partner', 'Partner or spouse'], ['grandparent', 'Grandparent'], ['grandchild', 'Grandchild'], ['aunt_uncle', 'Aunt or uncle'], ['niece_nephew', 'Niece or nephew'], ['cousin', 'Cousin'], ['other', 'Other relative (link later)']]);
    var gen = sel('inviteGender', 'Their gender (optional)', [['', 'Not set'], ['Female', 'Female'], ['Male', 'Male'], ['Nonbinary', 'Nonbinary'], ['Other', 'Other']]);
    var bday = field('inviteBirthday', 'Their birthday (optional)', 'date', {});
    var age = field('inviteAge', 'Or their age (if you do not know the birthday)', 'number', { placeholder: 'For example 8' });
    var msg = h('div');
    var btn = h('button', { class: 'btn', type: 'submit', text: 'Send invitation' });
    var memberBox = h('div', { class: 'card' });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var e = email.input.value.trim();
      if (!emailOk(e)) return showAlert(msg, 'error', 'Please enter a valid email address.');
      busy(btn, async function () {
        try {
          var nm = name.input.value.trim();
          if (!nm) return showAlert(msg, 'error', 'Please type their name.');
          if (!rel.el.value) return showAlert(msg, 'error', 'Please choose how they are related to you under “They are my…”. That is what connects them to you in the family tree.');
          var birthday = bday.input.value || '';
          if (!birthday && age.input.value) {
            var a = Math.floor(Number(age.input.value));
            if (!(a >= 0 && a <= 120)) return showAlert(msg, 'error', 'Please enter an age between 0 and 120.');
            birthday = String(new Date().getFullYear() - a);
          }
          var mem = await teams.createMembership({ teamId: fid, roles: ['member'], email: e, name: nm, url: baseUrl() + '?action=invite' });
          var note = '';
          try {
            var pr = await api('treeAddPerson', { familyId: fid, name: nm, relation: rel.el.value || undefined, birthday: birthday || undefined, gender: gen.el.value || undefined, inviteMembershipId: mem.$id });
            S.tree = null;
            if (pr.linked === false) note = ' They were added to the family tree but are not connected to anyone yet, because that relationship cannot be linked automatically. Open Settings \u2192 Family tree, tap Edit on their box and choose their parents or partner.';
            else note = ' They were added to the family tree and connected to you.';
          } catch (te) { note = ' The invitation was sent, but adding them to the family tree did not work: ' + friendly(te); }
          showAlert(msg, 'ok', 'Invitation sent to ' + e + '. They need to open the link in the email while signed in with that address.' + note + ' If they already filled in their own details, theirs are used instead. Once they accept, only they can change their name, gender and birthday.');
          email.input.value = ''; name.input.value = ''; rel.el.value = ''; gen.el.value = ''; bday.input.value = ''; age.input.value = '';
          loadMemberships();
        } catch (err) { showAlert(msg, 'error', friendly(err)); }
      }, 'Sending…');
    } }, email.wrap, name.wrap, rel.wrap, gen.wrap, bday.wrap, age.wrap, msg, h('div', { class: 'stack' }, btn));
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Invite a relative' },
      h('h2', { text: 'Invite a relative' }),
      h('p', { class: 'muted small', text: 'Only family owners can do this. Ask them to create an account and verify their email first, then send the invitation to that same address. The name, relationship, gender and birthday you fill in below are only a starting point for someone new. If they have already filled in About you, their own details are used.' }), form));

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
          var tp0 = ((S.tree && S.tree.people) || []).filter(function (x) { return x.userId === m.userId || (x.inviteMembershipId && x.inviteMembershipId === m.$id); })[0] || null;
          var prof0 = S.profiles.get(m.userId) || (tp0 && tp0.userId ? S.profiles.get(tp0.userId) : null) || null;
          var label = (prof0 && prof0.displayName) || m.userName || (tp0 && tp0.name) || m.userEmail || 'Family member';
          var isOwnerRow = m.roles.indexOf('owner') >= 0;
          memberBox.appendChild(h('div', { class: 'member mem-row' },
            avatarEl(prof0 || { displayName: label }),
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
              try { await teams.deleteMembership({ teamId: fid, membershipId: m.$id }); if (m.confirm && window.FCChat) { try { await api('chatReconcile', { familyId: fid, userId: m.userId }); } catch (e2) { /* chat may not be set up; the removal itself worked */ } } toast('Removed.'); loadMemberships(); }
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

  /* =====================================================================
   * 12b. PROFILE, ABOUT ME, SETTINGS, FAMILY TREE
   * Everything here is private to the ACTIVE family. Writes go through the family-api function.
   * ===================================================================== */

  var AB = { cats: 10, items: 12, title: 32, item: 40 };
  var ABOUT_PROMPTS = [
    { key: 'movies', ask: 'My favorite movies', title: 'Favorite movies' },
    { key: 'colors', ask: 'My favorite colors', title: 'Favorite colors' },
    { key: 'foods', ask: 'My favorite foods', title: 'Favorite foods' },
    { key: 'shows', ask: 'My favorite shows', title: 'Favorite shows' },
    { key: 'music', ask: 'My favorite songs or artists', title: 'Favorite songs and artists' },
    { key: 'hobbies', ask: 'My hobbies', title: 'Hobbies' },
    { key: 'loves', ask: 'Things I love', title: 'Things I love' },
    { key: 'fears', ask: 'Things I’m afraid of', title: 'Things I’m afraid of' },
    // Memories from childhood (the heading above them in the list says so)
    { key: 'kidshows', ask: 'Shows and cartoons I watched as a kid', title: 'Shows I watched as a kid', kid: true },
    { key: 'kidmovies', ask: 'Movies I watched over and over as a kid', title: 'Movies I watched as a kid', kid: true },
    { key: 'kidgames', ask: 'Games I played as a kid', title: 'Games I played as a kid', kid: true },
    { key: 'kidtoys', ask: 'Toys I loved as a kid', title: 'Toys I loved as a kid', kid: true },
    { key: 'kidoutside', ask: 'What I did for fun outside as a kid', title: 'What I did outside as a kid', kid: true },
    { key: 'kidmusic', ask: 'Songs and music from my childhood', title: 'Music from my childhood', kid: true },
    { key: 'kidfoods', ask: 'Foods and snacks I ate as a kid', title: 'Foods I ate as a kid', kid: true },
    { key: 'kidbooks', ask: 'Books I loved as a kid', title: 'Books I loved as a kid', kid: true },
    { key: 'kidschools', ask: 'Schools I went to as a child', title: 'Schools I went to', kid: true },
    { key: 'kidteachers', ask: 'Teachers I remember', title: 'Teachers I remember', kid: true },
    { key: 'kidsubjects', ask: 'My favorite subjects in school', title: 'Favorite school subjects', kid: true },
    { key: 'kidlunch', ask: 'School lunches I remember', title: 'School lunches I remember', kid: true },
    { key: 'kidfriends', ask: 'Friends I grew up with', title: 'Friends I grew up with', kid: true },
    { key: 'kidplaces', ask: 'Places I lived or visited as a kid', title: 'Where I lived as a kid', kid: true },
    { key: 'kidpets', ask: 'Pets I had growing up', title: 'Pets I had growing up', kid: true },
    { key: 'kidholidays', ask: 'Holidays and traditions when I was little', title: 'Holidays when I was little', kid: true },
    { key: 'kidwant', ask: 'What I wanted to be when I grew up', title: 'What I wanted to be someday', kid: true },
    { key: 'kidtrouble', ask: 'Trouble I got into as a kid', title: 'Trouble I got into as a kid', kid: true },
    { key: 'kidnick', ask: 'Nicknames I had as a kid', title: 'Nicknames I had as a kid', kid: true },
    { key: 'kidfears', ask: 'Things I was afraid of as a kid', title: 'Things I feared as a kid', kid: true }
  ];
  function aboutOf(profile) {
    try { var a = JSON.parse((profile && profile.about) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  // Own circle colors are kept inside the About list as one hidden category (key "ringcolors"), so family can see them without a server change.
  var RING_KEY = 'ringcolors';
  var ADDR_KEY = 'address';   // also hidden from the About lists: one optional line, shown on the family tree
  function visibleAbout(profile) { return aboutOf(profile).filter(function (c) { return c && c.key !== RING_KEY && c.key !== ADDR_KEY; }); }
  function ringCat(profile) { return aboutOf(profile).filter(function (c) { return c && c.key === RING_KEY; }); }
  function addrCat(profile) { return aboutOf(profile).filter(function (c) { return c && c.key === ADDR_KEY; }); }
  function addressOf(profile) { var c = addrCat(profile)[0]; return c && Array.isArray(c.items) && c.items[0] ? String(c.items[0]) : ''; }
  function ringColorsOf(profile) {
    var c = ringCat(profile)[0]; if (!c || !Array.isArray(c.items)) return [];
    return c.items.filter(function (x) { return /^#[0-9a-fA-F]{6}$/.test(x); }).slice(0, 3).map(function (x) { return x.toLowerCase(); });
  }
  // A gradient list for conic-gradient: the colors repeat so the ring loops smoothly and keeps the gradient look.
  function ringStops(cols) { var o = []; for (var r = 0; r < 2; r++) cols.forEach(function (c) { o.push(c); }); o.push(cols[0]); return o.join(', '); }
  var ringClassCache = {};
  function ringClassFor(cols) {
    var key = cols.join('').replace(/#/g, ''); if (ringClassCache[key]) return ringClassCache[key];
    var name = 'ring-c' + key, sheet = null;
    for (var i = 0; i < document.styleSheets.length; i++) { var ss = document.styleSheets[i]; if (ss.href && /styles\.css/.test(ss.href)) { sheet = ss; break; } }
    if (!sheet) return '';
    try { sheet.insertRule('.ring:has(.avatar.' + name + '), .post-head .avatar.' + name + ' { --rb: ' + ringStops(cols) + '; }', sheet.cssRules.length); } catch (e) { return ''; }
    return (ringClassCache[key] = name);
  }
  // Age from a stored birthday ("2015-06-30") or an approximate birth year ("2015").
  function ageOf(p) {
    var b = p && p.birthday ? String(p.birthday) : ''; if (!b) return null;
    var now = new Date(), y = Number(b.slice(0, 4)); if (!y) return null;
    if (b.length === 4) return { n: now.getFullYear() - y, approx: true };
    var m = Number(b.slice(5, 7)), d = Number(b.slice(8, 10)), a = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
    return { n: a, approx: false };
  }
  function detailLine(p) {
    var bits = [], a = ageOf(p);
    if (p.gender) bits.push(p.gender);
    if (a && a.n >= 0) bits.push((a.approx ? 'about ' : '') + (a.n < 2 ? (a.n === 1 ? '1 year old' : 'under 1') : a.n + ' years old'));
    return bits.join(' \u00B7 ');
  }
  function canEditTree() { return !!(S.isOwner || (S.profile && S.profile.treeAdmin === true)); }
  function famName() { var f = currentFamily(); return f ? f.name : 'this family'; }
  function firstName(p) { return String((p && p.displayName) || 'This person').split(' ')[0]; }
  function errText(e) { return e && e.message && !e.type && !e.apiCode ? e.message : friendly(e); }

  // A small text-entry dialog (custom category, editing an answer, suggestions).
  function textDialog(title, value, label, opts, onSubmit) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
      var inp = opts.multiline
        ? h('textarea', { rows: 4, maxlength: opts.max || 500, 'aria-label': opts.aria || title, placeholder: opts.placeholder || '' })
        : h('input', { type: opts.type || 'text', maxlength: opts.max || 60, 'aria-label': opts.aria || title, placeholder: opts.placeholder || '', autocomplete: opts.type === 'email' ? 'off' : undefined });
      inp.value = value || '';
      var msg = h('div'), ok = h('button', { class: 'btn', type: 'submit', text: label }), cancel = h('button', { class: 'btn secondary', type: 'button', text: 'Cancel' });
      function done(v) { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); resolve(v); }
      cancel.addEventListener('click', function () { done(false); });
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      dlg.appendChild(h('form', { novalidate: true, onsubmit: function (ev) {
        ev.preventDefault();
        busy(ok, async function () { try { await onSubmit(inp.value.trim()); done(true); } catch (e) { showAlert(msg, 'error', errText(e)); } }, 'Saving…');
      } }, h('h2', { id: 'dlg-title', text: title }), opts.hint ? h('p', { class: 'hint', text: opts.hint }) : null, inp, msg, h('div', { class: 'row' }, cancel, ok)));
      document.body.appendChild(dlg); dlg.showModal(); inp.focus();
    });
  }

  // Invite someone who is already in the tree but has no account yet (for example a parent). The entry becomes theirs when they accept.
  function inviteTreePerson(p, after) {
    return textDialog('Invite ' + p.name, '', 'Send invitation', { type: 'email', max: 120, aria: 'Email address', placeholder: 'name@example.com',
      hint: 'They get an email link. When they accept, this tree entry becomes theirs, and the family you drew around it stays connected.' }, async function (e) {
      if (!emailOk(e)) throw new Error('Please enter a valid email address.');
      var mem = await teams.createMembership({ teamId: S.familyId, roles: ['member'], email: e, name: p.name, url: baseUrl() + '?action=invite' });
      await api('treeEditPerson', { familyId: S.familyId, personId: p.$id, inviteMembershipId: mem.$id });
      S.tree = null; toast('Invitation sent to ' + e + '.');
      if (after) after(); else route(false);
    });
  }

  // The list of prompts that opens from "Add something about me".
  function pickPrompt(taken, onPick) {
    var dlg = h('dialog', { class: 'sheet-dialog', 'aria-labelledby': 'dlg-title' });
    function close() { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    var list = h('div', { class: 'lib-list' });
    var kidHeading = false;
    ABOUT_PROMPTS.forEach(function (p) {
      if (p.kid && !kidHeading) { kidHeading = true; list.appendChild(h('h3', { class: 'lib-heading', text: 'When I was a kid' })); }
      var has = taken.indexOf(p.key) !== -1;
      list.appendChild(h('button', { class: 'lib-row', type: 'button', disabled: has, onclick: function () { close(); onPick({ key: p.key, title: p.title, items: [] }); } },
        h('span', { text: p.ask }), has ? h('span', { class: 'lib-here', text: 'Added' }) : null));
    });
    list.appendChild(h('button', { class: 'lib-row', type: 'button', onclick: function () {
      close();
      textDialog('Custom prompt', '', 'Add', { max: AB.title, placeholder: 'For example: My dream trip', aria: 'Name of your custom category' }, async function (v) {
        if (!v) throw new Error('Give the category a name.');
        if (v.length > AB.title) throw new Error('Category names can be up to ' + AB.title + ' characters.');
        onPick({ key: 'x' + Math.random().toString(36).slice(2, 10), title: v, items: [] });
      });
    } }, h('span', { text: 'A custom prompt…' })));
    dlg.appendChild(h('h2', { id: 'dlg-title', text: 'Add something about me' }));
    dlg.appendChild(list);
    dlg.appendChild(h('button', { class: 'btn secondary block', type: 'button', text: 'Cancel', onclick: close }));
    document.body.appendChild(dlg); dlg.showModal();
  }

  function whoCanSee() {
    return h('p', { class: 'hint', text: 'Everyone in ' + famName() + ' can read your profile and About me. Only you can change them. Nobody outside this family can see them, and your email address is never shown here. You have a separate profile in each family you belong to.' });
  }

  /* ---------- the About me editor: changes stay a draft until you press Save ---------- */
  function aboutEditor(initial) {
    var base = JSON.stringify(initial), draft = JSON.parse(base), focusKey = null;
    var wrap = h('div'), list = h('div'), msg = h('div');
    var saveBtn = h('button', { class: 'btn', type: 'button', text: 'Save About me' });
    var discardBtn = h('button', { class: 'btn secondary', type: 'button', text: 'Discard changes' });
    var note = h('p', { class: 'small muted' });
    function dirty() { return JSON.stringify(draft) !== base; }
    var GL = { '↑': 'up', '↓': 'down', '‹': 'left', '›': 'right', '✎': 'pencil', '×': 'x' };
    function mini(label, glyph, fn) { return h('button', { class: 'mini', type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(GL[glyph] || 'x')); }
    function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; paint(); }

    function paint() {
      clear(list);
      draft.forEach(function (c, i) {
        var tags = h('ul', { class: 'tags editable' });
        c.items.forEach(function (it, j) {
          tags.appendChild(h('li', { class: 'tag' }, h('span', { text: it }),
            mini('Move ' + it + ' earlier', '‹', function () { move(c.items, j, -1); }),
            mini('Move ' + it + ' later', '›', function () { move(c.items, j, 1); }),
            mini('Edit ' + it, '✎', function () {
              textDialog('Edit answer', it, 'Save', { max: AB.item, aria: 'Answer' }, async function (v) {
                if (!v) throw new Error('An answer cannot be empty.');
                c.items[j] = v; paint();
              });
            }),
            mini('Remove ' + it, '×', function () { c.items.splice(j, 1); paint(); })));
        });
        var input = h('input', { type: 'text', maxlength: AB.item, 'aria-label': 'Add an answer to ' + c.title, placeholder: 'Add an answer', 'data-key': c.key });
        var addForm = h('form', { class: 'about-add', novalidate: true, onsubmit: function (ev) {
          ev.preventDefault();
          var v = input.value.trim();
          if (!v) return;
          if (c.items.length >= AB.items) return showAlert(msg, 'error', 'Each category can have up to ' + AB.items + ' answers.');
          if (c.items.some(function (x) { return x.toLowerCase() === v.toLowerCase(); })) return showAlert(msg, 'error', 'You already added that one.');
          showAlert(msg, 'error', ''); c.items.push(v); focusKey = c.key; paint();
        } }, input, h('button', { class: 'btn small', type: 'submit', text: 'Add' }));
        list.appendChild(h('div', { class: 'about-cat' },
          h('div', { class: 'about-cat-head' }, h('h3', { text: c.title }), h('div', { class: 'about-tools' },
            mini('Move ' + c.title + ' up', '↑', function () { move(draft, i, -1); }),
            mini('Move ' + c.title + ' down', '↓', function () { move(draft, i, 1); }),
            mini('Rename ' + c.title, '✎', function () {
              textDialog('Rename category', c.title, 'Save', { max: AB.title, aria: 'Category name' }, async function (v) {
                if (!v) throw new Error('Give the category a name.');
                c.title = v; paint();
              });
            }),
            mini('Remove the category ' + c.title, '×', function () { draft.splice(i, 1); paint(); }))),
          c.items.length ? tags : h('p', { class: 'small muted', text: 'No answers yet.' }), addForm));
      });
      if (!draft.length) list.appendChild(h('p', { class: 'muted', text: 'Nothing here yet. Use the button below to add a category.' }));
      saveBtn.disabled = !dirty(); discardBtn.disabled = !dirty();
      note.textContent = dirty() ? 'You have changes that are not saved. Nobody else sees them until you press Save.' : 'Everything shown here is saved.';
      if (focusKey) { var el = list.querySelector('input[data-key="' + focusKey + '"]'); focusKey = null; if (el) el.focus(); }
    }
    var addBtn = h('button', { class: 'btn secondary block add-about', type: 'button', onclick: function () {
      if (draft.length >= AB.cats) return showAlert(msg, 'error', 'You can have up to ' + AB.cats + ' categories.');
      pickPrompt(draft.map(function (c) { return c.key; }), function (cat) { draft.push(cat); focusKey = cat.key; paint(); });
    } }, '+ Add something about me');
    saveBtn.addEventListener('click', function () {
      busy(saveBtn, async function () {
        try {
          var r = await api('saveAbout', { familyId: S.familyId, about: draft.concat(ringCat(S.profile), addrCat(S.profile)) });
          S.profile = Object.assign({}, S.profile, { about: r.about }); S.profiles.set(S.user.$id, S.profile);
          draft = visibleAbout(S.profile); base = JSON.stringify(draft);
          showAlert(msg, 'ok', 'Saved. Your family can now see it.'); paint();
        } catch (e) { showAlert(msg, 'error', errText(e)); }
      }, 'Saving…');
    });
    discardBtn.addEventListener('click', async function () {
      if (!dirty()) return;
      if (await confirmDialog('Discard your changes?', 'Your unsaved edits to About me will be lost. What is already saved stays.', 'Discard')) { draft = JSON.parse(base); showAlert(msg, 'error', ''); paint(); }
    });
    wrap.appendChild(list); wrap.appendChild(addBtn); wrap.appendChild(msg); wrap.appendChild(note);
    wrap.appendChild(h('div', { class: 'row' }, saveBtn, discardBtn));
    paint();
    return { el: wrap, isDirty: dirty, addCategory: function (cat) { if (!draft.some(function (c) { return c.key === cat.key; })) { draft.push(cat); focusKey = cat.key; paint(); } } };
  }

  /* ---------- family tree data ---------- */
  async function loadTree(force) {
    var c = S.tree;
    if (!force && c && c.fid === S.familyId && Date.now() - c.at < 20000) return c;
    var fid = S.familyId;
    var people = await listAllRows('people', [Query.equal('familyId', [fid])], 400);
    try { S.memberList = (await teams.listMemberships({ teamId: fid, queries: [Query.limit(100)] })).memberships.filter(function (m) { return m.confirm; }); } catch (e) { S.memberList = S.memberList || []; }
    if (canEditTree() && people.some(function (x) { return x.inviteMembershipId && !x.userId; }) && !S.syncing) {   // someone joined: connect their invitation entry
      S.syncing = true;
      try { var sy = await api('treeSyncInvites', { familyId: fid }); if (sy && sy.linked) people = await listAllRows('people', [Query.equal('familyId', [fid])], 400); } catch (e) { /* older server: ignore */ }
      S.syncing = false;
    }
    var sug = [];
    try { sug = await listAllRows('suggestions', [Query.equal('familyId', [fid]), Query.orderDesc('$createdAt')], 200); } catch (e) { sug = []; }
    var out = { fid: fid, at: Date.now(), people: people, suggestions: sug };
    if (fid === S.familyId) { S.tree = out; S.ringRole = ringRoles(people); applyRingTheme(); }
    return out;
  }
  // My own circle color also tints the Create button and the tab icon.
  function applyRingTheme() {
    var role = (S.user && S.ringRole && S.ringRole.get(S.user.$id)) || '';
    var root = document.documentElement, mine = ringColorsOf(S.profile);
    if (mine.length >= 2) {   // my own colors win over the tree role: play button, Create button, other rainbow accents and the tab icon
      root.setAttribute('data-ring', 'custom'); root.style.setProperty('--rb-me', ringStops(mine)); window.FC_RING_COLORS = ringStops(mine).split(', ');
      root.style.setProperty('--plus-me', 'linear-gradient(90deg, ' + mine.concat(mine[0]).join(', ') + ')');
    } else {
      root.style.removeProperty('--rb-me'); root.style.removeProperty('--plus-me'); window.FC_RING_COLORS = null;
      if (role) root.setAttribute('data-ring', role); else root.removeAttribute('data-ring');
    }
  }
  // Ring colors come from the family tree: a grandparent has a child who has a child; married means a partner is linked in the tree.
  function ringRoles(people) {
    var m = new Map();
    people.forEach(function (p) {
      if (!p.userId) return;
      var kids = people.filter(function (c) { return (c.parentIds || []).indexOf(p.$id) !== -1; });
      var grand = kids.some(function (k) { return people.some(function (g) { return (g.parentIds || []).indexOf(k.$id) !== -1; }); });
      var married = (p.partnerIds || []).some(function (q) { return people.some(function (x) { return x.$id === q; }); });
      if (grand) m.set(p.userId, 'grand'); else if (married) m.set(p.userId, 'married');
    });
    return m;
  }
  function personFor(tree, uid) { return tree ? tree.people.filter(function (p) { return p.userId === uid; })[0] || null : null; }

  async function sendSuggestion(personId, prefill) {
    return textDialog('Suggest a change to the tree', prefill || '', 'Send suggestion', { multiline: true, max: 500, aria: 'Your suggestion', placeholder: 'For example: Add my cousin Maya as Aunt Rose’s daughter.', hint: 'A family owner or tree admin will review it. Other members of ' + famName() + ' can see suggestions.' }, async function (v) {
      if (v.length < 3) throw new Error('Please write a little more.');
      await api('suggestTreeChange', { familyId: S.familyId, text: v, personId: personId || undefined });
      S.tree = null; toast('Suggestion sent.');
    });
  }

  /* ---------- PROFILE ---------- */
  VIEWS.profile = async function (main, token, param, param2) {
    if (param === 'edit') return profileEdit(main, token, param2);
    var preview = param === 'preview';
    var uid = (!param || preview) ? S.user.$id : param;
    var own = uid === S.user.$id;
    if (Date.now() - S.profilesAt > 30000) await loadProfiles();
    if (token !== S.nav) return;
    var prof = S.profiles.get(uid);
    if (!prof) {
      main.appendChild(h('div', { class: 'empty' }, h('p', { text: 'That profile is not available in this family.' }), h('a', { class: 'btn', href: '#/settings/family', text: 'Back to Family' })));
      return;
    }
    var tree = null;
    try { tree = await loadTree(false); } catch (e) { tree = null; }
    if (token !== S.nav) return;
    var mine = own && !preview;
    main.appendChild(h('h1', { class: 'sr-only', text: own ? 'My profile' : prof.displayName + '’s profile' }));
    if (preview) {
      main.appendChild(h('div', { class: 'preview-bar', role: 'status' },
        h('span', null, h('strong', { text: 'Viewing as family. ' }), 'This is what other members of ' + famName() + ' see. Nothing here can be changed in this view.'),
        h('a', { class: 'btn small', href: '#/profile', text: 'Exit preview' })));
    }
    var top = h('div', { class: 'profile-top' });
    if (!own) top.appendChild(h('a', { class: 'link-btn back-btn', href: '#/settings/family', text: 'Family' }));
    top.appendChild(h('span', { class: 'grow' }));
    if (mine) {
      top.appendChild(h('a', { class: 'icon-btn', href: '#/profile/preview', 'aria-label': 'View as family', title: 'View as family' }, icon('eye')));
      top.appendChild(h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Settings', title: 'Settings' }, icon('gear')));
    }
    main.appendChild(top);
    main.appendChild(h('header', { class: 'profile-head' },
      h('div', { class: 'profile-avatar' }, avatarEl(prof, 'lg')),
      h('div', { class: 'profile-id' }, h('h2', { class: 'profile-name', text: prof.displayName }),
        prof.bio ? h('p', { class: 'profile-bio', text: prof.bio }) : (mine ? h('p', { class: 'muted small', text: 'No bio yet.' }) : null))));
    if (mine) main.appendChild(h('a', { class: 'btn secondary block', href: '#/profile/edit', text: 'Edit profile' }));
    if (mine) main.appendChild(h('a', { class: 'btn secondary block', href: '#/settings/privacy', text: 'My address (private)' }));
    if (mine && shopEnabled()) main.appendChild(h('a', { class: 'btn secondary block', href: '#/orders', text: 'My orders', onclick: function () { S.ordersFrom = '#/profile'; } }));
    if (!own && !preview) { var addrHolder = h('div'); main.appendChild(addrHolder); addressOnProfile(addrHolder, token, uid); }
    // Switching families (or starting another one) lives here, not in the top bar.
    if (mine) main.appendChild(h('section', { class: 'card profile-fam', 'aria-label': 'Family' }, h('h2', { text: 'Family' }), h('p', { class: 'muted small', text: 'You are in ' + famName() + '.' + (S.families.length > 1 || S.canCreateFamily ? ' Switch to another family, or start a new one:' : '') }), familySwitcher()));

    // About me
    var about = visibleAbout(prof);
    var sec = h('section', { class: 'card about', 'aria-label': 'About me' }, h('h2', { text: 'About me' }));
    if (!about.length) sec.appendChild(h('p', { class: 'muted', text: mine ? 'Add your favorite movies, colors, foods and more.' : firstName(prof) + ' has not added anything yet.' }));
    about.forEach(function (c) {
      sec.appendChild(h('h3', { text: c.title }));
      sec.appendChild(h('ul', { class: 'tags' }, c.items.map(function (i) { return h('li', { class: 'tag', text: i }); })));
    });
    if (mine) {
      sec.appendChild(h('button', { class: 'btn secondary block add-about', type: 'button', onclick: function () {
        pickPrompt(about.map(function (c) { return c.key; }), function (cat) { S.aboutPending = cat; location.hash = '#/profile/edit/about'; });
      } }, '+ Add something about me'));
      sec.appendChild(whoCanSee());
    } else if (preview) sec.appendChild(h('p', { class: 'hint', text: 'Only members of ' + famName() + ' can see this.' }));
    main.appendChild(sec);

    // Family tree connection (active family only)
    var box = h('section', { class: 'card', 'aria-label': 'Family tree' }, h('h2', { text: 'Family tree' }));
    var person = personFor(tree, uid);
    if (!tree) box.appendChild(h('p', { class: 'muted', text: 'The family tree is not set up yet.' }));
    else if (person) {
      box.appendChild(h('p', null, own ? 'You appear in the tree as ' : firstName(prof) + ' appears in the tree as ', h('strong', { text: person.name }), person.confirmed ? '.' : '. This link is waiting for confirmation.'));
      box.appendChild(h('a', { class: 'btn secondary', href: '#/tree/' + person.$id, text: 'View in family tree' }));
      if (mine && !person.confirmed) box.appendChild(confirmCard(person, function () { route(false); }));
    } else {
      box.appendChild(h('p', { class: 'muted', text: 'Not connected to this family’s tree yet.' }));
      if (!preview) {
        if (canEditTree()) {
          box.appendChild(h('button', { class: 'btn secondary', type: 'button', text: 'Add to the family tree', onclick: function (ev) {
            busy(ev.currentTarget, async function () {
              try { var r = await api('treeAddPerson', { familyId: S.familyId, name: prof.displayName, userId: uid }); S.tree = null; location.hash = '#/tree/' + r.personId; }
              catch (e) { toast(errText(e)); }
            });
          } }));
        } else {
          box.appendChild(h('button', { class: 'btn secondary', type: 'button', text: own ? 'Ask to be added to the tree' : 'Suggest connecting ' + firstName(prof), onclick: function () {
            sendSuggestion('', own ? 'Please add me to the family tree.' : 'Please connect ' + prof.displayName + ' to the family tree.');
          } }));
        }
      }
    }
    main.appendChild(box);
  };

  function confirmCard(person, after) {
    var msg = h('div');
    function answer(yes) {
      return async function (ev) {
        busy(ev.currentTarget, async function () {
          try { await api('treeConfirm', { familyId: S.familyId, personId: person.$id, confirm: yes }); S.tree = null; toast(yes ? 'Confirmed. Thank you.' : 'Unlinked.'); after(); }
          catch (e) { showAlert(msg, 'error', errText(e)); }
        });
      };
    }
    return h('div', { class: 'confirm-card', role: 'group', 'aria-label': 'Confirm your tree entry' },
      h('p', null, 'A family tree admin linked your account to ', h('strong', { text: person.name }), '. Is that you?'),
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', text: 'Yes, that’s me', onclick: answer(true) }),
        h('button', { class: 'btn secondary small', type: 'button', text: 'No, that’s not me', onclick: answer(false) })), msg);
  }

  async function profileEdit(main, token, focus) {
    main.appendChild(h('h1', { text: 'Edit profile' }));
    var fam = currentFamily(), fid = S.familyId;
    if (Date.now() - S.profilesAt > 30000) await loadProfiles();
    if (token !== S.nav) return;
    var name = field('displayName', 'Display name', 'text', { required: true, maxlength: 60, value: S.profile.displayName });
    var bio = h('textarea', { id: 'bio', rows: 3, maxlength: 200, 'aria-label': 'Bio', placeholder: 'A short line about you' });
    bio.value = S.profile.bio || '';
    var myTree = null; try { myTree = await loadTree(true); } catch (e) { myTree = null; }
    if (token !== S.nav) return;
    var meP = myTree ? personFor(myTree, S.user.$id) : null, savedMe = (S.user.prefs && S.user.prefs.aboutMe) || {};
    var bd0 = (meP && meP.birthday) || savedMe.birthday || '';
    var bdIn = h('input', { type: 'date', id: 'pe-bday' }); bdIn.value = String(bd0).length === 10 ? bd0 : '';
    var gen0 = (meP && meP.gender) || savedMe.gender || '';
    var genIn = h('select', { id: 'pe-gender' }, [['', 'Not set'], ['Female', 'Female'], ['Male', 'Male'], ['Nonbinary', 'Nonbinary'], ['Other', 'Other']].map(function (o) { return h('option', { value: o[0], text: o[1] }); })); genIn.value = gen0;
    var ageIn = h('input', { type: 'number', id: 'pe-age', min: 0, max: 120, placeholder: 'For example 34' });
    if (String(bd0).length === 4) ageIn.value = new Date().getFullYear() - Number(bd0);
    var addrIn = h('input', { type: 'text', id: 'pe-addr', maxlength: 120, autocomplete: 'street-address', placeholder: 'For example 12 Oak St, Valdosta GA' }); addrIn.value = addressOf(S.profile);
    var pmsg = h('div'), avatarBox = h('div', { class: 'row' });
    function paintAvatar() { clear(avatarBox); avatarBox.appendChild(avatarEl(S.profile, 'lg')); }
    paintAvatar();
    var file = h('input', { id: 'newAvatar', type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choose a new profile picture' });
    var saveBtn = h('button', { class: 'btn', type: 'submit', text: 'Save profile' });
    var removeAv = h('button', { class: 'btn secondary small', type: 'button', text: 'Remove picture' });
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
        paintAvatar(); toast('Picture updated.');
      } catch (e) {
        if (up) storage.deleteFile({ bucketId: CFG.bucketId, fileId: up.$id }).catch(function () {});
        showAlert(pmsg, 'error', errText(e));
      }
      file.value = '';
    });
    removeAv.addEventListener('click', function () {
      if (!S.profile.avatarFileId) return toast('You have no picture to remove.');
      busy(removeAv, async function () {
        try { await saveProfile({ avatarFileId: '' }); paintAvatar(); toast('Picture removed.'); }
        catch (e) { showAlert(pmsg, 'error', errText(e)); }
      });
    });
    var form = h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var n = name.input.value.trim();
      if (!n) return showAlert(pmsg, 'error', 'Your display name cannot be empty.');
      busy(saveBtn, async function () {
        try {
          var bv = bdIn.value || '';
          if (!bv && ageIn.value) { var ag = Math.floor(Number(ageIn.value)); if (!(ag >= 0 && ag <= 120)) throw new Error('Please enter an age between 0 and 120.'); bv = String(new Date().getFullYear() - ag); }
          await saveProfile({ displayName: n, bio: bio.value.trim() });
          if (bv !== String(bd0) || genIn.value !== gen0) {
            var gv = genIn.value;
            await api('saveMyPerson', { familyId: fid, name: (meP && meP.name) || savedMe.name || n, birthday: bv, gender: gv });
            S.user = await account.updatePrefs({ prefs: Object.assign({}, S.user.prefs || {}, { aboutMe: { name: (meP && meP.name) || savedMe.name || n, birthday: bv, gender: gv } }) });
            bd0 = bv; gen0 = gv; S.tree = null; await loadTree(true);
          }
          var av = addrIn.value.trim();
          if (av !== addressOf(S.profile)) {
            var rr = await api('saveAbout', { familyId: fid, about: visibleAbout(S.profile).concat(ringCat(S.profile), av ? [{ key: ADDR_KEY, title: 'Address', items: [av] }] : []) });
            S.profile = Object.assign({}, S.profile, { about: rr.about }); S.profiles.set(S.user.$id, S.profile);
          }
          showAlert(pmsg, 'ok', 'Saved.');
        }
        catch (e) { showAlert(pmsg, 'error', errText(e)); }
      }, 'Saving…');
    } }, name.wrap, h('div', null, h('label', { for: 'bio', text: 'Bio' }), bio, h('div', { class: 'hint', text: 'Up to 200 characters. Optional.' })),
      h('div', null, h('label', { for: 'pe-gender', text: 'Gender (optional)' }), genIn),
      h('div', null, h('label', { for: 'pe-bday', text: 'Birthday (optional)' }), bdIn, h('div', { class: 'hint', text: 'Shows in the family tree.' })),
      h('div', null, h('label', { for: 'pe-age', text: 'Or your age (if you would rather not share the birthday)' }), ageIn),
      h('div', null, h('label', { for: 'pe-addr', text: 'Address (optional)' }), addrIn, h('div', { class: 'hint', text: 'Family members can see this on the family tree. Leave it empty to keep it private.' })),
      pmsg, h('div', { class: 'stack' }, saveBtn));
    var ed = aboutEditor(visibleAbout(S.profile));
    if (S.aboutPending) { ed.addCategory(S.aboutPending); S.aboutPending = null; }
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Profile details' }, h('h2', { text: 'Profile' }),
      avatarBox,
      h('div', null, h('label', { for: 'newAvatar', text: 'Profile picture' }), file, h('div', { class: 'hint', text: 'Shrunk to a small square before upload. Optional.' })),
      h('div', { class: 'stack' }, removeAv), form));
    var aboutCard = h('section', { class: 'card', id: 'about-editor', 'aria-label': 'About me' }, h('h2', { text: 'About me' }),
      h('p', { class: 'small muted', text: 'Add as many categories as you like and several answers to each. All of it is optional.' }), ed.el, whoCanSee());
    main.appendChild(aboutCard);
    main.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn secondary', type: 'button', text: 'Done', onclick: async function () {
      if (ed.isDirty() && !(await confirmDialog('Leave without saving?', 'Your unsaved edits to About me will be lost.', 'Leave'))) return;
      location.hash = '#/profile';
    } })));
    if (focus === 'about') setTimeout(function () { aboutCard.scrollIntoView({ block: 'start' }); }, 50);
  }

  /* ---------- SETTINGS (opened from the gear on my profile) ---------- */
  var SETTING_SECTIONS = [
    { id: 'me', label: 'About you', note: 'Your name, birthday and gender' },
    { id: 'family', label: 'Family and members', note: 'Members, invites, tree admins, leave' },
    { id: 'tree', label: 'Family tree', note: 'Who\u2019s who: add people, links, suggestions' },
    { id: 'account', label: 'Account and security', note: 'Email, password' },
    { id: 'appearance', label: 'Appearance', note: 'Light or dark, style, accent color' },
    { id: 'storage', label: 'Storage and downloads', note: 'My uploads, family space, data use' },
    { id: 'privacy', label: 'Privacy and personal information', note: 'Your address, who can see what' }
  ];
  // Settings > About you: my own name, birthday and gender. Saved on my account too, so any family I join can use it.
  async function settingsAboutMe(main, token) {
    var box = h('section', { class: 'card', 'aria-label': 'About you' }, spinnerLine('Loading…'));
    main.appendChild(box);
    var tree;
    try { tree = await loadTree(true); } catch (e) { clear(box).appendChild(alertBox('error', friendly(e))); return; }
    if (token !== S.nav) return;
    var mine = personFor(tree, S.user.$id), saved = (S.user.prefs && S.user.prefs.aboutMe) || {};
    var prof = S.profile || {};
    var name = h('input', { type: 'text', id: 'me-name', maxlength: 80, autocomplete: 'name' }); name.value = (mine && mine.name) || saved.name || prof.displayName || '';
    var gen = h('select', { id: 'me-gender' }, [['', 'Not set'], ['Female', 'Female'], ['Male', 'Male'], ['Nonbinary', 'Nonbinary'], ['Other', 'Other']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    gen.value = (mine && mine.gender) || saved.gender || '';
    var bd0 = (mine && mine.birthday) || saved.birthday || '';
    var bday = h('input', { type: 'date', id: 'me-bday' }); bday.value = String(bd0).length === 10 ? bd0 : '';
    var age = h('input', { type: 'number', id: 'me-age', min: 0, max: 120, placeholder: 'For example 34' });
    if (String(bd0).length === 4) age.value = new Date().getFullYear() - Number(bd0);
    var msg = h('div'), save = h('button', { class: 'btn', type: 'submit', text: 'Save' });
    clear(box).appendChild(h('h2', { text: 'About you' }));
    box.appendChild(h('p', { class: 'muted small', text: 'This is how you appear in ' + famName() + '’s family tree. Relatives who add you later will use these details, so they do not have to guess. Everything here is optional except your name.' }));
    box.appendChild(h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      var n = name.value.trim(); if (!n) return showAlert(msg, 'error', 'Please enter your name.');
      var b = bday.value || '';
      if (!b && age.value) {
        var a = Math.floor(Number(age.value));
        if (!(a >= 0 && a <= 120)) return showAlert(msg, 'error', 'Please enter an age between 0 and 120.');
        b = String(new Date().getFullYear() - a);
      }
      busy(save, async function () {
        try {
          await api('saveMyPerson', { familyId: S.familyId, name: n, birthday: b, gender: gen.value });
          S.user = await account.updatePrefs({ prefs: Object.assign({}, S.user.prefs || {}, { aboutMe: { name: n, birthday: b, gender: gen.value } }) });
          S.tree = null; await loadTree(true);
          showAlert(msg, 'ok', 'Saved.');
        } catch (e) { showAlert(msg, 'error', errText(e)); }
      }, 'Saving…');
    } },
      h('div', null, h('label', { for: 'me-name', text: 'Your name' }), name),
      h('div', null, h('label', { for: 'me-gender', text: 'Gender (optional)' }), gen),
      h('div', null, h('label', { for: 'me-bday', text: 'Birthday (optional)' }), bday),
      h('div', null, h('label', { for: 'me-age', text: 'Or your age (if you would rather not share the birthday)' }), age),
      msg, h('div', { class: 'stack' }, save)));
    if (!mine) box.appendChild(h('p', { class: 'hint', text: 'You are not in the family tree yet. Saving adds you.' }));
  }

  VIEWS.settings = async function (main, token, section, p2, p3) {
    var sec = SETTING_SECTIONS.filter(function (s) { return s.id === section; })[0];
    if (!sec) {
      main.appendChild(h('p', null, h('a', { class: 'link-btn back-btn', href: '#/profile', text: 'Profile' })));
      main.appendChild(h('h1', { text: 'Settings' }));
      main.appendChild(h('div', { class: 'set-list' }, SETTING_SECTIONS.map(function (s) {
        return h('a', { class: 'set-row' + (s.id === 'appearance' ? ' set-glow' : ''), href: '#/settings/' + s.id }, h('span', null, h('strong', { text: s.label }), h('span', { class: 'small muted', text: s.note })), h('span', { 'aria-hidden': 'true', text: '›' }));
      })));
      main.appendChild(h('div', { class: 'stack' }, h('button', { class: 'btn danger block', type: 'button', text: 'Sign out', onclick: signOut })));
      return;
    }
    var fromProfile = /^#\/profile(\/edit)?\/?$/.test(S.settingsFrom || '');
    if (S.prevHash && !/^#\/settings/.test(S.prevHash)) S.settingsFrom = S.prevHash;
    else if (/^#\/settings\/?$/.test(S.prevHash || '')) S.settingsFrom = '';   // I came through the Settings list: back goes there
    fromProfile = /^#\/profile(\/edit)?\/?$/.test(S.settingsFrom || '');
    main.appendChild(h('p', null, fromProfile
      ? h('a', { class: 'link-btn back-btn', href: S.settingsFrom, text: /edit/.test(S.settingsFrom) ? 'Edit profile' : 'Profile' })
      : h('a', { class: 'link-btn back-btn', href: '#/settings', text: 'Settings' })));
    main.appendChild(h('h1', { text: sec.label }));
    if (sec.id === 'me') await settingsAboutMe(main, token);
    else if (sec.id === 'account') settingsAccount(main);
    else if (sec.id === 'family') await settingsFamilyHub(main, token, p2, p3);
    else if (sec.id === 'tree') { main.appendChild(h('p', { class: 'muted small' }, 'Adjust who is who here. To just look at the tree, use the ', h('a', { class: 'inline-btn', href: '#/tree', text: 'Family Tree' }), ' button in the bottom bar.')); main.appendChild(h('ul', { class: 'ring-key', 'aria-label': 'What the circle colors mean' },
        h('li', null, h('i', { class: 'k-rainbow' }), 'Rainbow: everyone'), h('li', null, h('i', { class: 'k-married' }), 'Gold: has a partner in the tree'), h('li', null, h('i', { class: 'k-grand' }), 'Double ring: grandparent'))); await familyTree(main, token, p2); }
    else if (sec.id === 'appearance') settingsAppearance(main);
    else if (sec.id === 'storage') await settingsStorage(main, token);
    else settingsPrivacy(main, token);
  };

  function settingsAccount(main) {
    var amsg = h('div');
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Account' },
      h('p', null, 'Signed in as ', h('strong', { text: S.user.email }), S.user.emailVerification ? ' (email verified)' : ' (email not verified)'),
      h('p', { class: 'hint', text: 'Only you see this. It is never shown to your family.' }),
      S.user.emailVerification ? null : h('div', { class: 'stack' }, resendVerificationButton()),
      h('div', { class: 'stack' }, h('button', { class: 'btn secondary', type: 'button', text: 'Email me a password reset link', onclick: function (ev) {
        busy(ev.currentTarget, async function () {
          try { await account.createRecovery({ email: S.user.email, url: baseUrl() + '?action=recover' }); showAlert(amsg, 'ok', 'Reset link sent. Check your inbox.'); }
          catch (e) { showAlert(amsg, 'error', friendly(e)); }
        });
      } })), amsg));
  }

  function settingsAppearance(main) {
    var look = h('section', { class: 'card', 'aria-label': 'Appearance' });
    main.appendChild(look);
    // ---- your circle: the example, then the buttons right under it. The tree sets gold (partner) and double ring (grandparent) by itself. ----
    var ringCard = h('section', { class: 'card', 'aria-label': 'Your circle' }, h('h2', { text: 'Your circle' }),
      h('p', { class: 'muted small', text: 'The circle around your profile picture is set by the family tree (gold when you have a partner, a double ring for a grandparent, rainbow for everyone else). Or choose your own two or three colors and the circle keeps the same flowing gradient look.' }));
    var saved = ringColorsOf(S.profile), mode = saved.length >= 2 ? 'custom' : 'auto', picks = saved.length >= 2 ? saved.slice() : ['#ff5ea8', '#7c4dff'];
    var stage = h('div', { class: 'ring-stage' }), ringMsg = h('div'), controls = h('div', { class: 'ring-controls' });
    function paintRing() {
      clear(stage);
      var auto = S.ringRole && S.ringRole.get(S.user.$id), av = avatarEl(Object.assign({}, S.profile, { about: '[]' }), 'lg'), wrap = h('div', { class: 'ring ring-preview' }, av);
      if (mode === 'custom') wrap.style.setProperty('--rb', ringStops(picks)); else if (auto) av.classList.add('ring-' + auto);
      stage.appendChild(h('div', { class: 'ring-sample' }, wrap, h('strong', { text: mode === 'custom' ? 'Your colors' : (auto === 'married' ? 'Gold (from the tree)' : auto === 'grand' ? 'Double ring (from the tree)' : 'Rainbow') })));
    }
    function paintControls() {
      clear(controls);
      controls.appendChild(h('div', { class: 'tabs', role: 'group', 'aria-label': 'Circle colors' },
        h('button', { class: 'tab', type: 'button', 'aria-pressed': mode === 'auto' ? 'true' : 'false', text: 'Automatic', onclick: async function (ev) {
          if (mode === 'auto' && !saved.length) return;
          mode = 'auto'; paintRing(); paintControls();
          if (saved.length) { try { await saveRing(null); saved = []; showAlert(ringMsg, 'ok', 'Back to the automatic circle.'); } catch (e) { showAlert(ringMsg, 'error', errText(e)); } }
        } }),
        h('button', { class: 'tab', type: 'button', 'aria-pressed': mode === 'custom' ? 'true' : 'false', text: 'My colors', onclick: function () { mode = 'custom'; paintRing(); paintControls(); } })));
      if (mode !== 'custom') return;
      var row = h('div', { class: 'ring-colors' });
      picks.forEach(function (c, i) {
        var inp = h('input', { type: 'color', 'aria-label': 'Circle color ' + (i + 1), value: c });
        inp.addEventListener('input', function () { picks[i] = inp.value.toLowerCase(); paintRing(); });
        row.appendChild(h('label', { class: 'ring-color' }, inp, h('span', { class: 'small', text: 'Color ' + (i + 1) })));
      });
      controls.appendChild(row);
      var more = h('div', { class: 'row' });
      if (picks.length < 3) more.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Add a third color', onclick: function () { picks.push('#22b8ff'); paintRing(); paintControls(); } }));
      if (picks.length > 2) more.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Remove third color', onclick: function () { picks.pop(); paintRing(); paintControls(); } }));
      var saveB = h('button', { class: 'btn', type: 'button', text: 'Save my circle' });
      saveB.addEventListener('click', function () { busy(saveB, async function () {
        try { await saveRing(picks.slice()); saved = picks.slice(); showAlert(ringMsg, 'ok', 'Saved. Your family sees this circle around your picture.'); } catch (e) { showAlert(ringMsg, 'error', errText(e)); }
      }, 'Saving…'); });
      more.appendChild(saveB); controls.appendChild(more);
    }
    async function saveRing(cols) {
      var list = visibleAbout(S.profile).concat(addrCat(S.profile)); if (cols) list = list.concat([{ key: RING_KEY, title: 'Circle colors', items: cols }]);
      var r = await api('saveAbout', { familyId: S.familyId, about: list });
      S.profile = Object.assign({}, S.profile, { about: r.about }); S.profiles.set(S.user.$id, S.profile); applyRingTheme();
    }
    paintRing(); paintControls();
    ringCard.appendChild(stage); ringCard.appendChild(controls); ringCard.appendChild(ringMsg);
    main.appendChild(ringCard);
    function paintLook() {
      clear(look);
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
      sw.appendChild(h('button', { class: 'swatch none', type: 'button', 'aria-label': 'Use the style’s own color', 'aria-pressed': prefs.accent ? 'false' : 'true', onclick: function () { prefs.accent = ''; savePrefs(); paintLook(); } }));
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
  }


  /* =====================================================================
   * OPTIONAL HOME ADDRESS
   * The address lives in its own table that no browser session can read; the family-api function is the only way in, and it checks
   * who is asking every time. Nothing here is saved in localStorage, sessionStorage or any cache. The text is only ever held in the
   * page while it is on screen. Google Maps is contacted only after a button tap, with a link built at that moment.
   * ===================================================================== */
  function addrOneLine(a) { return [a.line1, a.line2, a.city, a.region, a.postal, a.country].filter(function (x) { return x; }).join(', '); }
  function addrLines(a) { return [a.line1, a.line2, [a.city, a.region, a.postal].filter(Boolean).join(', '), a.country].filter(function (x) { return x; }); }
  function mapsUrl(kind, a) {
    var u = new URL(kind === 'dir' ? 'https://www.google.com/maps/dir/' : 'https://www.google.com/maps/search/');
    u.searchParams.set('api', '1');
    u.searchParams.set(kind === 'dir' ? 'destination' : 'query', addrOneLine(a));   // no origin for directions: Google Maps lets the person choose where they start
    return u.href;
  }
  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { 'aria-hidden': 'true', readonly: true, style: 'position:fixed;left:-9999px;top:0' }); ta.value = text; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; } document.body.removeChild(ta); return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    return Promise.resolve(fallback());
  }
  function addrMapButtons(a) {
    function go(kind) {
      var url = mapsUrl(kind, a);
      if (url.length > 2000) { toast('This address is too long for a Google Maps link. Use Copy address instead.'); return; }   // Google Maps URLs are limited to 2,048 characters
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return h('div', { class: 'addr-actions' },
      h('div', { class: 'row' },
        h('button', { class: 'btn secondary small', type: 'button', text: 'Open in Google Maps', onclick: function () { go('search'); } }),
        h('button', { class: 'btn secondary small', type: 'button', text: 'Get directions', onclick: function () { go('dir'); } }),
        h('button', { class: 'btn secondary small', type: 'button', text: 'Copy address', onclick: function () { copyText(addrOneLine(a)).then(function (ok) { toast(ok ? 'Address copied.' : 'Could not copy. Select the address and copy it by hand.'); }); } })),
      h('p', { class: 'small muted', text: 'Tapping Open in Google Maps or Get directions opens Google Maps in a new tab and sends this address to Google. Nothing is sent to Google until you tap. Family Circle never asks for or tracks your location, but Google Maps itself may offer to use your device location as the starting point for directions.' }));
  }
  function addrBlock(a) { return h('address', { class: 'addr-lines' }, addrLines(a).map(function (l) { return h('div', { text: l }); })); }

  /* Settings > Privacy and personal information: my own address */
  /* Optional address suggestions. Only while the person is typing in address line 1 on the address form, and only if the
     "Suggest matches" box is ticked, the text typed is sent to Photon (photon.komoot.io, a free OpenStreetMap search service).
     Nothing is sent when they stop typing, from other fields, or from any other screen. Our own server never sees it. */
  var NUMBER_AFTER = ['DE', 'AT', 'CH', 'NL', 'BE', 'ES', 'IT', 'PT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'SK', 'HU', 'GR', 'TR', 'BR', 'AR', 'CL', 'CO', 'RO', 'BG', 'HR', 'SI', 'RS'];
  function suggestLine1(p) {
    var street = p.street || (p.osm_key === 'highway' ? p.name : '') || '';
    if (!street) return p.name || '';
    if (!p.housenumber) return street;
    return NUMBER_AFTER.indexOf(String(p.countrycode || '').toUpperCase()) >= 0 ? street + ' ' + p.housenumber : p.housenumber + ' ' + street;
  }
  function attachAddressSuggest(ids, enabled) {
    var input = ids.line1, list = h('ul', { class: 'addr-suggest', id: 'addr-suggest', role: 'listbox', 'aria-label': 'Address suggestions', hidden: true });
    var timer = null, ctl = null, items = [], active = -1;
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', 'addr-suggest');
    input.parentNode.classList.add('addr-suggest-wrap'); input.parentNode.appendChild(list);
    function close() { list.hidden = true; clear(list); items = []; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function mark(i) {
      active = i;
      Array.prototype.forEach.call(list.children, function (li, k) { li.setAttribute('aria-selected', k === i ? 'true' : 'false'); li.classList.toggle('on', k === i); });
      if (i >= 0) input.setAttribute('aria-activedescendant', 'addr-sug-' + i); else input.removeAttribute('aria-activedescendant');
    }
    function pick(i) {
      var p = items[i]; if (!p) return;
      ids.line1.value = suggestLine1(p).slice(0, 200);
      ids.city.value = (p.city || p.town || p.village || p.district || '').slice(0, 120);
      ids.region.value = (p.state || '').slice(0, 120);
      ids.postal.value = (p.postcode || '').slice(0, 40);
      ids.country.value = (p.country || '').slice(0, 100);
      close(); ids.line1.focus();
    }
    function show(features) {
      clear(list); items = [];
      features.forEach(function (f) { if (f && f.properties && f.properties.country) items.push(f.properties); });
      items = items.slice(0, 5);
      if (!items.length) { close(); return; }
      items.forEach(function (p, i) {
        var sub = [p.city || p.town || p.village || p.district, p.state, p.postcode, p.country].filter(Boolean).join(', ');
        var li = h('li', { role: 'option', id: 'addr-sug-' + i, 'aria-selected': 'false' }, h('strong', { text: suggestLine1(p) || p.name || '' }), h('span', { class: 'small muted', text: ' ' + sub }));
        li.addEventListener('mousedown', function (ev) { ev.preventDefault(); pick(i); });
        list.appendChild(li);
      });
      list.hidden = false; input.setAttribute('aria-expanded', 'true'); mark(-1);
    }
    input.addEventListener('input', function () {
      clearTimeout(timer); if (ctl) ctl.abort();
      var q = input.value.trim();
      if (!enabled() || q.length < 5) { close(); return; }
      timer = setTimeout(async function () {
        ctl = new AbortController();
        try {
          var res = await fetch('https://photon.komoot.io/api/?limit=5&lang=en&q=' + encodeURIComponent(q), { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
          if (!res.ok) { close(); return; }
          var j = await res.json();
          if (input.value.trim() === q && enabled()) show(j.features || []);
        } catch (e) { close(); }
      }, 450);
    });
    input.addEventListener('keydown', function (ev) {
      if (list.hidden) return;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); mark((active + 1) % items.length); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); mark((active - 1 + items.length) % items.length); }
      else if (ev.key === 'Enter' && active >= 0) { ev.preventDefault(); pick(active); }
      else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
  }

  async function addressCard(main, token) {
    var box = h('section', { class: 'card addr-card', 'aria-label': 'My address' }, h('h2', { text: 'My address' }), spinnerLine('Loading…', 'profile'));
    main.appendChild(box);
    function shell() { clear(box); box.appendChild(h('h2', { text: 'My address' })); }
    function famNames(ids) { return ids.map(function (id) { var f = S.families.filter(function (x) { return x.id === id; })[0]; return f ? f.name : null; }).filter(Boolean); }
    async function load() {
      try {
        var r = await api('addressGet');
        if (token !== S.nav) return;
        if (r.address) showSaved(r.address); else showEmpty();
      } catch (e) {
        if (token !== S.nav) return;
        shell(); box.appendChild(alertBox('error', e && e.code === 403 ? 'You do not have access to this.' : friendly(e)));
        box.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Try again', onclick: function () { clear(box); box.appendChild(h('h2', { text: 'My address' })); box.appendChild(spinnerLine('Loading…', 'profile')); load(); } }));
      }
    }
    function showEmpty() {
      shell();
      box.appendChild(h('p', { text: 'You have not saved an address. This is optional, and nothing in Family Circle needs one.' }));
      box.appendChild(h('p', { class: 'small muted', text: 'If you add one, only you can see it unless you choose families to share it with.' }));
      box.appendChild(h('button', { class: 'btn', type: 'button', text: 'Add an address', onclick: function () { showForm(null); } }));
    }
    function showSaved(a) {
      shell();
      var names = famNames(a.sharedWith || []);
      box.appendChild(h('div', { class: 'addr-who', role: 'status' }, names.length
        ? h('span', null, h('strong', { text: 'Shared with family: ' }), names.join(', '), '. Members of ' + (names.length === 1 ? 'that family' : 'those families') + ' can see it on your profile. It is not public on the internet.')
        : h('span', null, h('strong', { text: 'Only me. ' }), 'Nobody else can see this address.')));
      box.appendChild(addrBlock(a));
      box.appendChild(addrMapButtons(a));
      box.appendChild(h('div', { class: 'row' },
        h('button', { class: 'btn secondary small', type: 'button', text: 'Edit address', onclick: function () { showForm(a); } }),
        h('button', { class: 'btn danger small', type: 'button', text: 'Delete saved address', onclick: async function (ev) {
          var ok = await confirmDialog('Delete your saved address?', 'This removes it from Family Circle and stops every family from seeing it. It cannot be undone. It does not remove delivery details that were kept separately for shop orders you already placed, and it cannot erase copies someone already made.', 'Delete address');
          if (!ok) return;
          await busy(ev.currentTarget, async function () { try { await api('addressDelete'); toast('Address deleted.'); showEmpty(); } catch (e) { toast(friendly(e)); } }, 'Deleting…');
        } })));
      box.appendChild(h('p', { class: 'small muted', text: 'Saving an address here does not give it to the shop, Printify or Square. In the shop you choose whether to use it for a delivery.' }));
    }
    function showForm(a) {
      shell();
      a = a || { line1: '', line2: '', city: '', region: '', postal: '', country: '', sharedWith: [] };
      var msg = h('div'), ids = {};
      function field(key, label, opts) {
        opts = opts || {};
        var id = 'addr-' + key;
        var inp = h('input', { type: 'text', id: id, maxlength: opts.max || 120, autocomplete: opts.ac || 'off', spellcheck: 'false', 'aria-required': opts.req ? 'true' : null });
        inp.value = a[key] || ''; ids[key] = inp;
        return h('div', { class: 'field' }, h('label', { for: id, text: label + (opts.req ? ' (required)' : ' (optional)') }), inp);
      }
      var form = h('form', { class: 'stack', novalidate: true });
      form.appendChild(field('line1', 'Address line 1', { req: true, max: 200, ac: 'address-line1' }));
      form.appendChild(field('line2', 'Apartment, unit or address line 2', { max: 200, ac: 'address-line2' }));
      form.appendChild(field('city', 'City or locality', { ac: 'address-level2' }));
      form.appendChild(field('region', 'State, province or region', { ac: 'address-level1' }));
      form.appendChild(field('postal', 'ZIP or postal code', { max: 40, ac: 'postal-code' }));
      form.appendChild(field('country', 'Country', { req: true, max: 100, ac: 'country-name' }));
      var sugBox = h('input', { type: 'checkbox', id: 'addr-suggest-on' }); sugBox.checked = true;
      form.appendChild(h('p', { class: 'hint', text: 'Use the format of your own country. Only address line 1 and country are needed. Start typing line 1 and pick a match to fill in the rest.' }));
      form.appendChild(h('div', { class: 'field' }, h('label', { class: 'check', for: 'addr-suggest-on' }, sugBox, ' Suggest matches as I type'),
        h('p', { class: 'small muted', text: 'When this is ticked, what you type in address line 1 is sent to Photon (photon.komoot.io), a free map search service based on OpenStreetMap, so it can suggest matches. It is not sent to Family Circle, and nothing is sent once you untick this or leave the form. Untick it to type your address without any lookup.' })));
      attachAddressSuggest(ids, function () { return sugBox.checked; });

      var mode = (a.sharedWith && a.sharedWith.length) ? 'families' : 'private';
      var picks = {};
      var famBox = h('fieldset', { class: 'addr-fams', hidden: mode !== 'families' }, h('legend', { text: 'Choose the families that can see it' }));
      S.families.forEach(function (f) {
        var cb = h('input', { type: 'checkbox', id: 'addr-fam-' + f.id }); cb.checked = (a.sharedWith || []).indexOf(f.id) >= 0; picks[f.id] = cb;
        famBox.appendChild(h('label', { class: 'check', for: 'addr-fam-' + f.id }, cb, ' ' + f.name));
      });
      famBox.appendChild(h('p', { class: 'small muted', text: 'Families you join later are not added automatically. Anyone you share with could copy or screenshot your address, and removing them later cannot erase copies they already made.' }));
      function radio(val, title, sub) {
        var r = h('input', { type: 'radio', name: 'addr-vis', id: 'addr-vis-' + val, value: val }); r.checked = mode === val;
        r.addEventListener('change', function () { mode = val; famBox.hidden = mode !== 'families'; });
        return h('label', { class: 'check addr-radio', for: 'addr-vis-' + val }, r, h('span', null, h('strong', { text: title }), h('span', { class: 'small muted', text: ' ' + sub })));
      }
      form.appendChild(h('fieldset', { class: 'addr-vis' }, h('legend', { text: 'Who can see this address?' }),
        radio('private', 'Only me', '(default) Nobody else can see it.'),
        radio('families', 'Share with selected families', 'Members of the families you tick. This is not public on the internet.')));
      form.appendChild(famBox);
      var save = h('button', { class: 'btn', type: 'submit', text: 'Save address' });
      form.appendChild(h('div', { class: 'row' }, save, h('button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: function () { if (a.line1) showSaved(a); else showEmpty(); } })));
      form.appendChild(msg);
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var data = {}; Object.keys(ids).forEach(function (k) { data[k] = ids[k].value; });
        if (!data.line1.trim()) { showAlert(msg, 'error', 'Enter address line 1, or cancel.'); ids.line1.focus(); return; }
        if (!data.country.trim()) { showAlert(msg, 'error', 'Enter the country.'); ids.country.focus(); return; }
        var chosen = Object.keys(picks).filter(function (id) { return picks[id].checked; });
        if (mode === 'families' && !chosen.length) { showAlert(msg, 'error', 'Tick at least one family, or choose Only me.'); return; }
        if (mode === 'families') {
          var go = await confirmDialog('Share your address?', 'Everyone in ' + famNames(chosen).join(', ') + ' will be able to see this address on your profile. They could copy or screenshot it, and stopping sharing later cannot erase copies they already made. It is not public on the internet.', 'Share it');
          if (!go) return;
        }
        await busy(save, async function () {
          try {
            var r = await api('addressSave', Object.assign({}, data, { visibility: mode, familyIds: mode === 'families' ? chosen : [], confirmShare: mode === 'families' ? true : undefined }));
            toast('Address saved.');
            showSaved(r.address);
          } catch (e) { showAlert(msg, 'error', friendly(e)); }
        }, 'Saving…');
      });
      box.appendChild(form);
      ids.line1.focus();
    }
    load();
  }

  /* On someone else's profile: appears only if the server says this viewer may see it. Otherwise nothing is drawn at all. */
  async function addressOnProfile(holder, token, userId) {
    try {
      var r = await api('addressView', { familyId: S.familyId, userId: userId });
      if (token !== S.nav || !r.address) return;
      holder.appendChild(h('section', { class: 'card addr-card', 'aria-label': 'Address' },
        h('h2', { text: 'Address' }),
        h('p', { class: 'small muted', text: 'Shared with ' + famName() + ' by its owner. Not public on the internet. Please be thoughtful with it.' }),
        addrBlock(r.address), addrMapButtons(r.address)));
    } catch (e) { /* no access, or not set up: show nothing */ }
  }

  function settingsPrivacy(main, token) {
    addressCard(main, token);
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Who can see what' },
      h('h2', { text: 'Who can see what' }),
      h('ul', { class: 'plain' },
        h('li', { text: 'Posts, comments, your profile, About me and the family tree are visible only to members of the family they belong to. Nothing is public.' }),
        h('li', { text: 'Your profile is separate in each family. Each family only sees the one you made there.' }),
        h('li', { text: 'Your email address and account settings are visible only to you.' }),
        h('li', { text: 'A home address is optional. It is visible only to you unless you pick families to share it with, and it is kept apart from your profile.' }),
        h('li', { text: 'Your saved posts and library names are visible only to you.' }),
        h('li', { text: 'No ads, no trackers, no face recognition or AI photo processing.' })),
      h('p', { class: 'small muted', text: 'Anyone who can see a photo could still take a screenshot or share it, so share thoughtfully.' })));
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Your data' },
      h('h2', { text: 'Your data' }),
      h('p', { text: 'You can delete your own posts, comments and uploads at any time (see Storage and downloads). Leaving a family, or deleting one you own, is under Settings → Family and members.' }),
      h('p', { class: 'small muted', text: 'Exporting a copy of your data is not available yet.' })));
  }

  async function settingsStorage(main, token) {
    // 1. Data use (a setting that lives on this device)
    var autoBox = h('input', { type: 'checkbox', id: 'autoplay' });
    autoBox.checked = autoplayOn();
    autoBox.addEventListener('change', function () {
      try { localStorage.setItem('fc_autoplay', autoBox.checked ? 'on' : 'off'); } catch (e) { /* the switch still works until the page reloads */ }
      toast(autoBox.checked ? 'Shorts will play by themselves.' : 'Shorts will wait for you to tap play.');
    });
    var keepBox = h('input', { type: 'checkbox', id: 'keepmedia' }); keepBox.checked = keepOn();
    var keepInfo = h('p', { class: 'small muted', text: 'Checking what is saved on this device…' });
    var clearKept = h('button', { class: 'btn secondary small', type: 'button', text: 'Clear saved photos and videos', onclick: async function () { await mediaCacheClear(); toast('Cleared from this device.'); paintKept(); } });
    async function paintKept() {
      var info = await mediaCacheInfo();
      keepInfo.textContent = info.count ? info.count + (info.count === 1 ? ' photo or video' : ' photos and videos') + ' saved on this device, using ' + fmtBytes(info.bytes) + ' of up to ' + fmtBytes(cacheCapBytes()) + '. Your browser decides if it needs the room back.' : 'Nothing is saved on this device right now. Limit: ' + fmtBytes(cacheCapBytes()) + '.';
      clearKept.disabled = !info.count;
    }
    keepBox.addEventListener('change', async function () {
      try { localStorage.setItem('fc_keepmedia', keepBox.checked ? 'on' : 'off'); } catch (e) {}
      if (!keepBox.checked) await mediaCacheClear();
      toast(keepBox.checked ? 'Videos and photos will be kept on this device.' : 'Nothing will be kept on this device, and the saved copies were removed.'); paintKept();
    });
    paintKept();
    main.appendChild(h('section', { class: 'card', 'aria-label': 'On this device' },
      h('h2', { text: 'On this device' }),
      h('p', { text: 'After you watch a video or look at a photo, Family Circle keeps a copy on this device so it does not download again every time. The copy lives in this browser only and is removed when you sign out. Only the oldest copies are removed when the limit below is reached. Nothing in the cloud is ever deleted by this.' }),
      h('p', { class: 'small muted', text: 'This website cannot see or delete files in your phone’s Downloads folder or photo library.' }),
      h('label', { class: 'switch-row', for: 'keepmedia' }, keepBox, h('span', null, h('strong', { text: 'Keep videos and photos on this device' }), h('span', { class: 'small muted', text: ' Turn this off if your phone is short on space.' }))),
      keepInfo, clearKept,
      h('label', { class: 'switch-row', for: 'autoplay' }, autoBox, h('span', null, h('strong', { text: 'Autoplay Shorts' }), h('span', { class: 'small muted', text: ' Every Short you scroll to downloads in full. That uses mobile data and counts toward the site’s monthly download allowance, so turn this off when you are not on Wi-Fi. Saved on this device only.' })))));

    // Captions: show or hide them everywhere, and remove the speech model that was downloaded to make them
    var ccBox = h('input', { type: 'checkbox', id: 'cc-show' }); ccBox.checked = ccOn();
    ccBox.addEventListener('change', function () {
      try { localStorage.setItem('fc_cc', ccBox.checked ? 'on' : 'off'); } catch (e) {}
      toast(ccBox.checked ? 'Captions are on.' : 'Captions are off. You can turn them back on here or with the CC button on a video.');
    });
    var modelInfoP = h('p', { class: 'small muted', text: 'Checking…' });
    var modelBtn = h('button', { class: 'btn secondary small', type: 'button', text: 'Remove the downloaded speech model', onclick: async function (ev) {
      if (!window.confirm('Remove the speech model from this device? Captions already saved on posts keep working. Making new captions will download it again (about 80 MB).')) return;
      ev.currentTarget.disabled = true;
      try { await window.Captions.removeModel(); toast('Speech model removed from this device.'); } catch (e) { toast('Could not remove it. Try clearing this site’s data in your browser settings.'); }
      paintModel();
    } });
    async function paintModel() {
      var i = window.Captions && window.Captions.modelInfo ? await window.Captions.modelInfo() : { files: 0, bytes: 0 };
      modelInfoP.textContent = i.files ? 'The speech model is on this device, using ' + fmtBytes(i.bytes) + '. It is only needed to make new captions.' : 'No speech model is stored on this device.';
      modelBtn.disabled = !i.files;
    }
    paintModel();
    main.appendChild(h('section', { class: 'card', 'aria-label': 'Captions' },
      h('h2', { text: 'Captions' }),
      h('label', { class: 'switch-row', for: 'cc-show' }, ccBox, h('span', null, h('strong', { text: 'Show captions on videos' }), h('span', { class: 'small muted', text: ' Turn off to hide captions everywhere. Each video also has a CC button.' }))),
      h('p', { class: 'small muted', text: 'Captions are made on your phone with a speech model that downloads the first time. It is stored in this browser only, never in the family’s cloud.' }),
      modelInfoP, modelBtn));

    // 2. My uploads in the cloud
    var upBox = h('section', { class: 'card', 'aria-label': 'My uploads' }, h('h2', { text: 'My photos and videos in the cloud' }), spinnerLine('Loading your uploads…', 'photo'));
    var famBox = h('section', { class: 'card', 'aria-label': 'Family space' }, h('h2', { text: 'Shared family space' }));
    main.appendChild(upBox); main.appendChild(famBox);
    var famUse = h('div'); famBox.appendChild(famUse);

    async function loadUploads() {
      var posts;
      try { posts = await listAllRows('posts', [Query.equal('familyId', [S.familyId]), Query.equal('authorId', [S.user.$id]), Query.orderDesc('$createdAt')], 300); }
      catch (e) { clear(upBox); upBox.appendChild(h('h2', { text: 'My photos and videos in the cloud' })); upBox.appendChild(alertBox('error', friendly(e))); return; }
      if (token !== S.nav) return;
      var media = posts.filter(function (p) { return p.mediaFileId; });
      var total = media.reduce(function (a, p) { return a + (p.mediaSize || 0); }, 0);
      clear(upBox);
      upBox.appendChild(h('h2', { text: 'My photos and videos in the cloud' }));
      famUse.setAttribute('data-mine', String(total));
      if (!media.length) { upBox.appendChild(h('p', { class: 'muted', text: 'You have not shared any photos or videos in ' + famName() + '.' })); paintFamily(total); return; }
      upBox.appendChild(h('p', { text: media.length + (media.length === 1 ? ' upload' : ' uploads') + ', ' + fmtBytes(total) + ' in ' + famName() + '. Your small profile picture is not counted.' }));
      upBox.appendChild(h('p', { class: 'hint', text: 'Deleting an upload removes the whole post from the family feed for everyone, with its comments, likes and saves, and permanently deletes the file. You can only delete your own.' }));
      var checks = [], listEl = h('div', { class: 'upload-list' });
      media.forEach(function (p) {
        var cb = h('input', { type: 'checkbox', 'aria-label': 'Select this ' + p.kind + ' from ' + new Date(p.$createdAt).toLocaleDateString() });
        checks.push({ cb: cb, post: p });
        listEl.appendChild(h('label', { class: 'upload-row' }, cb,
          h('span', { class: 'grow' }, h('strong', { text: { photo: 'Photo', video: 'Video', short: 'Short' }[p.kind] || 'Post' }), ' ', h('span', { class: 'small muted', text: new Date(p.$createdAt).toLocaleDateString() + ' · ' + fmtBytes(p.mediaSize || 0) }),
            p.body ? h('span', { class: 'small upload-cap', text: String(p.body).slice(0, 80) }) : null),
          h('a', { class: 'link-btn small', href: '#/post/' + p.$id, text: 'View' })));
      });
      var delBtn = h('button', { class: 'btn danger', type: 'button', text: 'Delete selected', disabled: true });
      var all = h('button', { class: 'btn secondary small', type: 'button', text: 'Select all' });
      function count() { return checks.filter(function (c) { return c.cb.checked; }).length; }
      function sync() { var n = count(); delBtn.disabled = !n; delBtn.textContent = n ? 'Delete selected (' + n + ')' : 'Delete selected'; }
      checks.forEach(function (c) { c.cb.addEventListener('change', sync); });
      all.addEventListener('click', function () { var every = count() === checks.length; checks.forEach(function (c) { c.cb.checked = !every; }); all.textContent = every ? 'Select all' : 'Select none'; sync(); });
      var umsg = h('div');
      delBtn.addEventListener('click', async function () {
        var chosen = checks.filter(function (c) { return c.cb.checked; }).map(function (c) { return c.post; });
        if (!chosen.length) return;
        var bytes = chosen.reduce(function (a, p) { return a + (p.mediaSize || 0); }, 0);
        var ok = await confirmDialog('Permanently delete ' + chosen.length + (chosen.length === 1 ? ' upload?' : ' uploads?'),
          'This removes ' + (chosen.length === 1 ? 'the post' : 'these posts') + ' from the family feed for everyone in ' + famName() + ', along with their comments, likes and saves, and permanently deletes the ' + fmtBytes(bytes) + ' of files. It cannot be undone.', 'Delete permanently');
        if (!ok) return;
        delBtn.disabled = true; var failed = 0, n = 0;
        for (var i = 0; i < chosen.length; i++) {
          showAlert(umsg, 'ok', 'Deleting ' + (i + 1) + ' of ' + chosen.length + '…');
          try {
            var done = false, tries = 0;
            while (!done && tries++ < 20) { done = (await api('deletePost', { familyId: S.familyId, postId: chosen[i].$id })).done; }
            if (!done) throw new Error('slow'); S.saved.delete(chosen[i].$id); n++;
          } catch (e) { failed++; }
        }
        S.usage = null; S.nav++; // refresh this screen with real numbers
        toast(n + (n === 1 ? ' upload deleted.' : ' uploads deleted.') + (failed ? ' ' + failed + ' could not be deleted. Try again.' : ''));
        route(false);
      });
      upBox.appendChild(h('div', { class: 'row' }, all)); upBox.appendChild(listEl); upBox.appendChild(umsg); upBox.appendChild(h('div', { class: 'stack' }, delBtn));
      paintFamily(total);
    }
    async function paintFamily(mine) {
      clear(famUse); 
      var u;
      try { u = await getUsage(true); } catch (e) { famUse.appendChild(h('p', { class: 'muted', text: 'The family’s total could not be loaded right now.' })); return; }
      var pct = Math.min(100, Math.round(u.usedBytes * 100 / Math.max(1, u.limitBytes)));
      famUse.appendChild(h('p', { text: 'Everyone in ' + famName() + ' has used ' + fmtBytes(u.usedBytes) + ' of ' + fmtBytes(u.limitBytes) + '.' }));
      famUse.appendChild(h('progress', { class: 'meter', max: 100, value: pct, 'aria-label': 'Family storage used: ' + pct + ' percent' }));
      famUse.appendChild(h('p', { class: 'small muted', text: 'About ' + fmtBytes(mine) + ' of that is yours. Every member can see this total, and nobody else’s uploads.' }));
      famUse.appendChild(h('p', { class: 'hint', text: 'Nothing is deleted automatically. If the space fills up, new photos and videos pause and everything already shared stays.' }));
      if (S.isOwner) famUse.appendChild(h('p', { class: 'small muted', text: 'As a family owner you can also remove another member’s post from that post’s own menu. It is labeled “Remove this post as family admin” and is separate from your own uploads here.' }));
    }
    await loadUploads();
  }

  /* ---------- FAMILY TREE ---------- */
  async function familyTree(main, token, focusId) {
    var box = h('div', { class: 'tree-box' }, spinnerLine('Loading the family tree…', 'tree'));
    main.appendChild(box);
    async function draw(focus, force) {
      var tree;
      try { tree = await loadTree(force); }
      catch (e) { clear(box).appendChild(alertBox('error', e && e.code === 404 ? 'The family tree needs one more setup step: create the people and suggestions tables (see the Setup Guide).' : friendly(e))); return; }
      if (token !== S.nav) return;
      paint(tree, focus);
    }
    function paint(tree, focus) {
      clear(box);
      var edit = canEditTree(), me = S.user.$id, people = tree.people;
      box.appendChild(h('p', { class: 'hint', text: 'This tree is private to ' + famName() + '. ' + (edit ? 'You can change it because you are an owner or tree admin.' : 'A family owner or tree admin keeps it up to date. You can suggest a correction on anyone.') + ' People in the tree are separate from sign-in accounts: someone does not need an account to be in it, and a relationship never gives anyone app admin rights.' }));
      people.filter(function (p) { return p.userId === me && !p.confirmed; }).forEach(function (p) { box.appendChild(h('div', { class: 'card' }, confirmCard(p, function () { draw(p.$id, true); }))); });
      var bar = h('div', { class: 'row' });
      if (edit) bar.appendChild(h('button', { class: 'btn small', type: 'button', text: '+ Add a person', onclick: function () { personDialog(null, tree, function (id) { draw(id, true); }); } }));
      bar.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: 'Suggest a change', onclick: function () { sendSuggestion('').then(function (ok) { if (ok) draw(focus, true); }); } }));
      box.appendChild(bar);

      var byId = {}; people.forEach(function (p) { byId[p.$id] = p; });
      var kids = {};
      people.forEach(function (p) { (p.parentIds || []).forEach(function (pid) { if (byId[pid]) (kids[pid] = kids[pid] || []).push(p.$id); }); });
      function hasParents(p) { return (p.parentIds || []).some(function (x) { return byId[x]; }); }
      var rendered = {};
      function card(p) {
        var partners = (p.partnerIds || []).map(function (x) { return byId[x]; }).filter(Boolean);
        var prof = p.userId ? S.profiles.get(p.userId) : null;
        var el = h('div', { class: 'tnode', 'data-person': p.$id, tabindex: '-1' },
          avatarEl(prof || { displayName: p.name }),
          h('div', { class: 'grow' }, h('strong', { text: p.name }),
            partners.length ? h('div', { class: 'small muted', text: 'Partner: ' + partners.map(function (x) { return x.name; }).join(', ') }) : null,
            detailLine(p) ? h('div', { class: 'small muted', text: detailLine(p) }) : null,
            p.userId ? h('div', { class: 'small muted', text: p.confirmed ? 'Member of this family' : 'Waiting for them to confirm' }) : null,
            (edit && people.length > 1 && !hasParents(p) && !partners.length && !(kids[p.$id] || []).length) ? h('div', { class: 'small', text: 'Not connected to anyone yet. Tap Edit to choose their parents or partner.' }) : null),
          h('div', { class: 'tnode-actions' },
            prof ? h('a', { class: 'link-btn small', href: '#/profile/' + p.userId, text: 'Profile' }) : null,
            (!p.userId && S.isOwner && !p.inviteMembershipId) ? h('button', { class: 'link-btn small', type: 'button', text: 'Invite', 'aria-label': 'Invite ' + p.name + ' by email', onclick: function () { inviteTreePerson(p); } }) : null,
            (!p.userId && p.inviteMembershipId) ? h('span', { class: 'small muted', text: 'Invitation sent' }) : null,
            (edit || p.userId === me) ? h('button', { class: 'link-btn small', type: 'button', text: 'Edit', 'aria-label': 'Edit ' + p.name, onclick: function () { personDialog(p, tree, function (id) { draw(id, true); }); } })
                 : h('button', { class: 'link-btn small', type: 'button', text: 'Suggest', 'aria-label': 'Suggest a change about ' + p.name, onclick: function () { sendSuggestion(p.$id).then(function (ok) { if (ok) draw(p.$id, true); }); } })));
        return el;
      }
      function node(p, depth) {
        rendered[p.$id] = true;
        var partners = (p.partnerIds || []).map(function (x) { return byId[x]; }).filter(Boolean);
        var inline = partners.filter(function (x) { return !hasParents(x) && !rendered[x.$id]; });
        inline.forEach(function (x) { rendered[x.$id] = true; });
        var couple = h('div', { class: 'couple' }, card(p));
        inline.forEach(function (x) { couple.appendChild(card(x)); });
        var li = h('li'); li.appendChild(couple);
        var ids = [];
        [p].concat(partners).forEach(function (x) { (kids[x.$id] || []).forEach(function (c) { if (ids.indexOf(c) < 0 && !rendered[c]) ids.push(c); }); });
        if (ids.length && depth < 40) li.appendChild(h('ul', { class: 'tree' }, ids.filter(function (c) { return !rendered[c]; }).map(function (c) { return node(byId[c], depth + 1); })));
        return li;
      }
      if (!people.length) {
        box.appendChild(h('div', { class: 'empty' }, h('p', { text: 'No one is in the family tree yet.' }), edit ? h('p', { class: 'muted small', text: 'Use “Add a person” to start with the oldest generation you know.' }) : h('p', { class: 'muted small', text: 'Ask an owner or tree admin to start it, or send a suggestion.' })));
      } else {
        var ul = h('ul', { class: 'tree root' });
        people.slice().sort(function (a, b) { return new Date(a.$createdAt) - new Date(b.$createdAt); }).forEach(function (p) { if (!hasParents(p) && !rendered[p.$id]) ul.appendChild(node(p, 0)); });
        people.forEach(function (p) { if (!rendered[p.$id]) ul.appendChild(node(p, 0)); });
        box.appendChild(h('div', { class: 'tree-scroll' }, ul));
      }
      // suggestions
      var open = tree.suggestions.filter(function (s) { return s.status === 'open' && (edit || s.authorId === me); });
      if (open.length) {
        var sbox = h('section', { class: 'card', 'aria-label': 'Suggestions' }, h('h2', { text: edit ? 'Suggestions to review' : 'Your open suggestions' }));
        open.forEach(function (s) {
          var who = S.profiles.get(s.authorId), p = s.personId ? byId[s.personId] : null;
          sbox.appendChild(h('div', { class: 'sug' }, h('div', { class: 'small muted', text: (who ? who.displayName : 'A member') + (p ? ' · about ' + p.name : '') }), h('p', { text: s.text }),
            edit ? h('div', { class: 'row' },
              h('button', { class: 'btn small', type: 'button', text: 'Mark done', onclick: function (ev) { resolve(ev, s, 'done'); } }),
              h('button', { class: 'btn secondary small', type: 'button', text: 'Dismiss', onclick: function (ev) { resolve(ev, s, 'dismissed'); } })) : null));
        });
        box.appendChild(sbox);
      }
      if (focus) {
        var el = box.querySelector('[data-person="' + focus + '"]');
        if (el) { el.classList.add('hl'); el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); }
      }
    }
    function resolve(ev, s, status) {
      busy(ev.currentTarget, async function () {
        try { await api('resolveSuggestion', { familyId: S.familyId, suggestionId: s.$id, status: status }); draw(null, true); }
        catch (e) { toast(errText(e)); }
      });
    }
    await draw(focusId, true);
  }

  // Add or edit one person. Only owners and tree admins ever see this; the server checks again.
  function personDialog(p, tree, done, preset) {
    var dlg = h('dialog', { 'aria-labelledby': 'dlg-title' });
    function close() { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); }
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    var name = h('input', { type: 'text', maxlength: 80, 'aria-label': 'Name', id: 'pname' });
    name.value = p ? p.name : '';
    var meId = S.user.$id, isSelf = !!(p && p.userId === meId), admin = canEditTree();
    var locked = !!(p && p.userId && p.confirmed && !isSelf);   // after they accept, their name, gender and birthday are theirs alone
    if (locked) name.disabled = true;
    var bd = h('input', { type: 'date', id: 'pbday', 'aria-label': 'Birthday' }); bd.value = p && p.birthday && String(p.birthday).length === 10 ? p.birthday : '';
    var gd = h('select', { id: 'pgender', 'aria-label': 'Gender' }, [['', 'Not set'], ['Female', 'Female'], ['Male', 'Male'], ['Nonbinary', 'Nonbinary'], ['Other', 'Other']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    gd.value = p ? (p.gender || '') : '';
    if (locked) { bd.disabled = true; gd.disabled = true; }
    function select(id, label, options, value) {
      var sel = h('select', { id: id, 'aria-label': label }, options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      sel.value = value || ''; return h('div', null, h('label', { for: id, text: label }), sel);
    }
    var others = tree.people.filter(function (x) { return !p || x.$id !== p.$id; });
    var linked = {}; tree.people.forEach(function (x) { if (x.userId && (!p || x.$id !== p.$id)) linked[x.userId] = true; });
    var memberOpts = [['', 'Not linked to an account']];
    var seenM = {};
    S.profiles.forEach(function (pr) { if (!linked[pr.userId]) { seenM[pr.userId] = 1; memberOpts.push([pr.userId, pr.displayName]); } });
    (S.memberList || []).forEach(function (m) {   // joined but no profile yet: still a member
      if (linked[m.userId] || seenM[m.userId] || (p && p.userId === m.userId)) return;
      var inv = tree.people.filter(function (x) { return x.inviteMembershipId === m.$id; })[0];
      memberOpts.push([m.userId, m.userName || (m.userId === S.user.$id ? ((S.user.name || 'Me') + ' (you)') : ((inv && inv.name) || 'Member without a name yet'))]);
    });
    var known = {}; tree.people.forEach(function (x) { known[x.$id] = true; });
    var par = p ? (p.parentIds || []).filter(function (x) { return known[x]; }) : [], prt = p ? (p.partnerIds || []).filter(function (x) { return known[x]; }) : [];
    var curKinds = p ? kindsOf(p) : {};
    var s4 = select('link', 'Linked family member', memberOpts, p ? p.userId : '');
    var presetOn = !p && preset && preset.of;
    var existSel = null;
    if (presetOn) {
      var exOpts = [['', 'Add someone new']].concat(tree.people.filter(function (x) { return x.$id !== preset.of.$id; }).map(function (x) { return [x.$id, x.name]; }));
      existSel = select('existing', 'Or choose someone already in the tree', exOpts, '');
      existSel.querySelector('select').addEventListener('change', function () {
        var on = !!existSel.querySelector('select').value;
        [].slice.call(dlg.querySelectorAll('.new-only')).forEach(function (el) { el.hidden = on; });
        save.textContent = on ? 'Connect' : 'Add person';
      });
    }
    if (!p) s4.querySelector('select').addEventListener('change', function (ev) {
      var pr = S.profiles.get(ev.target.value); if (!pr) { var mo = memberOpts.filter(function (o) { return o[0] === ev.target.value; })[0]; if (mo && mo[1] !== 'Family member' && !name.value) name.value = mo[1]; } if (pr) { name.value = pr.displayName; if (pr.gender && !gd.value) gd.value = pr.gender; }
    });
    var KIND_ORDER = ['birth', 'adoptive', 'step', 'foster', 'guardian'];
    var MAX_PARENTS = 6, MAX_PARTNERS = 8;
    var parentRows = h('div', { class: 'stack parent-rows' }), partnerRows = h('div', { class: 'stack partner-rows' });
    var addParentBtn, addPartnerBtn;
    function personPick(value, label) {
      var sel = h('select', { 'aria-label': label }, [h('option', { value: '', text: 'Choose someone…' })].concat(others.map(function (x) { return h('option', { value: x.$id, text: x.name }); })));
      sel.value = value || ''; return sel;
    }
    function sync() {
      if (addParentBtn) addParentBtn.disabled = parentRows.children.length >= MAX_PARENTS;
      if (addPartnerBtn) addPartnerBtn.disabled = partnerRows.children.length >= MAX_PARTNERS;
    }
    function addParentRow(id, kind) {
      var ps = personPick(id, 'Parent'), ks = h('select', { 'aria-label': 'How is this parent related?' }, KIND_ORDER.map(function (k) { return h('option', { value: k, text: KIND_LABEL[k] }); }));
      ks.value = kind || 'birth';
      var row = h('div', { class: 'row' }, h('div', { class: 'grow' }, ps), h('div', null, ks),
        h('button', { class: 'btn secondary small', type: 'button', text: 'Remove', 'aria-label': 'Remove this parent', onclick: function () { row.parentNode.removeChild(row); sync(); } }));
      row._id = ps; row._kind = ks; parentRows.appendChild(row); sync();
    }
    function addPartnerRow(id) {
      var ps = personPick(id, 'Partner');
      var row = h('div', { class: 'row' }, h('div', { class: 'grow' }, ps),
        h('button', { class: 'btn secondary small', type: 'button', text: 'Remove', 'aria-label': 'Remove this partner', onclick: function () { row.parentNode.removeChild(row); sync(); } }));
      row._id = ps; partnerRows.appendChild(row); sync();
    }
    var noOthers = !others.length;
    addParentBtn = h('button', { class: 'btn secondary small', type: 'button', text: '+ Add a parent', onclick: function () { addParentRow('', 'birth'); } });
    addPartnerBtn = h('button', { class: 'btn secondary small', type: 'button', text: '+ Add a partner', onclick: function () { addPartnerRow(''); } });
    par.forEach(function (id) { addParentRow(id, curKinds[id] || 'birth'); });
    prt.forEach(function (id) { addPartnerRow(id); });

    var msg = h('div'), save = h('button', { class: 'btn', type: 'submit', text: p ? 'Save' : 'Add person' });
    var cancel = h('button', { class: 'btn secondary', type: 'button', text: 'Cancel', onclick: close });
    var remove = p ? h('button', { class: 'btn danger', type: 'button', text: 'Delete from tree', onclick: async function () {
      if (!(await confirmDialog('Remove ' + p.name + ' from the tree?', 'This removes the tree entry and its links to other people. It does not delete their account, posts or profile.', 'Remove'))) return;
      try { await api('treeDeletePerson', { familyId: S.familyId, personId: p.$id }); close(); toast('Removed from the tree.'); done(null); } catch (e) { showAlert(msg, 'error', errText(e)); }
    } }) : null;
    dlg.appendChild(h('form', { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      if (presetOn && existSel.querySelector('select').value) {
        var exId = existSel.querySelector('select').value;
        return busy(save, async function () {
          try { await api('treeLinkRelative', { familyId: S.familyId, personId: exId, relation: preset.relation, relationOf: preset.of.$id }); close(); toast('Connected.'); done(exId); }
          catch (e) { showAlert(msg, 'error', errText(e)); }
        }, 'Connecting…');
      }
      var n = name.value.trim();
      if (!n) return showAlert(msg, 'error', 'Please enter a name.');
      var v = function (id) { return dlg.querySelector('#' + id).value; };
      var parentList = [].slice.call(parentRows.children).map(function (r) { return { id: r._id.value, kind: r._kind.value }; }).filter(function (x) { return x.id; });
      var parents = parentList.map(function (x) { return x.id; });
      var partnerList = [].slice.call(partnerRows.children).map(function (r) { return r._id.value; }).filter(Boolean);
      if (parents.some(function (x, i) { return parents.indexOf(x) !== i; })) return showAlert(msg, 'error', 'Each parent can only be listed once.');
      if (partnerList.some(function (x, i) { return partnerList.indexOf(x) !== i; })) return showAlert(msg, 'error', 'Each partner can only be listed once.');
      if (parents.some(function (x) { return partnerList.indexOf(x) !== -1; })) return showAlert(msg, 'error', 'A parent cannot also be this person\u2019s partner.');
      var kindsObj = {}; parentList.forEach(function (x) { if (x.kind !== 'birth') kindsObj[x.id] = x.kind; });
      var kindsKey = function (o) { return JSON.stringify(Object.keys(o).sort().map(function (k) { return [k, o[k]]; })); };
      var origKinds = {}; par.forEach(function (id) { if (curKinds[id] && curKinds[id] !== 'birth') origKinds[id] = curKinds[id]; });
      busy(save, async function () {
        try {
          var payload = { familyId: S.familyId, name: n };
          if (admin && !isSelf) payload.userId = v('link');
          if (!locked) { payload.birthday = bd.value || (p && p.birthday && String(p.birthday).length === 4 ? p.birthday : ''); payload.gender = gd.value; }
          if (presetOn) { payload.relation = preset.relation; payload.relationOf = preset.of.$id; }
          else {
          if (!p || parents.join(',') !== par.join(',')) payload.parentIds = parents;
          if (p ? kindsKey(kindsObj) !== kindsKey(origKinds) : Object.keys(kindsObj).length) payload.parentKinds = kindsObj;
          if (!p || partnerList.slice().sort().join(',') !== prt.slice().sort().join(',')) payload.partnerIds = partnerList;
          }
          var id;
          if (p) { payload.personId = p.$id; await api('treeEditPerson', payload); id = p.$id; }
          else {
            id = (await api('treeAddPerson', payload)).personId;
          }
          close(); toast('Saved.'); done(id);
        } catch (e) { showAlert(msg, 'error', errText(e)); }
      }, 'Saving…');
    } }, h('h2', { id: 'dlg-title', text: p ? 'Edit ' + p.name : (preset && preset.of ? 'Add ' + ({ parent: 'a parent', child: 'a child', partner: 'a partner', sibling: 'a sibling' }[preset.relation] || 'a relative') + ' of ' + preset.of.name : 'Add a person') }),
      presetOn ? existSel : null,
      (!p && admin) ? h('div', { class: 'pick-member new-only' }, s4,
        memberOpts.length > 1 ? ((preset && preset.lite) ? null : h('p', { class: 'hint', text: 'Pick someone who has already joined the family, or leave this and type a name below for a relative who has not joined.' }))
          : (preset && preset.lite) ? h('p', { class: 'hint' }, 'No one else has joined yet. Invite people in ', h('a', { href: '#/settings/family', onclick: function () { close(); }, text: 'Settings' }), '. You can still type a name below.')
          : h('p', { class: 'hint' }, 'No one else has joined the family yet. To add someone who can sign in, go to ', h('a', { href: '#/settings/family', onclick: function () { close(); }, text: 'Settings, Family' }), ' and invite them. You can still type a name below for a relative who is not on the app.')) : null,
      h('div', { class: 'new-only' }, h('label', { for: 'pname', text: 'Name' }), name),
      h('div', { class: 'new-only' }, h('label', { for: 'pgender', text: 'Gender' }), gd),
      h('div', { class: 'new-only' }, h('label', { for: 'pbday', text: 'Birthday' }), bd),
      locked ? h('p', { class: 'hint', text: 'Only ' + p.name + ' can change their name, gender and birthday, because it is their account.' }) : null,
      (noOthers && !presetOn) ? h('p', { class: 'hint', text: 'No one else is in the tree yet. Add the first person, then add others.' }) : null,
      presetOn ? null : h('div', null, h('strong', { text: 'Parents' }), parentRows, addParentBtn,
        h('p', { class: 'hint', text: 'List everyone who is a parent to this person, and say how: birth, adoptive, step, foster or guardian. The tree can draw two parents at a time, so the tree page lets you switch between birth parents and the parents who raised them.' })),
      presetOn ? null : h('div', null, h('strong', { text: 'Partners' }), partnerRows, addPartnerBtn,
        h('p', { class: 'hint', text: 'A person can have more than one partner, for example a current and a former one.' })),
      (admin && !isSelf && p) ? s4 : null,
      (preset && preset.lite) ? null : h('p', { class: 'hint', text: 'Linking a member lets them confirm “this is me”. The tree entry and their sign-in account stay separate.' }),
      msg, h('div', { class: 'row' }, cancel, save), (remove && admin) ? h('div', { class: 'stack' }, remove) : null));
    document.body.appendChild(dlg); dlg.showModal(); name.focus();
  }

  /* =====================================================================
   * 13. START-UP
   * ===================================================================== */

  async function boot() {
    applyPrefs();
    var maint = await maintenanceFlag();
    if (maint) {
      maintenanceScreen(maint.message);
      var timer = setInterval(async function () { if (!(await maintenanceFlag())) { clearInterval(timer); location.reload(); } }, 15000);
      return;
    }
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
    if (window.FCChat) window.FCChat.install({ S: S, VIEWS: VIEWS, CFG: CFG, h: h, clear: clear, icon: icon, toast: toast, spinnerLine: spinnerLine, alertBox: alertBox, showAlert: showAlert, busy: busy, friendly: friendly,
      textDialog: textDialog, confirmDialog: confirmDialog, api: api, famName: famName, route: route, switchFamily: switchFamily, avatarEl: avatarEl, db: db, client: client, teams: teams, Query: Query,
      avatarUrl: avatarUrl,
      uploadPicture: async function (file) { var f = await imageToJpegFile(file, L.avatarEdge || 256, 0.85, true, 'family.jpg'); var up = await uploadFile(f); return up.$id; },
      deletePicture: function (id) { return storage.deleteFile({ bucketId: CFG.bucketId, fileId: id }).catch(function () {}); } });
    if (window.FCShop) window.FCShop.install({ S: S, VIEWS: VIEWS, CFG: CFG, h: h, clear: clear, icon: icon, toast: toast, spinnerLine: spinnerLine, alertBox: alertBox, showAlert: showAlert, busy: busy, friendly: friendly,
      textDialog: textDialog, confirmDialog: confirmDialog, api: api, famName: famName, listRows: listRows, fetchMedia: fetchMedia, blobUrl: blobUrl, getJwt: getJwt, route: route,
      functions: functions, storage: storage, Query: Query, ID: ID, Permission: Permission, Role: Role });
    var action = readActionParams();
    if (action) await handleAction(action);
    await loadSession();
    window.addEventListener('hashchange', function () { route(false); });
    setInterval(function () { if (!document.hidden) refreshBadge(true); }, 90000);
    render();
  }

  boot().catch(function (e) {
    screenMessage('Something went wrong', [friendly(e)], h('button', { class: 'btn', type: 'button', text: 'Reload', onclick: function () { location.reload(); } }));
  });
})();

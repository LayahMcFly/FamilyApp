/* Family Circle: theme.js (appearance engine, v1.51)
 *
 * Three SEPARATE settings make up a person's appearance:
 *   theme   which component design is used (default, bubbly, cartoon, classic, cozy)
 *   mode    light, dark or system (follow the device)
 *   accent  one colour from the theme's own curated list (or a custom colour)
 * Mode and accent are remembered PER THEME, so Bubbly can be Dark/Purple while Cozy stays Light/Sage.
 *
 * The file is loaded in <head> after the stylesheets and runs at once, so the page paints in the right theme the first time.
 * It is also used by app.js (Appearance screen). To add a theme: add it to THEMES, add its accents to ACCENTS and its
 * "surfaces" below, then add a block for it in themes.css (see MAINTENANCE-GUIDE.md).
 */
(function () {
  'use strict';
  var KEY = 'fc_appearance_v2';          // local cache: non-sensitive look settings only, tagged with the account it belongs to
  var OLD_KEY = 'fc_appearance';         // the pre-1.51 key (mode / preset / accent)
  var MODES = ['system', 'light', 'dark'];

  var THEMES = [
    { id: 'default', name: 'Default', note: 'The familiar FamilyCircle look', def: { mode: 'system', accent: '' } },
    { id: 'bubbly', name: 'Bubbly', note: 'Soft, round and playful', def: { mode: 'light', accent: '#8b5cf6' } },
    { id: 'cartoon', name: 'Cartoon', note: 'Bold outlines and sticker shadows', def: { mode: 'light', accent: '#e8472b' } },
    { id: 'classic', name: 'Classic Social', note: 'Familiar, tidy and structured', def: { mode: 'light', accent: '#1b6fe0' } },
    { id: 'cozy', name: 'Cozy', note: 'Warm, calm and welcoming', def: { mode: 'light', accent: '#587a5f' } }
  ];

  // Curated accents per theme (light-mode values; dark mode lightens them automatically until they are easy to see).
  var ACCENTS = {
    'default': [{ name: 'Blue', hex: '#2563eb' }, { name: 'Teal', hex: '#0f766e' }, { name: 'Green', hex: '#15803d' }, { name: 'Amber', hex: '#b45309' }, { name: 'Rose', hex: '#be185d' }, { name: 'Purple', hex: '#7c3aed' }, { name: 'Slate', hex: '#475569' }],
    bubbly: [{ name: 'Lavender', hex: '#8b5cf6' }, { name: 'Bubblegum', hex: '#db2777' }, { name: 'Sky', hex: '#0284c7' }, { name: 'Mint', hex: '#0d9488' }, { name: 'Peach', hex: '#c2410c' }, { name: 'Grape', hex: '#6d28d9' }],
    cartoon: [{ name: 'Tomato', hex: '#e8472b' }, { name: 'Sunny', hex: '#f5b700' }, { name: 'Lavender', hex: '#8b5cf6' }, { name: 'Mint', hex: '#16a34a' }, { name: 'Sky', hex: '#0ea5e9' }, { name: 'Pink', hex: '#ec4899' }],
    classic: [{ name: 'Blue', hex: '#1b6fe0' }, { name: 'Teal', hex: '#0f766e' }, { name: 'Green', hex: '#2e7d32' }, { name: 'Orange', hex: '#c2570c' }, { name: 'Purple', hex: '#6d28d9' }, { name: 'Slate', hex: '#475569' }],
    cozy: [{ name: 'Sage', hex: '#587a5f' }, { name: 'Terracotta', hex: '#b4573a' }, { name: 'Muted rose', hex: '#a85a6e' }, { name: 'Honey', hex: '#9a6a12' }, { name: 'Dusty blue', hex: '#4d6f8f' }, { name: 'Plum', hex: '#7a4f7a' }]
  };

  // Page and card colours per theme (must match the tokens in themes.css / styles.css). Used to pick readable text colours.
  var SURF = {
    'default': { light: { bg: '#ffffff', surface: '#ffffff' }, dark: { bg: '#0c1014', surface: '#0c1014' } },
    bubbly: { light: { bg: '#f7f2ff', surface: '#ffffff', s2: '#efe6ff', bd: '#e0d2f7' }, dark: { bg: '#1b1530', surface: '#261e42', s2: '#31275a', bd: '#46397a' } },
    cartoon: { light: { bg: '#fff4d6', surface: '#ffffff', s2: '#ffe08a' }, dark: { bg: '#1a1633', surface: '#2a2550', s2: '#3b3470' } },
    classic: { light: { bg: '#f0f2f5', surface: '#ffffff', s2: '#e4e6eb', bd: '#ced0d4' }, dark: { bg: '#18191a', surface: '#242526', s2: '#3a3b3c', bd: '#3e4042' } },
    cozy: { light: { bg: '#f6efe3', surface: '#fffaf0', s2: '#efe4d0', bd: '#dccdb2' }, dark: { bg: '#1f1a16', surface: '#2a2420', s2: '#352d27', bd: '#4a3f35' } }
  };

  function themeOf(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return null; }
  function isHex(x) { return typeof x === 'string' && /^#[0-9a-fA-F]{6}$/.test(x); }

  /* ---------- colour maths ---------- */
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
  /** Colours for one accent in one mode: the fill (buttons), the text that sits on the fill, and accent-coloured text on the page. */
  function accentColors(hex, dark, surf) {
    var fill = hex.toLowerCase(), n = 0;
    if (dark) while (contrast(fill, surf.bg) < 3 && n++ < 14) fill = mix(fill, '#ffffff', 0.1);          // buttons stay visible against dark pages
    var on = contrast(fill, '#ffffff') >= contrast(fill, '#000000') ? '#ffffff' : '#000000';
    var text = fill; n = 0;
    while (contrast(text, surf.surface) < 4.5 && n++ < 24) text = mix(text, dark ? '#ffffff' : '#000000', 0.1);   // links and active labels reach 4.5:1
    return { fill: fill, on: on, text: text };
  }

  /* ---------- state ---------- */
  // { v:2, theme:'cozy', per:{ cozy:{ mode:'dark', accent:'#587a5f' } }, at: 1731430000000 }
  function sanitize(p) {
    var out = { v: 2, theme: 'default', per: {}, at: 0 };
    if (!p || typeof p !== 'object') return out;
    if (p.v === 2) {
      if (themeOf(p.theme)) out.theme = p.theme;               // a theme that no longer exists falls back to Default
      THEMES.forEach(function (t) {
        var s = p.per && p.per[t.id]; if (!s || typeof s !== 'object') return;
        var e = {}; if (MODES.indexOf(s.mode) >= 0) e.mode = s.mode; if (s.accent === '' || isHex(s.accent)) e.accent = (s.accent || '').toLowerCase();
        if (e.mode || 'accent' in e) out.per[t.id] = e;
      });
      out.at = Number(p.at) > 0 ? Number(p.at) : 0;
    } else if (p.mode || p.preset || p.accent) {                 // pre-1.51 settings move into Default, so nobody loses their light/dark and accent choice
      out.per['default'] = { mode: MODES.indexOf(p.mode) >= 0 ? p.mode : 'system', accent: isHex(p.accent) ? p.accent.toLowerCase() : '' };
    }
    return out;
  }
  /** What is in effect for the chosen theme: saved choice, else the theme's curated defaults. */
  function effective(state, themeId) {
    var t = themeOf(themeId || state.theme) || THEMES[0], s = (state.per && state.per[t.id]) || {};
    return { theme: t.id, mode: s.mode || t.def.mode, accent: 'accent' in s ? s.accent : t.def.accent };
  }
  function isDark(mode) { return mode === 'dark' || (mode === 'system' && !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)); }
  var VARS = ['--accent', '--accent-text', '--on-accent', '--bg', '--surface', '--surface-2', '--border'];
  function apply(eff) {
    var el = document.documentElement, dark = isDark(eff.mode), surf = (SURF[eff.theme] || SURF['default'])[dark ? 'dark' : 'light'];
    el.setAttribute('data-style', eff.theme);
    el.setAttribute('data-theme', dark ? 'dark' : 'light');      // always a resolved value; the saved choice (system) is in data-mode
    el.setAttribute('data-mode', eff.mode);
    el.removeAttribute('data-preset');
    VARS.forEach(function (v) { el.style.removeProperty(v); });
    if (!eff.accent) return;
    if (eff.theme === 'default' && !dark) {                      // Default, light: the page takes a light tint of the accent (as before)
      el.style.setProperty('--bg', mix(eff.accent, '#ffffff', 0.86)); el.style.setProperty('--surface', mix(eff.accent, '#ffffff', 0.86));
      el.style.setProperty('--surface-2', mix(eff.accent, '#ffffff', 0.74)); el.style.setProperty('--border', mix(eff.accent, '#ffffff', 0.58));
      surf = { bg: mix(eff.accent, '#ffffff', 0.86), surface: mix(eff.accent, '#ffffff', 0.86) };
    }
    else if (eff.theme !== 'default' && surf.s2) {                // other themes: the chosen accent also tints the page, like Default does (outlines in Cartoon stay ink)
      var tb = dark ? 0.14 : 0.14, ts = dark ? 0.10 : 0.05;
      var nb = mix(surf.bg, eff.accent, tb), ns = mix(surf.surface, eff.accent, ts);
      el.style.setProperty('--bg', nb); el.style.setProperty('--surface', ns); el.style.setProperty('--surface-2', mix(surf.s2, eff.accent, 0.08));
      if (surf.bd) el.style.setProperty('--border', mix(surf.bd, eff.accent, 0.16));
      surf = { bg: nb, surface: ns };
    }
    var c = accentColors(eff.accent, dark, surf);
    el.style.setProperty('--accent', c.fill); el.style.setProperty('--accent-text', c.text); el.style.setProperty('--on-accent', c.on);
  }
  function summary(eff) {
    var t = themeOf(eff.theme) || THEMES[0], m = eff.mode === 'system' ? 'Follow system' : eff.mode === 'dark' ? 'Dark' : 'Light', a = '';
    if (!eff.accent) a = 'Style color';
    else { var list = ACCENTS[eff.theme] || []; a = 'Custom'; for (var i = 0; i < list.length; i++) if (list[i].hex === eff.accent) a = list[i].name; }
    return t.name + ' · ' + m + ' · ' + a;
  }

  /* ---------- local cache (non-sensitive: theme names, modes and colours only) ---------- */
  function readLocal() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var o = JSON.parse(raw); var st = sanitize(o && o.state); return { uid: (o && o.uid) || '', state: st }; }
      var old = localStorage.getItem(OLD_KEY);                   // pre-1.51 copy: no account tag, so it can be adopted by the first account that signs in
      if (old) return { uid: '', state: sanitize(JSON.parse(old)), legacy: true };
    } catch (e) { /* storage blocked: fine, the account copy still works */ }
    return { uid: '', state: sanitize() };
  }
  function writeLocal(uid, state) { try { localStorage.setItem(KEY, JSON.stringify({ uid: uid || '', state: state })); localStorage.removeItem(OLD_KEY); } catch (e) { /* ignore */ } }
  function clearLocal() { try { localStorage.removeItem(KEY); localStorage.removeItem(OLD_KEY); } catch (e) { /* ignore */ } }

  /** Decide which copy wins when someone signs in. Rules are listed in MAINTENANCE-GUIDE.md ("Appearance: local vs account"). */
  function reconcile(uid, accountRaw) {
    var loc = readLocal(), acc = accountRaw ? sanitize(accountRaw) : null, mine = loc.uid === uid ? loc.state : null;
    if (acc && mine) return mine.at > acc.at ? { state: mine, pushToAccount: true } : { state: acc, pushToAccount: false };
    if (acc) return { state: acc, pushToAccount: false };            // another account's local copy is ignored: nothing leaks between accounts
    if (mine) return { state: mine, pushToAccount: true };
    if (loc.legacy && !loc.uid) return { state: loc.state, pushToAccount: true };   // first sign-in after the update on a device that had old settings
    return { state: sanitize(), pushToAccount: false };
  }

  var api = { THEMES: THEMES, ACCENTS: ACCENTS, MODES: MODES, themeOf: themeOf, sanitize: sanitize, effective: effective, apply: apply, summary: summary, isDark: isDark,
    accentColors: accentColors, contrast: contrast, readLocal: readLocal, writeLocal: writeLocal, clearLocal: clearLocal, reconcile: reconcile, surfaces: SURF };
  window.FCTheme = api;

  // First paint: apply what this device last used (before any account is known).
  var first = readLocal();
  try { apply(effective(first.state)); } catch (e) { /* the stylesheet defaults stay */ }
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)'), onMq = function () { if (api.onSystemChange) api.onSystemChange(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq);
  }
})();

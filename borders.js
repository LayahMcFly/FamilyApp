/* Button borders for personal profile pages.
 * A catalog of border styles (Normal, Cute, Ornate / Vintage), the code that draws them, and the gallery picker.
 * Simple borders are plain CSS (see "Button borders" in chat.css). Decorated ones are small original SVG frames built here,
 * cut into nine pieces (4 corners + 4 sides) so the decoration stays in the border band and never covers the button's text.
 * Only stable ids and a few validated numbers are stored; nothing here ever stores or runs user supplied HTML or CSS. */
(function () {
  'use strict';
  var SIZES = { 1: 18, 2: 24, 3: 32 };   // border band width in px for Small / Medium / Large decorations
  var CATS = [{ id: 'normal', title: 'Normal' }, { id: 'cute', title: 'Cute' }, { id: 'ornate', title: 'Ornate / Vintage' }];
  function W(def, min, max) { return { def: def, min: min, max: max }; }
  // color: '' = follows the theme text colour, null = no colour setting, '#hex' = the starting colour. w = thickness limits. size = decoration size applies.
  var STYLES = [
    { id: 'none', name: 'None', cat: 'normal', kind: 'css', color: null, w: null, size: false },
    { id: 'classic', name: 'Classic', cat: 'normal', kind: 'css', color: '', w: W(2, 1, 6), size: false },
    { id: 'bold', name: 'Bold', cat: 'normal', kind: 'css', color: '', w: W(4, 3, 6), size: false },
    { id: 'double', name: 'Double', cat: 'normal', kind: 'css', color: '', w: W(5, 3, 6), size: false },
    { id: 'dashed', name: 'Dashed', cat: 'normal', kind: 'css', color: '', w: W(2, 1, 6), size: false },
    { id: 'dotted', name: 'Dotted', cat: 'normal', kind: 'css', color: '', w: W(3, 2, 6), size: false },
    { id: 'inset', name: 'Inset', cat: 'normal', kind: 'css', color: '', w: W(3, 1, 6), size: false },
    { id: 'beveled', name: 'Beveled', cat: 'normal', kind: 'css', color: '#b9b2a5', w: W(4, 2, 6), size: false },
    { id: 'gradient', name: 'Gradient', cat: 'normal', kind: 'css', color: null, w: W(3, 1, 6), size: false },
    { id: 'scallop', name: 'Scallop', cat: 'cute', kind: 'svg', color: '#f0a3b6', w: null, size: true },
    { id: 'hearts', name: 'Hearts', cat: 'cute', kind: 'svg', color: '#e88fb0', w: null, size: true },
    { id: 'stars', name: 'Stars', cat: 'cute', kind: 'svg', color: '#e9bf5e', w: null, size: true },
    { id: 'flowers', name: 'Flowers', cat: 'cute', kind: 'svg', color: '#e58aaf', w: null, size: true },
    { id: 'ribbon', name: 'Ribbon', cat: 'cute', kind: 'svg', color: '#7fa3d6', w: null, size: true },
    { id: 'clouds', name: 'Clouds', cat: 'cute', kind: 'svg', color: '#8fb3e0', w: null, size: true },
    { id: 'stitched', name: 'Stitched', cat: 'cute', kind: 'css', color: '#6bb3a0', w: W(3, 2, 6), size: false },
    { id: 'pearls', name: 'Pearls', cat: 'cute', kind: 'svg', color: null, w: null, size: true },
    { id: 'sparkles', name: 'Sparkles', cat: 'cute', kind: 'svg', color: '#b79ae0', w: null, size: true },
    { id: 'lace', name: 'Scalloped lace', cat: 'ornate', kind: 'svg', color: '#c9a46a', w: null, size: true },
    { id: 'floral', name: 'Embroidered floral trim', cat: 'ornate', kind: 'svg', color: '#6f9bd8', w: null, size: true },
    { id: 'rope', name: 'Braided gold', cat: 'ornate', kind: 'svg', color: '#b8893a', w: null, size: true },
    { id: 'crochet', name: 'Crochet loops', cat: 'ornate', kind: 'svg', color: '#b79ae0', w: null, size: true },
    { id: 'fringe', name: 'Delicate fringe', cat: 'ornate', kind: 'svg', color: '#c8b48a', w: null, size: true },
    { id: 'scroll', name: 'Ornamental scrollwork', cat: 'ornate', kind: 'svg', color: '#7b2332', w: null, size: true }
  ];
  var BY = {}; STYLES.forEach(function (s) { BY[s.id] = s; });
  var HEX = /^#[0-9a-fA-F]{6}$/;

  /* ---------- colours ---------- */
  function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  function mix(hex, other, t) { var a = rgb(hex), b = rgb(other), o = '#', i, v; for (i = 0; i < 3; i++) { v = Math.round(a[i] + (b[i] - a[i]) * t); o += (v < 16 ? '0' : '') + v.toString(16); } return o; }
  function tint(hex, t) { return mix(hex, '#ffffff', t); }
  function shade(hex, t) { return mix(hex, '#000000', t); }

  /* ---------- the saved choice: { id, c, w, s } <-> "btn:", "btnc:", "btnw:", "btns:" items ---------- */
  function clamp(n, lo, hi) { n = Math.round(Number(n)); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; }
  function defaults(style) { return { id: style.id, c: style.color || '', w: style.w ? style.w.def : 0, s: 2 }; }
  function read(st) {   // st is the page style object; returns a checked choice or null (no choice = the normal buttons)
    var s = st && BY[st.btn]; if (!s) return null;
    var cfg = defaults(s);
    if (s.color !== null && HEX.test(st.btnc || '')) cfg.c = st.btnc.toLowerCase();
    if (s.w) { var w = clamp(st.btnw, s.w.min, s.w.max); if (w !== null) cfg.w = w; }
    if (s.size) { var z = clamp(st.btns, 1, 3); if (z !== null) cfg.s = z; }
    return cfg;
  }
  function write(st, cfg) {   // puts the choice into the page style object (removing the old one first)
    delete st.btn; delete st.btnc; delete st.btnw; delete st.btns;
    var s = cfg && BY[cfg.id]; if (!s) return st;
    var d = defaults(s); st.btn = s.id;
    if (s.color !== null && HEX.test(cfg.c || '') && cfg.c.toLowerCase() !== d.c) st.btnc = cfg.c.toLowerCase();
    if (s.w && cfg.w !== d.w) { var w = clamp(cfg.w, s.w.min, s.w.max); if (w !== null && w !== d.w) st.btnw = String(w); }
    if (s.size && cfg.s !== 2) { var z = clamp(cfg.s, 1, 3); if (z !== null && z !== 2) st.btns = String(z); }
    return st;
  }

  /* ---------- the original decorations (SVG) ---------- */
  var CL = 13;   // the line the small shapes sit on, in a 30 x 30 corner piece
  function along(r, degs, fn) { var o = '', i, t; for (i = 0; i < degs.length; i++) { t = degs[i] * Math.PI / 180; o += fn((30 - r * Math.cos(t)).toFixed(2), (30 - r * Math.sin(t)).toFixed(2), i); } return o; }
  function rep(n, f) { var o = '', k; for (k = 0; k < n; k++) o += f(k); return o; }
  function heart(x, y, fill, sc) { return '<path transform="translate(' + x + ' ' + y + ') scale(' + sc + ')" d="M0 4.2C-7 -0.6 -4.6 -6.4 0 -3.4C4.6 -6.4 7 -0.6 0 4.2Z" fill="' + fill + '"/>'; }
  function star(x, y, fill, r) { var p = [], i, rr, a; for (i = 0; i < 10; i++) { rr = i % 2 ? r * 0.45 : r; a = -Math.PI / 2 + i * Math.PI / 5; p.push((Number(x) + rr * Math.cos(a)).toFixed(2) + ' ' + (Number(y) + rr * Math.sin(a)).toFixed(2)); } return '<path d="M' + p.join('L') + 'Z" fill="' + fill + '"/>'; }
  function sparkle(x, y, r, fill) { var k = r * 0.22; x = Number(x); y = Number(y); return '<path d="M' + x + ' ' + (y - r) + 'L' + (x + k) + ' ' + (y - k) + 'L' + (x + r) + ' ' + y + 'L' + (x + k) + ' ' + (y + k) + 'L' + x + ' ' + (y + r) + 'L' + (x - k) + ' ' + (y + k) + 'L' + (x - r) + ' ' + y + 'L' + (x - k) + ' ' + (y - k) + 'Z" fill="' + fill + '"/>'; }
  function flower(cx, cy, petal, rr) { rr = rr || 1; cx = Number(cx); cy = Number(cy); return rep(5, function (k) { var a = k * 1.2566; return '<circle cx="' + (cx + 3.3 * rr * Math.cos(a)).toFixed(2) + '" cy="' + (cy + 3.3 * rr * Math.sin(a)).toFixed(2) + '" r="' + (2.7 * rr).toFixed(2) + '" fill="' + petal + '"/>'; }) + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (2 * rr).toFixed(2) + '" fill="#f0c24b"/>'; }
  function leaf(x, y, rot) { return '<ellipse cx="' + x + '" cy="' + y + '" rx="3.4" ry="1.5" fill="#7fa06a" transform="rotate(' + rot + ' ' + x + ' ' + y + ')"/>'; }
  var SC = 'a7.5 7.5 0 0 1 15 0a7.5 7.5 0 0 1 15 0';   // two scallops across the 30 wide side piece
  function circles(fill, stroke, w) { var c = [[9, 9, 9], [22.5, 7.5, 7.5], [7.5, 22.5, 7.5]], o = '', k; for (k = 0; k < c.length; k++) o += '<circle cx="' + c[k][0] + '" cy="' + c[k][1] + '" r="' + c[k][2] + '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' + w + '"' : '') + ' fill="' + fill + '"/>'; return o; }
  function frameOf(id, c1) {   // returns { E: side piece, C: corner piece, B: optional bottom side piece, T: optional top-right corner }
    var E = '', C = '', B = null, T = null, c2, lil = '#b79ae0', cream = '#f6ecd6';
    if (id === 'scallop') {
      c2 = tint(c1, 0.5);
      E = '<path fill="' + c1 + '" d="M30 30V9' + SC + 'V30z"/><path fill="' + c2 + '" d="M30 30V13a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0V30z"/><path d="M30 24H60" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" fill="none"/>';
      C = '<g fill="' + c1 + '"><circle cx="9" cy="9" r="9"/><circle cx="22.5" cy="7.5" r="7.5"/><circle cx="7.5" cy="22.5" r="7.5"/><rect x="8" y="8" width="22" height="22"/></g><g fill="' + c2 + '"><circle cx="10" cy="10" r="5.5"/><circle cx="22.5" cy="12" r="5"/><circle cx="12" cy="22.5" r="5"/><rect x="12" y="12" width="18" height="18"/></g><path d="M30 24H24V30" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" fill="none"/>';
    } else if (id === 'hearts') {
      E = '<path d="M30 24H60" stroke="' + c1 + '" stroke-opacity=".55" stroke-width="1" fill="none"/>' + heart(37.5, CL, c1, 1) + heart(52.5, CL, lil, 1);
      C = '<path d="M30 24H24V30" stroke="' + c1 + '" stroke-opacity=".55" stroke-width="1" fill="none"/>' + along(17, [20, 45, 70], function (x, y, i) { return heart(x, y, i % 2 ? lil : c1, 1); });
    } else if (id === 'stars') {
      var pal = [c1, '#8fb8d8', '#9cc3a8'];
      E = star(37.5, CL, pal[0], 5.8) + star(52.5, CL, pal[1], 5.8);
      C = along(17, [20, 45, 70], function (x, y, i) { return star(x, y, pal[(i + 1) % 3], 5.8); });
    } else if (id === 'flowers') {
      E = leaf(45, CL, 0) + leaf(30, CL, 0) + leaf(60, CL, 0) + flower(37.5, CL, c1, 1) + flower(52.5, CL, lil, 1);
      C = along(17, [20, 45, 70], function (x, y, i) { return leaf(x, Number(y) + 4, 40) + flower(x, y, i === 1 ? lil : c1, 1); });
    } else if (id === 'ribbon') {
      var hi = tint(c1, 0.55), lo = shade(c1, 0.25);
      E = '<path d="M30 ' + CL + 'H60" stroke="' + c1 + '" stroke-width="6" fill="none"/><path d="M30 ' + (CL - 1.8) + 'H60" stroke="' + hi + '" stroke-width="1.3" fill="none"/><path d="M30 ' + (CL + 2) + 'H60" stroke="' + lo + '" stroke-width="1" fill="none" stroke-opacity=".7"/>';
      C = '<path d="M' + CL + ' 30A17 17 0 0 1 30 ' + CL + '" stroke="' + c1 + '" stroke-width="6" fill="none"/><path d="M' + (CL - 1.8) + ' 30A18.8 18.8 0 0 1 30 ' + (CL - 1.8) + '" stroke="' + hi + '" stroke-width="1.3" fill="none"/><path d="M' + (CL + 2) + ' 30A15 15 0 0 1 30 ' + (CL + 2) + '" stroke="' + lo + '" stroke-width="1" fill="none" stroke-opacity=".7"/>';
      T = C + '<g fill="' + c1 + '" stroke="' + lo + '" stroke-width=".8"><ellipse cx="6.5" cy="9" rx="6.8" ry="3.2" transform="rotate(-32 6.5 9)"/><ellipse cx="10" cy="20" rx="6.8" ry="3.2" transform="rotate(62 10 20)"/></g><path d="M13 13L8 27M13 13L19 26" stroke="' + c1 + '" stroke-width="2.6" stroke-linecap="round" fill="none"/><circle cx="13" cy="13" r="3.2" fill="' + lo + '"/>';
    } else if (id === 'clouds') {
      var fill = '#eaf2ff';
      var cs = 'M30 30V12' + SC + 'V30z';
      E = '<path d="' + cs + '" stroke="' + c1 + '" stroke-width="3.2" fill="none"/><path d="' + cs + '" fill="' + fill + '"/><path d="M30 30V19a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0V30z" fill="#fff"/>';
      C = circles(fill, c1, 3.2) + circles(fill) + '<rect x="9" y="9" width="21" height="21" fill="' + fill + '"/><circle cx="12" cy="12" r="4.5" fill="#fff"/>';
    } else if (id === 'pearls') {
      var pearl = function (x, y) { return '<circle cx="' + x + '" cy="' + y + '" r="3.5" fill="url(#bbpearl)" stroke="#cdbf9a" stroke-width=".6"/>'; };
      E = '<path d="M30 ' + CL + 'H60" stroke="#d6c9a8" stroke-width=".9" fill="none"/>' + rep(4, function (k) { return pearl(33.75 + 7.5 * k, CL); });
      C = '<path d="M' + CL + ' 30A17 17 0 0 1 30 ' + CL + '" stroke="#d6c9a8" stroke-width=".9" fill="none"/>' + along(17, [12.5, 37.5, 62.5], function (x, y) { return pearl(x, y); });
    } else if (id === 'sparkles') {
      var gold = '#d9b86a';
      E = '<path d="M30 ' + CL + 'H60" stroke="' + c1 + '" stroke-width="1.5" fill="none"/><path d="M30 ' + (CL + 3.5) + 'H60" stroke="' + gold + '" stroke-width=".8" fill="none"/>' + sparkle(45, CL, 6, c1) + '<circle cx="35" cy="' + (CL - 4) + '" r="1" fill="' + gold + '"/><circle cx="56" cy="' + (CL + 6) + '" r="1" fill="' + gold + '"/>';
      C = '<path d="M' + CL + ' 30A17 17 0 0 1 30 ' + CL + '" stroke="' + c1 + '" stroke-width="1.5" fill="none"/><path d="M' + (CL + 3.5) + ' 30A13.5 13.5 0 0 1 30 ' + (CL + 3.5) + '" stroke="' + gold + '" stroke-width=".8" fill="none"/>' + sparkle(12, 12, 9, c1) + sparkle(22, 20, 3.4, gold);
    } else if (id === 'lace' || id === 'floral') {
      // one shared cream scalloped band: bumps of radius 5 every 10 units, so sides and corners line up
      var edge = [[35, 7], [45, 7], [55, 7]], cor = [[7, 7, 7], [15, 7, 5], [25, 7, 5], [7, 15, 5], [7, 25, 5]], line = shade(cream, 0.28);
      var ring = function (list, f) { return list.map(function (c) { return f(c[0], c[1], c[2] || 5); }).join(''); };
      var band = ring(edge, function (x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" stroke="' + c1 + '" stroke-width="1.8" fill="' + cream + '"/>'; }) + '<rect x="30" y="7" width="30" height="23" fill="' + cream + '"/>' + ring(edge, function (x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + cream + '"/>'; });
      var cband = ring(cor, function (x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" stroke="' + c1 + '" stroke-width="1.8" fill="' + cream + '"/>'; }) + '<rect x="7" y="7" width="23" height="23" fill="' + cream + '"/>' + ring(cor, function (x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + cream + '"/>'; });
      var stitch = '<path d="M30 23H60" stroke="' + c1 + '" stroke-width="1.1" stroke-dasharray="2.5 2" fill="none"/>', cstitch = '<path d="M30 23H25Q23 23 23 25V30" stroke="' + c1 + '" stroke-width="1.1" stroke-dasharray="2.5 2" fill="none"/>';
      if (id === 'lace') {
        var eye = function (x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#fff" stroke="' + c1 + '" stroke-width="1"/>'; };
        E = band + stitch + edge.map(function (c) { return eye(c[0], c[1], 2.3); }).join('') + [40, 50].map(function (x) { return '<circle cx="' + x + '" cy="14" r="1.3" fill="' + c1 + '"/>'; }).join('');
        C = cband + cstitch + cor.map(function (c) { return eye(c[0], c[1], c[2] === 7 ? 2.8 : 2.3); }).join('');
      } else {
        var vine = '#7fa06a';
        E = band + '<path d="M30 15H60" stroke="' + vine + '" stroke-width="1.2" fill="none"/>' + leaf(45, 15, 0) + flower(37.5, 15, c1, 0.8) + flower(52.5, 15, c1, 0.8) + stitch.replace('M30 23', 'M30 24').replace('H60', 'H60');
        C = cband + '<path d="M30 15H19Q15 15 15 19V30" stroke="' + vine + '" stroke-width="1.2" fill="none"/>' + flower(15, 15, c1, 1) + '<path d="M30 24H26Q24 24 24 26V30" stroke="' + c1 + '" stroke-width="1.1" stroke-dasharray="2.5 2" fill="none"/>';
      }
    } else if (id === 'rope') {
      c2 = shade(c1, 0.35);
      var twist = rep(6, function (k) { return '<path d="M' + (24 + 6 * k) + ' 12L' + (30 + 6 * k) + ' 0" stroke="' + c1 + '" stroke-width="3.6" fill="none"/>'; });
      E = '<rect x="30" y="0" width="30" height="12" fill="' + c2 + '"/>' + twist;
      var band = '<rect x="0" y="0" width="30" height="12" fill="' + c2 + '"/>' + rep(6, function (k) { return '<path d="M' + (-6 + 6 * k) + ' 12L' + (6 * k) + ' 0" stroke="' + c1 + '" stroke-width="3.6" fill="none"/>'; });
      C = '<g>' + band + '</g><g transform="matrix(0 1 1 0 0 0)">' + band + '</g><path d="M15 28C15 19 20 14 29 14M29 14C26 14 24 16 24 18C24 20 27 20 27 18" stroke="' + c1 + '" stroke-width="1.7" fill="none" stroke-linecap="round"/>';
    } else if (id === 'crochet') {
      c2 = tint(c1, 0.6);
      E = '<path fill="' + c1 + '" d="M30 30V8' + SC + 'V30z"/><circle cx="37.5" cy="8" r="4.2" stroke="' + c2 + '" stroke-width="1.3" fill="none"/><circle cx="52.5" cy="8" r="4.2" stroke="' + c2 + '" stroke-width="1.3" fill="none"/><path d="M30 22H60" stroke="' + c2 + '" stroke-width="1.9" stroke-dasharray="0 3" stroke-linecap="round" fill="none"/>';
      C = '<g fill="' + c1 + '"><circle cx="9" cy="9" r="9"/><circle cx="22.5" cy="7.5" r="7.5"/><circle cx="7.5" cy="22.5" r="7.5"/><rect x="8" y="8" width="22" height="22"/></g><circle cx="22.5" cy="8" r="4.2" stroke="' + c2 + '" stroke-width="1.3" fill="none"/><circle cx="8" cy="22.5" r="4.2" stroke="' + c2 + '" stroke-width="1.3" fill="none"/><path d="M30 22H22V30" stroke="' + c2 + '" stroke-width="1.9" stroke-dasharray="0 3" stroke-linecap="round" fill="none"/>';
    } else if (id === 'fringe') {
      c2 = tint(c1, 0.55);
      var lines = '<path d="M30 14H60" stroke="' + c1 + '" stroke-width="2" fill="none"/><path d="M30 18H60" stroke="' + c2 + '" stroke-width="1" fill="none"/>';
      E = lines;
      B = lines + rep(10, function (k) { var x = 31.5 + 3 * k, b = k % 2 ? 1.3 : -1.3; return '<path d="M' + x + ' 14Q' + (x + b * 0.5) + ' 7 ' + (x + b) + ' 0.5" stroke="' + c1 + '" stroke-width="1.1" stroke-linecap="round" fill="none"/>'; });
      C = '<path d="M14 30A16 16 0 0 1 30 14" stroke="' + c1 + '" stroke-width="2" fill="none"/><path d="M18 30A12 12 0 0 1 30 18" stroke="' + c2 + '" stroke-width="1" fill="none"/>';
    } else if (id === 'scroll') {
      c2 = '#d4af5a';
      var gl = ' stroke="' + c2 + '" fill="none" stroke-linecap="round"';
      E = '<rect x="30" y="0" width="30" height="30" fill="' + c1 + '"/><path d="M30 3H60M30 26H60" stroke-width="1.2"' + gl + '/><path d="M30 14.5q3.75 -7 7.5 0t7.5 0t7.5 0t7.5 0" stroke-width="1.5"' + gl + '/>';
      C = '<rect x="0" y="0" width="30" height="30" fill="' + c1 + '"/><path d="M30 3H3V30M30 26H26V30" stroke-width="1.2" stroke-linejoin="round"' + gl + '/><circle cx="14.5" cy="14.5" r="5" stroke-width="1.5"' + gl + '/><circle cx="14.5" cy="14.5" r="1.7" fill="' + c2 + '"/><path d="M19.5 14.5H30M14.5 19.5V30" stroke-width="1.5"' + gl + '/>';
    }
    return { E: E, C: C, B: B, T: T };
  }
  var svgCache = {};
  function frameSvg(id, c1) {   // a 90 x 90 picture; its corners and sides are cut out by "border-image-slice: 30"
    var key = id + c1; if (svgCache[key]) return svgCache[key];
    var f = frameOf(id, c1);
    function piece(x, inner, tf) { return '<g' + (tf ? ' transform="' + tf + '"' : '') + '><svg x="' + x + '" y="0" width="30" height="30" viewBox="' + x + ' 0 30 30" overflow="hidden">' + inner + '</svg></g>'; }
    var FLIPY = 'translate(0 90) scale(1 -1)';
    var defs = id === 'pearls' ? '<defs><radialGradient id="bbpearl" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f3eadb"/><stop offset="1" stop-color="#d9ccb0"/></radialGradient></defs>' : '';
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'>" + defs + piece(0, f.C) + piece(0, f.T || f.C, 'translate(90 0) scale(-1 1)') + piece(0, f.C, FLIPY) + piece(0, f.C, 'translate(90 90) scale(-1 -1)') + piece(30, f.E) + piece(30, f.B || f.E, FLIPY) + piece(30, f.E, 'matrix(0 1 1 0 0 0)') + piece(30, f.E, 'matrix(0 1 -1 0 90 0)') + '</svg>';
    svgCache[key] = 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
    return svgCache[key];
  }

  /* ---------- put a choice on a page (or on a preview) ---------- */
  var VARS = ['--bb-c', '--bb-w', '--bb-ow', '--bb-img'];
  function apply(el, cfg) {   // el is the element that holds the buttons; the buttons that take the border carry the class "bb-t"
    STYLES.forEach(function (s) { el.classList.remove('pb-' + s.id); });
    el.classList.remove('pb-on'); el.classList.remove('pb-svg');
    VARS.forEach(function (v) { el.style.removeProperty(v); });
    var s = cfg && BY[cfg.id]; if (!s) return;
    el.classList.add('pb-on'); el.classList.add('pb-' + s.id);
    if (s.kind === 'svg') {
      el.classList.add('pb-svg');
      el.style.setProperty('--bb-ow', SIZES[cfg.s || 2] + 'px');
      el.style.setProperty('--bb-img', frameSvg(s.id, HEX.test(cfg.c || '') ? cfg.c : (s.color || '#c9a46a')));
    } else {
      el.style.setProperty('--bb-c', HEX.test(cfg.c || '') ? cfg.c : 'var(--text, #222)');
      el.style.setProperty('--bb-w', (cfg.w || (s.w && s.w.def) || 2) + 'px');
    }
  }

  /* ---------- the gallery ---------- */
  function el(tag, attrs) {
    var e = document.createElement(tag), k, i, c;
    for (k in (attrs || {})) { if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k]); }
    for (i = 2; i < arguments.length; i++) { c = arguments[i]; if (c == null) continue; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return e;
  }
  function nameOf(cfg) { return cfg && BY[cfg.id] ? BY[cfg.id].name : 'Default (no border)'; }
  /* opts: { saved: choice|null (what is saved now), label: text on the big preview, onLive(choice|null), onSave(choice|null) -> Promise, onClose() } */
  function picker(opts) {
    var saved = opts.saved ? Object.assign({}, opts.saved) : null, cur = saved ? Object.assign({}, saved) : null, busy = false;
    var dlg = el('dialog', { class: 'sheet-dialog designer bb-dialog', 'aria-labelledby': 'bb-title' });
    var liveScope = el('div', { class: 'bb-live-scope' }), liveBtn = el('div', { class: 'bb-demo bb-t btn secondary block', 'aria-hidden': 'true', text: opts.label || 'Your Button' });
    liveScope.appendChild(liveBtn);
    var nameLine = el('p', { class: 'bb-selected', 'aria-live': 'polite' });
    var scroller = el('div', { class: 'bb-scroll', tabindex: '0', role: 'group', 'aria-label': 'Border styles. Scroll to see more.' });
    var ctl = el('div', { class: 'bb-ctl' }), msg = el('div', { class: 'bb-msg', role: 'status' });
    var radios = {}, tiles = {}, sections = {}, tabBtns = {};
    function paintSelected() {
      Object.keys(tiles).forEach(function (id) { var on = !!cur && cur.id === id; tiles[id].classList.toggle('on', on); radios[id].checked = on; });
      nameLine.textContent = ''; nameLine.appendChild(document.createTextNode('Selected: ')); nameLine.appendChild(el('strong', { text: nameOf(cur) }));
      apply(liveScope, cur);
    }
    function live() { paintSelected(); drawCtl(); if (opts.onLive) opts.onLive(cur ? Object.assign({}, cur) : null); }
    function drawCtl() {
      while (ctl.firstChild) ctl.removeChild(ctl.firstChild);
      var s = cur && BY[cur.id]; if (!s) { ctl.appendChild(el('p', { class: 'small muted', text: s === undefined && cur ? '' : 'Pick a border to see its settings.' })); return; }
      var any = false;
      if (s.color !== null) {
        any = true;
        var ci = el('input', { type: 'color', id: 'bb-color', 'aria-label': 'Border color' }); ci.value = HEX.test(cur.c || '') ? cur.c : (s.color || '#3a3a3a');
        ci.addEventListener('input', function () { cur.c = ci.value.toLowerCase(); apply(liveScope, cur); paintTiles(); if (opts.onLive) opts.onLive(Object.assign({}, cur)); });
        ctl.appendChild(el('label', { class: 'bb-row', for: 'bb-color' }, el('span', { text: 'Border color' }), ci));
      }
      if (s.w) {
        any = true;
        var out = el('output', { for: 'bb-w', text: cur.w + ' px' });
        var wi = el('input', { type: 'range', id: 'bb-w', min: s.w.min, max: s.w.max, step: 1, 'aria-label': 'Border thickness' }); wi.value = cur.w;
        wi.addEventListener('input', function () { cur.w = Number(wi.value); out.textContent = cur.w + ' px'; apply(liveScope, cur); if (opts.onLive) opts.onLive(Object.assign({}, cur)); });
        ctl.appendChild(el('label', { class: 'bb-row', for: 'bb-w' }, el('span', { text: 'Thickness' }), wi, out));
      }
      if (s.size) {
        any = true;
        var names = { 1: 'Small', 2: 'Medium', 3: 'Large' }, out2 = el('output', { for: 'bb-s', text: names[cur.s] });
        var si = el('input', { type: 'range', id: 'bb-s', min: 1, max: 3, step: 1, 'aria-label': 'Decoration size', 'aria-valuetext': names[cur.s] }); si.value = cur.s;
        si.addEventListener('input', function () { cur.s = Number(si.value); out2.textContent = names[cur.s]; si.setAttribute('aria-valuetext', names[cur.s]); apply(liveScope, cur); if (opts.onLive) opts.onLive(Object.assign({}, cur)); });
        ctl.appendChild(el('label', { class: 'bb-row', for: 'bb-s' }, el('span', { text: 'Decoration size' }), si, out2));
      }
      if (!any) ctl.appendChild(el('p', { class: 'small muted', text: 'This style has no settings.' }));
    }
    function paintTiles() { /* tiles always show each style with its own starting colours, so nothing to repaint */ }
    function choose(id) { var s = BY[id]; cur = Object.assign(defaults(s), cur && cur.id === id ? cur : {}); live(); }
    // header
    dlg.appendChild(el('h2', { id: 'bb-title', text: 'Button borders' }));
    dlg.appendChild(el('p', { class: 'small muted bb-hint', text: 'Pick a frame for Edit profile and the other wide buttons on your page. The big preview updates as you choose.' }));
    dlg.appendChild(el('div', { class: 'bb-live' }, liveScope, nameLine));
    // category tabs: they stay in view and jump to a section
    var tabs = el('div', { class: 'bb-tabs', role: 'group', 'aria-label': 'Border categories' });
    CATS.forEach(function (cat) {
      var b = el('button', { class: 'bb-tab', type: 'button', text: cat.title, onclick: function () { var sec = sections[cat.id]; scroller.scrollTo({ top: sec.offsetTop - scroller.offsetTop - 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); } });
      tabBtns[cat.id] = b; tabs.appendChild(b);
    });
    dlg.appendChild(tabs);
    // the gallery: sections of real previews with the name underneath
    CATS.forEach(function (cat) {
      var sec = el('section', { class: 'bb-sec', 'aria-labelledby': 'bb-h-' + cat.id }), grid = el('div', { class: 'bb-grid' });
      sec.appendChild(el('h3', { id: 'bb-h-' + cat.id, class: 'bb-h', text: cat.title }));
      STYLES.filter(function (s) { return s.cat === cat.id; }).forEach(function (s) {
        var radio = el('input', { type: 'radio', name: 'bb-style', value: s.id, class: 'sr-only' });
        var scope = el('span', { class: 'bb-scope' }), demo = el('span', { class: 'bb-demo bb-t btn secondary block', 'aria-hidden': 'true', text: 'Your Button' });
        scope.appendChild(demo); apply(scope, defaults(s));
        var tile = el('label', { class: 'bb-tile' }, radio, scope, el('span', { class: 'bb-name', text: s.name }), el('span', { class: 'bb-check', 'aria-hidden': 'true', text: '✓' }));
        radio.addEventListener('change', function () { var top = scroller.scrollTop; choose(s.id); scroller.scrollTop = top; });
        radios[s.id] = radio; tiles[s.id] = tile; grid.appendChild(tile);
      });
      sec.appendChild(grid); sections[cat.id] = sec; scroller.appendChild(sec);
    });
    scroller.addEventListener('scroll', function () {
      var top = scroller.scrollTop + 8, active = CATS[0].id;
      CATS.forEach(function (c) { if (sections[c.id].offsetTop - scroller.offsetTop <= top) active = c.id; });
      CATS.forEach(function (c) { tabBtns[c.id].setAttribute('aria-current', c.id === active ? 'true' : 'false'); });
    });
    dlg.appendChild(scroller);
    dlg.appendChild(ctl); dlg.appendChild(msg);
    // actions
    function finish() { try { dlg.close(); } catch (e) { /* closed */ } if (dlg.parentNode) dlg.parentNode.removeChild(dlg); if (opts.onClose) opts.onClose(); }
    function cancel() { if (busy) return; if (opts.onLive) opts.onLive(saved ? Object.assign({}, saved) : null); finish(); }
    var saveB = el('button', { class: 'btn', type: 'button', text: 'Save', onclick: function () {
      if (busy) return; busy = true; saveB.disabled = true; msg.textContent = '';
      Promise.resolve(opts.onSave ? opts.onSave(cur ? Object.assign({}, cur) : null) : null).then(function () { busy = false; saved = cur ? Object.assign({}, cur) : null; finish(); }, function (e) { busy = false; saveB.disabled = false; msg.textContent = (e && e.message) || 'Could not save. Try again.'; msg.className = 'bb-msg error'; });
    } });
    dlg.appendChild(el('div', { class: 'bb-actions' }, saveB, el('button', { class: 'btn secondary', type: 'button', text: 'Cancel', onclick: cancel }), el('button', { class: 'btn secondary', type: 'button', text: 'Reset to default', onclick: function () { cur = null; live(); } })));
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); cancel(); });
    document.body.appendChild(dlg); dlg.showModal();
    paintSelected(); drawCtl(); tabBtns[CATS[0].id].setAttribute('aria-current', 'true');
    return { close: finish };
  }

  window.FCBorders = { STYLES: STYLES, CATS: CATS, byId: BY, read: read, write: write, apply: apply, nameOf: nameOf, picker: picker, defaults: defaults };
})();

/* Recipes preview: shared rules (PREVIEW CODE, not wired into the live app).
 * Written fresh for Family Circle. No code from the ZenfulOutput Recipe Book is copied here; only the backup FILE SHAPE
 * ({app:'family-recipe-book', version:1, recipes:[...]}) is read, so that a synthetic backup of that shape can be tried.
 * Photo limits are PREVIEW limits only, not an approved production photo policy. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RecipesCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PHOTO = { maxEdge: 800, maxBytes: 150 * 1024 };
  var LIMITS = { name: 120, short: 200, text: 2000, lines: 100, line: 400, steps: 100, step: 2000, tags: 20, tag: 40, source: 500, recipes: 200, importChars: 2000000, importRecords: 200 };
  var APP = 'family-recipe-book';
  // Fields this preview carries in its data. Others found in a backup are reported as ignored, never dropped without a line in the report.
  var STR_FIELDS = ['description', 'yield', 'prep', 'cook', 'total', 'notes', 'source'];
  var ARR_FIELDS = ['ingredients', 'steps', 'categories', 'tags', 'parts'];
  var KNOWN = ['slug', 'id', 'name', 'image', 'fav', 'updated'].concat(STR_FIELDS, ARR_FIELDS);
  // Carried in the data and written back on export, but not shown or used by any screen in this preview.
  var CARRIED_NOT_SHOWN = ['parts', 'updated', 'id'];

  function slugify(s) {
    var t = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (t || 'recipe').slice(0, 60);
  }

  /* ---------- photos ---------- */
  function b64ToBytes(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
  }
  function pngSize(b) {
    var sig = [137, 80, 78, 71, 13, 10, 26, 10];
    if (b.length < 24) return null; for (var i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
    if (b[12] !== 73 || b[13] !== 72 || b[14] !== 68 || b[15] !== 82) return null;   // IHDR
    var w = (b[16] * 16777216) + (b[17] << 16) + (b[18] << 8) + b[19], h = (b[20] * 16777216) + (b[21] << 16) + (b[22] << 8) + b[23];
    return w > 0 && h > 0 ? { w: w, h: h } : null;
  }
  function jpegSize(b) {
    if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
    var i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      var m = b[i + 1]; if (m === 0xFF) { i++; continue; }
      if (m === 0xD8 || (m >= 0xD0 && m <= 0xD7) || m === 0x01) { i += 2; continue; }
      var len = (b[i + 2] << 8) + b[i + 3]; if (len < 2) return null;
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        var h = (b[i + 5] << 8) + b[i + 6], w = (b[i + 7] << 8) + b[i + 8]; return w > 0 && h > 0 ? { w: w, h: h } : null;
      }
      i += 2 + len;
    }
    return null;
  }
  /* checkPhoto(value) -> { ok, empty, reasons:[{code,message}], bytes, w, h }. An empty value means "no photo" and is fine. */
  function checkPhoto(v) {
    if (v === undefined || v === null || v === '') return { ok: true, empty: true, reasons: [] };
    var bad = function (code, message, extra) { return Object.assign({ ok: false, reasons: [{ code: code, message: message }] }, extra || {}); };
    if (typeof v !== 'string') return bad('unsupported-type', 'The photo is not a picture value.');
    if (/^https?:\/\//i.test(v)) return bad('external-link', 'The photo is a link to another website. This preview never loads outside pictures.');
    var m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(v);
    if (!m) return bad('unsupported-type', 'The photo is not an embedded JPEG or PNG picture.');
    var mime = m[1].toLowerCase();
    if (mime !== 'image/jpeg' && mime !== 'image/png') return bad('unsupported-type', 'Only JPEG and PNG photos are supported in this preview (this one is ' + mime.replace('image/', '').toUpperCase() + ').');
    var bytes; try { bytes = b64ToBytes(m[2]); } catch (e) { return bad('unreadable', 'The photo data could not be decoded.'); }
    var dim = mime === 'image/png' ? pngSize(bytes) : jpegSize(bytes);
    if (!dim) return bad('unreadable', 'The photo header cannot be read, so its size cannot be checked.', { bytes: bytes.length });
    var reasons = [];
    if (bytes.length > PHOTO.maxBytes) reasons.push({ code: 'too-heavy', message: 'The photo is ' + Math.round(bytes.length / 1024) + ' KB; the preview limit is ' + (PHOTO.maxBytes / 1024) + ' KB.' });
    if (Math.max(dim.w, dim.h) > PHOTO.maxEdge) reasons.push({ code: 'too-large-dimensions', message: 'The photo is ' + dim.w + 'x' + dim.h + ' pixels; the longest edge may be ' + PHOTO.maxEdge + ' pixels.' });
    return { ok: reasons.length === 0, empty: false, reasons: reasons, bytes: bytes.length, w: dim.w, h: dim.h };
  }

  /* ---------- recipes ---------- */
  function isStr(x) { return typeof x === 'string'; }
  function cleanLines(a) { return a.map(function (s) { return s.replace(/\r/g, '').trim(); }).filter(Boolean); }
  /* validateRecipe(raw) -> { ok, errors:[text], value, ignored:[field], photo } . Never throws. `raw` may be anything. */
  function validateRecipe(raw) {
    var err = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['This entry is not a recipe record.'], ignored: [], photo: null };
    if (!isStr(raw.name) || !raw.name.trim()) err.push('The name is missing or is not text.');
    else if (raw.name.trim().length > LIMITS.name) err.push('The name is longer than ' + LIMITS.name + ' characters.');
    var v = { name: isStr(raw.name) ? raw.name.trim() : '' };
    STR_FIELDS.forEach(function (f) {
      var x = raw[f]; if (x === undefined || x === null) { v[f] = ''; return; }
      if (!isStr(x)) { err.push('"' + f + '" is not text.'); v[f] = ''; return; }
      var lim = f === 'source' ? LIMITS.source : (f === 'notes' || f === 'description') ? LIMITS.text : LIMITS.short;
      if (x.length > lim) err.push('"' + f + '" is longer than ' + lim + ' characters.');
      v[f] = x.trim();
    });
    ARR_FIELDS.forEach(function (f) {
      var x = raw[f]; if (x === undefined || x === null) { v[f] = []; return; }
      if (!Array.isArray(x)) { err.push('"' + f + '" is not a list.'); v[f] = []; return; }
      if (!x.every(isStr)) { err.push('"' + f + '" has an item that is not text.'); v[f] = []; return; }
      var a = f === 'parts' ? x.slice() : cleanLines(x);
      var maxN = f === 'steps' ? LIMITS.steps : f === 'ingredients' ? LIMITS.lines : LIMITS.tags;
      var maxL = f === 'steps' ? LIMITS.step : f === 'ingredients' ? LIMITS.line : LIMITS.tag;
      if (a.length > maxN) err.push('"' + f + '" has more than ' + maxN + ' items.');
      if (a.some(function (s) { return s.length > maxL; })) err.push('"' + f + '" has an item longer than ' + maxL + ' characters.');
      v[f] = a;
    });
    if (raw.fav !== undefined && typeof raw.fav !== 'boolean') err.push('"fav" is not true or false.');
    v.fav = raw.fav === true;
    if (raw.updated !== undefined && (typeof raw.updated !== 'number' || !isFinite(raw.updated))) err.push('"updated" is not a number.');
    v.updated = typeof raw.updated === 'number' && isFinite(raw.updated) ? raw.updated : 0;
    if (raw.slug !== undefined && !isStr(raw.slug)) err.push('"slug" is not text.');
    if (raw.id !== undefined && !isStr(raw.id)) err.push('"id" is not text.');
    v.slug = isStr(raw.slug) && raw.slug.trim() ? slugify(raw.slug) : slugify(v.name);
    v.id = isStr(raw.id) && raw.id.trim() ? raw.id.trim().slice(0, 80) : '';
    var photo = checkPhoto(raw.image);
    if (raw.image !== undefined && raw.image !== null && typeof raw.image !== 'string') { photo = { ok: false, empty: false, reasons: [{ code: 'unsupported-type', message: 'The photo is not a picture value.' }] }; }
    v.image = photo.ok && !photo.empty ? raw.image : '';
    var ignored = Object.keys(raw).filter(function (k) { return KNOWN.indexOf(k) < 0; });
    return { ok: err.length === 0, errors: err, value: v, ignored: ignored, photo: photo };
  }

  /* ---------- backups ---------- */
  /* parseBackup(text) -> { ok, error, records:[raw], format:'object'|'array', version } . Rejects before looking at any record. */
  function parseBackup(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The backup is empty.' };
    if (text.length > LIMITS.importChars) return { ok: false, error: 'The backup is larger than ' + Math.round(LIMITS.importChars / 1000000) + ' MB, which is the preview limit. Nothing was read.' };
    var d; try { d = JSON.parse(text); } catch (e) { return { ok: false, error: 'This is not a readable backup: the text is not valid JSON.' }; }
    var list, format;
    if (Array.isArray(d)) { list = d; format = 'array'; }
    else if (d && typeof d === 'object') {
      if (d.app !== undefined && d.app !== APP) return { ok: false, error: 'This backup says it comes from a different app ("' + String(d.app).slice(0, 40) + '"). Nothing was read.' };
      if (d.version !== undefined && d.version !== 1) return { ok: false, error: 'This backup is version ' + String(d.version).slice(0, 20) + '; the preview understands version 1 only.' };
      list = d.recipes; format = 'object';
    }
    if (!Array.isArray(list)) return { ok: false, error: 'This file has no list of recipes in it.' };
    if (!list.length) return { ok: false, error: 'The backup has an empty recipe list.' };
    if (list.length > LIMITS.importRecords) return { ok: false, error: 'The backup has ' + list.length + ' records; the preview reads at most ' + LIMITS.importRecords + ' at a time. Nothing was read.' };
    return { ok: true, records: list, format: format, version: format === 'object' ? (d.version === undefined ? null : d.version) : null };
  }
  function buildBackup(recipes, nowIso) {
    return { app: APP, version: 1, saved: nowIso, recipes: recipes.map(function (r) {
      var o = {}; ['slug', 'id', 'name', 'description', 'yield', 'prep', 'cook', 'total', 'ingredients', 'steps', 'parts', 'categories', 'tags', 'notes', 'source', 'image', 'fav', 'updated'].forEach(function (k) { o[k] = r[k]; }); return o;
    }) };
  }

  return { PHOTO: PHOTO, LIMITS: LIMITS, APP: APP, KNOWN: KNOWN, CARRIED_NOT_SHOWN: CARRIED_NOT_SHOWN, slugify: slugify, checkPhoto: checkPhoto, validateRecipe: validateRecipe, parseBackup: parseBackup, buildBackup: buildBackup };
});

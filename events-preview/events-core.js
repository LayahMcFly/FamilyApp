/* Events preview: shared time and text rules (PREVIEW CODE, not wired into the live app).
 * Used by the fake server (events-fake-server.js), the screens (events-ui.js) and the Node tests.
 * Zone maths uses the platform's Intl, as the design (section 6) proposes. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EventsCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000;
  var KINDS = ['birthday', 'anniversary', 'reunion', 'dinner', 'graduation', 'wedding', 'holiday', 'vacation', 'other'];
  var LIMITS = { title: 80, description: 1000, location: 200, invitees: 50, guests: 10, perDay: 20, activePerFamily: 300, maxTimedDays: 14, futureYears: 5 };

  var fmtCache = {};
  function partsFmt(tz) {
    if (!fmtCache[tz]) fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return fmtCache[tz];
  }
  function isValidTz(tz) {
    if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
    try { partsFmt(tz); return true; } catch (e) { return false; }
  }
  /* Offset of a zone from UTC, in minutes, at a UTC instant. */
  function offsetMin(tz, utcMs) {
    var p = {}; partsFmt(tz).formatToParts(new Date(utcMs)).forEach(function (x) { p[x.type] = x.value; });
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
  }
  /* "2026-06-06" or "2026-06-06T14:00" -> parts, or null when the text or the calendar date is invalid. */
  function parseLocal(s) {
    var m = typeof s === 'string' && /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], hh = m[4] === undefined ? null : +m[4], mi = m[5] === undefined ? null : +m[5];
    var t = new Date(Date.UTC(y, mo - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
    if (hh !== null && (hh > 23 || mi > 59)) return null;
    return { y: y, mo: mo, d: d, hh: hh, mi: mi, dateOnly: hh === null, date: m[1] + '-' + m[2] + '-' + m[3] };
  }
  /* The wall-clock text read as if it were UTC. Only a stepping stone for zone maths and for ordering within one zone. */
  function wallMs(local) { var p = parseLocal(local); return p ? Date.UTC(p.y, p.mo - 1, p.d, p.hh || 0, p.mi || 0) : NaN; }

  /* Local wall time in a zone -> UTC instant. status: ok | gap (time does not exist) | ambiguous (happens twice; the first one is used). */
  function localToUtc(local, tz) {
    var n = wallMs(local); if (isNaN(n) || !isValidTz(tz)) return { status: 'invalid' };
    var offs = [], seen = {};
    [n - DAY, n + DAY].forEach(function (probe) { var o = offsetMin(tz, probe); if (!seen[o]) { seen[o] = 1; offs.push(o); } });
    var good = [];
    offs.forEach(function (o) { var c = n - o * 60000; if (offsetMin(tz, c) === o && good.indexOf(c) < 0) good.push(c); });
    if (!good.length) return { status: 'gap' };
    good.sort(function (a, b) { return a - b; });
    return { status: good.length > 1 ? 'ambiguous' : 'ok', utcMs: good[0] };
  }
  /* The calendar date (YYYY-MM-DD) in a zone at a UTC instant. */
  function dateIn(tz, utcMs) {
    var z = isValidTz(tz) ? tz : 'UTC', p = {}; partsFmt(z).formatToParts(new Date(utcMs)).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function addDays(date, n) { var p = parseLocal(date); var t = new Date(Date.UTC(p.y, p.mo - 1, p.d + n)); return t.toISOString().slice(0, 10); }
  function addMonths(date, n) { var p = parseLocal(date); var t = new Date(Date.UTC(p.y, p.mo - 1 + n, p.d)); return t.toISOString().slice(0, 10); }

  /* ---- display (wall time is shown as stored; it never depends on the viewer's device zone) ---- */
  var WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(date) { var p = parseLocal(date); var wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay(); return WD[wd] + ', ' + MON[p.mo - 1] + ' ' + p.d + ', ' + p.y; }
  function fmtTime(local) { var p = parseLocal(local); var h = p.hh % 12 || 12; return h + ':' + (p.mi < 10 ? '0' : '') + p.mi + ' ' + (p.hh < 12 ? 'AM' : 'PM'); }
  function zoneAbbrev(tz, utcMs) {
    try { var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(utcMs)); var z = f.filter(function (x) { return x.type === 'timeZoneName'; })[0]; return z ? z.value : tz; } catch (e) { return tz; }
  }
  /* Plain-language description of when an event happens, for the event as stored. */
  function whenText(ev) {
    var s = parseLocal(ev.startLocal); if (!s) return '';
    if (ev.allDay) {
      var e = ev.endLocal && ev.endLocal !== ev.startLocal ? ev.endLocal : null;
      return fmtDate(ev.startLocal) + (e ? ' to ' + fmtDate(e) : '') + ' (all day)';
    }
    var r = localToUtc(ev.startLocal, ev.tz), ab = r.utcMs !== undefined ? zoneAbbrev(ev.tz, r.utcMs) : ev.tz;
    var out = fmtDate(ev.startLocal) + ', ' + fmtTime(ev.startLocal);
    if (ev.endLocal) { var sameDay = ev.endLocal.slice(0, 10) === ev.startLocal.slice(0, 10); out += ' to ' + (sameDay ? '' : fmtDate(ev.endLocal) + ', ') + fmtTime(ev.endLocal); }
    return out + ' ' + ab + ' (' + ev.tz + ')';
  }
  /* The viewer's own clock time for a timed event, or '' when the viewer is in the same wall time (same offset) or the event is all-day. */
  function viewerTimeText(ev, viewerTz) {
    if (ev.allDay || !isValidTz(viewerTz) || !isValidTz(ev.tz)) return '';
    var r = localToUtc(ev.startLocal, ev.tz); if (r.utcMs === undefined) return '';
    if (offsetMin(viewerTz, r.utcMs) === offsetMin(ev.tz, r.utcMs)) return '';
    var f = new Intl.DateTimeFormat('en-US', { timeZone: viewerTz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    return f.format(new Date(r.utcMs));
  }
  /* Last moment of the event as a comparable value, and whether it is over for a viewer in viewerTz. */
  function isPast(ev, nowMs, viewerTz) {
    if (ev.allDay) return (ev.endLocal || ev.startLocal) < dateIn(viewerTz, nowMs);
    var r = localToUtc(ev.endLocal || ev.startLocal, ev.tz); return r.utcMs !== undefined && r.utcMs < nowMs;
  }
  /* A hint for the form while someone types a time. */
  function timeHint(local, tz) {
    var p = parseLocal(local); if (!p || p.dateOnly || !isValidTz(tz)) return '';
    var r = localToUtc(local, tz);
    if (r.status === 'gap') return 'That time does not exist in this time zone on that day (clocks move forward). Choose a different time.';
    if (r.status === 'ambiguous') return 'That time happens twice that day (clocks move back). The first one is used.';
    return '';
  }

  /* ---- validation: the server is the authority; the form only hints ---- */
  /* input: title, kind, allDay, startLocal, endLocal, tz, description, location, locationAccess, audience. ctx: {nowMs, checkLowerBound}. */
  function validateEvent(input, ctx) {
    var err = [], v = {};
    var title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) err.push('Add a title.'); else if (title.length > LIMITS.title) err.push('The title is limited to ' + LIMITS.title + ' characters.');
    v.title = title;
    if (KINDS.indexOf(input.kind) < 0) err.push('Choose a type.'); v.kind = input.kind;
    var desc = typeof input.description === 'string' ? input.description.trim() : (input.description == null ? '' : null);
    if (desc === null || desc.length > LIMITS.description) err.push('The description is limited to ' + LIMITS.description + ' characters.'); v.description = desc || '';
    var loc = typeof input.location === 'string' ? input.location.trim() : (input.location == null ? '' : null);
    if (loc === null || loc.length > LIMITS.location) err.push('The location is limited to ' + LIMITS.location + ' characters.'); v.location = loc || '';
    if (input.locationAccess !== 'viewers' && input.locationAccess !== 'going') err.push('Choose who sees the location.'); v.locationAccess = input.locationAccess;
    if (input.audience !== 'family' && input.audience !== 'invited') err.push('Choose who can see this event.'); v.audience = input.audience;
    v.allDay = input.allDay === true;
    var s = parseLocal(input.startLocal), e = input.endLocal ? parseLocal(input.endLocal) : null;
    if (!s) err.push('Choose a start date' + (v.allDay ? '' : ' and time') + '.');
    else if (input.endLocal && !e) err.push('The end is not a valid date' + (v.allDay ? '' : ' and time') + '.');
    if (s && (!input.endLocal || e)) {
      if (v.allDay) {
        if (!s.dateOnly || (e && !e.dateOnly)) err.push('An all-day event uses dates only.');
        else if (e && e.date < s.date) err.push('The last day cannot be before the first day.');
        else {
          v.startLocal = s.date; v.endLocal = e && e.date !== s.date ? e.date : ''; v.tz = '';
          v.sortAt = Date.UTC(s.y, s.mo - 1, s.d);
          if (ctx.checkLowerBound !== false && s.date < addDays(dateIn('UTC', ctx.nowMs), -1)) err.push('Events can start from yesterday onward.');
          if (s.date > addMonths(dateIn('UTC', ctx.nowMs), 12 * LIMITS.futureYears)) err.push('Events can be at most ' + LIMITS.futureYears + ' years ahead.');
        }
      } else {
        if (s.dateOnly || (e && e.dateOnly)) err.push('A timed event needs a time.');
        else if (!isValidTz(input.tz)) err.push('Choose a time zone from the list.');
        else {
          var a = localToUtc(input.startLocal, input.tz), b = e ? localToUtc(input.endLocal, input.tz) : null;
          if (a.status === 'gap') err.push('The start time does not exist in that time zone on that day (clocks move forward).');
          if (b && b.status === 'gap') err.push('The end time does not exist in that time zone on that day (clocks move forward).');
          if (a.utcMs !== undefined && !(b && b.utcMs === undefined)) {
            if (b && b.utcMs <= a.utcMs) err.push('The end must be after the start.');
            else if (b && b.utcMs - a.utcMs > LIMITS.maxTimedDays * DAY) err.push('A timed event can last at most ' + LIMITS.maxTimedDays + ' days.');
            else {
              v.startLocal = input.startLocal; v.endLocal = e ? input.endLocal : ''; v.tz = input.tz; v.sortAt = a.utcMs; v.startNote = a.status === 'ambiguous' ? 'first' : '';
              if (ctx.checkLowerBound !== false && a.utcMs < ctx.nowMs - DAY) err.push('Events can start from yesterday onward.');
              if (a.utcMs > ctx.nowMs + LIMITS.futureYears * 366 * DAY) err.push('Events can be at most ' + LIMITS.futureYears + ' years ahead.');
            }
          }
        }
      }
    }
    return { ok: err.length === 0, errors: err, value: v };
  }

  return { KINDS: KINDS, LIMITS: LIMITS, DAY: DAY, isValidTz: isValidTz, offsetMin: offsetMin, parseLocal: parseLocal, wallMs: wallMs, localToUtc: localToUtc, dateIn: dateIn, addDays: addDays,
    addMonths: addMonths, fmtDate: fmtDate, fmtTime: fmtTime, zoneAbbrev: zoneAbbrev, whenText: whenText, viewerTimeText: viewerTimeText, isPast: isPast, timeHint: timeHint, validateEvent: validateEvent };
});

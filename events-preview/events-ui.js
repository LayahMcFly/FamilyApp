/* Events preview: the screens (PREVIEW CODE, not wired into the live app).
 * Talks only to the `server` object it is given. In the preview that is the in-memory fake server, so nothing here reaches Appwrite.
 * Text is always set with textContent, so anything typed into a field is shown as plain text. */
(function (root) {
  'use strict';
  var C = root.EventsCore;
  var BOARD_URL = 'https://layahmcfly.github.io/ZenfulOutput/family-board/';
  var KIND_LABEL = { birthday: 'Birthday', anniversary: 'Anniversary', reunion: 'Reunion', dinner: 'Dinner', graduation: 'Graduation', wedding: 'Wedding', holiday: 'Holiday', vacation: 'Vacation', other: 'Other' };
  var ZONES = [['America/New_York', 'Eastern (New York)'], ['America/Chicago', 'Central (Chicago)'], ['America/Denver', 'Mountain (Denver)'], ['America/Phoenix', 'Arizona (Phoenix)'], ['America/Los_Angeles', 'Pacific (Los Angeles)'],
    ['America/Anchorage', 'Alaska (Anchorage)'], ['Pacific/Honolulu', 'Hawaii (Honolulu)'], ['America/Toronto', 'Toronto'], ['America/Mexico_City', 'Mexico City'], ['America/Sao_Paulo', 'Sao Paulo'], ['Europe/London', 'London'],
    ['Europe/Paris', 'Paris'], ['Africa/Lagos', 'Lagos'], ['Africa/Nairobi', 'Nairobi'], ['Asia/Dubai', 'Dubai'], ['Asia/Karachi', 'Karachi'], ['Asia/Kolkata', 'Kolkata'], ['Asia/Manila', 'Manila'], ['Asia/Tokyo', 'Tokyo'], ['Australia/Sydney', 'Sydney'], ['UTC', 'UTC']];

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
  function badge(text, cls) { return h('span', { class: 'ev-badge' + (cls ? ' ' + cls : ''), text: text }); }

  function mount(o) {
    var server = o.server, viewers = o.viewers, main = o.main, controls = o.controls, toasts = o.toasts, now = o.now || function () { return Date.now(); };
    var viewerTz = C.isValidTz(o.viewerTz) ? o.viewerTz : 'UTC';
    var st = { userId: viewers[0].userId, familyId: null, tab: 'upcoming', gen: 0, busy: false };

    function api(action, body) {
      var b = Object.assign({ familyId: st.familyId, viewerTz: viewerTz }, body || {});
      return Promise.resolve().then(function () { return server.call(st.userId, action, b); });
    }
    function toast(msg) { var t = h('div', { class: 'toast', text: msg }); toasts.appendChild(t); setTimeout(function () { t.remove(); }, 3500); }
    function route() {
      var p = (location.hash || '').replace(/^#\/?/, '').split('/');
      if (p[0] !== 'calendar') return { name: 'list' };
      if (p[1] === 'new') return { name: 'new' };
      if (p[1] === 'event' && p[2]) return p[3] === 'edit' ? { name: 'edit', id: p[2] } : { name: 'detail', id: p[2] };
      return { name: 'list' };
    }
    function focusHeading(el) { var t = el && (el.matches && el.matches('[data-focus]') ? el : el.querySelector('[data-focus]')); if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: false }); } }

    /* ---------- the "previewing as" controls ---------- */
    function drawControls() {
      var who = h('select', { id: 'pv-who', 'aria-describedby': 'pv-note' }), fam = h('select', { id: 'pv-fam' });
      viewers.forEach(function (v) { who.appendChild(h('option', { value: v.userId, text: v.name, selected: v.userId === st.userId })); });
      var fams = server.familiesOf(st.userId);
      if (!st.familyId || !fams.some(function (f) { return f.id === st.familyId; })) st.familyId = fams.length ? fams[0].id : 'none';
      fams.forEach(function (f) { fam.appendChild(h('option', { value: f.id, text: f.name, selected: f.id === st.familyId })); });
      who.addEventListener('change', function () { st.userId = who.value; st.familyId = null; location.hash = '#/calendar'; drawControls(); refresh(); });
      fam.addEventListener('change', function () { st.familyId = fam.value; location.hash = '#/calendar'; refresh(); });
      var v = viewers.filter(function (x) { return x.userId === st.userId; })[0];
      controls.textContent = '';
      controls.appendChild(h('div', { class: 'pv-row' },
        h('div', null, h('label', { for: 'pv-who', text: 'Previewing as' }), who),
        h('div', null, h('label', { for: 'pv-fam', text: 'Family' }), fam),
        h('div', { class: 'pv-reset' }, h('button', { type: 'button', class: 'btn secondary small', id: 'pv-reset', text: 'Reset sample data', onclick: function () { if (o.onReset) o.onReset(); } }))));
      controls.appendChild(h('p', { class: 'hint', id: 'pv-note', text: v.note + ' Switching person shows what that person would see.' }));
    }

    /* ---------- list ---------- */
    function shortWhen(ev) {
      if (ev.allDay) return C.fmtDate(ev.startLocal) + (ev.endLocal ? ' to ' + C.fmtDate(ev.endLocal) : '') + ' (all day)';
      var r = C.localToUtc(ev.startLocal, ev.tz);
      return C.fmtDate(ev.startLocal) + ', ' + C.fmtTime(ev.startLocal) + ' ' + (r.utcMs !== undefined ? C.zoneAbbrev(ev.tz, r.utcMs) : '');
    }
    function monthLabel(ev) { var p = C.parseLocal(ev.startLocal); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p.mo - 1] + ' ' + p.y; }
    function rsvpWord(r) { return r.response === 'yes' ? 'Yes' : r.response === 'maybe' ? 'Maybe' : 'No'; }

    function listPane(events, activeId) {
      var up = events.filter(function (e) { return !e.past; }), pa = events.filter(function (e) { return e.past; }).reverse();
      var shown = st.tab === 'upcoming' ? up : pa;
      var pane = h('div', { class: 'ev-list' });
      pane.appendChild(h('div', { class: 'ev-list-head' },
        h('h2', { text: 'Events', 'data-focus': '' }),
        h('a', { class: 'btn small', href: '#/calendar/new', id: 'ev-new', text: 'New event' })));
      pane.appendChild(h('div', { class: 'ev-tabs', role: 'group', 'aria-label': 'Show' },
        ['upcoming', 'past'].map(function (t) {
          return h('button', { type: 'button', class: 'ev-tab', 'data-tab': t, 'aria-pressed': st.tab === t ? 'true' : 'false', text: t === 'upcoming' ? 'Upcoming (' + up.length + ')' : 'Past (' + pa.length + ')',
            onclick: function () { st.tab = t; refresh(true); } });
        })));
      if (!events.length) { pane.appendChild(h('p', { class: 'muted ev-empty', text: 'No events yet.' })); return pane; }
      if (!shown.length) { pane.appendChild(h('p', { class: 'muted ev-empty', text: st.tab === 'upcoming' ? 'Nothing upcoming.' : 'Nothing in the past.' })); return pane; }
      var last = '', ul = null;
      shown.forEach(function (e) {
        var m = monthLabel(e);
        if (m !== last) { last = m; pane.appendChild(h('h3', { class: 'ev-month', text: m })); ul = h('ul', { class: 'ev-rows' }); pane.appendChild(ul); }
        var a = h('a', { class: 'ev-row' + (e.id === activeId ? ' is-active' : ''), href: '#/calendar/event/' + e.id, 'data-event': e.id, 'aria-current': e.id === activeId ? 'page' : null },
          h('strong', { class: 'ev-row-title', text: e.title }),
          h('span', { class: 'ev-row-when', text: shortWhen(e) }),
          h('span', { class: 'ev-row-meta' },
            badge(KIND_LABEL[e.kind] || 'Other'), badge(e.audience === 'family' ? 'Family' : 'Invited', e.audience === 'invited' ? 'is-invited' : ''),
            e.status === 'cancelled' ? badge('Cancelled', 'is-cancelled') : null,
            e.myRsvp ? badge('You: ' + rsvpWord(e.myRsvp) + (e.myRsvp.stale ? ' (check)' : ''), 'is-rsvp') : null));
        ul.appendChild(h('li', null, a));
      });
      return pane;
    }

    /* ---------- detail ---------- */
    function row(label, value) { return value ? h('div', { class: 'ev-fact' }, h('dt', { text: label }), h('dd', null, value)) : null; }
    function peopleLine(list, word) {
      var guests = 0; list.forEach(function (p) { guests += p.guests; });
      return list.length ? h('li', null, h('strong', { text: word + ' (' + list.length + ')' }), ': ', list.map(function (p, i) { return (i ? ', ' : '') + p.name + (p.guests ? ' +' + p.guests : ''); }).join('')) : null;
    }
    function detailPane(ev) {
      var pane = h('article', { class: 'ev-detail' });
      pane.appendChild(h('p', { class: 'ev-back' }, h('a', { class: 'link-btn back-btn', href: '#/calendar', text: 'Back to events' })));
      pane.appendChild(h('h2', { class: 'ev-title', 'data-focus': '', text: ev.title }));
      pane.appendChild(h('p', { class: 'ev-badges' }, badge(KIND_LABEL[ev.kind] || 'Other'), badge(ev.audience === 'family' ? 'Whole family' : 'Invited people only', ev.audience === 'invited' ? 'is-invited' : ''),
        ev.past ? badge('Past') : null));
      if (ev.status === 'cancelled') pane.appendChild(h('p', { class: 'ev-banner is-cancelled', role: 'status', text: 'This event was cancelled.' }));
      else if (ev.changedAt && !ev.past) pane.appendChild(h('p', { class: 'ev-banner', role: 'status', text: 'This event changed. Please check your answer.' }));
      var mine = ev.myRsvp, vt = C.viewerTimeText(ev, viewerTz);
      pane.appendChild(h('dl', { class: 'ev-facts' },
        row('When', C.whenText(ev)), row('In your time zone', vt),
        row('Where', ev.locationHidden ? h('span', { class: 'muted', text: 'Shared with people who answer Yes.' }) : ev.location ? ev.location : h('span', { class: 'muted', text: 'No location added.' })),
        row('Added by', ev.creatorName), row('About', ev.description ? h('span', { class: 'ev-desc', text: ev.description }) : null)));

      /* RSVP */
      var rs = h('section', { class: 'ev-rsvp card inner', 'aria-labelledby': 'ev-rsvp-h' }, h('h3', { id: 'ev-rsvp-h', text: 'Your answer' }));
      if (ev.status === 'cancelled') rs.appendChild(h('p', { class: 'muted', text: 'This event was cancelled, so answers are closed.' }));
      else if (ev.past) rs.appendChild(h('p', { class: 'muted', text: 'This event is over, so answers are closed.' }));
      else {
        if (mine && mine.stale) rs.appendChild(h('p', { class: 'ev-banner', role: 'status', text: 'You answered before this event changed. Choose again to confirm.' }));
        var cur = mine ? mine.response : '', guests = h('input', { type: 'number', id: 'ev-guests', min: 0, max: C.LIMITS.guests, step: 1, value: String(mine ? mine.guests : 0), inputmode: 'numeric' }), msg = h('p', { class: 'ev-formmsg', role: 'alert' });
        var radios = ['yes', 'maybe', 'no'].map(function (v) {
          var id = 'ev-r-' + v;
          return h('label', { class: 'ev-choice', for: id }, h('input', { type: 'radio', name: 'rsvp', id: id, value: v, checked: cur === v }), v === 'yes' ? 'Yes' : v === 'maybe' ? 'Maybe' : 'No');
        });
        function syncGuests() { var no = form.querySelector('input[name=rsvp]:checked'); no = no && no.value === 'no'; guests.disabled = !!no; if (no) guests.value = '0'; }
        var form = h('form', { class: 'ev-rsvp-form', novalidate: '', onsubmit: function (e) {
          e.preventDefault(); var ch = form.querySelector('input[name=rsvp]:checked'); msg.textContent = '';
          if (!ch) { msg.textContent = 'Choose Yes, Maybe or No.'; return; }
          var g = ch.value === 'no' ? 0 : Number(guests.value === '' ? 0 : guests.value);
          api('eventRsvp', { id: ev.id, response: ch.value, guests: g }).then(function (r) { if (!r.ok) { msg.textContent = r.message; return; } toast('Your answer was saved.'); show(r.event, 'rsvp-saved'); });
        } },
          h('fieldset', null, h('legend', { text: 'Will you come?' }), h('div', { class: 'ev-choices' }, radios)),
          h('label', { for: 'ev-guests', text: 'Guests you are bringing (0 to ' + C.LIMITS.guests + ')' }), guests,
          h('p', { class: 'hint', text: 'Guests are a number only. They do not need an account.' }), msg,
          h('button', { type: 'submit', class: 'btn', id: 'ev-rsvp-save', text: mine ? 'Update answer' : 'Save answer' }));
        form.addEventListener('change', syncGuests); rs.appendChild(form); setTimeout(syncGuests, 0);
        if (mine) rs.appendChild(h('p', { class: 'small ev-current', text: 'Your current answer: ' + rsvpWord(mine) + (mine.guests ? ', with ' + mine.guests + ' guest' + (mine.guests > 1 ? 's' : '') : '') + '.' }));
      }
      pane.appendChild(rs);

      var yes = ev.people.filter(function (p) { return p.response === 'yes'; }), maybe = ev.people.filter(function (p) { return p.response === 'maybe'; }), no = ev.people.filter(function (p) { return p.response === 'no'; });
      pane.appendChild(h('section', { class: 'ev-who', 'aria-labelledby': 'ev-who-h' }, h('h3', { id: 'ev-who-h', text: 'Who is coming' }),
        ev.people.length ? h('ul', { class: 'ev-people' }, peopleLine(yes, 'Yes'), peopleLine(maybe, 'Maybe'), peopleLine(no, 'No'),
          h('li', { class: 'muted small', text: 'Headcount saying Yes, with guests: ' + ev.counts.headcount })) : h('p', { class: 'muted', text: 'No answers yet.' })));

      /* actions */
      var act = h('div', { class: 'ev-actions' }), panel = h('div', { class: 'ev-confirm-wrap' });
      if (ev.perms.canEdit) act.appendChild(h('a', { class: 'btn secondary', id: 'ev-edit', href: '#/calendar/event/' + ev.id + '/edit', text: 'Edit event' }));
      var cbtn = null, dbtn = null;
      function confirmPanel(kind, trigger) {
        panel.textContent = '';
        var title = kind === 'cancel' ? 'Cancel this event?' : 'Delete this event for good?';
        var body = kind === 'cancel' ? 'People will see it as cancelled and answers close. This cannot be undone in this release.' : 'The event and every answer are removed for good. Cancelling instead keeps it visible as cancelled.';
        var msg = h('p', { class: 'ev-formmsg', role: 'alert' });
        var yes = h('button', { type: 'button', class: 'btn danger', id: 'ev-confirm-yes', text: kind === 'cancel' ? 'Yes, cancel the event' : 'Yes, delete it', onclick: function () {
          api(kind === 'cancel' ? 'eventCancel' : 'eventDelete', { id: ev.id }).then(function (r) {
            if (!r.ok) { msg.textContent = r.message; return; }
            if (kind === 'cancel') { toast('The event was cancelled.'); show(r.event, 'cancelled'); } else { toast('The event was deleted.'); location.hash = '#/calendar'; refresh(); }
          });
        } });
        var keep = h('button', { type: 'button', class: 'btn secondary', id: 'ev-confirm-no', text: 'Keep the event', onclick: function () { panel.textContent = ''; trigger.focus(); } });
        panel.appendChild(h('div', { class: 'ev-confirm card inner', role: 'group', 'aria-labelledby': 'ev-confirm-h' }, h('h3', { id: 'ev-confirm-h', text: title }), h('p', { text: body }), msg, h('div', { class: 'ev-actions' }, yes, keep)));
        yes.focus();
      }
      if (ev.perms.canCancel) { cbtn = h('button', { type: 'button', class: 'btn secondary', id: 'ev-cancel', text: 'Cancel event', onclick: function () { confirmPanel('cancel', cbtn); } }); act.appendChild(cbtn); }
      if (ev.perms.canDelete) { dbtn = h('button', { type: 'button', class: 'btn ghost', id: 'ev-delete', text: 'Delete event', onclick: function () { confirmPanel('delete', dbtn); } }); act.appendChild(dbtn); }
      if (act.childNodes.length) { pane.appendChild(act); pane.appendChild(panel); }
      return pane;
    }

    /* ---------- create and edit ---------- */
    function formPane(ev) {
      var editing = !!ev, members = server.members(st.familyId);
      var me = members.filter(function (m) { return m.userId === st.userId; })[0];
      var d0 = C.addDays(C.dateIn(viewerTz, now()), 7);
      var v = ev || { title: '', kind: 'dinner', allDay: false, startLocal: d0 + 'T18:00', endLocal: '', tz: C.isValidTz(viewerTz) ? viewerTz : 'America/New_York', description: '', location: '', locationAccess: 'viewers', audience: 'family', inviteeIds: [] };
      var sd = v.startLocal.slice(0, 10), stime = v.startLocal.length > 10 ? v.startLocal.slice(11) : '18:00', ed = v.endLocal ? v.endLocal.slice(0, 10) : '', etime = v.endLocal && v.endLocal.length > 10 ? v.endLocal.slice(11) : '';
      var zones = ZONES.slice(); if (!zones.some(function (z) { return z[0] === v.tz; }) && v.tz) zones.unshift([v.tz, v.tz]);
      var err = h('p', { class: 'ev-formmsg', role: 'alert', id: 'ev-err', tabindex: '-1' }), hint = h('p', { class: 'hint', role: 'status', id: 'ev-timehint' });
      var f = {};
      f.title = h('input', { type: 'text', id: 'ev-title', maxlength: C.LIMITS.title, value: v.title, autocomplete: 'off' });
      f.kind = h('select', { id: 'ev-kind' }, C.KINDS.map(function (k) { return h('option', { value: k, text: KIND_LABEL[k], selected: k === v.kind }); }));
      f.all = h('input', { type: 'checkbox', id: 'ev-allday', checked: v.allDay });
      f.sd = h('input', { type: 'date', id: 'ev-sd', value: sd }); f.st = h('input', { type: 'time', id: 'ev-st', value: stime });
      f.ed = h('input', { type: 'date', id: 'ev-ed', value: ed }); f.et = h('input', { type: 'time', id: 'ev-et', value: etime });
      f.tz = h('select', { id: 'ev-tz' }, zones.map(function (z) { return h('option', { value: z[0], text: z[1] + ' (' + z[0] + ')', selected: z[0] === v.tz }); }));
      f.desc = h('textarea', { id: 'ev-desc', maxlength: C.LIMITS.description, rows: 4 }); f.desc.value = v.description;
      f.loc = h('input', { type: 'text', id: 'ev-loc', maxlength: C.LIMITS.location, value: v.location, autocomplete: 'off' });
      function radioGroup(name, opts, cur) { return h('div', { class: 'ev-choices' }, opts.map(function (p) { var id = 'ev-' + name + '-' + p[0]; return h('label', { class: 'ev-choice', for: id }, h('input', { type: 'radio', name: name, id: id, value: p[0], checked: p[0] === cur }), p[1]); })); }
      var aud = radioGroup('audience', [['family', 'Whole family'], ['invited', 'Only people I invite']], v.audience);
      var locAcc = radioGroup('locacc', [['viewers', 'Everyone who can see the event'], ['going', 'Only people who answer Yes']], v.locationAccess);
      var picks = h('fieldset', { class: 'ev-invitees', id: 'ev-invitees' }, h('legend', { text: 'Who is invited' }),
        members.filter(function (m) { return !me || m.membershipId !== me.membershipId; }).map(function (m) {
          var id = 'ev-inv-' + m.membershipId; return h('label', { class: 'ev-choice', for: id }, h('input', { type: 'checkbox', name: 'invitee', id: id, value: m.membershipId, checked: (v.inviteeIds || []).indexOf(m.membershipId) >= 0 }), m.name);
        }), h('p', { class: 'hint', text: 'Up to ' + C.LIMITS.invitees + ' people. You can always see your own event.' }));
      function checked(name) { var c = form.querySelector('input[name=' + name + ']:checked'); return c ? c.value : ''; }
      function sync() {
        var all = f.all.checked; [f.st, f.et, f.tz].forEach(function (x) { x.closest('.ev-field').hidden = all; });
        picks.hidden = checked('audience') !== 'invited';
        hint.textContent = all ? '' : C.timeHint(f.sd.value && f.st.value ? f.sd.value + 'T' + f.st.value : '', f.tz.value);
      }
      function body() {
        var all = f.all.checked, s = all ? f.sd.value : (f.sd.value + 'T' + (f.st.value || '')), e = '';
        if (all) e = f.ed.value; else if (f.et.value || f.ed.value) e = (f.ed.value || f.sd.value) + 'T' + (f.et.value || f.st.value || '');
        return { title: f.title.value, kind: f.kind.value, allDay: all, startLocal: s, endLocal: e, tz: all ? '' : f.tz.value, description: f.desc.value, location: f.loc.value, locationAccess: checked('locacc'),
          audience: checked('audience'), inviteeIds: Array.prototype.map.call(form.querySelectorAll('input[name=invitee]:checked'), function (x) { return x.value; }) };
      }
      var saving = false;
      var form = h('form', { class: 'ev-form', novalidate: '', onsubmit: function (e) {
        e.preventDefault(); if (saving) return; err.textContent = ''; saving = true; var b = body();
        if (editing) { b.id = ev.id; b.version = ev.rev; }
        api(editing ? 'eventEdit' : 'eventCreate', b).then(function (r) {
          saving = false;
          if (!r.ok) { err.textContent = r.message; err.focus(); return; }
          toast(editing ? 'Changes saved.' : 'Event added.' ); if (r.notice) toast(r.notice);
          location.hash = '#/calendar/event/' + r.event.id; refresh();
        });
      } },
        err,
        h('div', { class: 'ev-field' }, h('label', { for: 'ev-title', text: 'Title' }), f.title),
        h('div', { class: 'ev-field' }, h('label', { for: 'ev-kind', text: 'Type' }), f.kind),
        h('div', { class: 'ev-field ev-check' }, f.all, h('label', { for: 'ev-allday', text: 'All-day event (dates only)' })),
        h('div', { class: 'ev-pair' }, h('div', { class: 'ev-field' }, h('label', { for: 'ev-sd', text: 'Starts on' }), f.sd), h('div', { class: 'ev-field' }, h('label', { for: 'ev-st', text: 'Start time' }), f.st)),
        h('div', { class: 'ev-pair' }, h('div', { class: 'ev-field' }, h('label', { for: 'ev-ed', text: 'Ends on (optional)' }), f.ed), h('div', { class: 'ev-field' }, h('label', { for: 'ev-et', text: 'End time (optional)' }), f.et)),
        h('div', { class: 'ev-field' }, h('label', { for: 'ev-tz', text: 'Time zone' }), f.tz, h('p', { class: 'hint', text: 'People in other zones also see the time on their own clock.' })),
        hint,
        h('fieldset', { class: 'ev-field' }, h('legend', { text: 'Who can see this event' }), aud), picks,
        h('div', { class: 'ev-field' }, h('label', { for: 'ev-desc', text: 'Description (optional)' }), f.desc),
        h('div', { class: 'ev-field' }, h('label', { for: 'ev-loc', text: 'Location (optional)' }), f.loc),
        h('fieldset', { class: 'ev-field' }, h('legend', { text: 'Who sees the location' }), locAcc, h('p', { class: 'hint', text: 'Do not put a home address where everyone in the family can see it.' })),
        h('div', { class: 'ev-actions' }, h('button', { type: 'submit', class: 'btn', id: 'ev-save', text: editing ? 'Save changes' : 'Add event' }),
          h('a', { class: 'btn secondary', id: 'ev-form-cancel', href: editing ? '#/calendar/event/' + ev.id : '#/calendar', text: 'Discard' })));
      form.addEventListener('change', sync); form.addEventListener('input', function (e) { if (e.target === f.st || e.target === f.sd) sync(); });
      var pane = h('section', { class: 'ev-formpane' }, h('p', { class: 'ev-back' }, h('a', { class: 'link-btn back-btn', href: editing ? '#/calendar/event/' + ev.id : '#/calendar', text: editing ? 'Back to the event' : 'Back to events' })),
        h('h2', { 'data-focus': '', text: editing ? 'Edit event' : 'New event' }), form);
      setTimeout(sync, 0);
      return pane;
    }

    /* ---------- states that replace the page ---------- */
    function blocked(r) {
      var title = r.error === 'not_member' ? 'You are not a member of this family.' : r.error === 'not_eligible' ? 'Events is not available for this account.' : r.error === 'events_off' ? 'Events is not turned on.' : 'Events could not open.';
      return h('section', { class: 'card ev-blocked', role: 'alert' }, h('h2', { 'data-focus': '', text: title }),
        h('p', { class: 'muted', text: 'This is how a refused request looks. Nothing is shown from this family.' }), h('p', null, h('a', { class: 'link-btn', href: BOARD_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Open the original Family Board' })));
    }
    function gone() {
      return h('section', { class: 'card ev-blocked', role: 'alert' }, h('h2', { 'data-focus': '', text: 'This event is not available.' }), h('p', { class: 'muted', text: 'It may have been deleted, or it is not shared with you.' }),
        h('p', null, h('a', { class: 'link-btn back-btn', href: '#/calendar', text: 'Back to events' })));
    }
    function header() {
      return h('header', { class: 'ev-head' }, h('h1', { text: 'Calendar & Chores' }),
        h('div', { class: 'ev-board card inner' }, h('p', { class: 'ev-board-line', text: 'Chores and tasks are still in the original Family Board. Nothing has been moved or copied.' }),
          h('a', { class: 'btn secondary small', id: 'ev-board', href: BOARD_URL, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open the original Family Board. Opens in a new tab. Separate sign-in may be required.' }, 'Open the original Family Board', h('span', { class: 'small muted', text: ' (new tab; separate sign-in may be required)' }))));
    }

    /* ---------- the page ---------- */
    var cache = { events: null };
    function layout(paneName, list, detail) {
      main.textContent = ''; main.appendChild(header());
      main.appendChild(h('div', { class: 'ev-layout', 'data-pane': paneName }, h('div', { class: 'ev-listpane' }, list),
        h('div', { class: 'ev-detailpane' }, detail || h('p', { class: 'muted ev-placeholder', text: 'Choose an event to see its details.' }))));
    }
    function show(ev, why) {     // draw a detail we already hold (after a save), without another request for the list
      var gen = ++st.gen; void gen; location.hash = '#/calendar/event/' + ev.id; refresh(false, why);
    }
    function refresh(keepFocus, why) {
      var gen = ++st.gen, r = route();
      api('eventList').then(function (l) {
        if (gen !== st.gen) return;
        if (!l.ok) { main.textContent = ''; main.appendChild(header()); main.appendChild(blocked(l)); focusHeading(main.querySelector('.ev-blocked')); return; }
        cache.events = l.events;
        if (r.name === 'list') { layout('list', listPane(l.events, null), null); if (!keepFocus) focusHeading(main.querySelector('.ev-listpane')); return; }
        if (r.name === 'new') { layout('detail', listPane(l.events, null), formPane(null)); focusHeading(main.querySelector('.ev-formpane')); return; }
        api('eventGet', { id: r.id }).then(function (g) {
          if (gen !== st.gen) return;
          if (!g.ok) { layout('detail', listPane(l.events, null), gone()); focusHeading(main.querySelector('.ev-blocked')); return; }
          var pane = r.name === 'edit' ? (g.event.perms.canEdit ? formPane(g.event) : h('section', { class: 'card ev-blocked', role: 'alert' }, h('h2', { 'data-focus': '', text: 'This event cannot be edited.' }), h('p', { class: 'muted', text: 'Only the person who created it can edit it, and not after it is cancelled or over.' }), h('a', { class: 'link-btn back-btn', href: '#/calendar/event/' + g.event.id, text: 'Back to the event' }))) : detailPane(g.event);
          layout('detail', listPane(l.events, g.event.id), pane); focusHeading(main.querySelector('.ev-detailpane'));
          void why;
        });
      });
    }

    window.addEventListener('hashchange', function () { refresh(); });
    drawControls(); refresh();
    return { refresh: refresh, state: st };
  }

  root.EventsUI = { mount: mount, BOARD_URL: BOARD_URL };
})(window);

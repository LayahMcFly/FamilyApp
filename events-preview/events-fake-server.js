/* Events preview: the FAKE SERVER (PREVIEW CODE, not wired into the live app).
 *
 * This is an in-memory simulation of what the proposed `family-api` event actions would enforce (EVENTS-MINIMUM-RELEASE-DESIGN.md).
 * It holds synthetic people and events only. It makes no network request, reads no real account, and nothing survives a page reload.
 * It is NOT the real server code: no Appwrite table, function or permission exists for Events. The real rules still have to be
 * built and tested against a live backend, separately and with approval.
 *
 * Every call is  server.call(userId, action, body). `userId` plays the part of the signed-in account (the real function reads it from
 * the login token), so a body can never name another person. Answers are {ok:true,...} or {ok:false,error,message}. */
(function (root, factory) {
  var C = typeof module === 'object' && module.exports ? require('./events-core.js') : root.EventsCore;
  var api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EventsFake = api;
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';
  var L = C.LIMITS, DAY = C.DAY;

  function hash32(s) {                       // preview-only stand-in for the "32-character hash of eventId and userId" row id
    var out = '', seeds = [0x811c9dc5, 0x01000193, 0x9e3779b1, 0x85ebca6b];
    for (var k = 0; k < 4; k++) { var h = seeds[k] >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } out += ('00000000' + h.toString(16)).slice(-8); }
    return out;
  }
  function fail(error, message) { return { ok: false, error: error, message: message }; }
  var NA = function () { return fail('not_available', 'This event is not available.'); };

  /* options: now() -> ms; mode: 'off' | 'test' | 'preview'; testFamilies: [familyId]; seed: false for an empty world (tests). */
  function create(options) {
    options = options || {};
    var now = options.now || function () { return Date.now(); };
    var mode = options.mode || 'preview', testFamilies = options.testFamilies || [];
    var S = { families: {}, members: [], eligible: {}, events: {}, rsvps: {}, createdLog: [], seq: 0 };
    function id(p) { S.seq += 1; return p + S.seq; }

    /* ---- administration used by the seed and by tests (not reachable through call) ---- */
    var admin = {
      addFamily: function (fid, name) { S.families[fid] = { id: fid, name: name }; },
      addMember: function (fid, uid, name, role) { var m = { id: id('m'), familyId: fid, userId: uid, name: name, role: role || 'member', status: 'confirmed' }; S.members.push(m); return m.id; },
      removeMember: function (fid, uid) { S.members.forEach(function (m) { if (m.familyId === fid && m.userId === uid && m.status === 'confirmed') m.status = 'removed'; }); },
      reinvite: function (fid, uid, name) { return admin.addMember(fid, uid, name, 'member'); },     // a NEW membership id
      setEligible: function (uid, yes) { S.eligible[uid] = !!yes; },
      setMode: function (m, fams) { mode = m; if (fams) testFamilies = fams; },
      membership: function (fid, uid) { return current(fid, uid); },
      state: S
    };
    function current(fid, uid) { for (var i = S.members.length - 1; i >= 0; i--) { var m = S.members[i]; if (m.familyId === fid && m.userId === uid && m.status === 'confirmed') return m; } return null; }

    /* The one check every action begins with (design: canUseEvents). The eligibility table here is a plain yes/no stand-in.
     * It is NOT the age-category policy, which is undecided; nothing in this file reads a birthday or guesses an age. */
    function gate(uid, fid) {
      if (mode === 'off') return fail('events_off', 'Events is not turned on.');
      if (typeof fid !== 'string' || !S.families[fid]) return fail('not_member', 'You are not a member of this family.');
      var m = current(fid, uid); if (!m) return fail('not_member', 'You are not a member of this family.');
      if (mode === 'test' && testFamilies.indexOf(fid) < 0) return fail('events_off', 'Events is not turned on for this family.');
      if (S.eligible[uid] !== true) return fail('not_eligible', 'Events is not available for this account.');
      return { ok: true, m: m };
    }
    function canSee(ev, m) { return ev.audience === 'family' || ev.creatorMembershipId === m.id || ev.invitees.indexOf(m.id) >= 0; }
    function findVisible(fid, eid, m) { var ev = S.events[eid]; if (!ev || ev.familyId !== fid || !canSee(ev, m)) return null; return ev; }
    function rsvpsOf(ev) {     // an answer counts only if the membership that gave it is still the person's current membership
      var out = [];
      Object.keys(S.rsvps).forEach(function (k) {
        var r = S.rsvps[k]; if (r.eventId !== ev.id) return;
        var cur = current(ev.familyId, r.userId); if (!cur || cur.id !== r.membershipId) return;
        out.push(r);
      });
      return out;
    }
    function vtz(b) { return C.isValidTz(b && b.viewerTz) ? b.viewerTz : 'UTC'; }
    function past(ev, b) { return C.isPast(ev, now(), vtz(b)); }

    function view(ev, m, b) {
      var rs = rsvpsOf(ev), mine = null, counts = { yes: 0, maybe: 0, no: 0, headcount: 0 }, people = [];
      rs.forEach(function (r) {
        var mm = current(ev.familyId, r.userId); counts[r.response] += 1; if (r.response === 'yes') counts.headcount += 1 + r.guests;
        var row = { membershipId: r.membershipId, name: mm.name, response: r.response, guests: r.guests, stale: !!(ev.changedAt && r.answeredAt < ev.changedAt) };
        people.push(row); if (r.membershipId === m.id) mine = row;
      });
      var isCreator = ev.creatorMembershipId === m.id, isOwner = m.role === 'owner', over = past(ev, b), cancelled = ev.status === 'cancelled';
      var locVisible = ev.location === '' || ev.locationAccess === 'viewers' || isCreator || (mine && mine.response === 'yes');
      var out = {
        id: ev.id, familyId: ev.familyId, title: ev.title, kind: ev.kind, allDay: ev.allDay, startLocal: ev.startLocal, endLocal: ev.endLocal, tz: ev.tz,
        description: ev.description, location: locVisible ? ev.location : null, locationHidden: !locVisible, locationAccess: ev.locationAccess,
        audience: ev.audience, status: ev.status, rev: ev.rev, changedAt: ev.changedAt || null, createdAt: ev.createdAt,
        creatorName: (S.members.filter(function (x) { return x.id === ev.creatorMembershipId; })[0] || {}).name || 'Someone', mine: isCreator,
        past: over, counts: counts, myRsvp: mine, people: people,
        perms: { canEdit: isCreator && !cancelled && !over, canCancel: (isCreator || isOwner) && !cancelled, canDelete: isCreator || isOwner, canRsvp: !cancelled && !over }
      };
      if (isCreator) out.inviteeIds = ev.invitees.slice();
      return out;
    }

    function activeCount(fid, b) { return Object.keys(S.events).filter(function (k) { var e = S.events[k]; return e.familyId === fid && e.status === 'active' && !past(e, b); }).length; }
    function pickInvitees(fid, ids, creatorMid) {
      if (!Array.isArray(ids)) ids = [];
      var seen = {}, out = [];
      for (var i = 0; i < ids.length; i++) {
        var mid = ids[i]; if (seen[mid] || mid === creatorMid) continue; seen[mid] = 1;
        var ok = S.members.some(function (x) { return x.id === mid && x.familyId === fid && x.status === 'confirmed'; });
        if (!ok) return { error: 'One of the people you chose is not in this family.' }; out.push(mid);
      }
      if (out.length > L.invitees) return { error: 'You can invite up to ' + L.invitees + ' people.' };
      return { ids: out };
    }

    var actions = {
      eventList: function (g, b) {
        var evs = Object.keys(S.events).map(function (k) { return S.events[k]; }).filter(function (e) { return e.familyId === b.familyId && canSee(e, g.m); });
        evs.sort(function (a, c) { return a.sortAt - c.sortAt; });
        return { ok: true, events: evs.map(function (e) { var v = view(e, g.m, b); delete v.people; return v; }) };
      },
      eventGet: function (g, b) { var ev = findVisible(b.familyId, b.id, g.m); return ev ? { ok: true, event: view(ev, g.m, b) } : NA(); },
      eventCreate: function (g, b) {
        var r = C.validateEvent(b, { nowMs: now() }); if (!r.ok) return fail('invalid', r.errors[0]);
        var inv = { ids: [] };
        if (r.value.audience === 'invited') { inv = pickInvitees(b.familyId, b.inviteeIds, g.m.id); if (inv.error) return fail('invalid', inv.error); if (!inv.ids.length) return fail('invalid', 'Choose at least one person to invite.'); }
        var since = now() - DAY; S.createdLog = S.createdLog.filter(function (x) { return x.at > since; });
        if (S.createdLog.filter(function (x) { return x.userId === g.m.userId; }).length >= L.perDay) return fail('limit', 'You can add up to ' + L.perDay + ' events a day.');
        if (activeCount(b.familyId, b) >= L.activePerFamily) return fail('limit', 'This family has reached ' + L.activePerFamily + ' upcoming events.');
        var v = r.value, ev = { id: id('e'), familyId: b.familyId, creatorId: g.m.userId, creatorMembershipId: g.m.id, title: v.title, kind: v.kind, allDay: v.allDay, startLocal: v.startLocal,
          endLocal: v.endLocal, tz: v.tz, sortAt: v.sortAt, description: v.description, location: v.location, locationAccess: v.locationAccess, audience: v.audience, invitees: inv.ids,
          status: 'active', rev: 1, changedAt: null, createdAt: now() };
        S.events[ev.id] = ev; S.createdLog.push({ userId: g.m.userId, at: now() });
        return { ok: true, event: view(ev, g.m, b), notice: v.startNote === 'first' ? 'That time happens twice that day, so the first one was used.' : '' };
      },
      eventEdit: function (g, b) {
        var ev = findVisible(b.familyId, b.id, g.m); if (!ev) return NA();
        if (ev.creatorMembershipId !== g.m.id) return fail('forbidden', 'Only the person who created this event can edit it.');
        if (ev.status === 'cancelled') return fail('closed', 'A cancelled event cannot be edited.');
        if (past(ev, b)) return fail('closed', 'A past event cannot be edited.');
        if (b.version !== ev.rev) return fail('conflict', 'This event changed while you were editing. Reload it and try again.');
        var startSame = (b.startLocal === ev.startLocal && (b.allDay === true) === ev.allDay && (b.tz || '') === ev.tz);
        var r = C.validateEvent(b, { nowMs: now(), checkLowerBound: !startSame }); if (!r.ok) return fail('invalid', r.errors[0]);
        var inv = { ids: [] };
        if (r.value.audience === 'invited') { inv = pickInvitees(b.familyId, b.inviteeIds, g.m.id); if (inv.error) return fail('invalid', inv.error); if (!inv.ids.length) return fail('invalid', 'Choose at least one person to invite.'); }
        var v = r.value;
        var material = v.allDay !== ev.allDay || v.startLocal !== ev.startLocal || v.endLocal !== ev.endLocal || v.tz !== ev.tz || v.location !== ev.location || v.audience !== ev.audience;
        var keep = inv.ids.concat([ev.creatorMembershipId]);     // an invited event: only the creator and the list keep access
        ev.title = v.title; ev.kind = v.kind; ev.allDay = v.allDay; ev.startLocal = v.startLocal; ev.endLocal = v.endLocal; ev.tz = v.tz; ev.sortAt = v.sortAt;
        ev.description = v.description; ev.location = v.location; ev.locationAccess = v.locationAccess; ev.audience = v.audience; ev.invitees = inv.ids; ev.rev += 1;
        if (material) ev.changedAt = now();
        if (v.audience === 'invited') Object.keys(S.rsvps).forEach(function (k) { var rr = S.rsvps[k]; if (rr.eventId === ev.id && keep.indexOf(rr.membershipId) < 0) delete S.rsvps[k]; });
        return { ok: true, event: view(ev, g.m, b), notice: v.startNote === 'first' ? 'That time happens twice that day, so the first one was used.' : '' };
      },
      eventCancel: function (g, b) {
        var ev = findVisible(b.familyId, b.id, g.m); if (!ev) return NA();
        if (!(ev.creatorMembershipId === g.m.id || g.m.role === 'owner')) return fail('forbidden', 'Only the creator or the family owner can cancel this event.');
        if (ev.status !== 'cancelled') { ev.status = 'cancelled'; ev.changedAt = now(); ev.rev += 1; }
        return { ok: true, event: view(ev, g.m, b) };
      },
      eventDelete: function (g, b) {
        var ev = findVisible(b.familyId, b.id, g.m); if (!ev) return NA();
        if (!(ev.creatorMembershipId === g.m.id || g.m.role === 'owner')) return fail('forbidden', 'Only the creator or the family owner can delete this event.');
        delete S.events[ev.id]; Object.keys(S.rsvps).forEach(function (k) { if (S.rsvps[k].eventId === ev.id) delete S.rsvps[k]; });
        return { ok: true };
      },
      eventRsvp: function (g, b) {
        var ev = findVisible(b.familyId, b.id, g.m); if (!ev) return NA();
        if (ev.status === 'cancelled') return fail('closed', 'This event was cancelled, so answers are closed.');
        if (past(ev, b)) return fail('closed', 'This event is over, so answers are closed.');
        if (['yes', 'no', 'maybe'].indexOf(b.response) < 0) return fail('invalid', 'Choose Yes, Maybe or No.');
        var guests = b.response === 'no' ? 0 : b.guests === undefined ? 0 : b.guests;
        if (typeof guests !== 'number' || Math.floor(guests) !== guests || guests < 0 || guests > L.guests) return fail('invalid', 'Guests can be 0 to ' + L.guests + '.');
        var key = hash32(ev.id + '|' + g.m.userId);       // one row per person per event; a second answer replaces the first
        S.rsvps[key] = { id: key, eventId: ev.id, familyId: ev.familyId, userId: g.m.userId, membershipId: g.m.id, response: b.response, guests: guests, answeredAt: now() };
        return { ok: true, event: view(ev, g.m, b) };
      }
    };

    function call(userId, action, body) {
      body = body && typeof body === 'object' ? body : {};
      if (!actions[action]) return fail('unknown_action', 'Unknown action.');
      var g = gate(userId, body.familyId); if (!g.ok) return g;
      return actions[action](g, body);
    }

    var server = { call: call, admin: admin, families: function () { return Object.keys(S.families).map(function (k) { return S.families[k]; }); },
      /* Families a person has ever had a membership record in (the preview lets a removed member try, to show the refusal). */
      familiesOf: function (uid) { var seen = {}; S.members.forEach(function (m) { if (m.userId === uid) seen[m.familyId] = 1; }); return Object.keys(seen).map(function (k) { return S.families[k]; }); },
      /* Directory used by the preview screens for the "previewing as" menu and the invite picker (the real app already shows member lists). */
      members: function (fid) { return S.members.filter(function (m) { return m.familyId === fid && m.status === 'confirmed'; }).map(function (m) { return { membershipId: m.id, userId: m.userId, name: m.name, role: m.role }; }); },
      hash32: hash32 };
    if (options.seed !== false) seed(server, now);
    return server;
  }

  /* ---- synthetic sample world: invented names, invented addresses, dates relative to today ---- */
  function seed(server, now) {
    var A = server.admin, S = A.state, today = C.dateIn('UTC', now());
    A.addFamily('famA', 'Sample Family A'); A.addFamily('famB', 'Sample Family B');
    var maya = A.addMember('famA', 'u-maya', 'Maya Sample', 'owner'), theo = A.addMember('famA', 'u-theo', 'Theo Sample'), priya = A.addMember('famA', 'u-priya', 'Priya Sample'),
      noah = A.addMember('famA', 'u-noah', 'Noah Sample'), riley = A.addMember('famA', 'u-riley', 'Riley Sample'), quinn = A.addMember('famA', 'u-quinn', 'Quinn Sample');
    var ruth = A.addMember('famB', 'u-ruth', 'Ruth Example', 'owner'), theoB = A.addMember('famB', 'u-theo', 'Theo Sample'), lena = A.addMember('famB', 'u-lena', 'Lena Example');
    A.removeMember('famA', 'u-quinn');
    ['u-maya', 'u-theo', 'u-priya', 'u-noah', 'u-quinn', 'u-ruth', 'u-lena'].forEach(function (u) { A.setEligible(u, true); });
    A.setEligible('u-riley', false);
    function ev(o) {
      var e = Object.assign({ id: 'seed-' + (++S.seq), allDay: false, invitees: [], status: 'active', rev: 1, changedAt: null, createdAt: now() - 5 * DAY, endLocal: '', tz: '', locationAccess: 'viewers', audience: 'family', description: '', location: '' }, o);
      if (e.allDay) e.sortAt = Date.UTC.apply(null, [+e.startLocal.slice(0, 4), +e.startLocal.slice(5, 7) - 1, +e.startLocal.slice(8, 10)]);
      else e.sortAt = C.localToUtc(e.startLocal, e.tz).utcMs;
      S.events[e.id] = e; return e;
    }
    function rs(e, uid, mid, response, guests, at) { var k = server.hash32(e.id + '|' + uid); S.rsvps[k] = { id: k, eventId: e.id, familyId: e.familyId, userId: uid, membershipId: mid, response: response, guests: guests, answeredAt: at || now() - 4 * DAY }; }
    var d = function (n) { return C.addDays(today, n); };

    var dinner = ev({ familyId: 'famA', creatorId: 'u-maya', creatorMembershipId: maya, title: 'Sunday dinner at Grandma\'s', kind: 'dinner', startLocal: d(3) + 'T18:00', endLocal: d(3) + 'T20:30', tz: 'America/New_York',
      description: 'Bring a side dish. We will eat around 6:30.', location: '123 Example Lane (sample address)', locationAccess: 'viewers' });
    rs(dinner, 'u-maya', maya, 'yes', 0); rs(dinner, 'u-theo', theo, 'yes', 2); rs(dinner, 'u-priya', priya, 'maybe', 1);

    var game = ev({ familyId: 'famA', creatorId: 'u-priya', creatorMembershipId: priya, title: 'Cousins\' game night', kind: 'other', startLocal: d(6) + 'T19:00', tz: 'America/New_York',
      description: 'Only the people invited can see this event.', location: 'Priya\'s place (sample)', locationAccess: 'going', audience: 'invited', invitees: [theo, maya] });
    rs(game, 'u-theo', theo, 'yes', 0);

    ev({ familyId: 'famA', creatorId: 'u-maya', creatorMembershipId: maya, title: 'Family reunion weekend', kind: 'reunion', allDay: true, startLocal: d(24), endLocal: d(26), description: 'Dates only: this shows the same days for everyone.', location: 'Sample Lake Park', locationAccess: 'viewers' });

    var grad = ev({ familyId: 'famA', creatorId: 'u-theo', creatorMembershipId: theo, title: 'Graduation party', kind: 'graduation', startLocal: d(40) + 'T14:00', tz: 'America/Los_Angeles', description: 'Held in California. Your own clock time is shown when it differs.', location: 'Sample Hall, Example City' });
    rs(grad, 'u-theo', theo, 'yes', 3);

    var changed = ev({ familyId: 'famA', creatorId: 'u-maya', creatorMembershipId: maya, title: 'Summer cookout', kind: 'holiday', startLocal: d(12) + 'T13:00', tz: 'America/New_York', description: 'The time moved from 11:00 to 1:00.', location: 'Sample backyard', changedAt: now() - 2 * 3600000, rev: 2 });
    rs(changed, 'u-priya', priya, 'yes', 1, now() - 3 * DAY);

    ev({ familyId: 'famA', creatorId: 'u-maya', creatorMembershipId: maya, title: 'Anniversary dinner', kind: 'anniversary', startLocal: d(-14) + 'T19:00', tz: 'America/New_York', description: 'A past event is read-only.', location: 'Sample restaurant' });
    ev({ familyId: 'famA', creatorId: 'u-theo', creatorMembershipId: theo, title: 'Beach trip', kind: 'vacation', allDay: true, startLocal: d(18), endLocal: d(20), status: 'cancelled', changedAt: now() - DAY, rev: 2, description: 'Cancelled because of the forecast.' });
    ev({ familyId: 'famB', creatorId: 'u-ruth', creatorMembershipId: ruth, title: 'Family B picnic', kind: 'other', startLocal: d(5) + 'T12:00', tz: 'America/Chicago', description: 'Only Sample Family B can see this.', location: 'Sample Park B' });
    void noah; void riley; void quinn; void theoB; void lena;
  }

  /* People the preview can "be". `note` is shown on screen. */
  var VIEWERS = [
    { userId: 'u-maya', name: 'Maya Sample', note: 'Family A owner. Can cancel any event in Family A.' },
    { userId: 'u-theo', name: 'Theo Sample', note: 'Member of Family A and Family B.' },
    { userId: 'u-priya', name: 'Priya Sample', note: 'Member of Family A. Created the invited game night.' },
    { userId: 'u-noah', name: 'Noah Sample', note: 'Member of Family A. Not invited to the game night.' },
    { userId: 'u-riley', name: 'Riley Sample', note: 'A member whose account has no Events access (a stand-in switch, not an age rule).' },
    { userId: 'u-quinn', name: 'Quinn Sample', note: 'Removed from Family A. Every request is refused.' },
    { userId: 'u-ruth', name: 'Ruth Example', note: 'Family B owner. Cannot see anything in Family A.' }
  ];
  return { create: create, VIEWERS: VIEWERS, hash32: hash32 };
});

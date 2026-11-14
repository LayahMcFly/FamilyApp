/* Events preview: rule tests against the FAKE server (class B evidence: a simulation, not the real function and not a live backend).
 * Run:  node --test tests/events/        No dependencies. Nothing here touches a network or any Appwrite project. */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../events-preview/events-core.js');
const F = require('../../events-preview/events-fake-server.js');

let NOW = Date.parse('2026-11-13T17:00:00Z');
const DAY = 86400000;
function world(opts) {
  const s = F.create(Object.assign({ now: () => NOW, seed: false }, opts || {}));
  const a = s.admin;
  a.addFamily('A', 'Family A'); a.addFamily('B', 'Family B');
  const m = { own: a.addMember('A', 'u-own', 'Olive Owner', 'owner'), p: a.addMember('A', 'u-p', 'Pat'), q: a.addMember('A', 'u-q', 'Quinn'), r: a.addMember('A', 'u-r', 'Rae'),
    x: a.addMember('B', 'u-x', 'Xavier'), both: a.addMember('A', 'u-both', 'Bo'), bothB: a.addMember('B', 'u-both', 'Bo') };
  ['u-own', 'u-p', 'u-q', 'u-r', 'u-x', 'u-both'].forEach(u => a.setEligible(u, true));
  return { s, a, m };
}
const body = (o) => Object.assign({ familyId: 'A', title: 'Dinner', kind: 'dinner', allDay: false, startLocal: '2026-12-05T18:00', endLocal: '', tz: 'America/New_York', description: '', location: '', locationAccess: 'viewers', audience: 'family', inviteeIds: [], viewerTz: 'America/New_York' }, o || {});
const mk = (s, uid, o) => { const r = s.call(uid, 'eventCreate', body(o)); assert.equal(r.ok, true, JSON.stringify(r)); return r.event; };
const call = (s, uid, act, o) => s.call(uid, act, Object.assign({ familyId: 'A', viewerTz: 'America/New_York' }, o || {}));

/* ---------------- core: time rules ---------------- */
test('core: calendar dates and times are parsed strictly', () => {
  assert.equal(C.parseLocal('2027-02-30'), null); assert.equal(C.parseLocal('2027-13-01'), null); assert.equal(C.parseLocal('2027-01-01T24:00'), null); assert.equal(C.parseLocal('2027-1-1'), null);
  assert.equal(C.parseLocal('2028-02-29').date, '2028-02-29'); assert.equal(C.parseLocal('2027-06-06T14:05').mi, 5);
});
test('core: spring-forward gap, fall-back ambiguity and an ordinary time', () => {
  assert.equal(C.localToUtc('2027-03-14T02:30', 'America/New_York').status, 'gap');
  const amb = C.localToUtc('2027-11-07T01:30', 'America/New_York');
  assert.equal(amb.status, 'ambiguous'); assert.equal(new Date(amb.utcMs).toISOString(), '2027-11-07T05:30:00.000Z', 'first occurrence is daylight time (UTC-4)');
  const ok = C.localToUtc('2027-06-06T14:00', 'America/New_York'); assert.equal(ok.status, 'ok'); assert.equal(new Date(ok.utcMs).toISOString(), '2027-06-06T18:00:00.000Z');
  assert.equal(C.localToUtc('2027-06-06T14:00', 'Not/AZone').status, 'invalid');
});
test('core: a half-hour zone and a zone without daylight saving behave', () => {
  assert.equal(new Date(C.localToUtc('2027-06-06T12:00', 'Asia/Kolkata').utcMs).toISOString(), '2027-06-06T06:30:00.000Z');
  assert.equal(C.localToUtc('2027-03-14T02:30', 'America/Phoenix').status, 'ok');
});
test('core: same wall time before and after daylight saving gives different UTC instants', () => {
  const a = C.localToUtc('2027-03-13T12:00', 'America/New_York').utcMs, b = C.localToUtc('2027-03-15T12:00', 'America/New_York').utcMs;
  assert.equal(b - a, 47 * 3600000, 'two noon times are 47 hours apart across spring-forward');
});
test('core: display shows the stored wall time and zone; the viewer clock appears only when it differs', () => {
  const ev = { allDay: false, startLocal: '2027-06-06T14:00', endLocal: '2027-06-06T16:00', tz: 'America/New_York' };
  assert.match(C.whenText(ev), /2:00 PM to 4:00 PM EDT \(America\/New_York\)/);
  assert.match(C.viewerTimeText(ev, 'America/Los_Angeles'), /11:00 AM PDT/);
  assert.equal(C.viewerTimeText(ev, 'America/Toronto'), '', 'Toronto shares the offset, nothing extra to show');
  assert.equal(C.viewerTimeText({ allDay: true, startLocal: '2027-06-06', tz: '' }, 'Asia/Tokyo'), '');
  assert.match(C.whenText({ allDay: true, startLocal: '2027-06-06', endLocal: '2027-06-08', tz: '' }), /Jun 6, 2027 to Tue, Jun 8, 2027 \(all day\)|Jun 6, 2027 to .*Jun 8, 2027 \(all day\)/);
});
test('core: the form hints for a missing or doubled time', () => {
  assert.match(C.timeHint('2027-03-14T02:30', 'America/New_York'), /does not exist/); assert.match(C.timeHint('2027-11-07T01:30', 'America/New_York'), /happens twice/); assert.equal(C.timeHint('2027-06-06T14:00', 'America/New_York'), '');
});

/* ---------------- 1. isolation ---------------- */
test('1 isolation: a member of family B cannot list, get, answer, edit, cancel or delete family A events', () => {
  const { s } = world(); const ev = mk(s, 'u-own');
  for (const act of ['eventList', 'eventGet', 'eventRsvp', 'eventEdit', 'eventCancel', 'eventDelete']) {
    const r = call(s, 'u-x', act, { id: ev.id, response: 'yes', guests: 0, version: 1 }); assert.equal(r.ok, false, act); assert.equal(r.error, 'not_member', act);
    const viaB = s.call('u-x', act, { familyId: 'B', id: ev.id, response: 'yes', guests: 0, version: 1, viewerTz: 'UTC' });
    if (act !== 'eventList') { assert.equal(viaB.ok, false, act + ' via own family'); assert.equal(viaB.error, 'not_available', act + ' via own family'); }
  }
});
test('1 isolation: a person in both families sees each family\'s events only in that family', () => {
  const { s } = world(); mk(s, 'u-own', { title: 'A only' });
  const rb = s.call('u-x', 'eventCreate', body({ familyId: 'B', title: 'B only' })); assert.equal(rb.ok, true);
  const la = call(s, 'u-both', 'eventList').events.map(e => e.title), lb = s.call('u-both', 'eventList', { familyId: 'B' }).events.map(e => e.title);
  assert.deepEqual(la, ['A only']); assert.deepEqual(lb, ['B only']);
});

/* ---------------- 2. direct by ID ---------------- */
test('2 direct-by-ID: unknown, other-family, hidden and deleted ids all give the same answer; a body cannot name another person', () => {
  const { s, m } = world(); const inv = mk(s, 'u-own', { audience: 'invited', inviteeIds: [m.p] }), del = mk(s, 'u-own', { title: 'gone' });
  assert.equal(call(s, 'u-own', 'eventDelete', { id: del.id }).ok, true);
  const bEv = s.call('u-x', 'eventCreate', body({ familyId: 'B' })).event;
  const answers = [call(s, 'u-q', 'eventGet', { id: 'nope' }), call(s, 'u-q', 'eventGet', { id: inv.id }), call(s, 'u-q', 'eventGet', { id: del.id }), call(s, 'u-q', 'eventGet', { id: bEv.id })];
  answers.forEach(a => assert.deepEqual(a, answers[0])); assert.equal(answers[0].error, 'not_available');
  const open = mk(s, 'u-own', { title: 'open' });
  const r = call(s, 'u-q', 'eventRsvp', { id: open.id, response: 'yes', guests: 0, userId: 'u-p', membershipId: m.p });
  assert.equal(r.ok, true); const people = call(s, 'u-q', 'eventGet', { id: open.id }).event.people;
  assert.deepEqual(people.map(p => p.name), ['Quinn'], 'the answer is Quinn\'s own, whatever the body says');
});

/* ---------------- 3. invited audience and location ---------------- */
test('3 invited: a non-invitee gets "not available" from list, get and answer; the creator and invitees see it', () => {
  const { s, m } = world(); const ev = mk(s, 'u-own', { audience: 'invited', inviteeIds: [m.p] });
  assert.equal(call(s, 'u-q', 'eventList').events.length, 0);
  assert.equal(call(s, 'u-q', 'eventGet', { id: ev.id }).error, 'not_available');
  assert.equal(call(s, 'u-q', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 }).error, 'not_available');
  assert.equal(call(s, 'u-p', 'eventList').events.length, 1); assert.equal(call(s, 'u-own', 'eventList').events.length, 1);
  assert.equal(call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 1 }).ok, true);
});
test('3 invited: the invite list only holds confirmed members of this family, at least one, at most 50', () => {
  const { s, m } = world();
  assert.match(s.call('u-own', 'eventCreate', body({ audience: 'invited', inviteeIds: [m.x] })).message, /not in this family/);
  assert.match(s.call('u-own', 'eventCreate', body({ audience: 'invited', inviteeIds: [] })).message, /at least one/);
  for (let i = 0; i < 51; i++) { s.admin.addMember('A', 'bulk' + i, 'Bulk ' + i); }
  const ids = s.members('A').filter(x => x.userId.startsWith('bulk')).map(x => x.membershipId);
  assert.match(s.call('u-own', 'eventCreate', body({ audience: 'invited', inviteeIds: ids })).message, /up to 50/);
  assert.equal(s.call('u-own', 'eventCreate', body({ audience: 'invited', inviteeIds: ids.slice(0, 50) })).ok, true);
});
test('3 location: "only people who answer Yes" leaves the location out for everyone else', () => {
  const { s } = world(); const ev = mk(s, 'u-own', { location: '12 Sample St', locationAccess: 'going' });
  let v = call(s, 'u-p', 'eventGet', { id: ev.id }).event; assert.equal(v.location, null); assert.equal(v.locationHidden, true);
  assert.equal(call(s, 'u-p', 'eventList').events[0].location, null, 'also left out of the list');
  assert.equal(call(s, 'u-own', 'eventGet', { id: ev.id }).event.location, '12 Sample St', 'the creator sees it');
  call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'maybe', guests: 0 }); assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id }).event.location, null, 'Maybe is not Yes');
  call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 }); assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id }).event.location, '12 Sample St');
  const open = mk(s, 'u-own', { location: 'Park', locationAccess: 'viewers' }); assert.equal(call(s, 'u-q', 'eventGet', { id: open.id }).event.location, 'Park');
});

/* ---------------- 4. removal and re-invite ---------------- */
test('4 removal: a removed member is refused at the next call', () => {
  const { s, a } = world(); const ev = mk(s, 'u-own'); a.removeMember('A', 'u-p');
  for (const act of ['eventList', 'eventGet', 'eventRsvp', 'eventCreate']) assert.equal(call(s, 'u-p', act, Object.assign({ id: ev.id, response: 'yes', guests: 0 }, body())).error, 'not_member', act);
});
test('4 re-invite: new membership id, not on old invite lists, old answer ignored, no edit rights over old events', () => {
  const { s, a, m } = world();
  const invited = mk(s, 'u-own', { audience: 'invited', inviteeIds: [m.p] }), family = mk(s, 'u-own', { title: 'family one' }), theirs = mk(s, 'u-p', { title: 'made by Pat' }), theirsInv = mk(s, 'u-p', { title: 'invited by Pat', audience: 'invited', inviteeIds: [m.q] });
  assert.equal(call(s, 'u-p', 'eventRsvp', { id: family.id, response: 'yes', guests: 2 }).ok, true);
  a.removeMember('A', 'u-p'); const again = a.reinvite('A', 'u-p', 'Pat'); assert.notEqual(again, m.p);
  assert.equal(call(s, 'u-p', 'eventGet', { id: invited.id }).error, 'not_available', 'not on the old invite list');
  const fam = call(s, 'u-p', 'eventGet', { id: family.id }).event; assert.equal(fam.myRsvp, null); assert.equal(fam.counts.yes, 0, 'old answer ignored');
  assert.equal(call(s, 'u-p', 'eventEdit', Object.assign(body({ id: theirs.id, version: 1, title: 'hijack' }))).ok, false, 'no edit rights over the old event');
  assert.equal(call(s, 'u-p', 'eventCancel', { id: theirs.id }).ok, false, 'a plain member cannot cancel it either');
  assert.equal(call(s, 'u-p', 'eventGet', { id: theirsInv.id }).error, 'not_available', 'an invited event the old membership made is hidden');
});

/* ---------------- 5. the on/off gate ---------------- */
test('5 gate: off refuses everyone; test admits only named families; preview follows the yes/no table', () => {
  const w = world({ mode: 'off' }); for (const u of ['u-own', 'u-p']) assert.equal(call(w.s, u, 'eventList').error, 'events_off');
  const t = world({ mode: 'test', testFamilies: ['B'] }); assert.equal(call(t.s, 'u-own', 'eventList').error, 'events_off'); assert.equal(t.s.call('u-x', 'eventList', { familyId: 'B' }).ok, true);
  const p = world(); p.a.setEligible('u-q', false); assert.equal(call(p.s, 'u-q', 'eventList').error, 'not_eligible'); assert.equal(call(p.s, 'u-p', 'eventList').ok, true);
  p.a.setEligible('u-nobody', true); assert.equal(call(p.s, 'u-nobody', 'eventList').error, 'not_member', 'eligibility never makes someone a member');
  p.a.addMember('A', 'u-unmarked', 'No mark'); assert.equal(call(p.s, 'u-unmarked', 'eventList').error, 'not_eligible', 'no mark means no access; nobody is classified silently');
});

/* ---------------- 6. permissions ---------------- */
test('6 permissions: only the creator edits; creator or owner cancels and deletes; the owner cannot edit; a member can do none', () => {
  const { s } = world(); const ev = mk(s, 'u-p', { title: 'Pat\'s' });
  assert.equal(call(s, 'u-q', 'eventEdit', body({ id: ev.id, version: 1 })).error, 'forbidden');
  assert.equal(call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: 1 })).error, 'forbidden', 'the owner cannot edit someone else\'s event');
  assert.equal(call(s, 'u-q', 'eventCancel', { id: ev.id }).error, 'forbidden'); assert.equal(call(s, 'u-q', 'eventDelete', { id: ev.id }).error, 'forbidden');
  const v = call(s, 'u-own', 'eventGet', { id: ev.id }).event.perms; assert.deepEqual(v, { canEdit: false, canCancel: true, canDelete: true, canRsvp: true });
  assert.equal(call(s, 'u-p', 'eventEdit', body({ id: ev.id, version: 1, title: 'Renamed' })).ok, true);
  assert.equal(call(s, 'u-own', 'eventCancel', { id: ev.id }).ok, true); assert.equal(call(s, 'u-own', 'eventDelete', { id: ev.id }).ok, true);
});

/* ---------------- 7. RSVP ---------------- */
test('7 RSVP: one row per person per event, even with two answers at once; the last answer wins', () => {
  const { s, a } = world(); const ev = mk(s, 'u-own');
  call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 2 }); call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'maybe', guests: 1 });
  assert.equal(Object.keys(a.state.rsvps).length, 1); const v = call(s, 'u-p', 'eventGet', { id: ev.id }).event; assert.equal(v.myRsvp.response, 'maybe'); assert.equal(v.counts.maybe, 1); assert.equal(v.counts.yes, 0);
  assert.equal(Object.keys(a.state.rsvps)[0].length, 32, 'row id is 32 characters');
});
test('7 RSVP: guests 0 to 10, forced to 0 with No; bad values refused', () => {
  const { s } = world(); const ev = mk(s, 'u-own');
  for (const g of [-1, 11, 1.5, '2', null, NaN]) assert.equal(call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: g }).error, 'invalid', String(g));
  assert.equal(call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 10 }).ok, true);
  assert.equal(call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'no', guests: 7 }).event.myRsvp.guests, 0);
  assert.equal(call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'perhaps', guests: 0 }).error, 'invalid');
  assert.equal(call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes' }).event.myRsvp.guests, 0, 'missing guests means 0');
});
test('7 RSVP: headcount counts Yes answers with their guests; answers close after cancellation and when the event is over', () => {
  const { s } = world(); const ev = mk(s, 'u-own');
  call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 2 }); call(s, 'u-q', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 }); call(s, 'u-r', 'eventRsvp', { id: ev.id, response: 'maybe', guests: 5 });
  assert.equal(call(s, 'u-own', 'eventGet', { id: ev.id }).event.counts.headcount, 4);
  call(s, 'u-own', 'eventCancel', { id: ev.id }); assert.equal(call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'no', guests: 0 }).error, 'closed');
  const gone = mk(s, 'u-own', { title: 'soon' }); NOW += 40 * DAY; assert.equal(call(s, 'u-p', 'eventRsvp', { id: gone.id, response: 'yes', guests: 0 }).error, 'closed'); NOW -= 40 * DAY;
});

/* ---------------- 8. time ---------------- */
test('8 time: all-day events keep their dates for every viewer; "past" follows the viewer\'s local date', () => {
  const { s } = world(); const ev = mk(s, 'u-own', { allDay: true, startLocal: '2026-11-13', endLocal: '', tz: '' });
  for (const tz of ['Pacific/Kiritimati', 'America/New_York', 'Pacific/Pago_Pago']) assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id, viewerTz: tz }).event.startLocal, '2026-11-13');
  assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id, viewerTz: 'Pacific/Kiritimati' }).event.past, true, 'already Nov 14 there');
  assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id, viewerTz: 'Pacific/Pago_Pago' }).event.past, false, 'still Nov 13 there');
});
test('8 time: a timed event keeps its wall time and zone; spring-forward and fall-back weeks hold', () => {
  const { s } = world();
  const a = mk(s, 'u-own', { startLocal: '2027-03-13T12:00' }), b = mk(s, 'u-own', { startLocal: '2027-03-15T12:00' });
  for (const e of [a, b]) assert.match(call(s, 'u-p', 'eventGet', { id: e.id }).event.startLocal, /T12:00$/);
  assert.match(C.whenText(call(s, 'u-p', 'eventGet', { id: a.id }).event), /EST/); assert.match(C.whenText(call(s, 'u-p', 'eventGet', { id: b.id }).event), /EDT/);
  const c = mk(s, 'u-own', { startLocal: '2027-11-06T12:00' }), d = mk(s, 'u-own', { startLocal: '2027-11-08T12:00' });
  assert.match(C.whenText(call(s, 'u-p', 'eventGet', { id: c.id }).event), /EDT/); assert.match(C.whenText(call(s, 'u-p', 'eventGet', { id: d.id }).event), /EST/);
});
test('8 time: a nonexistent time is refused; an ambiguous time takes the first occurrence and says so', () => {
  const { s } = world(); assert.match(s.call('u-own', 'eventCreate', body({ startLocal: '2027-03-14T02:30' })).message, /does not exist/);
  const r = s.call('u-own', 'eventCreate', body({ startLocal: '2027-11-07T01:30' })); assert.equal(r.ok, true); assert.match(r.notice, /first one was used/);
  assert.equal(s.admin.state.events[r.event.id].sortAt, Date.parse('2027-11-07T05:30:00Z'));
});
test('8 time: invalid zone, end before start, over 14 days, impossible dates and out-of-range dates are refused', () => {
  const { s } = world(); const bad = (o, re) => assert.match(s.call('u-own', 'eventCreate', body(o)).message, re);
  bad({ tz: 'Mars/Base' }, /time zone/); bad({ endLocal: '2026-12-05T17:00' }, /end must be after/); bad({ endLocal: '2026-12-05T18:00' }, /end must be after/);
  bad({ endLocal: '2026-12-20T18:00' }, /at most 14 days/); bad({ startLocal: '2026-02-30T10:00' }, /start/); bad({ startLocal: '2026-11-10T18:00' }, /yesterday/);
  bad({ startLocal: '2032-12-05T18:00' }, /5 years/); bad({ allDay: true, startLocal: '2026-11-10', endLocal: '', tz: '' }, /yesterday/); bad({ allDay: true, startLocal: '2026-12-05', endLocal: '2026-12-01', tz: '' }, /last day/);
  bad({ allDay: true, startLocal: '2026-12-05T10:00', tz: '' }, /dates only/); bad({ startLocal: '2026-12-05' }, /needs a time/);
  assert.equal(s.call('u-own', 'eventCreate', body({ endLocal: '2026-12-19T18:00' })).ok, true, '14 days exactly is allowed');
  assert.equal(s.call('u-own', 'eventCreate', body({ startLocal: '2026-11-12T20:00' })).ok, true, 'yesterday evening is allowed');
});

/* ---------------- 9. change and cancel ---------------- */
test('9 change: a title-only edit does not mark the event changed; a time, place or audience change does', () => {
  const { s, m } = world(); const ev = mk(s, 'u-own'); let v = ev.rev;
  let r = call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: v, title: 'New title', description: 'new words' })); assert.equal(r.ok, true); assert.equal(r.event.changedAt, null); v = r.event.rev;
  r = call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: v, title: 'New title', description: 'new words', startLocal: '2026-12-05T19:00' })); assert.ok(r.event.changedAt); v = r.event.rev;
  call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 }); NOW += 1000;
  r = call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: v, title: 'New title', description: 'new words', startLocal: '2026-12-05T19:00', location: 'Somewhere new' })); assert.ok(r.event.changedAt); v = r.event.rev;
  assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id }).event.myRsvp.stale, true, 'answered before the change'); NOW -= 1000;
  call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 }); NOW += 1000; void m;
});
test('9 change: a stale answer is marked until the person answers again', () => {
  const { s } = world(); const ev = mk(s, 'u-own'); call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 });
  NOW += 5000; call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: 1, startLocal: '2026-12-06T18:00' }));
  assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id }).event.myRsvp.stale, true); NOW += 5000;
  call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 }); assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id }).event.myRsvp.stale, false);
});
test('9 conflict: an edit made from an older copy is refused', () => {
  const { s } = world(); const ev = mk(s, 'u-own'); assert.equal(call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: 1, title: 'one' })).ok, true);
  const r = call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: 1, title: 'two' })); assert.equal(r.error, 'conflict');
});
test('9 audience change: dropping an invitee deletes their answer and hides the event; switching to invited does the same to everyone not on the list', () => {
  const { s, m } = world(); const ev = mk(s, 'u-own', { audience: 'invited', inviteeIds: [m.p, m.q] });
  call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 }); call(s, 'u-q', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 });
  assert.equal(call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: 1, audience: 'invited', inviteeIds: [m.q] })).ok, true);
  assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id }).error, 'not_available'); assert.equal(Object.keys(s.admin.state.rsvps).length, 1);
  const fam = mk(s, 'u-own', { title: 'open' }); call(s, 'u-r', 'eventRsvp', { id: fam.id, response: 'yes', guests: 0 }); call(s, 'u-p', 'eventRsvp', { id: fam.id, response: 'yes', guests: 0 });
  assert.equal(call(s, 'u-own', 'eventEdit', body({ id: fam.id, version: 1, audience: 'invited', inviteeIds: [m.p] })).ok, true);
  assert.equal(call(s, 'u-r', 'eventGet', { id: fam.id }).error, 'not_available'); assert.equal(call(s, 'u-p', 'eventGet', { id: fam.id }).event.myRsvp.response, 'yes');
});
test('9 cancel: marks cancelled and changed, freezes answers, is repeatable, and blocks edits', () => {
  const { s } = world(); const ev = mk(s, 'u-own'); call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 1 });
  let r = call(s, 'u-own', 'eventCancel', { id: ev.id }); assert.equal(r.event.status, 'cancelled'); assert.ok(r.event.changedAt); const rev = r.event.rev;
  assert.equal(call(s, 'u-own', 'eventCancel', { id: ev.id }).event.rev, rev, 'second cancel changes nothing');
  assert.equal(call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: rev })).error, 'closed');
  assert.equal(call(s, 'u-p', 'eventGet', { id: ev.id }).event.myRsvp.response, 'yes', 'answers are kept');
});
test('9 past events: read-only except cancel and delete', () => {
  const { s } = world(); const ev = mk(s, 'u-own'); NOW += 40 * DAY;
  assert.equal(call(s, 'u-own', 'eventEdit', body({ id: ev.id, version: 1 })).error, 'closed'); assert.equal(call(s, 'u-own', 'eventCancel', { id: ev.id }).ok, true); assert.equal(call(s, 'u-own', 'eventDelete', { id: ev.id }).ok, true); NOW -= 40 * DAY;
});
test('9 delete: removes the event and its answers for good', () => {
  const { s } = world(); const ev = mk(s, 'u-own'); call(s, 'u-p', 'eventRsvp', { id: ev.id, response: 'yes', guests: 0 });
  assert.equal(call(s, 'u-own', 'eventDelete', { id: ev.id }).ok, true); assert.equal(Object.keys(s.admin.state.rsvps).length, 0); assert.equal(call(s, 'u-own', 'eventGet', { id: ev.id }).error, 'not_available');
});

/* ---------------- 10. limits and text ---------------- */
test('10 limits: the 21st new event in a day and the 301st upcoming event in a family are refused', () => {
  const { s } = world(); for (let i = 0; i < 20; i++) assert.equal(s.call('u-p', 'eventCreate', body({ title: 'e' + i })).ok, true, 'event ' + i);
  assert.equal(s.call('u-p', 'eventCreate', body()).error, 'limit'); assert.equal(s.call('u-q', 'eventCreate', body()).ok, true, 'another person is not affected');
  NOW += 25 * 3600000; assert.equal(s.call('u-p', 'eventCreate', body()).ok, true, 'a day later it works again'); NOW -= 25 * 3600000;
  const w = world(); for (let i = 0; i < 300; i++) w.s.admin.state.events['x' + i] = { id: 'x' + i, familyId: 'A', status: 'active', allDay: false, startLocal: '2026-12-05T18:00', endLocal: '', tz: 'UTC', invitees: [], audience: 'family', sortAt: 1 };
  assert.equal(w.s.call('u-p', 'eventCreate', body()).error, 'limit');
});
test('10 text limits: 80, 1000 and 200 characters', () => {
  const { s } = world(); const t = (o, re) => assert.match(s.call('u-own', 'eventCreate', body(o)).message, re);
  t({ title: 'x'.repeat(81) }, /80/); t({ title: '   ' }, /title/); t({ description: 'x'.repeat(1001) }, /1000/); t({ location: 'x'.repeat(201) }, /200/); t({ kind: 'party' }, /type/); t({ audience: 'everyone' }, /who can see/); t({ locationAccess: 'nobody' }, /location/);
  assert.equal(s.call('u-own', 'eventCreate', body({ title: 'x'.repeat(80), description: 'x'.repeat(1000), location: 'x'.repeat(200) })).ok, true);
});
test('10 text: markup typed into a field is stored and returned as plain text, unchanged', () => {
  const { s } = world(); const ev = mk(s, 'u-own', { title: '<img src=x onerror=alert(1)>', description: '<script>1</script>' });
  const v = call(s, 'u-p', 'eventGet', { id: ev.id }).event; assert.equal(v.title, '<img src=x onerror=alert(1)>'); assert.equal(v.description, '<script>1</script>');
});

/* ---------------- the seeded sample world used by the preview ---------------- */
test('sample world: invented people only, a removed member, a no-access member, two families, past and cancelled events', () => {
  const s = F.create({ now: () => NOW }); const names = F.VIEWERS.map(v => v.name).join(' ');
  assert.doesNotMatch(names, /@|\d{3}/); F.VIEWERS.forEach(v => assert.match(v.name, /Sample|Example/));
  assert.equal(s.call('u-quinn', 'eventList', { familyId: 'famA' }).error, 'not_member'); assert.equal(s.call('u-riley', 'eventList', { familyId: 'famA' }).error, 'not_eligible');
  const maya = s.call('u-maya', 'eventList', { familyId: 'famA', viewerTz: 'America/New_York' }).events; assert.ok(maya.some(e => e.past) && maya.some(e => e.status === 'cancelled') && maya.some(e => e.audience === 'invited') && maya.some(e => e.allDay));
  assert.equal(s.call('u-noah', 'eventList', { familyId: 'famA' }).events.some(e => e.audience === 'invited'), false);
  assert.equal(s.call('u-ruth', 'eventList', { familyId: 'famA' }).error, 'not_member');
  assert.deepEqual(s.call('u-theo', 'eventList', { familyId: 'famB' }).events.map(e => e.title), ['Family B picnic']);
});

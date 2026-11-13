import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createApi, TABLES } from '../src/logic.js';
import { CHAT_TABLES, CHAT_LIMITS, DEFAULT_CHANNELS } from '../src/chat.js';
const EXTRA_CFG = {};   // tests put stand-ins for the outside world here (link preview fetcher, GIF service)

/* ---------- in-memory fake of the server services (queries, unique keys, permissions) ---------- */
function makeWorld() {
  let seq = 0;
  const world = { tables: {}, teams: {}, clock: 1_800_000_000_000 };
  world.files = {};
  world.storage = {
    async getFile({ fileId }) { const f = world.files[fileId]; if (!f) { const e = new Error('nf'); e.code = 404; throw e; } return f; },
    async updateFile({ fileId, permissions }) { world.files[fileId].$permissions = permissions; return world.files[fileId]; },
    async deleteFile({ fileId }) { delete world.files[fileId]; },
  };
  for (const t of [...Object.values(TABLES), ...Object.values(CHAT_TABLES)]) world.tables[t] = new Map();
  const err = (code, m) => Object.assign(new Error(m), { code });
  const UNIQUE = ['sendKey', 'channelKey', 'dmKey', 'reactionKey', 'blockKey', 'readKey', 'profileKey'];
  const match = (r, q) => {
    switch (q.method) {
      case 'equal': return q.values.includes(q.attribute === '$id' ? r.$id : r[q.attribute]);
      case 'notEqual': return !q.values.includes(r[q.attribute]);
      case 'greaterThan': return String(r[q.attribute]) > String(q.values[0]);
      case 'lessThan': return String(r[q.attribute]) < String(q.values[0]);
      case 'or': return q.values.some((v) => match(r, v));
      default: return true;
    }
  };
  const db = {
    async createRow({ tableId, rowId, data, permissions }) {
      const t = world.tables[tableId];
      if (!t) throw err(404, 'no table');
      const id = rowId === 'unique()' || rowId.startsWith('uniq') ? `r${++seq}` : rowId;
      for (const k of UNIQUE) if (data[k] !== undefined && [...t.values()].some((r) => r[k] === data[k])) throw err(409, 'unique');
      const row = { ...data, $id: id, $permissions: (permissions || []).slice(), $createdAt: new Date(world.clock + ++seq * 1000).toISOString() };
      t.set(id, row);
      return row;
    },
    async getRow({ tableId, rowId }) { const r = world.tables[tableId].get(rowId); if (!r) throw err(404, 'nope'); return r; },
    async updateRow({ tableId, rowId, data, permissions }) { if (world.failProfileUpdate && tableId === TABLES.profiles) { const e = new Error('simulated outage'); e.code = 500; throw e; } const r = await db.getRow({ tableId, rowId }); Object.assign(r, data || {}); if (permissions) r.$permissions = permissions.slice(); return r; },
    async deleteRow({ tableId, rowId }) { await db.getRow({ tableId, rowId }); world.tables[tableId].delete(rowId); return {}; },
    async listRows({ tableId, queries = [] }) {
      const t = world.tables[tableId];
      if (!t) throw err(404, 'no table');
      let rows = [...t.values()];
      let limit = 25, order = null, cursor = null;
      for (const raw of queries) {
        const q = JSON.parse(raw);
        if (q.method === 'limit') limit = q.values[0];
        else if (q.method === 'orderDesc' || q.method === 'orderAsc') order = q;
        else if (q.method === 'cursorAfter') cursor = q.values[0];
        else rows = rows.filter((r) => match(r, q));
      }
      if (order) rows.sort((a, b) => String(a[order.attribute]).localeCompare(String(b[order.attribute])) * (order.method === 'orderDesc' ? -1 : 1));
      if (cursor) rows = rows.slice(rows.findIndex((r) => r.$id === cursor) + 1);
      return { total: rows.length, rows: rows.slice(0, limit) };
    }
  };
  const users = {
    async listMemberships({ userId }) {
      const out = [];
      for (const [teamId, t] of Object.entries(world.teams)) for (const m of t.members) if (m.userId === userId) out.push({ teamId, teamName: t.name, userId, roles: m.roles, confirm: m.confirm });
      return { memberships: out };
    },
    async updateLabels() { return {}; }
  };
  const teams = {
    async getPrefs({ teamId }) { return { ...(world.teams[teamId].prefs || {}) }; },
    async updatePrefs({ teamId, prefs }) { world.teams[teamId].prefs = { ...prefs }; return prefs; },
    async listMemberships({ teamId }) { return { memberships: world.teams[teamId].members.map((m) => ({ ...m, teamId })) }; },
    async delete() { return {}; }
  };
  const api = createApi({ users, teams, db, storage: world.storage, cfg: { databaseId: 'family', bucketId: 'b', maxOwnedFamilies: 3, maxVideoMB: 15, familyStorageMB: 500, ...EXTRA_CFG }, now: () => world.clock + seq * 1000 + 500 });
  const U = (id) => ({ $id: id, emailVerification: true, status: true, labels: [] });
  const call = async (uid, action, body = {}) => { const r = await api.handle({ user: U(uid), body: { action, ...body }, deadline: Number.MAX_SAFE_INTEGER }); return r; };
  const ok = async (uid, action, body) => { const r = await call(uid, action, body); assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`); return r.json; };
  const fail = async (uid, action, body, status, code) => { const r = await call(uid, action, body); assert.equal(r.status, status, `${action} should fail ${status}: ${JSON.stringify(r.json)}`); if (code) assert.equal(r.json.error, code); return r.json; };
  const addFamily = async (fid, ownerId, memberIds) => {
    world.teams[fid] = { name: 'Fam ' + fid, members: [{ userId: ownerId, roles: ['owner'], confirm: true }, ...memberIds.map((u) => ({ userId: u, roles: ['member'], confirm: true }))] };
    await db.createRow({ tableId: 'families', rowId: fid, data: { ownerId, name: 'Fam ' + fid }, permissions: [] });
    for (const u of [ownerId, ...memberIds]) await db.createRow({ tableId: 'profiles', rowId: 'unique()', data: { familyId: fid, userId: u, profileKey: `${fid}_${u}`, displayName: u }, permissions: [] });
  };
  const removeMember = (fid, uid) => { world.teams[fid].members = world.teams[fid].members.filter((m) => m.userId !== uid); };
  return { world, api, call, ok, fail, addFamily, removeMember };
}
const rows = (w, t) => [...w.world.tables[t].values()];
const cid = (() => { let n = 0; return () => 'cid' + String(++n).padStart(10, '0'); })();
async function setup() {
  const w = makeWorld();
  await w.addFamily('famA', 'owner', ['ann', 'bob']);
  await w.addFamily('famB', 'zed', ['yan']);
  const open = await w.ok('ann', 'chatOpen', { familyId: 'famA' });
  const ch = Object.fromEntries(open.channels.map((c) => [c.name, c.id]));
  return { w, ch };
}

test('first open creates the starter channels once; no duplicates; team-only read', async () => {
  const { w } = await setup();
  await w.ok('bob', 'chatOpen', { familyId: 'famA' });
  await w.ok('owner', 'chatOpen', { familyId: 'famA' });
  const chans = rows(w, CHAT_TABLES.channels).filter((c) => c.familyId === 'famA');
  assert.deepEqual(chans.map((c) => c.name).sort(), DEFAULT_CHANNELS.map((d) => d.name).sort());
  assert.equal(chans.find((c) => c.name === 'announcements').readOnly, true);
  for (const c of chans) assert.deepEqual(c.$permissions, ['read("team:famA")']);
  assert.equal(rows(w, CHAT_TABLES.channels).filter((c) => c.familyId === 'famB').length, 0, 'other family untouched');
});

test('only confirmed members can open chat; another family is never reachable by changing ids', async () => {
  const { w, ch } = await setup();
  await w.fail('zed', 'chatOpen', { familyId: 'famA' }, 403);
  await w.fail('zed', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'hi', clientId: cid() }, 403);
  // a member of famB using famB as the family but famA's channel id
  await w.fail('yan', 'chatSend', { familyId: 'famB', kind: 'channel', convId: ch.general, body: 'hi', clientId: cid() }, 404);
  await w.fail('yan', 'chatMarkRead', { familyId: 'famB', kind: 'channel', convId: ch.general, at: new Date().toISOString() }, 404);
});

test('send: sender comes from the session, text is validated, retries never duplicate', async () => {
  const { w, ch } = await setup();
  const id = cid();
  const a = await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: '  Hello <b>there</b>  ', clientId: id, authorId: 'bob', userId: 'bob' });
  assert.equal(a.message.authorId, 'ann');
  assert.equal(a.message.body, 'Hello <b>there</b>', 'stored as plain text; the app only ever shows it as text');
  const again = await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'Hello <b>there</b>', clientId: id });
  assert.equal(again.duplicate, true);
  assert.equal(again.message.id, a.message.id);
  assert.equal(rows(w, CHAT_TABLES.messages).length, 1);
  await w.fail('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: '   ', clientId: cid() }, 400);
  await w.fail('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'x'.repeat(CHAT_LIMITS.bodyMax + 1), clientId: cid() }, 400);
  await w.fail('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'ok', clientId: 'short' }, 400);
  assert.deepEqual(rows(w, CHAT_TABLES.messages)[0].$permissions, ['read("team:famA")']);
});

test('rate limit is enforced on the server', async () => {
  const { w, ch } = await setup();
  for (let i = 0; i < CHAT_LIMITS.burst.count; i++) await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'm' + i, clientId: cid() });
  const r = await w.fail('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'too many', clientId: cid() }, 429, 'rate_limited');
  assert.match(r.message, /too quickly/);
  await w.ok('bob', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'someone else is fine', clientId: cid() });
});

test('read-only channel: members cannot post, owner and chat admins can', async () => {
  const { w, ch } = await setup();
  await w.fail('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.announcements, body: 'hi', clientId: cid() }, 403);
  await w.ok('owner', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.announcements, body: 'News', clientId: cid() });
  await w.fail('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'ann', admin: true, extra: 1 }, 200).catch(() => {});
  await w.ok('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'ann', admin: true });
  await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.announcements, body: 'Admin news', clientId: cid() });
  await w.ok('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'ann', admin: false });
  await w.fail('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.announcements, body: 'again', clientId: cid() }, 403);
  await w.fail('ann', 'chatSetAdmin', { familyId: 'famA', userId: 'bob', admin: true }, 403);   // admins cannot appoint admins
});

test('replies must stay inside the same conversation', async () => {
  const { w, ch } = await setup();
  const m = (await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'first', clientId: cid() })).message;
  const r = await w.ok('bob', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'reply', clientId: cid(), replyToId: m.id });
  assert.equal(r.message.replyToId, m.id);
  await w.fail('bob', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch['plans-and-events'], body: 'cross', clientId: cid(), replyToId: m.id }, 400);
});

test('edit and delete: own messages only; admins can remove shared-channel messages with a record', async () => {
  const { w, ch } = await setup();
  const m = (await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'draft', clientId: cid() })).message;
  await w.fail('bob', 'chatEdit', { familyId: 'famA', messageId: m.id, body: 'hacked' }, 403);
  const e = await w.ok('ann', 'chatEdit', { familyId: 'famA', messageId: m.id, body: 'final' });
  assert.equal(e.message.body, 'final');
  assert.ok(e.message.editedAt);
  await w.fail('bob', 'chatDelete', { familyId: 'famA', messageId: m.id }, 403);
  await w.ok('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '👍' });
  const d = await w.ok('owner', 'chatDelete', { familyId: 'famA', messageId: m.id });
  assert.equal(d.moderated, true);
  assert.equal(rows(w, CHAT_TABLES.messages).length, 0);
  assert.equal(rows(w, CHAT_TABLES.reactions).length, 0, 'reactions go with the message');
  const log = await w.ok('owner', 'chatModLog', { familyId: 'famA' });
  assert.equal(log.entries[0].action, 'removed_message');
  assert.equal(log.entries[0].targetUserId, 'ann');
  assert.ok(!JSON.stringify(rows(w, CHAT_TABLES.mod)).includes('final'), 'the record never holds message text');
  await w.fail('ann', 'chatModLog', { familyId: 'famA' }, 403);
  const own = (await w.ok('bob', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'mine', clientId: cid() })).message;
  assert.equal((await w.ok('bob', 'chatDelete', { familyId: 'famA', messageId: own.id })).moderated, false);
});

test('reactions: at most 20 different emoji on one message', async () => {
  const { w, ch } = await setup();
  const m = (await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'hi', clientId: cid() })).message;
  const set = ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋'];
  for (const [i, e] of set.entries()) await w.ok(i % 2 ? 'ann' : 'bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: e });
  await w.fail('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '😛' }, 400);
  assert.equal((await w.ok('ann', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '😀' })).on, true, 'an emoji already on the message can still be added by someone else');
});
test('reactions: any single emoji, toggle, caps, access-checked', async () => {
  const { w, ch } = await setup();
  const m = (await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'x', clientId: cid() })).message;
  for (const bad of ['', 'hi', '👍👍', 'a👍', '👨‍👩‍👧‍👦', '<b>', '🏴󠁧󠁢󠁥󠁮󠁧󠁿']) await w.fail('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: bad }, 400);
  for (const good of ['🎉', '🇺🇸', '👍🏽', '1️⃣', '❤️‍🔥', '🧑‍🤝‍🧑']) assert.equal((await w.ok('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: good })).on, true, good);
  assert.equal((await w.ok('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '🎉' })).on, false, 'toggles off');
  assert.equal((await w.ok('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '❤️' })).on, true);
  assert.equal((await w.ok('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '❤️' })).on, false);
  await w.fail('yan', 'chatReact', { familyId: 'famB', messageId: m.id, emoji: '👍' }, 404);
  await w.fail('zed', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '👍' }, 403);
});

test('channel management: owner/admin only; names unique; archive keeps history; last channel protected', async () => {
  const { w, ch } = await setup();
  await w.fail('ann', 'chatChannelSave', { familyId: 'famA', name: 'cousins' }, 403);
  const c = (await w.ok('owner', 'chatChannelSave', { familyId: 'famA', name: 'Cousins Club!', description: 'For the cousins' })).channel;
  assert.equal(c.name, 'cousins-club');
  await w.fail('owner', 'chatChannelSave', { familyId: 'famA', name: 'general' }, 400);
  await w.ok('owner', 'chatChannelSave', { familyId: 'famA', channelId: c.id, name: 'cousins', readOnly: true });
  const m = (await w.ok('owner', 'chatSend', { familyId: 'famA', kind: 'channel', convId: c.id, body: 'kept', clientId: cid() })).message;
  await w.ok('owner', 'chatChannelOrder', { familyId: 'famA', order: [c.id, ch.general] });
  const open = await w.ok('ann', 'chatOpen', { familyId: 'famA' });
  assert.equal(open.channels[0].id, c.id);
  await w.fail('ann', 'chatChannelArchive', { familyId: 'famA', channelId: c.id }, 403);
  await w.ok('owner', 'chatChannelArchive', { familyId: 'famA', channelId: c.id });
  assert.equal(rows(w, CHAT_TABLES.messages).length, 1, 'archiving never deletes messages');
  await w.fail('owner', 'chatSend', { familyId: 'famA', kind: 'channel', convId: c.id, body: 'no', clientId: cid() }, 403);
  await w.fail('owner', 'chatEdit', { familyId: 'famA', messageId: m.id, body: 'edit' }, 403);
  await w.ok('owner', 'chatChannelArchive', { familyId: 'famA', channelId: c.id, archived: false });
  for (const id of [ch.general, ch.announcements, c.id]) await w.ok('owner', 'chatChannelArchive', { familyId: 'famA', channelId: id });
  await w.fail('owner', 'chatChannelArchive', { familyId: 'famA', channelId: ch['plans-and-events'] }, 400);
  await w.fail('owner', 'chatChannelOrder', { familyId: 'famA', order: ['nope'] }, 400);
  const log = await w.ok('owner', 'chatModLog', { familyId: 'famA' });
  assert.ok(log.entries.some((e) => e.action === 'channel_archived'));
});

test('tree roles and store roles do not grant chat powers', async () => {
  const { w, ch } = await setup();
  const prof = rows(w, 'profiles').find((p) => p.profileKey === 'famA_bob');
  prof.treeAdmin = true;
  await w.fail('bob', 'chatChannelSave', { familyId: 'famA', name: 'sneaky' }, 403);
  await w.fail('bob', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.announcements, body: 'x', clientId: cid() }, 403);
});

test('DMs: one per pair per family, participants only, nobody else can read or post', async () => {
  const { w } = await setup();
  const a = (await w.ok('ann', 'chatDmStart', { familyId: 'famA', userId: 'bob' })).dm;
  const b = (await w.ok('bob', 'chatDmStart', { familyId: 'famA', userId: 'ann' })).dm;
  assert.equal(a.id, b.id, 'same pair, same conversation');
  assert.equal(rows(w, CHAT_TABLES.dms).length, 1);
  assert.deepEqual(rows(w, CHAT_TABLES.dms)[0].$permissions.sort(), ['read("user:ann")', 'read("user:bob")']);
  const m = (await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'dm', convId: a.id, body: 'secret', clientId: cid() })).message;
  assert.deepEqual(rows(w, CHAT_TABLES.messages)[0].$permissions.sort(), ['read("user:ann")', 'read("user:bob")']);
  // the family owner (and any other member) gets "not found", exactly like a DM that does not exist
  await w.fail('owner', 'chatSend', { familyId: 'famA', kind: 'dm', convId: a.id, body: 'peek', clientId: cid() }, 404);
  await w.fail('owner', 'chatMarkRead', { familyId: 'famA', kind: 'dm', convId: a.id, at: new Date().toISOString() }, 404);
  await w.fail('owner', 'chatDelete', { familyId: 'famA', messageId: m.id }, 404);
  await w.fail('owner', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '👍' }, 404);
  await w.fail('owner', 'chatEdit', { familyId: 'famA', messageId: m.id, body: 'x' }, 404);
  // the recipient cannot delete the sender's DM either
  await w.fail('bob', 'chatDelete', { familyId: 'famA', messageId: m.id }, 403);
  // the DM does not exist in another family, and cannot be started with a non-member
  await w.fail('ann', 'chatDmStart', { familyId: 'famA', userId: 'yan' }, 400);
  await w.fail('ann', 'chatDmStart', { familyId: 'famA', userId: 'ann' }, 400);
  const openOwner = await w.ok('owner', 'chatOpen', { familyId: 'famA' });
  assert.equal(openOwner.dms.length, 0, 'the owner sees no one else\'s DMs');
});

test('blocking and "no direct messages" stop new and existing DMs', async () => {
  const { w } = await setup();
  const dm = (await w.ok('ann', 'chatDmStart', { familyId: 'famA', userId: 'bob' })).dm;
  await w.ok('bob', 'chatBlock', { familyId: 'famA', userId: 'ann', blocked: true });
  const r = await w.fail('ann', 'chatSend', { familyId: 'famA', kind: 'dm', convId: dm.id, body: 'hello?', clientId: cid() }, 403, 'dm_unavailable');
  assert.ok(!/block/i.test(r.message), 'the blocked person is not told they were blocked');
  await w.ok('bob', 'chatBlock', { familyId: 'famA', userId: 'ann', blocked: false });
  await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'dm', convId: dm.id, body: 'hello', clientId: cid() });
  await w.ok('owner', 'chatBlock', { familyId: 'famA', userId: '*', blocked: true });
  await w.fail('ann', 'chatDmStart', { familyId: 'famA', userId: 'owner' }, 403, 'dm_unavailable');
  assert.equal((await w.ok('owner', 'chatOpen', { familyId: 'famA' })).allowDms, false);
  await w.fail('ann', 'chatBlock', { familyId: 'famA', userId: 'ann', blocked: true }, 400);
});

test('leaving a family closes DMs: the leaver loses access, the other person keeps read-only history', async () => {
  const { w } = await setup();
  const dm = (await w.ok('ann', 'chatDmStart', { familyId: 'famA', userId: 'bob' })).dm;
  const m = (await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'dm', convId: dm.id, body: 'bye', clientId: cid() })).message;
  await w.ok('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '❤️' });
  // an owner calling reconcile about someone who is still a member changes nothing
  assert.equal((await w.ok('owner', 'chatReconcile', { familyId: 'famA', userId: 'ann' })).closed, 0);
  assert.equal(rows(w, CHAT_TABLES.dms)[0].status, 'open');
  w.removeMember('famA', 'ann');
  const ev = await w.api.handleEvent({ event: 'teams.famA.memberships.m1.delete', payload: { teamId: 'famA', userId: 'ann' }, deadline: Number.MAX_SAFE_INTEGER });
  assert.equal(ev.json.closed, 1);
  const row = rows(w, CHAT_TABLES.dms)[0];
  assert.equal(row.status, 'closed');
  assert.deepEqual(row.$permissions, ['read("user:bob")']);
  assert.deepEqual(rows(w, CHAT_TABLES.messages)[0].$permissions, ['read("user:bob")']);
  assert.deepEqual(rows(w, CHAT_TABLES.reactions)[0].$permissions, ['read("user:bob")']);
  assert.equal(row.pending, false);
  await w.fail('ann', 'chatOpen', { familyId: 'famA' }, 403);
  await w.fail('bob', 'chatSend', { familyId: 'famA', kind: 'dm', convId: dm.id, body: 'still there?', clientId: cid() }, 403);
  await w.fail('bob', 'chatReact', { familyId: 'famA', messageId: m.id, emoji: '👍' }, 403);
  const open = await w.ok('bob', 'chatOpen', { familyId: 'famA' });
  assert.equal(open.dms[0].status, 'closed');
  await w.fail('bob', 'chatDmStart', { familyId: 'famA', userId: 'ann' }, 400);
  // events about other things, or forged payloads about current members, do nothing
  assert.equal((await w.api.handleEvent({ event: 'users.x.update', payload: {}, deadline: 0 })).json.ignored, true);
  assert.equal((await w.api.handleEvent({ event: 'teams.famA.memberships.m2.delete', payload: { teamId: 'famA', userId: 'bob' }, deadline: Number.MAX_SAFE_INTEGER })).json.closed, 0);
});

test('a removal is also caught the next time the remaining person opens chat (no event needed)', async () => {
  const { w } = await setup();
  const dm = (await w.ok('ann', 'chatDmStart', { familyId: 'famA', userId: 'bob' })).dm;
  await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'dm', convId: dm.id, body: 'hi', clientId: cid() });
  w.removeMember('famA', 'bob');
  const open = await w.ok('ann', 'chatOpen', { familyId: 'famA' });
  assert.equal(open.dms[0].status, 'closed');
  assert.deepEqual(rows(w, CHAT_TABLES.messages)[0].$permissions, ['read("user:ann")']);
});

test('unread is per member and per conversation, and only moves forward', async () => {
  const { w, ch } = await setup();
  await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'one', clientId: cid() });
  await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'two', clientId: cid() });
  let bob = await w.ok('bob', 'chatUnread', { familyId: 'famA' });
  assert.equal(bob.unread[ch.general].n, 2);
  assert.equal(bob.unread[ch.announcements].n, 0);
  assert.equal((await w.ok('ann', 'chatUnread', { familyId: 'famA' })).unread[ch.general].n, 0, 'your own messages are never unread');
  const newest = rows(w, CHAT_TABLES.messages).map((r) => r.$createdAt).sort().pop();
  await w.ok('bob', 'chatMarkRead', { familyId: 'famA', kind: 'channel', convId: ch.general, at: newest });
  bob = await w.ok('bob', 'chatUnread', { familyId: 'famA' });
  assert.equal(bob.unread[ch.general].n, 0);
  await w.ok('bob', 'chatMarkRead', { familyId: 'famA', kind: 'channel', convId: ch.general, at: '2000-01-01T00:00:00.000Z' });
  assert.equal((await w.ok('bob', 'chatUnread', { familyId: 'famA' })).unread[ch.general].n, 0, 'cannot move backwards');
  await w.fail('bob', 'chatMarkRead', { familyId: 'famA', kind: 'channel', convId: ch.general, at: 'yesterday' }, 400);
  // the second member's state is separate
  assert.equal((await w.ok('owner', 'chatUnread', { familyId: 'famA' })).unread[ch.general].n, 2);
});

test('deleting a family removes its chat data', async () => {
  const { w, ch } = await setup();
  await w.ok('ann', 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch.general, body: 'x', clientId: cid() });
  await w.ok('ann', 'chatDmStart', { familyId: 'famA', userId: 'bob' });
  const r = await w.ok('owner', 'deleteFamily', { familyId: 'famA' });
  assert.equal(r.done, true);
  for (const t of Object.values(CHAT_TABLES)) assert.equal(rows(w, t).filter((x) => x.familyId === 'famA').length, 0, t);
});

test('chat works for people in more than one family without mixing them', async () => {
  const w = makeWorld();
  await w.addFamily('famA', 'owner', ['ann']);
  await w.addFamily('famB', 'ann', ['yan']);   // ann is the owner of B and a member of A
  const a = await w.ok('ann', 'chatOpen', { familyId: 'famA' });
  const b = await w.ok('ann', 'chatOpen', { familyId: 'famB' });
  assert.equal(a.role, 'member');
  assert.equal(b.role, 'owner');
  assert.equal(new Set([...a.channels, ...b.channels].map((c) => c.id)).size, 6);
  await w.fail('ann', 'chatSend', { familyId: 'famB', kind: 'channel', convId: a.channels[0].id, body: 'x', clientId: cid() }, 404);
});


test('link previews: members only, safe addresses only, rate limited', async () => {
  const calls = []; EXTRA_CFG.fetchPreview = async (u) => { calls.push(u); return { url: u, title: 'T', description: 'D', siteName: 's', image: '' }; };
  try {
    const { w } = await setup();
    const r = await w.ok('ann', 'chatPreview', { familyId: 'famA', url: 'https://example.com/a' });
    assert.equal(r.preview.title, 'T'); assert.deepEqual(calls, ['https://example.com/a']);
    for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'ftp://example.com/', 'https://user:pw@example.com/', 'http://localhost/', '', '   ', 'https://example.com/' + 'a'.repeat(600), 42, null])
      await w.fail('ann', 'chatPreview', { familyId: 'famA', url: u }, 400);
    assert.equal(calls.length, 1, 'refused links never reach the fetcher');
    await w.fail('zed', 'chatPreview', { familyId: 'famA', url: 'https://example.com/' }, 403);
    await w.fail('yan', 'chatPreview', { familyId: 'famA', url: 'https://example.com/' }, 403);
    for (let i = 0; i < 12; i++) await w.ok('bob', 'chatPreview', { familyId: 'famA', url: 'https://example.com/' + i });
    await w.fail('bob', 'chatPreview', { familyId: 'famA', url: 'https://example.com/y' }, 429);
  } finally { delete EXTRA_CFG.fetchPreview; }
});

test('GIF and sticker messages: only a GIPHY id is stored, bad data is refused, permissions and retries still apply', async () => {
  const { w, ch: chans } = await setup();
  const ch = chans.general;
  const send = (who, extra, status) => (status ? w.fail(who, 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch, ...extra }, status) : w.ok(who, 'chatSend', { familyId: 'famA', kind: 'channel', convId: ch, ...extra }));
  const media = { provider: 'giphy', type: 'gif', id: 'xT9IgDEI1iZyb2wqo8', w: 200, h: 150, alt: 'Happy <b>cat</b>' };
  const a = await send('ann', { body: '', media, clientId: 'c-gif-1-0000' });
  assert.equal(a.message.body, '[GIF]');
  const stored = JSON.parse(a.message.media);
  assert.deepEqual([stored.p, stored.t, stored.id, stored.w, stored.h], ['giphy', 'gif', 'xT9IgDEI1iZyb2wqo8', 200, 150]);
  assert.ok(!/[<>]/.test(stored.a), 'markup stripped from the description');
  assert.ok(!a.message.media.includes('http'), 'no web address is stored');
  const dup = await send('ann', { body: '', media, clientId: 'c-gif-1-0000' }); assert.equal(dup.duplicate, true);
  const st = await send('ann', { body: 'for you', media: { ...media, type: 'sticker' }, clientId: 'c-st-1-0000' });
  assert.equal(st.message.body, 'for you'); assert.equal(JSON.parse(st.message.media).t, 'sticker');
  const rep = await send('bob', { body: '', media, clientId: 'c-gif-2-0000', replyToId: a.message.id }); assert.equal(rep.message.replyToId, a.message.id);
  const bads = [{ ...media, provider: 'tenor' }, { ...media, type: 'video' }, { ...media, id: 'https://evil.example/x.gif' }, { ...media, id: 'a b' }, { ...media, id: 'abc' }, 'x', [media]];
  for (let i = 0; i < bads.length; i++) await send('ann', { body: '', media: bads[i], clientId: 'c-bad--0000' + i }, 400);
  await send('zed', { body: '', media, clientId: 'c-zed-0000' }, 403);
  const plain = await send('ann', { body: 'hello', clientId: 'c-plain-0000' }); assert.equal(plain.message.media, '');
  await send('ann', { body: '', clientId: 'c-empty-0000' }, 400);
});

test('family chat picture: owner and chat admins only, stored for the whole family, old file removed', async () => {
  const { w } = await setup();
  const mine = (id, user) => { world_files(w)[id] = { $id: id, mimeType: 'image/jpeg', sizeOriginal: 5000, $permissions: [`update("user:${user}")`, 'read("team:famA")'] }; };
  const world_files = (x) => x.world.files;
  mine('pic1', 'owner');
  await w.fail('bob', 'chatPicture', { familyId: 'famA', fileId: 'pic1' }, 403);
  assert.equal((await w.ok('ann', 'chatOpen', { familyId: 'famA' })).picture, '');
  await w.ok('owner', 'chatPicture', { familyId: 'famA', fileId: 'pic1' });
  assert.equal((await w.ok('bob', 'chatOpen', { familyId: 'famA' })).picture, 'pic1');
  mine('pic2', 'owner');
  await w.ok('owner', 'chatPicture', { familyId: 'famA', fileId: 'pic2' });
  assert.equal(w.world.files.pic1, undefined, 'the replaced picture is deleted');
  await w.ok('owner', 'chatPicture', { familyId: 'famA', fileId: '' });
  assert.equal((await w.ok('bob', 'chatOpen', { familyId: 'famA' })).picture, '');
});

test('typing hint: stores only the chosen wording, never errors, respects blocks and archived channels', async () => {
  const { w, ch } = await setup();
  const rows = () => [...w.world.tables.chatTyping.values()];
  const r1 = await w.ok('ann', 'chatTyping', { familyId: 'famA', kind: 'channel', convId: ch.general, text: '  is  cooking <b>letters</b>\n' + 'x'.repeat(100) });
  assert.equal(r1.shown, true); assert.equal(rows().length, 1);
  assert.ok(rows()[0].text.length <= 40 && !/[<>\n]/.test(rows()[0].text) && rows()[0].text.startsWith('is cooking'));
  await w.ok('ann', 'chatTyping', { familyId: 'famA', kind: 'channel', convId: ch.general, text: 'is typing' });
  assert.equal(rows().length, 1, 'the same person and conversation reuse one row'); assert.equal(rows()[0].text, 'is typing');
  await w.ok('ann', 'chatTyping', { familyId: 'famA', kind: 'channel', convId: ch.general, text: 5 });
  assert.equal(rows()[0].text, '');
  await w.fail('zed', 'chatTyping', { familyId: 'famA', kind: 'channel', convId: ch.general, text: 'x' }, 403);
  await w.fail('ann', 'chatTyping', { familyId: 'famA', kind: 'dm', convId: ch.general, text: 'x' }, 404);
});

test('presence: one expiring row per person, readable by the whole family', async () => {
  const { w } = await setup();
  const rows = () => [...w.world.tables.chatTyping.values()].filter((r) => r.convId === 'presence');
  await w.ok('ann', 'chatPresence', { familyId: 'famA' });
  await w.ok('ann', 'chatPresence', { familyId: 'famA' });
  assert.equal(rows().length, 1); assert.ok(Date.parse(rows()[0].until) > Date.now() + 60000);
  await w.fail('zed', 'chatPresence', { familyId: 'famA' }, 403);
});

test('calls: pass only for people in the conversation, signed, and a call row for the banner', async () => {
  EXTRA_CFG.livekit = { url: 'wss://x.livekit.cloud', key: 'APIkey', secret: 'sekret' };
  try {
    const { w, ch } = await setup();
    const r = await w.ok('ann', 'callJoin', { familyId: 'famA', kind: 'channel', convId: ch.general });
    assert.equal(r.url, 'wss://x.livekit.cloud'); assert.equal(r.room, 'fc_' + ch.general);
    const [h, p, sig] = r.token.split('.');
    const { createHmac } = await import('node:crypto');
    assert.equal(sig, createHmac('sha256', 'sekret').update(h + '.' + p).digest('base64url'));
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    assert.equal(claims.iss, 'APIkey'); assert.equal(claims.video.room, r.room); assert.equal(claims.video.roomJoin, true); assert.ok(claims.exp > claims.nbf);
    const rows = () => [...w.world.tables.chatTyping.values()].filter((x) => x.convId.startsWith('call:'));
    assert.equal(rows().length, 1);
    await w.ok('ann', 'callPing', { familyId: 'famA', kind: 'channel', convId: ch.general }); assert.equal(rows().length, 1);
    const before = rows()[0].until;
    await w.ok('ann', 'callLeave', { familyId: 'famA', kind: 'channel', convId: ch.general });
    assert.ok(rows()[0].until < before, 'leaving expires the banner row at once');
    await w.fail('zed', 'callJoin', { familyId: 'famA', kind: 'channel', convId: ch.general }, 403);
    // the first join leaves one "started a call" card; a second person joining the running call adds none
    const cards = () => [...w.world.tables.chatMessages.values()].filter((x) => x.body === '[call]' && x.convId === ch.general);
    assert.equal(cards().length, 1);
    await w.ok('ann', 'callJoin', { familyId: 'famA', kind: 'channel', convId: ch.general });
    await w.ok('bob', 'callJoin', { familyId: 'famA', kind: 'channel', convId: ch.general });
    assert.equal(cards().length, 2, 'Ann left and rejoined = a new call; Bob joining her call adds nothing');
  } finally { delete EXTRA_CFG.livekit; }
  const off = await setup();
  await off.w.fail('ann', 'callJoin', { familyId: 'famA', kind: 'channel', convId: off.ch.general }, 400);
});


test('saved links: title and icon lookup is members only, safe addresses only, rate limited', async () => {
  EXTRA_CFG.fetchSiteInfo = async (u) => ({ title: 'Site ' + u, icon: 'data:image/png;base64,AAAA' });
  try {
    const { w } = await setup();
    const r = await w.ok('ann', 'linkInfo', { familyId: 'famA', url: 'https://example.com/a' });
    assert.equal(r.title, 'Site https://example.com/a'); assert.ok(r.icon.startsWith('data:image/png'));
    for (const u of ['http://127.0.0.1/', 'file:///etc/passwd', 'ftp://example.com/', '']) await w.fail('ann', 'linkInfo', { familyId: 'famA', url: u }, 400);
    await w.fail('zed', 'linkInfo', { familyId: 'famA', url: 'https://example.com/' }, 403);
  } finally { delete EXTRA_CFG.fetchSiteInfo; }
});

test('picture from a web link: members only, safe addresses only, and a non-picture is refused', async () => {
  EXTRA_CFG.fetchPicture = async (u) => (u.includes('good') ? { type: 'image/png', data: 'AAAA' } : null);
  try {
    const { w } = await setup();
    const r = await w.ok('ann', 'pictureFromUrl', { familyId: 'famA', url: 'https://example.com/good.png' });
    assert.equal(r.picture.type, 'image/png');
    await w.fail('ann', 'pictureFromUrl', { familyId: 'famA', url: 'https://example.com/page.html' }, 400);
    for (const u of ['http://127.0.0.1/a.png', 'file:///etc/passwd', '']) await w.fail('ann', 'pictureFromUrl', { familyId: 'famA', url: u }, 400);
    await w.fail('zed', 'pictureFromUrl', { familyId: 'famA', url: 'https://example.com/good.png' }, 403);
  } finally { delete EXTRA_CFG.fetchPicture; }
});

/* ---------- Checkpoint 3: access hardening (chat) ---------- */
const CHAT_ACTIONS = [...readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8').matchAll(/\n    async (\w+)\(\{ user/g)].map((m) => m[1]);
const chatBody = (action, familyId, ch) => ({ action, familyId, kind: 'channel', convId: ch.general, messageId: 'm1', userId: 'bob', otherId: 'bob', body: 'hi', clientId: cid(), emoji: '👍', admin: true, at: new Date().toISOString(), name: 'x', slug: 'x', url: 'https://example.com', fileId: '', ids: [], order: [], channelId: ch.general, on: true, blocked: true });

test('EVERY chat action (read from the source, none skipped) refuses an outsider, a member of another family and a removed member', async () => {
  assert.ok(CHAT_ACTIONS.length >= 20, 'found the chat action list: ' + CHAT_ACTIONS.length);
  const { w, ch } = await setup();
  const gone = ['ann', 'bob'];            // bob is removed below
  w.removeMember('famA', 'bob');
  const checks = [['zed', 'member of another family'], ['yan', 'member of another family'], ['nobody', 'outsider'], ['bob', 'removed member']];
  let n = 0;
  for (const [who, label] of checks) for (const a of CHAT_ACTIONS) {
    const r = await w.call(who, a, chatBody(a, 'famA', ch)); n++;
    assert.equal(r.status, 403, `${label} (${who}): ${a} must be refused with 403, got ${r.status} ${JSON.stringify(r.json).slice(0, 120)}`);
  }
  assert.equal(n, CHAT_ACTIONS.length * checks.length); assert.ok(gone.length);
});

test('chat admin of family A has no chat powers in family B', async () => {
  const { w, ch } = await setup();
  await w.addFamily('famC', 'cora', ['ann']);                  // ann is a plain member of famC and in famA
  await w.ok('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'ann', admin: true });
  await w.ok('ann', 'chatOpen', { familyId: 'famC' });
  await w.fail('ann', 'chatChannelSave', { familyId: 'famC', name: 'sneaky', description: 'x' }, 403);
  await w.fail('ann', 'chatModLog', { familyId: 'famC' }, 403);
});

test('DEFECT CHECK: chat-admin powers granted in an earlier membership do not come back when the same person is re-invited', async () => {
  const { w } = await setup();
  await w.ok('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'bob', admin: true });
  await w.ok('bob', 'chatModLog', { familyId: 'famA' });
  w.removeMember('famA', 'bob');
  await w.api.handleEvent({ event: 'teams.famA.memberships.m9.delete', payload: { teamId: 'famA', userId: 'bob' }, deadline: Number.MAX_SAFE_INTEGER });   // what Appwrite sends
  await w.fail('bob', 'chatModLog', { familyId: 'famA' }, 403);
  w.world.teams.famA.members.push({ userId: 'bob', roles: ['member'], confirm: true });          // re-invited as an ordinary member
  const r = await w.call('bob', 'chatModLog', { familyId: 'famA' });
  assert.equal(r.status, 403, 'a re-invited member must start with NO chat-admin powers; got ' + r.status);
});

const EVT = (fid, uid) => ({ event: `teams.${fid}.memberships.mX.delete`, payload: { teamId: fid, userId: uid }, deadline: Number.MAX_SAFE_INTEGER });
test('cleanup covers tree-admin AND chat-admin together', async () => {
  const { w } = await setup();
  await w.ok('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'bob', admin: true });
  const prof = () => rows(w, TABLES.profiles).find((p) => p.profileKey === 'famA_bob');
  prof().treeAdmin = true;
  w.removeMember('famA', 'bob');
  await w.api.handleEvent(EVT('famA', 'bob'));
  assert.equal(prof().treeAdmin, false); assert.equal(prof().chatAdmin, false);
});

test('a delayed or repeated delete event cannot strip a member who was re-invited and given a NEW admin grant', async () => {
  const { w } = await setup();
  await w.ok('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'bob', admin: true });
  w.removeMember('famA', 'bob');
  await w.api.handleEvent(EVT('famA', 'bob'));                                       // the real event
  w.world.teams.famA.members.push({ userId: 'bob', roles: ['member'], confirm: true });   // re-invited
  await w.fail('bob', 'chatModLog', { familyId: 'famA' }, 403);                        // starts as an ordinary member
  await w.ok('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'bob', admin: true });    // legitimately granted again
  await w.api.handleEvent(EVT('famA', 'bob')); await w.api.handleEvent(EVT('famA', 'bob'));  // delayed duplicates of the OLD removal arrive
  await w.ok('bob', 'chatModLog', { familyId: 'famA' });                               // the new grant survives
});

test('if the flag cleanup fails, direct messages are still closed, the event reports failure, and the flag stays set (known limitation)', async () => {
  const { w } = await setup();
  const dm = (await w.ok('ann', 'chatDmStart', { familyId: 'famA', userId: 'bob' })).dm; assert.ok(dm.id);
  await w.ok('owner', 'chatSetAdmin', { familyId: 'famA', userId: 'bob', admin: true });
  w.removeMember('famA', 'bob');
  w.world.failProfileUpdate = true;
  const ev = await w.api.handleEvent(EVT('famA', 'bob'));
  assert.equal(ev.status, 500); assert.equal(ev.json.error, 'admin_cleanup_failed'); assert.equal(ev.json.closed, 1);
  assert.equal(rows(w, CHAT_TABLES.dms)[0].status, 'closed');
  assert.equal(rows(w, TABLES.profiles).find((p) => p.profileKey === 'famA_bob').chatAdmin, true, 'the flag is still set: this is why a durable binding is needed');
});

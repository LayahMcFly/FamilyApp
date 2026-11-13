import test from 'node:test';
import assert from 'node:assert/strict';
import { Permission, Role } from 'node-appwrite';
import { createApi, TABLES } from '../src/logic.js';
import { CHAT_TABLES } from '../src/chat.js';

/* ---------- in-memory fake of the server SDK services ---------- */
function makeWorld() {
  let seq = 0;
  const world = {
    tables: {},
    files: {},
    teams: {}, // teamId -> { name, members: [{userId, roles, confirm}] }
    userLabels: {},
    rejectColumns: [], // pretend these columns do not exist yet (Appwrite answers 400)
    clock: 1_800_000_000_000
  };
  for (const t of [...Object.values(TABLES), ...Object.values(CHAT_TABLES)]) world.tables[t] = new Map();
  const err = (code, m) => Object.assign(new Error(m), { code });

  const parseQ = (q) => JSON.parse(q);
  const db = {
    async createRow({ tableId, rowId, data, permissions }) {
      const id = rowId === 'unique()' || rowId.startsWith('uniq') ? `r${++seq}` : rowId;
      const table = world.tables[tableId];
      if (table.has(id)) throw err(409, 'exists');
      if (world.rejectColumns.some((c) => data[c] !== undefined)) throw err(400, 'Unknown attribute');
      for (const k of ['reactionKey', 'bookmarkKey', 'profileKey']) {
        if (data[k] !== undefined && [...table.values()].some((r) => r[k] === data[k])) throw err(409, 'unique');
      }
      const row = { ...data, $id: id, $permissions: permissions || [], $createdAt: new Date(world.clock + ++seq).toISOString() };
      table.set(id, row);
      return row;
    },
    async getRow({ tableId, rowId }) {
      const r = world.tables[tableId].get(rowId);
      if (!r) throw err(404, 'nope');
      return r;
    },
    async updateRow({ tableId, rowId, data }) {
      if (world.rejectColumns.some((c) => data[c] !== undefined)) throw err(400, 'Unknown attribute');
      const r = await db.getRow({ tableId, rowId });
      Object.assign(r, data);
      return r;
    },
    async deleteRow({ tableId, rowId }) {
      await db.getRow({ tableId, rowId });
      world.tables[tableId].delete(rowId);
      return {};
    },
    async listRows({ tableId, queries = [] }) {
      let rows = [...world.tables[tableId].values()];
      let limit = 25;
      for (const raw of queries) {
        const q = parseQ(raw);
        if (q.method === 'equal') {
          rows = rows.filter((r) => q.values.includes(q.attribute === '$id' ? r.$id : r[q.attribute]));
        } else if (q.method === 'contains') {
          rows = rows.filter((r) => String(r[q.attribute] || '').includes(String(q.values[0])));
        } else if (q.method === 'limit') limit = q.values[0];
      }
      return { total: rows.length, rows: rows.slice(0, limit) };
    }
  };
  const storage = {
    async getFile({ fileId }) {
      const f = world.files[fileId];
      if (!f) throw err(404, 'nofile');
      return f;
    },
    async updateFile({ fileId, permissions }) {
      (await storage.getFile({ fileId })).$permissions = permissions;
      return {};
    },
    async deleteFile({ fileId }) {
      await storage.getFile({ fileId });
      delete world.files[fileId];
      return {};
    },
    async listFiles({ queries = [] }) {
      let cutoff = null;
      let limit = 25;
      let after = null;
      for (const raw of queries) {
        const q = parseQ(raw);
        if (q.method === 'lessThan') cutoff = q.values[0];
        if (q.method === 'limit') limit = q.values[0];
        if (q.method === 'cursorAfter') after = q.values[0];
      }
      let files = Object.values(world.files).filter((f) => !cutoff || f.$createdAt < cutoff);
      if (after) files = files.slice(files.findIndex((f) => f.$id === after) + 1);
      return { files: files.slice(0, limit) };
    }
  };
  const users = {
    async listMemberships({ userId }) {
      const memberships = [];
      for (const [teamId, t] of Object.entries(world.teams)) {
        for (const m of t.members) {
          if (m.userId === userId) memberships.push({ $id: 'm_' + teamId + '_' + userId, teamId, teamName: t.name, roles: m.roles, confirm: m.confirm, userId });
        }
      }
      return { memberships };
    },
    async updateLabels({ userId, labels }) {
      world.userLabels[userId] = labels;
      return {};
    }
  };
  const teams = {
    async getPrefs({ teamId }) { return { ...((world.teams[teamId] || {}).prefs || {}) }; },
    async listMemberships({ teamId }) {
      const t = world.teams[teamId];
      return { memberships: t ? t.members.map((m) => ({ $id: 'm_' + teamId + '_' + m.userId, teamId, userId: m.userId, roles: m.roles, confirm: m.confirm })) : [] };
    },
    async delete({ teamId }) {
      if (!world.teams[teamId]) throw err(404, 'noteam');
      delete world.teams[teamId];
      return {};
    }
  };
  const cfg = { databaseId: 'family', bucketId: 'family-media', maxOwnedFamilies: 2, maxVideoMB: 25, familyStorageMB: 30 };
  const api = createApi({ users, teams, db, storage, cfg, now: () => world.clock + 1000 * 60 * 120 });
  const user = (id, extra = {}) => ({ $id: id, status: true, emailVerification: true, labels: [], ...extra });
  const call = (u, body) => api.handle({ user: u, body, deadline: Infinity });
  const addTeam = (id, name, members) => (world.teams[id] = { name, members });
  const addFile = (id, { owner, familyId, mime = 'image/jpeg', size = 1000, old = false }) => {
    world.files[id] = {
      $id: id,
      mimeType: mime,
      sizeOriginal: size,
      $createdAt: new Date(world.clock - (old ? 1000 * 60 * 60 * 5 : 0)).toISOString(),
      $permissions: [
        Permission.read(Role.team(familyId)),
        Permission.update(Role.user(owner)),
        Permission.delete(Role.user(owner))
      ]
    };
  };
  return { world, call, user, addTeam, addFile, api };
}

const owner = (u) => ({ userId: u, roles: ['owner'], confirm: true });
const member = (u, confirm = true) => ({ userId: u, roles: ['member'], confirm });

async function setup() {
  const w = makeWorld();
  // Family A: alice (owner) + bob. Family B: carol (owner). Dave belongs to nothing.
  w.addTeam('famA', 'The Smiths', [owner('alice'), member('bob')]);
  w.addTeam('famB', 'The Joneses', [owner('carol')]);
  const alice = w.user('alice');
  const bob = w.user('bob');
  const carol = w.user('carol');
  const dave = w.user('dave');
  assert.equal((await w.call(alice, { action: 'registerFamily', teamId: 'famA' })).status, 200);
  assert.equal((await w.call(carol, { action: 'registerFamily', teamId: 'famB' })).status, 200);
  return { ...w, alice, bob, carol, dave };
}

test('identity: unverified, anonymous and unknown actions are refused', async () => {
  const s = await setup();
  assert.equal((await s.call(s.user('x', { emailVerification: false }), { action: 'listFamilies' })).json.error, 'email_not_verified');
  assert.equal((await s.call(s.alice, { action: 'nope' })).status, 400);
  assert.equal((await s.call(s.alice, { action: 'constructor' })).status, 400);
  assert.equal((await s.call(s.alice, {})).status, 400);
});

test('registerFamily: only a confirmed owner, once, with a quota', async () => {
  const s = await setup();
  assert.equal((await s.call(s.bob, { action: 'registerFamily', teamId: 'famA' })).status, 403);
  assert.equal((await s.call(s.alice, { action: 'registerFamily', teamId: 'famA' })).status, 409);
  assert.equal((await s.call(s.dave, { action: 'registerFamily', teamId: 'famB' })).status, 403);
  s.addTeam('t2', 'Two', [owner('alice')]);
  s.addTeam('t3', 'Three', [owner('alice')]);
  assert.equal((await s.call(s.alice, { action: 'registerFamily', teamId: 't2' })).status, 200);
  const third = await s.call(s.alice, { action: 'registerFamily', teamId: 't3' });
  assert.equal(third.status, 409);
  assert.equal(third.json.error, 'quota');
  // an invited-but-not-accepted owner cannot register
  s.addTeam('t4', 'Four', [owner('erin')]);
  s.world.teams.t4.members[0].confirm = false;
  assert.equal((await s.call(s.user('erin'), { action: 'registerFamily', teamId: 't4' })).status, 403);
});

test('listFamilies: only my confirmed, registered families; label synced both ways', async () => {
  const s = await setup();
  const a = await s.call(s.alice, { action: 'listFamilies' });
  assert.deepEqual(a.json.families, [{ id: 'famA', name: 'The Smiths', role: 'owner' }]);
  assert.deepEqual(s.world.userLabels.alice, ['family']);
  s.addTeam('unreg', 'Unregistered', [owner('alice')]); // never registered
  const a2 = await s.call(s.alice, { action: 'listFamilies' });
  assert.equal(a2.json.families.length, 1);
  const d = await s.call(s.dave, { action: 'listFamilies' });
  assert.deepEqual(d.json.families, []);
  // pending invitation does not count
  s.world.teams.famB.members.push(member('dave', false));
  assert.deepEqual((await s.call(s.dave, { action: 'listFamilies' })).json.families, []);
  // leaving the last family removes the label
  s.world.teams.famA.members = s.world.teams.famA.members.filter((m) => m.userId !== 'bob');
  const bobUser = s.user('bob', { labels: ['family'] });
  await s.call(bobUser, { action: 'listFamilies' });
  assert.deepEqual(s.world.userLabels.bob, []);
});

test('cross-family isolation: every action refuses a non-member', async () => {
  const s = await setup();
  const post = await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'hello A' });
  const postId = post.json.postId;
  const cm = await s.call(s.alice, { action: 'createComment', familyId: 'famA', postId, body: 'c' });
  const attempts = [
    { action: 'createPost', familyId: 'famA', kind: 'text', body: 'x' },
    { action: 'editPost', familyId: 'famA', postId, body: 'x' },
    { action: 'deletePost', familyId: 'famA', postId },
    { action: 'createComment', familyId: 'famA', postId, body: 'x' },
    { action: 'deleteComment', familyId: 'famA', commentId: cm.json.commentId },
    { action: 'toggleReaction', familyId: 'famA', postId },
    { action: 'toggleBookmark', familyId: 'famA', postId },
    { action: 'saveProfile', familyId: 'famA', displayName: 'x' },
    { action: 'deleteFamily', familyId: 'famA' }
  ];
  for (const who of [s.carol, s.dave]) {
    for (const a of attempts) {
      const r = await s.call(who, a);
      assert.equal(r.status, 403, `${who.$id} should not be able to ${a.action}`);
    }
  }
  assert.equal(s.world.tables.posts.size, 1);
});

test('a member of family B cannot use family B to reach a family A post', async () => {
  const s = await setup();
  const { json } = await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'A only' });
  const postId = json.postId;
  for (const a of [
    { action: 'createComment', postId, body: 'sneaky' },
    { action: 'toggleReaction', postId },
    { action: 'toggleBookmark', postId },
    { action: 'editPost', postId, body: 'x' },
    { action: 'deletePost', postId }
  ]) {
    const r = await s.call(s.carol, { ...a, familyId: 'famB' });
    assert.equal(r.status, 404, a.action);
  }
  assert.equal(s.world.tables.comments.size, 0);
  assert.equal(s.world.tables.reactions.size, 0);
  assert.equal(s.world.tables.bookmarks.size, 0);
});

test('row permissions: team read for family content, user read for bookmarks, no client write grants', async () => {
  const s = await setup();
  const { json } = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'hi' });
  const postId = json.postId;
  await s.call(s.bob, { action: 'createComment', familyId: 'famA', postId, body: 'c' });
  await s.call(s.bob, { action: 'toggleReaction', familyId: 'famA', postId });
  await s.call(s.bob, { action: 'toggleBookmark', familyId: 'famA', postId });
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' });
  const teamOnly = [Permission.read(Role.team('famA'))];
  for (const t of ['posts', 'comments', 'reactions', 'profiles', 'families']) {
    for (const r of s.world.tables[t].values()) {
      if (t === 'families' && r.$id !== 'famA') continue;
      assert.deepEqual(r.$permissions, teamOnly, t);
    }
  }
  const [bm] = [...s.world.tables.bookmarks.values()];
  assert.deepEqual(bm.$permissions, [Permission.read(Role.user('bob'))]);
});

test('edit and delete rules: author edits; owner can delete but not edit; peers cannot', async () => {
  const s = await setup();
  const { json } = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'bob post' });
  const postId = json.postId;
  assert.equal((await s.call(s.alice, { action: 'editPost', familyId: 'famA', postId, body: 'hijack' })).status, 403);
  assert.equal((await s.call(s.bob, { action: 'editPost', familyId: 'famA', postId, body: 'fixed' })).status, 200);
  s.world.teams.famA.members.push(member('eve'));
  assert.equal((await s.call(s.user('eve'), { action: 'deletePost', familyId: 'famA', postId })).status, 403);
  assert.equal((await s.call(s.alice, { action: 'deletePost', familyId: 'famA', postId })).status, 200);
  assert.equal(s.world.tables.posts.size, 0);
});

test('deletePost cascades comments, reactions, bookmarks and the media file', async () => {
  const s = await setup();
  s.addFile('f1', { owner: 'bob', familyId: 'famA' });
  const { json } = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', body: '', mediaFileId: 'f1' });
  const postId = json.postId;
  await s.call(s.alice, { action: 'createComment', familyId: 'famA', postId, body: 'nice' });
  await s.call(s.alice, { action: 'toggleReaction', familyId: 'famA', postId });
  await s.call(s.alice, { action: 'toggleBookmark', familyId: 'famA', postId });
  assert.equal((await s.call(s.bob, { action: 'deletePost', familyId: 'famA', postId })).json.done, true);
  for (const t of ['posts', 'comments', 'reactions', 'bookmarks']) assert.equal(s.world.tables[t].size, 0, t);
  assert.equal(s.world.files.f1, undefined);
});

test('files: ownership proof, family match, normalisation, single use, type and size', async () => {
  const s = await setup();
  // someone else's file (update permission belongs to alice) cannot be claimed by bob
  s.addFile('fA', { owner: 'alice', familyId: 'famA' });
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'fA' })).status, 403);
  // a file uploaded for family B cannot be attached into family A
  s.addFile('fB', { owner: 'bob', familyId: 'famB' });
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'fB' })).status, 403);
  // public-looking permissions added by the uploader are wiped when the file is claimed
  s.addFile('fOK', { owner: 'bob', familyId: 'famA' });
  s.world.files.fOK.$permissions.push(Permission.read(Role.any()));
  const ok = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'fOK' });
  assert.equal(ok.status, 200);
  assert.deepEqual(s.world.files.fOK.$permissions, [Permission.read(Role.team('famA'))]);
  // the same file cannot be attached again (the uploader's update permission is gone)
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'fOK' })).status, 403);
  // wrong mime / oversize
  s.addFile('fPdf', { owner: 'bob', familyId: 'famA', mime: 'application/pdf' });
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'fPdf' })).status, 400);
  s.addFile('fBig', { owner: 'bob', familyId: 'famA', mime: 'video/mp4', size: 26 * 1024 * 1024 });
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'video', mediaFileId: 'fBig' })).status, 400);
  s.addFile('fVid', { owner: 'bob', familyId: 'famA', mime: 'video/mp4', size: 5 * 1024 * 1024 });
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'short', mediaFileId: 'fVid' })).status, 200);
  // text posts cannot smuggle a file
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'x', mediaFileId: 'fVid' })).status, 400);
});

test('input validation: lengths, ids, empty posts', async () => {
  const s = await setup();
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: '   ' })).status, 400);
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'x'.repeat(2001) })).status, 400);
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'weird', body: 'x' })).status, 400);
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: '../etc', kind: 'text', body: 'x' })).status, 400);
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: { $ne: 1 }, kind: 'text', body: 'x' })).status, 400);
  const { json } = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'ok' });
  assert.equal((await s.call(s.bob, { action: 'createComment', familyId: 'famA', postId: json.postId, body: 'y'.repeat(501) })).status, 400);
});

test('reactions and bookmarks toggle; double create is tolerated', async () => {
  const s = await setup();
  const { json } = await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'p' });
  const r1 = await s.call(s.bob, { action: 'toggleReaction', familyId: 'famA', postId: json.postId });
  assert.equal(r1.json.liked, true);
  const r2 = await s.call(s.bob, { action: 'toggleReaction', familyId: 'famA', postId: json.postId });
  assert.equal(r2.json.liked, false);
  const b1 = await s.call(s.bob, { action: 'toggleBookmark', familyId: 'famA', postId: json.postId });
  assert.equal(b1.json.saved, true);
  assert.equal(s.world.tables.bookmarks.size, 1);
});

test('saveProfile: per family, upsert, avatar replacement deletes the old file', async () => {
  const s = await setup();
  s.addFile('av1', { owner: 'bob', familyId: 'famA' });
  const p1 = await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bobby', avatarFileId: 'av1' });
  assert.equal(p1.status, 200);
  s.addFile('av2', { owner: 'bob', familyId: 'famA' });
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob', avatarFileId: 'av2' });
  assert.equal(s.world.files.av1, undefined);
  assert.equal(s.world.tables.profiles.size, 1);
  const [row] = [...s.world.tables.profiles.values()];
  assert.equal(row.displayName, 'Bob');
  assert.equal(row.profileKey, 'famA_bob');
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob', avatarFileId: '' });
  assert.equal(s.world.files.av2, undefined);
});

test('deleteComment: author, post author or owner only', async () => {
  const s = await setup();
  s.world.teams.famA.members.push(member('eve'));
  const { json } = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'p' });
  const c = await s.call(s.user('eve'), { action: 'createComment', familyId: 'famA', postId: json.postId, body: 'c' });
  s.world.teams.famA.members.push(member('zed'));
  assert.equal((await s.call(s.user('zed'), { action: 'deleteComment', familyId: 'famA', commentId: c.json.commentId })).status, 403);
  assert.equal((await s.call(s.bob, { action: 'deleteComment', familyId: 'famA', commentId: c.json.commentId })).status, 200);
});

test('deleteFamily: owner only, wipes rows, files and the team, resumable', async () => {
  const s = await setup();
  s.addFile('m1', { owner: 'bob', familyId: 'famA' });
  await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'm1' });
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' });
  await s.call(s.carol, { action: 'createPost', familyId: 'famB', kind: 'text', body: 'B stays' });
  assert.equal((await s.call(s.bob, { action: 'deleteFamily', familyId: 'famA' })).status, 403);
  const r = await s.call(s.alice, { action: 'deleteFamily', familyId: 'famA' });
  assert.equal(r.json.done, true);
  assert.equal(s.world.teams.famA, undefined);
  assert.equal(s.world.files.m1, undefined);
  for (const t of ['posts', 'profiles']) {
    for (const row of s.world.tables[t].values()) assert.equal(row.familyId, 'famB');
  }
  assert.equal(s.world.tables.families.has('famA'), false);
  assert.equal(s.world.tables.families.has('famB'), true);
});

test('no credentials: named actions are 401, only an empty call runs the sweep', async () => {
  const s = await setup();
  assert.equal((await s.call(null, { action: 'listFamilies' })).status, 401);
  assert.equal((await s.call(null, { action: 'deleteFamily', familyId: 'famA' })).status, 401);
  assert.equal(s.world.teams.famA !== undefined, true);
});

test('sweep (no user): removes old orphan files, keeps referenced and fresh ones', async () => {
  const s = await setup();
  s.addFile('keep', { owner: 'bob', familyId: 'famA' });
  await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'keep' });
  s.world.files.keep.$createdAt = new Date(s.world.clock - 5 * 3600 * 1000).toISOString();
  s.addFile('orphan', { owner: 'bob', familyId: 'famA', old: true });
  s.addFile('fresh', { owner: 'bob', familyId: 'famA' });
  s.world.files.fresh.$createdAt = new Date(s.world.clock + 119 * 60 * 1000).toISOString();
  const r = await s.call(null, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.removed, 1);
  assert.ok(s.world.files.keep && s.world.files.fresh && !s.world.files.orphan);
});

test('sweep keeps saved gift-design files that share the bucket, and still removes true orphans', async () => {
  const s = await setup();
  s.addFile('design1', { owner: 'bob', familyId: 'famA', old: true });
  s.addFile('orphan2', { owner: 'bob', familyId: 'famA', old: true });
  s.world.tables[TABLES.shopDesigns].set('d1', { $id: 'd1', fileId: 'design1' });
  const r = await s.call(null, {});
  assert.equal(r.status, 200);
  assert.ok(s.world.files.design1 && !s.world.files.orphan2);
});

test('storage allowance: usage is reported, a full family pauses new uploads, nothing existing is deleted', async () => {
  const s = await setup();
  const mb = 1024 * 1024;
  s.addFile('v1', { owner: 'bob', familyId: 'famA', mime: 'video/mp4', size: 20 * mb });
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'video', mediaFileId: 'v1' })).status, 200);
  const u = await s.call(s.bob, { action: 'familyUsage', familyId: 'famA' });
  assert.equal(u.status, 200);
  assert.equal(u.json.usedBytes, 20 * mb);
  assert.equal(u.json.limitBytes, 30 * mb);
  // another family is counted separately
  assert.equal((await s.call(s.carol, { action: 'familyUsage', familyId: 'famB' })).json.usedBytes, 0);
  // a non-member cannot read usage
  assert.equal((await s.call(s.dave, { action: 'familyUsage', familyId: 'famA' })).status, 403);
  // 20 MB used + 15 MB > 30 MB: refused, the new upload is removed, the old video stays
  s.addFile('v2', { owner: 'bob', familyId: 'famA', mime: 'video/mp4', size: 15 * mb });
  const full = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'video', mediaFileId: 'v2' });
  assert.equal(full.status, 409);
  assert.equal(full.json.error, 'storage_full');
  assert.equal(s.world.files.v2, undefined);
  assert.ok(s.world.files.v1);
  // text posts still work when the media space is full
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'still here' })).status, 200);
  // a small photo that fits is still accepted
  s.addFile('p1', { owner: 'bob', familyId: 'famA', size: 2 * mb });
  assert.equal((await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'p1' })).status, 200);
});

test('libraries: save into one, move between them, back to Saved for later; only my own saves', async () => {
  const s = await setup();
  const p = await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'recipe' });
  const postId = p.json.postId;
  // plain save works without a library
  assert.equal((await s.call(s.bob, { action: 'toggleBookmark', familyId: 'famA', postId })).json.saved, true);
  const row = () => [...s.world.tables[TABLES.bookmarks].values()].find((r) => r.userId === 'bob');
  assert.equal(row().collectionId, undefined);
  // move into a library, then back
  assert.equal((await s.call(s.bob, { action: 'setBookmarkCollection', familyId: 'famA', postId, collectionId: 'lab12cd' })).status, 200);
  assert.equal(row().collectionId, 'lab12cd');
  assert.equal((await s.call(s.bob, { action: 'setBookmarkCollection', familyId: 'famA', postId, collectionId: '' })).status, 200);
  assert.equal(row().collectionId, '');
  // invalid ids are refused
  assert.equal((await s.call(s.bob, { action: 'setBookmarkCollection', familyId: 'famA', postId, collectionId: 'Bad Id!' })).status, 400);
  // alice has not saved it: nothing to move
  assert.equal((await s.call(s.alice, { action: 'setBookmarkCollection', familyId: 'famA', postId, collectionId: 'lab12cd' })).status, 404);
  // a non-member cannot reach it
  assert.equal((await s.call(s.dave, { action: 'setBookmarkCollection', familyId: 'famA', postId, collectionId: '' })).status, 403);
  // saving straight into a library
  assert.equal((await s.call(s.alice, { action: 'toggleBookmark', familyId: 'famA', postId, collectionId: 'trips1' })).json.saved, true);
  assert.equal([...s.world.tables[TABLES.bookmarks].values()].find((r) => r.userId === 'alice').collectionId, 'trips1');
});

test('comment likes and pins: members like, only the post author pins, three at most', async () => {
  const s = await setup();
  const p = await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'hello' });
  const postId = p.json.postId;
  const mk = async (u, text) => (await s.call(u, { action: 'createComment', familyId: 'famA', postId, body: text })).json.commentId;
  const c1 = await mk(s.bob, 'one'), c2 = await mk(s.bob, 'two'), c3 = await mk(s.bob, 'three'), c4 = await mk(s.bob, 'four');
  const row = (id) => s.world.tables[TABLES.comments].get(id);
  // like, count, unlike
  let r = await s.call(s.alice, { action: 'toggleCommentLike', familyId: 'famA', commentId: c1 });
  assert.deepEqual([r.status, r.json.liked, r.json.count], [200, true, 1]);
  r = await s.call(s.bob, { action: 'toggleCommentLike', familyId: 'famA', commentId: c1 });
  assert.equal(r.json.count, 2);
  assert.deepEqual(row(c1).likedBy.sort(), ['alice', 'bob']);
  r = await s.call(s.alice, { action: 'toggleCommentLike', familyId: 'famA', commentId: c1 });
  assert.deepEqual([r.json.liked, r.json.count], [false, 1]);
  // outsiders and other families cannot like
  assert.equal((await s.call(s.dave, { action: 'toggleCommentLike', familyId: 'famA', commentId: c1 })).status, 403);
  assert.equal((await s.call(s.carol, { action: 'toggleCommentLike', familyId: 'famB', commentId: c1 })).status, 404);
  // only the post author pins
  assert.equal((await s.call(s.bob, { action: 'pinComment', familyId: 'famA', postId, commentId: c1 })).status, 403);
  for (const c of [c1, c2, c3]) assert.equal((await s.call(s.alice, { action: 'pinComment', familyId: 'famA', postId, commentId: c })).status, 200);
  const four = await s.call(s.alice, { action: 'pinComment', familyId: 'famA', postId, commentId: c4 });
  assert.equal(four.status, 409);
  assert.equal(s.world.tables[TABLES.posts].get(postId).pinnedCommentIds, `${c1},${c2},${c3}`);
  // pinning twice is harmless; unpin frees a slot
  assert.equal((await s.call(s.alice, { action: 'pinComment', familyId: 'famA', postId, commentId: c1 })).json.pinned.length, 3);
  assert.deepEqual((await s.call(s.alice, { action: 'pinComment', familyId: 'famA', postId, commentId: c2, pinned: false })).json.pinned, [c1, c3]);
  assert.equal((await s.call(s.alice, { action: 'pinComment', familyId: 'famA', postId, commentId: c4 })).status, 200);
  // a comment from another post cannot be pinned here
  const p2 = await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'other' });
  const other = (await s.call(s.bob, { action: 'createComment', familyId: 'famA', postId: p2.json.postId, body: 'x' })).json.commentId;
  assert.equal((await s.call(s.alice, { action: 'pinComment', familyId: 'famA', postId, commentId: other })).status, 404);
});

test('profile bio and About me: validated, saved by the owner of the profile only', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice', bio: 'Hi there' });
  const r = await s.call(s.alice, { action: 'saveAbout', familyId: 'famA', about: [{ key: 'movies', title: 'Favorite movies', items: ['Spider-Man', 'Mario Brothers'] }] });
  assert.equal(r.status, 200);
  const row = [...s.world.tables.profiles.values()].find((p) => p.userId === 'alice');
  assert.equal(row.bio, 'Hi there');
  assert.equal(JSON.parse(row.about)[0].items.length, 2);
  assert.equal((await s.call(s.alice, { action: 'saveAbout', familyId: 'famA', about: [{ title: '', items: [] }] })).status, 400);
  assert.equal((await s.call(s.alice, { action: 'saveAbout', familyId: 'famA', about: Array(11).fill({ title: 'x', items: [] }) })).status, 400);
  assert.equal((await s.call(s.alice, { action: 'saveAbout', familyId: 'famA', about: [{ title: 'x', items: ['y'.repeat(41)] }] })).status, 400);
  // no profile yet / not a member
  assert.equal((await s.call(s.bob, { action: 'saveAbout', familyId: 'famA', about: [] })).status, 400);
  assert.equal((await s.call(s.carol, { action: 'saveAbout', familyId: 'famA', about: [] })).status, 403);
});

test('family tree: owner and tree admins edit, members suggest, linked person confirms', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' });
  const add = (u, b) => s.call(u, { action: 'treeAddPerson', familyId: 'famA', ...b });
  // a plain member cannot edit the tree
  assert.equal((await add(s.bob, { name: 'Rose' })).status, 403);
  const rose = (await add(s.alice, { name: 'Rose' })).json.personId;
  const kid = (await add(s.alice, { name: 'Alex', parentIds: [rose], userId: 'bob' })).json.personId;
  // cannot make a cycle
  assert.equal((await s.call(s.alice, { action: 'treeEditPerson', familyId: 'famA', personId: rose, parentIds: [kid] })).status, 400);
  // partner links are mirrored
  const dev = (await add(s.alice, { name: 'Dev', partnerIds: [rose] })).json.personId;
  assert.deepEqual(s.world.tables.people.get(rose).partnerIds, [dev]);
  // someone else cannot confirm Bob's entry, Bob can
  assert.equal((await s.call(s.alice, { action: 'treeConfirm', familyId: 'famA', personId: kid })).status, 403);
  assert.equal((await s.call(s.bob, { action: 'treeConfirm', familyId: 'famA', personId: kid })).status, 200);
  assert.equal(s.world.tables.people.get(kid).confirmed, true);
  // members suggest, only admins resolve
  const sg = (await s.call(s.bob, { action: 'suggestTreeChange', familyId: 'famA', text: 'Rose was born in 1950', personId: rose })).json.suggestionId;
  assert.equal((await s.call(s.bob, { action: 'resolveSuggestion', familyId: 'famA', suggestionId: sg })).status, 403);
  // owner designates Bob as tree admin; owner only
  assert.equal((await s.call(s.bob, { action: 'setTreeAdmin', familyId: 'famA', userId: 'bob' })).status, 403);
  assert.equal((await s.call(s.alice, { action: 'setTreeAdmin', familyId: 'famA', userId: 'bob' })).status, 200);
  assert.equal((await s.call(s.bob, { action: 'resolveSuggestion', familyId: 'famA', suggestionId: sg })).status, 200);
  // deleting a person removes links to them
  assert.equal((await s.call(s.bob, { action: 'treeDeletePerson', familyId: 'famA', personId: rose })).status, 200);
  assert.deepEqual(s.world.tables.people.get(kid).parentIds, []);
  assert.deepEqual(s.world.tables.people.get(dev).partnerIds, []);
  // another family's tree is out of reach
  assert.equal((await s.call(s.carol, { action: 'treeAddPerson', familyId: 'famA', name: 'X' })).status, 403);
});

test('family tree: adoptive, step and foster parents, several partners, and two families stay apart', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  const add = (u, b, fam = 'famA') => s.call(u, { action: 'treeAddPerson', familyId: fam, ...b });
  const edit = (u, b, fam = 'famA') => s.call(u, { action: 'treeEditPerson', familyId: fam, ...b });
  const ids = {};
  for (const n of ['bm', 'bf', 'am', 'af', 'sp']) ids[n] = (await add(s.alice, { name: n })).json.personId;
  // a child with four parents: two by birth, two adoptive. "birth" is the default and is not stored.
  const kinds = { [ids.bm]: 'birth', [ids.bf]: 'birth', [ids.am]: 'adoptive', [ids.af]: 'adoptive' };
  const kid = await add(s.alice, { name: 'Kid', parentIds: [ids.bm, ids.bf, ids.am, ids.af], parentKinds: kinds });
  assert.equal(kid.status, 200);
  assert.deepEqual(JSON.parse(s.world.tables.people.get(kid.json.personId).parentKinds), { [ids.am]: 'adoptive', [ids.af]: 'adoptive' });
  const kidId = kid.json.personId;
  // bad kinds are refused, not guessed at
  assert.equal((await edit(s.alice, { personId: kidId, parentKinds: { [ids.am]: 'cousin' } })).status, 400);
  assert.equal((await edit(s.alice, { personId: kidId, parentKinds: { [ids.sp]: 'step' } })).status, 400);   // not a parent of Kid
  assert.equal((await edit(s.alice, { personId: kidId, parentKinds: [ids.am] })).status, 400);
  // too many parents or partners
  const many = [];
  for (let i = 0; i < 7; i++) many.push((await add(s.alice, { name: 'p' + i })).json.personId);
  assert.equal((await edit(s.alice, { personId: kidId, parentIds: many })).status, 400);
  assert.equal((await edit(s.alice, { personId: kidId, parentIds: many.slice(0, 6) })).status, 200);
  assert.equal(s.world.tables.people.get(kidId).parentKinds, '');            // old kinds were dropped with their parents
  // a parent cannot also be a partner of the same person
  assert.equal((await edit(s.alice, { personId: kidId, partnerIds: [many[0]] })).status, 400);
  // several partners, all mirrored
  const dad = ids.bf;
  assert.equal((await edit(s.alice, { personId: dad, partnerIds: [ids.bm, ids.sp] })).status, 200);
  assert.deepEqual(s.world.tables.people.get(ids.sp).partnerIds, [dad]);
  assert.deepEqual(s.world.tables.people.get(ids.bm).partnerIds, [dad]);
  // step-parent set, then the step-parent is deleted: the kind goes with them
  assert.equal((await edit(s.alice, { personId: kidId, parentIds: [ids.bm, ids.sp], parentKinds: { [ids.sp]: 'step' } })).status, 200);
  assert.deepEqual(JSON.parse(s.world.tables.people.get(kidId).parentKinds), { [ids.sp]: 'step' });
  assert.equal((await s.call(s.alice, { action: 'treeDeletePerson', familyId: 'famA', personId: ids.sp })).status, 200);
  assert.deepEqual(s.world.tables.people.get(kidId).parentIds, [ids.bm]);
  assert.equal(s.world.tables.people.get(kidId).parentKinds, '');
  // a plain member cannot set kinds; an outsider cannot read or write this tree
  assert.equal((await edit(s.bob, { personId: kidId, parentKinds: {} })).status, 403);
  assert.equal((await add(s.dave, { name: 'X' })).status, 403);
  // a second family: its owner cannot point at the first family's people
  const famB = await add(s.carol, { name: 'Carol Sr', parentIds: [ids.bm] }, 'famB');
  assert.equal(famB.status, 400);
  const own = await add(s.carol, { name: 'Carol Sr' }, 'famB');
  assert.equal(own.status, 200);
  assert.equal((await edit(s.carol, { personId: kidId, name: 'Hijack' }, 'famB')).status, 404);
  assert.equal((await edit(s.carol, { personId: own.json.personId, name: 'Carol' }, 'famA')).status, 403);
  assert.equal(s.world.tables.people.get(kidId).name, 'Kid');
});

test('family tree: a missing parentKinds column is reported, never silently dropped', async () => {
  const s = await setup();
  const a = (await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'A' })).json.personId;
  const b = (await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'B' })).json.personId;
  s.world.rejectColumns = ['parentKinds'];
  const r = await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Kid', parentIds: [a, b], parentKinds: { [a]: 'adoptive' } });
  assert.equal(r.status, 400);
  assert.match(JSON.stringify(r.json), /parentKinds column/);
  // ordinary edits keep working before the column exists
  const ok = await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Kid2', parentIds: [a, b] });
  assert.equal(ok.status, 200);
});

test('editPost: author only, stamps editedAt, ignores unchanged text', async () => {
  const s = await setup();
  const post = (await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'hello' })).json.postId;
  assert.equal((await s.call(s.bob, { action: 'editPost', familyId: 'famA', postId: post, body: 'x' })).status, 403);
  const same = await s.call(s.alice, { action: 'editPost', familyId: 'famA', postId: post, body: 'hello' });
  assert.equal(same.json.edited, false);
  assert.equal(s.world.tables.posts.get(post).editedAt, undefined);
  const r = await s.call(s.alice, { action: 'editPost', familyId: 'famA', postId: post, body: 'hello again' });
  assert.equal(r.json.edited, true);
  assert.ok(s.world.tables.posts.get(post).editedAt);
});

test('replies: point at the top comment of the thread and stay inside the post', async () => {
  const s = await setup();
  const post = await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'hello' });
  const postId = post.json.postId;
  const top = await s.call(s.alice, { action: 'createComment', familyId: 'famA', postId, body: 'first' });
  const r1 = await s.call(s.alice, { action: 'createComment', familyId: 'famA', postId, body: '@A hi', parentId: top.json.commentId });
  assert.equal(r1.json.parentId, top.json.commentId);
  const r2 = await s.call(s.alice, { action: 'createComment', familyId: 'famA', postId, body: '@A again', parentId: r1.json.commentId });
  assert.equal(r2.json.parentId, top.json.commentId);   // a reply to a reply joins the same thread
  const other = await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'other' });
  const bad = await s.call(s.alice, { action: 'createComment', familyId: 'famA', postId: other.json.postId, body: 'x', parentId: top.json.commentId });
  assert.notEqual(bad.status, 200);
});

test('inviting a relative: relationship, details, claim on accept, and the inviter cannot change their details afterwards', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' });
  const add = (b) => s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', ...b });
  // Alice invites Bob as her child; her own tree entry is made automatically
  const r = await add({ name: 'Bobby', relation: 'child', birthday: '2015-06-30', gender: 'Male', inviteMembershipId: 'm_famA_bob' });
  assert.equal(r.status, 200); assert.equal(r.json.linked, true);
  const people = [...s.world.tables.people.values()];
  const aliceRow = people.find((p) => p.userId === 'alice');
  assert.ok(aliceRow);
  const bobbyRow = s.world.tables.people.get(r.json.personId);
  assert.deepEqual(bobbyRow.parentIds, [aliceRow.$id]);
  // bad birthday is refused
  assert.equal((await add({ name: 'X', birthday: 'June 5' })).status, 400);
  // Bob accepts: the entry becomes his
  const claim = await s.call(s.bob, { action: 'claimInvite', familyId: 'famA' });
  assert.equal(claim.json.claimed, true);
  assert.equal(s.world.tables.people.get(r.json.personId).userId, 'bob');
  assert.equal(s.world.tables.people.get(r.json.personId).confirmed, true);
  // Alice (inviter, owner) can no longer change his name, gender or birthday
  const edit = (u, b) => s.call(u, { action: 'treeEditPerson', familyId: 'famA', personId: r.json.personId, ...b });
  assert.equal((await edit(s.alice, { name: 'Robert' })).status, 403);
  assert.equal((await edit(s.alice, { gender: 'Female' })).status, 403);
  // Bob can change everything about himself
  assert.equal((await edit(s.bob, { name: 'Robert', birthday: '2015-07-01', gender: 'Other' })).status, 200);
  assert.equal(s.world.tables.people.get(r.json.personId).name, 'Robert');
  // a sibling shares the inviter's parents; "other" is added without a link
  const sib = await s.call(s.bob, { action: 'treeAddPerson', familyId: 'famA', name: 'Sis', relation: 'sibling' });
  assert.equal(sib.status, 403);   // Bob is not a tree admin
});

test('about you: a member sets their own details; an invite for someone already set up merges, not duplicates', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' });
  // a plain member (not an admin) creates and edits their own entry
  const mine = await s.call(s.bob, { action: 'saveMyPerson', familyId: 'famA', name: 'Robert', birthday: '1990-02-03', gender: 'Male' });
  assert.equal(mine.status, 200); assert.equal(mine.json.created, true);
  const row = s.world.tables.people.get(mine.json.personId);
  assert.deepEqual([row.userId, row.confirmed, row.name, row.birthday], ['bob', true, 'Robert', '1990-02-03']);
  assert.deepEqual(row.$permissions, ['read("team:famA")']);
  const again = await s.call(s.bob, { action: 'saveMyPerson', familyId: 'famA', name: 'Rob' });
  assert.equal(again.json.created, false); assert.equal(s.world.tables.people.get(mine.json.personId).name, 'Rob');
  assert.equal((await s.call(s.bob, { action: 'saveMyPerson', familyId: 'famA', birthday: 'June' })).status, 400);
  assert.equal((await s.call(s.carol, { action: 'saveMyPerson', familyId: 'famA', name: 'X' })).status, 403);   // not a member of this family
  assert.equal([...s.world.tables.people.values()].filter((p) => p.userId === 'bob').length, 1);
  // Alice invites Bob as her child, filling in details of her own guess
  const r = await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Bobby', relation: 'child', birthday: '2015-01-01', gender: 'Female', inviteMembershipId: 'm_famA_bob' });
  const inviteId = r.json.personId;
  const grand = (await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Little', parentIds: [inviteId] })).json.personId;
  const claim = await s.call(s.bob, { action: 'claimInvite', familyId: 'famA' });
  assert.equal(claim.json.claimed, true); assert.equal(claim.json.merged, true);
  assert.equal(s.world.tables.people.has(inviteId), false);                       // no duplicate
  const bobRow = s.world.tables.people.get(mine.json.personId);
  assert.equal(bobRow.name, 'Rob');                                               // his own details were kept
  assert.equal(bobRow.birthday, '1990-02-03');
  assert.equal(bobRow.parentIds.length, 1);                                       // Alice's "child of" link came across
  assert.deepEqual(s.world.tables.people.get(grand).parentIds, [bobRow.$id]);     // others now point at him
});

test('about you: a brand-new member with saved details keeps them over the inviter\'s guess', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' });
  const r = await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Bobby', relation: 'child', birthday: '2015-01-01', gender: 'Female', inviteMembershipId: 'm_famA_bob' });
  const claim = await s.call(s.bob, { action: 'claimInvite', familyId: 'famA', me: { name: 'Robert', birthday: '1990-02-03', gender: 'Male' } });
  assert.equal(claim.json.claimed, true);
  const row = s.world.tables.people.get(r.json.personId);
  assert.deepEqual([row.name, row.birthday, row.gender, row.userId, row.confirmed], ['Robert', '1990-02-03', 'Male', 'bob', true]);
  // with nothing saved, the inviter's details stand
  const s2 = await setup();
  await s2.call(s2.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  await s2.call(s2.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' });
  const r2 = await s2.call(s2.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Bobby', birthday: '2015-01-01', inviteMembershipId: 'm_famA_bob' });
  await s2.call(s2.bob, { action: 'claimInvite', familyId: 'famA' });
  assert.equal(s2.world.tables.people.get(r2.json.personId).name, 'Bobby');
});

test('captions: saved with a video, cleaned, author-only, and never stored for photos', async () => {
  const s = await setup();
  s.addFile('fv', { owner: 'bob', familyId: 'famA', mime: 'video/mp4', size: 1024 });
  const cues = [[0, 2.04, 'Hello <b>there</b> & welcome'], [2.1, 4, '  '], [4, 6.5, 'Happy birthday!']];
  const made = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'video', mediaFileId: 'fv', captions: cues });
  assert.equal(made.status, 200); assert.equal(made.json.captionsSaved, true);
  const row = s.world.tables.posts.get(made.json.postId);
  assert.deepEqual(JSON.parse(row.captions), [[0, 2, 'Hello b there /b welcome'], [4, 6.5, 'Happy birthday!']]);   // markup characters removed, blank line dropped
  // only the author changes them, and only on videos
  const other = await s.call(s.alice, { action: 'setCaptions', familyId: 'famA', postId: made.json.postId, captions: [[0, 1, 'x']] });
  assert.equal(other.status, 403);
  assert.equal((await s.call(s.bob, { action: 'setCaptions', familyId: 'famA', postId: made.json.postId, captions: [[0, 1, 'New']] })).status, 200);
  assert.deepEqual(JSON.parse(s.world.tables.posts.get(made.json.postId).captions), [[0, 1, 'New']]);
  assert.equal((await s.call(s.bob, { action: 'setCaptions', familyId: 'famA', postId: made.json.postId, captions: [] })).json.captions, '');
  const text = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'text', body: 'hi' });
  assert.equal((await s.call(s.bob, { action: 'setCaptions', familyId: 'famA', postId: text.json.postId, captions: [[0, 1, 'x']] })).status, 400);
  // bad input is refused
  for (const bad of ['text', [[1, 0.5, 'a']], [[0, 1]], [[2, 3, 'a'], [1, 2, 'b']], [[0, 1, 5]], [[0, 99999, 'a']], Array.from({ length: 401 }, (_, i) => [i, i + 1, 'a'])]) {
    assert.equal((await s.call(s.bob, { action: 'setCaptions', familyId: 'famA', postId: made.json.postId, captions: bad })).status, 400, JSON.stringify(bad).slice(0, 40));
  }
  const long = Array.from({ length: 300 }, (_, i) => [i, i + 1, 'x'.repeat(150)]);
  assert.equal((await s.call(s.bob, { action: 'setCaptions', familyId: 'famA', postId: made.json.postId, captions: long })).status, 400);   // over the size the column holds
  // photos ignore captions
  s.addFile('fp', { owner: 'bob', familyId: 'famA' });
  const ph = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', mediaFileId: 'fp', captions: [[0, 1, 'x']] });
  assert.equal(s.world.tables.posts.get(ph.json.postId).captions, undefined);
});

test('repost: any member can remind the family; no file is copied; flattened; once a day; family-only', async () => {
  const s = await setup();
  s.addFile('fr', { owner: 'bob', familyId: 'famA' });
  const orig = await s.call(s.bob, { action: 'createPost', familyId: 'famA', kind: 'photo', body: 'Lake day', mediaFileId: 'fr' });
  const rp = await s.call(s.alice, { action: 'repostPost', familyId: 'famA', postId: orig.json.postId });
  assert.equal(rp.status, 200);
  const row = s.world.tables.posts.get(rp.json.postId);
  assert.deepEqual([row.kind, row.body, row.repostOfId, row.authorId, row.mediaFileId], ['repost', 'Remember this day?', orig.json.postId, 'alice', undefined]);
  assert.deepEqual(row.$permissions, ['read("team:famA")']);
  assert.equal(Object.keys(s.world.files).length, 1);                                         // still just the one original file
  assert.equal((await s.call(s.alice, { action: 'repostPost', familyId: 'famA', postId: orig.json.postId })).status, 409);   // not twice in a day
  const note = await s.call(s.bob, { action: 'repostPost', familyId: 'famA', postId: rp.json.postId, body: 'Best day ever' });   // a repost of a repost points at the original
  assert.equal(s.world.tables.posts.get(note.json.postId).repostOfId, orig.json.postId);
  assert.equal(s.world.tables.posts.get(note.json.postId).body, 'Best day ever');
  assert.equal((await s.call(s.carol, { action: 'repostPost', familyId: 'famA', postId: orig.json.postId })).status, 403);   // not in the family
  assert.equal((await s.call(s.alice, { action: 'repostPost', familyId: 'famA', postId: 'nope' })).status, 404);
  assert.equal((await s.call(s.alice, { action: 'createPost', familyId: 'famA', kind: 'repost', body: 'x' })).status, 400);   // cannot be faked through createPost
  assert.equal((await s.call(s.alice, { action: 'deletePost', familyId: 'famA', postId: rp.json.postId })).status, 200);
  assert.ok(s.world.tables.posts.has(orig.json.postId));                                       // deleting a repost keeps the original
});

test('inviting by relationship connects every kind, adding unnamed placeholders for missing middle people', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  const add = (name, relation) => s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name, relation });
  const rows = () => [...s.world.tables.people.values()];
  const by = (n) => rows().find((r) => r.name === n);
  const me = () => rows().find((r) => r.userId === s.alice.$id);
  const sib = await add('Sis', 'sibling'); assert.equal(sib.json.linked, true);
  assert.ok(me().parentIds.length === 1 && by('Sis').parentIds[0] === me().parentIds[0], 'sibling shares a parent');
  const unc = await add('Uncle Joe', 'aunt_uncle'); assert.equal(unc.json.linked, true);
  const myParent = rows().find((r) => r.$id === me().parentIds[0]);
  assert.ok(myParent.parentIds.length === 1 && by('Uncle Joe').parentIds[0] === myParent.parentIds[0], 'uncle shares my parent\'s parent');
  const nn = await add('Nephew', 'niece_nephew'); assert.equal(by('Nephew').parentIds[0], by('Sis').$id);
  const co = await add('Cousin', 'cousin'); assert.equal(by('Cousin').parentIds[0], by('Uncle Joe').$id);
  const gc = await add('Grandkid', 'grandchild'); assert.ok(rows().find((r) => r.$id === by('Grandkid').parentIds[0]).parentIds.includes(me().$id));
  const gp = await add('Granny', 'grandparent'); assert.ok(myParent.parentIds.includes(by('Granny').$id));
  assert.equal(nn.json.linked && co.json.linked && gc.json.linked && gp.json.linked, true);
});

test('a member who joined but never saved a profile can still be linked to their tree entry', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });   // bob never saves a profile
  const r = await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Bobby', relation: 'child', inviteMembershipId: 'm_famA_bob' });
  assert.equal(r.status, 200);
  const sync = await s.call(s.alice, { action: 'treeSyncInvites', familyId: 'famA' });
  assert.equal(sync.json.linked, 1);
  assert.equal(s.world.tables.people.get(r.json.personId).userId, 'bob');
  assert.equal((await s.call(s.alice, { action: 'treeSyncInvites', familyId: 'famA' })).json.linked, 0);
  assert.equal((await s.call(s.bob, { action: 'treeSyncInvites', familyId: 'famA' })).status, 403);
  const other = await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Robert' });
  const link = await s.call(s.alice, { action: 'treeEditPerson', familyId: 'famA', personId: other.json.personId, userId: 'bob' });
  assert.equal(link.status, 400);   // already linked to Bobby
});

test('connecting someone already in the tree: sibling of a person with no parents, partner, child', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  const mkp = (name) => s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name });
  const me = await s.call(s.alice, { action: 'saveMyPerson', familyId: 'famA', name: 'Alice' });
  const ky = await mkp('Kylah'), bo = await mkp('Bo'), cy = await mkp('Cy');
  const rows = () => [...s.world.tables.people.values()];
  const link = (id, relation, of) => s.call(s.alice, { action: 'treeLinkRelative', familyId: 'famA', personId: id, relation, relationOf: of });
  assert.equal((await link(ky.json.personId, 'sibling', me.json.personId)).status, 200);
  const k = s.world.tables.people.get(ky.json.personId), m = s.world.tables.people.get(me.json.personId);
  assert.ok(k.parentIds.length === 1 && m.parentIds[0] === k.parentIds[0], 'share a placeholder parent');
  assert.equal((await link(bo.json.personId, 'partner', me.json.personId)).status, 200);
  assert.ok(s.world.tables.people.get(bo.json.personId).partnerIds.includes(me.json.personId) && s.world.tables.people.get(me.json.personId).partnerIds.includes(bo.json.personId));
  assert.equal((await link(cy.json.personId, 'child', me.json.personId)).status, 200);
  assert.ok(s.world.tables.people.get(cy.json.personId).parentIds.includes(me.json.personId));
  assert.equal((await link(cy.json.personId, 'other', me.json.personId)).status, 400);
  assert.equal((await s.call(s.bob, { action: 'treeLinkRelative', familyId: 'famA', personId: cy.json.personId, relation: 'child', relationOf: me.json.personId })).status, 403);
  // adding a brand-new sibling of someone with no parents also works
  const nw = await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Newbie', relation: 'sibling', relationOf: bo.json.personId });
  assert.equal(nw.json.linked, true); assert.ok(s.world.tables.people.get(nw.json.personId).parentIds.length === 1);
});

test('inviting someone who is already in the tree without an account (e.g. a parent): entry becomes theirs, links stay', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  const add = (b) => s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', ...b });
  const r = await add({ name: 'Mom', relation: 'parent' });
  assert.equal(r.status, 200);
  const momId = r.json.personId;
  // not an admin: refused
  const denied = await s.call(s.bob, { action: 'treeEditPerson', familyId: 'famA', personId: momId, inviteMembershipId: 'm_famA_bob' });
  assert.notEqual(denied.status, 200);
  // the owner attaches the invitation to the existing entry
  const ok = await s.call(s.alice, { action: 'treeEditPerson', familyId: 'famA', personId: momId, inviteMembershipId: 'm_famA_bob' });
  assert.equal(ok.status, 200);
  assert.equal(s.world.tables.people.get(momId).inviteMembershipId, 'm_famA_bob');
  // she accepts: the same entry is now hers and Alice is still her child
  const claim = await s.call(s.bob, { action: 'claimInvite', familyId: 'famA' });
  assert.equal(claim.json.claimed, true);
  assert.equal(s.world.tables.people.get(momId).userId, 'bob');
  const aliceRow = [...s.world.tables.people.values()].find((p) => p.userId === 'alice');
  assert.ok(aliceRow.parentIds.includes(momId));
});

test('profile banner: a colour or a picture/GIF is stored, checked, and the old file is removed', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  const save = (items) => s.call(s.alice, { action: 'saveAbout', familyId: 'famA', about: [{ key: 'banner', title: 'Banner', items }] });
  assert.equal((await save(['color:#112233'])).status, 200);
  assert.equal((await save(['color:red'])).status, 400);
  assert.equal((await save(['file:../x'])).status, 400);
  s.addFile('ban1', { owner: 'alice', familyId: 'famA', mime: 'image/gif', size: 2.5 * 1024 * 1024 });
  assert.equal((await save(['file:ban1'])).status, 200);
  s.addFile('big', { owner: 'alice', familyId: 'famA', mime: 'image/gif', size: 4 * 1024 * 1024 });
  assert.equal((await save(['file:big'])).status, 400);
  assert.equal((await save(['color:#445566'])).status, 200);
  assert.equal(s.world.files.ban1, undefined, 'the replaced banner file is deleted');
});

test('page style is stored when valid and refused when not', async () => {
  const s = await setup();
  await s.call(s.alice, { action: 'saveProfile', familyId: 'famA', displayName: 'Alice' });
  const save = (items) => s.call(s.alice, { action: 'saveAbout', familyId: 'famA', about: [{ key: 'pagestyle', title: 'Page', items }] });
  assert.equal((await save(['bg:g2', 'border:#aa00ff', 'bstyle:dashed', 'bwidth:3', 'font:serif', 'round:lg', 'accent:#112233', 'fa:#ff6bb5', 'fb:#ffb347', 'fc:#5ad1ff'])).status, 200);
  assert.equal((await save(['bstyle:wavy'])).status, 400);
  assert.equal((await save(['bstyle:zigzag', 'border:#2c5282', 'border2:#f6e7c8'])).status, 200);
  assert.equal((await save(['bstyle:baroque'])).status, 200);
  assert.equal((await save(['btn:lace', 'btnc:#c9a46a', 'btns:3'])).status, 200);
  assert.equal((await save(['btn:classic', 'btnc:#112233', 'btnw:6'])).status, 200);
  assert.equal((await save(['btn:fringe'])).status, 200);
  assert.equal((await save(['font:marker'])).status, 200);
  assert.equal((await save(['font:Comic Sans'])).status, 400);
  assert.equal((await save(['bg:#112233', 'gc1:#ff9a8b', 'gc2:#7c5cff', 'gd:90', 'accent:#0b84f3', 'fa:#ff6bb5', 'fb:#ffb347', 'fc:#5ad1ff', 'txt:#222222', 'font:serif', 'round:lg', 'btn:lace', 'btnc:#c9a46a', 'btnw:3', 'btns:3'])).status, 200);   // 15 settings: more than a normal category's 12, allowed for the page look

  assert.equal((await save(['gc1:#ff9a8b', 'gc2:#7c5cff', 'gd:225'])).status, 200);
  assert.equal((await save(['gc1:#ff9a8b', 'gd:100'])).status, 400);
  assert.equal((await save(['txt:#112233'])).status, 200);
  assert.equal((await save(['txt:red'])).status, 400);
  assert.equal((await save(['btn:sparkly'])).status, 400);
  assert.equal((await save(['btn:lace', 'btns:4'])).status, 400);
  assert.equal((await save(['btn:lace', 'btnc:url(x)'])).status, 400);
  assert.equal((await save(['btn:lace', 'btn:hearts'])).status, 400);
  assert.equal((await save(['bg:red'])).status, 400);
  assert.equal((await save(['bwidth:9'])).status, 400);
  assert.equal((await save(['font:serif', 'font:mono'])).status, 400);
});

/* ---------- Checkpoint 3: access hardening ---------- */
import fs from 'node:fs';
const LOGIC_ACTIONS = [...fs.readFileSync(new URL('../src/logic.js', import.meta.url), 'utf8').matchAll(/\n    async (\w+)\(\{ user/g)].map((m) => m[1]).filter((a) => !['listFamilies', 'registerFamily'].includes(a));
const attemptBody = (action, familyId) => ({ action, familyId, postId: 'p1', commentId: 'c1', personId: 'x1', suggestionId: 's1', userId: 'bob', admin: true, name: 'Zed', displayName: 'Zed', kind: 'text', body: 'hi', text: 'hello there', status: 'done', confirm: true, collection: 'c', parentId: '', fileId: 'f1', pinned: true, teamId: familyId });

test('EVERY family action (read from the source, none skipped) refuses an outsider, a member of another family and a removed member', async () => {
  assert.ok(LOGIC_ACTIONS.length >= 25, 'found the action list: ' + LOGIC_ACTIONS.length);
  const s = await setup();
  s.world.teams.famA.members.push(member('erin'));
  const erin = s.user('erin');
  assert.equal((await s.call(erin, { action: 'saveProfile', familyId: 'famA', displayName: 'Erin' })).status, 200);
  const results = [];
  const round = async (who, label) => { for (const a of LOGIC_ACTIONS) { const r = await s.call(who, attemptBody(a, 'famA')); results.push(`${label} ${a} -> ${r.status}`); assert.equal(r.status, 403, `${label}: ${a} must be refused with 403, got ${r.status} ${JSON.stringify(r.json)}`); } };
  await round(s.dave, 'outsider');
  await round(s.carol, 'member of another family');
  s.world.teams.famA.members = s.world.teams.famA.members.filter((m) => m.userId !== 'erin');   // removed while signed in: the very next request is checked against the live membership list
  await round(erin, 'removed member');
  assert.equal(results.length, LOGIC_ACTIONS.length * 3);
});

test('role changes are read live: a demoted owner and a removed tree admin lose their powers on the very next request', async () => {
  const s = await setup();
  assert.equal((await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' })).status, 200);
  assert.equal((await s.call(s.alice, { action: 'setTreeAdmin', familyId: 'famA', userId: 'bob', admin: true })).status, 200);
  assert.equal((await s.call(s.bob, { action: 'treeAddPerson', familyId: 'famA', name: 'Cousin' })).status, 200);
  assert.equal((await s.call(s.alice, { action: 'setTreeAdmin', familyId: 'famA', userId: 'bob', admin: false })).status, 200);
  assert.equal((await s.call(s.bob, { action: 'treeAddPerson', familyId: 'famA', name: 'Cousin 2' })).status, 403, 'tree admin switched off: refused at once');
  s.world.teams.famA.members.find((m) => m.userId === 'alice').roles = ['member'];   // alice is no longer an owner
  assert.equal((await s.call(s.alice, { action: 'setTreeAdmin', familyId: 'famA', userId: 'bob', admin: true })).status, 403, 'a demoted owner cannot choose tree admins');
  assert.equal((await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'No' })).status, 403, 'and is not a tree editor either');
});

test('a tree admin of family A has no powers in family B, and the owner of A is only a plain outsider in B', async () => {
  const s = await setup();
  s.world.teams.famB.members.push(member('bob'));          // bob is in both families; admin only in A
  assert.equal((await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' })).status, 200);
  assert.equal((await s.call(s.alice, { action: 'setTreeAdmin', familyId: 'famA', userId: 'bob', admin: true })).status, 200);
  assert.equal((await s.call(s.bob, { action: 'saveProfile', familyId: 'famB', displayName: 'Bob B' })).status, 200);
  assert.equal((await s.call(s.bob, { action: 'treeAddPerson', familyId: 'famB', name: 'Nope' })).status, 403, 'tree admin of A cannot edit the tree of B');
  assert.equal((await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famB', name: 'Nope' })).status, 403, 'owner of A cannot edit the tree of B');
  assert.equal((await s.call(s.alice, { action: 'deleteFamily', familyId: 'famB' })).status, 403);
});

test('DEFECT CHECK: admin powers granted in an earlier membership do not come back when the same person is re-invited', async () => {
  const s = await setup();
  assert.equal((await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' })).status, 200);
  assert.equal((await s.call(s.alice, { action: 'setTreeAdmin', familyId: 'famA', userId: 'bob', admin: true })).status, 200);
  s.world.teams.famA.members = s.world.teams.famA.members.filter((m) => m.userId !== 'bob');      // removed (or left)
  await s.api.handleEvent({ event: 'teams.famA.memberships.m9.delete', payload: { teamId: 'famA', userId: 'bob' }, deadline: Number.MAX_SAFE_INTEGER });   // what Appwrite sends
  assert.equal((await s.call(s.bob, { action: 'treeAddPerson', familyId: 'famA', name: 'x' })).status, 403);
  s.world.teams.famA.members.push(member('bob'));                                                 // later re-invited as an ordinary member
  const r = await s.call(s.bob, { action: 'treeAddPerson', familyId: 'famA', name: 'Sneaky' });
  assert.equal(r.status, 403, 'a re-invited member must start with NO admin powers; got ' + r.status);
});

test('the owner\'s reconcile call (sent by the app right after a removal) also switches the removed person\'s admin flags off, and never touches a current member', async () => {
  const s = await setup();
  await s.call(s.bob, { action: 'saveProfile', familyId: 'famA', displayName: 'Bob' });
  await s.call(s.alice, { action: 'setTreeAdmin', familyId: 'famA', userId: 'bob', admin: true });
  await s.call(s.alice, { action: 'chatReconcile', familyId: 'famA', userId: 'bob' });                 // bob is still a member: nothing changes
  assert.equal((await s.call(s.bob, { action: 'treeAddPerson', familyId: 'famA', name: 'Still admin' })).status, 200);
  s.world.teams.famA.members = s.world.teams.famA.members.filter((m) => m.userId !== 'bob');
  await s.call(s.alice, { action: 'chatReconcile', familyId: 'famA', userId: 'bob' });
  s.world.teams.famA.members.push(member('bob'));
  assert.equal((await s.call(s.bob, { action: 'treeAddPerson', familyId: 'famA', name: 'Sneaky' })).status, 403);
});

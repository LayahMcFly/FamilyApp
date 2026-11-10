import test from 'node:test';
import assert from 'node:assert/strict';
import { Permission, Role } from 'node-appwrite';
import { createApi, TABLES } from '../src/logic.js';

/* ---------- in-memory fake of the server SDK services ---------- */
function makeWorld() {
  let seq = 0;
  const world = {
    tables: {},
    files: {},
    teams: {}, // teamId -> { name, members: [{userId, roles, confirm}] }
    userLabels: {},
    clock: 1_800_000_000_000
  };
  for (const t of Object.values(TABLES)) world.tables[t] = new Map();
  const err = (code, m) => Object.assign(new Error(m), { code });

  const parseQ = (q) => JSON.parse(q);
  const db = {
    async createRow({ tableId, rowId, data, permissions }) {
      const id = rowId === 'unique()' || rowId.startsWith('uniq') ? `r${++seq}` : rowId;
      const table = world.tables[tableId];
      if (table.has(id)) throw err(409, 'exists');
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
  return { world, call, user, addTeam, addFile };
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

test('tree link kinds: adoptive, step, foster and partner status are stored, validated and pruned', async () => {
  const s = await setup();
  const add = (b) => s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', ...b });
  const edit = (id, b) => s.call(s.alice, { action: 'treeEditPerson', familyId: 'famA', personId: id, ...b });
  const bio = (await add({ name: 'Birth mum' })).json.personId;
  const ad = (await add({ name: 'Adoptive dad' })).json.personId;
  const third = (await add({ name: 'Step mum' })).json.personId;
  const kid = (await add({ name: 'Kid', parentIds: [bio, ad, third] })).json.personId;   // three parents can be stored
  assert.equal(s.world.tables.people.get(kid).parentIds.length, 3);
  const ok = await edit(kid, { relKinds: { ['p:' + ad]: 'adoptive', ['p:' + third]: 'step', ['p:' + bio]: 'biological' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(s.world.tables.people.get(kid).relKinds), { ['p:' + ad]: 'adoptive', ['p:' + third]: 'step' });   // "biological" is the default, not stored
  // refused: unknown kind, a person who is not a parent, a malformed key, a non-object
  assert.equal((await edit(kid, { relKinds: { ['p:' + ad]: 'pirate' } })).status, 400);
  assert.equal((await edit(kid, { relKinds: { ['p:' + kid]: 'adoptive' } })).status, 400);
  assert.equal((await edit(kid, { relKinds: { 'x:1': 'adoptive' } })).status, 400);
  assert.equal((await edit(kid, { relKinds: ['adoptive'] })).status, 400);
  // removing a parent prunes that entry
  assert.equal((await edit(kid, { parentIds: [bio, third] })).status, 200);
  assert.deepEqual(JSON.parse(s.world.tables.people.get(kid).relKinds), { ['p:' + third]: 'step' });
  // partner status
  const ex = (await add({ name: 'Ex', partnerIds: [bio] })).json.personId;
  assert.equal((await edit(bio, { relKinds: { ['s:' + ex]: 'divorced' } })).status, 200);
  assert.deepEqual(JSON.parse(s.world.tables.people.get(ex).relKinds), { ['s:' + bio]: 'divorced' });   // the other person's record says the same
  assert.equal((await edit(bio, { relKinds: { ['s:' + ex]: 'married' } })).status, 200);
  assert.deepEqual(JSON.parse(s.world.tables.people.get(ex).relKinds), { ['s:' + bio]: 'married' });
  assert.equal((await edit(bio, { relKinds: { ['s:' + ex]: 'partner' } })).status, 200);   // back to the default: nothing stored on either side
  assert.deepEqual(JSON.parse(s.world.tables.people.get(ex).relKinds), {});
  assert.equal((await edit(bio, { relKinds: { ['s:' + ex]: 'divorced' } })).status, 200);
  assert.equal((await edit(bio, { partnerIds: [] })).status, 200);   // ending the link removes the label too
  assert.deepEqual(JSON.parse(s.world.tables.people.get(ex).relKinds), {});
  // a plain member cannot change link kinds
  assert.equal((await s.call(s.bob, { action: 'treeEditPerson', familyId: 'famA', personId: kid, relKinds: {} })).status, 403);
});

test('tree privacy: two families never see or touch each other\'s people', async () => {
  const s = await setup();
  const a = (await s.call(s.alice, { action: 'treeAddPerson', familyId: 'famA', name: 'Alpha person' })).json.personId;
  const b = (await s.call(s.carol, { action: 'treeAddPerson', familyId: 'famB', name: 'Beta person' })).json.personId;
  // every stored person is readable only by its own family's team
  assert.deepEqual(s.world.tables.people.get(a).$permissions, ['read("team:famA")']);
  assert.deepEqual(s.world.tables.people.get(b).$permissions, ['read("team:famB")']);
  // carol (family B owner) cannot read, edit, delete, link or suggest on family A's people, even by naming her own family
  const tries = [
    { action: 'treeEditPerson', familyId: 'famA', personId: a, name: 'x' },
    { action: 'treeDeletePerson', familyId: 'famA', personId: a },
    { action: 'treeEditPerson', familyId: 'famB', personId: a, name: 'x' },
    { action: 'treeDeletePerson', familyId: 'famB', personId: a },
    { action: 'treeConfirm', familyId: 'famB', personId: a },
    { action: 'suggestTreeChange', familyId: 'famB', personId: a, text: 'hello there' },
    { action: 'treeAddPerson', familyId: 'famB', name: 'Link', parentIds: [a] },
    { action: 'treeAddPerson', familyId: 'famA', name: 'Intruder' }
  ];
  for (const t of tries) {
    const r = await s.call(s.carol, t);
    assert.ok(r.status === 403 || r.status === 404 || r.status === 400, `${t.action} on ${t.familyId} should be refused, got ${r.status}`);
  }
  assert.equal(s.world.tables.people.get(a).name, 'Alpha person');
  assert.equal(s.world.tables.people.size, 2);
});

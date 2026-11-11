import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, TABLES } from '../src/logic.js';

/* ---------- a small fake of Appwrite: tables with permissions, teams, and a "browser session" permission check ---------- */
function world() {
  const err = (code, m) => Object.assign(new Error(m), { code });
  const w = { tables: {}, teams: {}, calls: [] };
  for (const t of Object.values(TABLES)) w.tables[t] = new Map();
  const db = {
    async getRow({ tableId, rowId }) { const r = w.tables[tableId].get(rowId); if (!r) throw err(404, 'nope'); return r; },
    async createRow({ tableId, rowId, data, permissions }) { if (w.tables[tableId].has(rowId)) throw err(409, 'x'); const r = { ...data, $id: rowId, $permissions: permissions || [], $updatedAt: 't' }; w.tables[tableId].set(rowId, r); return r; },
    async updateRow({ tableId, rowId, data }) { const r = w.tables[tableId].get(rowId); if (!r) throw err(404, 'nope'); Object.assign(r, data); return r; },
    async deleteRow({ tableId, rowId }) { w.tables[tableId].delete(rowId); },
    async listRows({ tableId }) { return { rows: [...w.tables[tableId].values()], total: w.tables[tableId].size }; }
  };
  const users = { async listMemberships({ userId }) { return { memberships: Object.entries(w.teams).filter(([, t]) => t.members[userId]).map(([id, t]) => ({ teamId: id, teamName: id, confirm: t.members[userId].confirm !== false, roles: t.members[userId].roles })) }; } };
  const api = createApi({ users, teams: {}, db, storage: {}, cfg: { databaseId: 'family', bucketId: 'b', maxOwnedFamilies: 3, maxVideoMB: 15, familyStorageMB: 500 } });
  const U = (id) => ({ $id: id, emailVerification: true, status: true });
  // what Appwrite itself would allow a signed-in browser session to read: row permissions only (table permissions are empty)
  w.browserCanRead = (userId, tableId, rowId) => {
    const row = w.tables[tableId].get(rowId); if (!row) return false;
    const roles = userId ? ['any', 'users', 'user:' + userId, ...Object.entries(w.teams).filter(([, t]) => t.members[userId]).map(([id]) => 'team:' + id)] : ['any', 'guests'];
    return (row.$permissions || []).some((p) => { const m = /^read\("(.+)"\)$/.exec(p); return m && roles.includes(m[1]); });
  };
  w.ask = (user, action, body = {}) => api.handle({ user: user ? U(user) : null, body: { action, ...body } });
  return w;
}
const ADDR = { line1: '12 Rue de l’Église', line2: 'Apt 4B', city: 'Montréal', region: 'QC', postal: 'H2X 1Y4', country: 'Canada' };
function setup() {
  const w = world();
  w.tables.families.set('famA', { $id: 'famA' }); w.tables.families.set('famB', { $id: 'famB' });
  w.teams = {
    famA: { members: { owner1: { roles: ['owner'] }, alice: { roles: ['member'] }, bob: { roles: ['member'] }, admin1: { roles: ['owner'] }, gone: { roles: ['member'] } } },
    famB: { members: { alice: { roles: ['member'] }, carol: { roles: ['member'] } } }
  };
  return w;
}

test('default is private: saving with no sharing lets nobody else see it, and nobody can read the row from a browser', async () => {
  const w = setup();
  const r = await w.ask('alice', 'addressSave', ADDR);
  assert.equal(r.status, 200); assert.deepEqual(r.json.address.sharedWith, []);
  assert.deepEqual(w.tables.addresses.get('alice').$permissions, [], 'row has no permissions at all');
  for (const who of ['alice', 'bob', 'carol', 'admin1', 'gone', null]) assert.equal(w.browserCanRead(who, 'addresses', 'alice'), false, `${who} cannot read the row directly`);
  for (const who of ['bob', 'admin1', 'carol']) assert.equal((await w.ask(who, 'addressView', { familyId: w.teams.famA.members[who] ? 'famA' : 'famB', userId: 'alice' })).json.address, null);
});

test('sharing with one family: its members see it, another family and an un-granted admin do not', async () => {
  const w = setup();
  assert.equal((await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famA'] })).status, 400, 'needs the confirmation flag');
  assert.equal((await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famA'], confirmShare: true })).status, 200);
  assert.deepEqual((await w.ask('bob', 'addressView', { familyId: 'famA', userId: 'alice' })).json.address, { ...ADDR }, 'authorized member sees every field');
  assert.equal((await w.ask('carol', 'addressView', { familyId: 'famB', userId: 'alice' })).json.address, null, 'member of the unselected family');
  assert.equal((await w.ask('carol', 'addressView', { familyId: 'famA', userId: 'alice' })).status, 403, 'not a member of famA');
  // a family owner of famA is a member, so sharing with famA includes them; a family that was NOT selected gives its owner nothing
  assert.equal((await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famB'], confirmShare: true })).status, 200);
  assert.equal((await w.ask('admin1', 'addressView', { familyId: 'famA', userId: 'alice' })).json.address, null, 'owner/admin of famA, not granted');
  assert.equal((await w.ask('bob', 'addressView', { familyId: 'famA', userId: 'alice' })).json.address, null);
  assert.ok((await w.ask('carol', 'addressView', { familyId: 'famB', userId: 'alice' })).json.address);
  const none = await w.ask('bob', 'addressView', { familyId: 'famA', userId: 'carol' });
  assert.deepEqual(none.json, (await w.ask('bob', 'addressView', { familyId: 'famA', userId: 'alice' })).json, 'same answer for "none" and "not shared"');
});

test('revoking: Only me removes access at once; dropping one family removes just that family', async () => {
  const w = setup();
  await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famA', 'famB'], confirmShare: true });
  assert.ok((await w.ask('bob', 'addressView', { familyId: 'famA', userId: 'alice' })).json.address);
  await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famB'], confirmShare: true });
  assert.equal((await w.ask('bob', 'addressView', { familyId: 'famA', userId: 'alice' })).json.address, null);
  assert.ok((await w.ask('carol', 'addressView', { familyId: 'famB', userId: 'alice' })).json.address);
  await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'private' });
  assert.equal((await w.ask('carol', 'addressView', { familyId: 'famB', userId: 'alice' })).json.address, null);
});

test('a removed family member loses access through that membership; so does everyone when the owner leaves the family', async () => {
  const w = setup();
  await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famA'], confirmShare: true });
  assert.ok((await w.ask('gone', 'addressView', { familyId: 'famA', userId: 'alice' })).json.address);
  delete w.teams.famA.members.gone;
  assert.equal((await w.ask('gone', 'addressView', { familyId: 'famA', userId: 'alice' })).status, 403);
  w.teams.famA.members.bob.confirm = false;                                   // an invitation not accepted is not membership
  assert.equal((await w.ask('bob', 'addressView', { familyId: 'famA', userId: 'alice' })).status, 403);
  delete w.teams.famA.members.alice;                                           // the owner leaves famA
  assert.equal((await w.ask('owner1', 'addressView', { familyId: 'famA', userId: 'alice' })).json.address, null);
  assert.deepEqual((await w.ask('alice', 'addressGet')).json.address.sharedWith, [], 'a family the owner left is no longer listed');
});

test('signed-out visitors and bad input are refused; nobody can pick another owner or share to a family they are not in', async () => {
  const w = setup();
  await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famA'], confirmShare: true });
  for (const a of ['addressGet', 'addressSave', 'addressDelete', 'addressView']) assert.equal((await w.ask(null, a, { familyId: 'famA', userId: 'alice' })).status, 401, a);
  // an ownerId in the request is ignored: the row is always the caller's own
  await w.ask('bob', 'addressSave', { ...ADDR, line1: 'Bob street', ownerId: 'alice', userId: 'alice', id: 'alice' });
  assert.equal(w.tables.addresses.get('alice').line1, ADDR.line1, 'alice untouched');
  assert.equal(w.tables.addresses.get('bob').line1, 'Bob street');
  assert.equal((await w.ask('bob', 'addressDelete', { userId: 'alice' })).status, 200);
  assert.ok(w.tables.addresses.has('alice'), 'bob cannot delete alice’s address');
  assert.equal((await w.ask('bob', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famB'], confirmShare: true })).status, 403, 'bob is not in famB');
  assert.equal((await w.ask('bob', 'addressSave', { ...ADDR, line1: '' })).status, 400);
  assert.equal((await w.ask('bob', 'addressSave', { ...ADDR, country: '' })).status, 400);
  assert.equal((await w.ask('bob', 'addressSave', { ...ADDR, line1: 'x'.repeat(201) })).status, 400);
  assert.equal((await w.ask('bob', 'addressSave', { line1: 'Optional fields empty', country: 'Japan' })).status, 200, 'city, region, postal are optional');
});

test('apartment numbers and international characters survive; control characters do not; the app asks for nothing else', async () => {
  const w = setup();
  const jp = { line1: '東京都千代田区丸の内1-9-1', line2: '3階 301号室', city: '千代田区', region: '東京都', postal: '100-0005', country: '日本' };
  const r = await w.ask('alice', 'addressSave', jp);
  assert.deepEqual((await w.ask('alice', 'addressGet')).json.address, { ...jp, sharedWith: [], updatedAt: 't' });
  const t = await w.ask('alice', 'addressSave', { ...ADDR, line1: 'Straße 5\u0000\n\tHaus', line2: '' });
  assert.equal(t.json.address.line1, 'Straße 5 Haus');
  assert.equal(r.status, 200);
});

test('deleting removes the stored row entirely and is repeatable', async () => {
  const w = setup();
  await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famA'], confirmShare: true });
  assert.equal((await w.ask('alice', 'addressDelete')).status, 200);
  assert.equal(w.tables.addresses.size, 0);
  assert.equal((await w.ask('bob', 'addressView', { familyId: 'famA', userId: 'alice' })).json.address, null);
  assert.equal((await w.ask('alice', 'addressDelete')).status, 200);
  assert.equal((await w.ask('alice', 'addressGet')).json.address, null);
});

test('other responses never carry address fields (profile and family listings are separate records)', async () => {
  const w = setup();
  await w.ask('alice', 'addressSave', { ...ADDR, visibility: 'families', familyIds: ['famA'], confirmShare: true });
  const fam = await w.ask('bob', 'listFamilies');
  assert.equal(JSON.stringify(fam.json).includes('Rue'), false);
});

/*
 * One-time Appwrite setup for Family Chat (shared channels + direct messages).
 * Adds seven tables to the existing `family` database, one column to `profiles` (chatAdmin), the indexes the chat queries need,
 * then runs a self-check that sends every kind of query the function and the app use, so a missing index is reported here and not
 * later in the app. Safe to run again: anything that exists is skipped.
 *
 *   APPWRITE_ENDPOINT=... APPWRITE_PROJECT=... APPWRITE_KEY=... node setup-chat.mjs
 *   add  SEED=1  to also create the starter channels (general, announcements, plans-and-events) for every existing family.
 *        This is optional: the app creates them the first time someone opens chat. Both ways use the same unique key,
 *        so running either one any number of times never makes duplicates.
 *
 * The API key is temporary and only for this script (CHAT-GUIDE.md, step 3). Table permissions are empty on purpose: the browser
 * can never write these tables. Only the family-api function writes them, and each row says who may READ it.
 */
import { Client, TablesDB, Query, Permission, Role } from 'node-appwrite';

const endpoint = process.env.APPWRITE_ENDPOINT, projectId = process.env.APPWRITE_PROJECT, apiKey = process.env.APPWRITE_KEY;
if (!endpoint || !projectId || !apiKey) { console.error('Missing APPWRITE_ENDPOINT, APPWRITE_PROJECT or APPWRITE_KEY. See CHAT-GUIDE.md step 3.'); process.exit(1); }
const db = new TablesDB(new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey));
const databaseId = 'family';

const S = (key, size, required, def) => ({ type: 'string', key, size, required: !!required, def });
const B = (key, required, def) => ({ type: 'boolean', key, required: !!required, def });
const I = (key, required, def) => ({ type: 'integer', key, required: !!required, def, min: 0, max: 2000000000 });
const schema = {
  chatChannels: {
    columns: [S('familyId', 36, true), S('channelKey', 120, true), S('name', 40, true), S('description', 200, false, ''), I('position', false, 0), B('readOnly', false, false), B('archived', false, false), S('createdBy', 36, false, '')],
    indexes: [['idx_familyId', 'key', ['familyId']], ['uniq_channelKey', 'unique', ['channelKey']]]
  },
  chatMessages: {
    columns: [S('familyId', 36, true), S('convId', 36, true), S('kind', 8, true), S('authorId', 36, true), S('body', 2000, true), S('replyToId', 36, false, ''), S('clientId', 36, true), S('sendKey', 80, true), S('editedAt', 32, false, ''), S('media', 200, false, '')],
    indexes: [['idx_convId', 'key', ['convId']], ['idx_conv_author', 'key', ['convId', 'authorId']], ['idx_authorId', 'key', ['authorId']], ['idx_familyId', 'key', ['familyId']], ['uniq_sendKey', 'unique', ['sendKey']]]
  },
  chatReactions: {
    columns: [S('familyId', 36, true), S('convId', 36, true), S('messageId', 36, true), S('userId', 36, true), S('emoji', 8, true), S('reactionKey', 100, true)],
    indexes: [['idx_messageId', 'key', ['messageId']], ['idx_convId', 'key', ['convId']], ['idx_userId', 'key', ['userId']], ['idx_familyId', 'key', ['familyId']], ['uniq_reactionKey', 'unique', ['reactionKey']]]
  },
  chatDms: {
    columns: [S('familyId', 36, true), S('userA', 36, true), S('userB', 36, true), S('dmKey', 120, true), S('status', 8, true), S('lastAt', 40, false, ''), S('closedFor', 36, false, ''), B('pending', false, false)],
    indexes: [['idx_familyId', 'key', ['familyId']], ['idx_userA', 'key', ['userA']], ['idx_userB', 'key', ['userB']], ['idx_status', 'key', ['status']], ['uniq_dmKey', 'unique', ['dmKey']]]
  },
  chatReads: {
    columns: [S('familyId', 36, true), S('userId', 36, true), S('convId', 36, true), S('readKey', 80, true), S('lastReadAt', 40, true)],
    indexes: [['idx_user_family', 'key', ['userId', 'familyId']], ['idx_familyId', 'key', ['familyId']], ['uniq_readKey', 'unique', ['readKey']]]
  },
  chatTyping: {
    columns: [S('familyId', 36, true), S('convId', 36, true), S('userId', 36, true), S('typingKey', 80, true), S('text', 60, false, ''), S('until', 40, true)],
    indexes: [['idx_convId', 'key', ['convId']], ['idx_familyId', 'key', ['familyId']], ['uniq_typingKey', 'unique', ['typingKey']]]
  },
  chatBlocks: {
    columns: [S('familyId', 36, true), S('blockerId', 36, true), S('blockedId', 36, true), S('blockKey', 120, true)],
    indexes: [['idx_familyId', 'key', ['familyId']], ['idx_blockerId', 'key', ['blockerId']], ['idx_blockedId', 'key', ['blockedId']], ['uniq_blockKey', 'unique', ['blockKey']]]
  },
  chatMod: {
    columns: [S('familyId', 36, true), S('actorId', 36, true), S('action', 32, true), S('convId', 36, false, ''), S('targetUserId', 36, false, '')],
    indexes: [['idx_familyId', 'key', ['familyId']]]
  },
  // the one column added to an existing table: who the family owner made a chat admin
  profiles: { existing: true, columns: [B('chatAdmin', false, false)], indexes: [] }
};
const DEFAULT_CHANNELS = [
  { slug: 'general', name: 'general', description: 'Everyday conversation for the whole family.', readOnly: false },
  { slug: 'announcements', name: 'announcements', description: 'News from the family owner and chat admins. Everyone can read it; only admins can post.', readOnly: true },
  { slug: 'plans-and-events', name: 'plans-and-events', description: 'Trips, birthdays, dinners and get-togethers: who is coming, when and where.', readOnly: false }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(label, fn) {
  try { await fn(); console.log('  created  ' + label); }
  catch (e) {
    if (e && e.code === 409) console.log('  exists   ' + label);
    else { console.error('\nFAILED: ' + label + '\n  ' + (e.message || e) + (e.code ? ' (code ' + e.code + ')' : '')); if (e.code === 401) console.error('  The API key is missing a scope. See CHAT-GUIDE.md step 3.'); process.exit(1); }
  }
}
async function waitForColumns(tableId, keys) {
  for (let i = 0; i < 90; i++) {
    const res = await db.listColumns({ databaseId, tableId, queries: [Query.limit(100)] });
    const by = Object.fromEntries(res.columns.map((c) => [c.key, c.status]));
    if (keys.some((k) => by[k] === 'failed' || by[k] === 'stuck')) throw new Error('A column failed to build in ' + tableId);
    if (keys.every((k) => by[k] === 'available')) return true;
    await sleep(2000);
  }
  console.log('\n  Some columns are still building in ' + tableId + '. Run this again in a few minutes.');
  return false;
}
async function waitForIndexes(tableId, keys) {
  for (let i = 0; i < 60; i++) {
    const res = await db.listIndexes({ databaseId, tableId, queries: [Query.limit(100)] });
    const by = Object.fromEntries(res.indexes.map((x) => [x.key, x.status]));
    if (keys.some((k) => by[k] === 'failed' || by[k] === 'stuck')) throw new Error('An index failed to build in ' + tableId);
    if (keys.every((k) => by[k] === 'available')) return true;
    await sleep(2000);
  }
  return false;
}

for (const [tableId, def] of Object.entries(schema)) {
  console.log('\nTable ' + tableId + (def.existing ? ' (existing; adding a column)' : ''));
  if (!def.existing) await step('table', () => db.createTable({ databaseId, tableId, name: tableId, permissions: [], rowSecurity: true }));
  for (const c of def.columns) {
    await step('column ' + c.key, () => {
      const base = { databaseId, tableId, key: c.key, required: c.required };
      const d = c.def !== undefined && !c.required ? { xdefault: c.def } : {};
      if (c.type === 'string') return db.createStringColumn({ ...base, size: c.size, ...d });
      if (c.type === 'boolean') return db.createBooleanColumn({ ...base, ...d });
      return db.createIntegerColumn({ ...base, min: c.min, max: c.max, ...d });
    });
  }
  process.stdout.write('  waiting for columns to finish building');
  await waitForColumns(tableId, def.columns.map((c) => c.key));
  console.log(' ... ready');
  for (const [key, type, columns] of def.indexes) await step('index ' + key, () => db.createIndex({ databaseId, tableId, key, type, columns, orders: columns.map(() => 'asc') }));
  if (def.indexes.length) { process.stdout.write('  waiting for indexes'); await waitForIndexes(tableId, def.indexes.map((x) => x[0])); console.log(' ... ready'); }
}

/* ---------- self-check: one query of every shape the chat uses ---------- */
console.log('\nSelf-check (every query the chat uses)');
const probe = 'zzzzzzzzzzzzzzzzzzzz', iso = new Date().toISOString();
const checks = [
  ['chatChannels', [Query.equal('familyId', [probe]), Query.limit(50)]],
  ['chatMessages', [Query.equal('convId', [probe]), Query.notEqual('authorId', [probe]), Query.greaterThan('$createdAt', iso), Query.limit(10)]],
  ['chatMessages', [Query.equal('authorId', [probe]), Query.greaterThan('$createdAt', iso), Query.limit(7)]],
  ['chatMessages', [Query.equal('convId', [probe]), Query.orderDesc('$createdAt'), Query.limit(30)]],
  ['chatMessages', [Query.equal('sendKey', [probe]), Query.limit(1)]],
  ['chatMessages', [Query.equal('familyId', [probe]), Query.limit(1)]],
  ['chatReactions', [Query.equal('messageId', [probe, probe + '2']), Query.limit(100)]],
  ['chatReactions', [Query.equal('convId', [probe]), Query.limit(50)]],
  ['chatReactions', [Query.equal('userId', [probe]), Query.greaterThan('$createdAt', iso), Query.limit(21)]],
  ['chatReactions', [Query.equal('reactionKey', [probe]), Query.limit(1)]],
  ['chatDms', [Query.equal('familyId', [probe]), Query.or([Query.equal('userA', [probe]), Query.equal('userB', [probe])]), Query.limit(100)]],
  ['chatDms', [Query.equal('familyId', [probe]), Query.or([Query.equal('userA', [probe]), Query.equal('userB', [probe])]), Query.equal('status', ['open']), Query.limit(100)]],
  ['chatDms', [Query.equal('dmKey', [probe]), Query.limit(1)]],
  ['chatReads', [Query.equal('userId', [probe]), Query.equal('familyId', [probe]), Query.limit(100)]],
  ['chatReads', [Query.equal('readKey', [probe]), Query.limit(1)]],
  ['chatTyping', [Query.equal('typingKey', [probe]), Query.limit(1)]],
  ['chatBlocks', [Query.equal('familyId', [probe]), Query.equal('blockerId', [probe]), Query.equal('blockedId', [probe, '*']), Query.limit(1)]],
  ['chatBlocks', [Query.equal('blockKey', [probe]), Query.limit(1)]],
  ['chatMod', [Query.equal('familyId', [probe]), Query.orderDesc('$createdAt'), Query.limit(50)]],
  ['profiles', [Query.equal('profileKey', [probe]), Query.limit(1)]]
];
let bad = 0;
for (const [tableId, queries] of checks) {
  try { await db.listRows({ databaseId, tableId, queries }); console.log('  ok       ' + tableId + '  ' + queries.map((q) => JSON.parse(q).method + ':' + (JSON.parse(q).attribute || '')).join(' '));
  } catch (e) { bad++; console.log('  PROBLEM  ' + tableId + ': ' + (e.message || e)); }
}
if (bad) { console.log('\n' + bad + ' check(s) failed. Read the PROBLEM lines above, fix, and run this again.'); process.exit(1); }

/* ---------- optional: starter channels for families that already exist ---------- */
if (process.env.SEED === '1') {
  console.log('\nStarter channels for existing families');
  let cursor = null, families = 0;
  for (;;) {
    const q = [Query.limit(50)]; if (cursor) q.push(Query.cursorAfter(cursor));
    const page = await db.listRows({ databaseId, tableId: 'families', queries: q });
    for (const f of page.rows) {
      families++;
      const has = await db.listRows({ databaseId, tableId: 'chatChannels', queries: [Query.equal('familyId', [f.$id]), Query.limit(1)] });
      if (has.rows.length) { console.log('  exists   ' + f.name + ' already has channels'); continue; }
      for (let i = 0; i < DEFAULT_CHANNELS.length; i++) {
        const d = DEFAULT_CHANNELS[i];
        try { await db.createRow({ databaseId, tableId: 'chatChannels', rowId: 'unique()', data: { familyId: f.$id, channelKey: `${f.$id}_${d.slug}`, name: d.name, description: d.description, position: i, readOnly: d.readOnly, archived: false, createdBy: f.ownerId }, permissions: [Permission.read(Role.team(f.$id))] }); }
        catch (e) { if (e.code !== 409) throw e; }
      }
      console.log('  created  starter channels for ' + f.name);
    }
    if (page.rows.length < 50) break;
    cursor = page.rows[page.rows.length - 1].$id;
  }
  console.log('  ' + families + ' families checked');
}
console.log('\nDone. Next: update family-api and add the event trigger (CHAT-GUIDE.md steps 4-5).');

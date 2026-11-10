/*
 * One-time Appwrite setup for Family Circle.
 * Creates: the `family` database, six tables (columns, indexes, Row security ON, NO table
 * permissions) and the `family-media` bucket. It can be run again safely: anything that
 * already exists is skipped.
 *
 * It does NOT create the Function (that part is in the Setup Guide).
 *
 * Usage (see SETUP-SCRIPT.md):
 *   APPWRITE_ENDPOINT=... APPWRITE_PROJECT=... APPWRITE_KEY=... node setup-appwrite.mjs
 */
import { Client, TablesDB, Storage, Permission, Role } from 'node-appwrite';

const endpoint = process.env.APPWRITE_ENDPOINT;
const projectId = process.env.APPWRITE_PROJECT;
const apiKey = process.env.APPWRITE_KEY;
if (!endpoint || !projectId || !apiKey) {
  console.error('Missing APPWRITE_ENDPOINT, APPWRITE_PROJECT or APPWRITE_KEY. See SETUP-SCRIPT.md.');
  process.exit(1);
}
const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
const db = new TablesDB(client);
const storage = new Storage(client);
const databaseId = 'family';

/* ---------- the schema (matches SETUP-GUIDE.md and function/src/logic.js) ---------- */
const S = (key, size, required) => ({ type: 'string', key, size, required });
const schema = {
  families: {
    columns: [S('ownerId', 36, true), S('name', 60, true)],
    indexes: [['idx_ownerId', 'key', ['ownerId']]]
  },
  profiles: {
    columns: [S('familyId', 36, true), S('userId', 36, true), S('profileKey', 80, true), S('displayName', 60, true), S('avatarFileId', 36, false), S('bio', 200, false), S('about', 8000, false), { type: 'boolean', key: 'treeAdmin', required: false }],
    indexes: [['idx_familyId', 'key', ['familyId']], ['uniq_profileKey', 'unique', ['profileKey']], ['idx_avatarFileId', 'key', ['avatarFileId']]]
  },
  posts: {
    columns: [
      S('familyId', 36, true), S('authorId', 36, true),
      { type: 'enum', key: 'kind', elements: ['text', 'photo', 'video', 'short'], required: true },
      S('body', 2000, false), S('mediaFileId', 36, false), S('mediaMime', 32, false), S('pinnedCommentIds', 120, false), S('editedAt', 32, false), S('captions', 16000, false), S('repostOfId', 36, false),
      { type: 'integer', key: 'mediaSize', min: 0, max: 52428800, required: false }
    ],
    indexes: [['idx_familyId', 'key', ['familyId']], ['idx_family_kind', 'key', ['familyId', 'kind']], ['idx_mediaFileId', 'key', ['mediaFileId']]]
  },
  comments: {
    columns: [S('familyId', 36, true), S('postId', 36, true), S('authorId', 36, true), S('body', 500, true), S('parentId', 36, false), { type: 'string', key: 'likedBy', size: 36, required: false, array: true }],
    indexes: [['idx_postId', 'key', ['postId']], ['idx_familyId', 'key', ['familyId']]]
  },
  reactions: {
    columns: [S('familyId', 36, true), S('postId', 36, true), S('userId', 36, true), S('reactionKey', 80, true)],
    indexes: [['idx_postId', 'key', ['postId']], ['idx_familyId', 'key', ['familyId']], ['uniq_reactionKey', 'unique', ['reactionKey']]]
  },
  people: {
    columns: [S('familyId', 36, true), S('name', 80, true), S('userId', 36, false), { type: 'boolean', key: 'confirmed', required: false }, { type: 'string', key: 'parentIds', size: 36, required: false, array: true }, { type: 'string', key: 'partnerIds', size: 36, required: false, array: true }, S('createdBy', 36, false), S('birthday', 10, false), S('gender', 20, false), S('inviteMembershipId', 36, false), S('parentKinds', 600, false)],
    indexes: [['idx_familyId', 'key', ['familyId']]]
  },
  suggestions: {
    columns: [S('familyId', 36, true), S('authorId', 36, true), S('personId', 36, false), S('text', 500, true), S('status', 12, true)],
    indexes: [['idx_familyId', 'key', ['familyId']], ['idx_authorId', 'key', ['authorId']], ['idx_status', 'key', ['status']]]
  },
  bookmarks: {
    columns: [S('familyId', 36, true), S('userId', 36, true), S('postId', 36, true), S('bookmarkKey', 80, true), S('collectionId', 24, false)],
    indexes: [['idx_user_family', 'key', ['userId', 'familyId']], ['idx_postId', 'key', ['postId']], ['idx_familyId', 'key', ['familyId']], ['uniq_bookmarkKey', 'unique', ['bookmarkKey']]]
  }
};

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (e) => e && e.code === 409;
async function step(label, fn) {
  try {
    await fn();
    console.log('  created  ' + label);
  } catch (e) {
    if (exists(e)) console.log('  exists   ' + label);
    else {
      console.error('\nFAILED: ' + label + '\n  ' + (e.message || e) + (e.code ? ' (code ' + e.code + ')' : ''));
      if (e.code === 401) console.error('  The API key is missing a permission. Re-create it with the scopes listed in SETUP-SCRIPT.md.');
      process.exit(1);
    }
  }
}
async function waitForColumns(tableId, keys) {
  for (let i = 0; i < 90; i++) {
    const res = await db.listColumns({ databaseId, tableId });
    const by = Object.fromEntries(res.columns.map((c) => [c.key, c.status]));
    if (keys.some((k) => by[k] === 'failed' || by[k] === 'stuck')) throw new Error('A column failed to build in ' + tableId);
    if (keys.every((k) => by[k] === 'available')) return;
    await sleep(2000);
  }
  throw new Error('Timed out waiting for columns in ' + tableId);
}

/* ---------- run ---------- */
console.log('Database');
await step('database "' + databaseId + '"', () => db.create({ databaseId, name: 'family' }));

for (const [tableId, def] of Object.entries(schema)) {
  console.log('\nTable ' + tableId);
  // permissions: [] means the browser has no table-level rights; rowSecurity lets row permissions decide reads.
  await step('table', () => db.createTable({ databaseId, tableId, name: tableId, permissions: [], rowSecurity: true }));
  for (const c of def.columns) {
    await step('column ' + c.key, () => {
      if (c.type === 'string') return db.createStringColumn({ databaseId, tableId, key: c.key, size: c.size, required: c.required, array: !!c.array });
      if (c.type === 'boolean') return db.createBooleanColumn({ databaseId, tableId, key: c.key, required: c.required });
      if (c.type === 'enum') return db.createEnumColumn({ databaseId, tableId, key: c.key, elements: c.elements, required: c.required });
      return db.createIntegerColumn({ databaseId, tableId, key: c.key, required: c.required, min: c.min, max: c.max });
    });
  }
  process.stdout.write('  waiting for columns to finish building');
  await waitForColumns(tableId, def.columns.map((c) => c.key));
  console.log(' ... ready');
  for (const [key, type, columns] of def.indexes) {
    await step('index ' + key, () => db.createIndex({ databaseId, tableId, key, type, columns, orders: columns.map(() => 'asc') }));
  }
}

console.log('\nStorage bucket');
await step('bucket "family-media"', () =>
  storage.createBucket({
    bucketId: 'family-media',
    name: 'family-media',
    permissions: [Permission.create(Role.label('family'))],
    fileSecurity: true,
    maximumFileSize: 26214400,
    allowedFileExtensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'm4v', 'webm'],
    encryption: true
  })
);

console.log('\nDone. Next: delete the temporary API key in the Appwrite Console, then create the Function (Setup Guide step 6).');

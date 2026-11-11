/*
 * Live check of chat privacy with direct requests to Appwrite (not through the app screens).
 * It finds one real direct-message conversation, then signs in as a DIFFERENT family member (not one of its two people) and tries,
 * the way someone with a normal account and a modified browser could, to read it, write into it, change channels, and use the
 * function with other people's ids. Every attempt must be refused or return nothing. It repeats the read checks signed out.
 *
 * Usage (CHAT-GUIDE.md, step 11):
 *   APPWRITE_ENDPOINT=... APPWRITE_PROJECT=... APPWRITE_KEY=<temporary key that can read rows> \
 *   OTHER_EMAIL=<a family member who is NOT in that conversation> OTHER_PASSWORD=<their password> node verify-chat-access.mjs
 * The key and password are only used on your own computer (or your own GitHub run) to talk to your own Appwrite project.
 */
import { Client, Account, TablesDB, Functions, Query } from 'node-appwrite';

const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT: project, APPWRITE_KEY: key, OTHER_EMAIL: email, OTHER_PASSWORD: password } = process.env;
if (!endpoint || !project || !key || !email || !password) { console.error('Set APPWRITE_ENDPOINT, APPWRITE_PROJECT, APPWRITE_KEY, OTHER_EMAIL and OTHER_PASSWORD. See the top of this file.'); process.exit(1); }
const databaseId = 'family';
let failures = 0, skipped = 0;
const report = (label, refused, detail) => { console.log((refused ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  (' + detail + ')' : '')); if (!refused) failures++; };
const skip = (label, why) => { console.log('SKIP  ' + label + '  (' + why + ')'); skipped++; };

// 1. an administrator (the temporary key) finds a real conversation to try to break into
const admin = new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
const dms = await admin.listRows({ databaseId, tableId: 'chatDms', queries: [Query.limit(50)] });
let dm = null, msg = null;
for (const d of dms.rows) { const m = await admin.listRows({ databaseId, tableId: 'chatMessages', queries: [Query.equal('convId', [d.$id]), Query.limit(1)] }); if (m.rows.length) { dm = d; msg = m.rows[0]; break; } }
if (!dm) { console.error('No direct message with at least one message exists yet. Send one between two accounts first, then run this again.'); process.exit(1); }
const channel = (await admin.listRows({ databaseId, tableId: 'chatChannels', queries: [Query.equal('familyId', [dm.familyId]), Query.equal('readOnly', [true]), Query.limit(1)] })).rows[0] || null;
const anyChannelMsg = (await admin.listRows({ databaseId, tableId: 'chatMessages', queries: [Query.equal('kind', ['channel']), Query.limit(1)] })).rows[0] || null;

async function readChecks(label, client) {
  const db = new TablesDB(client);
  const refusedOrEmpty = async (what, fn, isEmpty) => { try { const r = await fn(); report(label + ': ' + what, isEmpty(r), isEmpty(r) ? 'nothing returned' : 'GOT DATA'); } catch (e) { report(label + ': ' + what, true, 'refused with ' + (e.code || '?')); } };
  await refusedOrEmpty('open the DM conversation row', () => db.getRow({ databaseId, tableId: 'chatDms', rowId: dm.$id }), () => false);
  await refusedOrEmpty('list the DM conversations table', () => db.listRows({ databaseId, tableId: 'chatDms', queries: [Query.limit(100)] }), (r) => !r.rows.some((x) => x.$id === dm.$id));
  await refusedOrEmpty('list the messages of that DM', () => db.listRows({ databaseId, tableId: 'chatMessages', queries: [Query.equal('convId', [dm.$id]), Query.limit(100)] }), (r) => r.rows.length === 0);
  await refusedOrEmpty('open one DM message by its id', () => db.getRow({ databaseId, tableId: 'chatMessages', rowId: msg.$id }), () => false);
  await refusedOrEmpty('list the reactions in that DM', () => db.listRows({ databaseId, tableId: 'chatReactions', queries: [Query.equal('convId', [dm.$id]), Query.limit(100)] }), (r) => r.rows.length === 0);
  for (const t of ['chatReads', 'chatBlocks', 'chatMod']) await refusedOrEmpty('list ' + t + ' (private bookkeeping)', () => db.listRows({ databaseId, tableId: t, queries: [Query.limit(100)] }), (r) => r.rows.length === 0 || t === 'chatReads' && r.rows.every((x) => x.userId === sessionUser));
}
let sessionUser = '';
await readChecks('Signed out', new Client().setEndpoint(endpoint).setProject(project));

// 2. sign in as the other member
const client = new Client().setEndpoint(endpoint).setProject(project);
const account = new Account(client);
try { const s = await account.createEmailPasswordSession({ email, password }); client.setSession(s.secret); sessionUser = s.userId; }
catch (e) { console.error('Could not sign in as the other person: ' + e.message); process.exit(1); }
if (sessionUser === dm.userA || sessionUser === dm.userB) { console.error('That account is one of the two people in the conversation. Use a different family member.'); process.exit(1); }
await readChecks('Signed in as a non-participant', client);

// 3. writing straight to the database must never work for anyone
const db = new TablesDB(client);
const refuses = async (label, fn) => { try { await fn(); report(label, false, 'THE WRITE WENT THROUGH'); } catch (e) { report(label, true, 'refused with ' + (e.code || '?')); } };
await refuses('create a message directly in the database', () => db.createRow({ databaseId, tableId: 'chatMessages', rowId: 'unique()', data: { familyId: dm.familyId, convId: dm.$id, kind: 'dm', authorId: sessionUser, body: 'forged', clientId: 'forgedforged1', sendKey: 'forged_forged1' }, permissions: [] }));
if (anyChannelMsg) {
  await refuses('edit someone else\'s channel message directly', () => db.updateRow({ databaseId, tableId: 'chatMessages', rowId: anyChannelMsg.$id, data: { body: 'changed' } }));
  await refuses('delete someone else\'s channel message directly', () => db.deleteRow({ databaseId, tableId: 'chatMessages', rowId: anyChannelMsg.$id }));
}
if (channel) await refuses('turn off read-only on a channel directly', () => db.updateRow({ databaseId, tableId: 'chatChannels', rowId: channel.$id, data: { readOnly: false } }));
await refuses('create a channel directly', () => db.createRow({ databaseId, tableId: 'chatChannels', rowId: 'unique()', data: { familyId: dm.familyId, channelKey: dm.familyId + '_forged', name: 'forged', position: 99 }, permissions: [] }));
await refuses('edit the DM conversation row directly', () => db.updateRow({ databaseId, tableId: 'chatDms', rowId: dm.$id, data: { status: 'closed' } }));

// 4. the function: other people's ids must not work
const functions = new Functions(client);
async function call(body) {
  const jwt = (await account.createJWT()).jwt;
  const ex = await functions.createExecution({ functionId: 'family-api', body: JSON.stringify({ ...body, jwt }), async: false, xpath: '/', method: 'POST' });
  try { return { status: ex.responseStatusCode, json: JSON.parse(ex.responseBody) }; } catch { return { status: ex.responseStatusCode, json: {} }; }
}
const r1 = await call({ action: 'chatSend', familyId: dm.familyId, kind: 'dm', convId: dm.$id, body: 'forged', clientId: 'forgedforged2' });
report('send into the DM through the function', r1.status === 404 || r1.status === 403, 'answer ' + r1.status);
const r2 = await call({ action: 'chatDelete', familyId: dm.familyId, messageId: msg.$id });
report('delete a DM message through the function', r2.status === 404 || r2.status === 403, 'answer ' + r2.status);
const r3 = await call({ action: 'chatReact', familyId: dm.familyId, messageId: msg.$id, emoji: '👍' });
report('react to a DM message through the function', r3.status === 404 || r3.status === 403, 'answer ' + r3.status);
const mine = await call({ action: 'chatOpen', familyId: dm.familyId });
if (mine.status === 200) {
  report('my own chat overview does not list that DM (even if I am the family owner)', !(mine.json.dms || []).some((x) => x.id === dm.$id), (mine.json.dms || []).length + ' DMs listed for me');
  if (mine.json.role === 'member') { const r4 = await call({ action: 'chatChannelSave', familyId: dm.familyId, name: 'forged-channel' }); report('a plain member creating a channel through the function', r4.status === 403, 'answer ' + r4.status); }
  else skip('plain member creating a channel', 'this account is an owner or chat admin');
  const ro = (mine.json.channels || []).find((c) => c.readOnly && !c.archived);
  if (ro && mine.json.role === 'member') { const r5 = await call({ action: 'chatSend', familyId: dm.familyId, kind: 'channel', convId: ro.id, body: 'forged', clientId: 'forgedforged3' }); report('a plain member posting in a read-only channel', r5.status === 403, 'answer ' + r5.status); }
  else skip('posting in a read-only channel', 'no read-only channel, or this account is an owner or chat admin');
} else skip('function checks on my own overview', 'chatOpen answered ' + mine.status + ' (is this account in the same family as the DM?)');

console.log(failures ? '\n' + failures + ' check(s) FAILED. Do not use chat until this is fixed.' : '\nAll checks passed' + (skipped ? ' (' + skipped + ' skipped)' : '') + ': chat data cannot be read or changed outside the rules.');
process.exit(failures ? 1 : 0);

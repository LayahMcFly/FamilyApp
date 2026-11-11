/*
 * Live check that addresses cannot be read straight from Appwrite by a browser session, even with the row id.
 * It signs in as ANOTHER person (not the address owner) and tries to read the owner's address row directly, the way a
 * hacker with a normal account could. Every attempt must be refused. It also tries with nobody signed in.
 *
 * Usage (see ADDRESS-GUIDE.md, step 9):
 *   APPWRITE_ENDPOINT=... APPWRITE_PROJECT=... OWNER_ID=<the address owner's user id> \
 *   OTHER_EMAIL=<another member's email> OTHER_PASSWORD=<their password> node verify-address-privacy.mjs
 * The password is only used on your own computer, to sign in to your own Appwrite project.
 */
import { Client, Account, TablesDB } from 'node-appwrite';

const { APPWRITE_ENDPOINT: endpoint, APPWRITE_PROJECT: project, OWNER_ID: owner, OTHER_EMAIL: email, OTHER_PASSWORD: password } = process.env;
if (!endpoint || !project || !owner) { console.error('Set APPWRITE_ENDPOINT, APPWRITE_PROJECT and OWNER_ID. See the top of this file.'); process.exit(1); }

let failures = 0;
const report = (label, refused, detail) => { console.log((refused ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  (' + detail + ')' : '')); if (!refused) failures++; };

async function attempt(label, client) {
  const db = new TablesDB(client);
  try { const row = await db.getRow({ databaseId: 'family', tableId: 'addresses', rowId: owner }); report(label + ': read the row by its id', false, 'GOT DATA: the address is exposed'); void row; }
  catch (e) { report(label + ': read the row by its id', true, 'refused with ' + (e.code || '?')); }
  try {
    const list = await db.listRows({ databaseId: 'family', tableId: 'addresses' });
    report(label + ': list the addresses table', list.total === 0 && list.rows.length === 0, 'returned ' + list.rows.length + ' rows');
  } catch (e) { report(label + ': list the addresses table', true, 'refused with ' + (e.code || '?')); }
}

await attempt('Signed out', new Client().setEndpoint(endpoint).setProject(project));
if (email && password) {
  const client = new Client().setEndpoint(endpoint).setProject(project);
  const account = new Account(client);
  try { const s = await account.createEmailPasswordSession({ email, password }); client.setSession(s.secret); }
  catch (e) { console.error('Could not sign in as the other person: ' + e.message); process.exit(1); }
  await attempt('Signed in as another member', client);
} else console.log('SKIP  signed-in check (set OTHER_EMAIL and OTHER_PASSWORD to run it)');

console.log(failures ? '\n' + failures + ' check(s) FAILED. Do not use the address feature until this is fixed.' : '\nAll checks passed: the browser cannot read addresses directly.');
process.exit(failures ? 1 : 0);

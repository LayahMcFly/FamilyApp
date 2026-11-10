# Family tree guide (v1.20.0)

The Family Tree page now draws the tree with **family-chart 0.9.0** (free, MIT license, by Donat Soric) and **d3 7.9.0**. Your people, relationships, permissions and approval workflow stay where they were: in your Appwrite database and the `family-api` Function. The library only draws.

## What changed

| Area | Before | Now |
|---|---|---|
| Drawing the tree | Hand-written layout code in `app.js` | family-chart (`vendor/`), wrapped by `tree-chart.js` |
| Navigating | Pan, zoom, tap | Pan, zoom, tap to centre on anyone, "Jump to" menu, keyboard (Tab, then Enter) |
| Parents | Up to 2 | Up to 6, each marked birth, adoptive, step, foster or guardian |
| Partners | 1 | Up to 8 |
| Opening the tree | Bottom bar | Bottom bar, plus an "Open the Family Tree" button on the Family and members page, plus "View in family tree" on a person's profile |
| Version | 1.19.3 | 1.20.0 (a middle-number bump, because it is a big update) |

The workflow is unchanged: owners and tree admins edit, members suggest corrections, an invited relative confirms "this is me", a person record is never the same thing as a sign-in account, and a relationship never gives anyone admin rights.

## What the library cannot do (and what the app does about it)

I tested each of these against the real library files, so none of this is guessed.

| Limit | What happens | What the app does |
|---|---|---|
| More than 2 parents on one person | The library throws an error and draws nothing | The tree draws two parents at a time. A **Parents shown** menu (visible when your family has any adoptive, step, foster or guardian link) switches between "birth parents" and "the parents who raised them". Cards say "+2 parents not drawn". The side panel always lists every parent with its kind. |
| All parent lines look alike | The library has no line styles per relationship | The kind is written as a label ("Adoptive parent") in the side panel, not drawn as a different line. |
| It draws one person's neighbourhood | Aunts, cousins and in-laws' families are not drawn until you centre on someone else | A line under the tree says "Showing 8 of 14 people". Tap anyone, or use **Jump to**, to see the rest. People who are not connected to anyone are reachable through **Jump to**. |
| A parent who is also the person's partner, or a loop (someone is their own ancestor) | The library can fail on this | The server refuses to save it. If bad data already exists, the drawing skips that one link and counts it as "not drawn". |
| Card text is inserted as HTML | A name like `<img onerror=…>` could run code | Every name is escaped first. I tested this in Chrome: the name shows as plain text and nothing runs. |
| Partner status (current or former) | Not represented | Not stored. All partners are drawn the same way. |

## Costs, separately

The library is free, but it does not make your hosting unlimited.

1. **family-chart and d3:** $0. Both are bundled in `vendor/`, so there is no third-party service and no data leaves your site for them.
2. **Extra page weight:** about 400 KB for the three vendor files (uncompressed) the first time someone opens the tree. After that the browser keeps them. They load only when the tree opens, so other pages are not slower.
3. **GitHub Pages:** free, with published limits: a site of at most 1 GB, about 100 GB of traffic a month (a soft limit), and a rule that Pages is not meant to host an online business, a store or commercial software. The tree adds almost nothing to the first two. If your print and photo-gift shop goes live, check that rule before you sell from the same site. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
4. **Appwrite Cloud:** the free plan is $0, but it is capped. Appwrite's documentation says that when a limit is reached on the free plan, uploads, new accounts and invitations, or function runs stop until usage drops or the next billing period starts. I could not read the current numbers on Appwrite's pricing page, so check them in your Console under the organization's usage page before you invite many families. [Appwrite Free plan](https://appwrite.io/docs/advanced/platform/free)
5. **What the tree uses in Appwrite:** a person is one small database row, with no files. A tree page load reads the people and suggestions rows (the app reuses them for 20 seconds). Every save is one Function run plus a few row writes (partner links are mirrored on both people). The Function limits a family to 300 people.

## Part 1. Add the library and its dependencies

**Result:** `vendor/` and `tree-chart.js` exist in your repo, and the page loads them.

1. In the update zip, find the folder `vendor/` and the file `tree-chart.js`.
2. In your repo on GitHub, click **Add file > Upload files**. Drag the **contents** of the zip in (keep the folder structure, so `vendor/` stays a folder next to `index.html`). Replace the files GitHub asks about.
3. Check that the repo now has these files next to `index.html`:
   - `vendor/d3.min.js` (d3 7.9.0)
   - `vendor/family-chart.min.js` (family-chart 0.9.0)
   - `vendor/family-chart.css`
   - `vendor/LICENSE-family-chart.txt` and `vendor/LICENSE-d3.txt`
   - `tree-chart.js`
   - `THIRD-PARTY-NOTICES.md`
4. Open `index.html` on GitHub. Near the bottom, `tree-chart.js` should be listed before `app.js`.

Do not swap in `family-chart-premium`, a `@latest` CDN link or a trial copy. The files you uploaded are fixed copies of the free package, version 0.9.0. They are unmodified. To check, run `npm pack family-chart@0.9.0` on any computer and compare `dist/family-chart.min.js` with `vendor/family-chart.min.js`.

**Your CSP (the security rule in `index.html`) stays strict.** The library writes a few inline `style=""` attributes that this rule blocks. I moved the equivalent rules into `styles.css` and tested it in Chrome under your exact CSP. Chrome's console may show "Applying inline style violates…" warnings on the tree page. They are expected and harmless. If you ever see the tree drawn as a jumble of overlapping cards, check that the new `styles.css` was uploaded.

## Part 2. Create the exact Appwrite schema and indexes

**Result:** the `people` table has every column the tree uses, including the new `parentKinds`.

There is exactly one new column in this update.

**Option A, the Console (about 2 minutes):**

1. Open the Appwrite Console, then **Databases > family > people > Columns > Create column > String**.
2. Key: `parentKinds`. Size: `600`. Required: **off**. Array: **off**. Default: empty. Click **Create**.
3. Wait until its status says **Available**.

**Option B, the setup script:** run the script from `SETUP-SCRIPT.md` again. It skips everything that exists and adds `parentKinds`.

The full `people` table, for reference. Keys are case-sensitive.

| Column key | Type | Size | Required | Array | Written by |
|---|---|---|---|---|---|
| `familyId` | string | 36 | yes | no | `treeAddPerson` |
| `name` | string | 80 | yes | no | `treeAddPerson`, `treeEditPerson` |
| `userId` | string | 36 | no | no | link to a sign-in account (kept separate) |
| `confirmed` | boolean | | no | no | `treeConfirm`, `claimInvite` |
| `parentIds` | string | 36 | no | **yes** | `treeAddPerson`, `treeEditPerson` |
| `partnerIds` | string | 36 | no | **yes** | `treeAddPerson`, `treeEditPerson` |
| `createdBy` | string | 36 | no | no | `treeAddPerson` |
| `birthday` | string | 10 | no | no | `treeAddPerson`, `treeEditPerson` |
| `gender` | string | 20 | no | no | `treeAddPerson`, `treeEditPerson` |
| `inviteMembershipId` | string | 36 | no | no | invitations |
| `parentKinds` | string | 600 | no | no | **new in 1.20.0**: JSON such as `{"<parentId>":"adoptive"}`. "birth" is the default and is never stored. |

Indexes on `people`: one only, `idx_familyId` (type Key, column `familyId`, ascending). It already exists. Every query the tree runs filters on `familyId`, so no new index is needed. The `suggestions` table is unchanged.

Until the column exists, the tree still works, and plain birth-parent links save as before. If you try to save an adoptive, step, foster or guardian link before the column exists, the app shows an error telling you to add it. It never saves the person with the wrong relationship in silence.

## Part 3. Configure permissions

**Result:** the Function is updated with the new checks, and the table permissions are as strict as before.

**Table permissions (check, do not change):**

1. Databases > family > people > **Settings > Permissions**: the permission list is **empty**.
2. Same page: **Row security** is **ON**.

That combination is the privacy design. The browser has no write rights at all. Each person row is created by the Function with exactly one read permission, the Appwrite Team of that family. Another family's members are not on that list, so Appwrite never returns the row to them.

**Update the Function (this is where the editing rules live):**

1. On a computer with the repo downloaded, open a terminal in the `function` folder and run:
   `tar --exclude node_modules --exclude test --exclude code.tar.gz -czf code.tar.gz .`
   (The update zip already contains a ready-made `family-api-1.20.0.tar.gz`. You can use that instead.)
2. In the Console, open **Functions > family-api > Deployments > Create deployment > Manual**. Upload the file. Entrypoint `src/main.js`, build command `npm install`.
3. When the build finishes, **activate** the deployment.
4. No new API-key scopes are needed.

**Who can do what** (the Function checks all of this on the server, not in the browser):

| Person | See the tree | Add, edit, delete people and links | Suggest a correction | Confirm "this is me" |
|---|---|---|---|---|
| Owner of that family | yes | yes | yes | only for their own linked entry |
| Tree admin of that family | yes | yes | yes | only for their own linked entry |
| Other member of that family | yes | no (can edit only their own linked entry) | yes | only for their own linked entry |
| Member of a different family | no | no | no | no |
| Not signed in | no | no | no | no |

Every request names a `familyId`. The Function confirms you are a confirmed member of that family's Team before it reads or writes anything, and it refuses any parent, partner or person ID that belongs to a different family. Nothing in the code has a hardcoded family ID.

## Part 4. Deploy to your site

**Result:** the live site shows version 1.20.0 and the new tree.

You said "my existing zenfuloutput website". I read that as: the tree belongs to the Family Circle site (the `FamilyCircle` repo), and the zenfuloutput hub only links to it. So nothing in the zenfuloutput repo needs to change except, if you want, the link on its Family App card (below). If you meant that the tree itself should live inside the hub repo, tell me and I will adapt it.

1. Upload the update zip contents to your `FamilyCircle` repo, as in Part 1. Replace `app.js`, `styles.css`, `index.html` and `config.js`. Replace `function/src/logic.js`, `function/test/logic.test.js` and `setup/setup-appwrite.mjs`. Add the new files. Commit.
2. Open **Settings > Pages** in the repo and wait for the green "published" message (usually under two minutes).
3. Open the site and hard refresh (Ctrl+Shift+R on a computer; on a phone, close the tab and open it again).
4. Scroll to the footer. It should say **V1.20.0**.
5. Do Part 2 (the column) and Part 3 (the Function) if you have not already.
6. Appwrite needs no change. The Web platform hostname stays `layahmcfly.github.io`.
7. Check the Family App card on the zenfuloutput hub. The repo's name on GitHub is `FamilyCircle`, so the site address is `https://layahmcfly.github.io/FamilyCircle/`. If the card still points at the old `FamilyApp` address, change it. In `config.js` I also fixed the feedback link, which was spelled `FamilyCirle` and would not open.

## Part 5. Test with two separate families

**Result:** you have seen, with your own accounts, that one family cannot reach another family's tree.

You need three accounts you can sign in to (email aliases work): **Account 1** (owner of Family A), **Account 2** (owner of Family B), **Account 3** (an ordinary member of Family A).

I ran the same rules through 26 automated tests against a fake Appwrite, including two families. I did not run anything against your live project, so this part is how you confirm it for real.

1. Sign in as Account 1. Open **Family Tree** and add three people to Family A with unusual names: `Alpha Only`, `Beta Only`, `Gamma Only`. Link them as parent, child and partner.
2. In Family A, add one more person with two parents plus an **adoptive** parent (Edit person > Parents > + Add a parent > pick "Adoptive parent"). Open the tree. The **Parents shown** menu appears. Switch it and check the cards change.
3. Sign out. Sign in as Account 2. Create Family B (the "create another family" option). Open **Family Tree**. **Expected:** the tree is empty. None of the Family A names appear, not on the tree, not in **Jump to**, not in Suggestions.
4. As Account 2, add `Delta Only` to Family B. Sign out.
5. Sign in as Account 3 (Family A member). **Expected:** you see Alpha, Beta, Gamma, not Delta. There is no **+ Add a person** button, and **Edit** appears only on their own linked entry (if they have one). Everyone else's side panel offers **Suggest a change** only. Send one suggestion.
6. Sign back in as Account 1. **Expected:** the suggestion appears in Settings > Family tree for you to approve or dismiss.
7. **Switch families.** If Account 2 is also in Family A (invite it), use the family menu at the top. **Expected:** the tree changes completely with the family, and it never shows a mix.
8. **Try to break it (browser console).** Signed in as Account 2, open your site, press F12, choose **Console**, paste this with `FAMILY_A_ID` replaced by Family A's Team ID (Appwrite Console > Auth > Teams), then press Enter:

```js
(async () => {
  const c = new Appwrite.Client().setEndpoint(FAMILY_CONFIG.endpoint).setProject(FAMILY_CONFIG.projectId);
  const jwt = (await new Appwrite.Account(c).createJWT()).jwt;
  const fn = new Appwrite.Functions(c);
  const call = async (b) => (await fn.createExecution({ functionId: FAMILY_CONFIG.functionId, body: JSON.stringify({ jwt, ...b }), async: false, xpath: '/', method: 'POST' })).responseBody;
  console.log('write attempt:', await call({ action: 'treeAddPerson', familyId: 'FAMILY_A_ID', name: 'Intruder' }));
  const r = await new Appwrite.TablesDB(c).listRows({ databaseId: 'family', tableId: 'people', queries: [Appwrite.Query.equal('familyId', ['FAMILY_A_ID'])] });
  console.log('rows from Family A that I can read:', r.total);
})();
```

   **Expected:** the write attempt answers with a "not a member of this family" message (HTTP 403 in the JSON), and the row count is **0**. If it is anything else, stop using the site for real data and tell me what you saw.
9. Delete the test people when you finish (Edit > Delete from tree).

If steps 3, 5 and 8 all behave as described, two families are isolated.

## Files in the update

| File | What changed |
|---|---|
| `tree-chart.js` | New. Turns your people into the library's format, draws them, escapes all text. |
| `vendor/` | New. family-chart 0.9.0, d3 7.9.0, their licenses. |
| `app.js` | New tree page, "Open the Family Tree" button, person form with several parents (with kinds) and partners. |
| `styles.css` | Chart styling, including the CSP-safe rules. |
| `index.html` | Loads `tree-chart.js`; version 1.20.0. |
| `config.js` | Version 1.20.0; feedback link fixed. |
| `function/src/logic.js` | `parentKinds`, up to 6 parents and 8 partners, "a parent cannot also be a partner". |
| `function/test/logic.test.js` | Tests for all of the above, including two families. |
| `setup/setup-appwrite.mjs` | Adds the `parentKinds` column for new installs. |
| `THIRD-PARTY-NOTICES.md` | Required license notices. |

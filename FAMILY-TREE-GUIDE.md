# Family Tree guide (version 1.20.0)

**Bottom line.** The Family Tree page is now drawn by the free, open-source `family-chart` library (version 0.9.0, MIT license). The library only draws. Your people and their relationships stay in your own Appwrite `people` table, one family at a time, and nothing is sent to an outside genealogy service. To switch it on you do three things: add one column to the `people` table, upload the new function package, and push the new site files to GitHub.

Which package this is: the free `family-chart` package from npm (github.com/donatso/family-chart). It is not `family-chart-premium`, which has its own license and is not used anywhere in this project.

---

## What the library can and cannot draw

I tested family-chart 0.9.0 in a real browser with awkward family shapes. Results:

| Relationship | What happens | What the app does about it |
|---|---|---|
| Several partners (a divorce, a remarriage) | Drawn correctly. Each partner sits beside the person, each with their own children. | Adds a small label on the line: "Married", "Divorced" or "Separated". |
| Same-sex parents | Drawn correctly as a couple with their child. | Nothing needed. |
| Gender other than female or male | The library only knows M and F. Anything else is drawn as a neutral card without an error. | Nonbinary, Other and "Not set" all get a neutral purple card. The saved value is kept as you typed it. |
| Adoptive, step, foster and guardian parents | **Not supported.** Every parent line looks the same. | The app stores the kind of link itself and writes it on the child's card ("Adopted", "Step-child", "Foster child"). The lines stay identical. |
| A child with three or more parents | **Not supported.** The library throws an error ("child has more than 1 parent") and draws nothing. | The app gives the library the two parents that are most likely "the" parents (a couple first, then birth parents), draws those, and tells you about the rest. The extra links stay saved. Details are below. |
| A person's partner when you view their child | The library draws only the child's two listed parents. If Jonah's adoptive dad has a wife who is not Jonah's parent, she does not appear above Jonah. | She appears as soon as you tap the adoptive dad. The page explains this in its "What this picture can and cannot show" note. |
| People not connected to anyone | They have no line to follow, so you cannot reach them by tapping. | The "Jump to a person" menu lists everyone. |
| Everyone at once | The library shows the family of one chosen person (parents, partners, children, siblings), not all 300 people together. | Tap a card to move. "Simple view" is a second page that lists every person. |

How the "silent drop" is prevented. For a child with four parents, the page shows a notice under the tree: "Noor has 4 parents. The tree can draw two, so Birth mum Lena and Step-dad Karl are not drawn above Noor." The child's card also shows "+2 more parents". The tap-through details panel lists all four parents. There is an automated test (`function/test/adapter.test.js`) that checks every parent link is either drawn or reported.

---

## Step 1. Add the library and its dependencies

You do not install anything. The files are already in the project, inside the `vendor` folder:

| File | What it is | License |
|---|---|---|
| `vendor/family-chart.min.js` | The tree-drawing library, version 0.9.0 | MIT, Copyright (c) 2021 Donat Soric |
| `vendor/family-chart.css` | The library's base styles | MIT |
| `vendor/d3.min.js` | D3 version 7.9.0, the drawing toolkit that family-chart needs | ISC, Copyright 2010-2023 Mike Bostock |
| `vendor/LICENSE-family-chart.txt`, `vendor/LICENSE-d3.txt` | The license texts | |
| `THIRD-PARTY-NOTICES.txt` | Both licenses in one place. Keep this file with the site. | |

Our own files that connect the library to your data:

| File | What it does |
|---|---|
| `tree-adapter.js` | Turns your `people` rows into the format the library wants, and lists anything it cannot draw |
| `tree-chart.css` | Colors the tree to match your theme and repairs two things the library does with inline styles |
| `app.js` | The new Family Tree page and the new "Edit person" form |

Why the files are copied into the site and not loaded from a public CDN: your site's security rules only allow scripts from your own site (and the Appwrite SDK). Self-hosting also means the tree keeps working even if a CDN is down. The library loads only when someone opens the Family Tree page, so the home feed does not get slower.

**A license detail worth knowing.** The package's `LICENSE.txt` and README say MIT. The `license` field inside its `package.json` says ISC. They disagree. Both are permissive and ask for the same thing (keep the copyright notice and license text with the code), so either way your use is fine. `THIRD-PARTY-NOTICES.txt` explains this and follows the actual license file.

**Security-policy note.** The library writes some `style="..."` attributes into its HTML, and your site blocks those on purpose. `tree-chart.css` re-creates those few rules as normal CSS, so the tree looks right. If you open your browser's developer console on the Family Tree page you will see one or two grey "violates Content Security Policy" lines. They are expected and harmless. Do not loosen the policy to silence them.

**Updating the library later.** Download a newer `family-chart` from npm, copy `dist/family-chart.min.js` and `dist/styles/family-chart.css` over the two files in `vendor`, check the license again, and open the Family Tree page. Ask me to re-run the relationship tests first.

---

## Step 2. Create the exact Appwrite schema and indexes

Everything is in one database called `family`. The tree uses two tables.

### Table `people`

Table settings: **Row security ON**, no table-level permissions at all.

| Column | Type | Size | Required | Array | Used for |
|---|---|---|---|---|---|
| `familyId` | String | 36 | yes | no | Which family this person belongs to. The Appwrite team ID. |
| `name` | String | 80 | yes | no | Display name |
| `userId` | String | 36 | no | no | The sign-in account linked to this person. Empty when nobody is linked. |
| `confirmed` | Boolean | | no | no | The linked person said "yes, this is me" |
| `parentIds` | String | 36 | no | **yes** | IDs of parent rows |
| `partnerIds` | String | 36 | no | **yes** | IDs of partner rows |
| `createdBy` | String | 36 | no | no | Who added this entry |
| `birthday` | String | 10 | no | no | `2015-06-30` or just `2015` |
| `gender` | String | 20 | no | no | Free text such as Female, Male, Nonbinary, Other |
| `inviteMembershipId` | String | 36 | no | no | Ties an invited relative to their invitation so the entry becomes theirs on accept |
| **`relKinds`** | String | **2000** | no | no | **New in 1.20.0.** Kinds of links, for example `{"p:abc123":"adoptive","s:def456":"divorced"}` |

Index: `idx_familyId`, type Key, on `familyId`, ascending.

Person records and sign-in accounts stay separate. A person row can exist with `userId` empty (a grandparent who will never sign up). Linking is a separate step that a tree admin starts and the linked person confirms.

### Table `suggestions`

Row security ON, no table-level permissions.

| Column | Type | Size | Required |
|---|---|---|---|
| `familyId` | String | 36 | yes |
| `authorId` | String | 36 | yes |
| `personId` | String | 36 | no |
| `text` | String | 500 | yes |
| `status` | String | 12 | yes |

Indexes (all type Key): `idx_familyId` on `familyId`, `idx_authorId` on `authorId`, `idx_status` on `status`.

### Add only the new column (if your tables already exist)

You already created every column above except `relKinds`. Open the Appwrite Console, open the **Terminal** you used before, and paste this one line:

```
appwrite tablesdb create-string-column --database-id family --table-id people --key relKinds --size 2000 --required false
```

Open Databases, then `family`, then `people`, then Columns. Wait until `relKinds` shows **Available**. No new index is needed.

If you skip this step the tree still draws and nothing breaks, but adoptive, step, foster and married/divorced labels are not saved. The server tries to save them, gets an error because the column is missing, and saves everything else.

### Starting from nothing

`setup/setup-appwrite.mjs` creates all tables, columns and indexes in one go, including `relKinds`. `SETUP-GUIDE.md` explains how to run it.

---

## Step 3. Configure permissions

There are four layers. None of them depend on the browser behaving.

1. **Table level.** In Console, open `people`, then Settings, then Permissions. The list must be empty. Row security must be ON. With no table permission, nobody can read a row unless the row itself says so.
2. **Row level.** Every person row is created by the `family-api` function with exactly one permission: `read("team:<that family's team ID>")`. Only members of that family's team can read it. Nobody, including members, gets a write permission on the row.
3. **Writes go through the function.** The browser never writes to `people`. The function checks each request:
   - Is the caller a confirmed member of this family's team? If not: refused.
   - Adding, deleting and linking people: only the family owner, or a member the owner made a tree admin.
   - Editing someone's links: owner or tree admin.
   - A person linked to your account who has confirmed: only they can change their own name, gender and birthday. The inviter cannot, even if they are the owner.
   - Ordinary members can send a suggestion. A tree admin accepts or dismisses it.
4. **The family is never taken from the browser's word.** The family ID in each request is checked against the caller's real team membership. Nothing in the code has a family ID written into it. The Family Tree page asks Appwrite only for rows where `familyId` equals the family you are currently viewing.

To confirm layers 1 and 2 yourself: Console, `people`, open any row, look at **Permissions**. You should see only `Read: team:<id>`.

The function's own permissions did not change in this update.

---

## Step 4. Deploy to your website

Your family app lives in its own GitHub repository (`LayahMcFly/familycircle`) and is published with GitHub Pages. Your ZenfulOutput site links to it. This update is files only, no build step.

1. **Upload the new function package first.** In Appwrite Console, open Functions, then `family-api`, then Deployments, then Create deployment. Choose Upload, and select `family-api.tar.gz` (sent with this guide). The entrypoint and install command are already set from last time. Wait for the status **Ready**, then use **Activate** if it is not already active.
2. **Add the new column** (Step 2) if you have not yet.
3. **Update the site files on GitHub.** The easy way: open `github.com/LayahMcFly/familycircle`, click **Add file**, then **Upload files**, and drag these in (keep the folder structure; GitHub keeps folders when you drag the `vendor` folder itself):
   - `index.html`, `config.js`, `app.js`, `styles.css`
   - `tree-adapter.js`, `tree-chart.css`
   - the whole `vendor` folder (5 files)
   - `THIRD-PARTY-NOTICES.txt`, `FAMILY-TREE-GUIDE.md`, `SETUP-GUIDE.md`
   - `setup/setup-appwrite.mjs`
   - `function/` (source and tests, optional but keeps the repo complete)

   Write a note such as "v1.20.0 family tree" and click **Commit changes**.
4. **Wait about a minute.** GitHub Pages republishes by itself. Open the site and look at the footer. It should say **Family Circle v1.20.0**. If it still says 1.19.3, hold Ctrl+Shift+R (Cmd+Shift+R on a Mac) to reload without the saved copy.
5. **Check the ZenfulOutput link.** Nothing needs to change there if it already links to the family app's address.

If you would rather host the app inside the ZenfulOutput repository (for example at `zenfuloutput.com/family/`), copy the whole folder into a `family` folder in that repo. All links in the app are relative, so it works from a subfolder. One extra step: in Appwrite Console, open your project, then Overview, then Platforms, then Add platform, then Web, and add the new hostname. Appwrite refuses requests from a hostname it does not know.

Version rule you set: this is a middle-number change (1.19.3 to 1.20.0) because it is a big update. The footer and the `?v=` cache numbers in `index.html` were bumped together.

---

## Step 5. Test with two separate families to confirm privacy

You need two sign-in accounts in two different families. Use two browsers (for example Chrome and a private window), so the two sessions never mix.

**Setup**
1. In browser 1, sign in as yourself. You own **Family A**. Add three people to its tree: "Test Alpha Parent", "Test Alpha Child" (parent: Alpha Parent) and "Test Alpha Adopted" (parent: Alpha Parent, kind: Adoptive).
2. In browser 2, sign in with a second email. Create **Family B** (Create another family). You own it. Add two people: "Test Beta One" and "Test Beta Two".

**Checks. Each one has an expected result.**

| # | Do this | Expected |
|---|---|---|
| 1 | Browser 2, Family B, open Family Tree, then open the "Jump to a person" menu | Only "Test Beta" names. No "Test Alpha" names anywhere. |
| 2 | Browser 1, Family A, same menu | Only "Test Alpha" names. |
| 3 | Browser 2: type `#/tree/<an Alpha person ID>` in the address bar (copy an ID from browser 1's address bar after tapping a person on its profile's "View in family tree") | The page shows Family B's own tree. It does not show the Alpha person. |
| 4 | Browser 2: Settings, Family tree. Search the list | No Alpha people. |
| 5 | Browser 1: add a **member** (not owner) to Family A, sign them in, and try Add a person | The Add button is missing, or the server answers "Only the family owner or a tree admin can change the family tree." Suggestions work. |
| 6 | In Appwrite Console, open `people`, open an Alpha row and a Beta row | Alpha shows `Read: team:<A's ID>`. Beta shows `Read: team:<B's ID>`. Nothing else. |
| 7 | Browser 2: open the browser's developer tools, Network tab, open the Family Tree page, and look at where requests go | Only your Appwrite endpoint and your own site. No request to any genealogy or tracking site. |
| 8 | Adoptive check, browser 1: open the Family Tree and tap "Test Alpha Parent" | Both children are drawn below. "Test Alpha Adopted" has an "Adopted" label on its card. "Test Alpha Child" has none. |

If any row fails, stop and tell me which one. Do not add real family data until all eight pass.

**Automated version.** The repository includes tests that do the same thing with two fake families. On a computer with Node installed: open a terminal in the `function` folder and run `npm install`, then `npm test`. The line `tree privacy: two families never see or touch each other's people` must say `ok`. All 34 tests pass in this release.

---

## Costs, separately

**The library is free, the hosting is not unlimited.** family-chart and D3 cost nothing and ask for no payment, ads or account. They run inside your visitors' browsers. Everything that does cost something, or could, is on the Appwrite and GitHub side.

- **Appwrite Cloud, Free plan.** From Appwrite's own documentation: a free account has one organization and two projects. When a limit is reached, the effect is automatic and not a bill. File uploads stop when storage is full. Function runs stop when the monthly allowance is used. API access is denied when bandwidth runs out (on the Free plan, until the next period or an upgrade). Limits reset at the start of each billing period. You cannot buy extra on the Free plan.
- **The numbers.** Appwrite's documentation pages I could read point to its pricing page for the figures, and that page did not show them to me. A third-party summary of the Free plan (toolradar.com) reports 2 GB storage, 5 GB bandwidth, 750,000 function executions, 75,000 monthly active users, one database, one bucket and two functions per project, and says free projects pause after one week of inactivity. Treat those as unconfirmed until you check Console, then Billing, or Appwrite's pricing page, because plans change.
- **What the tree uses.** A person row is a few hundred bytes. A family of 300 people is far less than 1 MB of database space, so the tree itself barely touches any limit. Photos and videos use the storage allowance. Opening the tree page counts a handful of database reads.
- **Pausing.** If the Free plan really pauses projects after a week without activity, your family would see errors the first time they open the site after a quiet week, until you wake the project in Console. Check this in your Console once. If it applies, an occasional login by any family member keeps it awake.
- **GitHub Pages.** Free for public repositories. GitHub documents soft limits of about 1 GB for the published site and 100 GB of bandwidth a month, which a family site will not approach. Your repository is public, so do not put secrets in it. `config.js` holds only your project ID and endpoint, which are meant to be public.
- **Paid plans.** If you outgrow the Free plan, the Appwrite paid plan is billed monthly by Appwrite. The app has its own limits too: 500 MB of uploads per family by default (change it with the `familyStorageMB` function variable) and 300 people per tree (`maxPeople` in `function/src/logic.js`). Keep them below what your Appwrite plan allows.

Sources: [Appwrite Free plan documentation](https://appwrite.io/docs/advanced/billing/free.md), [Appwrite pricing](https://appwrite.io/pricing), [toolradar summary of Appwrite pricing](https://toolradar.com/tools/appwrite-2-0/pricing), [family-chart on GitHub](https://github.com/donatso/family-chart).

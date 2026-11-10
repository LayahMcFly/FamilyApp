# Family Circle (multi-family): what changed and how to set it up

Any family can now sign up on your site and get its own private space. You set Appwrite up once. Families never touch JavaScript, Team IDs or the Appwrite dashboard.

Verified in November 2026 against the Appwrite docs and the installed SDKs: Web SDK 29.2.0, `node-appwrite` 31.1.0, Teams, labels, function headers, API-key scopes, execution API. The Function's logic passes 16 automated tests against an in-memory fake of Appwrite, and the web app passes a 27-check browser-simulation test. Neither ran against your live project, so Part 8 lists the few behaviors to confirm with a real two-account test (Part 9).

---

## Part 1. What had to change from the single-family version

**Bottom line:** the old app trusted one hardcoded Team ID and let the browser write rows. That design cannot isolate many families, so the writes moved into one small Appwrite Function, and every other piece now takes its family from the signed-in user's memberships.

| Single-family version | Multi-family version | Why it had to change |
|---|---|---|
| `teamId` in `config.js` | Removed. The app asks the server which families you belong to | Families are created at runtime |
| "Create the family team" bootstrap screen, run by you | Onboarding screen: create a family, or accept an invitation | Any visitor can start a family |
| Table permissions named `team:<your id>` in the dashboard | No table-level permissions at all. Each row carries `read(team:<its family>)` | The dashboard cannot name Teams that do not exist yet |
| Browser created posts, comments and likes directly | Browser calls the `family-api` Function for every write | A browser can only grant permissions for roles it holds. It cannot stamp `team:<family>` safely, check that a comment belongs to the same family as its post, or let an owner delete other people's rows |
| One profile per person (row ID = user ID) | One profile per person per family (`profileKey = familyId_userId`) | A person can use a different name in each family |
| Orphan-cleanup button for the admin | The Function deletes comments, likes, saves and files together with the post | The Function has the rights the browser lacks |
| One owner, set by you | Each family has its own owner(s). Owners can promote others | Families run themselves |

Two things stay in the browser because Appwrite supports them there: creating a Team (the creator becomes owner) and inviting, removing or promoting members (owners only). The Function never invents a membership. It reads real memberships from Appwrite.

### Why a Function is needed (and why only one)

The Function exists for four jobs the browser cannot do safely:

1. **Stamp the right permissions.** A row for family A must be readable by `team:A` and nobody else. The Function writes that permission after it has checked, server-side, that you belong to A.
2. **Check parents.** A comment can only be attached to a post in the same family. A reaction or save works the same way.
3. **Delete across tables.** Owners remove other people's posts, and deleting a post removes its comments, likes, saves and media. Deleting a family removes everything.
4. **Hold the API key.** Appwrite hands the Function a short-lived key for each run, limited to the scopes you tick. The key never reaches the browser or GitHub.

The Function takes identity from the caller's own login token and has Appwrite verify it. It ignores any user ID or "I am an owner" claim in the request body. Every action starts by listing your real, confirmed memberships.

### How isolation works

Reading is enforced by Appwrite itself. Each post, comment, reaction and profile carries one read permission, `team:<familyId>`. Appwrite refuses a read from anyone outside that Team no matter what the page asks for. A `familyId` filter in a query is only a convenience for the app. Files work the same way: after upload the Function rewrites each file's permissions to exactly `read(team:<familyId>)`. Bookmarks carry `read(user:<you>)`, so only you can list your saves.

Writing is enforced by the Function. Table-level permissions are empty, so Appwrite rejects any direct write from a browser, including one typed into someone's own developer console.

---

## Part 2. What you do once, and what families do themselves

| Who | When | Action |
|---|---|---|
| **You (developer)** | Once | Steps 1 to 10 in Part 3: project, platform, auth, database, bucket, Function, GitHub upload |
| **You** | Rarely | Redeploy the Function if you change its code. Watch the Free plan limits |
| **Visitor** | On the site | Creates an account and verifies the email from the message Appwrite sends |
| **New family owner** | On the site | Presses **Create family** and types a name. The Team and the family record are created automatically and they become owner |
| **Owner** | On the site, Family page | Invites relatives by email, promotes a second owner, removes people, cancels invitations, deletes the family |
| **Invited relative** | On the site | Signs up with the invited email, verifies it, opens the invitation link, picks a display name |
| **Any member** | On the site | Switches family from the top bar, leaves a family, creates a second family (up to 3 owned) |

You never create a family, copy a Team ID, edit permissions per family, or deploy anything when a new family signs up.

---

## Part 3. One-time developer setup

### 1. Project, endpoint and platform

**Result:** a project the site can talk to. You already have this (project ID `6aef6a03002636be44c2`, endpoint `https://nyc.cloud.appwrite.io/v1`, Web platform with hostname `layahmcfly.github.io`). Skip to step 2 if sign-up and verification emails already work. If you ever redo it, the Web platform hostname is the host only, with no path.

### 2. Check authentication settings

**Result:** strangers can create accounts and every account must verify its email.

1. **Auth > Settings:** leave **Email/Password** on and sign-ups open. Leave Teams usable by signed-in users (the default). Families are created by users from the browser, so if you ever disable user-created Teams, creating a family fails with a 401.
2. Set a password minimum of 8, and turn on the password dictionary and personal-data checks if offered.
3. Verification, recovery and invitation emails use Appwrite's default sender and can land in spam, so tell new users to check there. Custom SMTP is an optional upgrade.

### 3. Delete your two test Teams

**Result:** a clean Auth > Teams list.

Delete the Teams with IDs `6aef6ff70025f75bc4ec` and `6aef70c8002b376dccce` (Auth > Teams). They are not registered as families, so the app ignores them. No database rows exist yet, so nothing else needs migrating.

### 4. Database, tables, columns, indexes

**Result:** the schema the Function and the app read and write.

**Shortcut:** `SETUP-SCRIPT.md` builds steps 4 and 5 for you with one script. Use it, then skip to step 6.

1. **Databases > Create database.** Database ID `family`.
2. Create six tables with these Table IDs: `families`, `profiles`, `posts`, `comments`, `reactions`, `bookmarks`.
3. In each table's **Settings > Permissions**, leave the table permission list **empty** and turn **Row security ON**. Empty table permissions mean the browser cannot create, update or delete any row. Row security lets Appwrite use each row's own permission list for reads.
4. Add the columns below. "Req" means required. Leave defaults empty. Column keys are case-sensitive.

**Columns (they match the code exactly):**

| Table | Column key | Type | Size / range | Req | Written by |
|---|---|---|---|---|---|
| `families` | `ownerId` | string | 36 | yes | `registerFamily` |
| `families` | `name` | string | 60 | yes | `registerFamily` |
| `profiles` | `familyId` | string | 36 | yes | `saveProfile` |
| `profiles` | `userId` | string | 36 | yes | `saveProfile` |
| `profiles` | `profileKey` | string | 80 | yes | `saveProfile` (`familyId_userId`) |
| `profiles` | `displayName` | string | 60 | yes | `saveProfile` |
| `profiles` | `avatarFileId` | string | 36 | no | `saveProfile` |
| `posts` | `familyId` | string | 36 | yes | `createPost` |
| `posts` | `authorId` | string | 36 | yes | `createPost` |
| `posts` | `kind` | enum | `text`, `photo`, `video`, `short` | yes | `createPost` |
| `posts` | `body` | string | 2000 | no | `createPost`, `editPost` |
| `posts` | `mediaFileId` | string | 36 | no | `createPost` |
| `posts` | `mediaMime` | string | 32 | no | `createPost` |
| `posts` | `mediaSize` | integer | min 0, max 52428800 | no | `createPost` |
| `comments` | `familyId` | string | 36 | yes | `createComment` |
| `comments` | `postId` | string | 36 | yes | `createComment` |
| `comments` | `authorId` | string | 36 | yes | `createComment` |
| `comments` | `body` | string | 500 | yes | `createComment` |
| `reactions` | `familyId` | string | 36 | yes | `toggleReaction` |
| `reactions` | `postId` | string | 36 | yes | `toggleReaction` |
| `reactions` | `userId` | string | 36 | yes | `toggleReaction` |
| `reactions` | `reactionKey` | string | 80 | yes | `toggleReaction` (`postId_userId`) |
| `bookmarks` | `familyId` | string | 36 | yes | `toggleBookmark` |
| `bookmarks` | `userId` | string | 36 | yes | `toggleBookmark` |
| `bookmarks` | `postId` | string | 36 | yes | `toggleBookmark` |
| `bookmarks` | `bookmarkKey` | string | 80 | yes | `toggleBookmark` (`userId_postId`) |

Notes:

- `families` rows use the Team ID as the row ID. A row exists only if the Function registered that Team, which is how the app tells real families from stray Teams.
- Appwrite adds `$id`, `$createdAt`, `$updatedAt` and `$permissions` to every row.
- Example `posts` row: `{ familyId: "66f1…", authorId: "66f0…", kind: "photo", body: "Grandma's garden", mediaFileId: "66f2…", mediaMime: "image/jpeg", mediaSize: 312450 }`.

5. Create these indexes (Table > Indexes). Every query the code runs needs one. Use ascending order. "Key" is the normal type.

| Table | Index key | Type | Column(s) | Used for |
|---|---|---|---|---|
| `families` | `idx_ownerId` | Key | `ownerId` | Counting how many families a person owns |
| `profiles` | `idx_familyId` | Key | `familyId` | Loading a family's profiles, deleting a family |
| `profiles` | `uniq_profileKey` | Unique | `profileKey` | One profile per person per family |
| `profiles` | `idx_avatarFileId` | Key | `avatarFileId` | Cleanup of unused uploads |
| `posts` | `idx_familyId` | Key | `familyId` | Home feed, deleting a family |
| `posts` | `idx_family_kind` | Key | `familyId`, `kind` (two columns, in this order) | Shorts feed |
| `posts` | `idx_mediaFileId` | Key | `mediaFileId` | Cleanup of unused uploads |
| `comments` | `idx_postId` | Key | `postId` | Loading comments, counts, cascade delete |
| `comments` | `idx_familyId` | Key | `familyId` | Deleting a family |
| `reactions` | `idx_postId` | Key | `postId` | Like counts, cascade delete |
| `reactions` | `idx_familyId` | Key | `familyId` | Deleting a family |
| `reactions` | `uniq_reactionKey` | Unique | `reactionKey` | One like per person per post |
| `bookmarks` | `idx_user_family` | Key | `userId`, `familyId` (two columns, in this order) | My saved posts in one family |
| `bookmarks` | `idx_postId` | Key | `postId` | Cascade delete |
| `bookmarks` | `idx_familyId` | Key | `familyId` | Deleting a family |
| `bookmarks` | `uniq_bookmarkKey` | Unique | `bookmarkKey` | One save per person per post |

If a screen reports a missing index, the message names the column. Add a Key index on it.

**Row permissions the Function attaches (nothing for you to set):**

| Table | Row read | Row update / delete |
|---|---|---|
| `families`, `profiles`, `posts`, `comments`, `reactions` | `team:<familyId>` | none (Function only) |
| `bookmarks` | `user:<owner of the save>` | none (Function only) |

### 5. Storage bucket

**Result:** private media storage that only the right family can read.

1. **Storage > Create bucket.** Bucket ID `family-media`.
2. **Settings > Permissions:** add one permission, **Create** for the **Label** role `family`. Add no Read, Update or Delete permission here.
3. Turn **File security ON**. Files then use their own permissions, which the Function sets to `read(team:<familyId>)`.
4. **Maximum file size:** 26214400 bytes (25 MB).
5. **Allowed file extensions:** `jpg`, `jpeg`, `png`, `webp`, `mp4`, `mov`, `m4v`, `webm`.
6. Leave encryption on if it is offered. Do not enable a public or "any" permission anywhere.

The Function adds the `family` label to a user who belongs to at least one family and removes it when they belong to none. Only server code can set labels. This keeps accounts that are in no family from uploading files.

### 6. Create the Function

**Result:** the `family-api` service exists with the right access.

1. **Functions > Create function.** Name `family-api`, **Function ID** `family-api` (set it manually so it matches `config.js`).
2. **Runtime:** the newest Node.js runtime offered (Node 22 or later). `node-appwrite` 31.1.0 needs Node 20 or later.
3. **Entrypoint:** `src/main.js`. **Build commands:** `npm install`.
4. **Settings > Execute access:** add the role for **signed-in users** (the `users` role). Do **not** add Any or Guests. The Function itself refuses unverified emails.
5. **Settings > Scopes** (these define the temporary API key): `users.read`, `users.write`, `teams.read`, `teams.write`, `rows.read`, `rows.write`, `files.read`, `files.write`. Tick nothing else. If an execution log later says a scope is missing, add exactly the scope it names.
6. **Settings > Timeout:** 15 seconds is plenty. The Function stops long jobs at about 9 seconds and the browser asks it to continue.
7. **Settings > Executions > Schedule:** choose **Cron** with `17 * * * *` (hourly). On the Free plan the shortest allowed interval is 60 minutes. This run has no user and an empty body, so the Function deletes uploads older than one hour that no post or profile uses.
8. **Environment variables:** none are required. Optional: `DATABASE_ID` (default `family`), `BUCKET_ID` (default `family-media`), `MAX_OWNED_FAMILIES` (default `3`), `MAX_VIDEO_MB` (default `25`; keep at or below the bucket limit), `FAMILY_STORAGE_MB` (default `500`; the photo and video space each family gets. Your free plan has 2 GB in total for all families together, so 500 fits about four families).

### 7. Deploy the Function code

**Result:** the code in `function/` is live.

On a computer with the `function` folder from this download:

```bash
cd function
tar --exclude node_modules --exclude test --exclude code.tar.gz -czf code.tar.gz .
```

In the Console, open `family-api` > **Deployments > Create deployment > Manual**, upload `code.tar.gz`, confirm entrypoint `src/main.js` and build command `npm install`, and **activate** the deployment after the build finishes. Alternative: install the Appwrite CLI, run `appwrite login`, then `appwrite push functions` from a project folder that contains this function.

To run the tests first: `cd function && npm install && npm test` (16 tests, no network).

### 8. Test the Function in the Console

**Result:** proof that the Function runs and refuses anonymous callers.

1. In `family-api`, open **Executions > Execute now**. Method POST, body `{"action":"listFamilies"}`. Expect status 401 and `"error":"unauthenticated"`. The Console runs without a user, so this is the correct refusal.
2. Run it again with an empty body. Expect status 200 and `{"ok":true,"removed":0}`. That is the cleanup run.

A 500 with `server_misconfigured` means the scopes or key were not applied. Save the scopes and redeploy.

### 9. Check `config.js`

**Result:** the site points at your project and the Function.

`config.js` holds your endpoint and project ID. It now has `functionId: "family-api"` and no `teamId`. Table and bucket IDs match this guide.

### 10. Upload to GitHub

**Result:** the live site runs the new version.

Replace `app.js`, `config.js`, `styles.css`, `index.html` and `favicon.svg` in your `family-app` folder. The `function` folder does not go on GitHub, because it lives in Appwrite. Wait for the Pages build, then hard-refresh. If the page shows "Loading…" forever, open the browser console (F12) and read the first red message.

---

## Part 4. What owners and members do on the website

1. **Create an account.** Name, email, password. Appwrite emails a verification link. Open it, then press **I verified it, continue**.
2. **Create a family.** Onboarding shows **Create your family**. Type `The Rivera family` and press the button. The app creates the Team (you become owner) and registers it. You then pick a display name for that family.
3. **Invite relatives.** Family page > **Invite a relative**. Enter their email. They should already have a verified account with that address. They open the link in the email while signed in, and the family appears in their top bar.
4. **Switch families.** The top bar shows a selector when you belong to more than one family, plus **+ Create another family…** while you own fewer than 3.
5. **Manage people.** The Family page lists members. Owners can **Make owner**, **Remove**, or **Cancel invite**.
6. **Leave.** Any member can leave. The only owner must first promote someone else or delete the family.
7. **Delete a family.** Owner only, after typing the family name. Posts, comments, likes, saves, profiles and files go first, then the Team.

A person with no family sees onboarding and nothing else.

---

## Part 5. What the app does when people switch, sign out or lose access

- The family list comes from the Function, which reads confirmed memberships from Appwrite. A family ID in the URL, in `localStorage` or in a form is never accepted as proof. The saved "last family" is only a preference that must appear in the server's list.
- Opening or switching a family first asks the Function for a fresh list, then clears every profile, saved post, avatar image and media object belonging to the previous family before loading the next.
- After 5 minutes in the app, the next navigation re-checks membership before showing family content. A removed member sees a notice and lands in a remaining family, or in onboarding.
- Appwrite re-checks permissions on every read and every file download, so a removed member cannot fetch content even if the page were left open or modified.
- Signing out clears all of this state, the saved preference and the session fallback.

---

## Part 6. Security checklist

- [ ] No API key anywhere in `config.js`, `app.js`, GitHub or the browser. The Function receives a short-lived key from Appwrite.
- [ ] Table permissions are empty on all six tables, Row security is ON.
- [ ] Open any row in `posts` in the Console: its Permissions show only `team:<id>`. A `bookmarks` row shows only `user:<id>`.
- [ ] Open any file in `family-media`: it shows only `read(team:<id>)` after it is attached to a post.
- [ ] The bucket has Create for label `family` and nothing else, File security ON.
- [ ] Function Execute access lists signed-in users only.
- [ ] Function scopes match step 6, no more.

---

## Part 7. Free plan, honestly

- **Everything shares one project.** Every family uses the same 2 GB storage, 5 GB monthly bandwidth and 750,000 monthly function executions. One heavy family can use up the allowance for all of them, and Appwrite then pauses the project.
- **Executions:** each like, comment, post, save and profile change is one execution, and each sign-in adds one. A family of 10 active relatives uses a few thousand a month.
- **Inactivity:** a Free project pauses after 7 days without Console activity, for every family at once. Paused projects are deleted after 90 days. Log in to the Console weekly, or upgrade.
- **Functions per project:** the Free plan allows 2. This app uses 1.
- **Plan limits change.** Recheck https://appwrite.io/pricing before relying on them.

---

## Part 8. Current limitations

**Bottom line:** Appwrite permissions and the Function enforce isolation between families. These are the places where the app is weaker than you might assume.

1. **You can read everything.** You own the Appwrite project. Anyone with Console access can open every row and file in every family. The privacy here is between families and from the public. It does not extend to you, and families should be told.
2. **Not tested against your live project.** The Function ran against a fake Appwrite, and the web app ran in a simulated browser with a stubbed SDK. Run the two-account test in Part 9 before telling anyone about the site. Four behaviors depend on live Appwrite and are the first suspects if something fails: (a) the `x-appwrite-user-jwt` header (the app also sends the token in the request body as a fallback), (b) signed-in users being allowed to create Teams, (c) the `family` label working in the bucket's Create permission, (d) function executions returning `responseBody` to the browser as the code expects.
3. **Member limits are not enforced.** Owners invite from the browser, which Appwrite supports but the Function cannot cap. A family can grow as large as Appwrite allows. The limit of 3 owned families per person is enforced.
4. **Upload checks.** The Function checks that each file was uploaded by the caller, for the right family, within the size limit, with an allowed type as Appwrite records it. It cannot inspect video length or shape. The "Shorts under 60 seconds and vertical" rule is checked in the browser only.
5. **Brief orphan files.** A file that someone uploads and never attaches sits in storage for up to about two hours until the hourly cleanup removes it. During that window the uploader controls its permissions, because browsers can set permissions for any role they hold, and that includes "anyone". A determined member could use that window to host an arbitrary file of an allowed type. The label restriction, extension list and size cap limit the damage.
6. **Removed members' content stays.** Posts, comments and profile names of someone who leaves remain in the family, so conversations still make sense. The person loses access immediately.
7. **Owner moderation is delete-only.** Owners can delete any post or comment in their own family. They cannot edit other people's words.
8. **Slow first call.** A function that has not run recently takes a second or two to start.
9. **Invitations.** Invitation and verification emails come from Appwrite's default sender and can land in spam. An invitation sent to an address with no account makes Appwrite create a passwordless account for it. That person should use **Forgot password** to set one, then sign in.
10. **Screenshots.** Anyone who can see a photo can screenshot or share it. The app cannot prevent that.
11. **Large family deletions** run in slices of about 9 seconds. The delete button repeats automatically and, if the connection drops, can be pressed again to resume.
12. **No offline cache.** Private posts and media are never stored for offline use.

---

## Part 9. Test it with two accounts before you launch

Use one normal window and one private window, with two different email addresses.

1. **Window 1:** sign up as Ann, verify, create family `Family A`, post a text note and a photo.
2. **Window 2:** sign up as Ben, verify. Expect onboarding, no posts, no family names. Create `Family B` and post `B-only`.
3. In Window 1, confirm Ann cannot see `B-only`. In Window 2, confirm Ben cannot see Ann's post or photo.
4. **Invite:** Ann invites Ben's email from the Family page. Ben opens the link while signed in. His top bar now lists both families. Switch back and forth and confirm each family shows only its own posts.
5. **Remove:** Ann removes Ben from `Family A`. In Ben's window, reload. Family A disappears from the selector and its photo links stop loading.
6. **Delete:** Ben deletes `Family B`. In the Console, `posts`, `profiles` and `family-media` hold nothing for it, and the Team is gone.
7. **Limits:** try to create a fourth family as one user. You get a clear message at the limit.
8. **Console spot check:** open one `posts` row and one file and compare their permissions with the Part 6 checklist.

---

## Part 10. Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| "The family-api function was not found" | Wrong `functionId`, or no active deployment | Check the Function ID is `family-api` and a deployment is activated |
| "You don't have permission to do that" on every action | Execute access missing | Step 6.4 |
| "The server is not set up correctly" | Scopes not applied | Step 6.5, then redeploy |
| Creating a family fails at the first step | Users cannot create Teams in this project | Step 2 |
| Upload fails with a permission error | The `family` label is not set yet, or the bucket Create permission is missing | Reload once (the label is added when the family list loads), then recheck step 5.2 |
| A screen says a query needs an index | Missing index | Add the Key index it names, step 4.5 |
| Invitation link does nothing | Hostname not registered as a Web platform, or the link was opened while signed out of the invited account | Step 1, then sign in as the invited email and open the link again |
| Everything stopped | Free project paused or a Free limit reached | Open the Console and resume, or upgrade |

---

## Part 11. Files in this folder

| File | Purpose |
|---|---|
| `index.html`, `styles.css`, `app.js`, `config.js`, `favicon.svg` | The website. Upload to GitHub Pages. |
| `function/src/main.js`, `function/src/logic.js`, `function/package.json` | The `family-api` Function. Deploy to Appwrite (step 7). |
| `function/test/logic.test.js` | 16 tests of the Function's rules (`npm test`). |
| `SETUP-GUIDE.md` | This guide. |

> **Added in v1.4.0 (Saved libraries):** open Databases > family > `bookmarks` > Columns > Create column > String. Key `collectionId`, size `24`, not required. New installs made with the setup script get this column automatically.

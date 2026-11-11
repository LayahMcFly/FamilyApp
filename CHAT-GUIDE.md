# Family Chat guide

Version 1.47.0. Channels and direct messages for each family, opened from the small handle in the middle of the bottom bar.

**In short:** the code is written and the function logic passes 48 automated tests (17 of them are for chat) against an in-memory fake of Appwrite. The screens passed a browser test at phone and desktop width, light and dark. None of it has run against your live Appwrite project yet. Do the setup steps in order, then the test checklist (Part 7). Do not tell your family the chat is private until the privacy check in step 11 shows all PASS lines.

---

## Part 1. What you get, and what is left for later

| Done in this version | Notes |
|---|---|
| Center handle with a quick-actions panel (Create post, Family chat, Direct messages) | Still five bottom items. Tap, swipe up, Enter, Space or Arrow Up opens it. Escape, outside tap, swipe down close it. |
| Family chat for the active family | Starter channels `# general`, `# announcements` (read-only), `# plans-and-events`. |
| Family switcher | Only your own confirmed families. Switching closes the old connection and drops the old messages first. |
| Text messages with name, picture, time, date lines, grouping | Shown as plain text (no HTML is ever interpreted). Links are the only clickable part. |
| Replies, reactions with any emoji, edit (with "edited"), delete (with confirmation) | Tap and hold a message (or right-click) to open the menu. Six quick emoji sit on top, and the **+** opens every emoji with search and skin tones. Up to 20 different emoji per message. Reply and react work only inside the same conversation. |
| Family chat picture | Owner or chat admin: Chat settings, **Family chat picture**, Upload. It replaces the letter at the top of the left bar for everyone in that family. It is kept in the family's team settings, so no new table is needed. This needs the new `family-api` upload (step 4). |
| Links with preview cards | A web address in a message becomes a tappable link. The first link also gets a card with the site name, title, description and picture. The family server fetches the page, so nobody's phone contacts that site. |
| GIFs and stickers | The **GIF** button next to the message box searches GIPHY. It needs a free GIPHY key (step 5b). Until then the button says GIFs are not set up. |
| Older messages (30 at a time), "New messages" line, "Jump to latest" | A new message never drags you away from older ones you are reading. |
| Sending, failed and retry | Retry reuses the same message id, so a retry can never post twice. |
| Unread dots and counts per person and per conversation | Counts come from the server. "Read" is defined in Part 2. |
| Direct messages, per family, one thread per pair | Participants only. Start one by tapping a family member's picture in the left rail (below the **H**). The person who wrote last sits on top. The **H** (family chat) stays pinned at the very top. Block a person, or turn off DMs from everyone. |
| Roles: family owner, chat admin, member | Chat admins are chosen by an owner. Tree admins and shop access mean nothing here. |
| Channel tools for owners and chat admins | Create, rename, describe, reorder (up/down), archive and restore, read-only switch. |
| Moderation record | Who removed a message or archived a channel, where and when. Never the message text. Never for DMs. |
| Realtime updates, reconnect catch-up, 8-second polling fallback | Duplicate-proof. |
| Live privacy check (`verify-chat-access.mjs`, step 11) | Tries to break in with direct requests. |

| Not in this version (no buttons exist for these) | Why |
|---|---|
| Typing indicators, photo or file attachments, pinned messages, push notifications | Each needs its own storage or permission design. |
| Private or restricted channels | Needs per-channel membership rules that are not built or tested. All channels are visible to all current members. |
| Search inside messages | Appwrite search needs extra indexes. Later. |
| Reopening a closed DM when someone rejoins | A closed DM stays closed. |
| Voice, video, screen sharing, bots, public discovery | Out of scope by request. |
| End-to-end encryption | Not built. Do not describe chat as end-to-end encrypted. |
| 16 long emoji combinations as reactions (families, kisses, and the England, Scotland and Wales flags) | The reaction column is 8 characters wide. They can still be typed in a message. |

---

## Part 2. How it works

### Navigation
- **Phone:** one screen at a time. The channel list (or DM inbox) is its own screen. Choosing a channel opens the conversation with a back arrow. The header always shows the channel name and the family name. The bottom bar is hidden inside chat so the message box sits right above the keyboard. The page height follows the visible area of the phone (the visual viewport), so the box rides above the keyboard.
- **Desktop (900 px and wider):** the channel sidebar and the conversation are side by side. At 1100 px and wider a family switcher column appears at the left. Below that, switch families from the family name at the top of the sidebar.
- **Left rail:** the **H** is pinned at the top, a thin line sits under it, and below that every other family member appears as a picture, most recent conversation first. Tap one to open or start a direct message. A red number shows unread messages. The rail has no separate "Direct messages" tab, because the people are the list.
- **Routes** (hash routing, the `/FamilyCircle/` path is untouched): `#/chat`, `#/chat/<channelId>`, `#/dms`, `#/dms/<dmId>`.

### The model
- **Family = one Appwrite Team.** Chat uses the family id you already have. Nothing is hardcoded.
- **Channels** belong to one family. Everyone currently in the family can read them.
- **DMs belong to one family and exactly two people.** One thread per pair per family, enforced by a unique key. Two people who share two families have two separate threads, one in each, so nothing crosses over by accident.
- **Roles** (separate from family-tree roles):
  - *Family owner:* the existing Team role `owner`.
  - *Chat admin:* a flag on the person's profile row (`chatAdmin`), set only by an owner.
  - *Member:* everyone else.

| Action | Member | Chat admin | Owner |
|---|---|---|---|
| Read shared channels, post in normal channels | yes | yes | yes |
| Post in a read-only channel | no | yes | yes |
| Create, rename, describe, reorder, archive channels | no | yes | yes |
| Remove someone else's message in a shared channel | no | yes (recorded) | yes (recorded) |
| Choose chat admins | no | no | yes |
| Read other people's DMs | **no** | **no** | **no** |
| Remove someone else's DM message | **no** | **no** | **no** |

Being someone's parent in the family tree, a tree admin, or a store admin grants nothing here (there is a test for this).

### Links, previews and GIFs
- **Links:** only `http://` and `https://` addresses become links. They open in a new tab with `noopener noreferrer nofollow`. Example: `https://example.com/recipe, thanks!` links to the address without the comma.
- **Previews:** when a card is about to scroll into view, the phone asks the family server for it. The server refuses addresses that point inside its own network (home-network and cloud-internal ranges, `localhost`, and web addresses that resolve to them), checks every redirect the same way, reads at most 512 KB of page, accepts only HTML, takes the picture only if it is a normal PNG, JPEG, GIF or WebP under 200 KB, and gives up after 5 seconds. Only members of the family can ask, 12 requests per minute per person. If a site refuses or has nothing to show, no card appears.
- **GIFs:** choosing one sends its GIPHY address as an ordinary message. A message that is only a GIPHY address shows the picture with "via GIPHY".
- **Switch:** Chat settings, **Links and GIFs**. Off means plain links, no cards, no GIFs, and no preview requests.

### Direct message policy
- **Scope:** per family. The conversation is created inside one family and is only usable while both people are members of it.
- **Stopping unwanted messages:** any member can block another member (in that family), or turn off DMs from everyone in that family. A blocked person is not told. When they try, they see "This person is not taking direct messages right now."
- **Someone leaves or is removed:** the DM closes. The person who left can no longer read it. The person who stayed keeps the history, read-only, and cannot send or react. The closing rewrites the read permission of the DM, its messages and its reactions so that only the person who stayed is listed.
  - The family owner removing someone from Settings closes their DMs immediately.
  - The optional event trigger (step 5) does it for any removal or leaving, including from the Appwrite Console.
  - If both are missing, the next time the remaining person opens chat it closes then. Until one of those happens, the person who left can still read old DMs if they make direct database requests with their old session. That is why step 5 is recommended.
- **Not end-to-end encrypted.** Messages are protected by access rules and travel over an encrypted connection. Anyone with administrator access to your Appwrite project can technically read stored data. The settings screen says this in plain words.

### When a conversation counts as read
A conversation is marked read when all of these are true: it is on screen, the page is visible, and the newest message is in view (you are within 80 pixels of the bottom). The app then tells the server the time of the newest message it showed, 0.7 seconds later. It can only move forward. Your own messages are never unread. A channel you have never opened counts only messages sent after the channel was created.

### Limits and where they are enforced
| Limit | Value | Enforced |
|---|---|---|
| Message length | 1000 characters | **Server** (and the box) |
| Messages per person | 6 per 10 seconds, 30 per minute | **Server** (counted in the database) |
| Reactions per person | 20 per 10 seconds | **Server** |
| Edits of one message | at least 1 second apart | **Server** |
| Channels per family | 20 including archived | **Server** |
| Reactions allowed | 👍 ❤️ 😂 😮 😢 🙏 | **Server** |
| Page size when reading history | 30 | App only (a convenience, not a security rule) |
| Message history | **Not unlimited.** Messages are kept until deleted, and count toward your Appwrite database allowance. | Plan limits |

### Costs
No new service and no new package. Everything runs on your existing Appwrite project and the existing `family-api` function. Each send, edit, delete, reaction and unread check is one function run. Reading and realtime updates go straight to the database. Realtime connections, database size and function runs count toward your Appwrite plan limits. A busy family chat uses far more function runs than the rest of the app, so look at your usage page after the first week.

---

## Part 3. Files

New:
- `chat.js`, `chat.css`, `emoji-data.js` (front end; the emoji list loads only when someone opens the emoji picker)
- `function/src/chat.js` (all trusted chat logic), `function/src/preview.js` (safe link fetching), `function/test/chat.test.js` and `function/test/preview.test.js`
- `setup/setup-chat.mjs` and `.github/workflows/setup-chat-tables.yml` (tables, indexes, self-check, optional starter channels)
- `setup/verify-chat-access.mjs` and `.github/workflows/verify-chat-access.yml` (live privacy check)
- `CHAT-GUIDE.md`

Changed:
- `app.js`: center nav item, panel, chat routes, stop-chat hooks, `chatReconcile` after an owner removes someone
- `index.html`: loads `chat.css` and `chat.js`
- `config.js`: `chatEnabled: true`
- `function/src/logic.js`: loads the chat module, deletes chat data when a family is deleted
- `function/src/main.js`: handles the optional membership-delete event
- `function/test/logic.test.js`: the fake now includes chat tables

---

## Part 4. Database: exact schema, indexes and permissions

Database `family`. Every new table has **no table-level permissions** and **Row security ON**. The browser has no write access to any of them. Only `family-api` writes, and every row says who may read it.

| Table | Columns (type, size) | Indexes | Row read permission |
|---|---|---|---|
| `chatChannels` | familyId (string 36), channelKey (string 120), name (40), description (200, optional), position (integer), readOnly (boolean), archived (boolean), createdBy (36, optional) | key `idx_familyId`; **unique** `uniq_channelKey` | `team:<familyId>` |
| `chatMessages` | familyId (36), convId (36), kind (8: `channel` or `dm`), authorId (36), body (2000), replyToId (36, optional), clientId (36), sendKey (80), editedAt (32, optional) | key `idx_convId`; key `idx_conv_author` (convId, authorId); key `idx_authorId`; key `idx_familyId`; **unique** `uniq_sendKey` | channel: `team:<familyId>`. DM: `user:<a>` and `user:<b>` |
| `chatReactions` | familyId (36), convId (36), messageId (36), userId (36), emoji (8), reactionKey (100) | key `idx_messageId`, `idx_convId`, `idx_userId`, `idx_familyId`; **unique** `uniq_reactionKey` | same as the message it belongs to |
| `chatDms` | familyId (36), userA (36), userB (36), dmKey (120), status (8: `open` or `closed`), lastAt (40, optional), closedFor (36, optional), pending (boolean) | key `idx_familyId`, `idx_userA`, `idx_userB`, `idx_status`; **unique** `uniq_dmKey` | `user:<a>` and `user:<b>`; after closing, only the person who stayed |
| `chatReads` | familyId (36), userId (36), convId (36), readKey (80), lastReadAt (40) | key `idx_user_family` (userId, familyId), `idx_familyId`; **unique** `uniq_readKey` | **none** (function only) |
| `chatBlocks` | familyId (36), blockerId (36), blockedId (36, `*` means everyone), blockKey (120) | key `idx_familyId`, `idx_blockerId`, `idx_blockedId`; **unique** `uniq_blockKey` | **none** (function only) |
| `chatMod` | familyId (36), actorId (36), action (32), convId (36, optional), targetUserId (36, optional) | key `idx_familyId` | **none** (function only; owners and chat admins read it through the function) |
| `profiles` (existing) | **add** chatAdmin (boolean, optional) | none | unchanged (team-readable like the rest of the profile) |

How the unique keys prevent duplicates:
- `channelKey = <familyId>_<slug>`: the starter channels can be created by the setup script, by the app, or by two people at once, and only one set ever exists.
- `dmKey = <familyId>_<smallerUserId>_<largerUserId>`: one thread per pair per family, whoever starts it.
- `sendKey = <userId>_<clientId>`: a retried send returns the stored message.
- `reactionKey`, `blockKey`, `readKey`: one row per person per target.

Function scopes: the ones `family-api` already has (`users.read`, `users.write`, `teams.read`, `teams.write`, `rows.read`, `rows.write`, `files.read`, `files.write`) are enough. Nothing new.

Realtime: nothing to configure in Appwrite. The app subscribes to `tablesdb.family.tables.<table>.rows` for `chatMessages`, `chatReactions`, `chatChannels` and `chatDms`. Appwrite only delivers an event to a connection whose signed-in person has read permission on that row. The app also ignores events that carry another family's id.

---

## Part 5. Setup, step by step

Do these in order. About 30 minutes, most of it waiting for Appwrite to build columns.

### Step 1. Get the new code onto GitHub
*Where:* the GitHub repository `LayahMcFly/FamilyCircle`. *Do:* the new files are already pushed (version 1.47.0). *Check:* open `https://layahmcfly.github.io/FamilyCircle/chat.js`. It should show code, not "404". GitHub Pages needs a minute or two after a push.

### Step 2. Make a temporary key for the setup
*Where:* Appwrite Console, your project, Overview, API keys, Create API key. *Do:* name it `temporary chat tables`, expiration 1 day. Tick exactly: `databases.read`, `tables.read`, `tables.write`, `columns.read`, `columns.write`, `indexes.read`, `indexes.write`, `rows.read`, `rows.write`. Create it and copy the secret (shown once). *Where next:* GitHub, repository, Settings, Secrets and variables, Actions, New repository secret (or replace the existing one). Name `APPWRITE_KEY`, paste, save. *Secret?* **Yes**, never paste it anywhere else. *Check:* the secret list shows `APPWRITE_KEY`.

### Step 3. Create the tables, indexes and column
*Where:* GitHub, Actions tab, **Add the Family Chat tables (one-time)**, Run workflow. The dropdown asks if you want starter channels now. Choose **no** (the app makes them the first time someone opens chat) or **yes** (creates them for every family now). Either is safe to repeat. *Do:* press Run workflow, then wait for the green check (1 to 4 minutes). *Check:* open the run and read the log. `created` and `exists` lines are fine. The last section, "Self-check", must show `ok` for every line and the final line must say `Done`. *If it shows PROBLEM lines:* a query failed, usually a missing index. Run the workflow again; Appwrite may still have been building. If it persists, send me the log. *If it fails with a permission message:* the key is missing a scope from step 2.

**Clean up now:** delete the key in Appwrite (API keys, the three dots, Delete), delete the `APPWRITE_KEY` secret, and delete `.github/workflows/setup-chat-tables.yml` from the repository. (Keep the secret until step 11 if you want to run the privacy check, then delete it.)

### Step 4. Upload the new `family-api` function
*Where:* Appwrite Console, Functions, `family-api`, Deployments, Create deployment, Manual. *Do:* upload `family-api.tar.gz` (sent with this guide), entrypoint `src/main.js`, build command `npm install`, tick **Activate deployment after build**. *Check:* the deployment shows Ready and is marked Active. *If the build fails:* open its logs. A missing `node-appwrite` means the `npm install` command was left out.

### Step 5. Add one event to `family-api` (optional, 2 minutes)
**What it does:** when someone leaves a family or is removed, Appwrite tells `family-api`, and the function locks that person out of their direct messages in that family right away. **You can skip this step.** Without it, the lockout still happens when an owner removes someone in Settings, and when the other person next opens chat. It only matters for the gap when a person leaves on their own.

1. Open Appwrite Console and choose your project.
2. In the left menu, tap **Functions**, then tap **family-api**.
3. Tap the **Settings** tab.
4. Scroll to the **Events** section and tap **Update** (or **Add event**).
5. Choose **Custom event** (or type in the event box) and enter exactly: `teams.*.memberships.*.delete`
6. Tap **Add**, then tap **Update** at the bottom of the section to save.

**Check:** the Events section now lists `teams.*.memberships.*.delete`.
**If you can't find Custom event:** pick **Teams**, then **Memberships**, then **Delete** from the lists instead. Appwrite builds the same text for you. Screens differ a little between Console versions, so if neither works, skip this step and tell me what you see.

### Step 5b. Turn on GIFs (optional, 5 minutes)
*Why:* the GIF button needs a search service. Google's Tenor shut its service down on June 30, 2026, so this uses GIPHY, which has a free tier. Without a key everything else in chat works and the GIF picker explains that GIFs are not set up.
*Where and do:*
1. Go to developers.giphy.com, create a free account, choose **Create an App**, pick **API**, and copy the key it shows.
2. In the Appwrite Console open Functions, `family-api`, Settings, Variables, and add `GIPHY_API_KEY` with that key. Optionally add `GIPHY_RATING` with `g` (default, the safest), `pg` or `pg-13`.
3. Open Deployments and redeploy (step 4 again, or the three-dot menu on the active deployment, Redeploy). Variables are read only when a deployment starts.
*Check:* in chat tap **GIF**. Pictures appear. *If it says "not set up":* the variable name is misspelled or the redeploy did not finish. *If it says GIPHY could not be reached:* wait a minute. A new free key has a low hourly allowance, which is enough for a family and can be raised from the GIPHY dashboard.
*Privacy:* the words you search go to GIPHY through the family server, without your name. A GIF in a message loads from giphy.com in each viewer's browser, so GIPHY can see that viewer's internet address. Each person can switch this off under Chat settings, Links and GIFs.

### Step 6. Confirm the web platform (for Realtime)
*Where:* Console, your project, Overview, Platforms. *Check:* a Web platform with hostname `layahmcfly.github.io` exists (no path). Realtime uses the same list. You already have it, so nothing to change.

### Step 7. Frontend configuration
*Where:* `config.js`. *Check:* it contains `chatEnabled: true,`. Set it to `false` to hide chat completely (the center button then goes straight to Create post). Nothing else is needed. The database name `family` and the function id `family-api` come from the existing settings.

### Step 8. Open chat for the first time
*Do:* open the site, sign in as the family owner, tap the center handle, choose **Family chat**. The three starter channels appear. *Check:* in Console, Databases, `family`, `chatChannels`, each family has exactly three rows. Open chat again on another phone. The count stays three.

### Step 9. Choose chat admins (optional)
*Where:* in chat, the sidebar, **Family members**. *Do:* press **Make chat admin** next to a person. *Check:* they now see Manage channels in the sidebar and can post in `# announcements`.

### Step 10. Test with two accounts
Run Part 7 with two real accounts on two devices (or one phone and one computer).

### Step 11. Optional: privacy check with direct requests
1. Send one DM between two accounts (A and B). Make sure a third account C is in the same family.
2. Keep (or recreate) the `APPWRITE_KEY` secret from step 2 (it needs `rows.read`).
3. Add two more repository secrets: `OTHER_EMAIL` and `OTHER_PASSWORD` for account **C**, who is *not* in that DM. (They may already exist from the address check. Make sure they are for a person who is not in the DM.)
4. GitHub, Actions, **Check chat privacy (direct requests)**, Run workflow.
5. *Check:* every line starts with `PASS` and the last line says `All checks passed`. *If any line says FAIL:* stop using DMs and send me the log.
6. Delete the key and the three secrets afterwards.

### Step 12. After any later push
After any push, wait about two minutes, then hard-refresh the site (on a phone: close the tab and reopen it).

---

## Part 6. Existing conversations (migration)

The app had no chat before this version, so there is nothing to convert and nothing is altered or removed. Each family gets its three starter channels once, either from step 3 (if you chose yes) or on first open. The unique `channelKey` makes both ways safe to repeat, so you cannot end up with duplicates. Posts, comments, the tree and the shop are not touched.

---

## Part 7. Test checklist

Use two accounts, A (owner) and B (member), plus C (member who is in a different DM).

1. Tap the handle, the panel opens; Escape, tapping outside, or swiping down closes it; swiping up on the handle opens it. Scrolling the feed never opens it.
2. Choose **Create post**. The post screen opens, not chat.
3. Choose **Family chat**, then **Direct messages**.
4. B sends a message in `# general`. A sees it appear without refreshing, once.
5. Reply to a message. The reply shows what it answers. Tap it to jump to the original.
6. React with an emoji on one phone. It shows on the other. Tap again to remove it.
7. Edit your message: "(edited)" appears. Delete one: you are asked first.
8. Turn on airplane mode, send a message: it shows "Not sent". Turn it off and tap Retry: it appears once.
9. Scroll up to old messages, have the other person send a new one: you stay where you are and see "1 new message". Tap it to jump down.
10. Open a long channel: only 30 messages load; "Load older messages" loads more.
11. Unread: B sends in `# general` while A is in `# plans-and-events`. A sees a count beside `# general`. Opening it and reaching the bottom clears it. The panel badge and the dot on the handle clear too.
12. Switch families (if you have two): the first family's messages and connection are gone before the second loads.
13. B (member) cannot see **Manage channels**, and in `# announcements` sees "Only the family owner and chat admins can post".
14. A (owner) can create a channel, reorder, edit, archive (read the explanation) and restore.
15. A starts a DM with B. C cannot see it, and the moderation record never lists DM messages. A removes a message of B's in `# general`: it is labelled "Remove as family owner" and appears in **Moderation record**. In the DM there is no such option.
16. B blocks A: A's send fails with "not taking direct messages right now" and is not told why.
17. Owner removes B from the family (Settings, Family and members): B is signed out of that family's chat, B's open chat shows the access error, and A can read the old DM but cannot reply.
18. Run the privacy check (step 11).
19. Tap and hold a message for about half a second: the menu opens. Tap **+** and react with an emoji that is not one of the six, such as a flag. It shows on the other phone. Add 21 different emoji to one message: the 21st is refused with a clear message.
20. Send `https://example.com`: it is a link, and a card appears within a few seconds. Send `javascript:alert(1)`: it stays plain text. Send a link to a private address such as `http://192.168.0.1`: it is a link, with no card.
21. Chat settings, Links and GIFs off: the card and any GIF turn into plain links.
22. With a GIPHY key set (step 5b): tap **GIF**, search "cat", tap a result. It sends as a picture. Try the Stickers tab and **Load more**.
23. Keyboard only: Tab to the handle, Enter, arrow keys inside the panel, Escape. Reduced motion (phone setting Reduce Motion) removes the panel animation. On a phone, tap the message box: the box stays above the keyboard.

---

## Part 8. Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| "Chat is not ready yet" when opening chat | Tables missing, or the new function is not active | Steps 3 and 4 |
| Panel opens but Family chat shows an error with "Try again" | Function error | Console, Functions, `family-api`, Executions, open the newest one |
| Messages appear only after a few seconds, or not until reopening | Realtime not connected, so the 8 second fallback is running | Step 6, and check the browser console for a blocked WebSocket |
| "Index not found" in an execution log | An index is missing | Run step 3 again |
| Someone cannot post in `# announcements` | By design (read-only) | Make them a chat admin (step 9) |
| "You are sending messages too quickly" | The 6 per 10 seconds limit | Wait a few seconds |
| A removed person still sees a channel on an old tab | The page was open before removal | They lose access to new data at once; the app re-checks every 5 minutes and when the tab returns |
| Starter channels appear twice | Should not be possible (unique key) | Send me a screenshot of `chatChannels` |

## Part 9. What is checked and what is not

Checked by automated tests against a fake Appwrite: sender identity, validation, rate limits, idempotent retries, read-only channels, replies, edit and delete rules, moderation record, reactions, channel management, roles, DM isolation and pair uniqueness, blocking, closing on leave (including permission rewrites), unread counting, family deletion, multi-family separation.

Checked in a browser with a fake backend: panel gestures and keyboard use, screens at 390 px and 1280 px in light and dark, optimistic send with a realtime echo, failed send and retry, reply, react, edit, delete, scroll behavior, older-message loading, DM states, sheets, teardown on leaving.

**Not yet checked against live Appwrite:** the real Realtime service, real permissions, real index behavior and the real event trigger. Steps 3 (self-check), 10 and 11 exist to check exactly those. Two things to watch in the live test: how quickly an already-open connection stops receiving a channel after someone is removed (the app also re-checks membership every 5 minutes and when the tab wakes), and whether Appwrite's `total` and `or` queries behave as expected on your plan.

Sources: Appwrite Realtime documentation (channels and the `Realtime` subscribe API, [subscribe](https://appwrite.io/docs/apis/realtime/subscribe), [channels](https://appwrite.io/docs/apis/realtime/channels)) and the type definitions shipped in the Web SDK 29.2.0 package used by this site.

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
| GIFs and stickers | The **GIF** button next to the message box opens a picker with GIFs and Stickers tabs, search, a preview with Send and Cancel, and an optional caption. It needs a free GIPHY key in `config.js` (step 5b, with the full walkthrough in Part 10). Until then the picker says GIFs are not set up. |
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
| Photo or file attachments, pinned messages, push notifications | Each needs its own storage or permission design. |
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
- **GIFs and stickers:** a message stores only the GIPHY id, the size, a short description and whether it is a GIF or sticker (the `media` column). The picture address is rebuilt from the id when the message is shown. Searches go from each person's own phone straight to GIPHY, because GIPHY's rules do not allow searches to be proxied through a server. Older messages that are only a GIPHY address still show as pictures.
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
| `chatMessages` | familyId (36), convId (36), kind (8: `channel` or `dm`), authorId (36), body (2000), replyToId (36, optional), clientId (36), sendKey (80), editedAt (32, optional), **media** (200, optional, text: JSON such as `{"p":"giphy","t":"gif","id":"…","w":200,"h":150,"a":"description"}`) | key `idx_convId`; key `idx_conv_author` (convId, authorId); key `idx_authorId`; key `idx_familyId`; **unique** `uniq_sendKey` | channel: `team:<familyId>`. DM: `user:<a>` and `user:<b>` |
| `chatReactions` | familyId (36), convId (36), messageId (36), userId (36), emoji (8), reactionKey (100) | key `idx_messageId`, `idx_convId`, `idx_userId`, `idx_familyId`; **unique** `uniq_reactionKey` | same as the message it belongs to |
| `chatDms` | familyId (36), userA (36), userB (36), dmKey (120), status (8: `open` or `closed`), lastAt (40, optional), closedFor (36, optional), pending (boolean) | key `idx_familyId`, `idx_userA`, `idx_userB`, `idx_status`; **unique** `uniq_dmKey` | `user:<a>` and `user:<b>`; after closing, only the person who stayed |
| `chatTyping` | familyId (36), convId (36), userId (36), typingKey (80, required), text (60, default empty), until (40) | key `idx_convId`, key `idx_familyId`, **unique** `uniq_typingKey` | Only the people in that conversation (same as its messages) |
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

Realtime: nothing to configure in Appwrite. The app subscribes to `tablesdb.family.tables.<table>.rows` for `chatMessages`, `chatReactions`, `chatChannels`, `chatDms` and `chatTyping`. Appwrite only delivers an event to a connection whose signed-in person has read permission on that row. The app also ignores events that carry another family's id.

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

### Step 5b. Turn on GIFs and stickers (optional)
Everything about GIFs is in **Part 10** below, with every click. Short version: get a free GIPHY key, paste it into `config.js` on GitHub, upload the new `family-api.tar.gz`, and run the "Add the Family Chat tables" workflow once so the new `media` column exists.

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
21b. Typing hint (needs two phones): type in a chat on phone A. Within a second phone B shows "Name is typing…" above the message box, and it disappears about 7 seconds after A stops or as soon as A's message arrives. In Chat settings, Typing hint, change the words (for example "is cooking letters") and try again. Switch it off and phone B sees nothing.
21c. Unread dots: leave chat on phone B and send a message from A. Within seconds the Chat button and the browser tab icon get a red dot, and the tab title starts with a number. Open the conversation and the dots go away.
22. GIFs and stickers: see the full checklist in Part 10, step 10.
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
| GIF picker says "too many searches" | The free GIPHY key allows 100 searches per hour for everyone using it | Wait, or see Part 10, step 11 |
| GIF picker says GIPHY did not accept the key | Typo in `config.js`, or the key was deleted | Part 10, step 4 |
| Sending a GIF fails with a bad-request message | The new `family-api` zip is not uploaded, or the `media` column is missing | Upload the zip and run the workflow again |
| "You are sending messages too quickly" | The 6 per 10 seconds limit | Wait a few seconds |
| A removed person still sees a channel on an old tab | The page was open before removal | They lose access to new data at once; the app re-checks every 5 minutes and when the tab returns |
| Starter channels appear twice | Should not be possible (unique key) | Send me a screenshot of `chatChannels` |

## Part 9. What is checked and what is not

Checked by automated tests against a fake Appwrite: sender identity, validation, rate limits, idempotent retries, read-only channels, replies, edit and delete rules, moderation record, reactions, channel management, roles, DM isolation and pair uniqueness, blocking, closing on leave (including permission rewrites), unread counting, family deletion, multi-family separation.

Checked in a browser with a fake backend: panel gestures and keyboard use, screens at 390 px and 1280 px in light and dark, optimistic send with a realtime echo, failed send and retry, reply, react, edit, delete, scroll behavior, older-message loading, DM states, sheets, teardown on leaving.

**Not yet checked against live Appwrite:** the real Realtime service, real permissions, real index behavior and the real event trigger. Steps 3 (self-check), 10 and 11 exist to check exactly those. Two things to watch in the live test: how quickly an already-open connection stops receiving a channel after someone is removed (the app also re-checks membership every 5 minutes and when the tab wakes), and whether Appwrite's `total` and `or` queries behave as expected on your plan.

Sources: Appwrite Realtime documentation (channels and the `Realtime` subscribe API, [subscribe](https://appwrite.io/docs/apis/realtime/subscribe), [channels](https://appwrite.io/docs/apis/realtime/channels)) and the type definitions shipped in the Web SDK 29.2.0 package used by this site.


---

## Typing hint: one extra step after updating

The typing hint stores a few-second note in a new table, `chatTyping`. After uploading the new `family-api` zip, run the GitHub workflow **Add the Family Chat tables (one-time)** again (it needs the API key from step 2, and you delete the key afterwards, as before). It only adds what is missing and leaves your chats alone. Until then chat works as usual and the typing hint simply does not appear.

The words after a person's name are chosen in Chat settings, are saved on that device, and are limited to 40 characters. The server removes control characters and `<` `>`, and the app shows them as plain text.


---

## Part 10. GIFs and stickers: the full walkthrough

### What was checked (on 11 November 2026) and what it means
- **Provider: GIPHY.** Google shut down its Tenor GIF service for developers, so new apps cannot use it (reported by [heise](https://www.heise.de/en/news/Google-cuts-off-Tenor-access-Apps-must-replace-GIF-search-11350334.html) and others). GIPHY's developer pages still describe creating a key from a developer dashboard ([GIPHY API Quickstart](https://developers.giphy.com/docs/api/)). GIPHY has both GIFs and transparent stickers, and a content rating filter. One caution: I could read GIPHY's developer guide but not its full legal terms page, so read GIPHY's terms yourself before relying on this long term.
- **Free tier:** every new key is a **beta key**: 100 searches or API calls per hour, 50 results per search at most. For more, you apply for a production key in the dashboard. Approval is not guaranteed and GIPHY staff discuss pricing with you ([GIPHY support](https://support.giphy.com/hc/en-us/articles/10389869671322-Is-there-a-fee-for-using-GIPHY-s-API)). Nothing in this app signs you up for a paid plan. When the hourly limit is reached the picker shows "too many searches" and a Try again button; sending and viewing GIFs already in chat keep working.
- **Attribution:** GIPHY's guide says apps must show "Powered By GIPHY" wherever the API is used. The picker shows it, and each GIF in a message shows "via GIPHY". If you want GIPHY's official logo mark, download it from GIPHY's developer site and ask me to add it.
- **Storing and copying:** GIPHY's guide says not to cache or store copies of its media, not to store returned media addresses, and not to proxy search calls. So this app does not copy any GIF anywhere, does not store addresses (only the GIPHY id), and searches from the phone itself. This is why the earlier version, which searched through your server, was replaced.
- **Usage reporting:** GIPHY "highly recommends" (does not require) sending small "this GIF was shown, clicked, sent" notices. They carry an identifier for the viewer, so this version does **not** send them. If GIPHY later makes them mandatory for your key, tell me.
- **What GIPHY receives:** the search words, the key, and each viewer's internet address and browser details when the pictures load. It does not receive message text, names, channel names or the family name. A private chat does not make a GIF private: the picture itself is public on giphy.com.
- **Filtering:** every search uses rating **G**, GIPHY's strictest. That lowers the chance of unsuitable results but cannot guarantee none appear. Anyone can switch GIFs off under Chat settings, Links and GIFs.
- **Stickers:** GIPHY's sticker catalogue (transparent animated stickers) is the sticker source. A built-in sticker pack and user-uploaded stickers are **not** part of this version (deferred, see the end).

### Step 1. Open the provider site
Open **developers.giphy.com** in your browser. *Check:* it says GIPHY Developers and has a way to log in or sign up.

### Step 2. Create an account
Choose the sign-up option, use any email you control, and confirm the email GIPHY sends. *Check:* you can log in and reach the **Developer Dashboard**.

### Step 3. Create an API key
In the Developer Dashboard choose **Create an API Key** (GIPHY's guide uses this wording). Give the app a name such as `Family Circle` and a short description such as "Private family chat GIF picker". If it asks what platform it is for, choose the web option. Accept the terms after reading them. *Check:* the dashboard now lists your key. Screens change, so if a name differs from this guide, send me a screenshot and I will adjust the guide.

### Step 4. Put the key into the website
1. This key is **public by design**. GIPHY keys are used inside the browser, so anyone who opens your site can see it, and anyone could use up your 100 searches per hour. It is not a password and cannot reach your family data. Never paste any other secret next to it.
2. On GitHub open the repository `LayahMcFly/FamilyCircle`, open the file `config.js`, and tap the pencil (Edit).
3. Find the line `giphyKey: "",` and paste your key between the two quote marks. Example: `giphyKey: "AbCd1234...",`.
4. Tap **Commit changes** and confirm. Wait about two minutes for GitHub Pages.
*Check:* open `https://layahmcfly.github.io/FamilyCircle/config.js` and find your key in it. If you do not see it, refresh once.

### Step 5. Restrict where the key can be used
I found no setting in GIPHY's documentation that limits a key to your website address. Look through your key's settings in the dashboard for anything about allowed domains. If there is none, the only protection is the 100 per hour limit and that you can delete the key and make a new one any time (repeat steps 3 and 4).

### Step 6. Content filtering
The app asks GIPHY for rating **G** on every search and cannot be loosened by family members. To change it, the developer edits `rating: 'g'` in `chat.js`. Remember filtering is risk reduction, not a guarantee.

### Step 7. Upload the server update
1. Download `family-api.tar.gz` (sent with this version).
2. Appwrite Console, Functions, `family-api`, Deployments, Create deployment, Manual, upload it, entrypoint `src/main.js`.
*Why:* the server now checks GIF and sticker messages (only a valid GIPHY id, no web addresses, no HTML) and applies the same channel and direct-message rules as text. *Check:* the new deployment shows Ready.

### Step 8. Add the new database column
Run the GitHub workflow **Add the Family Chat tables (one-time)** again, with the temporary API key steps (Step 2 above in this guide) and the clean-up afterwards. It adds the `media` column to `chatMessages` and skips everything that already exists. *Check:* the log shows `created` for `chatMessages media` and ends with `Done`.

### Step 9. Deploy the website
Nothing else is needed: GitHub Pages publishes the files already on GitHub. Reload the site once. The site address list that the browser may contact is in `index.html`; `api.giphy.com` and `giphy.com` pictures are already allowed there.

### Step 10. Test checklist
1. Chat, tap **GIF**. Nothing about GIPHY loads until you do this. Pictures appear within a few seconds.
2. Search "cat". Tap a result: a preview opens with **Send** and **Cancel**, and a caption box.
3. Tap **Cancel**: nothing is sent and you are back at the results.
4. Pick again, type a caption, tap **Send**. The message appears once, with "Sending…" then normal.
5. Do the same in a **direct message** with a second account.
6. Switch to **Stickers**, send one. It has no box around it.
7. Long-press a GIF message, choose **Reply**, send a text. The reply shows "[GIF]".
8. Reload the page. The GIF still shows. A second account sees it appear live without a duplicate.
9. Phone settings, reduce motion on: GIFs show a still picture with a round play button. Tap it to play and pause. Without that setting, at most three GIFs move at once and only the ones on screen.
10. Turn on airplane mode, open the picker: it says GIPHY could not be reached with a Try again button. Reload with a GIF whose picture was removed by GIPHY: it says "GIF no longer available".
11. Open the picker with the keyboard up on a phone: the search box stays visible and the message box is not covered.
12. A person who is not in the family (or has been removed) cannot read or send in the conversation (server rule, already in the main checklist).
13. In your browser's developer tools, Network tab, open the picker: the only outside request is `api.giphy.com`, and its address contains the key, the search words and paging numbers, nothing from your messages.
14. Search GitHub for your repository: `config.js` contains only the public GIPHY key and no Appwrite API key or other secret.

### Step 11. If something goes wrong
- **"GIPHY did not accept the key":** a typo, extra spaces, or the key was deleted. Redo step 4.
- **"Too many searches":** the beta key allows 100 per hour across everyone using it. Wait. For a bigger allowance apply for production access in the dashboard (approval and price are up to GIPHY). I will not add a paid plan without your approval.
- **A GIF will not send:** the zip (step 7) or the column (step 8) is missing. Run those.
- **A picture shows "no longer available":** GIPHY removed it. The message keeps its text and caption.
- **Layout problems on a phone:** send me a screenshot and your phone model.

### Step 12. Watch usage without reading anyone's chats
Open your GIPHY dashboard and look for usage or request counts for the key (the exact screen name is GIPHY's, so I am not guessing it). Appwrite never sees GIF searches, and the app logs no search words. Do not turn on browser extensions or analytics that record network requests.

### What is finished and what is deferred
- **Finished:** GIF and sticker picker, search with debounce and out-of-order protection, load more, loading, empty and error states with retry, preview before sending, optional caption, GIF and sticker message type with server checks, replies, duplicate-safe sending, inline rendering with correct proportions, transparent stickers, still images with play and pause, at most three moving pictures at once, "no longer available" handling, attribution, rating G.
- **Deferred:** a built-in sticker pack, user-uploaded stickers (needs upload checks and moderation), GIPHY's optional usage notices, and the official GIPHY logo mark.

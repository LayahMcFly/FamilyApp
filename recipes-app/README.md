# Recipes (Family Circle edition)

An adapted copy of The Family Recipe Book from the ZenfulOutput project (`recipe-book/`), embedded in Family Circle so it opens inside the app instead of in a new tab.

**License.** The code in this folder is GNU GPL v3 or later, Copyright (C) 2026 Leia, like the original. The text is in `LICENSE-GPL-3.0.txt`. The rest of Family Circle is under its own license (see the root `LICENSE`); this folder is a separate GPL-licensed component that the app loads in a frame. `cookbook.js` is the original minified bundle with one change (the name of its saved-cookbooks database now comes from `window.__RB_IDB`, so each member gets their own and the original app's is never touched), and carries third-party code listed in `THIRD-PARTY-NOTICES-cookbook.txt`. Fonts in `fonts/` are open fonts with their license texts beside them.

**What changed from the original.** Removed: its own sign-in and online sync, the AI method writer, the TheMealDB feed and "try something new", and Google Fonts. Added: recipes are stored per Family Circle member on this device, and the page only starts after Family Circle confirms who is signed in.

**Where data lives.** `localStorage` under `fcrb:<Family Circle user id>:`, and saved cookbooks in the IndexedDB database `fcrb_cookbooks_<user id>`. Nothing is sent to any server. The original app's own keys (`rb_*`) are never read or written.

**Not done yet (stage 2, needs separate approval).** Recipes that follow a member across devices would need a new Appwrite table and function actions.

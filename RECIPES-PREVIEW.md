# Recipes preview (sample data, branch `recipes-preview`)

**Preview — sample data, not saved to your account.** A clickable preview of private Recipes on an in-memory **fake server** with invented people, invented recipes and generated drawings (no real photos, no real backups). Not part of the live app.

## What it is, and is not
- Lives only in `recipes-preview/` plus tests. No existing file changed. Nothing in the live app loads it.
- The page's Content Security Policy has `connect-src 'none'` (no fetch, XHR, WebSocket, Appwrite) and `img-src 'self' data:` (no picture from another site). It loads no Appwrite SDK and no `config.js`, and stores nothing in the browser. Reload clears everything.
- "Private to you" is a **label only**. The fake server hides each person's recipes from the others, but there are no real accounts: real privacy is not implemented or verified here.
- Code is written fresh. **No code from the ZenfulOutput Recipe Book is copied.** Only the backup *file shape* (`{app:'family-recipe-book', version:1, recipes:[…]}`) is read.
- Photo limits (JPEG/PNG, longest edge 800 px, 150 KB) are preview limits, not a decided photo policy.

## Working in this preview
Create, edit, view, delete; favourite; sample-photo picker with refusal of bad photos; print stylesheet; backup export (file shape of the original, photos included); import of **bundled synthetic backups only** with a check step and explicit choices (duplicates, malformed records, unsupported or oversized photos, whole-file errors); round trip through export and import.

## Blocked, not built (pending the authorship and license answers)
Serving scaling, ingredient check boxes, cook mode, timers. They are listed on each recipe page and as `TODO` tests. Also not built: cookbook PDF/EPUB, real photo storage, real file import, sharing, meals made of other recipes, browsing and filtering by category or tag.

## Open it locally
From the repository root:

    python3 -m http.server 8000

then open `http://localhost:8000/recipes-preview/index.html`. (Opening the file directly does not work.) Stop with Ctrl+C. Use the browser's device toolbar for the phone layout.

## Tests
    node --test tests/recipes/recipes.test.js
    cd tests/browser && npm i playwright-core && node recipes-preview.spec.js

Fake-backend tests (class B). They prove screen behaviour and the simulated rules, nothing about real accounts, privacy, storage, real devices or the original Recipe Book. `python3 tests/recipes/make-photos.py` regenerates the sample photos.

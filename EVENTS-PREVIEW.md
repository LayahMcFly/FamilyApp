# Events preview (sample data, branch `events-minimum`)

**Preview — sample data, not connected to your family.** This is a clickable preview of the minimum Events screens (calendar and details, RSVP, edit and cancel). It runs on an in-memory **fake server** with invented people and events. It is not part of the live app.

## What it is, and is not
- Lives only in `events-preview/` (plus tests). No existing file changed: `index.html`, `app.js`, `hub.js`, `config.js` and the function folders are untouched, so nothing in the live app loads it and the Hub card still opens the original Family Board.
- The preview page has its own Content Security Policy with `connect-src 'none'`: the browser refuses every network request from it (fetch, XHR, WebSocket), Appwrite included. It does not load the Appwrite SDK or `config.js`, and it stores nothing in the browser.
- The fake server (`events-fake-server.js`) simulates the rules proposed in `EVENTS-MINIMUM-RELEASE-DESIGN.md`. It is **not** the real `family-api` code. No Appwrite table, function, permission or variable exists for Events.
- **Not decided here:** the teen and unclassified-account policy. The preview's only gate is a plain yes or no per account ("Riley Sample has no Events access"). It reads no birthday and implies no age rule.
- Production Events stays off. Nothing here is a release.

## Open it locally
From the repository root:

    python3 -m http.server 8000

then open `http://localhost:8000/events-preview/index.html` in Chrome, Safari or Firefox. (Opening the file directly does not work: the page needs a web server.) Stop the server with Ctrl+C. Use the browser's device toolbar (or narrow the window) to see the phone layout.

## Tests
    node --test tests/events/events.test.js          # 34 rule tests against the fake server, no dependencies
    cd tests/browser && npm i playwright-core && node events-preview.spec.js   # 125 browser checks in real Chrome

These are fake-backend tests (class B). They prove screen behaviour and the simulated rules. They prove nothing about the live Appwrite project.

## Left out on purpose
Reminders, polls, checklists, automatic birthday events, contributions and money, the Activity bell item, ICS export, Family Board migration, event-admin flags, and every other planned module.

## Choices the preview makes (not approved)
Attendee names and answers are visible to everyone who can see an event; both audiences (Family, Invited) are offered; location privacy has two settings; limits are 20 new events a day, 300 upcoming per family, 50 invitees, 10 guests. These follow the design's leanings so you can judge them on screen.

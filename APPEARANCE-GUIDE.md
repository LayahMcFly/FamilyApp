# Appearance: themes, display mode and accent (v1.51)

Three separate settings per person: **theme** (component design), **display mode** (light / dark / follow system) and **accent**. Mode and accent are remembered per theme.

## Files
- `theme.js` loads in `<head>` and runs first, so the page paints in the right theme. It holds the theme list, the accent lists, the contrast maths, and the local/account reconcile rules.
- `themes.css` holds the tokens and component styles for every theme except Default. Default has no rules there, it is `styles.css` exactly as before.
- `app.js` (section 4 and `settingsAppearance`) holds the saved state, sync and the Appearance screen.

## How local and account copies are reconciled
- The account copy (`prefs.appearance`) is the main one. The device copy (`localStorage` key `fc_appearance_v2`) is a cache that is tagged with the account it came from, and it is used for the first paint.
- On sign-in the newest save wins (each save has a time stamp). A copy that belongs to another account is ignored, so nothing leaks between accounts.
- Older settings (mode, preset, accent) move into the Default theme. A device copy with no account tag is adopted once by the first account that signs in.
- Signing out clears the device copy, and the sign-in screen uses Default.
- A theme name that no longer exists falls back to Default. Bad colors or modes are dropped.

## Add a theme
1. `theme.js`: add it to `THEMES` (id, name, note, `def` = starting mode and accent), add a list to `ACCENTS`, and add its page/card colors to `SURF` (used for contrast).
2. `themes.css`: copy one theme's two token blocks (light and `[data-theme="dark"]`) and change the values. Give it an "extra treatments" block only for things tokens cannot express.
3. Run the contrast check (see the test list) and look at it in light and dark.

## Tokens (themes.css section 1)
`--c-*` cards, `--b-*` buttons, `--i-*` inputs, `--tab*` tabs, `--badge-*`, `--pop-*` dialogs and sheets, `--head-*` headings, `--nav-*` navigation. Colors (`--bg --surface --surface-2 --text --muted --border`) come from the theme, `--accent --on-accent --accent-text` from the chosen accent.

## Rules for new styles
- Never set a filter, blend mode or color on photos, videos, GIFs, stickers or product images.
- Inline `style="..."` attributes are blocked by the site's security policy. Use classes, or `el.style.setProperty` from script.
- Status needs more than color: alerts get a "Problem:" or "Done:" label, selected items get a label or a check mark.

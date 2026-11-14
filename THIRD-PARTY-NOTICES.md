# Third-party notices

Family Circle includes the open-source code below. Keep this file and the `vendor/` folder together with the site. The license texts must stay with the code when you copy, host or share it.

| Component | Version | Files in this repo | License | Copyright |
|---|---|---|---|---|
| family-chart (draws the family tree) | 0.9.0 | `vendor/family-chart.min.js`, `vendor/family-chart.css` | MIT, see `vendor/LICENSE-family-chart.txt` | © 2021 Donat Soric |
| LiveKit client (voice and video calls) | 2.23.0 | `vendor/livekit-client.umd.js` | Apache-2.0, see `vendor/LICENSE-livekit-client.txt` | © LiveKit, Inc. |
| MediaPipe Selfie Segmentation (call backgrounds) | 0.1.1675465747 | `vendor/mediapipe/selfie_segmentation*` | Apache-2.0 | © Google LLC |
| MediaPipe Face Mesh (call face filters) | 0.4.1633559619 | `vendor/mediapipe/face/*` | Apache-2.0 | © Google LLC |
| d3 (family-chart needs it) | 7.9.0 | `vendor/d3.min.js` | ISC, see `vendor/LICENSE-d3.txt` | © 2010-2023 Mike Bostock |
| The Family Recipe Book, Family Circle edition (Recipes) | v2.0.6 | `recipes-app/` | GPL-3.0-or-later, see `recipes-app/LICENSE-GPL-3.0.txt` | © 2026 Leia |

## family-chart

Source: https://github.com/donatso/family-chart (npm package `family-chart`).

This is the free MIT-licensed package, not the separate premium edition. Its `LICENSE.txt` and README both say MIT. Its npm `package.json` says `ISC` instead. Both are permissive licenses with the same core duty (keep the copyright and permission notice), so keeping `vendor/LICENSE-family-chart.txt` next to the code satisfies either reading. Re-check the package before you upgrade it.

## d3

Source: https://d3js.org (npm package `d3`). The single `d3.min.js` file is a bundle of the d3 modules. Besides the d3 modules (ISC, © Mike Bostock; d3-delaunay © Observable, Inc.), it contains:

- Delaunator, ISC, © Mapbox
- InternMap, ISC, © Mike Bostock
- Robust Predicates, Unlicense (public domain)

The ISC terms for all the ISC parts are the text in `vendor/LICENSE-d3.txt`.

## Automatic captions (`vendor/transformers/`)

| Part | Licence | Where |
|---|---|---|
| Transformers.js 3.7.6 (`transformers.min.js`) | Apache-2.0 | `vendor/transformers/LICENSE-transformers.txt` |
| ONNX Runtime Web (`ort-wasm-simd-threaded.jsep.*`, bundled with Transformers.js) | MIT, Microsoft | https://github.com/microsoft/onnxruntime/blob/main/LICENSE |
| Whisper base English speech model (`Xenova/whisper-base.en`, downloaded by the browser, not stored in this repo) | MIT, OpenAI | https://huggingface.co/Xenova/whisper-base.en |

The three files in `vendor/transformers/` are unmodified copies from the npm package `@huggingface/transformers`. The model is fetched from huggingface.co the first time someone makes captions and then kept in that browser's cache.

## Address suggestions (Photon)

The optional address dropdown calls the public Photon service (`photon.komoot.io`), which searches OpenStreetMap data. Address data is © OpenStreetMap contributors, licensed under the ODbL (https://www.openstreetmap.org/copyright). No code from Photon is included in this site.

## Emoji list (`emoji-data.js`)

The emoji names and groups in `emoji-data.js` are derived from the npm package `unicode-emoji-json` (MIT licence), which republishes data from the Unicode Consortium's emoji data files (Unicode License v3, https://www.unicode.org/license.txt). The picture of each emoji comes from the viewer's own device fonts.

## GIFs (GIPHY)

The optional GIF picker calls the GIPHY API directly from each person's browser (GIPHY's rules do not allow proxying). GIFs are © their respective owners and are shown with a "Powered by GIPHY" credit as GIPHY's terms ask. No GIPHY code is included in this site.

## What your own code adds

`tree-chart.js` is your own code. It calls the library but does not change it. The files in `vendor/` are the unmodified files from the npm packages.


## Calls (`vendor/livekit-client.umd.js`, `vendor/mediapipe/`)

LiveKit client SDK 2.23.0 (npm `livekit-client`) and the two MediaPipe legacy solution packages (npm `@mediapipe/selfie_segmentation` and `@mediapipe/face_mesh`) are unmodified copies, Apache-2.0. The license text is in `vendor/LICENSE-livekit-client.txt`; the Apache-2.0 text is the same for the MediaPipe packages (https://www.apache.org/licenses/LICENSE-2.0). Only the SIMD WebAssembly builds are included, so phones too old for WebAssembly SIMD cannot use the effects. The face model needs `eval`, which the site's security rules forbid, so it runs in its own page `face-frame.html` (no network access, its own stricter-for-network policy). Video is relayed by LiveKit's servers when someone makes a call; the family-api function only issues passes.

## Page fonts (`fonts/*.woff2`, `fonts.css`)

Lora, Nunito, Courier Prime, Merriweather, EB Garamond, Poppins, Montserrat, Bebas Neue, Fredoka, Pacifico, Playfair Display, Quicksand, Roboto Slab, Roboto Condensed and Permanent Marker (Latin subset), from the npm packages `@fontsource/*`. They are open fonts under the SIL Open Font License 1.1 (Roboto Slab and Roboto Condensed: Apache-2.0). They are used for the font choice in Customize my page and download only when a page uses them.

More page fonts (shown under "Load more fonts"), all SIL Open Font License 1.1 and from `@fontsource/*`: Caveat, Sacramento, Great Vibes, Satisfy, Lobster, Shadows Into Light, Indie Flower, Patrick Hand, Amatic SC, Chewy, Cormorant Garamond, Cinzel, Abril Fatface, Josefin Sans, Righteous, Bangers, Special Elite, Yeseva One, Courgette, Pangolin, Kalam, Handlee, DM Serif Display and Raleway.

## Recipes (`recipes-app/`)

An adapted copy of the Recipe Book from the author's ZenfulOutput project, loaded in a frame inside Family Circle. It is a separate GPL-3.0-or-later component (see `recipes-app/README.md`); the rest of this repo keeps its own license. It carries its own third-party notices: `recipes-app/THIRD-PARTY-NOTICES-cookbook.txt` (pdf-lib and fontkit, MIT, and fonts) and the font license texts in `recipes-app/fonts/` (Courier Prime, Crimson Pro, IM Fell English: SIL OFL 1.1; Homemade Apple: Apache-2.0).

# Third-party notices

Family Circle includes the open-source code below. Keep this file and the `vendor/` folder together with the site. The license texts must stay with the code when you copy, host or share it.

| Component | Version | Files in this repo | License | Copyright |
|---|---|---|---|---|
| family-chart (draws the family tree) | 0.9.0 | `vendor/family-chart.min.js`, `vendor/family-chart.css` | MIT, see `vendor/LICENSE-family-chart.txt` | © 2021 Donat Soric |
| d3 (family-chart needs it) | 7.9.0 | `vendor/d3.min.js` | ISC, see `vendor/LICENSE-d3.txt` | © 2010-2023 Mike Bostock |

## family-chart

Source: https://github.com/donatso/family-chart (npm package `family-chart`).

This is the free MIT-licensed package, not the separate premium edition. Its `LICENSE.txt` and README both say MIT. Its npm `package.json` says `ISC` instead. Both are permissive licenses with the same core duty (keep the copyright and permission notice), so keeping `vendor/LICENSE-family-chart.txt` next to the code satisfies either reading. Re-check the package before you upgrade it.

## d3

Source: https://d3js.org (npm package `d3`). The single `d3.min.js` file is a bundle of the d3 modules. Besides the d3 modules (ISC, © Mike Bostock; d3-delaunay © Observable, Inc.), it contains:

- Delaunator, ISC, © Mapbox
- InternMap, ISC, © Mike Bostock
- Robust Predicates, Unlicense (public domain)

The ISC terms for all the ISC parts are the text in `vendor/LICENSE-d3.txt`.

## What your own code adds

`tree-chart.js` is your own code. It calls the library but does not change it. The files in `vendor/` are the unmodified files from the npm packages.

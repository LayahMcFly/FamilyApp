/* Recipes preview: BUNDLED SYNTHETIC backups (PREVIEW CODE). Invented recipes only; no real backup, no real photo.
 * Each one exists to show one behaviour: valid, duplicates, malformed records, photo problems, and whole-file errors.
 * Photos come from recipes-photos.js (generated drawings). */
(function (root, factory) {
  var photos = root.RecipesPhotos || (typeof require === 'function' ? require('./recipes-photos.js') : null);
  var api = factory(photos);
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RecipesFixtures = api;
})(typeof self !== 'undefined' ? self : this, function (P) {
  'use strict';
  var img = function (k) { return P[k].dataUrl; };
  function rec(name, o) { return Object.assign({ name: name, description: 'Invented sample recipe.', yield: '4 servings', ingredients: ['1 cup sample flour', '2 sample eggs', '1/2 cup sample milk'], steps: ['Mix the sample ingredients.', 'Pretend to cook for 10 minutes.'], categories: ['Sample'], tags: ['invented'], notes: '', source: '', fav: false }, o || {}); }
  function wrap(recipes) { return JSON.stringify({ app: 'family-recipe-book', version: 1, saved: '2026-01-01T00:00:00.000Z', recipes: recipes }, null, 1); }

  var seed = {
    a: [
      rec('Sample Tomato Soup', { slug: 'sample-tomato-soup', id: 'seed-a-1', image: img('plate'), yield: '4 servings', ingredients: ['2 sample tomatoes', '1 1/2 cups sample stock', '1/2 teaspoon sample salt'], steps: ['Simmer the sample tomatoes for 15 minutes.', 'Blend until smooth.'], fav: true, updated: 1760000000000 }),
      rec('Sample Lemon Cookies', { slug: 'sample-lemon-cookies', id: 'seed-a-2', image: img('cookies'), yield: '24 cookies', ingredients: ['2 1/4 cups sample flour', '1 sample lemon, zested', '3/4 cup sample sugar'], steps: ['Bake for 12 minutes.', 'Cool for 5 minutes.'], updated: 1760000100000 }),
      rec('Sample Pasta Night', { slug: 'sample-pasta-night', id: 'seed-a-3', parts: ['sample-tomato-soup'], description: 'A made-up meal that points at another sample recipe (kept in the data, not shown by this preview).', updated: 1760000200000 })
    ],
    b: [rec('Example Pancakes', { slug: 'example-pancakes', id: 'seed-b-1', image: img('tall'), yield: '8 pancakes', updated: 1760000300000 })]
  };

  var BACKUPS = [
    { id: 'valid-photos', label: 'Valid backup with sample photos', what: 'Three new recipes with good photos. Imports with no questions asked.',
      build: function () { return wrap([rec('Sample Veggie Chili', { image: img('bowl'), parts: ['sample-rice-pudding'] }), rec('Sample Fruit Salad', { image: img('tall') }), rec('Sample Rice Pudding', { image: img('plate'), fav: true, updated: 1750000000000 })]); } },
    { id: 'duplicates', label: 'Duplicates', what: 'Two recipes that already exist for Sample Cook A, two with the same name inside the file, and one new recipe.',
      build: function () { return wrap([rec('Sample Tomato Soup', { slug: 'sample-tomato-soup', notes: 'A different version from the backup.' }), rec('Sample Lemon Cookies', { slug: 'sample-lemon-cookies', image: img('cookies') }), rec('Sample Granola', { notes: 'First granola.' }), rec('Sample Granola', { notes: 'Second granola with the same name.' }), rec('Sample Stew')]); } },
    { id: 'malformed', label: 'Malformed records', what: 'Valid records mixed with broken ones (not a record, missing name, wrong field types) and a record with extra fields the preview does not carry.',
      build: function () { return wrap([rec('Sample Toast'), null, 'just a string', { name: 42 }, { name: 'Sample Broken List', ingredients: '2 eggs' }, { name: 'Sample Mixed Items', steps: ['ok step', 5] }, { name: 'Sample Bad Flag', fav: 'yes' }, [1, 2], rec('Sample Extra Fields', { rating: 5, cookbookPage: 12 })]); } },
    { id: 'photo-problems', label: 'Unsupported and oversized photos', what: 'One good recipe, then recipes whose photo is too wide, too heavy, a GIF, an SVG, an outside link, or corrupt.',
      build: function () { return wrap([rec('Sample Good Photo', { image: img('bowl') }), rec('Sample Wide Photo', { image: img('bad-wide') }), rec('Sample Heavy Photo', { image: img('bad-heavy') }), rec('Sample Gif Photo', { image: img('bad-gif') }), rec('Sample Svg Photo', { image: img('bad-svg') }), rec('Sample Linked Photo', { image: img('bad-external') }), rec('Sample Corrupt Photo', { image: img('bad-corrupt') })]); } },
    { id: 'bare-array', label: 'Older shape: a bare list', what: 'A list of recipes with no wrapper. The original Recipe Book accepts this shape, so the preview does too.',
      build: function () { return JSON.stringify([rec('Sample Bare List Bread', { image: img('cookies') })]); } },
    { id: 'not-json', label: 'File error: not JSON', what: 'Rejected as a whole, nothing read.', build: function () { return 'this is not a backup {'; } },
    { id: 'wrong-app', label: 'File error: from a different app', what: 'Rejected as a whole, nothing read.', build: function () { return JSON.stringify({ app: 'some-other-app', version: 1, recipes: [rec('Sample Elsewhere')] }); } },
    { id: 'wrong-version', label: 'File error: unknown version', what: 'Rejected as a whole, nothing read.', build: function () { return JSON.stringify({ app: 'family-recipe-book', version: 7, recipes: [rec('Sample Future')] }); } },
    { id: 'empty-list', label: 'File error: empty list', what: 'Rejected as a whole.', build: function () { return wrap([]); } },
    { id: 'too-many', label: 'File error: too many records (201)', what: 'Rejected as a whole, nothing read.', build: function () { var a = []; for (var i = 0; i < 201; i++) a.push({ name: 'Sample Bulk ' + i }); return wrap(a); } },
    { id: 'too-big', label: 'File error: file over 2 MB', what: 'Rejected as a whole, nothing read.', build: function () { return wrap([rec('Sample Huge', { notes: new Array(2200).join(new Array(1000).join('x') + ' ') })]); } }
  ];
  function get(id) { for (var i = 0; i < BACKUPS.length; i++) if (BACKUPS[i].id === id) return BACKUPS[i]; return null; }
  function text(id) { var b = get(id); return b ? b.build() : null; }
  function list() { return BACKUPS.map(function (b) { return { id: b.id, label: b.label, what: b.what }; }); }
  return { seed: seed, list: list, text: text, photos: P };
});

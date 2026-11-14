/* Recipes preview: starts the screens on the FAKE server with invented people (PREVIEW CODE, not wired into the live app).
 * No Appwrite SDK, no config.js, no account, no storage: everything lives in memory and is gone on reload. */
(function () {
  'use strict';
  var main = document.getElementById('main'), controls = document.getElementById('pv-controls'), toasts = document.getElementById('toasts');
  if (!location.hash) history.replaceState(null, '', '#/recipes');
  var server = RecipesFake.create({});
  RecipesUI.mount({ server: server, viewers: RecipesFake.VIEWERS, main: main, controls: controls, toasts: toasts, onReset: function () { location.hash = '#/recipes'; location.reload(); } });
})();

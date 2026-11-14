/* Events preview: starts the screens on the FAKE server with invented people (PREVIEW CODE, not wired into the live app).
 * No Appwrite SDK, no config.js, no account, no storage: everything lives in memory and is gone on reload. */
(function () {
  'use strict';
  var viewerTz = 'UTC';
  try { viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { /* keep UTC */ }
  var main = document.getElementById('main'), controls = document.getElementById('pv-controls'), toasts = document.getElementById('toasts');
  function start() {
    var server = EventsFake.create({ mode: 'preview' });
    EventsUI.mount({ server: server, viewers: EventsFake.VIEWERS, main: main, controls: controls, toasts: toasts, viewerTz: viewerTz,
      onReset: function () { location.hash = '#/calendar'; location.reload(); } });
  }
  if (!location.hash) location.hash = '#/calendar';
  start();
})();

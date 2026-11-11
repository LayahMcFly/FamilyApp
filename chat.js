/*
 * Family Chat (front end): the quick-actions panel behind the center handle of the bottom bar, shared family channels and
 * private direct messages. It is loaded by index.html next to app.js and talks to the same Appwrite project.
 *
 * Security notes for readers of this file
 *  - Nothing here is a security boundary. Every send, edit, delete, reaction, channel change and block goes to the
 *    family-api function, which re-checks membership and participation. Hiding a button never grants or removes access.
 *  - Messages are read straight from Appwrite with the signed-in person's own session. Appwrite only returns rows whose
 *    permissions include that person (team:<family> for channels, user:<id> for DMs), for queries and for Realtime alike.
 *  - Message text is only ever put into the page with textContent. No HTML from a message is interpreted.
 *  - Message text is never written to the console or sent anywhere except Appwrite.
 */
(function () {
  'use strict';
  var X = null, h, clear, icon, toast;
  var C = null;                    // the open chat (data, subscription, timers). One at a time; stop() clears all of it.
  var GEN = 0;                     // every start()/stop() bumps it, so answers that arrive late are thrown away
  var TOTALS = { ch: 0, dm: 0, at: 0, off: false };
  var PAGE = 30, GROUP_MS = 5 * 60 * 1000;
  var T = { msg: 'chatMessages', react: 'chatReactions' };

  function dbId() { return X.CFG.databaseId; }
  function famId() { return X.S.familyId; }
  function me() { return X.S.user && X.S.user.$id; }
  function api(action, payload) { return X.api(action, Object.assign({ familyId: famId() }, payload || {})); }
  function msgOf(e) { return e && e.message && !e.type ? e.message : X.friendly(e); }
  function profileOf(uid) { return X.S.profiles && X.S.profiles.get(uid) || null; }
  function nameOf(uid) { var p = profileOf(uid); return uid === me() ? 'You' : (p ? p.displayName : 'Former member'); }
  function realName(uid) { var p = profileOf(uid); return p ? p.displayName : 'Former member'; }
  function avatar(uid, cls) { return X.avatarEl(profileOf(uid) || { displayName: '?', userId: uid }, cls || 'sm'); }
  function enabled() { return !!(window.FCChat && X && X.CFG.chatEnabled !== false); }
  function rnd(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
  function newClientId() { return 'c' + Date.now().toString(36) + rnd(8); }
  function isFine() { return window.matchMedia && window.matchMedia('(pointer: fine)').matches; }
  function wide() { return window.matchMedia && window.matchMedia('(min-width: 900px)').matches; }

  /* ---------- time ---------- */
  function dayKey(iso) { var d = new Date(iso); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function timeText(iso) { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function dayText(iso) {
    var d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
    if (dayKey(iso) === dayKey(t.toISOString())) return 'Today';
    if (dayKey(iso) === dayKey(y.toISOString())) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  }
  function fullTime(iso) { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }

  /* =====================================================================
   * Quick-actions panel (the center handle of the bottom bar)
   * ===================================================================== */
  var panel = null, handle = null, panelOpen = false, lastFocus = null;

  function createHandle() {
    panelOpen = false;
    handle = h('button', { class: 'nav-handle', id: 'nav-handle', type: 'button', 'data-route': 'create', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'plus-panel',
      'aria-label': 'Quick actions: create a post, family chat, direct messages' },
      h('span', { class: 'handle-pill', 'aria-hidden': 'true' }, icon('plus')), h('span', { class: 'handle-dot', hidden: true, 'aria-hidden': 'true' }), h('span', { text: 'Create' }));
    // Tap, keyboard (Enter / Space) and Arrow Up all open it; a short upward swipe on the handle opens it too. The swipe is only
    // listened for on the handle itself, so ordinary scrolling of the feed can never open the panel.
    var sy = 0, sx = 0, down = false, swiped = false;
    handle.addEventListener('pointerdown', function (ev) { if (ev.pointerType === 'mouse' && ev.button !== 0) return; down = true; swiped = false; sy = ev.clientY; sx = ev.clientX; try { handle.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ } });
    handle.addEventListener('pointermove', function (ev) {
      if (!down || swiped) return;
      var dy = sy - ev.clientY, dx = Math.abs(sx - ev.clientX);
      if (dy > 18 && dy > dx) { swiped = true; down = false; openPanel(); }
    });
    function end() { down = false; }
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    handle.addEventListener('click', function (ev) { ev.preventDefault(); if (swiped) { swiped = false; return; } panelOpen ? closePanel(true) : openPanel(); });
    handle.addEventListener('keydown', function (ev) { if (ev.key === 'ArrowUp' && !panelOpen) { ev.preventDefault(); openPanel(); } });
    return handle;
  }

  function buildPanel() {
    var back = h('div', { class: 'pp-backdrop', hidden: true, onclick: function () { closePanel(true); } });
    function act(cls, href, ic, label, sub, badgeId) {
      return h('a', { class: 'pp-act ' + cls, href: href, onclick: function () { closePanel(false); } }, h('span', { class: 'pp-ic', 'aria-hidden': 'true' }, ic), h('span', { class: 'pp-txt' }, h('strong', { text: label }), h('span', { class: 'small', text: sub })), h('span', { class: 'pp-badge', id: badgeId, hidden: true }));
    }
    var grab = h('div', { class: 'pp-grab', 'aria-hidden': 'true' });
    panel = h('div', { class: 'plus-panel', id: 'plus-panel', role: 'dialog', 'aria-label': 'Quick actions', hidden: true },
      grab,
      h('div', { class: 'pp-list' },
        act('pp-create', '#/create', icon('plus'), 'Create post', 'Photo, video or words for the family', 'pp-b0'),
        act('pp-chat', '#/chat', icon('comment'), 'Family chat', 'Channels for ' + (X.famName ? X.famName() : 'your family'), 'pp-b1'),
        act('pp-dm', '#/dms', icon('send'), 'Direct messages', 'Private, just between two people', 'pp-b2')));
    // swipe down on the panel to close it
    var py = 0, pd = false;
    panel.addEventListener('pointerdown', function (ev) { if (ev.target.closest('a')) return; pd = true; py = ev.clientY; });
    panel.addEventListener('pointermove', function (ev) { if (pd && ev.clientY - py > 36) { pd = false; closePanel(true); } });
    panel.addEventListener('pointerup', function () { pd = false; }); panel.addEventListener('pointercancel', function () { pd = false; });
    panel.addEventListener('keydown', function (ev) {
      var items = Array.prototype.slice.call(panel.querySelectorAll('a'));
      var i = items.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
      if (ev.key === 'Tab') { // keep Tab inside the panel while it is open
        if (ev.shiftKey && i <= 0) { ev.preventDefault(); items[items.length - 1].focus(); } else if (!ev.shiftKey && i === items.length - 1) { ev.preventDefault(); items[0].focus(); }
      }
    });
    return [back, panel];
  }

  function place() {
    if (!panel || !handle) return;
    var r = handle.getBoundingClientRect();
    if (wide()) { panel.style.left = Math.round(r.right + 10) + 'px'; panel.style.bottom = Math.max(12, Math.round(window.innerHeight - r.bottom - 8)) + 'px'; }
    else { panel.style.left = ''; panel.style.bottom = ''; }
  }
  function openPanel() {
    if (!panel || panelOpen) return;
    panelOpen = true; lastFocus = document.activeElement;
    place(); panel.hidden = false; var b = panel.previousSibling; if (b) b.hidden = false;
    handle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(function () { panel.classList.add('open'); });
    var first = panel.querySelector('a'); if (first) first.focus({ preventScroll: true });
    refreshTotals(true).then(paintBadges);
  }
  function closePanel(returnFocus) {
    if (!panel || !panelOpen) return;
    panelOpen = false; panel.classList.remove('open'); panel.hidden = true; var b = panel.previousSibling; if (b) b.hidden = true;
    handle.setAttribute('aria-expanded', 'false');
    if (returnFocus && handle) handle.focus({ preventScroll: true });
  }
  function paintBadges() {
    function set(id, n) { var el = document.getElementById(id); if (!el) return; el.hidden = !n; el.textContent = n > 9 ? '9+' : String(n || ''); el.setAttribute('aria-label', n + ' unread'); }
    set('pp-b1', TOTALS.ch); set('pp-b2', TOTALS.dm);
    var dot = handle && handle.querySelector('.handle-dot'); if (dot) dot.hidden = !(TOTALS.ch + TOTALS.dm);
  }
  function globalListeners() {
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && panelOpen) { ev.preventDefault(); closePanel(true); } });
    document.addEventListener('pointerdown', function (ev) { if (panelOpen && !panel.contains(ev.target) && !handle.contains(ev.target)) closePanel(false); });
    // Typing somewhere (a post, a comment, the chat box) or the keyboard appearing always collapses the panel.
    document.addEventListener('focusin', function (ev) { var t = ev.target; if (panelOpen && t && !panel.contains(t) && t !== handle && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) closePanel(false); });
    window.addEventListener('hashchange', function () { closePanel(false); });
    window.addEventListener('resize', function () { if (panelOpen) place(); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { if (panelOpen) closePanel(false); });
  }

  /** Called by app.js for the center slot of the bottom bar. Returns the handle button (still one of the five items). */
  function navItem() { return createHandle(); }
  /** Called once after the bar exists: adds the panel to the page (replacing any earlier copy). */
  function mountPanel() {
    var old = document.getElementById('plus-panel'); if (old) old.remove();
    Array.prototype.forEach.call(document.querySelectorAll('.pp-backdrop'), function (n) { n.remove(); });
    buildPanel().forEach(function (n) { document.body.appendChild(n); });   // on the page itself, so the bottom bar's own link styles never touch it
  }

  /* ---------- unread totals shown on the panel and as a dot on the handle ---------- */
  var peekAt = 0;
  async function refreshTotals(force) {
    if (!enabled() || TOTALS.off || !X.S.user || !famId()) return;
    if (C && C.famId === famId()) { sumTotals(C.unread, C); return; }
    if (!force && Date.now() - peekAt < 60000) return;
    peekAt = Date.now();
    var fid = famId();
    try { var r = await api('chatUnread'); if (fid !== famId()) return; TOTALS.at = Date.now(); sumTotals(r.unread, null); }
    catch (e) { if (e && e.apiCode === 'server_error') TOTALS.off = true; /* chat not set up yet: stop asking */ }
  }
  function sumTotals(unread, ctl) {
    var ch = 0, dm = 0;
    Object.keys(unread || {}).forEach(function (id) { var u = unread[id] || {}; if (u.dm) dm += u.n || 0; else ch += u.n || 0; });
    TOTALS.ch = ch; TOTALS.dm = dm; paintBadges();
  }
  function startPeek() {
    setInterval(function () { if (!document.hidden) refreshTotals(false); }, 120000);
    setTimeout(function () { refreshTotals(true); }, 4000);
  }

  /* =====================================================================
   * Chat controller
   * ===================================================================== */
  function stop() {
    GEN++;
    if (C) {
      var c = C; C = null;
      c.listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2]); });
      Object.keys(c.timers).forEach(function (k) { clearTimeout(c.timers[k]); clearInterval(c.timers[k]); });
      try { if (c.sub) Promise.resolve(c.sub.unsubscribe ? c.sub.unsubscribe() : (typeof c.sub === 'function' ? c.sub() : null)).catch(function () {}); } catch (e) { /* closing */ }
      try { if (c.rt && c.rt.disconnect) Promise.resolve(c.rt.disconnect()).catch(function () {}); } catch (e) { /* closing */ }
      c.convs = {};   // message text is dropped from memory
    }
    document.body.classList.remove('chat-mode');
    document.documentElement.style.removeProperty('--vvh');
    closeSheets();
  }
  function listen(c, target, type, fn) { target.addEventListener(type, fn); c.listeners.push([target, type, fn]); }
  function later(c, key, ms, fn) { clearTimeout(c.timers[key]); c.timers[key] = setTimeout(function () { if (C === c) fn(); }, ms); }

  function begin() {
    if (C && C.famId === famId() && C.uid === me()) return C;
    stop();
    C = { gen: GEN, famId: famId(), uid: me(), loaded: false, error: null, role: 'member', channels: [], dms: [], unread: {}, blocked: [], allowDms: true, limits: { body: 1000 }, reactions: ['👍', '❤️', '😂', '😮', '😢', '🙏'],
      convs: {}, cur: null, route: { mode: 'channels', id: '' }, drafts: {}, listeners: [], timers: {}, sub: null, rt: null, loading: null, online: navigator.onLine !== false };
    return C;
  }

  async function loadOverview(c) {
    var r = await api('chatOpen');
    if (C !== c) return false;
    c.role = r.role; c.channels = r.channels; c.dms = r.dms; c.unread = r.unread; c.blocked = r.blocked; c.allowDms = r.allowDms; c.limits = r.limits || c.limits; c.reactions = r.reactions || c.reactions;
    c.loaded = true; c.error = null; c.at = Date.now();
    sumTotals(c.unread, c);
    return true;
  }
  function isManager(c) { return c.role === 'owner' || c.role === 'admin'; }
  function convOf(c, kind, id) { return c.convs[id] || (c.convs[id] = { kind: kind, id: id, msgs: [], react: new Map(), hasMore: false, cursor: null, ready: false, err: null, newCount: 0, divider: '', replyCache: {}, markedAt: '', gone: false }); }
  function channelById(c, id) { return c.channels.filter(function (x) { return x.id === id; })[0] || null; }
  function dmById(c, id) { return c.dms.filter(function (x) { return x.id === id; })[0] || null; }

  /* ---------- realtime ---------- */
  async function connect(c) {
    var A = window.Appwrite, base = 'tablesdb.' + dbId() + '.tables.';
    var chans = [base + 'chatMessages.rows', base + 'chatReactions.rows', base + 'chatChannels.rows', base + 'chatDms.rows'];
    try {
      if (A && A.Realtime) { c.rt = new A.Realtime(X.client); var sub = await c.rt.subscribe(chans, function (ev) { if (C === c) onEvent(c, ev); }); if (C !== c) { try { sub.unsubscribe(); } catch (e) { /* ok */ } return; } c.sub = sub; }
      else if (X.client && X.client.subscribe) c.sub = X.client.subscribe(chans, function (ev) { if (C === c) onEvent(c, ev); });
      else throw new Error('no realtime');
      c.live = true;
    } catch (e) {
      // Realtime is not available: fall back to checking for new messages every few seconds while a conversation is open.
      c.live = false; c.timers.poll = setInterval(function () { if (!document.hidden && C === c) catchUp(c); }, 8000);
    }
    function wake() { if (C !== c) return; c.online = navigator.onLine !== false; paintBanner(); if (c.online) { catchUp(c); heartbeat(c); } }
    listen(c, window, 'online', wake); listen(c, window, 'offline', wake);
    listen(c, document, 'visibilitychange', function () { if (document.visibilityState === 'visible') wake(); });
    c.timers.beat = setInterval(function () { if (!document.hidden && C === c) heartbeat(c); }, 5 * 60 * 1000);
  }
  /** Re-asks the server whether I am still a member. If not, everything chat-related is closed and cleared. */
  async function heartbeat(c) {
    try { var r = await api('chatUnread'); if (C !== c) return; c.unread = Object.assign({}, c.unread, r.unread); sumTotals(c.unread, c); paintList(); }
    catch (e) { if (C === c && e && (e.apiCode === 'forbidden' || e.code === 403 || e.code === 401)) { stop(); X.S.validatedAt = 0; toast('You are no longer a member of this family.'); location.hash = '#/home'; X.route(false); } }
  }
  function eventKind(ev) {
    var kinds = (ev.events || []).map(function (e) { var m = /\.(create|update|delete)$/.exec(e); return m ? m[1] : ''; }).filter(Boolean);
    return kinds[0] || '';
  }
  function onEvent(c, ev) {
    var p = ev.payload || {}, evs = (ev.events || []).join(' '), kind = eventKind(ev);
    if (!kind || p.familyId !== c.famId) return;                // another family's event is never used
    if (evs.indexOf('.chatMessages.') >= 0) return onMessageEvent(c, kind, p);
    if (evs.indexOf('.chatReactions.') >= 0) return onReactionEvent(c, kind, p);
    if (evs.indexOf('.chatChannels.') >= 0 || evs.indexOf('.chatDms.') >= 0) later(c, 'overview', 600, function () { reloadOverview(c); });
  }
  async function reloadOverview(c) {
    try { if (await loadOverview(c)) { paintAll(); } } catch (e) { /* the next event or heartbeat tries again */ }
  }
  function onMessageEvent(c, kind, row) {
    var cv = c.convs[row.convId];
    if (kind === 'create') {
      if (row.authorId !== c.uid && (!c.cur || c.cur.id !== row.convId || document.hidden)) {
        var u = c.unread[row.convId] || (c.unread[row.convId] = { n: 0, readAt: '', dm: row.kind === 'dm' }); u.n = Math.min(10, (u.n || 0) + 1);
        sumTotals(c.unread, c); paintList();
        if (!channelById(c, row.convId) && !dmById(c, row.convId)) later(c, 'overview', 600, function () { reloadOverview(c); });   // a brand-new DM
      }
    }
    if (!cv || !cv.ready) return;
    var mode = 'keep';
    if (kind === 'delete') { cv.msgs = cv.msgs.filter(function (m) { return m.$id !== row.$id; }); cv.react.delete(row.$id); }
    else {
      var atBottom = c.cur && c.cur.id === row.convId && nearBottom();
      var added = upsert(cv, row);
      if (kind === 'create' && added && c.cur && c.cur.id === row.convId) {
        if (atBottom || row.authorId === c.uid) { mode = 'bottom'; } else { cv.newCount += 1; }
      }
    }
    if (c.cur && c.cur.id === row.convId) { paintMessages(mode); maybeMarkRead(c); }
  }
  function onReactionEvent(c, kind, row) {
    var cv = c.convs[row.convId]; if (!cv || !cv.ready) return;
    if (kind === 'create') addReaction(cv, row); else if (kind === 'delete') removeReaction(cv, row);
    if (c.cur && c.cur.id === row.convId) paintMessages('keep');
  }
  function addReaction(cv, r) { var byEmoji = cv.react.get(r.messageId); if (!byEmoji) cv.react.set(r.messageId, byEmoji = new Map()); var set = byEmoji.get(r.emoji); if (!set) byEmoji.set(r.emoji, set = new Set()); set.add(r.userId); }
  function removeReaction(cv, r) { var byEmoji = cv.react.get(r.messageId); if (!byEmoji) return; var set = byEmoji.get(r.emoji); if (set) { set.delete(r.userId); if (!set.size) byEmoji.delete(r.emoji); } }

  /** Puts a server row into the list without ever showing it twice: by id, or by the clientId of my own optimistic copy. */
  function upsert(cv, row) {
    var i = cv.msgs.findIndex(function (m) { return m.$id === row.$id; });
    if (i >= 0) { cv.msgs[i] = row; return false; }
    var j = row.clientId ? cv.msgs.findIndex(function (m) { return m._local && m.clientId === row.clientId; }) : -1;
    if (j >= 0) { cv.msgs[j] = row; return true; }
    var k = cv.msgs.length;
    while (k > 0 && !cv.msgs[k - 1]._local && cmpRow(cv.msgs[k - 1], row) > 0) k--;
    cv.msgs.splice(k, 0, row);
    return true;
  }
  function cmpRow(a, b) { return a.$createdAt < b.$createdAt ? -1 : a.$createdAt > b.$createdAt ? 1 : (a.$id < b.$id ? -1 : 1); }

  /* ---------- reading messages (paginated) ---------- */
  function Q() { return X.Query; }
  async function fetchPage(cv, cursor) {
    var q = [Q().equal('convId', [cv.id]), Q().orderDesc('$createdAt'), Q().limit(PAGE)];
    if (cursor) q.push(Q().cursorAfter(cursor));
    var r = await X.db.listRows({ databaseId: dbId(), tableId: T.msg, queries: q });
    return r.rows;
  }
  async function fetchReactions(cv, ids) {
    for (var i = 0; i < ids.length; i += 25) {
      var chunk = ids.slice(i, i + 25), cursor = null;
      for (var page = 0; page < 5; page++) {
        var q = [Q().equal('messageId', chunk), Q().limit(100)]; if (cursor) q.push(Q().cursorAfter(cursor));
        var r = await X.db.listRows({ databaseId: dbId(), tableId: T.react, queries: q });
        r.rows.forEach(function (x) { addReaction(cv, x); });
        if (r.rows.length < 100) break; cursor = r.rows[r.rows.length - 1].$id;
      }
    }
  }
  async function openConv(c, kind, id) {
    var cv = convOf(c, kind, id);
    c.cur = cv; cv.err = null;
    if (!cv.ready) {
      paintConv();
      try {
        var rows = await fetchPage(cv, null);
        if (C !== c || c.cur !== cv) return;
        cv.msgs = rows.slice().reverse(); cv.hasMore = rows.length === PAGE; cv.cursor = rows.length ? rows[rows.length - 1].$id : null;
        await fetchReactions(cv, rows.map(function (r) { return r.$id; }));
        if (C !== c || c.cur !== cv) return;
        cv.ready = true;
        var u = c.unread[id] || { n: 0, readAt: '' };
        cv.divider = u.n > 0 ? u.readAt : '';
        cv.stickToDivider = !!cv.divider;
      } catch (e) { if (C === c) { cv.err = e; } }
    } else { cv.divider = cv.divider || ''; }
    if (C !== c || c.cur !== cv) return;
    paintConv();
    catchUp(c);
  }
  async function loadOlder(c, cv) {
    if (!cv.hasMore || cv.loadingOlder) return;
    cv.loadingOlder = true; paintMessages('keep');
    try {
      var rows = await fetchPage(cv, cv.cursor);
      if (C !== c) return;
      rows.slice().reverse().forEach(function (r) { upsert(cv, r); });
      cv.hasMore = rows.length === PAGE; if (rows.length) cv.cursor = rows[rows.length - 1].$id;
      await fetchReactions(cv, rows.map(function (r) { return r.$id; }));
    } catch (e) { toast(msgOf(e)); }
    cv.loadingOlder = false;
    if (C === c && c.cur === cv) paintMessages('prepend');
  }
  /** After a dropped connection or a long pause: fetch the newest page and merge it by id (no duplicates). */
  async function catchUp(c) {
    var cv = c.cur; if (!cv || !cv.ready) return;
    try {
      var rows = await fetchPage(cv, null);
      if (C !== c || c.cur !== cv) return;
      var atBottom = nearBottom();
      var ids = {}; rows.forEach(function (r) { ids[r.$id] = true; });
      rows.slice().reverse().forEach(function (r) { upsert(cv, r); });
      // messages that were deleted while I was offline
      var oldest = rows.length === PAGE ? rows[rows.length - 1].$createdAt : '';
      cv.msgs = cv.msgs.filter(function (m) { return m._local || ids[m.$id] || (oldest && m.$createdAt < oldest); });
      await fetchReactions(cv, rows.map(function (r) { return r.$id; }));
      paintMessages(atBottom ? 'bottom' : 'keep'); maybeMarkRead(c);
    } catch (e) { /* offline: the banner explains it, and the next wake-up tries again */ }
  }

  /* ---------- sending ---------- */
  function sendText(c, cv, text, replyToId) {
    var local = { $id: 'local:' + newClientId(), _local: true, _status: 'sending', convId: cv.id, authorId: c.uid, body: text, replyToId: replyToId || '', clientId: newClientId(), $createdAt: new Date().toISOString(), familyId: c.famId };
    cv.msgs.push(local); cv.newCount = 0;
    paintMessages('bottom');
    doSend(c, cv, local);
  }
  async function doSend(c, cv, local) {
    local._status = 'sending'; local._err = ''; paintMessages('keep');
    try {
      var r = await api('chatSend', { kind: cv.kind, convId: cv.id, body: local.body, clientId: local.clientId, replyToId: local.replyToId || undefined });
      if (C !== c) return;
      var m = r.message, row = { $id: m.id, convId: m.convId, authorId: m.authorId, body: m.body, replyToId: m.replyToId, clientId: m.clientId, editedAt: m.editedAt, $createdAt: m.createdAt, familyId: c.famId, kind: m.kind };
      var i = cv.msgs.indexOf(local);
      var already = cv.msgs.some(function (x) { return x.$id === row.$id; });   // realtime got there first
      if (i >= 0) { if (already) cv.msgs.splice(i, 1); else cv.msgs[i] = row; }
      else if (!already) upsert(cv, row);
    } catch (e) {
      local._status = 'failed'; local._err = e && e.apiCode === 'rate_limited' ? msgOf(e) : (navigator.onLine === false ? 'No connection.' : msgOf(e));
    }
    if (C === c && c.cur === cv) paintMessages('keep');
  }

  /* ---------- reading state ---------- */
  function newestServer(cv) { for (var i = cv.msgs.length - 1; i >= 0; i--) if (!cv.msgs[i]._local) return cv.msgs[i]; return null; }
  function maybeMarkRead(c) {
    var cv = c.cur; if (!cv || !cv.ready || document.hidden || !nearBottom()) return;
    var last = newestServer(cv); if (!last) return;
    if (cv.markedAt && cv.markedAt >= last.$createdAt) return;
    later(c, 'read:' + cv.id, 700, async function () {
      var last2 = newestServer(cv); if (!last2 || (cv.markedAt && cv.markedAt >= last2.$createdAt) || !nearBottom() || document.hidden) return;
      try { await api('chatMarkRead', { kind: cv.kind, convId: cv.id, at: last2.$createdAt }); cv.markedAt = last2.$createdAt; c.unread[cv.id] = { n: 0, readAt: last2.$createdAt, dm: cv.kind === 'dm' }; sumTotals(c.unread, c); paintList(); } catch (e) { /* tried again on the next scroll or message */ }
    });
  }

  /* =====================================================================
   * Drawing
   * ===================================================================== */
  var host = null;     // the .chat-app element
  var sheets = [];
  function closeSheets() { sheets.slice().forEach(function (d) { try { d.close(); } catch (e) { /* closed */ } if (d.parentNode) d.parentNode.removeChild(d); }); sheets = []; }
  function sheet(title, body, opts) {
    opts = opts || {};
    var dlg = h('dialog', { class: 'cs', 'aria-labelledby': 'cs-t' });
    var close = function () { try { dlg.close(); } catch (e) { /* ok */ } if (dlg.parentNode) dlg.parentNode.removeChild(dlg); sheets = sheets.filter(function (x) { return x !== dlg; }); if (opts.onClose) opts.onClose(); };
    dlg.appendChild(h('div', { class: 'cs-head' }, h('h2', { id: 'cs-t', text: title }), h('button', { class: 'btn secondary small', type: 'button', text: 'Close', 'aria-label': 'Close ' + title, onclick: close })));
    var inner = h('div', { class: 'cs-body' }); inner.appendChild(body); dlg.appendChild(inner);
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    document.body.appendChild(dlg); sheets.push(dlg); dlg.showModal();
    return { close: close, el: dlg, body: inner };
  }
  function listScroller() { return host && host.querySelector('.chat-list'); }
  function nearBottom() { var el = listScroller(); return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80; }

  function curTitle(c) {
    var cv = c.cur; if (!cv) return '';
    if (cv.kind === 'channel') { var ch = channelById(c, cv.id); return '# ' + (ch ? ch.name : 'channel'); }
    var d = dmById(c, cv.id); return d ? realName(d.otherId) : 'Direct message';
  }
  function famLabel() { return X.famName ? X.famName() : 'Family'; }

  function render(main) {
    var c = C; if (!c) return;
    document.body.classList.add('chat-mode'); setVV();
    clear(main);
    host = h('div', { class: 'chat-app' + (c.route.id ? ' has-conv' : '') + (c.route.mode === 'dms' ? ' mode-dms' : '') });
    main.appendChild(host);
    if (!c.loaded) {
      if (c.error) host.appendChild(errorBox(c));
      else host.appendChild(h('div', { class: 'empty' }, X.spinnerLine('Opening chat…', 'site')));
      return;
    }
    host.appendChild(buildRail(c));
    host.appendChild(buildSide(c));
    host.appendChild(h('section', { class: 'chat-conv', 'aria-label': 'Conversation' }));
    paintConv();
  }
  function convSig(c) {
    var cv = c.cur; if (!cv) return '-';
    var ch = cv.kind === 'channel' ? channelById(c, cv.id) : null, dm = cv.kind === 'dm' ? dmById(c, cv.id) : null;
    return [cv.id, ch ? [ch.name, ch.description, ch.readOnly, ch.archived].join('|') : '', dm ? [dm.status, c.blocked.indexOf(dm.otherId)].join('|') : '', c.role].join('~');
  }
  function paintAll() {
    if (!C || !host || !host.isConnected) return;
    var sc = host.querySelector('.chat-side'); if (sc) sc.replaceWith(buildSide(C));
    var rail = host.querySelector('.chat-rail'); if (rail) rail.replaceWith(buildRail(C));
    var sig = convSig(C);
    if (host._sig !== sig) { host._sig = sig; paintConv(); }          // the conversation itself is only redrawn when its rules changed, so typing is never interrupted
  }
  function paintList() { if (!C || !host || !host.isConnected) return; var sc = host.querySelector('.chat-side'); if (sc) { var top = sc.querySelector('.side-scroll'); var t = top ? top.scrollTop : 0; var ns = buildSide(C); sc.replaceWith(ns); var nt = ns.querySelector('.side-scroll'); if (nt) nt.scrollTop = t; } }

  function errorBox(c) {
    var e = c.error, denied = e && (e.apiCode === 'forbidden' || e.code === 403);
    var msg = denied ? 'You are not a member of this family, so chat is not available.' : (e && e.apiCode === 'server_error' ? 'Chat is not ready yet. The family owner needs to finish the chat setup (see CHAT-GUIDE.md), then try again.' : msgOf(e));
    return h('div', { class: 'chat-empty' }, X.alertBox('error', msg), h('div', { class: 'row' },
      denied ? h('a', { class: 'btn', href: '#/home', text: 'Back to Home' }) : h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: function () { retryOpen(c); } }), h('a', { class: 'btn secondary', href: '#/home', text: 'Home' })));
  }
  async function retryOpen(c) { c.error = null; render(X.S.main); try { await loadOverview(c); } catch (e) { c.error = e; } if (C === c) { render(X.S.main); if (c.loaded) startConv(c); } }

  /* ----- family switcher ----- */
  function famInitial(f) { return (f.name || '?').trim().charAt(0).toUpperCase() || '?'; }
  function buildRail(c) {
    var rail = h('nav', { class: 'chat-rail', 'aria-label': 'Your families' });
    X.S.families.forEach(function (f) {
      var on = f.id === famId();
      rail.appendChild(h('button', { class: 'rail-btn' + (on ? ' on' : ''), type: 'button', title: f.name, 'aria-label': f.name + (on ? ' (current family)' : ''), 'aria-current': on ? 'true' : null, onclick: function () { if (!on) switchFamilyTo(f.id); } }, famInitial(f)));
    });
    return rail;
  }
  async function switchFamilyTo(id) {
    var target = c0hash();
    closeSheets(); stop();                         // old family's messages, subscription and timers are gone before the new one loads
    await X.switchFamily(id);
    location.hash = target;
  }
  function c0hash() { return /^#\/dms/.test(location.hash) ? '#/dms' : '#/chat'; }
  function familySheet() {
    var list = h('div', { class: 'cs-list' });
    X.S.families.forEach(function (f) {
      var on = f.id === famId();
      list.appendChild(h('button', { class: 'cs-row' + (on ? ' on' : ''), type: 'button', 'aria-current': on ? 'true' : null, onclick: function () { s.close(); if (!on) switchFamilyTo(f.id); } },
        h('span', { class: 'rail-btn mini' + (on ? ' on' : ''), 'aria-hidden': 'true' }, famInitial(f)), h('span', { class: 'grow', text: f.name }), on ? h('span', { class: 'badge', text: 'Current' }) : null));
    });
    var s = sheet('Your families', list);
  }

  /* ----- side panel: channels and direct messages ----- */
  function unreadPill(n) { return n > 0 ? h('span', { class: 'unread', 'aria-label': n + ' unread', text: n > 9 ? '9+' : String(n) }) : null; }
  function buildSide(c) {
    var side = h('aside', { class: 'chat-side', 'aria-label': 'Channels and direct messages' });
    var multi = X.S.families.length > 1;
    side.appendChild(h('div', { class: 'side-head' },
      h('a', { class: 'btn secondary small only-narrow', href: '#/home', 'aria-label': 'Back to Home' }, icon('back')),
      h('button', { class: 'fam-btn', type: 'button', 'aria-label': 'Family: ' + famLabel() + (multi ? '. Switch family' : ''), disabled: multi ? null : true, onclick: familySheet }, h('strong', { text: famLabel() }), multi ? icon('more') : null),
      h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Chat settings', onclick: function () { settingsSheet(c); } }, icon('gear'))));
    side.appendChild(h('div', { class: 'tabs only-narrow', role: 'tablist' },
      h('a', { class: 'tab', role: 'tab', 'aria-selected': c.route.mode === 'channels' ? 'true' : 'false', href: '#/chat', text: 'Channels' + (TOTALS.ch ? ' (' + (TOTALS.ch > 9 ? '9+' : TOTALS.ch) + ')' : '') }),
      h('a', { class: 'tab', role: 'tab', 'aria-selected': c.route.mode === 'dms' ? 'true' : 'false', href: '#/dms', text: 'Direct messages' + (TOTALS.dm ? ' (' + (TOTALS.dm > 9 ? '9+' : TOTALS.dm) + ')' : '') })));
    var sc = h('div', { class: 'side-scroll' }); side.appendChild(sc);
    var showCh = wide() || c.route.mode === 'channels', showDm = wide() || c.route.mode === 'dms';
    if (showCh) {
      sc.appendChild(h('h2', { class: 'side-h', text: 'Text channels' }));
      var active = c.channels.filter(function (x) { return !x.archived; }), arch = c.channels.filter(function (x) { return x.archived; });
      active.forEach(function (ch) {
        var on = c.cur && c.cur.id === ch.id, n = (c.unread[ch.id] || {}).n || 0;
        sc.appendChild(h('a', { class: 'side-item' + (on ? ' on' : '') + (n ? ' has-unread' : ''), href: '#/chat/' + ch.id, 'aria-current': on ? 'page' : null, title: ch.description },
          h('span', { class: 'hash', 'aria-hidden': 'true', text: '#' }), h('span', { class: 'grow', text: ch.name }), ch.readOnly ? h('span', { class: 'ro', title: 'Only owners and chat admins can post', 'aria-label': 'read-only' }, icon('lock')) : null, unreadPill(n)));
      });
      if (arch.length) {
        var det = h('details', { class: 'arch' }, h('summary', { text: 'Archived channels (' + arch.length + ')' }));
        arch.forEach(function (ch) { var on = c.cur && c.cur.id === ch.id; det.appendChild(h('a', { class: 'side-item dim' + (on ? ' on' : ''), href: '#/chat/' + ch.id, 'aria-current': on ? 'page' : null }, h('span', { class: 'hash', 'aria-hidden': 'true', text: '#' }), h('span', { class: 'grow', text: ch.name }))); });
        sc.appendChild(det);
      }
      sc.appendChild(h('div', { class: 'row side-actions' }, h('button', { class: 'btn secondary small', type: 'button', text: 'Family members', onclick: function () { membersSheet(c); } }), isManager(c) ? h('button', { class: 'btn secondary small', type: 'button', text: 'Manage channels', onclick: function () { channelsSheet(c); } }) : null));
    }
    if (showDm) {
      sc.appendChild(h('h2', { class: 'side-h', text: 'Direct messages' }));
      sc.appendChild(h('button', { class: 'btn secondary small new-dm', type: 'button', text: 'New message', onclick: function () { newDmSheet(c); } }));
      if (!c.dms.length) sc.appendChild(h('p', { class: 'muted small pad', text: 'No direct messages yet. Start one with someone in ' + famLabel() + '.' }));
      c.dms.forEach(function (d) {
        var on = c.cur && c.cur.id === d.id, n = (c.unread[d.id] || {}).n || 0;
        sc.appendChild(h('a', { class: 'side-item' + (on ? ' on' : '') + (n ? ' has-unread' : ''), href: '#/dms/' + d.id, 'aria-current': on ? 'page' : null },
          avatar(d.otherId, 'sm'), h('span', { class: 'grow' }, h('span', { text: realName(d.otherId) }), d.status !== 'open' ? h('span', { class: 'small muted', text: ' · closed' }) : null), unreadPill(n)));
      });
      sc.appendChild(h('p', { class: 'small muted pad', text: 'Direct messages are private to the two people in them. Owners and chat admins cannot read them.' }));
    }
    return side;
  }

  /* ----- conversation ----- */
  function paintConv(keepScroll) {
    var c = C; if (!c || !host || !host.isConnected) return;
    var pane = host.querySelector('.chat-conv'); if (!pane) return;
    clear(pane);
    var cv = c.cur;
    host.classList.toggle('has-conv', !!c.route.id);
    if (!cv) {
      pane.appendChild(h('div', { class: 'chat-empty' }, h('p', { class: 'muted', text: c.route.mode === 'dms' ? 'Choose a conversation, or start a new one.' : 'Choose a channel to start reading.' })));
      return;
    }
    var title = curTitle(c), ch = cv.kind === 'channel' ? channelById(c, cv.id) : null, dm = cv.kind === 'dm' ? dmById(c, cv.id) : null;
    var sub = ch ? (ch.description || '') : (dm ? 'Direct message · only you and ' + realName(dm.otherId) + ' can read this' : '');
    var head = h('header', { class: 'conv-head' },
      h('a', { class: 'btn secondary small only-narrow', href: c.route.mode === 'dms' ? '#/dms' : '#/chat', 'aria-label': 'Back to ' + (c.route.mode === 'dms' ? 'direct messages' : 'channels') }, icon('back')),
      dm ? avatar(dm.otherId, 'sm') : null,
      h('div', { class: 'grow ct' }, h('h1', { text: title }), h('div', { class: 'small muted clamp', text: (dm ? '' : famLabel() + ' · ') + sub })),
      dm ? h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Conversation options', onclick: function () { dmOptions(c, dm); } }, icon('more')) : h('button', { class: 'btn secondary small', type: 'button', text: 'Members', onclick: function () { membersSheet(c); } }));
    pane.appendChild(head);
    pane.appendChild(h('div', { class: 'chat-banner', id: 'chat-banner', hidden: true, role: 'status' }));
    var list = h('div', { class: 'chat-list', id: 'chat-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages in ' + title, tabindex: '0' });
    pane.appendChild(list);
    var jump = h('button', { class: 'btn small jump', id: 'chat-jump', type: 'button', hidden: true, onclick: function () { cv.newCount = 0; scrollBottom(); paintJump(); maybeMarkRead(c); } });
    pane.appendChild(jump);
    pane.appendChild(buildComposer(c, cv, ch, dm));
    var st = null; list.addEventListener('scroll', function () { if (st) return; st = setTimeout(function () { st = null; paintJump(); if (nearBottom()) { cv.newCount = 0; maybeMarkRead(c); } if (list.scrollTop < 60 && cv.hasMore && cv.ready) loadOlder(c, cv); }, 120); });
    paintBanner();
    paintMessages(cv.ready ? (cv.stickToDivider ? 'divider' : 'bottom') : 'keep');
    cv.stickToDivider = false;
    if (cv.ready) maybeMarkRead(c);
  }
  function scrollBottom() { var el = listScroller(); if (el) el.scrollTop = el.scrollHeight; }
  function paintJump() {
    var c = C, cv = c && c.cur, b = document.getElementById('chat-jump'); if (!b || !cv) return;
    var far = !nearBottom();
    b.hidden = !(far || cv.newCount);
    b.textContent = cv.newCount ? (cv.newCount === 1 ? '1 new message' : cv.newCount + ' new messages') + ' ↓' : 'Jump to latest ↓';
  }
  function paintBanner() {
    var b = document.getElementById('chat-banner'); if (!b || !C) return;
    if (C.online === false || navigator.onLine === false) { b.hidden = false; b.textContent = 'You are offline. Messages will show up again when the connection returns. Unsent messages can be retried.'; }
    else b.hidden = true;
  }

  function msgText(m) { return h('div', { class: 'msg-text', text: m.body }); }
  function replyPreview(c, cv, m) {
    var id = m.replyToId; if (!id) return null;
    var t = cv.msgs.filter(function (x) { return x.$id === id; })[0] || cv.replyCache[id];
    var box = h('button', { class: 'msg-reply', type: 'button', 'aria-label': 'Go to the message being replied to' });
    if (t === undefined) { fetchReply(c, cv, id); box.appendChild(h('span', { class: 'muted', text: 'Loading reply…' })); }
    else if (t === null) { box.disabled = true; box.appendChild(h('span', { class: 'muted', text: 'The original message was deleted.' })); }
    else { box.appendChild(h('strong', { text: realName(t.authorId) })); box.appendChild(h('span', { class: 'clamp', text: ' ' + t.body })); box.addEventListener('click', function () { var el = document.querySelector('[data-mid="' + t.$id + '"]'); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1200); } else toast('That message is further back. Scroll up to load older messages.'); }); }
    return box;
  }
  async function fetchReply(c, cv, id) {
    if (cv.replyCache[id] !== undefined || cv.fetching && cv.fetching[id]) return;
    (cv.fetching = cv.fetching || {})[id] = true;
    try { cv.replyCache[id] = await X.db.getRow({ databaseId: dbId(), tableId: T.msg, rowId: id }); }
    catch (e) { cv.replyCache[id] = e && e.code === 404 ? null : null; }
    if (C === c && c.cur === cv) paintMessages('keep');
  }
  function reactionRow(c, cv, m) {
    var by = cv.react.get(m.$id); if (!by || !by.size) return null;
    var row = h('div', { class: 'msg-reacts' });
    c.reactions.forEach(function (e) { var set = by.get(e); if (!set || !set.size) return; var mine = set.has(c.uid);
      row.appendChild(h('button', { class: 'react' + (mine ? ' mine' : ''), type: 'button', 'aria-pressed': mine ? 'true' : 'false', 'aria-label': e + ' ' + set.size + (set.size === 1 ? ' person' : ' people') + (mine ? ', including you' : ''), onclick: function () { react(c, cv, m, e); } }, e + ' ' + set.size)); });
    return row;
  }
  function messageNode(c, cv, m, grouped) {
    var mine = m.authorId === c.uid;
    var node = h('div', { class: 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '') + (m._local ? ' local' : ''), 'data-mid': m.$id });
    node.appendChild(grouped ? h('span', { class: 'av-spacer', 'aria-hidden': 'true' }) : avatar(m.authorId, 'sm'));
    var main = h('div', { class: 'msg-main' });
    if (!grouped) main.appendChild(h('div', { class: 'msg-head' }, h('strong', { text: realName(m.authorId) }), h('time', { datetime: m.$createdAt, class: 'small muted', text: ' ' + timeText(m.$createdAt) })));
    var rp = replyPreview(c, cv, m); if (rp) main.appendChild(rp);
    var body = h('div', { class: 'msg-bubble', title: fullTime(m.$createdAt) }, msgText(m));
    if (m.editedAt) body.appendChild(h('span', { class: 'msg-edited small muted', title: 'Edited ' + fullTime(m.editedAt), text: ' (edited)' }));
    main.appendChild(body);
    var rr = reactionRow(c, cv, m); if (rr) main.appendChild(rr);
    if (m._local) {
      if (m._status === 'sending') main.appendChild(h('div', { class: 'msg-status small muted', role: 'status', text: 'Sending…' }));
      else main.appendChild(h('div', { class: 'msg-status small failed', role: 'alert' }, 'Not sent. ' + (m._err || ''), ' ',
        h('button', { class: 'link-btn', type: 'button', text: 'Retry', onclick: function () { doSend(c, cv, m); } }), ' · ', h('button', { class: 'link-btn', type: 'button', text: 'Remove', onclick: function () { cv.msgs = cv.msgs.filter(function (x) { return x !== m; }); paintMessages('keep'); } })));
    } else {
      if (grouped) body.setAttribute('title', fullTime(m.$createdAt));
      node.appendChild(main);
      node.appendChild(h('button', { class: 'msg-more', type: 'button', 'aria-label': 'Message actions for ' + realName(m.authorId) + ' at ' + timeText(m.$createdAt), onclick: function () { messageMenu(c, cv, m); } }, icon('more')));
      return node;
    }
    node.appendChild(main);
    return node;
  }
  /** Redraws the message list. mode: keep (stay where you are), bottom (go to newest), prepend (older messages were added above), divider (open at the "New messages" line). */
  function paintMessages(mode) {
    var c = C, cv = c && c.cur, list = listScroller(); if (!cv || !list) return;
    var prevH = list.scrollHeight, prevTop = list.scrollTop, wasBottom = nearBottom();
    clear(list);
    if (cv.err) { list.appendChild(h('div', { class: 'chat-empty' }, X.alertBox('error', cv.err.code === 404 || cv.err.code === 401 ? 'You do not have access to this conversation.' : msgOf(cv.err)), h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: function () { cv.err = null; cv.ready = false; openConv(c, cv.kind, cv.id); } }))); return; }
    if (!cv.ready) { list.appendChild(h('div', { class: 'chat-empty' }, X.spinnerLine('Loading messages…', 'site'))); return; }
    if (cv.hasMore) list.appendChild(h('div', { class: 'older' }, h('button', { class: 'btn secondary small', type: 'button', disabled: cv.loadingOlder ? true : null, text: cv.loadingOlder ? 'Loading…' : 'Load older messages', onclick: function () { loadOlder(c, cv); } })));
    else {
      var wch = cv.kind === 'channel' ? channelById(c, cv.id) : null, wdm = cv.kind === 'dm' ? dmById(c, cv.id) : null;
      if (wch) list.appendChild(h('div', { class: 'welcome' }, h('div', { class: 'welcome-ic', 'aria-hidden': 'true', text: '#' }), h('h2', { text: 'Welcome to #' + wch.name + '!' }), h('p', { class: 'muted', text: 'This is the start of the #' + wch.name + ' channel.' + (wch.description ? ' ' + wch.description : '') })));
      else if (wdm) list.appendChild(h('div', { class: 'welcome' }, avatar(wdm.otherId, 'sm'), h('h2', { text: realName(wdm.otherId) }), h('p', { class: 'muted', text: 'This is the start of your direct message history with ' + realName(wdm.otherId) + '. Only the two of you can read it.' })));
    }
    if (!cv.msgs.length) {
      var ch = cv.kind === 'channel' ? channelById(c, cv.id) : null;
      list.appendChild(h('div', { class: 'chat-empty' }, h('p', { class: 'muted', text: ch ? 'No messages in #' + ch.name + ' yet. ' + (ch.readOnly && !isManager(c) ? 'Only owners and chat admins can post here.' : 'Say hello!') : 'No messages yet. Say hello!' })));
    }
    var prev = null, dividerNode = null, dividerDone = !cv.divider, afterDivider = false;
    cv.msgs.forEach(function (m) {
      var newDay = !prev || dayKey(prev.$createdAt) !== dayKey(m.$createdAt);
      if (newDay) list.appendChild(h('div', { class: 'day-sep', role: 'separator' }, h('span', { text: dayText(m.$createdAt) })));
      afterDivider = false;
      if (!dividerDone && m.authorId !== c.uid && !m._local && m.$createdAt > cv.divider) { dividerNode = h('div', { class: 'new-sep', role: 'separator' }, h('span', { text: 'New messages' })); list.appendChild(dividerNode); dividerDone = true; afterDivider = true; }
      var grouped = !!prev && !newDay && !afterDivider && prev.authorId === m.authorId && !m.replyToId && (new Date(m.$createdAt) - new Date(prev.$createdAt)) < GROUP_MS;
      list.appendChild(messageNode(c, cv, m, grouped)); prev = m;
    });
    if (mode === 'bottom' || (mode === 'keep' && wasBottom)) list.scrollTop = list.scrollHeight;
    else if (mode === 'divider') { if (dividerNode) list.scrollTop = Math.max(0, dividerNode.offsetTop - 60); else list.scrollTop = list.scrollHeight; }
    else if (mode === 'prepend') list.scrollTop = list.scrollHeight - prevH + prevTop;
    else list.scrollTop = prevTop;
    paintJump();
  }

  /* ----- composer ----- */
  function buildComposer(c, cv, ch, dm) {
    var wrap = h('div', { class: 'composer-wrap' });
    var blocked = dm && c.blocked.indexOf(dm.otherId) >= 0;
    var reason = '';
    if (ch && ch.archived) reason = 'This channel is archived. Its messages are kept and can be read, but nobody can post until an owner or chat admin restores it.';
    else if (ch && ch.readOnly && !isManager(c)) reason = 'Only the family owner and chat admins can post in #' + ch.name + '.';
    else if (dm && dm.status !== 'open') reason = realName(dm.otherId) + ' is no longer in this family, so this conversation is closed. You can still read it.';
    else if (blocked) reason = 'You blocked ' + realName(dm.otherId) + '. Unblock them from the ⋯ menu to send messages.';
    if (reason) { wrap.appendChild(h('p', { class: 'composer-note', role: 'note', text: reason })); return wrap; }
    var reply = null, replyBar = h('div', { class: 'replybar', hidden: true });
    var ta = h('textarea', { rows: 1, maxlength: c.limits.body, 'aria-label': 'Message ' + (ch ? '#' + ch.name : realName(dm.otherId)), placeholder: 'Message ' + (ch ? '#' + ch.name : realName(dm.otherId)), enterkeyhint: 'send', autocomplete: 'off' });
    ta.value = c.drafts[cv.id] || '';
    var count = h('div', { class: 'small muted count', hidden: true, 'aria-live': 'off' });
    var send = h('button', { class: 'btn ghost send-btn', type: 'submit', 'aria-label': 'Send message' }, icon('send'));
    function grow() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; var n = ta.value.length; count.hidden = n < c.limits.body - 150; count.textContent = n + ' / ' + c.limits.body; c.drafts[cv.id] = ta.value; send.disabled = !ta.value.trim(); }
    function setReply(m) { reply = m; replyBar.hidden = !m; clear(replyBar); if (m) { replyBar.appendChild(h('span', { class: 'clamp' }, 'Replying to ', h('strong', { text: realName(m.authorId) }), ': ' + m.body)); replyBar.appendChild(h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Cancel reply', text: '×', onclick: function () { setReply(null); ta.focus(); } })); ta.focus(); } }
    cv.setReply = setReply;
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && isFine()) { ev.preventDefault(); form.requestSubmit(); } });
    var form = h('form', { class: 'composer', onsubmit: function (ev) {
      ev.preventDefault(); var t = ta.value.trim(); if (!t) return;
      if (t.length > c.limits.body) { toast('Messages can be up to ' + c.limits.body + ' characters.'); return; }
      sendText(c, cv, t, reply ? reply.$id : ''); ta.value = ''; c.drafts[cv.id] = ''; setReply(null); grow(); ta.focus();
    } }, replyBar, h('div', { class: 'composer-row' }, ta, send), count);
    wrap.appendChild(form); grow();
    return wrap;
  }

  /* ----- message menu: reactions, reply, edit, delete ----- */
  function messageMenu(c, cv, m) {
    var ch = cv.kind === 'channel' ? channelById(c, cv.id) : null, dm = cv.kind === 'dm' ? dmById(c, cv.id) : null;
    var open = ch ? !ch.archived : (dm ? dm.status === 'open' : false);
    var mine = m.authorId === c.uid, body = h('div', { class: 'cs-list' });
    var s;
    body.appendChild(h('div', { class: 'quote' }, h('strong', { text: realName(m.authorId) }), h('div', { class: 'clamp3', text: m.body })));
    if (open) {
      var row = h('div', { class: 'emoji-row', role: 'group', 'aria-label': 'React' });
      c.reactions.forEach(function (e) { var on = cv.react.get(m.$id) && cv.react.get(m.$id).get(e) && cv.react.get(m.$id).get(e).has(c.uid); row.appendChild(h('button', { class: 'emoji' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': 'React ' + e, text: e, onclick: function () { s.close(); react(c, cv, m, e); } })); });
      body.appendChild(row);
      body.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: function () { s.close(); if (cv.setReply) cv.setReply(m); } }, h('span', { class: 'grow', text: 'Reply' })));
    }
    if (mine && open) body.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: function () { s.close(); editMessage(c, cv, m); } }, h('span', { class: 'grow', text: 'Edit' })));
    if (mine) body.appendChild(h('button', { class: 'cs-row danger-text', type: 'button', onclick: function () { s.close(); deleteMessage(c, cv, m, false); } }, h('span', { class: 'grow', text: 'Delete' })));
    else if (cv.kind === 'channel' && isManager(c)) body.appendChild(h('button', { class: 'cs-row danger-text', type: 'button', onclick: function () { s.close(); deleteMessage(c, cv, m, true); } }, h('span', { class: 'grow', text: 'Remove as ' + (c.role === 'owner' ? 'family owner' : 'chat admin') })));
    body.appendChild(h('p', { class: 'small muted', text: 'Sent ' + fullTime(m.$createdAt) + (m.editedAt ? ' · edited ' + fullTime(m.editedAt) : '') }));
    s = sheet('Message', body);
  }
  async function react(c, cv, m, emoji) {
    // The change shows when the server confirms it (it arrives by realtime, or from this answer if realtime is off).
    try {
      var r = await api('chatReact', { messageId: m.$id, emoji: emoji });
      if (C !== c) return;
      var fake = { messageId: m.$id, userId: c.uid, emoji: emoji, convId: cv.id };
      if (r.on) addReaction(cv, fake); else removeReaction(cv, fake);
      if (c.cur === cv) paintMessages('keep');
    } catch (e) { toast(msgOf(e)); }
  }
  function editMessage(c, cv, m) {
    X.textDialog('Edit message', m.body, 'Save', { multiline: true, max: c.limits.body, aria: 'Message text' }, async function (v) {
      var t = String(v || '').trim(); if (!t) throw new Error('A message cannot be empty. Use Delete to remove it.');
      var r = await api('chatEdit', { messageId: m.$id, body: t });
      if (C !== c) return;
      m.body = r.message.body; m.editedAt = r.message.editedAt; if (c.cur === cv) paintMessages('keep');
    });
  }
  async function deleteMessage(c, cv, m, moderated) {
    var ok = await X.confirmDialog(moderated ? 'Remove this message?' : 'Delete this message?',
      moderated ? 'It will be removed for everyone in this channel. A short record (who removed a message, where and when, never the message itself) is kept for the family owner and chat admins.' : 'It will be deleted for everyone in this conversation. This cannot be undone.',
      moderated ? 'Remove message' : 'Delete message');
    if (!ok) return;
    try {
      await api('chatDelete', { messageId: m.$id });
      if (C !== c) return;
      cv.msgs = cv.msgs.filter(function (x) { return x.$id !== m.$id; }); cv.react.delete(m.$id);
      if (c.cur === cv) paintMessages('keep'); toast(moderated ? 'Message removed.' : 'Message deleted.');
    } catch (e) { toast(msgOf(e)); }
  }

  /* ----- members, new DM, DM options ----- */
  function memberList(c) { return Array.from(X.S.profiles.values()).sort(function (a, b) { return String(a.displayName).localeCompare(String(b.displayName)); }); }
  async function owners(c) {
    try { var res = await X.teams.listMemberships({ teamId: c.famId, queries: [X.Query.limit(100)] }); var o = {}; res.memberships.forEach(function (m) { if (m.confirm && m.roles.indexOf('owner') >= 0) o[m.userId] = true; }); return o; } catch (e) { return {}; }
  }
  async function membersSheet(c) {
    var body = h('div', { class: 'cs-list' }, X.spinnerLine('Loading…', 'site')); var s = sheet('Family members', body);
    var own = await owners(c); if (C !== c) return;
    clear(body);
    body.appendChild(h('p', { class: 'small muted', text: 'Everyone here can read the family channels. Roles only matter for chat: the family owner and chat admins manage channels, post in read-only channels and can remove messages from shared channels. They cannot read direct messages.' }));
    memberList(c).forEach(function (p) {
      var isMe = p.userId === c.uid, role = own[p.userId] ? 'Owner' : (p.chatAdmin === true ? 'Chat admin' : '');
      var row = h('div', { class: 'cs-member' }, avatar(p.userId, 'sm'), h('div', { class: 'grow' }, h('strong', { text: p.displayName + (isMe ? ' (you)' : '') }), role ? h('span', { class: 'badge', text: ' ' + role }) : null));
      if (!isMe) row.appendChild(h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Message ' + p.displayName, text: 'Message', onclick: function () { s.close(); startDm(c, p.userId); } }));
      if (c.role === 'owner' && !own[p.userId]) row.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: p.chatAdmin === true ? 'Remove chat admin' : 'Make chat admin', onclick: async function (ev) {
        var b = ev.currentTarget; b.disabled = true;
        try { var r = await api('chatSetAdmin', { userId: p.userId, admin: p.chatAdmin !== true }); p.chatAdmin = r.admin; toast(r.admin ? p.displayName + ' is now a chat admin.' : 'Chat admin removed.'); s.close(); membersSheet(c); } catch (e) { toast(msgOf(e)); b.disabled = false; }
      } }));
      body.appendChild(row);
    });
  }
  function newDmSheet(c) {
    var body = h('div'), list = h('div', { class: 'cs-list' }), msg = h('div');
    var q = h('input', { type: 'search', 'aria-label': 'Search family members', placeholder: 'Search members', autocomplete: 'off' });
    function draw() { clear(list); var t = q.value.trim().toLowerCase(); memberList(c).filter(function (p) { return p.userId !== c.uid && (!t || String(p.displayName).toLowerCase().indexOf(t) >= 0); }).forEach(function (p) {
      list.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: async function () { try { await startDm(c, p.userId, s); } catch (e) { X.showAlert(msg, 'error', msgOf(e)); } } }, avatar(p.userId, 'sm'), h('span', { class: 'grow', text: p.displayName }))); });
      if (!list.firstChild) list.appendChild(h('p', { class: 'muted small', text: 'No one else in this family matches.' })); }
    q.addEventListener('input', draw); body.appendChild(h('p', { class: 'small muted', text: 'Only members of ' + famLabel() + ' are listed. This conversation will belong to this family.' })); body.appendChild(q); body.appendChild(msg); body.appendChild(list); draw();
    var s = sheet('New message', body);
  }
  async function startDm(c, uid, s) {
    var r = await api('chatDmStart', { userId: uid });
    if (s) s.close();
    if (C !== c) return;
    if (!dmById(c, r.dm.id)) c.dms.unshift(r.dm);
    location.hash = '#/dms/' + r.dm.id;
  }
  function dmOptions(c, dm) {
    var blocked = c.blocked.indexOf(dm.otherId) >= 0, name = realName(dm.otherId);
    var body = h('div', { class: 'cs-list' },
      h('p', { class: 'small muted', text: 'This is a private conversation between you and ' + name + ' in ' + famLabel() + '. Only the two of you can read it. It is not end-to-end encrypted: Appwrite, where your family data is stored, can technically access stored data.' }),
      h('button', { class: 'cs-row' + (blocked ? '' : ' danger-text'), type: 'button', onclick: async function () {
        if (!blocked) { var ok = await X.confirmDialog('Block ' + name + '?', name + ' will not be able to send you direct messages in ' + famLabel() + ', and will not be told you blocked them. You can unblock them any time in chat settings or here.', 'Block'); if (!ok) return; }
        s.close(); setBlock(c, dm.otherId, !blocked); } }, h('span', { class: 'grow', text: blocked ? 'Unblock ' + name : 'Block ' + name })));
    var s = sheet('Conversation options', body);
  }
  async function setBlock(c, uid, on) {
    try { await api('chatBlock', { userId: uid, blocked: on }); if (C !== c) return; var i = c.blocked.indexOf(uid); if (on && i < 0) c.blocked.push(uid); if (!on && i >= 0) c.blocked.splice(i, 1); toast(on ? 'Blocked.' : 'Unblocked.'); paintAll(); } catch (e) { toast(msgOf(e)); }
  }

  /* ----- settings ----- */
  function settingsSheet(c) {
    var body = h('div', { class: 'cs-list' });
    var allow = h('input', { type: 'checkbox', id: 'cs-allow' }); allow.checked = c.allowDms;
    allow.addEventListener('change', async function () { try { await api('chatBlock', { userId: '*', blocked: !allow.checked }); c.allowDms = allow.checked; toast(allow.checked ? 'Family members can message you again.' : 'Direct messages from family members are turned off.'); } catch (e) { allow.checked = c.allowDms; toast(msgOf(e)); } });
    body.appendChild(h('h3', { text: 'Direct messages in ' + famLabel() }));
    body.appendChild(h('label', { class: 'check' }, allow, ' Let family members start and continue direct messages with me'));
    body.appendChild(h('p', { class: 'small muted', text: 'Turning this off stops new messages from everyone in this family. People are not told. Your existing history stays readable to you.' }));
    body.appendChild(h('h3', { text: 'People you blocked' }));
    if (!c.blocked.length) body.appendChild(h('p', { class: 'small muted', text: 'No one.' }));
    c.blocked.forEach(function (uid) { body.appendChild(h('div', { class: 'cs-member' }, avatar(uid, 'sm'), h('span', { class: 'grow', text: realName(uid) }), h('button', { class: 'btn secondary small', type: 'button', text: 'Unblock', 'aria-label': 'Unblock ' + realName(uid), onclick: function () { s.close(); setBlock(c, uid, false); } }))); });
    if (isManager(c)) {
      body.appendChild(h('h3', { text: c.role === 'owner' ? 'Family owner tools' : 'Chat admin tools' }));
      body.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: function () { s.close(); channelsSheet(c); } }, h('span', { class: 'grow', text: 'Manage channels' })));
      body.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: function () { s.close(); modSheet(c); } }, h('span', { class: 'grow', text: 'Moderation record' })));
      if (c.role === 'owner') body.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: function () { s.close(); membersSheet(c); } }, h('span', { class: 'grow', text: 'Choose chat admins' })));
    }
    var det = h('details', { class: 'privacy' }, h('summary', { text: 'How chat privacy works' }),
      h('p', { class: 'small', text: 'Channels can be read by everyone currently in ' + famLabel() + '. If someone is removed from the family they can no longer read or post in its channels.' }),
      h('p', { class: 'small', text: 'Direct messages belong to this family and to two people. Only those two can read them. The family owner, chat admins and tree admins cannot. If one of the two leaves or is removed, the conversation closes: the person who left loses access and the other person keeps the history, read-only.' }),
      h('p', { class: 'small', text: 'Messages are protected by access rules and are sent over an encrypted connection, but they are not end-to-end encrypted. Chat is for family conversation, not for passwords or card numbers.' }));
    body.appendChild(det);
    var s = sheet('Chat settings', body);
  }

  /* ----- channel management (owner and chat admins) ----- */
  function channelsSheet(c) {
    var body = h('div'), msg = h('div'), list = h('div', { class: 'cs-list' });
    body.appendChild(h('p', { class: 'small muted', text: 'Channels are visible to everyone in ' + famLabel() + '. Archiving hides a channel from the list and stops posting, but keeps every message, which stays readable under "Archived channels". Nothing here deletes messages.' }));
    body.appendChild(msg);
    body.appendChild(h('button', { class: 'btn small', type: 'button', text: 'New channel', onclick: function () { channelForm(c, null, redraw); } }));
    body.appendChild(list);
    function redraw() {
      clear(list);
      var active = c.channels.filter(function (x) { return !x.archived; });
      c.channels.slice().sort(function (a, b) { return (a.archived - b.archived) || (a.position - b.position); }).forEach(function (ch) {
        var i = active.indexOf(ch);
        list.appendChild(h('div', { class: 'cs-chan' + (ch.archived ? ' dim' : '') },
          h('div', { class: 'grow' }, h('strong', { text: '# ' + ch.name }), ch.readOnly ? h('span', { class: 'badge', text: ' Read-only' }) : null, ch.archived ? h('span', { class: 'badge', text: ' Archived' }) : null, h('div', { class: 'small muted', text: ch.description || 'No description' })),
          h('div', { class: 'row tight' },
            ch.archived ? null : h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Move ' + ch.name + ' up', disabled: i <= 0 ? true : null, text: '↑', onclick: function () { move(ch, -1); } }),
            ch.archived ? null : h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Move ' + ch.name + ' down', disabled: i >= active.length - 1 ? true : null, text: '↓', onclick: function () { move(ch, 1); } }),
            h('button', { class: 'btn secondary small', type: 'button', text: 'Edit', 'aria-label': 'Edit ' + ch.name, onclick: function () { channelForm(c, ch, redraw); } }),
            h('button', { class: 'btn secondary small', type: 'button', text: ch.archived ? 'Restore' : 'Archive', 'aria-label': (ch.archived ? 'Restore ' : 'Archive ') + ch.name, onclick: function () { archive(ch); } }))));
      });
    }
    async function move(ch, d) {
      var active = c.channels.filter(function (x) { return !x.archived; }), i = active.indexOf(ch), j = i + d; if (j < 0 || j >= active.length) return;
      active.splice(i, 1); active.splice(j, 0, ch);
      try { await api('chatChannelOrder', { order: active.map(function (x) { return x.id; }) }); active.forEach(function (x, k) { x.position = k; }); c.channels.sort(function (a, b) { return a.position - b.position; }); redraw(); paintAll(); } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
    }
    async function archive(ch) {
      if (!ch.archived) { var ok = await X.confirmDialog('Archive #' + ch.name + '?', 'Nobody will be able to post in it. All of its messages are kept, and anyone in the family can still read them under "Archived channels". You can restore the channel at any time.', 'Archive channel'); if (!ok) return; }
      try { await api('chatChannelArchive', { channelId: ch.id, archived: !ch.archived }); ch.archived = !ch.archived; X.showAlert(msg, 'ok', ch.archived ? '#' + ch.name + ' was archived. Its messages are kept.' : '#' + ch.name + ' was restored.'); redraw(); paintAll(); } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
    }
    redraw();
    sheet('Manage channels', body);
  }
  function channelForm(c, ch, done) {
    var body = h('div'), msg = h('div');
    var name = h('input', { type: 'text', maxlength: 30, 'aria-label': 'Channel name', placeholder: 'for example: recipes', autocomplete: 'off' }); name.value = ch ? ch.name : '';
    var desc = h('input', { type: 'text', maxlength: 120, 'aria-label': 'What is this channel for?', placeholder: 'What is this channel for?', autocomplete: 'off' }); desc.value = ch ? ch.description : '';
    var ro = h('input', { type: 'checkbox' }); ro.checked = ch ? ch.readOnly : false;
    var save = h('button', { class: 'btn', type: 'button', text: ch ? 'Save' : 'Create channel', onclick: function () { X.busy(save, async function () {
      try {
        var r = await api('chatChannelSave', { channelId: ch ? ch.id : undefined, name: name.value, description: desc.value, readOnly: ro.checked });
        if (ch) Object.assign(ch, r.channel); else c.channels.push(r.channel);
        s.close(); done(); paintAll(); toast(ch ? 'Channel updated.' : 'Channel created.');
      } catch (e) { X.showAlert(msg, 'error', msgOf(e)); }
    }, 'Saving…'); } });
    body.appendChild(h('label', { class: 'field' }, h('span', { text: 'Name' }), name)); body.appendChild(h('p', { class: 'small muted', text: 'Lowercase letters, numbers and dashes. Spaces become dashes.' }));
    body.appendChild(h('label', { class: 'field' }, h('span', { text: 'Description' }), desc));
    body.appendChild(h('label', { class: 'check' }, ro, ' Read-only: only the family owner and chat admins can post'));
    body.appendChild(msg); body.appendChild(h('div', { class: 'row' }, save));
    var s = sheet(ch ? 'Edit channel' : 'New channel', body);
  }
  async function modSheet(c) {
    var body = h('div', { class: 'cs-list' }, X.spinnerLine('Loading…', 'site')), s = sheet('Moderation record', body);
    var LABELS = { removed_message: 'removed a message from', channel_archived: 'archived', channel_restored: 'restored', channel_read_only: 'made read-only', channel_open_to_all: 'opened for everyone', chat_admin_added: 'made a chat admin:', chat_admin_removed: 'removed as chat admin:' };
    try {
      var r = await api('chatModLog'); if (C !== c) return; clear(body);
      body.appendChild(h('p', { class: 'small muted', text: 'A short list of moderation actions in shared channels. It never contains message text and never covers direct messages.' }));
      if (!r.entries.length) body.appendChild(h('p', { class: 'muted', text: 'Nothing has been moderated yet.' }));
      r.entries.forEach(function (e) {
        var ch = channelById(c, e.convId), what = (LABELS[e.action] || e.action) + (e.convId ? ' #' + (ch ? ch.name : 'a channel') : '') + (e.targetUserId ? (e.action === 'removed_message' ? ' (written by ' + realName(e.targetUserId) + ')' : ' ' + realName(e.targetUserId)) : '');
        body.appendChild(h('div', { class: 'cs-mod' }, h('strong', { text: realName(e.actorId) }), ' ' + what, h('div', { class: 'small muted', text: fullTime(e.at) })));
      });
    } catch (e) { clear(body); body.appendChild(X.alertBox('error', msgOf(e))); }
  }

  /* =====================================================================
   * Views (#/chat, #/chat/<channelId>, #/dms, #/dms/<dmId>)
   * ===================================================================== */
  function setVV() {
    var vv = window.visualViewport; if (!vv) return;
    var set = function () { document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px'); document.documentElement.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px'); };
    set();
    if (C && !C.vv) { C.vv = true; listen(C, vv, 'resize', function () { set(); if (nearBottom()) scrollBottom(); }); listen(C, vv, 'scroll', set); }
  }
  async function startConv(c) {
    var r = c.route, kind = r.mode === 'dms' ? 'dm' : 'channel', cv = null;
    if (!r.id && wide()) {                         // two-pane layout: open something by default
      if (kind === 'channel') { var first = c.channels.filter(function (x) { return !x.archived; })[0]; var last = ''; try { last = sessionStorage.getItem('fc_chat_last_' + c.famId) || ''; } catch (e) { /* private mode */ } var pick = channelById(c, last) || first; if (pick && !pick.archived) r.id = pick.id; }
      else if (c.dms[0]) r.id = c.dms[0].id;
    }
    if (!r.id) { c.cur = null; paintAll(); return; }
    if (kind === 'channel' && !channelById(c, r.id)) { c.cur = null; r.id = ''; toast('That channel was not found.'); paintAll(); return; }
    if (kind === 'dm' && !dmById(c, r.id)) { c.cur = null; r.id = ''; toast('That conversation was not found.'); paintAll(); return; }
    if (kind === 'channel') { try { sessionStorage.setItem('fc_chat_last_' + c.famId, r.id); } catch (e) { /* ok */ } }
    c.cur = convOf(c, kind, r.id);
    paintAll();
    await openConv(c, kind, r.id);
    paintList();
  }
  async function view(main, token, mode, id) {
    if (!enabled()) { clear(main).appendChild(h('div', { class: 'empty' }, h('p', { text: 'Chat is turned off for this app.' }), h('a', { class: 'btn', href: '#/home', text: 'Back to Home' }))); return; }
    var c = begin();
    c.route = { mode: mode, id: id || '' };
    if (c.cur && (c.cur.id !== c.route.id)) c.cur = null;
    render(main);
    if (!c.loaded) {
      if (c.loading) return;
      c.loading = true;
      try { await loadOverview(c); } catch (e) { if (C === c) c.error = e; }
      c.loading = false;
      if (C !== c || token !== X.S.nav) { return; }
      render(main);
      if (!c.loaded) return;
      connect(c);
    }
    if (token !== X.S.nav) return;
    startConv(c);
    // stale overview? refresh counts and channel list quietly
    if (Date.now() - (c.at || 0) > 60000) reloadOverview(c);
  }

  function install(ctx) {
    X = ctx; h = X.h; clear = X.clear; icon = X.icon; toast = X.toast;
    X.VIEWS.chat = function (main, token, id) { return view(main, token, 'channels', id); };
    X.VIEWS.dms = function (main, token, id) { return view(main, token, 'dms', id); };
    globalListeners(); startPeek();
  }
  window.FCChat = { install: install, navItem: navItem, mountPanel: mountPanel, stop: stop, closePanel: function () { closePanel(false); }, refreshTotals: function () { return refreshTotals(true); } };
})();

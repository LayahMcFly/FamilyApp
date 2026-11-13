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
      h('span', { class: 'handle-pill', 'aria-hidden': 'true' }, h('span', { class: 'hp-ic hp-plus' }, icon('plus')), h('span', { class: 'hp-ic hp-chat' }, icon('comment'))), h('span', { class: 'handle-dot', hidden: true, 'aria-hidden': 'true' }), h('span', { text: 'Create' }));
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
    if (wide()) {
      // Centered beside the button, kept fully on screen.
      var ph = panel.offsetHeight || 230, top = r.top + r.height / 2 - ph / 2;
      top = Math.max(12, Math.min(top, window.innerHeight - ph - 12));
      panel.style.left = Math.round(r.right + 10) + 'px'; panel.style.top = Math.round(top) + 'px'; panel.style.bottom = 'auto';
    } else { panel.style.left = ''; panel.style.bottom = ''; panel.style.top = ''; }
  }
  function openPanel() {
    if (!panel || panelOpen) return;
    panelOpen = true; lastFocus = document.activeElement;
    panel.hidden = false; place(); var b = panel.previousSibling; if (b) b.hidden = false;
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
    var tot = TOTALS.ch + TOTALS.dm; if (window.FC_UNREAD !== tot) { window.FC_UNREAD = tot; try { document.dispatchEvent(new Event('fc-chat-unread')); } catch (e) { /* old browser */ } }   // the tab icon and title follow
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
  function navItem() { var li = createHandle(); var d = li.querySelector && li.querySelector('.handle-dot'); if (d) d.hidden = !(TOTALS.ch + TOTALS.dm); setTimeout(function () { paintBadges(); refreshTotals(false); }, 0); return li; }   // a rebuilt nav shows the dot at once
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
    if (!force && Date.now() - peekAt < 15000) return;
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
    setInterval(function () { if (!document.hidden) refreshTotals(false); }, 20000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshTotals(false); });
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
    pvReset();
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
      convs: {}, typing: {}, here: {}, calls: {}, cur: null, route: { mode: 'channels', id: '' }, drafts: {}, listeners: [], timers: {}, sub: null, rt: null, loading: null, online: navigator.onLine !== false };
    return C;
  }

  async function loadOverview(c) {
    var r = await api('chatOpen');
    if (C !== c) return false;
    c.role = r.role; c.picture = r.picture || ''; c.channels = r.channels; c.dms = r.dms; c.unread = r.unread; c.blocked = r.blocked; c.allowDms = r.allowDms; c.limits = r.limits || c.limits; c.reactions = r.reactions || c.reactions;
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
    var chans = [base + 'chatMessages.rows', base + 'chatReactions.rows', base + 'chatChannels.rows', base + 'chatDms.rows', base + 'chatTyping.rows'];
    try {
      if (A && A.Realtime) { c.rt = new A.Realtime(X.client); var sub = await c.rt.subscribe(chans, function (ev) { if (C === c) onEvent(c, ev); }); if (C !== c) { try { sub.unsubscribe(); } catch (e) { /* ok */ } return; } c.sub = sub; }
      else if (X.client && X.client.subscribe) c.sub = X.client.subscribe(chans, function (ev) { if (C === c) onEvent(c, ev); });
      else throw new Error('no realtime');
      c.live = true; (c.dbg = c.dbg || { evs: [] }).rt = 'connected';
    } catch (e) {
      (c.dbg = c.dbg || { evs: [] }).rt = 'FAILED: ' + ((e && e.message) || e);
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
    (c.dbg = c.dbg || { evs: [] }).lastAny = Date.now(); c.dbg.anyCount = (c.dbg.anyCount || 0) + 1;
    if (!kind || p.familyId !== c.famId) return;                // another family's event is never used
    if (evs.indexOf('.chatTyping.') >= 0) return onTypingEvent(c, kind, p);
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
      if (c.typing && c.typing[row.convId]) { delete c.typing[row.convId][row.authorId]; paintTyping(c); }   // their message arrived, so they are no longer typing
      if (row.kind === 'dm') { touchDm(c, row.convId, row.$createdAt); (c.dmLast = c.dmLast || {})[row.convId] = row; paintList(); }
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
  function convSig(cv) {
    var parts = cv.msgs.map(function (m) { return m.$id + '|' + (m.editedAt || '') + '|' + (m._status || ''); });
    cv.react.forEach(function (byEmoji, mid) { byEmoji.forEach(function (set, e) { parts.push(mid + e + set.size); }); });
    return parts.join(',');
  }
  async function catchUp(c) {
    var cv = c.cur; if (!cv || !cv.ready) return;
    try {
      var rows = await fetchPage(cv, null);
      if (C !== c || c.cur !== cv) return;
      var atBottom = nearBottom();
      var sig0 = convSig(cv);
      var ids = {}; rows.forEach(function (r) { ids[r.$id] = true; });
      rows.slice().reverse().forEach(function (r) { upsert(cv, r); });
      // messages that were deleted while I was offline
      var oldest = rows.length === PAGE ? rows[rows.length - 1].$createdAt : '';
      cv.msgs = cv.msgs.filter(function (m) { return m._local || ids[m.$id] || (oldest && m.$createdAt < oldest); });
      await fetchReactions(cv, rows.map(function (r) { return r.$id; }));
      if (convSig(cv) !== sig0) paintMessages(atBottom || c.kbd ? 'bottom' : 'keep');   // nothing new: leave the screen alone
      maybeMarkRead(c);
    } catch (e) { /* offline: the banner explains it, and the next wake-up tries again */ }
  }

  /* ---------- sending ---------- */
  function sendText(c, cv, text, replyToId, media) {
    var local = { $id: 'local:' + newClientId(), _local: true, _status: 'sending', convId: cv.id, authorId: c.uid, body: media && !text ? (media.type === 'sticker' ? '[Sticker]' : '[GIF]') : text, _media: media || null, media: media ? JSON.stringify({ p: 'giphy', t: media.type, id: media.id, w: media.w, h: media.h, a: media.alt || '' }) : '', replyToId: replyToId || '', clientId: newClientId(), $createdAt: new Date().toISOString(), familyId: c.famId };
    cv.msgs.push(local); cv.newCount = 0;
    paintMessages('bottom');
    doSend(c, cv, local);
  }
  async function doSend(c, cv, local) {
    local._status = 'sending'; local._err = ''; paintMessages('keep');
    try {
      var r = await api('chatSend', { kind: cv.kind, convId: cv.id, body: local._media && /^\[(GIF|Sticker)\]$/.test(local.body) ? '' : local.body, media: local._media || undefined, clientId: local.clientId, replyToId: local.replyToId || undefined });
      if (C !== c) return;
      var m = r.message, row = { $id: m.id, convId: m.convId, authorId: m.authorId, body: m.body, replyToId: m.replyToId, clientId: m.clientId, editedAt: m.editedAt, $createdAt: m.createdAt, familyId: c.famId, kind: m.kind, media: m.media || '' };
      if (cv.kind === 'dm') { touchDm(c, cv.id, row.$createdAt); (c.dmLast = c.dmLast || {})[cv.id] = row; paintList(); }
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

  /* ---------- share something into a direct chat (used by the post Share button) ---------- */
  function shareToDm(link, label) {
    if (!enabled()) { toast('Chat is not available right now.'); return; }
    var body = h('div'), list = h('div', { class: 'cs-list' }), msg = h('div'), sending = false;
    var note = h('input', { type: 'text', maxlength: 300, autocomplete: 'off', placeholder: 'Add a message (optional)', 'aria-label': 'Message to send with the ' + (label || 'link') });
    var q = h('input', { type: 'search', 'aria-label': 'Search family members', placeholder: 'Search members', autocomplete: 'off' });
    var s = null;
    function draw() {
      clear(list); var t = q.value.trim().toLowerCase();
      Array.from(X.S.profiles.values()).sort(function (a, b) { return String(a.displayName).localeCompare(String(b.displayName)); })
        .filter(function (p) { return p.userId && p.userId !== me() && (!t || String(p.displayName).toLowerCase().indexOf(t) >= 0); })
        .forEach(function (p) {
          list.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: async function () {
            if (sending) return; sending = true;
            try {
              var r = await api('chatDmStart', { userId: p.userId });
              var text = (note.value.trim() ? note.value.trim() + '\n' : '') + link;
              await api('chatSend', { kind: 'dm', convId: r.dm.id, body: text, clientId: newClientId() });
              s.close(); toast('Sent to ' + p.displayName + '.');
            } catch (e) { sending = false; X.showAlert(msg, 'error', msgOf(e)); }
          } }, avatar(p.userId, 'sm'), h('span', { class: 'grow', text: p.displayName })));
        });
      if (!list.firstChild) list.appendChild(h('p', { class: 'muted small', text: 'No one else in this family matches.' }));
    }
    q.addEventListener('input', draw);
    body.appendChild(h('p', { class: 'small muted', text: 'Pick someone to send this to in a direct chat. Only they and you can read it.' }));
    body.appendChild(note); body.appendChild(q); body.appendChild(msg); body.appendChild(list); draw();
    s = sheet('Send in a direct chat', body);
  }
  /* ---------- profile sheet (tap a person's picture or name) ---------- */
  function profileSheet(c, uid) {
    var p = profileOf(uid), me = uid === X.S.user.$id, s = null;
    var body = h('div', { class: 'pf-sheet' }), rel = h('div', { class: 'pf-rel' });
    if (!me && X.relationFor) X.relationFor(uid).then(function (t) { if (t) rel.textContent = t; });   // for example: Your older sister
    var ban = X.bannerFor ? X.bannerFor(uid) : null, topWrap = body;
    if (ban) { topWrap = h('div', { class: 'profile-hero has-banner in-sheet' }, ban); body.appendChild(topWrap); }   // the banner sits behind the picture and name
    topWrap.appendChild(h('div', { class: 'pf-top' }, avWrap(c, uid, 'lg'), h('div', { class: 'grow' }, h('h3', { class: 'pf-name', text: realName(uid) + (me ? ' (you)' : '') }), rel, h('div', { class: 'small muted', text: onlineNow(uid) ? 'Online now' : 'Offline' }))));
    var acts = h('div', { class: 'pf-actions' });
    if (!me) {
      acts.appendChild(h('button', { class: 'btn', type: 'button', text: 'Message', onclick: function () { s.close(); startDm(c, uid).catch(function (e) { toast(msgOf(e)); }); } }));
      if (callsAvailable() && !c.standalone) acts.appendChild(h('button', { class: 'btn secondary', type: 'button', text: 'Call', onclick: async function () {
        s.close(); await startDm(c, uid);
        var tries = 0, t = setInterval(function () { tries++; var cv = c.cur; if (cv && cv.kind === 'dm' && dmById(c, cv.id) && dmById(c, cv.id).otherId === uid) { clearInterval(t); startCall(c, cv, false); } else if (tries > 20) clearInterval(t); }, 250);
      } }));
    }
    acts.appendChild(h('a', { class: 'btn secondary', href: '#/profile/' + uid, text: me ? 'Edit profile' : 'Full profile', onclick: function () { s.close(); } }));
    body.appendChild(acts);
    body.appendChild(X.profileFacts ? X.profileFacts(uid) : h('p', { class: 'muted small', text: p && p.bio ? p.bio : '' }));
    s = sheet('Profile', body);
  }
  function openable(node, c, uid, label) {
    node.classList.add('pf-open'); node.setAttribute('role', 'button'); node.tabIndex = 0; node.setAttribute('aria-label', label || 'Open profile');
    node.addEventListener('click', function (e) { e.stopPropagation(); profileSheet(c, uid); });
    node.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); profileSheet(c, uid); } });
    return node;
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
  function paintList() { if (!C || !host || !host.isConnected) return; var rl = host.querySelector('.chat-rail'); if (rl) { var rd = rl.querySelector('.rail-dms'), rt = rd ? rd.scrollTop : 0, nr = buildRail(C); rl.replaceWith(nr); var nd = nr.querySelector('.rail-dms'); if (nd) nd.scrollTop = rt; } var sc = host.querySelector('.chat-side'); if (sc) { var top = sc.querySelector('.side-scroll'); var t = top ? top.scrollTop : 0; var ns = buildSide(C); sc.replaceWith(ns); var nt = ns.querySelector('.side-scroll'); if (nt) nt.scrollTop = t; } }

  function errorBox(c) {
    var e = c.error, denied = e && (e.apiCode === 'forbidden' || e.code === 403);
    var msg = denied ? 'You are not a member of this family, so chat is not available.' : (e && e.apiCode === 'server_error' ? 'Chat is not ready yet. The family owner needs to finish the chat setup (see CHAT-GUIDE.md), then try again.' : msgOf(e));
    return h('div', { class: 'chat-empty' }, X.alertBox('error', msg), h('div', { class: 'row' },
      denied ? h('a', { class: 'btn', href: '#/hub', text: 'Back to Hub' }) : h('button', { class: 'btn', type: 'button', text: 'Try again', onclick: function () { retryOpen(c); } }), h('a', { class: 'btn secondary', href: '#/home', text: 'Home' })));
  }
  async function retryOpen(c) { c.error = null; render(X.S.main); try { await loadOverview(c); } catch (e) { c.error = e; } if (C === c) { render(X.S.main); if (c.loaded) startConv(c); } }

  /* ----- family switcher ----- */
  /** The letter for a family, or the uploaded picture when this is the current family and it has one. */
  function famFace(f, mini) {
    var span = h('span', { class: 'fam-face', text: famInitial(f) });
    if (C && f.id === famId() && C.picture && X.avatarUrl) {
      var fid = C.picture;
      X.avatarUrl(fid).then(function (u) { if (C && C.picture === fid && span.parentNode !== undefined) { clear(span); span.classList.add('has-img'); span.appendChild(h('img', { src: u, alt: '' })); } }).catch(function () { /* the letter stays */ });
    }
    return span;
  }
  function famInitial(f) { return (f.name || '?').trim().charAt(0).toUpperCase() || '?'; }
  function buildRail(c) {
    var rail = h('nav', { class: 'chat-rail', 'aria-label': 'Family chat and direct messages' });
    // Pinned at the top: the family button(s). The current family's button opens the family chat.
    var top = h('div', { class: 'rail-top' });
    X.S.families.forEach(function (f) {
      var on = f.id === famId(), n = on ? TOTALS.ch : 0;
      top.appendChild(h('button', { class: 'rail-btn' + (on ? ' on' : ''), type: 'button', title: f.name + (on ? ' (family chat)' : ''), 'aria-label': f.name + (on ? ', family chat' + (n ? ', ' + n + ' unread' : '') : ''), 'aria-current': on ? 'true' : null,
        onclick: function () { if (!on) switchFamilyTo(f.id); else if (c.route.mode !== 'channels' || c.route.id) location.hash = '#/chat'; } },
        famFace(f), n ? h('span', { class: 'rail-badge', 'aria-hidden': 'true', text: n > 9 ? '9+' : String(n) }) : null));
    });
    rail.appendChild(top);
    rail.appendChild(h('div', { class: 'rail-sep', role: 'separator' }));
    // Below it: the other family members, whoever you talked to last on top. People you have not messaged yet follow, A to Z.
    var list = h('div', { class: 'rail-dms' });
    railPeople(c).forEach(function (it) {
      var n = it.dm ? ((c.unread[it.dm.id] || {}).n || 0) : 0, on = !!(it.dm && c.cur && c.cur.id === it.dm.id), nm = it.p.displayName || 'Family member';
      list.appendChild(h('button', { class: 'rail-av' + (on ? ' on' : ''), type: 'button', title: nm + (isHere(c, it.p.userId) ? ' (online)' : ''), 'aria-label': 'Message ' + nm + (isHere(c, it.p.userId) ? ', online' : '') + (n ? ', ' + n + ' unread' : ''), 'aria-current': on ? 'true' : null,
        onclick: function () { if (it.dm) location.hash = '#/dms/' + it.dm.id; else startDm(c, it.p.userId).catch(function (e) { toast(msgOf(e)); }); } },
        avatar(it.p.userId, 'sm'), onlineDot(c, it.p.userId), (it.dm && callIds(c, it.dm.id).length) ? h('span', { class: 'rail-call', 'aria-hidden': 'true' }, icon('phone')) : null, n ? h('span', { class: 'rail-badge', 'aria-hidden': 'true', text: n > 9 ? '9+' : String(n) }) : null));
    });
    rail.appendChild(list);
    return rail;
  }
  /** Other members for the rail: open conversations newest first, then everyone else alphabetically. Closed ones (the person left) are not shown. */
  function railPeople(c) {
    var byUser = {}; c.dms.forEach(function (d) { byUser[d.otherId] = d; });
    var withDm = [], without = [];
    memberList(c).forEach(function (p) {
      if (p.userId === c.uid) return;
      var d = byUser[p.userId];
      if (d && d.status !== 'open') return;
      (d ? withDm : without).push({ p: p, dm: d || null });
    });
    withDm.sort(function (a, b) { return String(b.dm.lastAt || '').localeCompare(String(a.dm.lastAt || '')); });
    return withDm.concat(without);
  }
  /** A message was sent or arrived in a DM: that person moves to the top of the list. */
  function touchDm(c, convId, at) {
    var d = dmById(c, convId); if (!d) return;
    if (!d.lastAt || String(at) > String(d.lastAt)) d.lastAt = at;
    c.dms.sort(function (a, b) { return String(b.lastAt || '').localeCompare(String(a.lastAt || '')); });
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
        h('span', { class: 'rail-btn mini' + (on ? ' on' : ''), 'aria-hidden': 'true' }, famFace(f)), h('span', { class: 'grow', text: f.name }), on ? h('span', { class: 'badge', text: 'Current' }) : null));
    });
    var s = sheet('Your families', list);
  }

  /* ----- side panel: channels and direct messages ----- */
  function unreadPill(n) { return n > 0 ? h('span', { class: 'unread', 'aria-label': n + ' unread', text: n > 9 ? '9+' : String(n) }) : null; }
  /* Direct messages list: last message and how long ago, like Discord. */
  function agoText(iso) {
    var t = Date.parse(iso); if (!t) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'now'; var m = Math.floor(s / 60); if (m < 60) return m + 'm';
    var hr = Math.floor(m / 60); if (hr < 24) return hr + 'h';
    var d = Math.floor(hr / 24); if (d < 7) return d + 'd'; if (d < 365) return Math.floor(d / 7) + 'w';
    return Math.floor(d / 365) + 'y';
  }
  function dmPreview(c, it) {
    var last = it.dm && c.dmLast ? c.dmLast[it.dm.id] : null;
    if (!it.dm) return 'Start a conversation';
    if (!last) return c.dmLast && c.dmLast._done ? 'No messages yet' : '';
    var body = String(last.body || '');
    var txt = body === '[call]' ? 'Started a call' : body === '[GIF]' ? 'Sent a GIF' : body === '[Sticker]' ? 'Sent a sticker' : body.replace(/\s+/g, ' ');
    return (last.authorId === c.uid ? 'You: ' : '') + txt;
  }
  async function loadDmLast(c) {
    c.dmLast = c.dmLast || {};
    var list = c.dms.filter(function (d) { return d.status === 'open'; });
    await Promise.all(list.map(async function (d) {
      try {
        var r = await X.db.listRows({ databaseId: dbId(), tableId: T.msg, queries: [Q().equal('convId', [d.id]), Q().orderDesc('$createdAt'), Q().limit(1)] });
        var row = (r.rows || [])[0]; if (row) c.dmLast[d.id] = row;
      } catch (e) { /* the preview stays empty */ }
    }));
    c.dmLast._done = true;
    if (C === c) paintList();
  }
  function buildSide(c) {
    var side = h('aside', { class: 'chat-side', 'aria-label': 'Channels' });
    var multi = X.S.families.length > 1;
    side.appendChild(h('div', { class: 'side-head' },
      h('a', { class: 'btn secondary small only-narrow', href: '#/hub', 'aria-label': 'Back to Hub' }, icon('back')),
      h('button', { class: 'fam-btn', type: 'button', 'aria-label': 'Family: ' + famLabel() + (multi ? '. Switch family' : ''), disabled: multi ? null : true, onclick: familySheet }, h('strong', { text: famLabel() }), multi ? icon('more') : null),
      h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Chat settings', onclick: function () { settingsSheet(c); } }, icon('gear'))));
    var sc = h('div', { class: 'side-scroll' }); side.appendChild(sc);
    if (c.route.mode === 'dms') {
      var ppl = railPeople(c), onl = ppl.filter(function (it) { return isHere(c, it.p.userId); }), off = ppl.filter(function (it) { return !isHere(c, it.p.userId); });
      var personRow = function (it) {
        var n = it.dm ? ((c.unread[it.dm.id] || {}).n || 0) : 0, on = !!(it.dm && c.cur && c.cur.id === it.dm.id);
        return h('a', { class: 'side-item' + (on ? ' on' : '') + (n ? ' has-unread' : ''), href: it.dm ? '#/dms/' + it.dm.id : '#/dms', 'aria-current': on ? 'page' : null,
          onclick: it.dm ? null : function (ev) { ev.preventDefault(); startDm(c, it.p.userId).catch(function (e) { toast(msgOf(e)); }); } },
          h('span', { class: 'av-wrap' }, avatar(it.p.userId, 'sm'), onlineDot(c, it.p.userId)),
          h('span', { class: 'grow dm-text' },
            h('span', { class: 'dm-top' }, h('span', { class: 'dm-name clamp', text: it.p.displayName || 'Family member' }), (it.dm && c.dmLast && c.dmLast[it.dm.id]) ? h('span', { class: 'dm-ago', text: agoText(c.dmLast[it.dm.id].$createdAt) }) : null),
            h('span', { class: 'dm-last clamp', text: dmPreview(c, it) })),
          (it.dm && callIds(c, it.dm.id).length) ? h('span', { class: 'in-call-mark', title: 'Calling', 'aria-label': 'in a call' }, icon('phone')) : null, unreadPill(n));
      };
      sc.appendChild(h('h2', { class: 'side-h', text: 'Direct messages' }));
      if (!ppl.length) sc.appendChild(h('p', { class: 'muted small side-note', text: 'No one else is in this family yet. Invite people from Settings, then message them here.' }));
      if (onl.length) { sc.appendChild(h('h3', { class: 'side-h2', text: 'Online now (' + onl.length + ')' })); onl.forEach(function (it) { sc.appendChild(personRow(it)); }); }
      if (off.length) { if (onl.length) sc.appendChild(h('h3', { class: 'side-h2', text: 'Offline' })); off.forEach(function (it) { sc.appendChild(personRow(it)); }); }
      sc.appendChild(h('div', { class: 'row side-actions' }, h('a', { class: 'btn secondary small', href: '#/chat', text: 'Go to channels' })));
    } else {
      sc.appendChild(h('h2', { class: 'side-h', text: 'Text channels' }));
      var active = c.channels.filter(function (x) { return !x.archived; }), arch = c.channels.filter(function (x) { return x.archived; });
      active.forEach(function (ch) {
        var on = c.cur && c.cur.id === ch.id, n = (c.unread[ch.id] || {}).n || 0;
        sc.appendChild(h('a', { class: 'side-item' + (on ? ' on' : '') + (n ? ' has-unread' : ''), href: '#/chat/' + ch.id, 'aria-current': on ? 'page' : null, title: ch.description },
          h('span', { class: 'hash', 'aria-hidden': 'true', text: '#' }), h('span', { class: 'grow', text: ch.name }), callIds(c, ch.id).length ? h('span', { class: 'in-call-mark', title: 'Call in progress', 'aria-label': 'call in progress' }, icon('phone')) : null, ch.readOnly ? h('span', { class: 'ro', title: 'Only owners and chat admins can post', 'aria-label': 'read-only' }, icon('lock')) : null, unreadPill(n)));
      });
      if (arch.length) {
        var det = h('details', { class: 'arch' }, h('summary', { text: 'Archived channels (' + arch.length + ')' }));
        arch.forEach(function (ch) { var on = c.cur && c.cur.id === ch.id; det.appendChild(h('a', { class: 'side-item dim' + (on ? ' on' : ''), href: '#/chat/' + ch.id, 'aria-current': on ? 'page' : null }, h('span', { class: 'hash', 'aria-hidden': 'true', text: '#' }), h('span', { class: 'grow', text: ch.name }))); });
        sc.appendChild(det);
      }
      var fm = memberList(c).filter(function (p) { return p.userId !== c.uid; }).sort(function (a, b) { return (isHere(c, b.userId) ? 1 : 0) - (isHere(c, a.userId) ? 1 : 0); });
      var fmDet = h('details', { class: 'fm-drop' }, h('summary', { text: 'Family members' + (hereCount(c) > 0 ? ' · ' + hereCount(c) + ' online' : '') }));
      if (!fm.length) fmDet.appendChild(h('p', { class: 'small muted fm-empty', text: 'No one else is here yet.' }));
      fm.forEach(function (p) {
        var on = isHere(c, p.userId);
        fmDet.appendChild(h('button', { class: 'fm-row', type: 'button', title: 'Message ' + (p.displayName || 'this person'), onclick: function () { startDm(c, p.userId).catch(function (e) { toast(msgOf(e)); }); } },
          avWrap(c, p.userId, 'sm'), h('span', { class: 'grow clamp', text: p.displayName || 'Family member' }), h('span', { class: 'fm-state small' + (on ? ' is-on' : ' muted'), text: on ? 'Online' : 'Offline' })));
      });
      sc.appendChild(fmDet);
      sc.appendChild(h('div', { class: 'row side-actions' }, h('a', { class: 'btn secondary small', href: '#/dms' }, icon('send'), ' Go to direct messages')));
    }
    // People are in the rail on the left. Only conversations with someone who left the family are listed here, read-only.
    var closed = c.dms.filter(function (d) { return d.status !== 'open'; });
    if (closed.length) {
      var cd = h('details', { class: 'arch' }, h('summary', { text: 'Closed conversations (' + closed.length + ')' }));
      closed.forEach(function (d) { var on = c.cur && c.cur.id === d.id; cd.appendChild(h('a', { class: 'side-item dim' + (on ? ' on' : ''), href: '#/dms/' + d.id, 'aria-current': on ? 'page' : null }, avatar(d.otherId, 'sm'), h('span', { class: 'grow', text: realName(d.otherId) }))); });
      sc.appendChild(cd);
    }
    side.appendChild(h('div', { class: 'side-version small muted', text: ((window.FAMILY_CONFIG && window.FAMILY_CONFIG.appName) || 'Family Circle') + ' v' + ((window.FAMILY_CONFIG && window.FAMILY_CONFIG.version) || '') }));   // only in the list, never in the conversation
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
      pane.appendChild(h('div', { class: 'chat-empty' }, h('p', { class: 'muted', text: c.route.mode === 'dms' ? 'Pick someone on the left to message.' : 'Choose a channel to start reading.' })));
      return;
    }
    var title = curTitle(c), ch = cv.kind === 'channel' ? channelById(c, cv.id) : null, dm = cv.kind === 'dm' ? dmById(c, cv.id) : null;
    var sub = ch ? (ch.description || '') : (dm ? 'Direct message · only you and ' + realName(dm.otherId) + ' can read this' : '');
    var head = h('header', { class: 'conv-head' },
      h('a', { class: 'btn secondary small only-narrow', href: c.route.mode === 'dms' ? '#/dms' : '#/chat', 'aria-label': 'Back to ' + (c.route.mode === 'dms' ? 'direct messages' : 'channels') }, icon('back')),
      dm ? openable(avWrap(c, dm.otherId, 'sm'), c, dm.otherId, 'Open ' + title + '’s profile') : null,
      h('div', { class: 'grow ct' }, h('h1', { text: title }), h('div', { class: 'small muted clamp', text: (dm ? '' : famLabel() + ' · ') + sub })),
      convOpen(c, cv) && callsAvailable() ? h('button', { class: 'btn secondary small call-start', type: 'button', 'aria-label': 'Start a voice call', title: 'Voice call', onclick: function () { startCall(c, cv, false); } }, icon('phone')) : null,
      convOpen(c, cv) && callsAvailable() ? h('button', { class: 'btn secondary small call-start', type: 'button', 'aria-label': 'Start a video call', title: 'Video call', onclick: function () { startCall(c, cv, true); } }, icon('video')) : null,
      dm ? h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Conversation options', onclick: function () { dmOptions(c, dm); } }, icon('more')) : h('button', { class: 'btn secondary small', type: 'button', text: 'Members', onclick: function () { membersSheet(c); } }));
    pane.appendChild(h('div', { class: 'call-debug', id: 'call-debug', hidden: true }));
    pane.appendChild(head);
    pane.appendChild(h('div', { class: 'chat-banner', id: 'chat-banner', hidden: true, role: 'status' }));
    pane.appendChild(h('div', { class: 'chat-banner call-banner', id: 'call-banner', hidden: true, role: 'status' }));
    var list = h('div', { class: 'chat-list', id: 'chat-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages in ' + title, tabindex: '0' });
    pane.appendChild(list);
    var jump = h('button', { class: 'btn small jump', id: 'chat-jump', type: 'button', hidden: true, onclick: function () { cv.newCount = 0; scrollBottom(); paintJump(); maybeMarkRead(c); } });
    pane.appendChild(jump);
    pane.appendChild(buildComposer(c, cv, ch, dm));
    list.addEventListener('scroll', function () { c.stick = nearBottom(); }, { passive: true });
    var st = null; list.addEventListener('scroll', function () { if (st) return; st = setTimeout(function () { st = null; paintJump(); if (nearBottom()) { cv.newCount = 0; maybeMarkRead(c); } if (list.scrollTop < 60 && cv.hasMore && cv.ready) loadOlder(c, cv); }, 120); });
    paintBanner(); paintCallBanner(c); paintDebug(c);
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

  /* ----- links, link previews and GIFs ----- */
  var URL_RE = /https?:\/\/[^\s<>"']+/g;
  var GIF_RE = /^https:\/\/(?:media\d*|i)\.giphy\.com\/[A-Za-z0-9_\-\/.%]+\.(?:gif|webp)(?:\?[A-Za-z0-9_\-=&.%]*)?$/;
  function previewsOn() { return lsGet('fc_chat_previews', true) !== false; }
  /** Splits a message into text and web addresses; trailing punctuation stays outside the link. */
  function splitLinks(text) {
    var out = [], last = 0, mt;
    URL_RE.lastIndex = 0;
    while ((mt = URL_RE.exec(text))) {
      var u = mt[0], trail = (u.match(/[.,!?;:)\]]+$/) || [''])[0];
      if (trail) u = u.slice(0, u.length - trail.length);
      try { var x = new URL(u); if (x.protocol !== 'http:' && x.protocol !== 'https:') continue; } catch (e) { continue; }
      if (mt.index > last) out.push({ t: text.slice(last, mt.index) });
      out.push({ u: u }); last = mt.index + u.length; URL_RE.lastIndex = last;
    }
    if (last < text.length) out.push({ t: text.slice(last) });
    return out;
  }
  /* GIF and sticker messages: the row holds only {p:'giphy', t, id, w, h, a}. The address is rebuilt here from the id. */
  function mediaOf(m) {
    if (!m || !m.media) return null;
    try {
      var x = JSON.parse(m.media);
      if (!x || x.p !== 'giphy' || (x.t !== 'gif' && x.t !== 'sticker') || !/^[A-Za-z0-9]{5,30}$/.test(String(x.id))) return null;
      var n = function (v) { v = Math.round(Number(v)); return v >= 20 && v <= 1000 ? v : 200; };
      return { type: x.t, id: String(x.id), w: n(x.w), h: n(x.h), alt: String(x.a || '').slice(0, 80) };
    } catch (e) { return null; }
  }
  var ANIM = { shown: [], io: null, max: 3 };
  function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches || lsGet('fc_chat_autoplay', true) === false; } catch (e) { return false; } }
  function animInit() {
    if (ANIM.io || !window.IntersectionObserver) return;
    ANIM.io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { var api = e.target._gif; if (api) { if (e.isIntersecting && !reducedMotion() && !api.userStopped) api.play(); else if (!e.isIntersecting) api.stop(); } });
    }, { threshold: 0.6 });
  }

  /* Picture viewer for GIFs and stickers: tap to open, then zoom with + / -, the mouse wheel, double tap, or two fingers; drag to move. */
  function openViewer(src, alt) {
    var scale = 1, tx = 0, ty = 0, MIN = 1, MAX = 6, pts = new Map(), pinch0 = 0, scale0 = 1, drag = null, opener = document.activeElement;
    var img = h('img', { class: 'vw-img', src: src, alt: alt || 'GIF', draggable: 'false', referrerpolicy: 'no-referrer' });
    var stage = h('div', { class: 'vw-stage' }, img);
    var pct = h('span', { class: 'vw-pct small', 'aria-live': 'polite', text: '100%' });
    function apply() {
      if (scale <= 1) { tx = 0; ty = 0; }
      img.style.setProperty('transform', 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')');
      pct.textContent = Math.round(scale * 100) + '%'; stage.classList.toggle('zoomed', scale > 1);
    }
    function zoom(to) { scale = Math.max(MIN, Math.min(MAX, to)); apply(); }
    var closeB = h('button', { class: 'btn ghost vw-btn', type: 'button', 'aria-label': 'Close', text: '✕' });
    var outB = h('button', { class: 'btn ghost vw-btn', type: 'button', 'aria-label': 'Zoom out', text: '−' });
    var inB = h('button', { class: 'btn ghost vw-btn', type: 'button', 'aria-label': 'Zoom in', text: '+' });
    var bar = h('div', { class: 'vw-bar' }, outB, pct, inB);
    var ov = h('div', { class: 'vw-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Picture viewer' }, closeB, stage, bar);
    function close() { document.removeEventListener('keydown', onKey, true); ov.remove(); if (opener && opener.focus) try { opener.focus(); } catch (e) { /* gone */ } }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === '+' || e.key === '=') zoom(scale * 1.4); else if (e.key === '-') zoom(scale / 1.4); }
    closeB.addEventListener('click', close); outB.addEventListener('click', function () { zoom(scale / 1.5); }); inB.addEventListener('click', function () { zoom(scale * 1.5); });
    function inImg(x, y) { var r = img.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
    stage.addEventListener('click', function (e) { if (!inImg(e.clientX, e.clientY) && !(drag && drag.moved)) close(); });
    stage.addEventListener('wheel', function (e) { e.preventDefault(); zoom(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    stage.addEventListener('pointerdown', function (e) {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { stage.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      if (pts.size === 2) { var a = Array.from(pts.values()); pinch0 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); scale0 = scale; drag = null; }
      else if (scale > 1) drag = { x: e.clientX - tx, y: e.clientY - ty, moved: false };
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch0) { var a = Array.from(pts.values()); zoom(scale0 * Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) / pinch0); }
      else if (drag) { drag.moved = true; tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); }
    });
    var lastTap = 0, tapX = 0, tapY = 0, wasPinch = false;
    function up(e) {
      if (pts.size === 2) wasPinch = true;
      var tap = e.type === 'pointerup' && pts.size === 1 && !wasPinch && !(drag && drag.moved) && inImg(e.clientX, e.clientY);
      if (tap) {   // two quick taps on the picture (finger or mouse) zoom in or back out
        var now = Date.now();
        if (now - lastTap < 350 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 30) { zoom(scale > 1 ? 1 : 2.5); lastTap = 0; } else { lastTap = now; tapX = e.clientX; tapY = e.clientY; }
      }
      pts.delete(e.pointerId); if (!pts.size) wasPinch = false;
      if (pts.size < 2) pinch0 = 0; if (!pts.size) setTimeout(function () { drag = null; }, 0); }
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov); apply(); closeB.focus();
  }
  function zoomable(img, full, alt) {
    img.classList.add('zoomable'); img.setAttribute('role', 'button'); img.tabIndex = 0; img.setAttribute('aria-label', 'Open ' + (alt || 'GIF') + ' larger');
    img.addEventListener('click', function (e) { e.stopPropagation(); openViewer(full, alt); });
    img.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(full, alt); } });
  }
  function mediaNode(m, md) {
    var sticker = md.type === 'sticker', base = 'https://media.giphy.com/media/' + md.id + '/';
    var dw = Math.min(md.w, sticker ? 160 : 260), still = base + '200w_s.gif', moving = base + '200w.gif', playing = false, tried = 0;
    var label = md.alt || (sticker ? 'Sticker' : 'GIF');
    var wrap = h('div', { class: 'media-wrap ' + (sticker ? 'is-sticker' : 'is-gif') });
    var box = h('div', { class: 'media-box', style: 'width:' + dw + 'px;aspect-ratio:' + md.w + '/' + md.h });
    var img = h('img', { class: 'media-img', src: still, alt: label, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', draggable: 'false' });
    var btn = h('button', { class: 'media-play', type: 'button', 'aria-label': 'Play ' + label, 'aria-pressed': 'false' }, h('span', { 'aria-hidden': 'true', text: '▶' }));
    var api = { userStopped: false,
      play: function () {
        if (playing) return; playing = true; img.src = tried ? base + 'giphy.gif' : moving; btn.setAttribute('aria-pressed', 'true'); btn.setAttribute('aria-label', 'Pause ' + label); btn.firstChild.textContent = '❚❚'; btn.classList.add('on');
        ANIM.shown = ANIM.shown.filter(function (x) { return x !== api; }); ANIM.shown.push(api);
        while (ANIM.shown.length > ANIM.max) ANIM.shown.shift().stop();   // never more than a few moving pictures at once
      },
      stop: function () { if (!playing) return; playing = false; img.src = still; btn.setAttribute('aria-pressed', 'false'); btn.setAttribute('aria-label', 'Play ' + label); btn.firstChild.textContent = '▶'; btn.classList.remove('on'); ANIM.shown = ANIM.shown.filter(function (x) { return x !== api; }); } };
    btn.addEventListener('click', function (ev) { ev.stopPropagation(); if (playing) { api.userStopped = true; api.stop(); } else { api.userStopped = false; api.play(); } });
    img.addEventListener('error', function () {
      if (!tried) { tried = 1; img.src = playing ? base + 'giphy.gif' : base + 'giphy_s.gif'; return; }   // one fallback address, then give up
      box.classList.add('gone'); clear(box); box.appendChild(h('span', { class: 'media-gone small muted', text: (sticker ? 'Sticker' : 'GIF') + ' no longer available' }));
    });
    zoomable(img, base + 'giphy.gif', label);
    box.appendChild(img); box.appendChild(btn); wrap.appendChild(box);
    wrap.appendChild(h('span', { class: 'gif-credit small muted', text: 'via GIPHY' }));
    box._gif = api; animInit(); if (ANIM.io) ANIM.io.observe(box); else if (!reducedMotion()) api.play();
    return wrap;
  }
  function gifOf(m) { var b = String(m.body || '').trim(); return GIF_RE.test(b) ? b : ''; }
  function msgText(m) {
    var el = h('div', { class: 'msg-text' });
    if (mediaOf(m) && /^\[(GIF|Sticker)\]$/.test(String(m.body || '').trim())) { el.classList.add('is-gif'); return el; }   // no caption, only the picture
    if (gifOf(m) && previewsOn()) { el.classList.add('is-gif'); return el; }
    splitLinks(String(m.body || '')).forEach(function (p) {
      if (p.u) el.appendChild(h('a', { href: p.u, target: '_blank', rel: 'noopener noreferrer nofollow ugc', class: 'msg-link', text: p.u }));
      else el.appendChild(document.createTextNode(p.t));
    });
    return el;
  }
  var PV = { cache: {}, queue: [], running: 0, io: null };
  function pvReset() { PV.cache = {}; PV.queue = []; PV.running = 0; if (PV.io) { try { PV.io.disconnect(); } catch (e) { /* ok */ } PV.io = null; } }
  function pvPump() {
    while (PV.running < 2 && PV.queue.length) {
      var job = PV.queue.shift(); PV.running++;
      (function (j) {
        api('chatPreview', { url: j.url }).then(function (r) { return r && r.preview ? r.preview : null; }, function () { return null; }).then(function (p) {
          PV.running--; var e = PV.cache[j.url]; if (e) { e.state = p ? 'ok' : 'none'; e.data = p; e.subs.forEach(function (f) { f(e); }); e.subs = []; } pvPump();
        });
      })(job);
    }
  }
  function pvRequest(url, cb) {
    var e = PV.cache[url];
    if (!e) { e = PV.cache[url] = { state: 'wait', data: null, subs: [] }; }
    if (e.state === 'ok' || e.state === 'none') { cb(e); return; }
    e.subs.push(cb);
    if (e.state === 'wait') { e.state = 'queued'; PV.queue.push({ url: url }); pvPump(); }
  }
  function previewCard(url) {
    var card = h('a', { class: 'link-card', href: url, target: '_blank', rel: 'noopener noreferrer nofollow ugc', 'aria-busy': 'true' }, h('span', { class: 'lc-skel', 'aria-hidden': 'true' }));
    function fill(e) {
      if (!card.parentNode) return;
      if (e.state !== 'ok') { card.remove(); return; }
      var d = e.data; clear(card); card.removeAttribute('aria-busy');
      if (d.image) card.appendChild(h('img', { class: 'lc-img', src: d.image, alt: '', loading: 'lazy', decoding: 'async' }));
      var tx = h('span', { class: 'lc-text' });
      if (d.siteName) tx.appendChild(h('span', { class: 'lc-site small muted', text: d.siteName }));
      if (d.title) tx.appendChild(h('strong', { class: 'lc-title', text: d.title }));
      if (d.description) tx.appendChild(h('span', { class: 'lc-desc small', text: d.description }));
      card.appendChild(tx);
    }
    var e0 = PV.cache[url];
    if (e0 && (e0.state === 'ok' || e0.state === 'none')) { setTimeout(function () { fill(e0); }, 0); return card; }
    if (typeof IntersectionObserver === 'undefined') { setTimeout(function () { pvRequest(url, fill); }, 0); return card; }
    if (!PV.io) PV.io = new IntersectionObserver(function (ents) { ents.forEach(function (en) { if (en.isIntersecting) { PV.io.unobserve(en.target); en.target._go && en.target._go(); } }); }, { rootMargin: '200px' });
    card._go = function () { pvRequest(url, fill); };
    PV.io.observe(card);
    return card;
  }
  function msgExtras(m) {
    var md = mediaOf(m);
    if (md) return previewsOn() ? mediaNode(m, md) : h('p', { class: 'small muted', text: (md.type === 'sticker' ? 'Sticker' : 'GIF') + ' hidden. Turn on link previews and GIFs in Chat settings to see it.' });
    if (!previewsOn()) return null;
    var g = gifOf(m);
    if (g) { var gi = h('img', { class: 'gif-img', src: g, alt: 'GIF', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }); zoomable(gi, g, 'GIF'); return h('div', { class: 'gif-wrap' }, gi, h('span', { class: 'gif-credit small muted', text: 'via GIPHY' })); }
    var first = splitLinks(String(m.body || '')).filter(function (p) { return p.u; })[0];
    return first ? previewCard(first.u) : null;
  }
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
  function convOpen(c, cv) { var ch = cv.kind === 'channel' ? channelById(c, cv.id) : null, dm = cv.kind === 'dm' ? dmById(c, cv.id) : null; return ch ? !ch.archived : (dm ? dm.status === 'open' : false); }
  function reactionRow(c, cv, m) {
    var by = cv.react.get(m.$id); if (!by || !by.size) return null;
    var row = h('div', { class: 'msg-reacts' });
    by.forEach(function (set, e) { if (!set || !set.size) return; var mine = set.has(c.uid);
      row.appendChild(h('button', { class: 'react' + (mine ? ' mine' : ''), type: 'button', 'aria-pressed': mine ? 'true' : 'false', 'aria-label': e + ' ' + set.size + (set.size === 1 ? ' person' : ' people') + (mine ? ', including you' : ''), onclick: function () { react(c, cv, m, e); } }, e + ' ' + set.size)); });
    if (!row.firstChild) return null;
    if (convOpen(c, cv)) row.appendChild(h('button', { class: 'react add', type: 'button', 'aria-label': 'Add another reaction', text: '+', onclick: function () { emojiPicker(c, cv, m); } }));
    return row;
  }
  /** Press and hold (touch) or right-click (mouse) on a message runs fn, like Discord. Buttons, links and boxes keep working normally. */
  function attachHold(node, fn) {
    var t = null, sx = 0, sy = 0, fired = false;
    function cancel() { clearTimeout(t); t = null; }
    node.addEventListener('pointerdown', function (ev) {
      if (ev.pointerType === 'mouse' || (ev.target.closest && ev.target.closest('a, button, input, textarea'))) return;
      sx = ev.clientX; sy = ev.clientY; fired = false; cancel();
      t = setTimeout(function () { t = null; fired = true; try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* ok */ } fn(); }, 420);
    });
    node.addEventListener('pointermove', function (ev) { if (t && (Math.abs(ev.clientX - sx) > 10 || Math.abs(ev.clientY - sy) > 10)) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (n) { node.addEventListener(n, cancel); });
    node.addEventListener('contextmenu', function (ev) { if (ev.target.closest && ev.target.closest('a')) return; ev.preventDefault(); cancel(); if (!fired) fn(); fired = false; });
  }
  // "Leia started a call": a card in the history. The Join button is on the newest call card, and only while the call is running.
  function callCard(c, cv, m) {
    var lastCall = null; cv.msgs.forEach(function (x) { if (x.body === '[call]') lastCall = x; });
    var live = callIds(c, cv.id).length > 0 && lastCall && lastCall.$id === m.$id;
    var mine = window.FCCalls && window.FCCalls.inCall(cv.id);
    var who = m.authorId === c.uid ? 'You' : realName(m.authorId);
    var card = h('div', { class: 'call-card' + (live ? ' live' : ''), 'data-mid': m.$id },
      h('span', { class: 'cc-ic', 'aria-hidden': 'true' }, icon('phone')),
      h('div', { class: 'grow' }, h('strong', { text: who + ' started a call' }), h('div', { class: 'small muted', text: timeText(m.$createdAt) + (live ? (mine ? ' · you are in this call' : ' · happening now') : ' · ended') })),
      live && !mine ? h('button', { class: 'btn small call-join', type: 'button', text: 'Join call', onclick: function () { startCall(c, cv, false); } }) : null);
    return card;
  }
  function messageNode(c, cv, m, grouped) {
    if (m.body === '[call]' && !m.media) return callCard(c, cv, m);
    var mine = m.authorId === c.uid;
    var node = h('div', { class: 'msg' + (mine ? ' mine' : '') + (grouped ? ' grouped' : '') + (m._local ? ' local' : ''), 'data-mid': m.$id });
    node.appendChild(grouped ? h('span', { class: 'av-spacer', 'aria-hidden': 'true' }) : openable(avWrap(C, m.authorId, 'sm'), C, m.authorId, 'Open ' + realName(m.authorId) + '’s profile'));
    var main = h('div', { class: 'msg-main' });
    if (!grouped) main.appendChild(h('div', { class: 'msg-head' }, openable(h('strong', { text: realName(m.authorId) }), C, m.authorId, 'Open ' + realName(m.authorId) + '’s profile'), h('time', { datetime: m.$createdAt, class: 'small muted', text: ' ' + timeText(m.$createdAt) })));
    var rp = replyPreview(c, cv, m); if (rp) main.appendChild(rp);
    var body = h('div', { class: 'msg-bubble', title: fullTime(m.$createdAt) }, msgText(m));
    if (m.editedAt) body.appendChild(h('span', { class: 'msg-edited small muted', title: 'Edited ' + fullTime(m.editedAt), text: ' (edited)' }));
    main.appendChild(body);
    var ex = msgExtras(m); if (ex) main.appendChild(ex);
    var rr = reactionRow(c, cv, m); if (rr) main.appendChild(rr);
    if (m._local) {
      if (m._status === 'sending') main.appendChild(h('div', { class: 'msg-status small muted', role: 'status', text: 'Sending…' }));
      else main.appendChild(h('div', { class: 'msg-status small failed', role: 'alert' }, 'Not sent. ' + (m._err || ''), ' ',
        h('button', { class: 'link-btn', type: 'button', text: 'Retry', onclick: function () { doSend(c, cv, m); } }), ' · ', h('button', { class: 'link-btn', type: 'button', text: 'Remove', onclick: function () { cv.msgs = cv.msgs.filter(function (x) { return x !== m; }); paintMessages('keep'); } })));
    } else {
      if (grouped) body.setAttribute('title', fullTime(m.$createdAt));
      attachHold(node, function () { messageMenu(c, cv, m); });
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
    var prevH = list.scrollHeight, prevTop = list.scrollTop, wasBottom = nearBottom() || (mode === 'keep' && (c.kbd || c.stick === true && prevH - prevTop - list.clientHeight < 400));
    if (c.ro) { try { c.ro.disconnect(); } catch (e) { /* ok */ } c.ro = null; }
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
    var pinBottom = mode === 'bottom' || (mode === 'keep' && wasBottom);
    if (pinBottom) { c.stick = true; list.scrollTop = list.scrollHeight; }
    // Pictures, link cards and GIFs grow after they are drawn. While you are at the bottom (or typing), keep the bottom in view.
    if (window.ResizeObserver) {
      c.ro = new ResizeObserver(function () { if ((c.stick || c.kbd) && C === c && c.cur === cv) { var l = listScroller(); if (l) l.scrollTop = l.scrollHeight; } });
      [].slice.call(list.querySelectorAll('.msg')).slice(-40).forEach(function (n) { c.ro.observe(n); });
    }
    if (pinBottom) { /* done above */ }
    else if (mode === 'divider') { if (dividerNode) list.scrollTop = Math.max(0, dividerNode.offsetTop - 60); else list.scrollTop = list.scrollHeight; }
    else if (mode === 'prepend') list.scrollTop = list.scrollHeight - prevH + prevTop;
    else list.scrollTop = prevTop;
    paintJump();
  }


  /* ---------- calls: the "call in progress" banner and the start buttons (the call screen itself is calls.js) ---------- */
  function callIds(c, convId) {
    var m = c.calls[convId] || {}, now = Date.now(), out = [];
    Object.keys(m).forEach(function (uid) { if (m[uid] > now) out.push(uid); });   // includes me, so a call I started on another device can be rejoined here
    return out;
  }
  function callsAvailable() { return !!window.FCCalls; }
  function onCallEvent(c, kind, row) {
    (c.dbg = c.dbg || { evs: [] }).evs.unshift({ at: Date.now(), kind: kind, uid: row.userId, conv: String(row.convId).slice(5), until: Date.parse(row.until || '') }); c.dbg.evs.length = Math.min(c.dbg.evs.length, 6);
    var convId = String(row.convId).slice(5), u = kind === 'delete' ? 0 : Date.parse(row.until || '');
    var m = c.calls[convId] || (c.calls[convId] = {}), was = callIds(c, convId).length;
    if (u > Date.now()) m[row.userId] = u; else delete m[row.userId];
    if (row.userId !== c.uid && !was && callIds(c, convId).length && !(window.FCCalls && window.FCCalls.inCall(convId))) {
      var dm = dmById(c, convId);
      toast(realName(row.userId) + (dm ? ' is calling you.' : ' started a call in ' + ((channelById(c, convId) || {}).name ? '#' + channelById(c, convId).name : 'chat') + '.'));
      try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* ok */ }
    }
    paintCallBanner(c); paintList(); paintDebug(c);
    if (c.cur && c.cur.id === convId) paintMessages('keep');   // the call card's Join button follows the call
  }
  async function loadCalls(c) {
    try {
      var r = await X.db.listRows({ databaseId: dbId(), tableId: 'chatTyping', queries: [X.Query.startsWith('convId', 'call:'), X.Query.limit(100)] });
      c.dbg = c.dbg || { evs: [] }; var all = (r.rows || r.documents || []);
      c.dbg.load = 'ok ' + new Date().toLocaleTimeString() + ': ' + all.length + ' call row(s) on the server, ' + all.filter(function (x) { return x.familyId === c.famId; }).length + ' for this family' + (all.length ? ', newest until ' + new Date(Math.max.apply(null, all.map(function (x) { return Date.parse(x.until || '') || 0; }))).toLocaleTimeString() : '');
      var before = {}; Object.keys(c.calls).forEach(function (k) { before[k] = callIds(c, k).filter(function (u) { return u !== c.uid; }).length; });
      var sigBefore = JSON.stringify(Object.keys(c.calls).sort().map(function (k) { return k + ':' + callIds(c, k).sort().join(','); }));
      var next = {};
      all.forEach(function (row) { if (row.familyId === c.famId) { var u = Date.parse(row.until || ''); if (u > Date.now()) { var k = String(row.convId).slice(5); (next[k] || (next[k] = {}))[row.userId] = u; } } });
      c.calls = next;
      Object.keys(next).forEach(function (k) {   // a call from someone else that this device had not heard about (realtime missed it)
        var others = callIds(c, k).filter(function (u) { return u !== c.uid; });
        if (others.length && !before[k] && !(window.FCCalls && window.FCCalls.inCall(k))) {
          var dm = dmById(c, k), chn = channelById(c, k);
          toast(realName(others[0]) + (dm ? ' is calling you.' : ' started a call in ' + (chn && chn.name ? '#' + chn.name : 'chat') + '.'));
          try { if (navigator.vibrate) navigator.vibrate([120, 80, 120]); } catch (e) { /* ok */ }
        }
      });
      var sigAfter = JSON.stringify(Object.keys(c.calls).sort().map(function (k) { return k + ':' + callIds(c, k).sort().join(','); }));
      paintCallBanner(c); paintList();
      if (sigAfter !== sigBefore && c.cur) paintMessages('keep');   // the call card's Join button follows the call
    } catch (e) { (c.dbg = c.dbg || { evs: [] }).load = 'ERROR: ' + ((e && (e.message || e.code)) || e); }
    paintDebug(c);
  }
  /* ---------- call debug strip (Chat settings > "Show call debug at the top", or add ?debug to the address) ---------- */
  function dbgOn() { return false; }   // switched off for now; the strip code stays so it can be turned back on
  function paintDebug(c) {
    var el = document.getElementById('call-debug'); if (!el) return;
    if (!dbgOn() || !c || !c.cur) { el.hidden = true; return; }
    el.hidden = false; clear(el);
    var cv = c.cur, d = c.dbg || { evs: [] }, now = Date.now(), m = c.calls[cv.id] || {};
    var rows = Object.keys(m).map(function (u) { return (u === c.uid ? 'ME' : realName(u)) + ' ' + (m[u] > now ? Math.round((m[u] - now) / 1000) + 's left' : 'expired'); });
    var line = function (t) { el.appendChild(h('div', { text: t })); };
    line('CALL DEBUG  v' + ((window.FAMILY_CONFIG && window.FAMILY_CONFIG.version) || '?') + '  ' + new Date().toLocaleTimeString());
    line('You: ' + c.uid.slice(0, 6) + '…   family: ' + String(c.famId).slice(0, 6) + '…   chat: ' + cv.kind + ' ' + String(cv.id).slice(0, 6) + '…');
    line('Realtime: ' + (d.rt || 'not started') + '   polling calls every 5s: ' + (c.timers && c.timers.callPoll ? 'on' : 'off'));
    line('Online: ' + (c.online === false ? 'NO' : 'yes') + '   realtime events seen: ' + (d.anyCount || 0) + (d.lastAny ? ' (last ' + Math.round((now - d.lastAny) / 1000) + 's ago)' : ' (none yet)'));
    line('Calls library loaded: ' + (window.FCCalls ? 'yes' : 'NO') + '   I am in this call here: ' + (window.FCCalls && window.FCCalls.inCall(cv.id) ? 'yes' : 'no'));
    line('People in this call (as known): ' + (rows.length ? rows.join(', ') : 'nobody') + '   live count: ' + callIds(c, cv.id).length);
    line('Last load: ' + (d.load || 'not run yet'));
    var ev = d.evs.slice(0, 4).map(function (e) { return Math.round((now - e.at) / 1000) + 's ago ' + e.kind + ' ' + (e.uid === c.uid ? 'ME' : realName(e.uid)) + (e.conv === cv.id ? '' : ' (other chat)') + ' until ' + (e.until ? Math.round((e.until - e.at) / 1000) + 's after arrival' : 'invalid'); });
    line('Call events received: ' + (ev.length ? ev.join('  |  ') : 'none'));
    var lastCard = null; (cv.msgs || []).forEach(function (x) { if (x.body === '[call]') lastCard = x; });
    line('Newest call card: ' + (lastCard ? Math.round((now - Date.parse(lastCard.$createdAt)) / 1000) + 's ago by ' + (lastCard.authorId === c.uid ? 'ME' : realName(lastCard.authorId)) : 'none') + '   banner showing: ' + (document.getElementById('call-banner') && !document.getElementById('call-banner').hidden ? 'yes' : 'no'));
    el.appendChild(h('div', { class: 'cd-row' }, h('button', { class: 'btn small', type: 'button', text: 'Refresh now', onclick: function () { loadCalls(c); } }),
      h('button', { class: 'btn small secondary', type: 'button', text: 'Hide', onclick: function () { lsSet('fc_chat_dbg', false); paintDebug(c); } })));
  }
  function startCall(c, cv, video) {
    if (!window.FCCalls) { toast('Calls could not load. Reload the page and try again.'); return; }
    var dm = cv.kind === 'dm' ? dmById(c, cv.id) : null, ch = cv.kind === 'channel' ? channelById(c, cv.id) : null;
    window.FCCalls.start({ h: h, toast: toast, familyId: c.famId, kind: cv.kind, convId: cv.id, video: !!video,
      title: dm ? realName(dm.otherId) : (ch ? '#' + ch.name + ' · ' + famLabel() : 'Family call'),
      api: function (a, p) { return X.api(a, Object.assign({ familyId: c.famId }, p || {})); },
      nameOf: function (uid) { return realName(uid); }, avatarEl: function (uid, cls) { return avatar(uid, cls || 'lg'); },
      onEnd: function () { if (C) paintCallBanner(C); } });
  }
  function paintCallBanner(c) {
    var el = document.getElementById('call-banner'); if (!el || !c.cur) return;
    var ids = callIds(c, c.cur.id), mine = window.FCCalls && window.FCCalls.inCall(c.cur.id);
    el.hidden = !ids.length || !!mine; if (el.hidden) return;
    clear(el);
    el.appendChild(h('span', { class: 'grow', text: ids.map(function (u) { return u === c.uid ? 'You' : realName(u); }).join(', ') + (ids.length > 1 || ids[0] === c.uid ? ' are' : ' is') + ' in a call' + (ids.length === 1 && ids[0] === c.uid ? ' on another device' : '') }));
    el.appendChild(h('button', { class: 'btn small call-join', type: 'button', text: 'Join call', onclick: function () { startCall(c, c.cur, false); } }));
    el.appendChild(h('button', { class: 'btn small secondary call-join', type: 'button', text: 'Join with video', onclick: function () { startCall(c, c.cur, true); } }));
  }

  /* ---------- "online now" (a heartbeat while the chat is open and the page is visible; it expires by itself) ---------- */
  function presenceOn() { return lsGet('fc_chat_presence', true) !== false; }
  function isHere(c, uid) { if (uid === c.uid) return presenceOn(); var u = c.here[uid]; return !!u && u > Date.now(); }
  function hereCount(c) { return memberList(c).filter(function (p) { return p.userId !== c.uid && isHere(c, p.userId); }).length + (presenceOn() ? 1 : 0); }
  function onPresenceEvent(c, kind, row) {
    if (row.userId === c.uid) return;
    if (kind === 'delete') delete c.here[row.userId];
    else { var u = Date.parse(row.until || ''); if (u > Date.now()) c.here[row.userId] = u; else delete c.here[row.userId]; }
    repaintHere(c);
  }
  function repaintHere(c) { if (C === c) { syncDots(c); paintList(); var sd = host && host.querySelector('.chat-side'); if (sd && c.route.mode === 'dms') sd.replaceWith(buildSide(c)); } }
  async function loadPresence(c) {
    try {
      var r = await X.db.listRows({ databaseId: dbId(), tableId: 'chatTyping', queries: [X.Query.equal('convId', ['presence']), X.Query.limit(100)] });
      (r.rows || r.documents || []).forEach(function (row) { if (row.familyId === c.famId && row.userId !== c.uid) { var u = Date.parse(row.until || ''); if (u > Date.now()) c.here[row.userId] = u; } });
      repaintHere(c);
    } catch (e) { /* the dots simply stay off until the next event */ }
  }
  function beat(c) {
    if (C !== c || document.hidden || !presenceOn() || c.online === false) return;
    if (Date.now() - (c.beatAt || 0) < 30000) return; c.beatAt = Date.now();
    api('chatPresence', {}).then(function () { c.presErr = ''; c.presOkAt = Date.now(); }, function (e) { c.presErr = (e && (e.apiCode || e.code)) ? String(e.apiCode || e.code) + ': ' + msgOf(e) : msgOf(e); });   // never a pop-up
  }
  function startPresence(c) {
    if (c.presenceOn) return; c.presenceOn = true;
    loadPresence(c); loadCalls(c); loadDmLast(c); beat(c);
    c.timers.beat = setInterval(function () { beat(c); }, 45000);
    c.timers.expire = setInterval(function () { if (C === c && !document.hidden) { repaintHere(c); paintCallBanner(c); } }, 30000);
    // Live updates for calls and call cards must not depend on realtime alone: ask every few seconds while the chat is open.
    c.timers.callPoll = setInterval(function () { if (C === c && !document.hidden) { loadCalls(c); if (c.cur && (!c.dbg || !c.dbg.anyCount)) catchUp(c); } }, 5000);
    c.timers.typePoll = setInterval(function () { if (C === c && !document.hidden && c.cur && !(c.live && c.dbg && c.dbg.anyCount)) loadTyping(c); }, 2500);
    c.timers.dbg = setInterval(function () { if (C === c && !document.hidden && dbgOn()) paintDebug(c); }, 2000);
    listen(c, document, 'visibilitychange', function () { if (!document.hidden) { beat(c); loadPresence(c); } });
  }
  /** A picture with a live green dot. The dot is added or removed in place when someone comes or goes (no redraw of the messages). */
  function avWrap(c, uid, cls) { var w = h('span', { class: 'av-wrap', 'data-uid': uid }, avatar(uid, cls || 'sm')); var d = onlineDot(c, uid); if (d) w.appendChild(d); return w; }
  function syncDots(c) {
    Array.prototype.forEach.call(document.querySelectorAll('.av-wrap[data-uid]'), function (w) {
      var uid = w.getAttribute('data-uid'), has = w.querySelector('.online-dot'), on = isHere(c, uid);
      if (on && !has) w.appendChild(h('span', { class: 'online-dot', title: 'Online now', 'aria-label': 'online now' })); else if (!on && has) has.remove();
    });
  }
  function onlineDot(c, uid) { return isHere(c, uid) ? h('span', { class: 'online-dot', title: 'Online now', 'aria-label': 'online now' }) : null; }


  /* ---------- who is online, shown on the circles at the top of Home (works without opening chat) ---------- */
  var GP = { here: {}, t: null, beatAt: 0 };
  function onlineNow(uid) {
    if (uid === me()) return presenceOn();
    var u = GP.here[uid] || (C && C.here && C.here[uid]) || 0; return u > Date.now();
  }
  function paintStoryDots(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-online-uid]'), function (el) {
      var uid = el.getAttribute('data-online-uid'), has = el.querySelector('.online-dot'), on = onlineNow(uid);
      if (on && !has) el.appendChild(h('span', { class: 'online-dot', title: 'Online now', 'aria-label': 'online now' })); else if (!on && has) has.remove();
    });
  }
  function presenceWatch(root) {
    if (!X || !enabled() || !famId() || !root) return;
    if (GP.t) { clearInterval(GP.t); GP.t = null; }
    async function tick() {
      if (!root.isConnected) { clearInterval(GP.t); GP.t = null; return; }
      if (document.hidden) return;
      if (presenceOn() && Date.now() - GP.beatAt > 30000) { GP.beatAt = Date.now(); api('chatPresence', {}).catch(function () { /* the next check tries again */ }); }
      try {
        var r = await X.db.listRows({ databaseId: dbId(), tableId: 'chatTyping', queries: [X.Query.equal('convId', ['presence']), X.Query.limit(100)] });
        var here = {};
        (r.rows || r.documents || []).forEach(function (row) { if (row.familyId === famId() && row.userId !== me()) { var u = Date.parse(row.until || ''); if (u > Date.now()) here[row.userId] = u; } });
        GP.here = here;
      } catch (e) { /* the dots keep their last state until the next check */ }
      if (root.isConnected) paintStoryDots(root);
    }
    paintStoryDots(root); tick(); GP.t = setInterval(tick, 20000);
  }

  /* ---------- "is typing" (what others see while you type; wording is yours to choose) ---------- */
  var TYPING_DEFAULT = 'is typing';
  function typingOn() { return lsGet('fc_chat_typing', true) !== false; }
  function typingWords() { var v = lsGet('fc_chat_typing_text', ''); v = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 40) : ''; return v || TYPING_DEFAULT; }
  function onTypingEvent(c, kind, row) {
    if (row.convId === 'presence') return onPresenceEvent(c, kind, row);
    if (String(row.convId).indexOf('call:') === 0) return onCallEvent(c, kind, row);
    if (kind === 'delete' || row.userId === c.uid) return;
    var until = Date.parse(row.until || ''); if (!(until > Date.now())) return;
    var byConv = c.typing[row.convId] || (c.typing[row.convId] = {});
    byConv[row.userId] = { text: String(row.text || '').slice(0, 40) || TYPING_DEFAULT, until: until };
    paintTyping(c);
    clearTimeout(c.typingTimer); c.typingTimer = setTimeout(function () { paintTyping(c); }, Math.max(300, until - Date.now() + 100));
  }
  function typingLine(c) {
    if (!c.cur) return '';
    var byConv = c.typing[c.cur.id] || {}, now = Date.now(), out = [];
    Object.keys(byConv).forEach(function (uid) {
      var e = byConv[uid]; if (e.until <= now) { delete byConv[uid]; return; }
      if (c.blocked.indexOf(uid) >= 0) return;
      out.push({ name: realName(uid), text: e.text });
    });
    if (!out.length) return '';
    if (out.length > 3) return out.length + ' people are typing…';
    return out.map(function (o) { return o.name + ' ' + o.text; }).join(' · ') + '…';
  }
  /** When live updates are not reaching this device, look for "is typing" rows every few seconds instead. */
  async function loadTyping(c) {
    if (!c.cur) return;
    try {
      var id = c.cur.id, r = await X.db.listRows({ databaseId: dbId(), tableId: 'chatTyping', queries: [X.Query.equal('convId', [id]), X.Query.limit(20)] });
      if (C !== c || !c.cur || c.cur.id !== id) return;
      var fresh = {};
      (r.rows || r.documents || []).forEach(function (row) { var u = Date.parse(row.until || ''); if (row.familyId === c.famId && row.userId !== c.uid && u > Date.now()) fresh[row.userId] = { text: String(row.text || '').slice(0, 40) || TYPING_DEFAULT, until: u }; });
      c.typing[id] = fresh; paintTyping(c);
    } catch (e) { /* the next check tries again */ }
  }
  function paintTyping(c) {
    var el = document.getElementById('typing-line'); if (!el) return;
    var s = typingLine(c); el.textContent = s; el.hidden = !s;
  }
  /** Tells the server I am typing, at most every 4 seconds, and only while someone could see it (realtime is on). */
  function pingTyping(c, cv, ta) {
    if (!typingOn() || !ta.value.trim() || /^\s*\//.test(ta.value)) return;
    var now = Date.now(); if (now - (c.typingSentAt || 0) < 4000) return; c.typingSentAt = now;
    api('chatTyping', { kind: cv.kind, convId: cv.id, text: typingWords() === TYPING_DEFAULT ? '' : typingWords() })
      .then(function (r) { c.typingErr = ''; c.typingOkAt = Date.now(); return r; },
        function (e) { c.typingErr = (e && (e.apiCode || e.code)) ? String(e.apiCode || e.code) + ': ' + msgOf(e) : msgOf(e); });   // never an error pop-up while typing
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
    var emojiBtn = h('button', { class: 'btn ghost gif-btn emoji-btn', type: 'button', 'aria-label': 'Add an emoji', text: '\u{1F60A}', onclick: function () {
      emojiPicker(c, cv, null, function (e) {
        var a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd;
        if (ta.maxLength > 0 && ta.value.length - (b - a) + e.length > ta.maxLength) return;
        ta.value = ta.value.slice(0, a) + e + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + e.length;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } });
    var gifBtn = h('button', { class: 'btn ghost gif-btn', type: 'button', 'aria-label': 'Choose a GIF or sticker', text: 'GIF', onclick: function () { gifPicker(c, function (media, caption) { sendText(c, cv, caption, reply ? reply.$id : '', media); setReply(null); }); } });
    var send = h('button', { class: 'btn ghost send-btn', type: 'submit', 'aria-label': 'Send message' }, icon('send'));
    function grow() { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; var n = ta.value.length; count.hidden = n < c.limits.body - 150; count.textContent = n + ' / ' + c.limits.body; c.drafts[cv.id] = ta.value; send.disabled = !ta.value.trim(); }
    function setReply(m) { reply = m; replyBar.hidden = !m; clear(replyBar); if (m) { replyBar.appendChild(h('span', { class: 'clamp' }, 'Replying to ', h('strong', { text: realName(m.authorId) }), ': ' + m.body)); replyBar.appendChild(h('button', { class: 'btn secondary small', type: 'button', 'aria-label': 'Cancel reply', text: '×', onclick: function () { setReply(null); ta.focus(); } })); ta.focus(); } }
    cv.setReply = setReply;
    ta.addEventListener('input', grow);
    // Keyboard mode: while the message box has focus the newest messages stay in view, until the keyboard is closed.
    function toBottom() { var l = listScroller(); if (l) l.scrollTop = l.scrollHeight; }
    ta.addEventListener('focus', function () { c.kbd = true; c.stick = true; toBottom(); setTimeout(toBottom, 120); setTimeout(toBottom, 350); setTimeout(toBottom, 700); });
    ta.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== ta) c.kbd = false; }, 150); });
    ta.addEventListener('input', function () { if (c.kbd) toBottom(); });
    ta.addEventListener('input', function () { pingTyping(c, cv, ta); });
    ta.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && isFine()) { ev.preventDefault(); form.requestSubmit(); } });
    var form = h('form', { class: 'composer', onsubmit: function (ev) {
      ev.preventDefault(); var t = ta.value.trim(); if (!t) return;
      if (t.length > c.limits.body) { toast('Messages can be up to ' + c.limits.body + ' characters.'); return; }
      sendText(c, cv, t, reply ? reply.$id : ''); ta.value = ''; c.drafts[cv.id] = ''; setReply(null); grow(); ta.focus();
    } }, replyBar, h('div', { class: 'composer-row' }, emojiBtn, gifBtn, ta, send), count);
    wrap.appendChild(h('div', { id: 'typing-line', class: 'typing-line small', role: 'status', 'aria-live': 'polite', hidden: true }));
    wrap.appendChild(form); grow(); setTimeout(function () { paintTyping(c); }, 0);
    return wrap;
  }

  /* ----- GIF and sticker picker -----
   * GIPHY's rules say searches must be made from the viewer's own browser (no proxying) and that no media addresses are stored.
   * So the browser searches GIPHY directly with the public key from config.js, and a message keeps only the GIPHY id. */
  function giphyKey() { return (X.CFG && X.CFG.giphyKey) || ''; }
  function gifPicker(c, onPick) {
    var body = h('div', { class: 'gp' }), kind = 'gifs', q = '', offset = 0, seq = 0, timer = 0, s, busyCtl = null;
    var tabs = h('div', { class: 'gp-tabs', role: 'group', 'aria-label': 'Type' });
    var search = h('input', { type: 'search', class: 'gp-search', placeholder: 'Search GIPHY', 'aria-label': 'Search GIFs and stickers', maxlength: 50, autocomplete: 'off', enterkeyhint: 'search' });
    var grid = h('div', { class: 'gp-grid', role: 'list' });
    var note = h('p', { class: 'small muted gp-note', role: 'status', 'aria-live': 'polite' });
    var retry = h('button', { class: 'btn secondary small', type: 'button', text: 'Try again', hidden: true });
    var more = h('button', { class: 'btn secondary small', type: 'button', text: 'Load more', hidden: true });
    var list = h('div', { class: 'gp-list' });
    var view = h('div', { class: 'gp-pre', hidden: true });
    function setKind(k) {
      kind = k; [].slice.call(tabs.children).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-k') === k ? 'true' : 'false'); });
      load(true);
    }
    [['gifs', 'GIFs'], ['stickers', 'Stickers']].forEach(function (k) {
      tabs.appendChild(h('button', { class: 'btn secondary small', type: 'button', 'aria-pressed': k[0] === kind ? 'true' : 'false', 'data-k': k[0], text: k[1], onclick: function () { setKind(k[0]); } }));
    });
    function fail(msg) { note.textContent = msg; retry.hidden = false; more.hidden = true; }
    function load(fresh) {
      if (!giphyKey()) { note.textContent = 'GIFs are not set up yet. The family owner needs to add a free GIPHY key to config.js (steps are in CHAT-GUIDE.md).'; return; }
      var my = ++seq; if (busyCtl) { try { busyCtl.abort(); } catch (e) { /* ok */ } }
      if (fresh) { offset = 0; clear(grid); }
      retry.hidden = true; more.hidden = true; note.textContent = 'Loading…';
      var p = new URLSearchParams({ api_key: giphyKey(), limit: '24', offset: String(offset), rating: 'g', bundle: 'messaging_non_clips' });
      if (q) { p.set('q', q); p.set('lang', 'en'); }
      busyCtl = window.AbortController ? new AbortController() : null;
      fetch('https://api.giphy.com/v1/' + kind + '/' + (q ? 'search' : 'trending') + '?' + p, { signal: busyCtl ? busyCtl.signal : undefined, referrerPolicy: 'no-referrer', credentials: 'omit' })
        .then(function (res) {
          if (res.status === 429) throw new Error('rate');
          if (res.status === 401 || res.status === 403) throw new Error('key');
          if (!res.ok) throw new Error('http');
          return res.json();
        }).then(function (json) {
          if (my !== seq || !C) return;   // a newer search already replaced this one
          var items = Array.isArray(json.data) ? json.data : [];
          items.forEach(function (g) {
            var im = g.images || {}, th = im.fixed_width_small || im.fixed_width || {}, full = im.fixed_width || im.downsized || {};
            var id = String(g.id || ''); if (!/^[A-Za-z0-9]{5,30}$/.test(id) || !/^https:\/\/(media\d*|i)\.giphy\.com\//.test(th.url || '') || !/^https:\/\/(media\d*|i)\.giphy\.com\//.test(full.url || '')) return;
            var item = { id: id, title: String(g.title || '').slice(0, 80), thumb: th.url, url: full.url, w: Number(full.width) || 200, h: Number(full.height) || 200 };
            grid.appendChild(h('div', { role: 'listitem' }, h('button', { class: 'gp-item', type: 'button', 'aria-label': (item.title || (kind === 'stickers' ? 'Sticker' : 'GIF')) + '. Preview', onclick: function () { showPreview(item); } },
              h('img', { src: item.thumb, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', onerror: function () { this.style.visibility = 'hidden'; } }))));
          });
          var total = Number((json.pagination || {}).total_count) || 0, next = offset + 24;
          note.textContent = grid.children.length ? '' : 'Nothing found. Try another word.';
          more.hidden = !(items.length && next < total && next <= 200); offset = next;
        }).catch(function (e) {
          if (my !== seq || (e && e.name === 'AbortError')) return;
          fail(e && e.message === 'rate' ? 'GIPHY says there have been too many searches. Wait a minute and try again.'
            : e && e.message === 'key' ? 'GIPHY did not accept the key in config.js. Check the guide, step 5b.'
            : 'GIPHY could not be reached. Check your connection and try again.');
        });
    }
    function showPreview(item) {
      list.hidden = true; clear(view); view.hidden = false;
      var cap = h('input', { type: 'text', class: 'gp-caption', maxlength: 200, placeholder: 'Add a caption (optional)', 'aria-label': 'Caption' });
      var send = h('button', { class: 'btn', type: 'button', text: 'Send' });
      var back = h('button', { class: 'btn secondary', type: 'button', text: 'Cancel' });
      back.addEventListener('click', function () { view.hidden = true; list.hidden = false; });
      send.addEventListener('click', function () {
        send.disabled = true; var media = { provider: 'giphy', type: kind === 'stickers' ? 'sticker' : 'gif', id: item.id, w: item.w, h: item.h, alt: item.title };
        s.close(); onPick(media, cap.value.replace(/\s+/g, ' ').trim());
      });
      view.appendChild(h('div', { class: 'gp-pre-img' + (kind === 'stickers' ? ' sticker' : '') }, h('img', { src: item.url, alt: item.title || (kind === 'stickers' ? 'Sticker preview' : 'GIF preview'), referrerpolicy: 'no-referrer', decoding: 'async' })));
      view.appendChild(cap); view.appendChild(h('div', { class: 'row gp-pre-btns' }, back, send));
      setTimeout(function () { try { send.focus({ preventScroll: true }); } catch (e) { /* ok */ } }, 0);
    }
    search.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { q = search.value.replace(/\s+/g, ' ').trim(); load(true); }, 400); });
    search.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(timer); q = search.value.replace(/\s+/g, ' ').trim(); load(true); } });
    more.addEventListener('click', function () { load(false); });
    retry.addEventListener('click', function () { load(false); });
    [tabs, search, grid, note, retry, more].forEach(function (n) { list.appendChild(n); });
    body.appendChild(list); body.appendChild(view);
    body.appendChild(h('p', { class: 'small muted gp-credit' }, h('strong', { text: 'Powered by GIPHY' }), '. Your search words and your device’s internet address go to GIPHY, which shows pictures from giphy.com. Filtering is set to “G”, which lowers the chance of unsuitable results but cannot guarantee it.'));
    s = sheet('GIFs and stickers', body, { onClose: function () { seq++; if (busyCtl) { try { busyCtl.abort(); } catch (e) { /* ok */ } } } });
    load(true);
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
      row.appendChild(h('button', { class: 'emoji more', type: 'button', 'aria-label': 'More reactions: every emoji', text: '+', onclick: function () { s.close(); emojiPicker(c, cv, m); } }));
      body.appendChild(row);
      body.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: function () { s.close(); if (cv.setReply) cv.setReply(m); } }, h('span', { class: 'grow', text: 'Reply' })));
    }
    body.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: function () { s.close(); copyText(m.body); } }, h('span', { class: 'grow', text: 'Copy text' })));
    if (mine && open) body.appendChild(h('button', { class: 'cs-row', type: 'button', onclick: function () { s.close(); editMessage(c, cv, m); } }, h('span', { class: 'grow', text: 'Edit' })));
    if (mine) body.appendChild(h('button', { class: 'cs-row danger-text', type: 'button', onclick: function () { s.close(); deleteMessage(c, cv, m, false); } }, h('span', { class: 'grow', text: 'Delete' })));
    else if (cv.kind === 'channel' && isManager(c)) body.appendChild(h('button', { class: 'cs-row danger-text', type: 'button', onclick: function () { s.close(); deleteMessage(c, cv, m, true); } }, h('span', { class: 'grow', text: 'Remove as ' + (c.role === 'owner' ? 'family owner' : 'chat admin') })));
    body.appendChild(h('p', { class: 'small muted', text: 'Sent ' + fullTime(m.$createdAt) + (m.editedAt ? ' · edited ' + fullTime(m.editedAt) : '') }));
    s = sheet('Message', body);
  }
  function copyText(t) {
    function fallback() { var ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied.'); } catch (e) { toast('Could not copy.'); } document.body.removeChild(ta); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('Copied.'); }, fallback); else fallback();
  }

  /* ----- emoji picker: every emoji, with search, skin tones and recently used. The list (about 45 KB) loads the first time it is opened. ----- */
  var EMOJI_P = null, TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'], CAT_ICON = ['\u{1F600}', '\u{1F44B}', '\u{1F43B}', '\u{1F354}', '\u2708\uFE0F', '\u26BD', '\u{1F4A1}', '\u2764\uFE0F', '\u{1F3C1}'];
  function loadEmoji() {
    if (window.FC_EMOJI) return Promise.resolve(window.FC_EMOJI);
    if (!EMOJI_P) EMOJI_P = new Promise(function (res, rej) {
      var me = document.querySelector('script[src*="chat.js"]'), sc = document.createElement('script');
      sc.src = me ? me.src.replace('chat.js', 'emoji-data.js') : 'emoji-data.js';
      sc.onload = function () { window.FC_EMOJI ? res(window.FC_EMOJI) : rej(new Error('empty')); }; sc.onerror = function () { EMOJI_P = null; rej(new Error('load')); };
      document.head.appendChild(sc);
    });
    return EMOJI_P;
  }
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ok */ } }
  /** Puts a skin tone after each person in an emoji. Anything that would be too long for a reaction keeps its default look. */
  function withTone(e, tone) {
    if (!tone) return e;
    try {
      var cps = Array.from(e), out = '';
      for (var i = 0; i < cps.length; i++) { out += cps[i]; if (/\p{Emoji_Modifier_Base}/u.test(cps[i])) { out += tone; if (cps[i + 1] === '\uFE0F') i++; } }
      return out.length <= 8 ? out : e;
    } catch (err) { return e; }
  }
  function emojiPicker(c, cv, m, onPick) {
    var body = h('div', { class: 'ep' }), grid = h('div', { class: 'ep-grid', role: 'group', 'aria-label': 'Emoji' });
    var s = sheet(onPick ? 'Emoji' : 'Add reaction', body), tone = lsGet('fc_chat_tone', 0), cat = 0, data = null;
    var search = h('input', { type: 'search', 'aria-label': 'Search emoji', placeholder: 'Search emoji', autocomplete: 'off' });
    var tabs = h('div', { class: 'ep-tabs', role: 'group', 'aria-label': 'Emoji groups' }), tonesEl = h('div', { class: 'ep-tones', role: 'group', 'aria-label': 'Skin tone' });
    body.appendChild(h('div', { class: 'spin-line muted small', text: 'Loading emoji…' }));
    function pick(e) { if (!onPick) s.close(); var r = lsGet('fc_chat_recent', []).filter(function (x) { return x !== e; }); r.unshift(e); lsSet('fc_chat_recent', r.slice(0, 24)); var cn = lsGet('fc_chat_count', {}); cn[e] = (cn[e] || 0) + 1; lsSet('fc_chat_count', cn); if (onPick) { onPick(e); if (cat === 0 && !search.value.trim()) paint(); } else react(c, cv, m, e); }
    function parse(str) { var skin = str.charAt(0) === '~'; if (skin) str = str.slice(1); var i = str.indexOf(' '); return { e: str.slice(0, i), n: str.slice(i + 1), skin: skin }; }
    function favs() { return lsGet('fc_chat_fav', []); }
    function toggleFav(e) { var f = favs(), i = f.indexOf(e); if (i >= 0) { f.splice(i, 1); toast('Removed from favorites'); } else { f.unshift(e); toast('Added to favorites'); } lsSet('fc_chat_fav', f.slice(0, 48)); paint(); }
    /** One tap picks. A double tap or a long press toggles favorite instead (a single tap waits a moment to see if a second one follows). */
    function emojiBtn(e, label) {
      var isFav = favs().indexOf(e) >= 0, timer = null, lp = null, held = false, tapAt = 0;
      var b = h('button', { class: 'ep-e' + (isFav ? ' fav' : ''), type: 'button', title: label + (isFav ? ' (favorite)' : ''), 'aria-label': label + (isFav ? ', favorite' : ''), text: e });
      b.addEventListener('pointerdown', function () { held = false; clearTimeout(lp); lp = setTimeout(function () { held = true; clearTimeout(timer); tapAt = 0; if (navigator.vibrate) { try { navigator.vibrate(15); } catch (x) { /* ok */ } } toggleFav(e); }, 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { b.addEventListener(t, function () { clearTimeout(lp); }); });
      b.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
      b.addEventListener('keydown', function (ev) { if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); toggleFav(e); } });
      b.addEventListener('click', function () {
        if (held) { held = false; return; }
        var t = Date.now();
        if (tapAt && t - tapAt < 320) { clearTimeout(timer); tapAt = 0; toggleFav(e); return; }
        tapAt = t; clearTimeout(timer); timer = setTimeout(function () { tapAt = 0; pick(e); }, 330);
      });
      return b;
    }
    function btn(it) { var e = it.skin ? withTone(it.e, TONES[tone]) : it.e; return emojiBtn(e, it.n); }
    function paint() {
      clear(grid); var q = search.value.trim().toLowerCase();
      tabs.hidden = !!q;
      if (q) {
        var n = 0; data.forEach(function (g) { g[1].forEach(function (str) { if (n >= 150) return; var it = parse(str); if (it.n.toLowerCase().indexOf(q) >= 0) { grid.appendChild(btn(it)); n++; } }); });
        if (!n) grid.appendChild(h('p', { class: 'muted small', text: 'No emoji match "' + search.value.trim() + '".' }));
      } else if (cat === 0) {
        var fv = favs(), cn = lsGet('fc_chat_count', {}), rc = lsGet('fc_chat_recent', []);
        var freq = Object.keys(cn).sort(function (a, b) { return cn[b] - cn[a] || rc.indexOf(a) - rc.indexOf(b); }).slice(0, 24);
        if (!freq.length) freq = rc.slice(0, 24);
        grid.appendChild(h('p', { class: 'ep-h', text: 'Favorites' }));
        if (!fv.length) grid.appendChild(h('p', { class: 'muted small', text: 'Double-tap or hold any emoji to add it here.' }));
        fv.forEach(function (e) { grid.appendChild(emojiBtn(e, e)); });
        grid.appendChild(h('p', { class: 'ep-h', text: 'Frequently used' }));
        if (!freq.length) grid.appendChild(h('p', { class: 'muted small', text: 'The emoji you use most show up here.' }));
        freq.forEach(function (e) { grid.appendChild(emojiBtn(e, e)); });
      } else data[cat - 1][1].forEach(function (str) { grid.appendChild(btn(parse(str))); });
      grid.scrollTop = 0;
    }
    function paintChrome() {
      clear(tabs); clear(tonesEl);
      ['\u2B50'].concat(CAT_ICON).forEach(function (ic, i) { tabs.appendChild(h('button', { class: 'ep-tab', type: 'button', 'aria-pressed': i === cat ? 'true' : 'false', 'aria-label': i === 0 ? 'Favorites and frequently used' : data[i - 1][0], title: i === 0 ? 'Favorites and frequently used' : data[i - 1][0], text: ic, onclick: function () { cat = i; paintChrome(); paint(); } })); });
      TONES.forEach(function (t, i) { tonesEl.appendChild(h('button', { class: 'ep-tone', type: 'button', 'aria-pressed': i === tone ? 'true' : 'false', 'aria-label': i === 0 ? 'Default skin tone' : 'Skin tone ' + i, text: '\u{1F44B}' + t, onclick: function () { tone = i; lsSet('fc_chat_tone', i); paintChrome(); paint(); } })); });
    }
    loadEmoji().then(function (d) {
      data = d; clear(body);
      if (!lsGet('fc_chat_recent', []).length && !favs().length) cat = 1;
      body.appendChild(search); body.appendChild(tonesEl); body.appendChild(tabs); body.appendChild(grid);
      search.addEventListener('input', paint); paintChrome(); paint();
    }).catch(function () { clear(body); body.appendChild(h('p', { class: 'muted', text: 'The emoji list could not load. Check your connection and try again.' })); });
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
      var row = h('div', { class: 'cs-member' }, h('span', { class: 'av-wrap' }, avatar(p.userId, 'sm'), onlineDot(c, p.userId)), h('div', { class: 'grow' }, h('strong', { text: p.displayName + (isMe ? ' (you)' : '') }), isHere(c, p.userId) ? h('span', { class: 'badge online-badge', text: ' Online' }) : null, role ? h('span', { class: 'badge', text: ' ' + role }) : null));
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
    if (c.standalone) { location.hash = '#/dms/' + r.dm.id; return; }   // opened from a Short, chat itself is not open yet
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
    var pv = h('input', { type: 'checkbox', id: 'cs-pv' }); pv.checked = previewsOn();
    pv.addEventListener('change', function () { lsSet('fc_chat_previews', pv.checked); pvReset(); if (C) paintMessages('keep'); toast(pv.checked ? 'Link previews and GIFs are on.' : 'Link previews and GIFs are off.'); });
    if (isManager(c)) {
      body.appendChild(h('h3', { text: 'Family chat picture' }));
      body.appendChild(h('p', { class: 'small muted', text: 'Shown instead of the letter at the top of the left bar, for everyone in ' + famLabel() + '. Square pictures look best.' }));
      var picMsg = h('p', { class: 'small', role: 'status' });
      var file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', id: 'cs-pic', class: 'visually-hidden', 'aria-label': 'Choose a family chat picture' });
      var pick = h('button', { class: 'btn secondary small', type: 'button', text: c.picture ? 'Change picture' : 'Upload picture', onclick: function () { file.click(); } });
      var drop = h('button', { class: 'btn secondary small', type: 'button', text: 'Remove picture', hidden: !c.picture, onclick: async function () {
        drop.disabled = true;
        try { await api('chatPicture', { fileId: '' }); c.picture = ''; paintList(); s.close(); toast('Family chat picture removed.'); } catch (e) { drop.disabled = false; picMsg.textContent = msgOf(e); }
      } });
      file.addEventListener('change', async function () {
        var f = file.files && file.files[0]; if (!f) return;
        pick.disabled = true; picMsg.textContent = 'Uploading…'; var up = '';
        try {
          up = await X.uploadPicture(f);
          var r = await api('chatPicture', { fileId: up }); up = '';
          c.picture = r.picture; paintList(); s.close(); toast('Family chat picture updated.');
        } catch (e) { if (up) X.deletePicture(up); pick.disabled = false; picMsg.textContent = msgOf(e); }
      });
      body.appendChild(h('div', { class: 'row' }, pick, drop, file)); body.appendChild(picMsg);
    }
    body.appendChild(h('h3', { text: 'Links and GIFs' }));
    body.appendChild(h('label', { class: 'check' }, pv, ' Show link previews and GIFs on this device'));
    body.appendChild(h('p', { class: 'small muted', text: 'A preview is made by the family server visiting the link, so your device never contacts that website. GIFs load straight from GIPHY, which can see your internet address. Turn this off to see plain links only.' }));
    body.appendChild(h('h3', { text: 'Online status' }));
    var pOn = h('input', { type: 'checkbox' }); pOn.checked = presenceOn();
    pOn.addEventListener('change', function () { lsSet('fc_chat_presence', pOn.checked); if (pOn.checked) { c.beatAt = 0; beat(c); } repaintHere(c); toast(pOn.checked ? 'Others can see when you are online.' : 'Others will see you as offline within about two minutes.'); });
    body.appendChild(h('label', { class: 'check' }, pOn, ' Show family when I am online'));
    var pStat = !presenceOn() ? 'You are hidden: others see you as offline.' : c.presErr ? 'Your online signal did not reach the server (' + c.presErr + '). Upload the newest family-api zip (CHAT-GUIDE.md, "Online status"), then reopen chat.' : c.presOkAt ? 'Your online signal is reaching the server. Others see a green dot while their chat is open and you have chat or the app open.' : 'Waiting for the first online signal…';
    body.appendChild(h('p', { class: 'small ' + (c.presErr ? 'err' : 'muted'), role: 'status', text: pStat }));
    body.appendChild(h('p', { class: 'small muted', text: 'While chat is open on your device, a small signal tells the family server you are here. It expires after about 100 seconds and nothing is kept.' }));
    body.appendChild(h('h3', { text: 'Typing hint' }));
    var tOn = h('input', { type: 'checkbox' }); tOn.checked = typingOn();
    tOn.addEventListener('change', function () { lsSet('fc_chat_typing', tOn.checked); });
    body.appendChild(h('label', { class: 'check' }, tOn, ' Let others see when I am typing'));
    var tTxt = h('input', { type: 'text', maxlength: 40, class: 'typing-words', 'aria-label': 'Words others see after your name while you type', placeholder: TYPING_DEFAULT });
    tTxt.value = typingWords() === TYPING_DEFAULT ? '' : typingWords();
    var tPrev = h('p', { class: 'small muted' });
    function showPrev() { tPrev.textContent = 'Others will see: ' + (profileOf(c.uid) ? profileOf(c.uid).displayName : 'You') + ' ' + (tTxt.value.replace(/[<>]/g, '').trim() || TYPING_DEFAULT) + '…'; }
    function saveTxt() { lsSet('fc_chat_typing_text', tTxt.value.replace(/[<>]/g, '').slice(0, 40)); showPrev(); }
    tTxt.addEventListener('input', saveTxt); tTxt.addEventListener('change', saveTxt); tTxt.addEventListener('blur', saveTxt);
    showPrev();
    body.appendChild(h('label', { class: 'small', text: 'Your words (after your name)' })); body.appendChild(tTxt);
    var presets = h('div', { class: 'row typing-presets' });
    ['is typing', 'is cooking letters', 'is writing a novel', 'is plotting something', 'is summoning words'].forEach(function (w) {
      presets.appendChild(h('button', { class: 'btn secondary small', type: 'button', text: w, onclick: function () { tTxt.value = w; lsSet('fc_chat_typing_text', w); showPrev(); toast('Saved: others will see “' + w + '”.'); } }));
    });
    body.appendChild(presets);
    var tStat = !c.live ? 'Live updates are not connected right now, so typing hints cannot show until they reconnect.'
      : c.typingErr ? 'Your last typing hint did not reach the server (' + c.typingErr + '). The family-api update and the "Add the Family Chat tables" step are needed, see CHAT-GUIDE.md.'
      : c.typingOkAt ? 'Typing hints are working from your side.' : 'Start typing in a chat, then open this screen again to see whether typing hints reach the server.';
    body.appendChild(h('p', { class: 'small', role: 'status', text: tStat }));
    body.appendChild(h('p', { class: 'small muted', text: 'This is the wording other family members see on their device while you type. It is saved on this device and sent with each typing hint. Nothing is stored after a few seconds.' }));
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
    if (C && !C.vv) { C.vv = true; listen(C, vv, 'resize', function () { set(); if (C.kbd || nearBottom()) { scrollBottom(); setTimeout(scrollBottom, 120); setTimeout(scrollBottom, 350); } }); listen(C, vv, 'scroll', set); }
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
    startPresence(c);
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
  /* Used by posts and comments (app.js): clickable links and the same link preview card as in chat. Respects the "link previews" setting in Chat settings. */
  function linkify(text) {
    var frag = document.createDocumentFragment();
    splitLinks(String(text || '')).forEach(function (p) {
      if (p.u) frag.appendChild(h('a', { href: p.u, target: '_blank', rel: 'noopener noreferrer nofollow ugc', class: 'msg-link', text: p.u }));
      else frag.appendChild(document.createTextNode(p.t));
    });
    return frag;
  }
  function linkCardFor(text) {
    if (!previewsOn() || !X) return null;
    var first = splitLinks(String(text || '')).filter(function (p) { return p.u; })[0];
    return first ? previewCard(first.u) : null;
  }
  window.FCChat = { profileFor: function (uid) { profileSheet(C || { uid: me(), here: GP.here, dms: [], calls: {}, blocked: [], standalone: true }, uid); }, presenceWatch: presenceWatch, shareToDm: shareToDm, linkify: linkify, linkCardFor: linkCardFor, install: install, navItem: navItem, mountPanel: mountPanel, stop: stop, closePanel: function () { closePanel(false); }, refreshTotals: function () { return refreshTotals(true); } };
})();

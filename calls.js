/* Family Circle: voice and video calls inside chat (direct messages and family channels).
   Video and audio travel through LiveKit (open source, Apache-2.0, vendor/livekit-client.umd.js). The family-api function hands out a
   short pass only to people who can open that conversation, so a direct-message call is only ever between those two people.
   One call at a time. The call keeps going while you move around the app (it shrinks to a small bar). */
(function () {
  'use strict';
  var me = document.currentScript, ROOT = me && me.src ? me.src.replace(/[^/]*(\?.*)?$/, '') : '';
  var VER = me && me.src && /[?&]v=([^&]+)/.exec(me.src) ? /[?&]v=([^&]+)/.exec(me.src)[1] : '';
  var cur = null;                    // the call I am in, if any
  var loading = {};
  function loadScript(rel) {
    if (loading[rel]) return loading[rel];
    return (loading[rel] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = ROOT + rel + (VER ? '?v=' + VER : ''); s.onload = res;
      s.onerror = function () { delete loading[rel]; rej(new Error('Could not load ' + rel + '. Check your connection.')); };
      document.head.appendChild(s);
    }));
  }
  /* ---------- drawn icons (one line style, current text color) ---------- */
  var IC = {
    mic: ['M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M6 11a6 6 0 0 0 12 0', 'M12 17v4', 'M9 21h6'],
    micoff: ['M15 9.3V6a3 3 0 0 0-5.9-.8', 'M9 9v2a3 3 0 0 0 4.5 2.6', 'M6 11a6 6 0 0 0 9.5 4.9', 'M18 11a6 6 0 0 1-.6 2.6', 'M12 17v4', 'M9 21h6', 'M4 4l16 16'],
    video: ['M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M15 10.5l6-3.5v10l-6-3.5'],
    videooff: ['M15 11V8a2 2 0 0 0-2-2H8', 'M3 8v8a2 2 0 0 0 2 2h8a2 2 0 0 0 1.9-1.4', 'M15 10.5l6-3.5v10l-5-2.9', 'M4 4l16 16'],
    sparkles: ['M11 3l1.8 4.7L17.5 9.5l-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z', 'M18.5 14l.8 2.2L21.5 17l-2.2.8-.8 2.2-.8-2.2L15.5 17l2.2-.8z'],
    flip: ['M4 8a1 1 0 0 1 1-1h3l1.5-2h5L16 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M9.2 13.4A3 3 0 0 1 14.4 11.8', 'M14.8 14.6A3 3 0 0 1 9.6 16.2', 'M14.5 10.3v1.6h-1.6', 'M9.5 17.7v-1.6h1.6'],
    hangup: ['M3 14.5c5.2-5 12.8-5 18 0l-1.7 2.6-3.1-1.4v-2.6c-2.4-.8-4.2-.8-6.6 0v2.6L4.7 17.1z'],
    phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z'],
    down: ['M6 9l6 6 6-6'],
    none: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M5.6 5.6l12.8 12.8'],
    blur: ['M12 3c3.2 4 6 6.8 6 10.5a6 6 0 0 1-12 0C6 9.8 8.8 7 12 3z', 'M9 14a3 3 0 0 0 3 3'],
    picture: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M9 9.5h.01'],
    shades: ['M3 9h8v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z', 'M13 9h8v4a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z', 'M11 10.5h2', 'M3 9l1.5-3', 'M21 9l-1.5-3'],
    crown: ['M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z', 'M5 19h14'],
    bunny: ['M8.5 3c-1.3 2.5-1.3 5.5.5 8', 'M15.5 3c1.3 2.5 1.3 5.5-.5 8', 'M7 16a5 5 0 0 1 10 0 5 5 0 0 1-10 0z', 'M10.5 16h.01', 'M13.5 16h.01'],
    cat: ['M5 4l3.5 4h7L19 4v9a7 7 0 0 1-14 0z', 'M9.5 13h.01', 'M14.5 13h.01', 'M11 16h2'],
    hearts: ['M12 19s-6.5-4-6.5-9A3.8 3.8 0 0 1 12 7.6 3.8 3.8 0 0 1 18.5 10c0 5-6.5 9-6.5 9z'],
    clown: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 13.5h.01', 'M8.5 9.5h.01', 'M15.5 9.5h.01']
  };
  var NS = 'http://www.w3.org/2000/svg';
  function svg(name, size) {
    var el = document.createElementNS(NS, 'svg'); el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('width', size || 24); el.setAttribute('height', size || 24);
    el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '2'); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round'); el.setAttribute('aria-hidden', 'true'); el.setAttribute('focusable', 'false');
    (IC[name] || []).forEach(function (d) { var p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); el.appendChild(p); });
    return el;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(sec) { var m = Math.floor(sec / 60); return m >= 60 ? Math.floor(m / 60) + ':' + pad(m % 60) + ':' + pad(sec % 60) : m + ':' + pad(sec % 60); }

  async function start(o) {
    var h = o.h, toast = o.toast;
    if (cur) {
      if (cur.convId === o.convId) { cur.expand(); return; }
      toast('You are already in a call. Leave it first.'); return;
    }
    var L, call = {
      convId: o.convId, kind: o.kind, title: o.title, room: null, tiles: {}, minimized: false, startedAt: Date.now(), timers: {}, effects: { bg: 'none', filter: 'none', image: null }, proc: null, wake: null, ended: false
    };
    cur = call;
    var famId = o.familyId;
    function api(a, p) { return o.api(a, Object.assign({ kind: o.kind, convId: o.convId }, p || {})); }

    /* ---------- screen ---------- */
    var grid = h('div', { class: 'call-grid', 'data-n': '0' }), audioHost = h('div', { class: 'call-audio', 'aria-hidden': 'true' });
    var timerEl = h('span', { class: 'call-timer', text: '0:00' }), statusEl = h('span', { class: 'call-status small', role: 'status', text: 'Connecting…' });
    var btnMic = h('button', { class: 'call-btn', type: 'button', 'aria-pressed': 'true', 'aria-label': 'Microphone' }, h('span', { class: 'cb-i' }, svg('mic')), h('span', { class: 'cb-l', text: 'Mic' }));
    var btnCam = h('button', { class: 'call-btn', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Camera' }, h('span', { class: 'cb-i' }, svg('video')), h('span', { class: 'cb-l', text: 'Camera' }));
    var btnFx = h('button', { class: 'call-btn', type: 'button', 'aria-label': 'Effects: backgrounds and face filters', 'aria-expanded': 'false' }, h('span', { class: 'cb-i' }, svg('sparkles')), h('span', { class: 'cb-l', text: 'Effects' }));
    var btnFlip = h('button', { class: 'call-btn', type: 'button', 'aria-label': 'Switch camera', hidden: true }, h('span', { class: 'cb-i' }, svg('flip')), h('span', { class: 'cb-l', text: 'Flip' }));
    var btnEnd = h('button', { class: 'call-btn end', type: 'button', 'aria-label': 'Leave call' }, h('span', { class: 'cb-i' }, svg('hangup')), h('span', { class: 'cb-l', text: 'Leave' }));
    var btnMin = h('button', { class: 'btn small call-min', type: 'button', 'aria-label': 'Minimize the call and keep chatting' }, svg('down', 18), ' Minimize');
    var fxPanel = h('div', { class: 'call-fx', hidden: true, role: 'dialog', 'aria-label': 'Camera effects' });
    var screen = h('div', { class: 'call', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Call: ' + o.title },
      h('header', { class: 'call-head' }, h('div', { class: 'grow ct' }, h('strong', { class: 'clamp', text: o.title }), h('div', { class: 'small' }, timerEl, ' · ', statusEl)), btnMin),
      grid, fxPanel, h('div', { class: 'call-bar' }, btnMic, btnCam, btnFx, btnFlip, btnEnd), audioHost);
    var pillMic = h('button', { class: 'btn small', type: 'button', 'aria-label': 'Mute or unmute microphone' }, svg('mic', 18));
    var pillTxt = h('span', { class: 'grow clamp' });
    var pill = h('div', { class: 'call-pill', hidden: true, role: 'region', 'aria-label': 'Call in progress' }, pillTxt, pillMic,
      h('button', { class: 'btn small', type: 'button', text: 'Open', onclick: function () { call.expand(); } }),
      h('button', { class: 'btn small danger', type: 'button', text: 'Leave', onclick: function () { call.leave(); } }));
    document.body.appendChild(screen); document.body.appendChild(pill); document.body.classList.add('in-call');
    btnEnd.focus();

    call.expand = function () { call.minimized = false; screen.hidden = false; pill.hidden = true; document.body.classList.add('call-open'); };
    call.minimize = function () { call.minimized = true; screen.hidden = true; pill.hidden = false; document.body.classList.remove('call-open'); closeFx(); };
    btnMin.addEventListener('click', call.minimize);
    document.body.classList.add('call-open');

    function who() {
      var r = call.room; if (!r) return o.title;
      var names = []; r.remoteParticipants.forEach(function (p) { names.push(o.nameOf(p.identity)); });
      return names.length ? 'With ' + names.join(', ') : 'Waiting for others…';
    }
    function tick() {
      var s = Math.round((Date.now() - call.startedAt) / 1000); timerEl.textContent = clock(s);
      pillTxt.textContent = 'In call · ' + clock(s) + ' · ' + who();
    }
    call.timers.tick = setInterval(tick, 1000); tick();

    /* ---------- tiles ---------- */
    function tileFor(p) {
      var id = p.identity, t = call.tiles[id];
      if (t) return t;
      var local = p.isLocal, vid = h('video', { class: 'ct-video' + (local ? ' mine' : ''), autoplay: true, playsinline: true, muted: local, 'aria-hidden': 'true' });
      var ph = h('div', { class: 'ct-ph' }, o.avatarEl(id, 'lg'));
      var mic = h('span', { class: 'ct-mic', hidden: true, title: 'Muted', 'aria-label': 'muted' }, svg('micoff', 16));
      var name = h('span', { class: 'ct-name clamp', text: local ? 'You' : o.nameOf(id) });
      var el = h('div', { class: 'call-tile' + (local ? ' local' : ''), 'data-id': id }, vid, ph, h('div', { class: 'ct-bar' }, name, mic));
      t = call.tiles[id] = { el: el, vid: vid, ph: ph, mic: mic };
      if (local) grid.insertBefore(el, grid.firstChild); else grid.appendChild(el);
      return t;
    }
    function dropTile(id) { var t = call.tiles[id]; if (t) { t.el.remove(); delete call.tiles[id]; } }
    function camPub(p) { return p.getTrackPublication && p.getTrackPublication(L.Track.Source.Camera); }
    function micPub(p) { return p.getTrackPublication && p.getTrackPublication(L.Track.Source.Microphone); }
    function paintTile(p) {
      var t = tileFor(p), cp = camPub(p), mp = micPub(p);
      var hasVideo = !!(cp && cp.track && !cp.isMuted);
      if (hasVideo) { if (t.vid._tr !== cp.track) { if (t.vid._tr) { try { t.vid._tr.detach(t.vid); } catch (e) { /* ok */ } } cp.track.attach(t.vid); t.vid._tr = cp.track; } }
      else if (t.vid._tr) { try { t.vid._tr.detach(t.vid); } catch (e) { /* ok */ } t.vid._tr = null; }
      t.el.classList.toggle('has-video', hasVideo);
      t.mic.hidden = !(mp ? mp.isMuted : true);
    }
    function paintAll() {
      var r = call.room; if (!r) return;
      var seen = {}; seen[r.localParticipant.identity] = 1; paintTile(r.localParticipant);
      r.remoteParticipants.forEach(function (p) { seen[p.identity] = 1; paintTile(p); });
      Object.keys(call.tiles).forEach(function (id) { if (!seen[id]) dropTile(id); });
      grid.setAttribute('data-n', String(Object.keys(call.tiles).length));
      statusEl.textContent = who();
      paintButtons();
    }
    function swap(host, name, size) { if (!host) return; while (host.firstChild) host.removeChild(host.firstChild); host.appendChild(svg(name, size)); }
    function paintButtons() {
      var lp = call.room && call.room.localParticipant; if (!lp) return;
      var micOn = lp.isMicrophoneEnabled, camOn = lp.isCameraEnabled;
      btnMic.setAttribute('aria-pressed', micOn ? 'true' : 'false'); btnMic.classList.toggle('off', !micOn); btnMic.querySelector('.cb-l').textContent = micOn ? 'Mute' : 'Unmute';
      btnCam.setAttribute('aria-pressed', camOn ? 'true' : 'false'); btnCam.classList.toggle('off', !camOn); btnCam.querySelector('.cb-l').textContent = camOn ? 'Camera off' : 'Camera on';
      btnFx.disabled = !camOn && !call.effectsActive(); swap(btnMic.querySelector('.cb-i'), micOn ? 'mic' : 'micoff'); swap(btnCam.querySelector('.cb-i'), camOn ? 'video' : 'videooff'); swap(pillMic, micOn ? 'mic' : 'micoff', 18);
    }

    /* ---------- leaving ---------- */
    call.leave = async function () {
      if (call.ended) return; call.ended = true;
      Object.keys(call.timers).forEach(function (k) { clearInterval(call.timers[k]); });
      try { if (call.proc && call.room) { var tr = camPub(call.room.localParticipant); if (tr && tr.videoTrack) await tr.videoTrack.stopProcessor(); } } catch (e) { /* ok */ }
      try { if (call.room) await call.room.disconnect(); } catch (e) { /* ok */ }
      try { api('callLeave').catch(function () { /* the banner expires by itself */ }); } catch (e) { /* ok */ }
      try { if (call.wake) call.wake.release(); } catch (e) { /* ok */ }
      screen.remove(); pill.remove(); document.body.classList.remove('call-open', 'in-call'); cur = null;
      if (o.onEnd) o.onEnd();
    };
    call.effectsActive = function () { return call.effects.bg !== 'none' || call.effects.filter !== 'none'; };

    /* ---------- connect ---------- */
    try {
      await loadScript('vendor/livekit-client.umd.js');
      L = window.LivekitClient;
      var pass = await api('callJoin', {});
      if (call.ended) return;
      var room = call.room = new L.Room({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { resolution: L.VideoPresets.h540, facingMode: 'user' }, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      var E = L.RoomEvent;
      room.on(E.ParticipantConnected, paintAll).on(E.ParticipantDisconnected, paintAll)
        .on(E.TrackSubscribed, function (track, pub, p) { if (track.kind === 'audio') { var a = track.attach(); audioHost.appendChild(a); } paintAll(); })
        .on(E.TrackUnsubscribed, function (track) { if (track.kind === 'audio') track.detach().forEach(function (a) { a.remove(); }); paintAll(); })
        .on(E.TrackMuted, paintAll).on(E.TrackUnmuted, paintAll)
        .on(E.LocalTrackPublished, function (pub) { if (pub.source === L.Track.Source.Camera) applyEffects(); paintAll(); })
        .on(E.LocalTrackUnpublished, paintAll)
        .on(E.ActiveSpeakersChanged, function (sp) { var ids = {}; sp.forEach(function (p) { ids[p.identity] = 1; }); Object.keys(call.tiles).forEach(function (id) { call.tiles[id].el.classList.toggle('speaking', !!ids[id]); }); })
        .on(E.Reconnecting, function () { statusEl.textContent = 'Reconnecting…'; })
        .on(E.Reconnected, paintAll)
        .on(E.Disconnected, function () { if (!call.ended) { toast('The call ended.'); call.leave(); } })
        .on(E.MediaDevicesError, function (e) { toast(/denied|permission|NotAllowed/i.test(String(e && (e.message || e.name))) ? 'Allow the microphone and camera for this site in your browser settings, then try again.' : 'Your camera or microphone could not start.'); });
      await room.connect(pass.url, pass.token);
      if (call.ended) { room.disconnect(); return; }
      paintAll();
      try { await room.localParticipant.setMicrophoneEnabled(true); } catch (e) { toast('Your microphone is blocked. You can listen, but others cannot hear you. Allow it in your browser settings.'); }
      if (o.video) { try { await room.localParticipant.setCameraEnabled(true); } catch (e) { toast('Your camera is blocked. Allow it in your browser settings.'); } }
      paintAll(); statusEl.textContent = who();
      call.timers.ping = setInterval(function () { api('callPing').catch(function () { /* next one tries again */ }); }, 45000);
      try { if (navigator.wakeLock) call.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not important */ }
      document.addEventListener('visibilitychange', call.onVis = function () { if (!document.hidden && navigator.wakeLock && !call.ended) navigator.wakeLock.request('screen').then(function (w) { call.wake = w; }, function () { /* ok */ }); });
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) navigator.mediaDevices.enumerateDevices().then(function (d) { btnFlip.hidden = d.filter(function (x) { return x.kind === 'videoinput'; }).length < 2; }, function () { /* ok */ });
    } catch (e) {
      toast((e && e.message) || 'The call could not start.');
      call.ended = true; Object.keys(call.timers).forEach(function (k) { clearInterval(call.timers[k]); });
      try { if (call.room) call.room.disconnect(); } catch (e2) { /* ok */ }
      screen.remove(); pill.remove(); document.body.classList.remove('call-open', 'in-call'); cur = null; if (o.onEnd) o.onEnd();
      return;
    }

    /* ---------- buttons ---------- */
    btnMic.addEventListener('click', async function () { var lp = call.room.localParticipant; try { await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled); } catch (e) { toast('Your microphone could not start.'); } paintAll(); });
    pillMic.addEventListener('click', function () { btnMic.click(); });
    btnCam.addEventListener('click', async function () { var lp = call.room.localParticipant; try { await lp.setCameraEnabled(!lp.isCameraEnabled); } catch (e) { toast('Your camera could not start.'); } paintAll(); });
    var facing = 'user';
    btnFlip.addEventListener('click', async function () {
      var lp = call.room.localParticipant, pub = camPub(lp); if (!pub || !pub.videoTrack) { toast('Turn the camera on first.'); return; }
      facing = facing === 'user' ? 'environment' : 'user';
      try { await pub.videoTrack.restartTrack({ facingMode: facing }); applyEffects(); } catch (e) { toast('This device could not switch cameras.'); }
    });
    btnEnd.addEventListener('click', function () { call.leave(); });
    screen.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { if (!fxPanel.hidden) closeFx(); else call.minimize(); } });

    /* ---------- effects ---------- */
    function closeFx() { fxPanel.hidden = true; btnFx.setAttribute('aria-expanded', 'false'); }
    async function applyEffects() {
      var lp = call.room && call.room.localParticipant, pub = lp && camPub(lp), tr = pub && pub.videoTrack; if (!tr) return;
      var fx = call.effects, active = call.effectsActive();
      try {
        if (!active) { if (call.procOn) { await tr.stopProcessor(); call.procOn = false; } return; }
        await loadScript('call-effects.js');
        if (!window.FCEffects || !window.FCEffects.supported) { toast('Effects are not supported on this browser.'); return; }
        if (!call.proc) call.proc = window.FCEffects.create(fx);
        call.proc.set({ bg: fx.bg, filter: fx.filter, image: fx.image });
        if (!call.procOn || tr.getProcessor && tr.getProcessor() !== call.proc) { await tr.setProcessor(call.proc); call.procOn = true; }
        var st = call.proc.state(); if (st.notice) toast(st.notice);
      } catch (e) { toast('Effects could not start on this device.'); call.effects.bg = 'none'; call.effects.filter = 'none'; call.procOn = false; paintFx(); }
    }
    function paintFx() {
      clear(fxPanel);
      var FX = window.FCEffects, fx = call.effects;
      fxPanel.appendChild(h('div', { class: 'fx-head' }, h('strong', { text: 'Effects' }), h('button', { class: 'btn small', type: 'button', text: 'Done', onclick: closeFx })));
      fxPanel.appendChild(h('p', { class: 'small', text: 'Effects run on your device and nothing extra is uploaded. They can warm up older phones; pick None to turn them off.' }));
      fxPanel.appendChild(h('h3', { class: 'fx-h', text: 'Background' }));
      var bgRow = h('div', { class: 'fx-row', role: 'group', 'aria-label': 'Background' });
      FX.BACKGROUNDS.forEach(function (b) {
        var swatch = b.stops ? 'linear-gradient(135deg,' + b.stops.join(',') + ')' : '';
        bgRow.appendChild(h('button', { class: 'fx-tile' + (fx.bg === b.id ? ' on' : ''), type: 'button', 'aria-pressed': fx.bg === b.id ? 'true' : 'false', style: swatch ? 'background:' + swatch : '', onclick: function () { fx.bg = b.id; applyEffects(); paintFx(); paintButtons(); } },
          b.id === 'none' ? svg('none', 26) : b.id === 'blur' ? svg('blur', 26) : '', h('span', { class: 'fx-l', text: b.label })));
      });
      var file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
      file.addEventListener('change', async function () { try { var img = await FX.imageFromFile(file.files[0]); fx.image = img; fx.bg = 'image'; applyEffects(); paintFx(); paintButtons(); } catch (e) { toast(e.message || 'That picture could not be used.'); } });
      bgRow.appendChild(h('button', { class: 'fx-tile' + (fx.bg === 'image' ? ' on' : ''), type: 'button', onclick: function () { file.click(); } }, svg('picture', 26), h('span', { class: 'fx-l', text: 'Your picture' })));
      fxPanel.appendChild(bgRow); fxPanel.appendChild(file);
      fxPanel.appendChild(h('h3', { class: 'fx-h', text: 'Face filters' }));
      var fRow = h('div', { class: 'fx-row', role: 'group', 'aria-label': 'Face filters' });
      FX.FILTERS.forEach(function (f) {
        fRow.appendChild(h('button', { class: 'fx-tile' + (fx.filter === f.id ? ' on' : ''), type: 'button', 'aria-pressed': fx.filter === f.id ? 'true' : 'false', onclick: function () { fx.filter = f.id; applyEffects(); paintFx(); paintButtons(); } }, svg(f.id, 26), h('span', { class: 'fx-l', text: f.label })));
      });
      fxPanel.appendChild(fRow);
    }
    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
    btnFx.addEventListener('click', async function () {
      if (!fxPanel.hidden) { closeFx(); return; }
      try { await loadScript('call-effects.js'); } catch (e) { toast(e.message); return; }
      paintFx(); fxPanel.hidden = false; btnFx.setAttribute('aria-expanded', 'true');
    });
  }

  window.FCCalls = {
    start: start,
    inCall: function (convId) { return !!cur && (!convId || cur.convId === convId); },
    expand: function () { if (cur) cur.expand(); }
  };
})();

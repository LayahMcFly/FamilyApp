/* Family Circle: video editor (trim, cut sections out, color adjustments), all on the device.
 *
 * How the real export works (nothing is uploaded or sent anywhere by this file):
 *   1. The chosen video is played from the kept sections only, in order, by two hidden <video> elements.
 *   2. Every frame is drawn by a small WebGL shader (brightness, contrast, saturation, warmth) onto a canvas.
 *   3. The sound of the kept sections is rebuilt from the decoded audio with Web Audio, sample-accurately.
 *   4. A MediaRecorder records the canvas and that audio into a NEW file (MP4 where the browser can, otherwise WebM).
 * The preview uses exactly the same code path, so what you see is what the new file contains.
 * Because the new file is recorded while it plays, exporting takes about as long as the edited video.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VideoEditor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_KEEP = 0.3;              // at least this much video must remain
  var DEFAULT_ADJ = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

  /* =============== 1. Pure editing model (no browser needed, unit tested) =============== */

  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function r3(x) { return Math.round(x * 1000) / 1000; }

  /** state = { inT, outT, cuts: [[a, b], ...] } in seconds of the ORIGINAL video. */
  function normalize(st, dur) {
    var inT = clamp(Number(st.inT) || 0, 0, dur), outT = clamp(st.outT == null ? dur : Number(st.outT), 0, dur);
    if (outT - inT < MIN_KEEP) { if (inT + MIN_KEEP <= dur) outT = inT + MIN_KEEP; else { outT = dur; inT = Math.max(0, dur - MIN_KEEP); } }
    var cuts = (st.cuts || []).map(function (c) { return [clamp(Math.min(c[0], c[1]), inT, outT), clamp(Math.max(c[0], c[1]), inT, outT)]; })
      .filter(function (c) { return c[1] - c[0] >= 0.05; }).sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    cuts.forEach(function (c) {
      var last = merged[merged.length - 1];
      if (last && c[0] <= last[1] + 0.001) last[1] = Math.max(last[1], c[1]); else merged.push([c[0], c[1]]);
    });
    return { inT: r3(inT), outT: r3(outT), cuts: merged.map(function (c) { return [r3(c[0]), r3(c[1])]; }) };
  }
  /** The pieces that stay, in order: [inT, outT] minus every cut. */
  function keepSegments(st) {
    var segs = [], at = st.inT;
    st.cuts.forEach(function (c) { if (c[0] > at + 0.0005) segs.push([at, c[0]]); at = Math.max(at, c[1]); });
    if (st.outT > at + 0.0005) segs.push([at, st.outT]);
    return segs;
  }
  function editedDuration(st) { return keepSegments(st).reduce(function (n, s) { return n + (s[1] - s[0]); }, 0); }
  /** [{s, e, at}] where `at` is where the piece starts in the edited video. */
  function layout(segs) { var at = 0; return segs.map(function (s) { var o = { s: s[0], e: s[1], at: at }; at += s[1] - s[0]; return o; }); }
  /** Original-video time -> position in the edited video (a time inside a removed part snaps to the next kept moment). */
  function toEdited(segs, t) {
    var L = layout(segs);
    for (var i = 0; i < L.length; i++) { if (t < L[i].s) return L[i].at; if (t <= L[i].e) return L[i].at + (t - L[i].s); }
    var last = L[L.length - 1]; return last ? last.at + (last.e - last.s) : 0;
  }
  function toSource(segs, pos) {
    var L = layout(segs);
    for (var i = 0; i < L.length; i++) { var len = L[i].e - L[i].s; if (pos < L[i].at + len || i === L.length - 1) return L[i].s + clamp(pos - L[i].at, 0, len); }
    return 0;
  }
  /** Removing a section: returns the new state, or null if that would leave less than MIN_KEEP of video. */
  function removeSection(st, a, b, dur) {
    var n = normalize({ inT: st.inT, outT: st.outT, cuts: st.cuts.concat([[a, b]]) }, dur);
    return editedDuration(n) < MIN_KEEP ? null : n;
  }
  function restoreSection(st, index, dur) {
    var cuts = st.cuts.slice(); cuts.splice(index, 1);
    return normalize({ inT: st.inT, outT: st.outT, cuts: cuts }, dur);
  }
  function mb(bytes) { return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0); }
  function fmtTime(t) {
    t = Math.max(0, t || 0); var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  /** "12.5", "1:05.3" or "0:01:05" -> seconds, or NaN. */
  function parseTime(text) {
    var parts = String(text || '').trim().split(':'); if (parts.length > 3 || parts.some(function (p) { return !/^\d+(\.\d+)?$/.test(p.trim()); })) return NaN;
    return parts.reduce(function (n, p) { return n * 60 + Number(p); }, 0);
  }
  function History(initial) {
    var past = [], future = [], cur = JSON.stringify(initial);
    return {
      push: function (st) { var j = JSON.stringify(st); if (j === cur) return false; past.push(cur); future = []; cur = j; return true; },
      undo: function () { if (!past.length) return null; future.push(cur); cur = past.pop(); return JSON.parse(cur); },
      redo: function () { if (!future.length) return null; past.push(cur); cur = future.pop(); return JSON.parse(cur); },
      canUndo: function () { return past.length > 0; }, canRedo: function () { return future.length > 0; }
    };
  }

  /** Output sizes the person can choose from. Never larger than the original, never above 1080p on the short side. */
  function qualityOptions(w, h, durationSec, limitBytes) {
    var short = Math.min(w, h), cap = Math.min(1, 1080 / short), seen = {}, out = [];
    [[480, 'Small (480p)'], [720, 'Medium (720p)'], [1080, 'Large (1080p)'], [0, 'Same as the original']].forEach(function (t) {
      var sc = t[0] ? Math.min(cap, t[0] / short) : cap;
      if (t[0] && t[0] >= short) return;                                  // would be the same as the original
      var ow = Math.max(2, Math.round(w * sc / 2) * 2), oh = Math.max(2, Math.round(h * sc / 2) * 2), key = ow + 'x' + oh;
      if (seen[key]) return; seen[key] = 1;
      var vbps = clamp(Math.round(ow * oh * 30 * 0.07), 250000, 8000000), abps = 96000;
      out.push({ id: key, label: t[1] + ' ' + ow + '×' + oh, w: ow, h: oh, vbps: vbps, abps: abps, bytes: Math.round((vbps + abps) * durationSec / 8 * 1.15) });
    });
    return out;
  }
  function pickQuality(options, limitBytes) {
    for (var i = options.length - 1; i >= 0; i--) if (options[i].bytes <= limitBytes * 0.85) return options[i];
    return options[0];
  }

  /* ----- WebM written by MediaRecorder has no length stored in it, so players cannot show or seek. This writes it in. ----- */
  function vintLen(b) { var l = 1, m = 0x80; while (l <= 8 && !(b & m)) { l++; m >>= 1; } return l; }
  function readSize(u, p) {
    var l = vintLen(u[p]); if (l > 8) return null;
    var v = u[p] & (0xFF >> l), ones = v === (0xFF >> l);
    for (var i = 1; i < l; i++) { v = v * 256 + u[p + i]; if (u[p + i] !== 255) ones = false; }
    return { len: l, value: v, unknown: ones };
  }
  function readId(u, p) { var l = vintLen(u[p]); if (l > 4) return null; var id = 0; for (var i = 0; i < l; i++) id = id * 256 + u[p + i]; return { id: id, len: l }; }
  function writeSize(value, len) { var out = new Uint8Array(len), v = value; for (var i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); } out[0] |= (0x80 >> (len - 1)); return out; }
  /** u8: the whole WebM file. Returns a new Uint8Array with a Duration element, or the same one if nothing needed changing. */
  function fixWebmDuration(u8, seconds) {
    try {
      var p = 0, e = readId(u8, p); if (!e || e.id !== 0x1A45DFA3) return u8;
      var sz = readSize(u8, p + e.len); p += e.len + sz.len + sz.value;
      var seg = readId(u8, p); if (!seg || seg.id !== 0x18538067) return u8;
      var segSizePos = p + seg.len, segSize = readSize(u8, segSizePos), q = segSizePos + segSize.len, limit = Math.min(u8.length, q + 65536);
      while (q < limit) {
        var id = readId(u8, q); if (!id) return u8; var s = readSize(u8, q + id.len); if (!s) return u8;
        var dataAt = q + id.len + s.len;
        if (id.id === 0x1549A966) {                                       // Info
          var scale = 1000000, r = dataAt, end = dataAt + s.value;
          while (r < end) {
            var cid = readId(u8, r), cs = readSize(u8, r + cid.len), cd = r + cid.len + cs.len;
            if (cid.id === 0x2AD7B1) { scale = 0; for (var k = 0; k < cs.value; k++) scale = scale * 256 + u8[cd + k]; }
            if (cid.id === 0x4489) return u8;                             // already has one
            r = cd + cs.value;
          }
          var units = seconds * 1e9 / scale, el = new Uint8Array(11); el[0] = 0x44; el[1] = 0x89; el[2] = 0x88;
          new DataView(el.buffer).setFloat64(3, units);
          var newSize = s.value + 11; if (newSize >= Math.pow(2, 7 * s.len) - 1) return u8;
          var out = new Uint8Array(u8.length + 11);
          out.set(u8.subarray(0, q + id.len), 0);
          out.set(writeSize(newSize, s.len), q + id.len);
          out.set(u8.subarray(dataAt, end), dataAt);
          out.set(el, end);
          out.set(u8.subarray(end), end + 11);
          if (!segSize.unknown) {
            var ns = segSize.value + 11; if (ns >= Math.pow(2, 7 * segSize.len) - 1) return u8;
            out.set(writeSize(ns, segSize.len), segSizePos);
          }
          return out;
        }
        if (id.id === 0x114D9B74) return u8;                              // a SeekHead holds byte positions that inserting would break: leave the file as is
        q = dataAt + s.value;
      }
    } catch (err) { /* fall through */ }
    return u8;
  }

  /* =============== 2. Color renderer (WebGL, with a plain fallback) =============== */

  function makeRenderer(canvas) {
    var gl = null;
    try { gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: false, antialias: false }) || canvas.getContext('experimental-webgl', { preserveDrawingBuffer: true, alpha: false }); } catch (e) { gl = null; }
    if (!gl) {
      var c2 = canvas.getContext('2d');
      return { adjustable: false, resize: function (w, h) { canvas.width = w; canvas.height = h; }, draw: function (v) { try { c2.drawImage(v, 0, 0, canvas.width, canvas.height); } catch (e) {} }, dispose: function () {} };
    }
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader'); return s; }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER,
      'precision mediump float;varying vec2 uv;uniform sampler2D t;uniform vec4 adj;uniform float on;' +
      'void main(){vec3 c=texture2D(t,uv).rgb;if(on>.5){c*=adj.x;c=(c-.5)*adj.y+.5;float g=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(g),c,adj.z);c+=vec3(adj.w,adj.w*.15,-adj.w);}gl_FragColor=vec4(clamp(c,0.,1.),1.);}'));
    gl.linkProgram(prog); gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    var uAdj = gl.getUniformLocation(prog, 'adj'), uOn = gl.getUniformLocation(prog, 'on');
    var state = { adj: DEFAULT_ADJ, bypass: false };
    return {
      adjustable: true,
      set: function (adj, bypass) { state.adj = adj; state.bypass = !!bypass; },
      resize: function (w, h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); },
      draw: function (v) {
        if (!v || v.readyState < 2 || !v.videoWidth) return;
        var a = state.adj;
        gl.uniform4f(uAdj, 1 + a.brightness / 100, 1 + a.contrast / 100, 1 + a.saturation / 100, a.warmth / 100 * 0.12);
        gl.uniform1f(uOn, state.bypass ? 0 : 1);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); } catch (e) { /* frame not ready yet */ }
      },
      dispose: function () { try { gl.deleteTexture(tex); gl.deleteBuffer(buf); gl.deleteProgram(prog); } catch (e) {} }
    };
  }

  /* =============== 3. Playback / recording engine =============== */

  function whenLoaded(v) {
    return new Promise(function (res) {
      if (v.readyState >= 2) return res();
      var done = false, to = setTimeout(fin, 10000);
      function fin() { if (done) return; done = true; v.removeEventListener('loadeddata', fin); clearTimeout(to); res(); }
      v.addEventListener('loadeddata', fin);
    });
  }
  function seekTo(v, t) {
    return whenLoaded(v).then(function () {
      return new Promise(function (res) {
        if (Math.abs(v.currentTime - t) < 0.001) return res();
        var done = false, to = setTimeout(fin, 4000);
        function fin() { if (done) return; done = true; v.removeEventListener('seeked', fin); clearTimeout(to); res(); }
        v.addEventListener('seeked', fin); v.currentTime = t;
      });
    });
  }
  function makeVideoEl(url, host) {
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
    v.src = url; host.appendChild(v); return v;
  }

  function Engine(o) {
    var vids = [makeVideoEl(o.url, o.host), makeVideoEl(o.url, o.host)];
    var AC = window.AudioContext || window.webkitAudioContext, ctx = new AC();
    var gain = ctx.createGain(), dest = null, sources = [], raf = 0, playing = false, token = 0;
    var L = [], total = 0, base = 0, t0 = 0, cur = -1, mode = 'preview', onEnd = null, hold = null;
    gain.connect(ctx.destination);

    function stopSources() { sources.forEach(function (s) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} }); sources = []; }
    function idxAt(p) { for (var i = 0; i < L.length; i++) if (p < L[i].at + (L[i].e - L[i].s)) return i; return L.length - 1; }
    function nowPos() { return base + Math.max(0, ctx.currentTime - t0); }
    function setLayout(segs) { L = layout(segs); total = L.length ? L[L.length - 1].at + (L[L.length - 1].e - L[L.length - 1].s) : 0; }

    /** Puts the right frame on the canvas for position p (edited time) without playing. */
    async function show(segs, p) {
      var my = ++token; setLayout(segs); if (!L.length) return;
      if (!playing) base = clamp(p, 0, total);
      var i = idxAt(p), srcT = L[i].s + clamp(p - L[i].at, 0, L[i].e - L[i].s), v = vids[i % 2];
      await seekTo(v, srcT); if (my !== token) return;
      o.renderer.draw(v);
    }
    function frame() {
      if (!playing) return;
      var p = nowPos();
      if (p >= total - 0.001) { finish(); return; }
      var i = idxAt(p), seg = L[i], srcT = seg.s + (p - seg.at), v = vids[i % 2];
      if (i !== cur) {
        if (cur >= 0) vids[cur % 2].pause();
        if (Math.abs(v.currentTime - srcT) > 0.15) v.currentTime = srcT;
        var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
        cur = i;
        var other = vids[(i + 1) % 2]; other.pause();
        if (L[i + 1]) other.currentTime = L[i + 1].s;           // get the next piece ready so the join has no gap
      } else if (!v.seeking && Math.abs(v.currentTime - srcT) > 0.3) v.currentTime = srcT;
      o.renderer.draw(v); if (o.onTick) o.onTick(p);
      raf = requestAnimationFrame(frame);
    }
    function finish() {
      var f = onEnd; playing = false; cancelAnimationFrame(raf); stopSources(); vids.forEach(function (v) { v.pause(); });
      if (o.onTick) o.onTick(total); if (f) { onEnd = null; f(true); }
    }
    return {
      total: function () { return total; },
      pos: function () { return playing ? Math.min(total, nowPos()) : base; },
      isPlaying: function () { return playing; },
      show: show,
      setMuted: function (m) { gain.gain.value = m ? 0 : 1; },
      /** mode 'preview' plays through the speakers; 'export' sends the sound only into the recording. Resolves true at the end, false if stopped. */
      play: async function (segs, p, md, withAudio) {
        stop(); mode = md; setLayout(segs); if (!L.length) return false;
        await ctx.resume(); await show(segs, p);
        var my = token; base = p; cur = -1; playing = true;
        gain.disconnect();
        if (mode === 'export') { if (!dest) dest = ctx.createMediaStreamDestination(); gain.connect(dest); } else gain.connect(ctx.destination);
        t0 = ctx.currentTime + 0.1;
        if (o.audio && withAudio) {
          L.forEach(function (s, k) {
            var len = s.e - s.s, end = s.at + len; if (end <= p) return;
            var offs = Math.max(0, p - s.at), when = t0 + Math.max(0, s.at - p);
            var src = ctx.createBufferSource(); src.buffer = o.audio; src.connect(gain);
            try { src.start(when, s.s + offs, len - offs); } catch (e) {}
            sources.push(src);
          });
        }
        return new Promise(function (res) { onEnd = res; raf = requestAnimationFrame(frame); void my; });
      },
      stream: function () { if (!dest) dest = ctx.createMediaStreamDestination(); return dest.stream; },
      stop: stop,
      dispose: function () {
        stop(); vids.forEach(function (v) { v.removeAttribute('src'); try { v.load(); } catch (e) {} if (v.parentNode) v.parentNode.removeChild(v); });
        try { ctx.close(); } catch (e) {}
      },
      videos: vids, ctx: ctx
    };
    function stop() {
      var was = playing, f = onEnd; var p = playing ? Math.min(total, nowPos()) : base;
      playing = false; cancelAnimationFrame(raf); stopSources(); vids.forEach(function (v) { v.pause(); }); base = p;
      onEnd = null; if (was && f) f(false);
    }
  }

  /* =============== 4. The editing screen =============== */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k === 'value') el.value = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) { if (c === null || c === undefined || c === false) return; if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; } el.appendChild(c.nodeType ? c : document.createTextNode(String(c))); }

  function support() {
    var c = document.createElement('canvas'), AC = window.AudioContext || window.webkitAudioContext;
    if (!window.MediaRecorder) return { ok: false, reason: 'This browser cannot record video (no MediaRecorder).' };
    if (!c.captureStream) return { ok: false, reason: 'This browser cannot capture video frames.' };
    if (!AC || !AC.prototype.createMediaStreamDestination) return { ok: false, reason: 'This browser cannot rebuild sound for the edited video.' };
    return { ok: true };
  }
  var MIME_TRIES = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  function pickMime() { for (var i = 0; i < MIME_TRIES.length; i++) { try { if (MediaRecorder.isTypeSupported(MIME_TRIES[i])) return MIME_TRIES[i]; } catch (e) {} } return ''; }

  /**
   * Opens the editor for `file`. Resolves with
   *   { kind: 'edited', file, duration, width, height, state, adjust, mute }   after a real export,
   *   { kind: 'original', file }                                               if the person chose to post it unchanged, or
   *   null                                                                     if they cancelled.
   * opts: { maxBytes (upload limit), maxInputBytes, maxSeconds, minSeconds?, shortMaxSeconds?, initial?, fileName? }
   */
  function open(file, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var sup = support();
      var root = h('div', { class: 've', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit video' });
      var prevFocus = document.activeElement, prevOverflow = document.body.style.overflow;
      var url = URL.createObjectURL(file), eng = null, rend = null, dur = 0, vw = 0, vh = 0;
      var audioBuf = null, audioNote = '';
      var st = null, hist = null, adj = Object.assign({}, DEFAULT_ADJ), bypass = false, mutePreview = false, muteExport = false;
      var selA = 0, selB = 0, busy = false, exporting = null, closed = false, quality = null, qOpts = [];
      var controls = [];
      var host = h('div', { class: 've-hidden' });
      var canvas = h('canvas', { class: 've-canvas', 'aria-label': 'Video preview' });
      var msg = h('div', { class: 've-msg', role: 'status', 'aria-live': 'polite' });
      var prog = h('progress', { max: 100, value: 0, hidden: true, 'aria-label': 'Export progress' });
      var phase = h('div', { class: 've-phase' });

      function ctl(el) { controls.push(el); return el; }
      function say(text, kind) { clear(msg); if (text) msg.appendChild(h('div', { class: 'alert ' + (kind || 'info'), role: kind === 'error' ? 'alert' : null, text: text })); }
      function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

      /* ----- finish / close ----- */
      function teardown() {
        if (closed) return; closed = true;
        try { if (eng) eng.dispose(); } catch (e) {} try { if (rend) rend.dispose(); } catch (e) {}
        URL.revokeObjectURL(url);
        document.removeEventListener('keydown', onKey, true); document.removeEventListener('visibilitychange', onVis);
        document.body.style.overflow = prevOverflow; document.body.classList.remove('ve-open');
        if (root.parentNode) root.parentNode.removeChild(root);
        try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
      }
      function done(result) { teardown(); resolve(result); }
      function isDirty() {
        return !!hist && (hist.canUndo() || JSON.stringify(adj) !== JSON.stringify(DEFAULT_ADJ) || muteExport || (opts.initial && JSON.stringify(st) !== JSON.stringify(opts.initial.state)));
      }
      function pristine() { return JSON.stringify(st) === JSON.stringify(normalize({ inT: 0, outT: dur, cuts: [] }, dur)) && JSON.stringify(adj) === JSON.stringify(DEFAULT_ADJ) && !muteExport; }
      function confirmBox(text, yes, no) {
        return new Promise(function (res) {
          var box = h('div', { class: 've-confirm', role: 'alertdialog', 'aria-label': text });
          function fin(v) { if (box.parentNode) box.parentNode.removeChild(box); res(v); }
          var y = h('button', { class: 'btn', type: 'button', text: yes, onclick: function () { fin(true); } });
          box.appendChild(h('div', { class: 've-confirm-card' }, h('p', { text: text }), h('div', { class: 'row' }, h('button', { class: 'btn secondary', type: 'button', text: no, onclick: function () { fin(false); } }), y)));
          root.appendChild(box); y.focus();
        });
      }
      async function tryCancel() {
        if (busy && exporting) { cancelExport(); return; }
        if (busy) return;
        if (eng) eng.stop();
        if (isDirty() && !(await confirmBox('Discard your edits and close the editor? Nothing has been uploaded.', 'Discard edits', 'Keep editing'))) return;
        done(null);
      }

      /* ----- state helpers ----- */
      function segs() { return keepSegments(st); }
      function total() { return editedDuration(st); }
      function setState(n, record) {
        st = normalize(n, dur);
        if (record && hist.push(st)) { /* recorded */ }
        selA = clamp(selA, st.inT, st.outT); selB = clamp(selB, st.inT, st.outT);
        if (selB - selA < 0.1) { selB = Math.min(st.outT, selA + 0.1); if (selB - selA < 0.1) selA = Math.max(st.inT, selB - 0.1); }
        paintAll(); showAt(Math.min(eng ? eng.pos() : 0, total()));
      }
      function showAt(p) { if (eng) eng.show(segs(), clamp(p, 0, Math.max(0, total() - 0.001))).then(function () { paintPos(p); }); }

      /* ----- timeline ----- */
      var track = h('div', { class: 've-track' });
      var layers = h('div', { class: 've-layers' });
      var playhead = h('div', { class: 've-playhead' });
      function pct(t) { return (dur ? t / dur * 100 : 0) + '%'; }
      function place(el, a, b) { el.style.left = pct(a); el.style.width = (dur ? (b - a) / dur * 100 : 0) + '%'; }
      // moving one selection handle past the other pushes the other along
      function setSelA(t) { selA = clamp(t, st.inT, st.outT - 0.1); if (selB < selA + 0.1) selB = Math.min(st.outT, selA + 0.1); paintAll(); }
      function setSelB(t) { selB = clamp(t, st.inT + 0.1, st.outT); if (selA > selB - 0.1) selA = Math.max(st.inT, selB - 0.1); paintAll(); }
      function handle(label, get, set, cls) {
        var el = h('div', { class: 've-handle ' + cls, role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': String(r3(dur)) });
        var before = null;
        function move(ev) { var r = track.getBoundingClientRect(); set(clamp((ev.clientX - r.left) / r.width, 0, 1) * dur, false); }
        el.addEventListener('pointerdown', function (ev) { if (busy) return; ev.preventDefault(); if (eng) eng.stop(); paintPlayBtn(); before = JSON.stringify(st); el.setPointerCapture(ev.pointerId); el.addEventListener('pointermove', move); });
        el.addEventListener('pointerup', function (ev) { el.removeEventListener('pointermove', move); try { el.releasePointerCapture(ev.pointerId); } catch (e) {} set(get(), true); });
        el.addEventListener('pointercancel', function () { el.removeEventListener('pointermove', move); });
        el.addEventListener('keydown', function (ev) {
          if (busy) return; var d = ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : 0; if (!d) return;
          ev.preventDefault(); if (eng) eng.stop(); paintPlayBtn(); set(get() + d * (ev.shiftKey ? 1 : 0.1), true);
        });
        controls.push(el); void before; return el;
      }
      var hStart = handle('Start of the video', function () { return st.inT; }, function (t, rec) { setState({ inT: Math.min(t, st.outT - MIN_KEEP), outT: st.outT, cuts: st.cuts }, rec); }, 've-h-in');
      var hEnd = handle('End of the video', function () { return st.outT; }, function (t, rec) { setState({ inT: st.inT, outT: Math.max(t, st.inT + MIN_KEEP), cuts: st.cuts }, rec); }, 've-h-out');
      var hA = handle('Section to remove: from', function () { return selA; }, function (t) { setSelA(t); }, 've-h-a');
      var hB = handle('Section to remove: to', function () { return selB; }, function (t) { setSelB(t); }, 've-h-b');
      track.addEventListener('click', function (ev) {
        if (busy || ev.target !== track && ev.target !== layers && !(ev.target.className || '').toString().match(/ve-(cut|sel|dim)/)) return;
        var r = track.getBoundingClientRect(), t = clamp((ev.clientX - r.left) / r.width, 0, 1) * dur;
        if (eng) eng.stop(); paintPlayBtn(); var p = toEdited(segs(), t); showAt(p); seek.value = String(p);
      });
      track.appendChild(layers); track.appendChild(playhead); [hStart, hEnd, hA, hB].forEach(function (x) { track.appendChild(x); });

      /* ----- inputs ----- */
      function timeInput(label, get, set) {
        var inp = h('input', { type: 'text', inputmode: 'decimal', class: 've-time', 'aria-label': label, autocomplete: 'off' });
        function paint() { inp.value = fmtTime(get()); inp.removeAttribute('aria-invalid'); }
        inp.addEventListener('change', function () {
          var t = parseTime(inp.value);
          if (!isFinite(t) || t < 0 || t > dur + 0.001) { inp.setAttribute('aria-invalid', 'true'); say('Use a time like 12.5 or 1:05.3, between 0:00.0 and ' + fmtTime(dur) + '.', 'error'); return; }
          say(''); if (eng) eng.stop(); paintPlayBtn(); set(t);
        });
        var here = h('button', { class: 'btn secondary small', type: 'button', text: 'Playhead', title: 'Use the current playhead time', 'aria-label': label + ': use the playhead time', onclick: function () { if (eng) eng.stop(); paintPlayBtn(); set(toSource(segs(), eng ? eng.pos() : 0)); } });
        ctl(inp); ctl(here);
        return { el: h('label', { class: 've-field' }, h('span', { text: label }), h('span', { class: 've-fieldrow' }, inp, here)), paint: paint };
      }
      var fIn = timeInput('Start', function () { return st.inT; }, function (t) { setState({ inT: Math.min(t, st.outT - MIN_KEEP), outT: st.outT, cuts: st.cuts }, true); });
      var fOut = timeInput('End', function () { return st.outT; }, function (t) { setState({ inT: st.inT, outT: Math.max(t, st.inT + MIN_KEEP), cuts: st.cuts }, true); });
      var fA = timeInput('Remove from', function () { return selA; }, function (t) { setSelA(t); });
      var fB = timeInput('Remove to', function () { return selB; }, function (t) { setSelB(t); });

      var removeBtn = ctl(h('button', { class: 'btn', type: 'button', text: 'Remove section', onclick: function () {
        if (eng) eng.stop(); paintPlayBtn();
        var n = removeSection(st, selA, selB, dur);
        if (!n) return say('That would leave almost nothing. Keep at least ' + MIN_KEEP + ' seconds of video.', 'error');
        say(''); setState(n, true);
        selA = Math.min(st.outT - 0.1, selB); selB = Math.min(st.outT, selA + Math.min(2, Math.max(0.1, st.outT - selA))); paintAll();
      } }));
      var undoBtn = ctl(h('button', { class: 'btn secondary', type: 'button', text: 'Undo', onclick: function () { var s = hist.undo(); if (s) { st = s; setState(s, false); } } }));
      var redoBtn = ctl(h('button', { class: 'btn secondary', type: 'button', text: 'Redo', onclick: function () { var s = hist.redo(); if (s) { st = s; setState(s, false); } } }));
      var cutList = h('ul', { class: 've-cuts', 'aria-label': 'Removed sections' });

      /* ----- appearance ----- */
      var ADJ = [['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation'], ['warmth', 'Warmth (cooler to warmer)']];
      var adjUI = {};
      var adjBox = h('div', { class: 've-adj' });
      ADJ.forEach(function (a) {
        var out = h('output', { class: 've-val', 'aria-live': 'off' });
        var rng = h('input', { type: 'range', class: 've-r-' + a[0], min: '-100', max: '100', step: '1', value: '0', id: 've-' + a[0], 'aria-label': a[1] });
        rng.addEventListener('input', function () { adj[a[0]] = Number(rng.value); paintAdj(); redraw(); });
        var reset = h('button', { class: 'btn ghost small', type: 'button', text: 'Reset', 'aria-label': 'Reset ' + a[1], onclick: function () { adj[a[0]] = 0; paintAdj(); redraw(); } });
        ctl(rng); ctl(reset); adjUI[a[0]] = { rng: rng, out: out, reset: reset };
        adjBox.appendChild(h('div', { class: 've-adjrow' }, h('label', { for: 've-' + a[0], text: a[1] }), out, rng, reset));
      });
      var resetAdj = ctl(h('button', { class: 'btn secondary small', type: 'button', text: 'Reset all adjustments', onclick: function () { adj = Object.assign({}, DEFAULT_ADJ); paintAdj(); redraw(); } }));
      var cmpBtn = ctl(h('button', { class: 'btn secondary small', type: 'button', 'aria-pressed': 'false', text: 'Show original colors', onclick: function () {
        bypass = !bypass; cmpBtn.setAttribute('aria-pressed', String(bypass)); cmpBtn.textContent = bypass ? 'Showing original colors (tap to go back)' : 'Show original colors'; redraw();
      } }));
      function syncOrig() { if (st) origBtn.disabled = busy || !pristine() || file.size > opts.maxBytes; }
      function paintAdj() {
        ADJ.forEach(function (a) { var u = adjUI[a[0]], v = adj[a[0]]; u.rng.value = String(v); u.out.textContent = (v > 0 ? '+' : '') + v; u.reset.disabled = busy || v === 0; });
        resetAdj.disabled = busy || JSON.stringify(adj) === JSON.stringify(DEFAULT_ADJ);
        syncOrig();
      }
      function redraw() { if (rend && rend.set) rend.set(adj, bypass); if (eng && !eng.isPlaying()) showAt(eng.pos()); }

      /* ----- transport ----- */
      var playBtn = ctl(h('button', { class: 'btn', type: 'button', 'aria-label': 'Play', text: 'Play', onclick: togglePlay }));
      var muteBtn = ctl(h('button', { class: 'btn secondary', type: 'button', 'aria-pressed': 'false', text: 'Sound on', onclick: function () {
        mutePreview = !mutePreview; if (eng) eng.setMuted(mutePreview); muteBtn.setAttribute('aria-pressed', String(mutePreview)); muteBtn.textContent = mutePreview ? 'Sound off' : 'Sound on';
      } }));
      var seek = ctl(h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0', class: 've-seek', 'aria-label': 'Position in the edited video' }));
      seek.addEventListener('input', function () { if (eng) eng.stop(); paintPlayBtn(); showAt(Number(seek.value)); });
      var timeOut = h('output', { class: 've-clock', 'aria-live': 'off' });
      function paintPlayBtn(force) { var p = force === true || !!(eng && eng.isPlaying()); playBtn.textContent = p ? 'Pause' : 'Play'; playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play'); }
      function paintPos(p) {
        p = clamp(p, 0, total()); timeOut.textContent = fmtTime(p) + ' / ' + fmtTime(total());
        seek.max = String(Math.max(0.05, r3(total()))); if (document.activeElement !== seek) seek.value = String(r3(p));
        playhead.style.left = pct(toSource(segs(), p));
        seek.style.setProperty('--pct', (total() ? p / total() * 100 : 0) + '%');
      }
      async function togglePlay() {
        if (!eng || busy) return;
        if (eng.isPlaying()) { eng.stop(); paintPlayBtn(); return; }
        var p = eng.pos(); if (p >= total() - 0.05) p = 0;
        say(''); paintPlayBtn(true);
        var finished = await eng.play(segs(), p, 'preview', true); void finished; paintPlayBtn();
      }

      /* ----- paint ----- */
      function paintAll() {
        clear(layers);
        var dimL = h('div', { class: 've-dim' }), dimR = h('div', { class: 've-dim' }); place(dimL, 0, st.inT); place(dimR, st.outT, dur);
        layers.appendChild(dimL); layers.appendChild(dimR);
        st.cuts.forEach(function (c) { var d = h('div', { class: 've-cut', title: 'Removed ' + fmtTime(c[0]) + ' to ' + fmtTime(c[1]) }); place(d, c[0], c[1]); layers.appendChild(d); });
        var sel = h('div', { class: 've-sel' }); place(sel, selA, selB); layers.appendChild(sel);
        [[hStart, st.inT], [hEnd, st.outT], [hA, selA], [hB, selB]].forEach(function (x) { x[0].style.left = pct(x[1]); x[0].setAttribute('aria-valuenow', String(r3(x[1]))); x[0].setAttribute('aria-valuetext', fmtTime(x[1])); });
        fIn.paint(); fOut.paint(); fA.paint(); fB.paint();
        clear(cutList);
        if (!st.cuts.length) cutList.appendChild(h('li', { class: 'muted small', text: 'No sections removed yet.' }));
        st.cuts.forEach(function (c, i) {
          var b = ctl(h('button', { class: 'btn secondary small', type: 'button', text: 'Restore', 'aria-label': 'Restore the removed section ' + fmtTime(c[0]) + ' to ' + fmtTime(c[1]), onclick: function () { if (eng) eng.stop(); paintPlayBtn(); setState(restoreSection(st, i, dur), true); } }));
          b.disabled = busy; cutList.appendChild(h('li', null, h('span', { text: 'Removed ' + fmtTime(c[0]) + ' to ' + fmtTime(c[1]) + ' (' + (c[1] - c[0]).toFixed(1) + ' s)' }), b));
        });
        undoBtn.disabled = busy || !hist.canUndo(); redoBtn.disabled = busy || !hist.canRedo();
        removeBtn.disabled = busy; paintAdj(); paintQuality(); paintPos(eng ? eng.pos() : 0);
      }

      /* ----- export options ----- */
      var qSel = ctl(h('select', { id: 've-q', 'aria-label': 'Quality and size' }));
      qSel.addEventListener('change', function () { quality = qOpts.filter(function (q) { return q.id === qSel.value; })[0]; paintQuality(); });
      var muteBox = ctl(h('input', { type: 'checkbox', id: 've-mute' }));
      muteBox.addEventListener('change', function () { muteExport = muteBox.checked; paintQuality(); });
      var estimate = h('p', { class: 'hint' });
      function paintQuality() {
        if (!quality) return;
        syncOrig();
        qOpts = qualityOptions(vw, vh, Math.max(0.1, total()), opts.maxBytes);
        if (!quality || !qOpts.some(function (q) { return q.id === quality.id; })) quality = pickQuality(qOpts, opts.maxBytes);
        else quality = qOpts.filter(function (q) { return q.id === quality.id; })[0];
        clear(qSel); qOpts.forEach(function (q) { qSel.appendChild(h('option', { value: q.id, text: q.label + ' · ~' + (q.bytes / 1048576).toFixed(q.bytes < 10485760 ? 1 : 0) + ' MB' })); });
        qSel.value = quality.id;
        var over = quality.bytes > opts.maxBytes;
        estimate.textContent = 'Estimated size ' + (quality.bytes / 1048576).toFixed(1) + ' MB. The limit is ' + mb(opts.maxBytes) + ' MB per video. ' + (over ? 'This is probably too big: choose a smaller size or cut more.' : 'The real size is checked after exporting.');
        estimate.className = 'hint' + (over ? ' ve-warn' : '');
      }

      /* ----- export ----- */
      function setBusy(b) {
        busy = b; root.classList.toggle('busy', b);
        controls.forEach(function (c) { if (c !== cancelExportBtn) c.disabled = b; });
        exportBtn.disabled = b; origBtn.disabled = b || !pristine() || file.size > opts.maxBytes; resetBtn.disabled = b; closeBtn.disabled = false;
        if (!b) { paintAll(); }
        cancelExportBtn.hidden = !b;
      }
      var cancelExportBtn = h('button', { class: 'btn secondary', type: 'button', text: 'Cancel export', hidden: true, onclick: function () { cancelExport(); } });
      function cancelExport() { if (exporting) exporting.abort('cancel'); }
      function onVis() { if (document.hidden && exporting) exporting.abort('hidden'); }

      async function doExport() {
        if (busy) return;
        if (eng) eng.stop(); paintPlayBtn(); say('');
        var tot = total();
        if (opts.shortMaxSeconds && tot > opts.shortMaxSeconds + 0.05) return say('Shorts must be ' + opts.shortMaxSeconds + ' seconds or less. Your edited video is ' + tot.toFixed(1) + ' seconds. Cut or trim more.', 'error');
        if (quality.bytes > opts.maxBytes * 3) return say('At this size the video will be far over the ' + mb(opts.maxBytes) + ' MB limit. Choose a smaller size or cut more.', 'error');
        if (document.hidden) return say('Keep this page open and on screen while exporting.', 'error');
        var mime = opts.mimeOverride || pickMime(); if (!mime) return say('This device cannot record a video file, so it cannot export edits.', 'error');
        var useAudio = !!audioBuf && !muteExport;
        var rec = null, chunks = [], aborted = null, wake = null;
        exporting = { abort: function (why) { aborted = aborted || why; if (eng) eng.stop(); } };
        setBusy(true); prog.hidden = false; prog.value = 0; phase.textContent = 'Preparing…';
        var canvasW = canvas.width, canvasH = canvas.height;
        try {
          if ('wakeLock' in navigator && navigator.wakeLock.request) { try { wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
          rend.resize(quality.w, quality.h);
          await eng.show(segs(), 0); if (aborted) throw new Error(aborted);
          var stream = canvas.captureStream(30);
          if (useAudio) { var at = eng.stream().getAudioTracks()[0]; if (at) stream.addTrack(at); }
          var ropts = { mimeType: mime, videoBitsPerSecond: quality.vbps }; if (useAudio) ropts.audioBitsPerSecond = quality.abps;
          rec = new MediaRecorder(stream, ropts);
          var stopped = new Promise(function (res, rej) { rec.onstop = res; rec.onerror = function (e) { rej((e && e.error) || new Error('recorder')); }; });
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          eng.setMuted(false);
          var started = Date.now();
          var onTick = function (p) { if (aborted) { eng.stop(); return; } prog.value = Math.round(p / tot * 100); phase.textContent = 'Exporting… ' + Math.round(p / tot * 100) + '% (' + fmtTime(p) + ' of ' + fmtTime(tot) + '). Keep this page open.'; };
          o_onTick = onTick;
          rec.start(1000);
          var finished = await eng.play(segs(), 0, 'export', useAudio);
          o_onTick = null;
          if (!finished || aborted) throw new Error(aborted || 'stopped');
          await new Promise(function (r) { setTimeout(r, 300); });          // let the last frames and sound reach the recorder
          phase.textContent = 'Finishing the file…'; prog.removeAttribute('value');
          rec.stop(); await stopped;
          stream.getTracks().forEach(function (t) { t.stop(); });
          var type = (rec.mimeType || mime).split(';')[0] || 'video/webm', blob = new Blob(chunks, { type: type });
          if (!blob.size) throw new Error('empty');
          var seconds = (Date.now() - started) / 1000;
          if (/webm/.test(type)) { var fixed = fixWebmDuration(new Uint8Array(await blob.arrayBuffer()), tot); blob = new Blob([fixed], { type: type }); }
          if (blob.size > opts.maxBytes) {
            throw Object.assign(new Error('big'), { size: blob.size });
          }
          void seconds;
          var ext = type === 'video/mp4' ? 'mp4' : 'webm';
          var out = new File([blob], (opts.fileName || 'edited-video') + '.' + ext, { type: type });
          done({ kind: 'edited', file: out, duration: tot, width: quality.w, height: quality.h, state: JSON.parse(JSON.stringify(st)), adjust: Object.assign({}, adj), mute: muteExport || !audioBuf });
        } catch (e) {
          o_onTick = null;
          try { if (rec && rec.state !== 'inactive') { rec.ondataavailable = null; rec.onstop = null; rec.stop(); } } catch (e2) {}
          rend.resize(canvasW, canvasH); if (eng) { eng.stop(); eng.setMuted(mutePreview); }
          exporting = null; prog.hidden = true; phase.textContent = ''; if (wake) { try { wake.release(); } catch (e3) {} }
          if (closed) return;
          setBusy(false); showAt(0);
          var m = String(e && e.message || '');
          if (m === 'cancel') say('Export canceled. Your edits are still here.', 'info');
          else if (m === 'hidden') say('Export stopped because the page went to the background. Your edits are kept. Keep this page open and on screen, then try again.', 'error');
          else if (m === 'big') say('The exported video is ' + mb(e.size) + ' MB, over the ' + mb(opts.maxBytes) + ' MB limit. Nothing was uploaded and your edits are kept. Choose a smaller size, or cut more, and export again.', 'error');
          else say('The video could not be exported on this device (' + (m || 'unknown error') + '). Nothing was uploaded and your edits are kept. You can try a smaller size or a shorter video.', 'error');
        }
      }
      var o_onTick = null;

      /* ----- buttons ----- */
      var closeBtn = h('button', { class: 'btn secondary small', type: 'button', text: 'Cancel', onclick: tryCancel });
      var exportBtn = h('button', { class: 'btn', type: 'button', text: 'Export and post', onclick: doExport });
      var resetBtn = h('button', { class: 'btn secondary', type: 'button', text: 'Reset edits', onclick: async function () {
        if (busy) return; if (eng) eng.stop(); paintPlayBtn();
        if (!pristine() && !(await confirmBox('Reset all edits (trim, removed sections and colors) to the original video?', 'Reset edits', 'Keep editing'))) return;
        adj = Object.assign({}, DEFAULT_ADJ); muteExport = !audioBuf; muteBox.checked = muteExport; bypass = false; cmpBtn.setAttribute('aria-pressed', 'false'); cmpBtn.textContent = 'Show original colors';
        hist.push(normalize({ inT: 0, outT: dur, cuts: [] }, dur)); selA = 0; selB = Math.min(dur, 2); setState({ inT: 0, outT: dur, cuts: [] }, false); redraw();
      } });
      var origBtn = h('button', { class: 'btn ghost', type: 'button', text: 'Use the original, no edits', onclick: function () { if (!busy && pristine() && file.size <= opts.maxBytes) done({ kind: 'original', file: file }); } });

      /* ----- layout ----- */
      var body = h('div', { class: 've-body' },
        h('div', { class: 've-stage' }, canvas),
        h('div', { class: 've-transport' }, playBtn, h('div', { class: 've-seekwrap' }, seek, timeOut), muteBtn),
        h('section', { class: 've-sec', 'aria-label': 'Trim and cut' },
          h('h3', { text: 'Trim and cut' }),
          h('p', { class: 'hint', text: 'Drag the blue handles to choose where the video starts and ends. Drag the orange handles around a part you want to remove, then tap Remove section. Arrow keys move a selected handle by 0.1 s (hold Shift for 1 s).' }),
          track,
          h('div', { class: 've-legend small muted' }, h('span', { class: 'k k-keep', text: 'Kept' }), h('span', { class: 'k k-cut', text: 'Removed' }), h('span', { class: 'k k-sel', text: 'Selection' })),
          h('div', { class: 've-fields' }, fIn.el, fOut.el, fA.el, fB.el),
          h('div', { class: 've-row' }, removeBtn, undoBtn, redoBtn),
          cutList),
        h('section', { class: 've-sec', 'aria-label': 'Appearance' },
          h('h3', { text: 'Appearance' }), adjBox, h('div', { class: 've-row' }, resetAdj, cmpBtn),
          h('p', { class: 'hint', text: 'These apply to the whole remaining video.' })),
        h('section', { class: 've-sec', 'aria-label': 'Export' },
          h('h3', { text: 'Export' }),
          h('label', { for: 've-q', text: 'Size and quality' }), qSel, estimate,
          h('label', { class: 'check', for: 've-mute' }, muteBox, ' Remove the sound from the exported video'),
          phase, prog, msg));
      var foot = h('div', { class: 've-foot' }, resetBtn, origBtn, cancelExportBtn, exportBtn);
      root.appendChild(h('div', { class: 've-head' }, h('strong', { text: 'Edit video' }), h('span', { class: 'small muted', text: 'Edit → Preview → Export and post' }), closeBtn));
      root.appendChild(body); root.appendChild(foot); root.appendChild(host);
      [playBtn, muteBtn, seek].forEach(function () {});

      /* ----- keyboard ----- */
      function onKey(ev) {
        if (closed) return;
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); tryCancel(); return; }
        if (ev.key === ' ' && !/INPUT|BUTTON|SELECT|TEXTAREA/.test(ev.target.tagName) && ev.target.getAttribute('role') !== 'slider') { ev.preventDefault(); togglePlay(); return; }
        if (ev.key === 'Tab') {
          var f = Array.prototype.filter.call(root.querySelectorAll('button, input, select, [tabindex="0"]'), function (x) { return !x.disabled && !x.hidden && x.offsetParent !== null; });
          if (!f.length) return; var first = f[0], last = f[f.length - 1];
          if (!root.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
          else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
          else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true); document.addEventListener('visibilitychange', onVis);
      document.body.classList.add('ve-open'); document.body.style.overflow = 'hidden'; document.body.appendChild(root);

      /* ----- start: check the video, read its sound ----- */
      (async function init() {
        phase.textContent = 'Preparing…'; prog.hidden = false; prog.removeAttribute('value'); controls.forEach(function (c) { c.disabled = true; }); exportBtn.disabled = origBtn.disabled = resetBtn.disabled = true;
        var fail = function (text) { prog.hidden = true; phase.textContent = ''; say(text, 'error'); origBtn.hidden = true; exportBtn.hidden = true; resetBtn.hidden = true; };
        if (!sup.ok) { prog.hidden = true; phase.textContent = ''; say('This device cannot edit videos here. ' + sup.reason + (file.size <= opts.maxBytes ? ' You can still post the original video.' : ' This video is also over the size limit, so it cannot be posted from this device.'), 'error'); exportBtn.hidden = true; resetBtn.hidden = true; origBtn.disabled = file.size > opts.maxBytes; return; }
        var probe = h('video'); probe.muted = true; probe.preload = 'metadata'; probe.src = url;
        try {
          await new Promise(function (res, rej) { probe.onloadedmetadata = res; probe.onerror = function () { rej(new Error('read')); }; setTimeout(function () { rej(new Error('slow')); }, 15000); });
        } catch (e) { return fail("The browser couldn't read that video. Try an MP4, MOV or WebM file."); }
        dur = probe.duration; vw = probe.videoWidth; vh = probe.videoHeight; probe.removeAttribute('src'); probe.load();
        if (!isFinite(dur) || dur <= 0 || !vw || !vh) return fail("This video's length could not be read, so it cannot be edited.");
        if (opts.maxInputBytes && file.size > opts.maxInputBytes) return fail('This video is ' + mb(file.size) + ' MB. The editor works with files up to ' + mb(opts.maxInputBytes) + ' MB on this device. Record a shorter clip.');
        if (opts.maxSeconds && dur > opts.maxSeconds) return fail('This video is ' + Math.round(dur) + ' seconds long. The editor works with videos up to ' + opts.maxSeconds + ' seconds' + (opts.maxSeconds >= 120 ? ' (' + Math.round(opts.maxSeconds / 60) + ' minutes)' : '') + ' because the sound is held in memory while editing.');
        if (opts.requireVertical && vh <= vw) return fail('Shorts must be vertical (taller than wide). Use the Video tab for this one.');
        st = normalize((opts.initial && opts.initial.state) || { inT: 0, outT: dur, cuts: [] }, dur); hist = History(st);
        if (opts.initial && opts.initial.adjust) adj = Object.assign({}, DEFAULT_ADJ, opts.initial.adjust);
        selA = st.inT + (st.outT - st.inT) * 0.4; selB = Math.min(st.outT, selA + Math.min(2, dur / 5));
        // sound: decode once, so the edited sound can be rebuilt exactly
        var AC = window.AudioContext || window.webkitAudioContext;
        try {
          var tmp = new AC(), ab = await file.arrayBuffer();
          audioBuf = await new Promise(function (res, rej) { var p = tmp.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
          tmp.close();
        } catch (e) { audioBuf = null; }
        if (!audioBuf) { muteExport = true; muteBox.checked = true; muteBox.disabled = true; audioNote = 'No readable sound was found in this video, so the exported video will have no sound.'; }
        var cv = canvas; rend = makeRenderer(cv);
        var sc = Math.min(1, 720 / Math.min(vw, vh)); rend.resize(Math.max(2, Math.round(vw * sc / 2) * 2), Math.max(2, Math.round(vh * sc / 2) * 2));
        eng = Engine({ url: url, host: host, renderer: rend, audio: audioBuf, onTick: function (p) { paintPos(p); if (o_onTick) o_onTick(p); } });
        eng.setMuted(false);
        quality = { id: '' }; qOpts = qualityOptions(vw, vh, Math.max(0.1, editedDuration(st)), opts.maxBytes); quality = pickQuality(qOpts, opts.maxBytes);
        if (!rend.adjustable) { ADJ.forEach(function (a) { adjUI[a[0]].rng.disabled = true; }); resetAdj.disabled = cmpBtn.disabled = true; audioNote += ' Color adjustments are not available on this device.'; }
        prog.hidden = true; phase.textContent = '';
        controls.forEach(function (c) { c.disabled = false; });
        if (!rend.adjustable) { ADJ.forEach(function (a) { adjUI[a[0]].rng.disabled = true; adjUI[a[0]].reset.disabled = true; }); resetAdj.disabled = true; cmpBtn.disabled = true; }
        exportBtn.disabled = false; resetBtn.disabled = false; origBtn.disabled = !(pristine() && file.size <= opts.maxBytes);
        if (rend.set) rend.set(adj, false);
        setBusy(false); paintAll(); await showAt(0);
        if (file.size > opts.maxBytes) audioNote += ' This video is ' + (file.size / 1048576).toFixed(0) + ' MB, over the ' + mb(opts.maxBytes) + ' MB limit, so it has to be edited and exported smaller before it can be posted.';
        if (audioNote) say(audioNote.trim(), 'info'); closeBtn.focus();
      })();
    });
  }

  return {
    open: open, support: support,
    model: { normalize: normalize, keepSegments: keepSegments, editedDuration: editedDuration, layout: layout, toEdited: toEdited, toSource: toSource, removeSection: removeSection, restoreSection: restoreSection, fmtTime: fmtTime, parseTime: parseTime, History: History, qualityOptions: qualityOptions, pickQuality: pickQuality, MIN_KEEP: MIN_KEEP },
    fixWebmDuration: fixWebmDuration
  };
});

/* Family Circle: camera effects for calls (background blur, background pictures, face filters).
   Everything runs on the device. The video is drawn onto a canvas and that canvas is what the call sends, so nothing is uploaded
   for the effects. The two helper models (MediaPipe selfie segmentation and face mesh, Apache-2.0) are served from vendor/mediapipe/
   and only load the first time someone picks an effect. See THIRD-PARTY-NOTICES.md. */
(function () {
  'use strict';
  var me = document.currentScript, ROOT = me && me.src ? me.src.replace(/[^/]*(\?.*)?$/, '') : '';
  var VER = me && me.src && /[?&]v=([^&]+)/.exec(me.src) ? /[?&]v=([^&]+)/.exec(me.src)[1] : '';
  var loading = {};
  function loadScript(rel) {
    if (loading[rel]) return loading[rel];
    return (loading[rel] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = ROOT + rel + (VER ? '?v=' + VER : '');
      s.onload = res; s.onerror = function () { delete loading[rel]; rej(new Error('Could not load ' + rel)); };
      document.head.appendChild(s);
    }));
  }

  var BACKGROUNDS = [
    { id: 'none', label: 'None' },
    { id: 'blur', label: 'Blur' },
    { id: 'sunset', label: 'Sunset', stops: ['#ff9a8b', '#ff6a88', '#9b5de5'] },
    { id: 'ocean', label: 'Ocean', stops: ['#43cea2', '#185a9d', '#0b2e59'] },
    { id: 'forest', label: 'Forest', stops: ['#a8e063', '#56ab2f', '#1e3c1a'] },
    { id: 'candy', label: 'Candy', stops: ['#fbc2eb', '#a6c1ee', '#fdfbfb'] },
    { id: 'night', label: 'Night', stops: ['#0f2027', '#203a43', '#2c5364'] },
    { id: 'cozy', label: 'Cozy', stops: ['#f6d365', '#fda085', '#7b4a2e'] }
  ];
  var FILTERS = [
    { id: 'none', label: 'None', icon: '\u{1F6AB}' },
    { id: 'shades', label: 'Shades', icon: '\u{1F576}' },
    { id: 'crown', label: 'Crown', icon: '\u{1F451}' },
    { id: 'bunny', label: 'Bunny', icon: '\u{1F430}' },
    { id: 'cat', label: 'Cat', icon: '\u{1F431}' },
    { id: 'hearts', label: 'Hearts', icon: '\u{1F60D}' },
    { id: 'clown', label: 'Clown nose', icon: '\u{1F921}' }
  ];
  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  /* ---------- drawing helpers ---------- */
  function cover(ctx, img, iw, ih, w, h) {
    var s = Math.max(w / iw, h / ih), dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  function drawBackground(ctx, w, h, bg, video, scratch, image) {
    if (bg === 'blur') {
      // Shrink then stretch: a blur that works in every browser (canvas "filter" is missing on some phones).
      var sw = Math.max(16, Math.round(w / 12)), sh = Math.max(9, Math.round(h / 12));
      scratch.width = sw; scratch.height = sh;
      var sc = scratch.getContext('2d'); sc.imageSmoothingEnabled = true; sc.drawImage(video, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(scratch, 0, 0, sw, sh, 0, 0, w, h);
      return;
    }
    if (bg === 'image' && image) { cover(ctx, image, image.naturalWidth || image.width, image.naturalHeight || image.height, w, h); return; }
    var def = BACKGROUNDS.filter(function (b) { return b.id === bg; })[0];
    if (def && def.stops) {
      var g = ctx.createLinearGradient(0, 0, w, h);
      def.stops.forEach(function (c, i) { g.addColorStop(i / (def.stops.length - 1), c); });
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else { ctx.fillStyle = '#222'; ctx.fillRect(0, 0, w, h); }
  }
  function emoji(ctx, ch, x, y, size, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.font = size + 'px ' + EMOJI_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ch, 0, 0); ctx.restore();
  }
  function ellipse(ctx, x, y, rx, ry, rot, fill, stroke) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(2, rx * 0.2); ctx.stroke(); }
  }
  /** Face filters. lm = 468 landmarks (0..1). Points are turned into pixels, the head tilt is measured from the eyes. */
  function drawFilter(ctx, id, lm, w, h) {
    function P(i) { return { x: lm[i * 2] * w, y: lm[i * 2 + 1] * h }; }
    var a = P(33), b = P(263); if (a.x > b.x) { var t = a; a = b; b = t; }
    var roll = Math.atan2(b.y - a.y, b.x - a.x);
    var fl = P(234), fr = P(454), faceW = Math.hypot(fr.x - fl.x, fr.y - fl.y);
    var top = P(10), nose = P(1), eyeMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    var up = { x: Math.sin(roll), y: -Math.cos(roll) };          // the direction "up" for this head tilt
    function above(d) { return { x: top.x + up.x * d, y: top.y + up.y * d }; }
    if (id === 'shades') emoji(ctx, '\u{1F576}', eyeMid.x, eyeMid.y, faceW * 0.95, roll);
    else if (id === 'crown') { var c = above(faceW * 0.12); emoji(ctx, '\u{1F451}', c.x, c.y, faceW * 0.8, roll); }
    else if (id === 'hearts') { emoji(ctx, '\u{1F497}', a.x, a.y, faceW * 0.3, roll); emoji(ctx, '\u{1F497}', b.x, b.y, faceW * 0.3, roll); }
    else if (id === 'clown') ellipse(ctx, nose.x, nose.y, faceW * 0.08, faceW * 0.08, 0, '#e3262e', 'rgba(255,255,255,.7)');
    else if (id === 'bunny' || id === 'cat') {
      [-1, 1].forEach(function (side) {
        var base = above(faceW * 0.02), off = faceW * 0.27 * side, lean = side * 0.28;
        var bx = base.x + Math.cos(roll) * off, by = base.y + Math.sin(roll) * off;
        ctx.save(); ctx.translate(bx, by); ctx.rotate(roll + lean);
        if (id === 'bunny') { ellipse(ctx, 0, -faceW * 0.3, faceW * 0.1, faceW * 0.3, 0, '#fff', '#f6c1d4'); ellipse(ctx, 0, -faceW * 0.3, faceW * 0.045, faceW * 0.2, 0, '#f8a7c1'); }
        else {
          ctx.beginPath(); ctx.moveTo(-faceW * 0.13, 0); ctx.lineTo(0, -faceW * 0.3); ctx.lineTo(faceW * 0.13, 0); ctx.closePath(); ctx.fillStyle = '#4a4a4a'; ctx.fill();
          ctx.beginPath(); ctx.moveTo(-faceW * 0.07, -faceW * 0.02); ctx.lineTo(0, -faceW * 0.2); ctx.lineTo(faceW * 0.07, -faceW * 0.02); ctx.closePath(); ctx.fillStyle = '#f8a7c1'; ctx.fill();
        }
        ctx.restore();
      });
      if (id === 'cat') {
        ellipse(ctx, nose.x, nose.y, faceW * 0.04, faceW * 0.03, roll, '#f06a8d');
        ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(2, faceW * 0.012); ctx.lineCap = 'round';
        [-1, 1].forEach(function (side) { [-0.18, 0, 0.18].forEach(function (tilt) {
          ctx.beginPath(); ctx.moveTo(nose.x + side * faceW * 0.12, nose.y + faceW * 0.02); ctx.lineTo(nose.x + side * faceW * 0.42, nose.y + faceW * 0.02 + tilt * faceW * 0.4); ctx.stroke();
        }); });
      }
    }
  }

  /* The face model needs "eval", so it runs in its own page (face-frame.html) with no network access. We send it frames and get points back. */
  var helper = null;
  function faceHelper() {
    if (helper) return helper;
    helper = new Promise(function (res, rej) {
      var f = document.createElement('iframe'); f.src = ROOT + 'face-frame.html' + (VER ? '?v=' + VER : ''); f.title = 'Face filters helper'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;width:1px;height:1px;left:-9px;top:-9px;border:0;opacity:0;pointer-events:none';
      var pending = {}, n = 0, origin = location.origin, timer = setTimeout(function () { helper = null; f.remove(); rej(new Error('timeout')); }, 40000);
      window.addEventListener('message', function (ev) {
        if (ev.origin !== origin || ev.source !== f.contentWindow) return;
        var d = ev.data || {};
        if (d.type === 'loaded') f.contentWindow.postMessage({ type: 'init', v: VER }, origin);
        else if (d.type === 'failed') { clearTimeout(timer); helper = null; f.remove(); rej(new Error('failed')); }
        else if (d.type === 'ready') {
          clearTimeout(timer);
          res({ detect: function (video) {
            return new Promise(function (ok) {
              var id = ++n, t = setTimeout(function () { delete pending[id]; ok(null); }, 1500); pending[id] = function (pts) { clearTimeout(t); ok(pts); };
              createImageBitmap(video).then(function (bm) { f.contentWindow.postMessage({ type: 'frame', id: id, bitmap: bm }, origin, [bm]); }, function () { ok(null); });
            });
          } });
        } else if (d.type === 'points' && pending[d.id]) { var cb = pending[d.id]; delete pending[d.id]; cb(d.pts || null); }
      });
      document.body.appendChild(f);
    });
    return helper;
  }

  /* ---------- the processor LiveKit plugs into a camera track ---------- */
  function create(initial) {
    var st = { bg: 'none', filter: 'none', image: null };
    if (initial) { st.bg = initial.bg || 'none'; st.filter = initial.filter || 'none'; st.image = initial.image || null; }
    var fails = 0, video, canvas, ctx, scratch, out, timer, stopped = false, busy = false, seg = null, face = null, mask = null, lms = null, notice = null;

    function modelFor(kind) {
      if (kind === 'seg' && !seg) seg = loadScript('vendor/mediapipe/selfie_segmentation.js').then(function () {
        var m = new window.SelfieSegmentation({ locateFile: function (f) { return ROOT + 'vendor/mediapipe/' + f; } });
        m.setOptions({ modelSelection: 1, selfieMode: false }); m.onResults(function (r) { mask = r.segmentationMask; });
        return m.initialize ? m.initialize().then(function () { return m; }) : m;
      }).catch(function (e) { seg = null; st.bg = 'none'; notice = 'Backgrounds could not load on this device.'; throw e; });
      if (kind === 'face' && !face) face = faceHelper(); 
      return kind === 'seg' ? seg : face;
    }

    async function frame() {
      if (stopped || busy || !video || video.readyState < 2) return;
      busy = true;
      try {
        var w = canvas.width, h = canvas.height, wantBg = st.bg !== 'none', wantFace = st.filter !== 'none';
        if (wantBg) { var m1 = await modelFor('seg'); await m1.send({ image: video }); } else mask = null;
        if (wantFace) { try { var fh = await modelFor('face'); lms = await fh.detect(video); } catch (e) { lms = null; st.filter = 'none'; notice = 'Face filters could not load on this device.'; } } else lms = null;
        ctx.save(); ctx.clearRect(0, 0, w, h);
        if (wantBg && mask) {
          ctx.drawImage(mask, 0, 0, w, h); ctx.globalCompositeOperation = 'source-in'; ctx.drawImage(video, 0, 0, w, h);
          ctx.globalCompositeOperation = 'destination-over'; drawBackground(ctx, w, h, st.bg, video, scratch, st.image);
        } else ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();
        if (wantFace && lms) drawFilter(ctx, st.filter, lms, w, h);
      } catch (e) {
        try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch (e2) { /* the next frame tries again */ }
        if (++fails > 15) { st.bg = 'none'; st.filter = 'none'; notice = 'Effects stopped because this device could not keep up.'; fails = 0; }
      }
      busy = false;
    }
    function loop() { if (stopped) return; frame().then(function () { timer = setTimeout(loop, st.bg === 'none' && st.filter === 'none' ? 40 : 45); }); }

    async function setup(track) {
      var s = track.getSettings ? track.getSettings() : {};
      video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = new MediaStream([track]);
      await video.play().catch(function () { /* autoplay is allowed for muted video */ });
      canvas = document.createElement('canvas'); canvas.width = s.width || video.videoWidth || 640; canvas.height = s.height || video.videoHeight || 360;
      ctx = canvas.getContext('2d'); scratch = document.createElement('canvas');
      out = canvas.captureStream(24).getVideoTracks()[0]; proc.processedTrack = out;
      stopped = false; loop();
    }
    var proc = {
      name: 'family-circle-effects',
      processedTrack: undefined,
      init: function (opts) { return setup(opts.track); },
      restart: function (opts) { teardown(); return setup(opts.track); },
      destroy: function () { teardown(); return Promise.resolve(); },
      set: function (next) { Object.keys(next).forEach(function (k) { st[k] = next[k]; }); notice = null; },
      state: function () { return { bg: st.bg, filter: st.filter, notice: notice }; }
    };
    function teardown() { stopped = true; clearTimeout(timer); if (video) { video.pause(); video.srcObject = null; } if (out) out.stop(); video = null; }
    return proc;
  }

  /** Reads a picture the person chose (it stays on this device) and returns an <img> ready to draw. */
  function imageFromFile(file) {
    return new Promise(function (res, rej) {
      if (!file || !/^image\/(png|jpe?g|webp|gif)$/.test(file.type) || file.size > 8 * 1024 * 1024) return rej(new Error('Choose a PNG, JPG or WebP picture under 8 MB.'));
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res(img); }; img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That picture could not be read.')); }; img.src = url;
    });
  }

  window.FCEffects = { _drawFilter: drawFilter, create: create, BACKGROUNDS: BACKGROUNDS, FILTERS: FILTERS, imageFromFile: imageFromFile, supported: !!(window.HTMLCanvasElement && HTMLCanvasElement.prototype.captureStream) };
})();

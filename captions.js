/* Family Circle: automatic captions, made on the phone itself.
 *
 * The video's sound never leaves the device. The speech model (Whisper tiny, English) is downloaded once
 * from Hugging Face by the browser and kept in its cache; the drawing of the model runs from files that
 * live in this site's own vendor/transformers folder. The result is a short list of [start, end, text]
 * lines that the author saves with the post, so everyone else just reads it.
 *
 * Everything except `transcribe` is plain code that can be tested without the model.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Captions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_LINE = 42;          // characters on screen at once, so lines stay readable on a phone
  var MAX_CHARS = 15000;      // the server column holds 16000 characters including punctuation

  /** Saved text from the post row -> list of cues, or [] if there is none or it is damaged. */
  function parse(saved) {
    if (!saved) return [];
    try {
      var a = typeof saved === 'string' ? JSON.parse(saved) : saved;
      if (!Array.isArray(a)) return [];
      return a.filter(function (c) { return Array.isArray(c) && c.length === 3 && isFinite(c[0]) && isFinite(c[1]) && typeof c[2] === 'string'; })
        .map(function (c) { return [Number(c[0]), Number(c[1]), c[2]]; });
    } catch (e) { return []; }
  }

  function stamp(t) {
    var ms = Math.max(0, Math.round(t * 1000));
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
    function p(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + '.' + p(r, 3);
  }
  /** Cues -> WebVTT text, which is what a <track> element reads. */
  function toVtt(cues) {
    var out = ['WEBVTT', ''];
    cues.forEach(function (c, i) {
      var text = String(c[2]).replace(/[<>&]/g, ' ').replace(/-->/g, '- >');
      out.push(String(i + 1), stamp(c[0]) + ' --> ' + stamp(c[1]), text, '');
    });
    return out.join('\n');
  }

  /**
   * Whisper gives phrases that can be long. Cut each into pieces of at most MAX_LINE characters on word
   * boundaries and share the time between the pieces by how many characters each holds.
   */
  function shape(chunks, duration) {
    var cues = [];
    (chunks || []).forEach(function (ch) {
      var text = String(ch && ch.text || '').replace(/\s+/g, ' ').trim();
      if (!text || /^\[.*\]$|^\(.*\)$/.test(text)) return;      // "[BLANK_AUDIO]", "(music)"
      var ts = ch.timestamp || [0, null];
      var start = Number(ts[0]) || 0;
      var end = ts[1] == null ? Math.min(duration || start + 3, start + 4) : Number(ts[1]);
      if (duration) end = Math.min(end, duration);
      if (!(end > start)) end = start + 1;
      var words = text.split(' '), lines = [], cur = '';
      words.forEach(function (w) {
        if (cur && (cur + ' ' + w).length > MAX_LINE) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
      });
      if (cur) lines.push(cur);
      var total = lines.reduce(function (n, l) { return n + l.length; }, 0), at = start;
      lines.forEach(function (l) {
        var span = (end - start) * l.length / total;
        cues.push([at, at + span, l]); at += span;
      });
    });
    // times must go up, and never overlap
    for (var i = 0; i < cues.length; i++) {
      if (i && cues[i][0] < cues[i - 1][0]) cues[i][0] = cues[i - 1][0];
      if (i && cues[i - 1][1] > cues[i][0]) cues[i - 1][1] = cues[i][0];
      if (cues[i][1] <= cues[i][0]) cues[i][1] = cues[i][0] + 0.5;
    }
    return cues.map(function (c) { return [Math.round(c[0] * 10) / 10, Math.max(Math.round(c[1] * 10) / 10, Math.round(c[0] * 10) / 10 + 0.1), c[2]]; });
  }

  /** Drops the tail of a very long transcript so it fits in the saved column; reports whether it did. */
  function fit(cues) {
    var out = [], n = 2, cut = false;
    for (var i = 0; i < cues.length; i++) {
      var size = JSON.stringify(cues[i]).length + 1;
      if (n + size > MAX_CHARS || out.length >= 400) { cut = true; break; }
      out.push(cues[i]); n += size;
    }
    return { cues: out, cut: cut };
  }

  /** Video file -> mono 16 kHz samples, which is what Whisper reads. */
  async function decodeAudio(blob) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('This browser cannot read the sound of a video.');
    var buf = await blob.arrayBuffer();
    var ctx;
    try { ctx = new AC({ sampleRate: 16000 }); } catch (e) { ctx = new AC(); }
    try {
      var audio = await new Promise(function (ok, no) { var p = ctx.decodeAudioData(buf, ok, no); if (p && p.catch) p.catch(no); });
      var ch = audio.numberOfChannels, len = audio.length, mono = new Float32Array(len);
      for (var c = 0; c < ch; c++) { var d = audio.getChannelData(c); for (var i = 0; i < len; i++) mono[i] += d[i] / ch; }
      if (audio.sampleRate === 16000) return { samples: mono, seconds: len / 16000 };
      // the browser would not give 16 kHz: resample with an offline context
      var off = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
      var src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
      var done = await off.startRendering();
      return { samples: done.getChannelData(0).slice(), seconds: done.duration };
    } catch (e) {
      var err = new Error('This video has no sound that the browser can read, so it cannot be captioned.'); err.cause = e; throw err;
    } finally { if (ctx.close) ctx.close().catch(function () {}); }
  }

  var pipe = null;
  /**
   * Makes captions for a video file or blob. `opts.onStatus(text, percent|null)` reports progress.
   * `opts.engine` can replace the model in tests: async (samples, seconds) => whisper-style chunks.
   */
  async function transcribe(blob, opts) {
    opts = opts || {};
    var say = opts.onStatus || function () {};
    say('Reading the sound…', null);
    var a = await decodeAudio(blob);
    if (a.seconds < 0.5) throw new Error('This video is too short to caption.');
    var chunks;
    if (opts.engine) chunks = await opts.engine(a.samples, a.seconds);
    else {
      if (!pipe) {
        say('Loading the speech model (first time only)…', 0);
        var base = new URL('vendor/transformers/', document.baseURI).href;
        var lib = await import(base + 'transformers.min.js');
        lib.env.allowLocalModels = false;
        lib.env.useBrowserCache = true;
        var wasm = lib.env.backends.onnx.wasm;
        wasm.wasmPaths = { mjs: base + 'ort-wasm-simd-threaded.jsep.mjs', wasm: base + 'ort-wasm-simd-threaded.jsep.wasm' };
        wasm.numThreads = 1; wasm.proxy = false;
        var model = (window.FAMILY_CONFIG && window.FAMILY_CONFIG.captionModel) || 'Xenova/whisper-tiny.en';
        pipe = await lib.pipeline('automatic-speech-recognition', model, {
          progress_callback: function (p) {
            if (p && p.status === 'progress' && typeof p.progress === 'number') say('Downloading the speech model (first time only)…', Math.round(p.progress));
          }
        }).catch(function (e) { pipe = null; throw e; });
      }
      say('Listening to the video… this can take a minute on a phone.', null);
      var r = await pipe(a.samples, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
      chunks = r && r.chunks ? r.chunks : (r && r.text ? [{ text: r.text, timestamp: [0, a.seconds] }] : []);
    }
    var cues = shape(chunks, a.seconds);
    if (!cues.length) throw new Error('No speech was found in this video.');
    return fit(cues);
  }

  return { parse: parse, toVtt: toVtt, shape: shape, fit: fit, transcribe: transcribe, decodeAudio: decodeAudio };
});

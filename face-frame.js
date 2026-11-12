/* Face tracking helper page. The parent sends video frames (ImageBitmap); this page replies with 468 face points per frame. */
(function () {
  'use strict';
  var fm = null, ready = null, last = null;
  function post(m, transfer) { try { parent.postMessage(m, location.origin, transfer || []); } catch (e) { /* parent gone */ } }
  function start(v) {
    if (ready) return ready;
    return (ready = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'vendor/mediapipe/face/face_mesh.js' + (v ? '?v=' + encodeURIComponent(v) : '');
      s.onload = res; s.onerror = function () { rej(new Error('script')); }; document.head.appendChild(s);
    }).then(function () {
      fm = new window.FaceMesh({ locateFile: function (f) { return 'vendor/mediapipe/face/' + f; } });
      fm.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5, selfieMode: false });
      fm.onResults(function (r) { last = r.multiFaceLandmarks && r.multiFaceLandmarks[0] || null; });
      return fm.initialize();
    }));
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || ev.source !== parent) return;
    var d = ev.data || {};
    if (d.type === 'init') start(d.v).then(function () { post({ type: 'ready' }); }, function () { post({ type: 'failed' }); });
    else if (d.type === 'frame' && fm) {
      last = null;
      fm.send({ image: d.bitmap }).then(function () {
        try { d.bitmap.close(); } catch (e) { /* ok */ }
        var pts = null;
        if (last) { pts = new Float32Array(last.length * 2); for (var i = 0; i < last.length; i++) { pts[i * 2] = last[i].x; pts[i * 2 + 1] = last[i].y; } }
        post({ type: 'points', id: d.id, pts: pts }, pts ? [pts.buffer] : []);
      }, function () { post({ type: 'points', id: d.id, pts: null }); });
    }
  });
  post({ type: 'loaded' });
})();

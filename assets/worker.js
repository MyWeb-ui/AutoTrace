/* Web Worker: menjalankan engine di perangkat (cadangan bila server tidak terjangkau). */
importScripts('../lib/engine.js');
self.onmessage = function (e) {
  var m = e.data;
  try {
    var res = self.AutoTrace.trace({ width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) }, m.opts, function (name, frac) { self.postMessage({ type: 'progress', name: name, frac: frac }); });
    self.postMessage({ type: 'done', result: res });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};

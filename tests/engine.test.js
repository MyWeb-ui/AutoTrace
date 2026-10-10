/* Uji engine + PNG + konversi XML. Jalankan: node tests/engine.test.js */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const E = require('../lib/engine.js'), { decodePNG, encodePNG } = require('../lib/png.js'), A = require('../src/svg2am.js');

function img(w, h, fn) { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fn(x, y) || [0, 0, 0, 0]; d.set([c[0], c[1], c[2], c[3] === undefined ? 255 : c[3]], (y * w + x) * 4); } return { width: w, height: h, data: d }; }

// 1. PNG round-trip
{ const a = img(7, 5, (x, y) => [x * 30, y * 40, 99, x === 3 ? 0 : 255]); const b = decodePNG(encodePNG(7, 5, a.data)); assert.deepStrictEqual(Array.from(b.data), Array.from(a.data)); }

// 2. dua kotak bersebelahan: 2 shape, saling tumpang-tindih (tidak ada celah)
{ const r = E.trace(img(60, 40, (x, y) => (x > 5 && x < 55 && y > 5 && y < 35) ? (x < 30 ? [220, 30, 30] : [30, 60, 220]) : null), { colors: 4 });
  assert.strictEqual(r.shapes.length, 2, 'dua kotak = 2 shape'); assert.strictEqual(r.stats.holes, 0); }

// 3. cincin dengan lubang transparan: 1 shape + 1 lubang (subpath kedua, arah berlawanan)
{ const r = E.trace(img(100, 100, (x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 40 && d > 18 ? [200, 20, 20] : null; }), { colors: 4 });
  assert.strictEqual(r.shapes.length, 1); assert.strictEqual(r.stats.holes, 1); assert.strictEqual((r.shapes[0].d.match(/M/g) || []).length, 2, 'outer + hole');
  const off = E.trace(img(100, 100, (x, y) => { const d = Math.hypot(x - 50, y - 50); return d < 40 && d > 18 ? [200, 20, 20] : null; }), { colors: 4, holes: false });
  assert.strictEqual((off.shapes[0].d.match(/M/g) || []).length, 1, 'holes:false = isi penuh'); }

// 4. latar transparan tidak menghasilkan shape; area di dalam objek yang berwarna lain tetap ada (tumpukan)
{ const r = E.trace(img(80, 80, (x, y) => (x > 10 && x < 70 && y > 10 && y < 70) ? ((x > 30 && x < 50 && y > 30 && y < 50) ? [255, 255, 255] : [20, 20, 20]) : null), { colors: 4 });
  assert.strictEqual(r.shapes.length, 2); assert.strictEqual(r.shapes[0].fill, '#141414', 'terbesar di bawah'); assert.strictEqual(r.shapes[1].fill, '#ffffff'); }

// 5. bercak kecil dibuang, maxShapes dihormati
{ const r = E.trace(img(120, 120, (x, y) => ((x * 7 + y * 13) % 29 === 0 && x % 3 === 0) ? [0, 0, 0] : [255, 255, 255]), { colors: 2, minArea: 6 }); assert(r.shapes.length <= 3, 'noise dibuang: ' + r.shapes.length);
  const g = img(200, 200, (x, y) => [(Math.floor(x / 10) * 53) % 256, (Math.floor(y / 10) * 97) % 256, ((Math.floor(x / 10) + Math.floor(y / 10)) * 31) % 256]);
  const m = E.trace(g, { colors: 32, maxShapes: 40, merge: 0, minThickness: 0 }); assert(m.shapes.length <= 40, 'maxShapes: ' + m.shapes.length); }

// 6. B&W: hanya tinta; kunci path hanya M C Z (kompatibel svg2am)
{ const r = E.trace(img(60, 60, (x, y) => (x > 10 && x < 50 && y > 10 && y < 50) ? [10, 10, 10] : [250, 250, 250]), { mode: 'bw' });
  assert.strictEqual(r.shapes.length, 1); assert.strictEqual(r.shapes[0].fill, '#000000'); assert(/^[MCZ0-9 .\-e]+$/.test(r.shapes[0].d)); }

// 7. integrasi: hasil engine -> XML Alight valid & parsable ulang
{ const r = E.trace(decodePNG(fs.readFileSync(path.join(__dirname, 'img/ring.png'))), {});
  const xml = A.buildScene({ title: 't', width: 800, height: 800, scale: 2, bg: '#ffd8d8d8', shapes: r.shapes.map((s, i) => ({ fill: s.fill, d: s.d, label: 'Trace ' + (i + 1) })) });
  assert(xml.startsWith('<?xml') && xml.includes('<scene ') && (xml.match(/<shape /g) || []).length === r.shapes.length);
  const ds = [...xml.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  ds.forEach(d => assert.strictEqual(A.toAmPath(d), d, 'path XML stabil setelah parse -> tulis ulang')); }

console.log('OK: engine + png + xml');

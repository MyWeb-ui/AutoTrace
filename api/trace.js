/* POST /api/trace?o=<json opsi>   body: PNG (hasil canvas.toBlob) -> JSON {width,height,shapes:[{fill,d}],stats}
   GET  /api/trace                 -> {ok:true} (cek kesehatan; dipakai UI untuk memilih server/lokal) */
'use strict';
const { trace } = require('../lib/engine.js');
const { decodePNG } = require('../lib/png.js');

const MAX_BYTES = 4.4 * 1024 * 1024;   // batas body fungsi Vercel ≈ 4.5 MB
const NUM = { colors: [2, 40], minArea: [0, 2000], minThickness: [0, 8], smooth: [0.3, 6], fitError: [0.2, 3], maxShapes: [1, 600], bleed: [0, 2], denoise: [0, 2], cornerAngle: [20, 120], merge: [0, 30], alphaCut: [1, 255] };

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BYTES) { reject(Object.assign(new Error('Gambar terlalu besar untuk dikirim (maks ±4 MB). Kecilkan dulu.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function cleanOpts(raw) {
  const o = {};
  if (raw.mode === 'bw' || raw.mode === 'color') o.mode = raw.mode;
  for (const k of Object.keys(NUM)) if (raw[k] !== undefined && isFinite(+raw[k])) o[k] = Math.min(NUM[k][1], Math.max(NUM[k][0], +raw[k]));
  if (typeof raw.holes === 'boolean') o.holes = raw.holes;
  if (['dark', 'light', 'both'].includes(raw.bwFill)) o.bwFill = raw.bwFill;
  if (raw.bwThreshold === 'auto' || (isFinite(+raw.bwThreshold) && raw.bwThreshold !== null)) o.bwThreshold = raw.bwThreshold === 'auto' ? 'auto' : Math.min(255, Math.max(0, +raw.bwThreshold));
  if (typeof raw.ink === 'string' && /^#[0-9a-f]{6}$/i.test(raw.ink)) o.ink = raw.ink;
  return o;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, { ok: true, engine: 'autotrace-js', limits: { bytes: Math.floor(MAX_BYTES), pixels: 2600000 } });
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'Metode tidak didukung.' }); }
    const url = new URL(req.url, 'http://x');
    let opts = {};
    try { opts = cleanOpts(JSON.parse(url.searchParams.get('o') || '{}')); } catch (_) { return send(res, 400, { error: 'Parameter opsi tidak valid.' }); }
    const buf = await readBody(req);
    if (!buf.length) return send(res, 400, { error: 'Body kosong: kirim file PNG.' });
    if (buf.length > MAX_BYTES) return send(res, 413, { error: 'Gambar terlalu besar untuk dikirim (maks ±4 MB). Kecilkan dulu.' });
    let img;
    try { img = decodePNG(buf); } catch (e) { return send(res, 415, { error: 'PNG tidak bisa dibaca: ' + e.message }); }
    const out = trace(img, opts);
    return send(res, 200, { width: out.width, height: out.height, shapes: out.shapes.map(s => ({ fill: s.fill, d: s.d })), stats: out.stats });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || 'Gagal memproses.' });
  }
};

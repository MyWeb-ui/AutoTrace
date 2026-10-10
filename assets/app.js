/* Auto Trace — antarmuka. Alur: foto → hapus background → trace (server / lokal) → SVG & XML Alight. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var E = window.AutoTrace, A = window.Svg2Am;
  var MAXW = 1200, GHOST = 38, MAX_UPLOAD = 4.2e6;

  var PRESETS = {
    anime: { colors: 14, minArea: 16, minThickness: 1.5, smooth: 1.8, maxShapes: 160, denoise: 1 },
    logo: { colors: 6, minArea: 10, minThickness: 0.8, smooth: 1.2, maxShapes: 80, denoise: 0 },
    photo: { colors: 20, minArea: 30, minThickness: 1.5, smooth: 2.2, maxShapes: 300, denoise: 2 },
    bw: { colors: 2, minArea: 12, minThickness: 1.0, smooth: 1.6, maxShapes: 120, denoise: 1 }
  };
  var SAVE_IDS = ['preset', 'colors', 'minArea', 'minThickness', 'smooth', 'maxShapes', 'holes', 'engine', 'sceneSize', 'sceneBg', 'tol', 'shrink', 'edgeOnly', 'bwFill', 'ink'];

  var S = { name: '', W: 0, H: 0, src: null, lab: null, hasAlpha: false, seeds: [], manual: null, keep: null, disp: null, hist: [], tool: 'pick', denoise: 1, result: null, svg: '', xml: '', busy: false, thumbUrl: '' };
  var ctx = $('cv').getContext('2d', { willReadFrequently: true });

  /* ---------- umpan balik ---------- */
  var toastTimer = 0;
  function toast(msg, kind) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function setStatus(msg, kind) { var s = $('status'); s.textContent = msg; s.className = 'status ' + (kind || ''); }
  function setProgress(f) { var p = $('progress'); if (f == null) { p.hidden = true; return; } p.hidden = false; $('bar').style.width = Math.round(f * 100) + '%'; }
  function fmtBytes(n) { return n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB'; }
  function safeName(n) { return (n || 'trace').replace(/[^\w\-]+/g, '_').slice(0, 48) || 'trace'; }

  /* ---------- pengaturan ---------- */
  function bindRanges() {
    document.querySelectorAll('input[type=range]').forEach(function (r) {
      var o = $('o-' + r.id); if (!o) return;
      var upd = function () { o.textContent = r.value; }; r.addEventListener('input', upd); upd();
    });
  }
  function applyPreset(name) {
    var p = PRESETS[name]; if (!p) return;
    ['colors', 'minArea', 'minThickness', 'smooth', 'maxShapes'].forEach(function (k) { $(k).value = p[k]; $(k).dispatchEvent(new Event('input')); });
    S.denoise = p.denoise;
    updateModeUI();
  }
  function updateModeUI() { var bw = $('preset').value === 'bw'; $('bwOnly').hidden = !bw; $('colorOnly').hidden = bw; }
  function markCustom() { var s = $('preset'); s.querySelector('[value=custom]').hidden = false; s.value = 'custom'; updateModeUI(); }
  function collectOpts() {
    var bw = $('preset').value === 'bw';
    return { mode: bw ? 'bw' : 'color', colors: +$('colors').value, minArea: +$('minArea').value, minThickness: +$('minThickness').value, smooth: +$('smooth').value, maxShapes: +$('maxShapes').value, holes: $('holes').checked, denoise: S.denoise, bwFill: $('bwFill').value, bwThreshold: $('bwAuto').checked ? 'auto' : +$('bwThr').value, ink: $('ink').value };
  }
  function saveSettings() { try { var o = {}; SAVE_IDS.forEach(function (id) { var e = $(id); o[id] = e.type === 'checkbox' ? e.checked : e.value; }); o._d = S.denoise; localStorage.setItem('autotrace.v2', JSON.stringify(o)); } catch (_) { } }
  function loadSettings() {
    try {
      var o = JSON.parse(localStorage.getItem('autotrace.v2') || 'null'); if (!o) return false;
      SAVE_IDS.forEach(function (id) { var e = $(id); if (o[id] === undefined) return; if (e.type === 'checkbox') e.checked = !!o[id]; else e.value = o[id]; if (id === 'preset' && o[id] === 'custom') e.querySelector('[value=custom]').hidden = false; });
      if (typeof o._d === 'number') S.denoise = o._d; return true;
    } catch (_) { return false; }
  }

  /* ---------- muat foto ---------- */
  function readBitmap(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { URL.revokeObjectURL(u); res(im); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('Foto gagal dibaca')); }; im.src = u; });
  }
  function loadFile(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) { toast('Format harus PNG, JPG, atau WEBP.', 'err'); return; }
    if (file.size > 30e6) { toast('File terlalu besar (maks 30 MB).', 'err'); return; }
    setStatus('Membaca foto…');
    readBitmap(file).then(function (bmp) {
      var bw = bmp.width || bmp.naturalWidth, bh = bmp.height || bmp.naturalHeight, k = Math.min(1, MAXW / Math.max(bw, bh));
      var W = Math.max(1, Math.round(bw * k)), H = Math.max(1, Math.round(bh * k)), c = document.createElement('canvas'); c.width = W; c.height = H;
      var x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, W, H);
      S.W = W; S.H = H; S.src = x.getImageData(0, 0, W, H); S.name = file.name.replace(/\.[^.]+$/, '') || 'trace';
      var d = S.src.data, N = W * H; S.hasAlpha = false; for (var p = 3; p < d.length; p += 4) if (d[p] < 250) { S.hasAlpha = true; break; }
      S.lab = E.util.toLab(d, N, 1); S.manual = new Uint8Array(N); S.hist = []; S.seeds = []; S.result = null; S.disp = new ImageData(new Uint8ClampedArray(d), W, H);
      $('cv').width = W; $('cv').height = H;
      // umpan balik: thumbnail + nama + ukuran
      if (S.thumbUrl) URL.revokeObjectURL(S.thumbUrl); S.thumbUrl = URL.createObjectURL(file);
      $('thumb').innerHTML = ''; var im = new Image(); im.alt = ''; im.src = S.thumbUrl; $('thumb').appendChild(im);
      $('fname').textContent = file.name; $('fmeta').textContent = bw + '×' + bh + ' px · ' + fmtBytes(file.size) + (k < 1 ? ' → ' + W + '×' + H : '');
      $('fileRow').classList.add('loaded'); $('change').textContent = 'Ganti foto';
      $('drop').hidden = true; $('editor').hidden = false; $('alphaRow').hidden = !S.hasAlpha; $('useAlpha').checked = true;
      $('go').disabled = false; $('dsvg').disabled = $('dxml').disabled = true; $('tab-result').disabled = true; showTab('photo');
      // deteksi latar otomatis bila tepi foto seragam
      var det = detectBorder(), auto = false;
      if (!S.hasAlpha && det.top >= 0.65) { S.seeds = det.seeds.slice(0, 1); auto = true; }
      $('bgOn').checked = auto; renderSeeds(); applyMask();
      setStatus(auto ? 'Foto dimuat. Latar seragam terdeteksi dan dihapus — cek pratinjau.' : S.hasAlpha ? 'Foto PNG transparan dimuat.' : 'Foto dimuat. Latar tidak seragam: ketuk warna latar, atau pakai kuas.', 'ok');
      toast('Foto dimuat: ' + file.name, 'ok');
      $('cwrap').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }).catch(function (e) { setStatus(e.message || 'Foto gagal dibaca.', 'err'); toast('Foto gagal dibaca.', 'err'); });
  }

  /* ---------- warna latar ---------- */
  function detectBorder() {
    var W = S.W, H = S.H, L = S.lab.L, A2 = S.lab.A, B = S.lab.B, cells = new Map(), total = 0;
    function add(p) { var key = Math.floor(L[p] / 8) * 10000 + Math.floor((A2[p] + 128) / 8) * 100 + Math.floor((B[p] + 128) / 8), c = cells.get(key); if (!c) { c = { n: 0, l: 0, a: 0, b: 0, p: p }; cells.set(key, c); } c.n++; c.l += L[p]; c.a += A2[p]; c.b += B[p]; total++; }
    var x, y; for (x = 0; x < W; x++) { add(x); add((H - 1) * W + x); } for (y = 1; y < H - 1; y++) { add(y * W); add(y * W + W - 1); }
    var arr = []; cells.forEach(function (c) { arr.push(c); }); arr.sort(function (a, b) { return b.n - a.n; });
    var seeds = [], share = 0;
    for (var i = 0; i < arr.length && seeds.length < 3; i++) {
      var c = arr[i], l = c.l / c.n, a = c.a / c.n, b = c.b / c.n; if (i > 0 && c.n / total < 0.1) break;
      if (seeds.some(function (s) { return Math.hypot(s.L - l, s.a - a, s.b - b) < 14; })) { share += c.n / total; continue; }
      var q = c.p * 4, d = S.src.data; seeds.push({ L: l, a: a, b: b, hex: E.util.hex([d[q], d[q + 1], d[q + 2]]) }); share += c.n / total;
    }
    // seberapa dominan warna pertama di tepi (dalam toleransi bawaan)? dipakai untuk memutuskan hapus-otomatis
    var top = 0;
    if (seeds.length) {
      var s0 = seeds[0], within = function (p) { return Math.hypot(L[p] - s0.L, A2[p] - s0.a, B[p] - s0.b) <= 22; }, n0 = 0;
      for (x = 0; x < W; x++) { if (within(x)) n0++; if (within((H - 1) * W + x)) n0++; } for (y = 1; y < H - 1; y++) { if (within(y * W)) n0++; if (within(y * W + W - 1)) n0++; }
      top = n0 / total;
    }
    return { seeds: seeds, share: share, top: top };
  }
  function renderSeeds() {
    var box = $('seeds'); box.innerHTML = '';
    S.seeds.forEach(function (s, i) {
      var el = document.createElement('span'); el.className = 'seed';
      var sw = document.createElement('i'); sw.style.background = s.hex; var tx = document.createElement('span'); tx.textContent = s.hex;
      var bt = document.createElement('button'); bt.type = 'button'; bt.textContent = '×'; bt.setAttribute('aria-label', 'Lepas warna ' + s.hex);
      bt.onclick = function () { S.seeds.splice(i, 1); renderSeeds(); applyMask(); };
      el.appendChild(sw); el.appendChild(tx); el.appendChild(bt); box.appendChild(el);
    });
  }

  /* ---------- mask ---------- */
  function computeKeep() {
    var W = S.W, H = S.H, N = W * H, d = S.src.data, keep = new Uint8Array(N).fill(1), p, x, y;
    if (S.hasAlpha && $('useAlpha').checked) for (p = 0; p < N; p++) if (d[p * 4 + 3] < 128) keep[p] = 0;
    if ($('bgOn').checked && S.seeds.length) {
      var t = +$('tol').value, t2 = t * t, L = S.lab.L, A2 = S.lab.A, B = S.lab.B, valid = S.lab.valid, match = new Uint8Array(N), sd = S.seeds;
      for (p = 0; p < N; p++) {
        if (!valid[p]) continue;
        for (var i = 0; i < sd.length; i++) { var dl = L[p] - sd[i].L, da = A2[p] - sd[i].a, db = B[p] - sd[i].b; if (dl * dl + da * da + db * db <= t2) { match[p] = 1; break; } }
      }
      var removed = match;
      if ($('edgeOnly').checked) {
        removed = new Uint8Array(N); var st = new Int32Array(N), sp = 0;
        var push = function (q) { if (match[q] && !removed[q]) { removed[q] = 1; st[sp++] = q; } };
        for (x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
        while (sp) { var q = st[--sp], qx = q % W; if (qx > 0) push(q - 1); if (qx < W - 1) push(q + 1); if (q >= W) push(q - W); if (q < N - W) push(q + W); }
      }
      for (p = 0; p < N; p++) if (removed[p]) keep[p] = 0;
    }
    var shrink = +$('shrink').value;
    for (var it = 0; it < shrink; it++) {
      var mark = [];
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { p = y * W + x; if (!keep[p]) continue; if ((x > 0 && !keep[p - 1]) || (x < W - 1 && !keep[p + 1]) || (y > 0 && !keep[p - W]) || (y < H - 1 && !keep[p + W])) mark.push(p); }
      for (var m = 0; m < mark.length; m++) keep[mark[m]] = 0;
    }
    var mn = S.manual; for (p = 0; p < N; p++) { if (mn[p] === 1) keep[p] = 0; else if (mn[p] === 2) keep[p] = 1; }
    S.keep = keep;
  }
  function refreshDisplay() {
    var d = S.disp.data, s = S.src.data, k = S.keep, N = S.W * S.H;
    for (var p = 0; p < N; p++) d[p * 4 + 3] = k[p] ? 255 : (s[p * 4 + 3] < 128 ? 0 : GHOST);
    ctx.putImageData(S.disp, 0, 0);
  }
  var raf = 0;
  function applyMask() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; if (!S.src) return; computeKeep(); refreshDisplay(); }); }
  function maskedImageData() {
    var N = S.W * S.H, out = new Uint8ClampedArray(S.src.data), k = S.keep; for (var p = 0; p < N; p++) out[p * 4 + 3] = k[p] ? 255 : 0;
    return new ImageData(out, S.W, S.H);
  }

  /* ---------- alat ---------- */
  var HINTS = { pick: 'Ketuk warna latar di foto. Bisa berkali-kali untuk latar yang banyak warnanya.', erase: 'Seret di atas bagian yang ingin dihapus.', restore: 'Seret di atas bagian yang ingin dikembalikan.' };
  function setTool(t) {
    S.tool = t;
    document.querySelectorAll('.tool[data-tool]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false'); });
    var brush = t !== 'pick'; $('brushFld').hidden = !brush; $('toolHint').textContent = HINTS[t];
    $('cwrap').classList.toggle('brush', brush); $('cwrap').classList.toggle('pick', !brush); if (!brush) $('ring').hidden = true;
  }
  function canvasPos(e) { var r = $('cv').getBoundingClientRect(); return [(e.clientX - r.left) * S.W / r.width, (e.clientY - r.top) * S.H / r.height, r]; }
  function pushHist() { S.hist.push(S.manual.slice()); if (S.hist.length > 12) S.hist.shift(); $('undo').disabled = false; }
  function stamp(cx, cy, rad, erase) {
    var W = S.W, H = S.H, x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(W - 1, Math.ceil(cx + rad)), y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(H - 1, Math.ceil(cy + rad)), r2 = rad * rad, d = S.disp.data, s = S.src.data;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var dx = x - cx, dy = y - cy; if (dx * dx + dy * dy > r2) continue; var p = y * W + x;
      S.manual[p] = erase ? 1 : 2; S.keep[p] = erase ? 0 : 1; d[p * 4 + 3] = erase ? (s[p * 4 + 3] < 128 ? 0 : GHOST) : 255;
    }
  }
  function bindCanvas() {
    var cv = $('cv'), drawing = false, last = null;
    cv.addEventListener('click', function (e) {
      if (S.tool !== 'pick' || !S.src) return;
      var q = canvasPos(e), x = Math.max(0, Math.min(S.W - 1, Math.floor(q[0]))), y = Math.max(0, Math.min(S.H - 1, Math.floor(q[1]))), p = y * S.W + x, d = S.src.data;
      if (S.hasAlpha && d[p * 4 + 3] < 128) { toast('Bagian itu sudah transparan.'); return; }
      var t = [0, 0, 0]; E.util.rgbToLab(d[p * 4], d[p * 4 + 1], d[p * 4 + 2], t);
      if (S.seeds.some(function (s) { return Math.hypot(s.L - t[0], s.a - t[1], s.b - t[2]) < 5; })) { toast('Warna itu sudah dipilih.'); return; }
      S.seeds.push({ L: t[0], a: t[1], b: t[2], hex: E.util.hex([d[p * 4], d[p * 4 + 1], d[p * 4 + 2]]) }); $('bgOn').checked = true; renderSeeds(); applyMask(); setStatus('Warna latar ditambahkan. Ketuk lagi untuk menambah, atau atur Toleransi.');
    });
    function radiusImg(q) { return ($('brush').value / 2) * (S.W / q[2].width); }
    function ring(e) { if (S.tool === 'pick') return; var r = $('cwrap').getBoundingClientRect(), s = +$('brush').value, g = $('ring'); g.hidden = false; g.style.width = g.style.height = s + 'px'; g.style.left = (e.clientX - r.left) + 'px'; g.style.top = (e.clientY - r.top) + 'px'; }
    cv.addEventListener('pointerdown', function (e) {
      if (S.tool === 'pick' || !S.src) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); drawing = true; pushHist();
      var q = canvasPos(e); stamp(q[0], q[1], radiusImg(q), S.tool === 'erase'); last = q; ctx.putImageData(S.disp, 0, 0); ring(e);
    });
    cv.addEventListener('pointermove', function (e) {
      ring(e); if (!drawing) return; var q = canvasPos(e), rad = radiusImg(q), dist = Math.hypot(q[0] - last[0], q[1] - last[1]), n = Math.max(1, Math.ceil(dist / Math.max(1, rad / 2)));
      for (var i = 1; i <= n; i++) stamp(last[0] + (q[0] - last[0]) * i / n, last[1] + (q[1] - last[1]) * i / n, rad, S.tool === 'erase'); last = q; ctx.putImageData(S.disp, 0, 0);
    });
    var end = function () { drawing = false; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end); cv.addEventListener('pointerleave', function () { $('ring').hidden = true; });
    document.querySelectorAll('.tool[data-tool]').forEach(function (b) { b.onclick = function () { setTool(b.dataset.tool); }; });
    $('undo').onclick = function () { if (!S.hist.length) return; S.manual = S.hist.pop(); $('undo').disabled = !S.hist.length; applyMask(); };
    $('resetMask').onclick = function () { if (!S.src) return; pushHist(); S.manual.fill(0); applyMask(); toast('Edit manual direset.'); };
  }

  /* ---------- tab ---------- */
  function showTab(name) {
    var photo = name === 'photo'; $('panel-photo').hidden = !photo; $('panel-result').hidden = photo;
    $('tab-photo').setAttribute('aria-selected', photo); $('tab-result').setAttribute('aria-selected', !photo);
  }

  /* ---------- trace ---------- */
  function fallbackErr(msg) { var e = new Error(msg); e.fallback = true; return e; }
  function viaServer(opts) {
    var c = document.createElement('canvas'); c.width = S.W; c.height = S.H; c.getContext('2d').putImageData(maskedImageData(), 0, 0);
    return new Promise(function (r) { c.toBlob(r, 'image/png'); }).then(function (blob) {
      if (!blob) throw fallbackErr('Gagal menyiapkan gambar.');
      if (blob.size > MAX_UPLOAD) throw fallbackErr('Gambar terlalu besar untuk server (' + fmtBytes(blob.size) + ').');
      setStatus('Mengirim ke server…'); setProgress(0.2);
      var init = { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob }; if (window.AbortSignal && AbortSignal.timeout) init.signal = AbortSignal.timeout(70000);
      return fetch('/api/trace?o=' + encodeURIComponent(JSON.stringify(opts)), init).catch(function () { throw fallbackErr('Server tidak terjangkau.'); });
    }).then(function (r) {
      setStatus('Memproses di server…'); setProgress(0.55);
      return r.text().then(function (t) {
        var j; try { j = JSON.parse(t); } catch (_) { throw fallbackErr('Balasan server tidak valid (HTTP ' + r.status + ').'); }
        if (!r.ok) { var e = new Error(j.error || 'HTTP ' + r.status); e.fallback = r.status >= 500 || r.status === 404 || r.status === 405; throw e; }
        return j;
      });
    });
  }
  function viaLocal(opts) {
    var md = maskedImageData();
    return new Promise(function (resolve, reject) {
      var mainThread = function () { setTimeout(function () { try { resolve(E.trace({ width: S.W, height: S.H, data: md.data }, opts, function (n, f) { setProgress(0.1 + f * 0.8); })); } catch (e) { reject(e); } }, 30); };
      var w; try { w = new Worker('assets/worker.js'); } catch (_) { return mainThread(); }
      w.onmessage = function (m) { var d = m.data; if (d.type === 'progress') setProgress(0.1 + d.frac * 0.8); else if (d.type === 'done') { w.terminate(); resolve(d.result); } else { w.terminate(); reject(new Error(d.message)); } };
      w.onerror = function () { w.terminate(); mainThread(); };
      var copy = new Uint8ClampedArray(md.data); w.postMessage({ width: S.W, height: S.H, buffer: copy.buffer, opts: opts }, [copy.buffer]);
    });
  }
  function runTrace() {
    if (!S.src || S.busy) return;
    var kept = 0; for (var p = 0; p < S.keep.length; p++) kept += S.keep[p]; if (kept < 200) { setStatus('Semua area terhapus. Kurangi toleransi atau pulihkan sebagian foto.', 'err'); return; }
    S.busy = true; $('go').disabled = true; $('go').textContent = 'Memproses…'; setProgress(0.08); setStatus('Menyiapkan…');
    var opts = collectOpts(), mode = $('engine').value, t0 = Date.now(), via = 'lokal';
    var work = mode === 'local' ? viaLocal(opts) : viaServer(opts).then(function (r) { via = 'server'; return r; }).catch(function (e) {
      if (mode === 'server' || !e.fallback) throw e;
      toast(e.message + ' Memakai mesin lokal.'); via = 'lokal'; setStatus('Memproses di perangkat…'); return viaLocal(opts);
    });
    work.then(function (res) { finish(res, via, Date.now() - t0); }).catch(function (e) { setStatus('Gagal: ' + (e.message || e), 'err'); toast('Trace gagal.', 'err'); }).then(function () { S.busy = false; $('go').disabled = false; $('go').textContent = 'Trace ulang'; setProgress(null); });
  }
  function finish(res, via, ms) {
    if (!res.shapes || !res.shapes.length) { setStatus('Tidak ada shape yang dihasilkan. Periksa background / ambang.', 'err'); return; }
    S.result = res; S.svg = E.toSVG(res); S.via = via; S.ms = ms; buildXml();
    $('cmp').style.aspectRatio = res.width + ' / ' + res.height; $('cmpSvg').innerHTML = S.svg;
    var oc = $('cmpOrig'); oc.width = res.width; oc.height = res.height; oc.getContext('2d').putImageData(maskedImageData(), 0, 0);
    $('cmpRange').value = 50; setCmp(50); renderStats();
    var w = $('warn'); if (res.shapes.length > 250) { w.hidden = false; w.textContent = res.shapes.length + ' layer — Alight bisa berat. Turunkan "Maksimum layer" atau "Jumlah warna".'; } else w.hidden = true;
    $('dsvg').disabled = $('dxml').disabled = false; $('tab-result').disabled = false; showTab('result');
    setStatus('Selesai: ' + res.shapes.length + ' shape (' + via + '). Unduh SVG atau XML Alight.', 'ok');
    $('panel-result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function sceneDims() { var res = S.result, size = Math.max(200, Math.min(4000, +$('sceneSize').value || 1440)), sc = size / Math.max(res.width, res.height); return { sc: sc, w: Math.round(res.width * sc), h: Math.round(res.height * sc) }; }
  function buildXml() {
    var res = S.result, d = sceneDims(), bg = $('sceneBg').value;
    S.xml = A.buildScene({ title: S.name, width: d.w, height: d.h, scale: d.sc, bg: '#ff' + bg.slice(1), shapes: res.shapes.map(function (s, i) { return { fill: s.fill, d: s.d, label: 'Trace ' + (i + 1) }; }) });
  }
  function renderStats() {
    var res = S.result, st = res.stats || {}, d = sceneDims(); $('stats').innerHTML = '';
    [['shape', res.shapes.length], ['titik', st.points || '–'], ['lubang', st.holes || 0], ['mesin', S.via], ['waktu', (S.ms / 1000).toFixed(1) + ' dtk'], ['scene', d.w + '×' + d.h]].forEach(function (a) { var el = document.createElement('span'); el.innerHTML = a[0] + ' <b></b>'; el.querySelector('b').textContent = a[1]; $('stats').appendChild(el); });
  }
  function setCmp(v) { $('cmpOrig').style.clipPath = 'inset(0 ' + (100 - v) + '% 0 0)'; $('cmpHandle').style.left = v + '%'; }
  function download(text, name, type) { var a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], { type: type })); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }

  /* ---------- init ---------- */
  function init() {
    bindRanges(); bindCanvas();
    var restored = loadSettings(); if (!restored) applyPreset('anime'); else updateModeUI();
    ['colors', 'minArea', 'minThickness', 'smooth', 'maxShapes'].forEach(function (id) { $(id).addEventListener('input', markCustom); });
    $('preset').addEventListener('change', function () { applyPreset($('preset').value); });
    $('bwAuto').addEventListener('change', function () { $('bwThr').disabled = $('bwAuto').checked; });
    ['tol', 'shrink'].forEach(function (id) { $(id).addEventListener('input', applyMask); });
    ['edgeOnly', 'useAlpha'].forEach(function (id) { $(id).addEventListener('change', applyMask); });
    $('bgOn').addEventListener('change', function () { if ($('bgOn').checked && !S.seeds.length && S.src) { var d = detectBorder(); S.seeds = d.seeds; renderSeeds(); if (!S.seeds.length) toast('Ketuk warna latar di foto.'); } applyMask(); });
    $('autoSeed').onclick = function () { if (!S.src) return; var d = detectBorder(); S.seeds = d.seeds; $('bgOn').checked = true; renderSeeds(); applyMask(); toast('Warna dari tepi foto: ' + d.seeds.length + ' (' + Math.round(d.share * 100) + '% tepi).'); };
    $('clearSeeds').onclick = function () { S.seeds = []; renderSeeds(); applyMask(); };
    $('drop').onclick = $('change').onclick = function () { $('f').click(); };
    $('f').onchange = function (e) { var f = e.target.files[0]; e.target.value = ''; loadFile(f); };
    ['dragenter', 'dragover'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); $('drop').classList.add('on'); }); });
    ['dragleave', 'drop'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); $('drop').classList.remove('on'); if (n === 'drop' && e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); }); });
    document.addEventListener('paste', function (e) { var it = Array.prototype.find.call(e.clipboardData ? e.clipboardData.items : [], function (i) { return i.type.indexOf('image/') === 0; }); if (it) loadFile(it.getAsFile()); });
    $('tab-photo').onclick = function () { showTab('photo'); }; $('tab-result').onclick = function () { if (!$('tab-result').disabled) showTab('result'); };
    $('cmpRange').addEventListener('input', function () { setCmp(+$('cmpRange').value); });
    $('go').onclick = runTrace;
    $('dsvg').onclick = function () { if (S.svg) download(S.svg, safeName(S.name) + '-trace.svg', 'image/svg+xml'); };
    $('dxml').onclick = function () { if (S.xml) download(S.xml, safeName(S.name) + '-trace.xml', 'application/xml'); };
    document.addEventListener('change', saveSettings);
    ['sceneSize', 'sceneBg'].forEach(function (id) { $(id).addEventListener('change', function () { if (S.result) { buildXml(); renderStats(); } }); });
    setTool('pick');
    // status server
    var chip = $('srv'), ctl = window.AbortSignal && AbortSignal.timeout ? { signal: AbortSignal.timeout(5000) } : {};
    fetch('/api/trace', ctl).then(function (r) { return r.json(); }).then(function (j) { if (!j.ok) throw 0; chip.textContent = 'Server: siap'; chip.className = 'chip ok'; })
      .catch(function () { chip.textContent = 'Server: tidak terjangkau · pakai lokal'; chip.className = 'chip off'; });
  }
  init();
})();

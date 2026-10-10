/* AutoTrace engine — raster (RGBA) -> shape vector (Bezier), tanpa dependensi.
   Jalan identik di Node (server Vercel) dan di browser (Web Worker / fallback lokal).

   Alur:
   1. alpha  : piksel transparan (alpha < alphaCut) = "skip" (latar yang sudah dihapus).
   2. denoise: bilateral di ruang Lab (meratakan artefak JPEG tanpa merusak tepi).
   3. kuantisasi: k-means di ruang Lab pada histogram sel (warna langka tidak tenggelam).
   4. bersihkan: komponen kecil / terlalu tipis digabung ke tetangga terpanjang; batas maxShapes.
   5. kontur  : tiap komponen -> kontur luar (crack-following), dihaluskan, dikurvakan (Schneider).
   6. susun   : bentuk TERISI PENUH diurutkan dari area terbesar -> terkecil (ditumpuk).
                Tidak ada celah antar-shape dan tidak butuh lubang, kecuali area transparan
                (latar yang dihapus) yang diperlakukan sebagai lubang sungguhan (subpath terbalik). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.AutoTrace = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    mode: 'color',        // 'color' | 'bw'
    colors: 12,           // jumlah warna maksimum (mode color)
    minArea: 14,          // buang bercak < px^2
    minThickness: 1.4,    // buang area yang lebih tipis dari ini (px) — menghapus fringe JPEG
    smooth: 1.8,          // sigma penghalusan kontur di antara sudut (px)
    fitError: 0.5,        // toleransi kurva Bezier (px)
    maxShapes: 160,       // batas jumlah layer
    holes: true,          // potong area transparan sebagai lubang
    bleed: 0.7,           // tumpang-tindih tepi antar warna (px) agar tidak ada garis celah
    denoise: 1,           // 0 mati, 1 satu putaran, 2 dua putaran
    alphaCut: 128,
    cornerAngle: 55,      // derajat; sudut tajam dipertahankan
    merge: 5,             // gabung warna palet yang lebih dekat dari ΔE ini
    bwThreshold: 'auto',  // 'auto' (Otsu) atau 0..255
    bwFill: 'dark',       // 'dark' | 'light' | 'both'
    ink: '#000000',
    maxPixels: 2600000
  };

  /* ---------- warna ---------- */
  var S2L = new Float32Array(256);
  for (var i0 = 0; i0 < 256; i0++) { var c0 = i0 / 255; S2L[i0] = c0 <= 0.04045 ? c0 / 12.92 : Math.pow((c0 + 0.055) / 1.055, 2.4); }
  function fLab(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  function rgbToLab(r, g, b, out) {
    var R = S2L[r], G = S2L[g], B = S2L[b];
    var fx = fLab((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047);
    var fy = fLab(0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
    var fz = fLab((0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883);
    out[0] = 116 * fy - 16; out[1] = 500 * (fx - fy); out[2] = 200 * (fy - fz);
    return out;
  }
  function labToRgb(L, a, b) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    function inv(t) { var t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; }
    var X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
    var R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
    var G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
    var B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    function g(c) { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); }
    return [g(R), g(G), g(B)];
  }
  function hex(rgb) { return '#' + rgb.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function parseHex(h) { var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [0, 0, 0]; var n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

  /* data RGBA -> Float32 L,A,B (+ valid flag) */
  function toLab(data, N, alphaCut) {
    var L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N), valid = new Uint8Array(N), tmp = [0, 0, 0];
    for (var p = 0, q = 0; p < N; p++, q += 4) {
      if (data[q + 3] < alphaCut) continue;
      valid[p] = 1; rgbToLab(data[q], data[q + 1], data[q + 2], tmp);
      L[p] = tmp[0]; A[p] = tmp[1]; B[p] = tmp[2];
    }
    return { L: L, A: A, B: B, valid: valid };
  }

  /* ---------- denoise (bilateral) ---------- */
  function bilateral(lab, W, H, sigmaR) {
    var L = lab.L, A = lab.A, B = lab.B, valid = lab.valid, r = 2, size = 2 * r + 1;
    var ws = new Float32Array(size * size);
    for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) ws[(dy + r) * size + dx + r] = Math.exp(-(dx * dx + dy * dy) / (2 * 1.3 * 1.3));
    var oL = new Float32Array(L.length), oA = new Float32Array(L.length), oB = new Float32Array(L.length), inv = 1 / (sigmaR * sigmaR);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var p = y * W + x;
        if (!valid[p]) continue;
        var l0 = L[p], a0 = A[p], b0 = B[p], sw = 0, sl = 0, sa = 0, sb = 0;
        for (var j = -r; j <= r; j++) {
          var yy = y + j; if (yy < 0 || yy >= H) continue;
          for (var i = -r; i <= r; i++) {
            var xx = x + i; if (xx < 0 || xx >= W) continue;
            var q = yy * W + xx; if (!valid[q]) continue;
            var dl = L[q] - l0, da = A[q] - a0, db = B[q] - b0, t = 1 / (1 + (dl * dl + da * da + db * db) * inv), w = ws[(j + r) * size + i + r] * t * t;
            sw += w; sl += w * L[q]; sa += w * A[q]; sb += w * B[q];
          }
        }
        oL[p] = sl / sw; oA[p] = sa / sw; oB[p] = sb / sw;
      }
    }
    return { L: oL, A: oA, B: oB, valid: valid };
  }

  /* ---------- palet: k-means pada histogram sel ---------- */
  function buildPalette(lab, N, K, mergeDE) {
    var CL = 26, CA = 64, CB = 64, total = CL * CA * CB;
    var cnt = new Float64Array(total), sL = new Float64Array(total), sA = new Float64Array(total), sB = new Float64Array(total);
    var L = lab.L, A = lab.A, B = lab.B, valid = lab.valid, p, idx;
    for (p = 0; p < N; p++) {
      if (!valid[p]) continue;
      var li = Math.min(CL - 1, Math.floor(L[p] * 0.25)), ai = Math.max(0, Math.min(CA - 1, Math.floor((A[p] + 128) * 0.25))), bi = Math.max(0, Math.min(CB - 1, Math.floor((B[p] + 128) * 0.25)));
      idx = (li * CA + ai) * CB + bi; cnt[idx]++; sL[idx] += L[p]; sA[idx] += A[p]; sB[idx] += B[p];
    }
    var cl = [], ca = [], cb = [], cw = [];
    for (idx = 0; idx < total; idx++) if (cnt[idx] > 0) { cl.push(sL[idx] / cnt[idx]); ca.push(sA[idx] / cnt[idx]); cb.push(sB[idx] / cnt[idx]); cw.push(Math.sqrt(cnt[idx])); }
    var n = cl.length; if (!n) return { L: [], A: [], B: [] };
    K = Math.max(1, Math.min(K, n));
    var cL = [], cA = [], cB = [], minD = new Float64Array(n).fill(Infinity), i, k;
    var first = 0; for (i = 1; i < n; i++) if (cw[i] > cw[first]) first = i;
    cL.push(cl[first]); cA.push(ca[first]); cB.push(cb[first]);
    while (cL.length < K) {
      var last = cL.length - 1, best = -1, bv = -1;
      for (i = 0; i < n; i++) {
        var dl = cl[i] - cL[last], da = ca[i] - cA[last], db = cb[i] - cB[last], d2 = dl * dl + da * da + db * db;
        if (d2 < minD[i]) minD[i] = d2;
        var v = minD[i] * cw[i]; if (v > bv) { bv = v; best = i; }
      }
      if (bv <= 0) break;
      cL.push(cl[best]); cA.push(ca[best]); cB.push(cb[best]);
    }
    K = cL.length;
    var assign = new Int32Array(n);
    for (var it = 0; it < 14; it++) {
      var moved = 0, sumw = new Float64Array(K), s1 = new Float64Array(K), s2 = new Float64Array(K), s3 = new Float64Array(K);
      for (i = 0; i < n; i++) {
        var bk = 0, bd = Infinity;
        for (k = 0; k < K; k++) { var dl2 = cl[i] - cL[k], da2 = ca[i] - cA[k], db2 = cb[i] - cB[k], dd = dl2 * dl2 + da2 * da2 + db2 * db2; if (dd < bd) { bd = dd; bk = k; } }
        if (assign[i] !== bk) { assign[i] = bk; moved++; }
        sumw[bk] += cw[i]; s1[bk] += cw[i] * cl[i]; s2[bk] += cw[i] * ca[i]; s3[bk] += cw[i] * cb[i];
      }
      for (k = 0; k < K; k++) if (sumw[k] > 0) { cL[k] = s1[k] / sumw[k]; cA[k] = s2[k] / sumw[k]; cB[k] = s3[k] / sumw[k]; }
      if (!moved && it) break;
    }
    // gabung warna yang terlalu mirip
    var merged = true;
    while (merged && cL.length > 1) {
      merged = false;
      for (i = 0; i < cL.length && !merged; i++) for (k = i + 1; k < cL.length; k++) {
        var xl = cL[i] - cL[k], xa = cA[i] - cA[k], xb = cB[i] - cB[k];
        if (Math.sqrt(xl * xl + xa * xa + xb * xb) < mergeDE) { cL[i] = (cL[i] + cL[k]) / 2; cA[i] = (cA[i] + cA[k]) / 2; cB[i] = (cB[i] + cB[k]) / 2; cL.splice(k, 1); cA.splice(k, 1); cB.splice(k, 1); merged = true; break; }
      }
    }
    return { L: cL, A: cA, B: cB };
  }

  function assignLabels(lab, N, pal) {
    var K = pal.L.length, out = new Int16Array(N).fill(-1), L = lab.L, A = lab.A, B = lab.B, valid = lab.valid, PL = pal.L, PA = pal.A, PB = pal.B;
    for (var p = 0; p < N; p++) {
      if (!valid[p]) continue;
      var bk = 0, bd = Infinity, l = L[p], a = A[p], b = B[p];
      for (var k = 0; k < K; k++) { var dl = l - PL[k], da = a - PA[k], db = b - PB[k], d = dl * dl + da * da + db * db; if (d < bd) { bd = d; bk = k; } }
      out[p] = bk;
    }
    return out;
  }

  function otsu(lab, N) {
    var hist = new Float64Array(256), total = 0, p;
    for (p = 0; p < N; p++) if (lab.valid[p]) { hist[Math.max(0, Math.min(255, Math.round(lab.L[p] * 2.55)))]++; total++; }
    var sum = 0, i; for (i = 0; i < 256; i++) sum += i * hist[i];
    var wB = 0, sB = 0, best = 0, bt = 128;
    for (i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; var wF = total - wB; if (!wF) break; sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; bt = i; } }
    return bt;
  }

  /* ---------- komponen ---------- */
  function components(lab, W, H) {
    var N = W * H, id = new Int32Array(N).fill(-1), stack = new Int32Array(N), area = [], label = [], minx = [], miny = [], maxx = [], maxy = [], first = [], n = 0;
    for (var s = 0; s < N; s++) {
      if (id[s] !== -1) continue;
      var lb = lab[s], sp = 0, a = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      stack[sp++] = s; id[s] = n;
      while (sp) {
        var p = stack[--sp], x = p % W, y = (p - x) / W; a++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && id[p - 1] === -1 && lab[p - 1] === lb) { id[p - 1] = n; stack[sp++] = p - 1; }
        if (x < W - 1 && id[p + 1] === -1 && lab[p + 1] === lb) { id[p + 1] = n; stack[sp++] = p + 1; }
        if (y > 0 && id[p - W] === -1 && lab[p - W] === lb) { id[p - W] = n; stack[sp++] = p - W; }
        if (y < H - 1 && id[p + W] === -1 && lab[p + W] === lb) { id[p + W] = n; stack[sp++] = p + W; }
      }
      area.push(a); label.push(lb); minx.push(x0); miny.push(y0); maxx.push(x1); maxy.push(y1); first.push(s); n++;
    }
    return { id: id, n: n, area: area, label: label, minx: minx, miny: miny, maxx: maxx, maxy: maxy, first: first };
  }

  /* gabungkan komponen kecil/tipis ke tetangga dengan batas terpanjang. true jika ada perubahan */
  function cleanupPass(lab, W, H, minArea, minThick, col) {
    var c = components(lab, W, H), n = c.n, id = c.id, perim = new Int32Array(n), rem = new Uint8Array(n), any = 0, x, y, p, a, b;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      p = y * W + x; a = id[p];
      if (x < W - 1) { b = id[p + 1]; if (a !== b) { perim[a]++; perim[b]++; } }
      if (y < H - 1) { b = id[p + W]; if (a !== b) { perim[a]++; perim[b]++; } }
    }
    for (var i = 0; i < n; i++) {
      if (c.area[i] < minArea || (minThick > 0 && perim[i] > 0 && 2 * c.area[i] / perim[i] < minThick)) { rem[i] = 1; any++; }
    }
    if (!any || any === n) return false;
    var votes = new Map(), M = n;
    function add(u, v) { var k = u * M + v; votes.set(k, (votes.get(k) || 0) + 1); }
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      p = y * W + x; a = id[p];
      if (x < W - 1) { b = id[p + 1]; if (a !== b) { if (rem[a]) add(a, b); if (rem[b]) add(b, a); } }
      if (y < H - 1) { b = id[p + W]; if (a !== b) { if (rem[a]) add(a, b); if (rem[b]) add(b, a); } }
    }
    var best = new Int32Array(n).fill(-1), bscore = new Float64Array(n).fill(-1);
    votes.forEach(function (v, k) {
      var u = Math.floor(k / M), w = k - u * M, score = v + (rem[w] ? 0 : 1e9);
      if (score > bscore[u]) { bscore[u] = score; best[u] = w; }
    });
    var target = new Int16Array(n).fill(-2);
    for (i = 0; i < n; i++) {
      if (!rem[i]) { target[i] = c.label[i]; continue; }
      var cur = i, hops = 0;
      while (rem[cur] && best[cur] >= 0 && hops < 8) { cur = best[cur]; hops++; }
      target[i] = rem[cur] ? c.label[i] : c.label[cur];
    }
    // pita tepi (fringe): tiap piksel dibagi ke warna tetangga TERDEKAT, bukan seluruh pita ke satu sisi
    var cand = new Array(n), cen = null;
    if (col) {
      var ml = 0; for (p = 0; p < lab.length; p++) if (lab[p] + 1 > ml) ml = lab[p] + 1;
      cen = { n: new Float64Array(ml + 1), l: new Float64Array(ml + 1), a: new Float64Array(ml + 1), b: new Float64Array(ml + 1) };
      for (p = 0; p < lab.length; p++) { var lq = lab[p]; if (lq < 0 || rem[id[p]]) continue; cen.n[lq]++; cen.l[lq] += col.L[p]; cen.a[lq] += col.A[p]; cen.b[lq] += col.B[p]; }
      votes.forEach(function (v, k) {
        var u = Math.floor(k / M), w = k - u * M;
        if (rem[w]) return;
        var lw = c.label[w], arr = cand[u] || (cand[u] = []);
        if (arr.indexOf(lw) < 0) arr.push(lw);
      });
    }
    var changed = false;
    for (p = 0; p < lab.length; p++) {
      var cp = id[p], t = target[cp];
      if (rem[cp] && cen && cand[cp] && cand[cp].length > 1 && cand[cp].indexOf(-1) < 0) {
        var bd = Infinity, arr2 = cand[cp];
        for (var z = 0; z < arr2.length; z++) {
          var lz = arr2[z]; if (!cen.n[lz]) continue;
          var dl = col.L[p] - cen.l[lz] / cen.n[lz], da = col.A[p] - cen.a[lz] / cen.n[lz], db = col.B[p] - cen.b[lz] / cen.n[lz], dd = dl * dl + da * da + db * db;
          if (dd < bd) { bd = dd; t = lz; }
        }
      }
      if (t !== lab[p]) { lab[p] = t; changed = true; }
    }
    return changed;
  }

  /* ---------- kontur ---------- */
  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  function traceOuter(id, W, H, c, x0, y0) {
    var pts = [x0, y0], x = x0 + 1, y = y0, d = 0, guard = 4 * W * H + 16;
    while (guard--) {
      var rx, ry, lx, ly;
      if (d === 0) { rx = x; ry = y; lx = x; ly = y - 1; }
      else if (d === 1) { rx = x - 1; ry = y; lx = x; ly = y; }
      else if (d === 2) { rx = x - 1; ry = y - 1; lx = x - 1; ly = y; }
      else { rx = x; ry = y - 1; lx = x - 1; ly = y - 1; }
      var R = rx >= 0 && rx < W && ry >= 0 && ry < H && id[ry * W + rx] === c;
      var Lm = lx >= 0 && lx < W && ly >= 0 && ly < H && id[ly * W + lx] === c;
      var nd = d; if (!R) nd = (d + 1) & 3; else if (Lm) nd = (d + 3) & 3;
      if (x === x0 && y === y0 && nd === 0) break;
      if (nd !== d) { pts.push(x, y); d = nd; }
      x += DX[d]; y += DY[d];
    }
    return Int32Array.from(pts);
  }
  function polyArea(poly) {
    var s = 0, n = poly.length;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) s += poly[j] * poly[i + 1] - poly[i] * poly[j + 1];
    return Math.abs(s) / 2;
  }
  function inPoly(poly, px, py) {
    var inside = false, n = poly.length;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
      var xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /* ---------- fitting Bezier (Schneider) ---------- */
  function fitRun(rx, ry, t1, t2, err2, out) {
    fitCubic(rx, ry, 0, rx.length - 1, t1, t2, err2, out);
  }
  function fitCubic(px, py, first, last, t1, t2, err2, out) {
    var n = last - first + 1;
    if (n < 2) return;
    if (n === 2) {
      var dist = Math.hypot(px[last] - px[first], py[last] - py[first]) / 3;
      out.push([px[first], py[first], px[first] + t1[0] * dist, py[first] + t1[1] * dist, px[last] + t2[0] * dist, py[last] + t2[1] * dist, px[last], py[last]]);
      return;
    }
    var u = chord(px, py, first, last), bez = genBezier(px, py, first, last, u, t1, t2), e = maxErr(px, py, first, last, bez, u);
    if (e.err < err2) { out.push(bez); return; }
    if (e.err < err2 * 4) {
      for (var i = 0; i < 4; i++) {
        var u2 = reparam(px, py, first, last, u, bez); bez = genBezier(px, py, first, last, u2, t1, t2); e = maxErr(px, py, first, last, bez, u2);
        if (e.err < err2) { out.push(bez); return; }
        u = u2;
      }
    }
    var sp = e.split; if (sp <= first) sp = first + 1; if (sp >= last) sp = last - 1;
    var tc = norm(px[sp - 1] - px[sp + 1], py[sp - 1] - py[sp + 1]);
    fitCubic(px, py, first, sp, t1, tc, err2, out);
    fitCubic(px, py, sp, last, [-tc[0], -tc[1]], t2, err2, out);
  }
  function norm(x, y) { var l = Math.hypot(x, y); return l > 1e-12 ? [x / l, y / l] : [0, 0]; }
  function chord(px, py, f, l) {
    var u = [0]; for (var i = f + 1; i <= l; i++) u.push(u[u.length - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]));
    var tot = u[u.length - 1]; if (tot > 0) for (i = 1; i < u.length; i++) u[i] /= tot; return u;
  }
  function genBezier(px, py, f, l, u, t1, t2) {
    var p0x = px[f], p0y = py[f], p3x = px[l], p3y = py[l], c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (var i = 0; i < u.length; i++) {
      var t = u[i], s = 1 - t, b0 = s * s * s, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t * t * t;
      var a1x = t1[0] * b1, a1y = t1[1] * b1, a2x = t2[0] * b2, a2y = t2[1] * b2;
      c00 += a1x * a1x + a1y * a1y; c01 += a1x * a2x + a1y * a2y; c11 += a2x * a2x + a2y * a2y;
      var tx = px[f + i] - (p0x * (b0 + b1) + p3x * (b2 + b3)), ty = py[f + i] - (p0y * (b0 + b1) + p3y * (b2 + b3));
      x0 += a1x * tx + a1y * ty; x1 += a2x * tx + a2y * ty;
    }
    var det = c00 * c11 - c01 * c01, al = 0, ar = 0, seg = Math.hypot(p3x - p0x, p3y - p0y);
    if (Math.abs(det) > 1e-12) { al = (x0 * c11 - x1 * c01) / det; ar = (c00 * x1 - c01 * x0) / det; }
    var eps = 1e-6 * seg;
    if (Math.abs(det) <= 1e-12 || al < eps || ar < eps) { al = ar = seg / 3; }
    return [p0x, p0y, p0x + t1[0] * al, p0y + t1[1] * al, p3x + t2[0] * ar, p3y + t2[1] * ar, p3x, p3y];
  }
  function bezAt(b, t) {
    var s = 1 - t, b0 = s * s * s, b1 = 3 * t * s * s, b2 = 3 * t * t * s, b3 = t * t * t;
    return [b0 * b[0] + b1 * b[2] + b2 * b[4] + b3 * b[6], b0 * b[1] + b1 * b[3] + b2 * b[5] + b3 * b[7]];
  }
  function maxErr(px, py, f, l, bez, u) {
    var best = 0, split = Math.floor((f + l) / 2);
    for (var i = 1; i < u.length - 1; i++) { var q = bezAt(bez, u[i]), dx = q[0] - px[f + i], dy = q[1] - py[f + i], d = dx * dx + dy * dy; if (d >= best) { best = d; split = f + i; } }
    return { err: best, split: split };
  }
  function reparam(px, py, f, l, u, b) {
    var out = [];
    for (var i = 0; i < u.length; i++) {
      var t = u[i], s = 1 - t, q = bezAt(b, t);
      var d1x = 3 * (s * s * (b[2] - b[0]) + 2 * s * t * (b[4] - b[2]) + t * t * (b[6] - b[4])), d1y = 3 * (s * s * (b[3] - b[1]) + 2 * s * t * (b[5] - b[3]) + t * t * (b[7] - b[5]));
      var d2x = 6 * (s * (b[4] - 2 * b[2] + b[0]) + t * (b[6] - 2 * b[4] + b[2])), d2y = 6 * (s * (b[5] - 2 * b[3] + b[1]) + t * (b[7] - 2 * b[5] + b[3]));
      var dx = q[0] - px[f + i], dy = q[1] - py[f + i], num = dx * d1x + dy * d1y, den = d1x * d1x + d1y * d1y + dx * d2x + dy * d2y;
      var nt = Math.abs(den) < 1e-12 ? t : t - num / den; out.push(Math.max(0, Math.min(1, nt)));
    }
    out[0] = 0; out[out.length - 1] = 1;
    for (i = 1; i < out.length; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
    return out;
  }

  /* poly rektilinear -> string path "M..C..Z". grow=+1 melebarkan materi di sisi kiri jalur luar, -1 untuk lubang */
  function r2(v) { return Math.round(v * 100) / 100; }
  function contourToPath(poly, grow, o, sink, ctx) {
    var n = poly.length / 2, i, j, k;
    // 1. resample tiap 1px; bobot bleed = 1 bila sisi luar adalah warna lain (bukan latar transparan/tepi gambar)
    var xs = [], ys = [], bw = [];
    for (i = 0; i < n; i++) {
      var x0 = poly[i * 2], y0 = poly[i * 2 + 1], nx = poly[((i + 1) % n) * 2], ny = poly[((i + 1) % n) * 2 + 1], len = Math.abs(nx - x0) + Math.abs(ny - y0), steps = Math.max(1, len);
      var dd = nx > x0 ? 0 : ny > y0 ? 1 : nx < x0 ? 2 : 3;
      for (k = 0; k < steps; k++) {
        xs.push(x0 + (nx - x0) * k / steps); ys.push(y0 + (ny - y0) * k / steps);
        if (ctx) {
          var ox = dd === 0 ? x0 + k : dd === 1 ? x0 : dd === 2 ? x0 - k - 1 : x0 - 1, oy = dd === 0 ? y0 - 1 : dd === 1 ? y0 + k : dd === 2 ? y0 : y0 - k - 1;
          bw.push(ox >= 0 && ox < ctx.W && oy >= 0 && oy < ctx.H && ctx.labels[oy * ctx.W + ox] >= 0 ? 1 : 0);
        } else bw.push(0);
      }
    }
    var m = xs.length;
    if (m < 8) return null;
    // 2. haluskan ringan hanya untuk mendeteksi sudut tajam
    function kernel(sg) { var R = Math.max(1, Math.ceil(sg * 3)), ker = new Float64Array(2 * R + 1), ks = 0, q; for (q = -R; q <= R; q++) { ker[q + R] = Math.exp(-(q * q) / (2 * sg * sg)); ks += ker[q + R]; } for (q = 0; q < ker.length; q++) ker[q] /= ks; return { R: R, w: ker }; }
    function circSmooth(ax, ay, sg) {
      var K0 = kernel(sg), ox = new Float64Array(m), oy = new Float64Array(m), q, jj, sx, sy;
      for (var ii = 0; ii < m; ii++) { sx = 0; sy = 0; for (q = -K0.R; q <= K0.R; q++) { jj = (ii + q + m * 8) % m; sx += K0.w[q + K0.R] * ax[jj]; sy += K0.w[q + K0.R] * ay[jj]; } ox[ii] = sx; oy[ii] = sy; }
      return [ox, oy];
    }
    var rawX = Float64Array.from(xs), rawY = Float64Array.from(ys);
    var light = circSmooth(rawX, rawY, 0.9), lx = light[0], ly = light[1];
    var mm = 4, turn = new Float64Array(m), cosA = Math.cos(o.cornerAngle * Math.PI / 180), cs = [];
    if (m > mm * 4) {
      for (i = 0; i < m; i++) {
        var pa = (i - mm + m * 4) % m, pb = (i + mm) % m, v1x = lx[i] - lx[pa], v1y = ly[i] - ly[pa], v2x = lx[pb] - lx[i], v2y = ly[pb] - ly[i], l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
        turn[i] = (l1 > 1e-9 && l2 > 1e-9) ? (v1x * v2x + v1y * v2y) / (l1 * l2) : 1;
      }
      for (i = 0; i < m; i++) {
        if (turn[i] >= cosA) continue;
        var isMax = true;
        for (k = -mm; k <= mm && isMax; k++) { if (!k) continue; var jj2 = (i + k + m * 4) % m; if (turn[jj2] < turn[i] || (turn[jj2] === turn[i] && jj2 < i)) isMax = false; }
        if (isMax) cs.push(i);
      }
    }
    // 3. haluskan kuat DI DALAM tiap run di antara sudut (ujung run tetap = sudut asli)
    var sg = Math.max(0.3, o.smooth), cornerIdx = [], artificial = !cs.length;
    if (artificial) {
      var heavy = circSmooth(rawX, rawY, sg); xs = heavy[0]; ys = heavy[1];
    } else {
      var fx = [], fy = [], runs = [];
      for (var s0 = 0; s0 < cs.length; s0++) {
        var ra = cs[s0], rb = cs[(s0 + 1) % cs.length], L0 = ((rb - ra + m) % m) + 1; if (cs.length === 1) L0 = m + 1;
        var px0 = new Float64Array(L0), py0 = new Float64Array(L0);
        for (i = 0; i < L0; i++) { px0[i] = rawX[(ra + i) % m]; py0[i] = rawY[(ra + i) % m]; }
        px0[0] = lx[ra]; py0[0] = ly[ra]; px0[L0 - 1] = lx[rb]; py0[L0 - 1] = ly[rb];
        var se = Math.min(sg, (L0 - 1) / 6), qx = px0, qy = py0;
        if (se >= 0.35 && L0 >= 7) {
          var K1 = kernel(se); qx = new Float64Array(L0); qy = new Float64Array(L0);
          for (i = 0; i < L0; i++) {
            var sx2 = 0, sy2 = 0;
            for (k = -K1.R; k <= K1.R; k++) {
              var id2 = i + k, X, Y;
              if (id2 < 0) { id2 = Math.min(L0 - 1, -id2); X = 2 * px0[0] - px0[id2]; Y = 2 * py0[0] - py0[id2]; }
              else if (id2 > L0 - 1) { id2 = Math.max(0, 2 * (L0 - 1) - id2); X = 2 * px0[L0 - 1] - px0[id2]; Y = 2 * py0[L0 - 1] - py0[id2]; }
              else { X = px0[id2]; Y = py0[id2]; }
              sx2 += K1.w[k + K1.R] * X; sy2 += K1.w[k + K1.R] * Y;
            }
            qx[i] = sx2; qy[i] = sy2;
          }
        }
        runs.push({ x: qx, y: qy, L: L0 });
      }
      // sudut tajam: pakai perpotongan dua garis tepi (bukan titik jangkar yang terpotong penghalusan)
      var NR = runs.length;
      for (var cI = 0; cI < NR; cI++) {
        var prv = runs[(cI - 1 + NR) % NR], cur = runs[cI];
        if (prv.L < 11 || cur.L < 11) continue;
        var pe = prv.L - 1, a1x = prv.x[pe - 4], a1y = prv.y[pe - 4], d1x = a1x - prv.x[pe - 8], d1y = a1y - prv.y[pe - 8];
        var b1x = cur.x[4], b1y = cur.y[4], d2x = cur.x[8] - b1x, d2y = cur.y[8] - b1y, l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
        if (l1 < 1e-6 || l2 < 1e-6) continue;
        d1x /= l1; d1y /= l1; d2x /= l2; d2y /= l2;
        var cr = d1x * d2y - d1y * d2x;
        if (Math.abs(cr) < 0.25) continue;
        var tt = ((b1x - a1x) * d2y - (b1y - a1y) * d2x) / cr, Xx = a1x + d1x * tt, Xy = a1y + d1y * tt;
        if (Math.hypot(Xx - cur.x[0], Xy - cur.y[0]) > 2.5) continue;
        var ddx = Xx - cur.x[0], ddy = Xy - cur.y[0];
        for (k = 0; k < 4; k++) { var fw = 1 - k / 4; cur.x[k] += ddx * fw; cur.y[k] += ddy * fw; prv.x[prv.L - 1 - k] += ddx * fw; prv.y[prv.L - 1 - k] += ddy * fw; }
      }
      for (var rI = 0; rI < NR; rI++) {
        var RR = runs[rI]; cornerIdx.push(fx.length);
        for (i = 0; i < RR.L - 1; i++) { fx.push(RR.x[i]); fy.push(RR.y[i]); }
      }
      var m0 = m; xs = Float64Array.from(fx); ys = Float64Array.from(fy); m = xs.length;
      if (m < 6) return null;
      // bobot bleed mengikuti urutan baru: pakai pemetaan indeks lama
      var nbw = new Array(m), pos = 0;
      for (var s1 = 0; s1 < cs.length; s1++) {
        var rra = cs[s1], rrb = cs[(s1 + 1) % cs.length], LL = ((rrb - rra + m0) % m0) + 1; if (cs.length === 1) LL = m0 + 1;
        for (i = 0; i < LL - 1 && pos < m; i++) nbw[pos++] = bw[(rra + i) % m0];
      }
      while (pos < m) nbw[pos++] = 0;
      bw = nbw;
    }
    // 4. offset (bleed)
    if (o.bleed > 0 && grow && ctx) {
      var ox2 = new Float64Array(m), oy2 = new Float64Array(m);
      for (i = 0; i < m; i++) {
        var a = (i - 2 + m * 4) % m, b = (i + 2) % m, tx = xs[b] - xs[a], ty = ys[b] - ys[a], tl = Math.hypot(tx, ty) || 1, wsum = 0;
        for (k = -4; k <= 4; k++) wsum += bw[(i + k + m * 4) % m] || 0;
        var f = grow * o.bleed * (wsum / 9);
        ox2[i] = xs[i] + f * (ty / tl); oy2[i] = ys[i] + f * (-tx / tl);
      }
      xs = ox2; ys = oy2;
    }
    var splitIdx = artificial ? [0, Math.floor(m / 2)] : cornerIdx;
    // 5. fit tiap run
    var err2 = o.fitError * o.fitError, segs = [], K = 2;
    function pt(idx) { idx = ((idx % m) + m) % m; return [xs[idx], ys[idx]]; }
    for (var s = 0; s < splitIdx.length; s++) {
      var a0 = splitIdx[s], b0 = splitIdx[(s + 1) % splitIdx.length], len = ((b0 - a0 + m) % m) + 1;
      if (splitIdx.length === 1) len = m + 1;
      if (len < 2) continue;
      var rx = new Float64Array(len), ry = new Float64Array(len);
      for (i = 0; i < len; i++) { rx[i] = xs[(a0 + i) % m]; ry[i] = ys[(a0 + i) % m]; }
      var t1, t2;
      if (artificial) {
        var pA = pt(a0 + K), pB = pt(a0 - K); t1 = norm(pA[0] - pB[0], pA[1] - pB[1]);
        var pC = pt(b0 - K), pD = pt(b0 + K); t2 = norm(pC[0] - pD[0], pC[1] - pD[1]);
      } else {
        var kk = Math.min(3, len - 1); t1 = norm(rx[kk] - rx[0], ry[kk] - ry[0]); t2 = norm(rx[len - 1 - kk] - rx[len - 1], ry[len - 1 - kk] - ry[len - 1]);
      }
      fitRun(rx, ry, t1, t2, err2, segs);
    }
    if (!segs.length) return null;
    var str = 'M' + r2(segs[0][0]) + ' ' + r2(segs[0][1]);
    for (i = 0; i < segs.length; i++) { var g = segs[i]; str += 'C' + r2(g[2]) + ' ' + r2(g[3]) + ' ' + r2(g[4]) + ' ' + r2(g[5]) + ' ' + r2(g[6]) + ' ' + r2(g[7]); }
    if (sink) sink.points += segs.length * 3 + 1;
    return str + 'Z';
  }

  /* ---------- utama ---------- */
  function trace(img, userOpts, progress) {
    var o = {}, kk; for (kk in DEFAULTS) o[kk] = DEFAULTS[kk]; for (kk in (userOpts || {})) if (userOpts[kk] !== undefined && userOpts[kk] !== null) o[kk] = userOpts[kk];
    var W = img.width, H = img.height, N = W * H, data = img.data, t0 = Date.now(), stats = { steps: {} }, stepT = t0;
    if (!(W > 0 && H > 0) || data.length < N * 4) throw new Error('Data gambar tidak valid.');
    if (N > o.maxPixels) throw new Error('Gambar terlalu besar (' + W + '×' + H + '). Kecilkan dulu.');
    function step(name, frac) { var now = Date.now(); stats.steps[name] = now - stepT; stepT = now; if (progress) progress(name, frac); }

    var lab = toLab(data, N, o.alphaCut), p, i;
    step('warna', 0.08);
    if (o.denoise > 0 && o.mode === 'color') { for (i = 0; i < Math.min(2, o.denoise); i++) lab = bilateral(lab, W, H, 10); }
    step('denoise', 0.25);

    var labels, palRGB = [], emitMap = [];
    if (o.mode === 'bw') {
      var thr = o.bwThreshold === 'auto' ? otsu(lab, N) : Math.max(0, Math.min(255, +o.bwThreshold));
      labels = new Int16Array(N).fill(-1);
      for (p = 0; p < N; p++) if (lab.valid[p]) labels[p] = (lab.L[p] * 2.55 <= thr) ? 0 : 1;
      var ink = parseHex(o.ink); palRGB = [ink, [255, 255, 255]];
      emitMap = [o.bwFill !== 'light', o.bwFill !== 'dark'];
      if (!emitMap[0]) for (p = 0; p < N; p++) if (labels[p] === 0) labels[p] = -1;
      if (!emitMap[1]) for (p = 0; p < N; p++) if (labels[p] === 1) labels[p] = -1;
      stats.threshold = thr;
    } else {
      var pal = buildPalette(lab, N, Math.max(2, Math.min(40, o.colors | 0)), o.merge);
      labels = assignLabels(lab, N, pal);
      stats.palette = pal.L.length;
    }
    step('palet', 0.4);

    // bersihkan
    var minArea = o.minArea, guard;
    for (guard = 0; guard < 4; guard++) if (!cleanupPass(labels, W, H, minArea, o.minThickness, lab)) break;
    var comps = components(labels, W, H);
    function emittedCount(c) { var k = 0; for (var q = 0; q < c.n; q++) if (c.label[q] >= 0) k++; return k; }
    var limit = Math.max(1, o.maxShapes | 0), tries = 0;
    while (emittedCount(comps) > limit && tries < 10) {
      var areas = []; for (i = 0; i < comps.n; i++) if (comps.label[i] >= 0) areas.push(comps.area[i]);
      areas.sort(function (a, b) { return a - b; });
      var thrA = areas[Math.max(0, areas.length - limit - 1)] + 1;
      minArea = Math.max(thrA, minArea * 1.3);
      for (guard = 0; guard < 3; guard++) if (!cleanupPass(labels, W, H, minArea, o.minThickness, lab)) break;
      comps = components(labels, W, H); tries++;
    }
    stats.minAreaUsed = Math.round(minArea);
    step('bersih', 0.55);

    // warna akhir per label (rata-rata piksel asli)
    var maxLab = 0; for (p = 0; p < N; p++) if (labels[p] > maxLab) maxLab = labels[p];
    var sr = new Float64Array(maxLab + 1), sg2 = new Float64Array(maxLab + 1), sb = new Float64Array(maxLab + 1), sn = new Float64Array(maxLab + 1);
    for (p = 0; p < N; p++) { var lb = labels[p]; if (lb < 0) continue; sr[lb] += data[p * 4]; sg2[lb] += data[p * 4 + 1]; sb[lb] += data[p * 4 + 2]; sn[lb]++; }
    var fills = [];
    for (i = 0; i <= maxLab; i++) {
      if (o.mode === 'bw') fills[i] = hex(palRGB[i] || [0, 0, 0]);
      else fills[i] = sn[i] ? hex([Math.round(sr[i] / sn[i]), Math.round(sg2[i] / sn[i]), Math.round(sb[i] / sn[i])]) : '#000000';
    }

    // kontur
    var cid = comps.id, emit = [], holeCand = [];
    for (i = 0; i < comps.n; i++) {
      var x0 = comps.first[i] % W, y0 = (comps.first[i] - x0) / W;
      if (comps.label[i] >= 0) {
        var poly = traceOuter(cid, W, H, i, x0, y0);
        emit.push({ c: i, poly: poly, filled: polyArea(poly), label: comps.label[i], holes: [] });
      } else if (o.holes && comps.minx[i] > 0 && comps.miny[i] > 0 && comps.maxx[i] < W - 1 && comps.maxy[i] < H - 1) {
        var hp = traceOuter(cid, W, H, i, x0, y0);
        holeCand.push({ c: i, poly: hp, area: polyArea(hp), x: x0 + 0.5, y: y0 + 0.5, path: null });
      }
    }
    emit.sort(function (a, b) { return b.filled - a.filled || a.c - b.c; });
    step('kontur', 0.7);

    // lubang: potong dari semua shape yang mengelilinginya
    var holeCount = 0;
    for (var h = 0; h < holeCand.length; h++) {
      var T = holeCand[h];
      for (i = 0; i < emit.length; i++) {
        var E = emit[i];
        if (E.filled <= T.area) break;
        var cc = E.c;
        if (T.x < comps.minx[cc] || T.x > comps.maxx[cc] + 1 || T.y < comps.miny[cc] || T.y > comps.maxy[cc] + 1) continue;
        if (inPoly(E.poly, T.x, T.y)) E.holes.push(T);
      }
    }

    // path
    var sink = { points: 0 }, shapes = [], ctx = { labels: labels, W: W, H: H };
    for (i = 0; i < emit.length; i++) {
      var Es = emit[i], d = contourToPath(Es.poly, 1, o, sink, ctx);
      if (!d) continue;
      for (var q = 0; q < Es.holes.length; q++) {
        var Th = Es.holes[q];
        if (Th.path === null) Th.path = contourToPath(Th.poly, -1, o, sink, null) || '';
        if (Th.path) { d += Th.path; holeCount++; }
      }
      shapes.push({ fill: fills[Es.label], d: d, area: Es.filled });
    }
    step('kurva', 0.95);
    stats.shapes = shapes.length; stats.holes = holeCount; stats.points = sink.points; stats.ms = Date.now() - t0; stats.minThickness = o.minThickness;
    if (progress) progress('selesai', 1);
    return { width: W, height: H, shapes: shapes, stats: stats };
  }

  function toSVG(res, opt) {
    opt = opt || {};
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + res.width + ' ' + res.height + '" width="' + res.width + '" height="' + res.height + '">';
    if (opt.bg) s += '<rect width="' + res.width + '" height="' + res.height + '" fill="' + opt.bg + '"/>';
    for (var i = 0; i < res.shapes.length; i++) s += '<path fill="' + res.shapes[i].fill + '" fill-rule="evenodd" d="' + res.shapes[i].d + '"/>';
    return s + '</svg>';
  }

  return { trace: trace, toSVG: toSVG, defaults: DEFAULTS, util: { toLab: toLab, rgbToLab: rgbToLab, labToRgb: labToRgb, hex: hex, parseHex: parseHex, otsu: otsu } };
});

# Auto Trace
Gambar (PNG/JPG/WEBP) → SVG → XML Alight Motion. 100% lokal di browser, tanpa server.

## Jalankan
Buka lewat server statis (bukan file://), mis. `npx serve .` atau GitHub Pages.

## Hosting di GitHub Pages
1. Buat repo, upload seluruh isi folder ini.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / root.
3. (Disarankan) Taruh `imagetracer_v1.2.6.js` (dari paket npm `imagetracerjs@1.2.6`) di `lib/` agar tidak bergantung CDN.

## Uji
`node tests/svg2am.test.js` — path dari ekspor Alight Motion asli harus identik setelah parse → tulis ulang.

## Format AM yang terverifikasi (dari tests/fixtures/sample.xml)
posisi = `<location>` + koordinat path · urutan XML = layer bawah → atas · path memakai M/L/C ·
warna `#aarrggbb` · path tertutup diakhiri `L` ke titik awal.

## Belum terverifikasi
Shape berlubang (subpath ganda, mis. huruf O) — kirim contoh XML cincin dari AM untuk memastikan.
Arc (`A`) di SVG belum didukung. Tracing belum memakai Web Worker.

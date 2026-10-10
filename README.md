# Auto Trace v2

Gambar (PNG/JPG/WEBP) → **hapus background** → **trace ke SVG** → **XML Alight Motion**.
Mesin trace ditulis sendiri tanpa dependensi (`lib/engine.js`) dan jalan di dua tempat: server Vercel (`/api/trace`) dan di perangkat (Web Worker) sebagai cadangan otomatis.

## Jalankan lokal
```bash
node dev-server.js        # http://localhost:3000  (tanpa npm install)
node tests/run-all.js     # uji konverter XML + mesin + PNG
```
Jangan buka lewat `file://` — pakai server (lokal atau Vercel).

## Deploy ke Vercel
1. Upload seluruh isi folder ini ke repo GitHub.
2. Vercel → *Add New Project* → pilih repo. Framework: **Other**, tanpa build command.
3. `api/trace.js` otomatis menjadi fungsi serverless. `vercel.json` mengatur `maxDuration` 60 dtk.
Batas request Vercel ±4,5 MB: foto otomatis diperkecil ke maks 1200 px di browser; bila PNG tetap terlalu besar, aplikasi memakai mesin lokal.

## Alur & perbaikan dari versi lama
| Masalah lama | Penyebab | Perbaikan |
|---|---|---|
| Vector tidak akurat | 8 warna dari k-means pada seluruh piksel, `pathomit` membuang detail, tanpa denoise, area warna berdampingan | Denoise bilateral Lab → k-means pada histogram sel (warna langka tidak tenggelam) → bersihkan komponen kecil/tipis → kurva Bezier (Schneider) dengan sudut tajam dipertahankan |
| Shape tidak terlihat | SVG tanpa `viewBox` terpotong di layar kecil; lubang tidak jelas; filter B&W membuang objek putih | `viewBox` benar; layer **terisi penuh & ditumpuk** dari area terbesar ke terkecil (tanpa lubang & tanpa celah); B&W bisa pilih bagian gelap/terang |
| Background tidak bisa dihapus | Semua area warna di-trace, termasuk latar & glow | Alat hapus background: pipet (banyak warna), toleransi, hanya-terhubung-ke-tepi, rapikan tepi, kuas hapus/pulihkan, alpha PNG |
| Tidak ada preview | Hanya teks status kecil | Thumbnail + nama + ukuran, kanvas pratinjau langsung, status & toast |

Area latar yang dihapus yang **terkurung** di dalam objek (mis. lubang huruf O) menjadi **lubang sungguhan**: satu `<path>` dengan sub-path berlawanan arah. Opsi *Potong lubang transparan* bisa dimatikan.

## Struktur
```
index.html  assets/{app.css,app.js,worker.js}
lib/engine.js   mesin trace (browser + Node)      lib/png.js   decoder PNG (server)
api/trace.js    endpoint Vercel                   src/svg2am.js  SVG path → XML Alight (diverifikasi dari ekspor asli)
dev-server.js   server lokal                      tests/       unit test, e2e (Playwright), gambar uji sintetis
```

## Belum terverifikasi (jujur)
- Belum diuji **di Vercel** maupun **diimpor ke Alight Motion** dari lingkungan pengembangan ini. Konverter XML lolos uji round-trip terhadap ekspor Alight asli, tetapi path **berlubang** (dua sub-path dalam satu shape) belum dicek di aplikasi Alight. Jika di Alight lubang terisi penuh, matikan *Potong lubang transparan* dan kirim XML contoh bentuk berlubang dari Alight agar bisa disesuaikan.
- Diuji dengan gambar sintetis (chibi ala anime ber-JPEG, cincin transparan, huruf) — bukan foto aslimu. Kualitas pada gambar nyata perlu dinilai; parameter bisa disetel dari tampilan.
- Penghapus background berbasis warna/kuas (bukan AI). Latar rumit membutuhkan beberapa ketukan pipet atau kuas.
- Arc (`A`) di path SVG belum didukung konverter (mesin ini tidak menghasilkannya).

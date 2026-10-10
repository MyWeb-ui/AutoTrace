# DESIGN — Auto Trace v2
**Arah:** alat kerja gelap, padat, mobile-first (pengguna Alight Motion bekerja dari HP). Mempertahankan identitas v1 (latar hijau-zaitun gelap, aksen hijau `#98ce7b`).
**Token:** `--bg #0b0f08`, `--surface #141a0f`, `--line #2a3421`, `--ac #98ce7b`; angka memakai monospace; radius 14 / 10; tanpa glow/blur dekoratif.
**Alur:** 1 Foto & background → 2 Hasil trace. Panel kanan: Berkas → Background → Trace → Alight; bar aksi menempel (bawah layar di HP, bawah kolom di desktop).
**Umpan balik:** thumbnail + nama + ukuran segera setelah foto dipilih; status `aria-live`; toast; bar progres; chip status server.
**Interaksi:** pipet (ketuk), kuas hapus/pulihkan (pointer, `touch-action:none` hanya saat kuas aktif), undo 12 langkah, pembanding Foto⟷Trace dengan slider.
**Aksesibilitas:** semua kontrol `<button>/<input>` berlabel, target ≥ 40px, fokus terlihat, `prefers-reduced-motion`. Kuas hanya dengan pointer; jalur tanpa pointer: tombol *Deteksi dari tepi foto*.
**Dihindari:** klaim palsu, tampilan "AI generik", animasi dekoratif.

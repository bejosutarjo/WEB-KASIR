# 🏪 Kasir BEJO — Aplikasi Kasir Warung (PWA)

Aplikasi kasir digital: produk, stok, transaksi, laporan omset, dan pembayaran QRIS.
Berjalan 100% di browser (tidak butuh server/database eksternal) dan bisa di-*install* seperti aplikasi native (PWA).

## ✨ Fitur
- Login terpisah **Pemilik** vs **Kasir**, dengan mode login kasir bisa dipilih: Username+Password atau PIN
- Kelola akun kasir (tambah / edit / nonaktifkan) — hanya bisa dilakukan Pemilik
- Kelola produk: tambah, edit, hapus, scan barcode untuk isi kode produk
- Cek stok saat ini + riwayat perubahan stok ("stok lama")
- Laporan omset harian & omset bersih (dikurangi modal), dengan rentang tanggal
- Riwayat transaksi + cetak ulang struk
- POS (kasir): cari produk, scan barcode/QR untuk transaksi, keranjang, cetak struk
- Pembayaran **QRIS dinamis**: nominal otomatis mengikuti jumlah tagihan, dibuat dari QRIS statis toko Anda
- Bisa di-install ke HP/laptop (PWA) dan bekerja offline setelah pertama kali dibuka

## 📲 Cara Install (Sebagai Pengguna)
1. Buka alamat web aplikasi ini (setelah di-deploy, lihat langkah GitHub di bawah) menggunakan **Chrome/Edge/Safari**.
2. Android/Chrome: ketuk menu (⋮) → **"Install aplikasi"** / **"Tambahkan ke layar utama"**.
3. iPhone/Safari: ketuk tombol **Share** → **"Add to Home Screen"**.
4. Ikon Kasir BEJO akan muncul di layar utama seperti aplikasi biasa.

## 🚀 Cara Deploy Gratis ke GitHub Pages
1. Buat repository baru di GitHub (bisa **Private** — lihat catatan keamanan di bawah).
2. Upload/extract seluruh isi folder ini ke repo tersebut (jangan taruh di dalam subfolder, biarkan `index.html` ada di root).
3. Buka **Settings → Pages** pada repo.
4. Pada **Source**, pilih branch `main` dan folder `/ (root)`, lalu **Save**.
5. Tunggu 1-2 menit, GitHub akan memberi alamat seperti: `https://namauser.github.io/nama-repo/`
6. Buka alamat itu di HP → install seperti langkah di atas.

> Catatan: repo **Private** tetap bisa dipakai dengan GitHub Pages jika akun Anda GitHub Pro, atau gunakan **GitHub Pages private** khusus organisasi. Untuk akun gratis, GitHub Pages dari repo private hanya bisa diakses jika Anda meng-upgrade, atau publish sebagai repo publik. Baca bagian keamanan di bawah sebelum memutuskan.

## ⚙️ Setup Pertama Kali (Sebagai Pemilik)
1. Saat pertama kali dibuka, aplikasi akan meminta Anda membuat **akun Pemilik** (nama toko, username, password).
2. Setelah masuk, buka **Pengaturan** untuk:
   - Mengisi/menyesuaikan **string QRIS** milik toko Anda (kolom ini sudah diisi otomatis dengan QRIS yang Anda berikan, edit jika perlu).
   - Memilih mode login kasir (Password atau PIN).
3. Buka **Akun Kasir** untuk menambahkan akun bagi karyawan/kasir Anda.
4. Buka **Produk** untuk mulai menambahkan barang dagangan.

## 🔒 Catatan Keamanan Password (WAJIB DIBACA)
- **Tidak ada satupun password yang ditulis di dalam kode program.** Password Pemilik/Kasir hanya dimasukkan sendiri melalui form saat setup/tambah akun.
- Password disimpan dalam bentuk **hash (PBKDF2-SHA256 + salt acak, 150.000 iterasi)** di `IndexedDB` milik browser di perangkat itu saja — bukan teks biasa, dan tidak pernah dikirim ke server manapun (aplikasi ini tidak punya server backend).
- Karena ini aplikasi *client-side* (semua kode HTML/JS/CSS-nya otomatis bisa dilihat siapapun yang membuka source code, seperti semua website), **jangan pernah menaruh password/kredensial apapun langsung di dalam file kode** — dan aplikasi ini memang sudah didesain agar tidak melakukan itu.
- Jika repo GitHub Anda **publik**, siapapun bisa melihat *source code* aplikasinya (yang memang tidak berisi password), tetapi **tidak bisa melihat data toko Anda** (produk, stok, transaksi, hash password) karena data itu hanya tersimpan di IndexedDB perangkat masing-masing kasir/pemilik, bukan di dalam repo.
- Untuk privasi maksimal, disarankan:
  - Gunakan repo **Private** di GitHub bila memungkinkan, agar orang lain tidak mudah menemukan link aplikasi Anda.
  - Jangan bagikan link aplikasi ke publik luas — cukup ke perangkat kasir Anda.
  - Rutin klik **"Unduh Cadangan"** di menu Pengaturan agar data tidak hilang bila HP/browser di-reset (data IndexedDB akan hilang bila cache browser dibersihkan/uninstall).
  - Ganti password Pemilik secara berkala lewat menu Pengaturan.

## 💳 Tentang Pembayaran QRIS
- Aplikasi ini membuat **QRIS dinamis** (nominal otomatis terisi) dari **QRIS statis** milik toko Anda, memakai algoritma standar EMVCo yang dipakai QRIS Indonesia (TLV + CRC16).
- Karena ini aplikasi mandiri (bukan terhubung ke sistem bank/PJSP), **konfirmasi pembayaran QRIS dilakukan manual** oleh kasir — pastikan notifikasi dana masuk sudah diterima (lewat aplikasi mobile banking/e-wallet Anda) sebelum menekan tombol "Pembayaran Diterima".

## 🗂️ Struktur File
```
├── index.html          # Kerangka semua layar
├── manifest.json        # Konfigurasi PWA
├── sw.js                 # Service worker (offline)
├── css/style.css         # Tema visual
├── js/db.js              # Lapisan IndexedDB
├── js/auth.js            # Hashing & sesi login
├── js/qris.js            # Konversi QRIS statis → dinamis
├── js/app.js             # Logika seluruh aplikasi
└── icons/                # Ikon PWA berbagai ukuran
```

## 🖨️ Cetak Struk
Tombol "Cetak Struk" memakai fungsi print browser (`window.print()`) dengan tata letak 80mm — kompatibel dengan print dialog biasa maupun printer thermal yang sudah ter-install sebagai printer default di perangkat.

## 📶 Mode Offline
Setelah aplikasi dibuka sekali dengan koneksi internet (untuk memuat font & library QR/scanner), Service Worker akan menyimpan cache sehingga aplikasi tetap bisa dibuka tanpa internet. Fitur scan kamera & generate QR tetap butuh library yang sudah ter-cache.

---
Dibuat khusus untuk **Warung BEJO** — Mudah, Cepat, Terpercaya.

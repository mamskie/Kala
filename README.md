# Kala

Galeri foto di atas peta Jawa dan pulau-pulau yang termasuk wilayah administratifnya, termasuk Madura. Tanpa konfigurasi Firebase, foto mode demo disimpan di IndexedDB di browser yang sama.

## Firebase dan Vercel

1. Firebase Auth dan Firestore menggunakan proyek `kala-me`. Terapkan aturan akses dari repo dengan `npx firebase-tools deploy --only firestore:rules --project kala-me` menggunakan akun yang punya izin. Aturan juga bisa dipublikasikan dari tab Rules di Firebase Console.
2. Impor repo ke Vercel. Konfigurasi buildless di `vercel.json` menyajikan `dist` dan fungsi `/api/photo`.
3. Di Vercel, hubungkan satu **Vercel Blob store dengan akses Private**. Pastikan `BLOB_READ_WRITE_TOKEN` tersedia untuk lingkungan Preview dan Production yang akan dipakai. Vercel menyediakan token ketika store disambungkan. Token hanya digunakan oleh fungsi server.
4. Deploy Preview, lalu tambahkan hostname Preview ke **Authentication → Settings → Authorized domains** di Firebase.
5. Uji masuk dengan dua akun, unggah, buka album privat, tandai satu foto publik, terbitkan galeri, dan cek bahwa akses publik berhenti saat foto diprivatkan atau dipindahkan ke tong sampah.

Firebase Cloud Storage dan paket Blaze tidak diperlukan untuk penyimpanan foto. Foto hasil kompresi dibatasi 4 MiB agar bisa dikirim lewat fungsi Vercel.

Galeri yang diterbitkan menampilkan interaksi bagi pengunjung yang sudah masuk. Tayangan unik dihitung sekali per akun per galeri, di luar kunjungan pemilik. Suka bisa dibatalkan. Panel memuat 20 komentar terbaru dan jumlah seluruh komentar. Mode Peta saja tetap berupa tautan tanpa interaksi akun.

## Tautan dan subdomain

Foto bersifat privat secara default. Pengunjung tanpa login hanya melihat wilayah yang ditandai. Pengunjung yang masuk bisa melihat foto dengan opsi “Tampilkan di galeri publik” dan meminta akses ke foto privat. Pemilik bisa menyetujui, menolak, atau mencabut akses melalui **Permintaan akses** di beranda. Persetujuan berlaku pada seluruh foto privat di galeri, termasuk foto baru. API foto memeriksa izin pada setiap permintaan.

Setelah aturan Firestore dan aplikasi diperbarui, pemilik galeri lama perlu membuka beranda dengan akun Google mereka sekali agar penanda wilayah tersinkronisasi. Uji tautan yang sama saat tanpa login, sebagai pengunjung, setelah persetujuan, dan setelah pencabutan.

Foto yang masuk tong sampah dapat dipulihkan selama 30 hari. Pada mode demo, aplikasi membersihkan foto kedaluwarsa saat demo dibuka. Pembersihan fisik objek Blob dan dokumen `trashedPhotos` yang kedaluwarsa memerlukan pekerjaan admin terjadwal. Aturan Firebase menutup pemulihan setelah masa tersebut.

Tanpa domain induk, tombol bagikan menghasilkan `/?galeri=nama`. Untuk `nama.kala.example.com`, hubungkan domain wildcard ke proyek Vercel dan isi `galleryDomain` dengan `kala.example.com`. Semua host galeri harus menyajikan aplikasi dan fungsi foto dari proyek yang sama. Login berlangsung di domain utama.

## Data peta

Data mencakup 119 kabupaten dan kota di Banten, Jakarta, Jawa Barat, Jawa Tengah, DI Yogyakarta, dan Jawa Timur. Data berasal dari [KPU OSM Boundaries, versi 2026-10-10b](https://github.com/ahsa29/kpu-osm-boundaries-2026), berdasarkan OpenStreetMap. Geometri disederhanakan dengan Mapshaper menggunakan interval 35 meter. ID album Jawa dari versi sebelumnya dipertahankan.

Peta dunia memakai [Natural Earth Admin 0 Countries 1:110m](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/). Provinsi Indonesia yang masih terkunci berasal dari peta nasional pada sumber OSM yang sama. Data gabungan tersedia di `dist/world.json`.

Saat Firebase aktif, pengajuan wilayah tersimpan di Firestore pada `regionRequests/{uid}/places/{place}` dan dapat dilihat melalui Firebase Console. Mode demo menyimpan pengajuan di browser.

© OpenStreetMap contributors. Data turunan tersedia sebagai `dist/regions.json` dengan [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).


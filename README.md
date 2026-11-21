# Atlas Kenangan

Galeri foto di atas peta Jawa dan pulau-pulau yang termasuk wilayah administratifnya, termasuk Madura. Tanpa konfigurasi Firebase, foto mode demo disimpan di IndexedDB di browser yang sama.

## Sambungkan Firebase

1. Daftarkan aplikasi Web di proyek Firebase. Isi konfigurasi Web yang ditampilkan Firebase Console di `dist/firebase-config.mjs`. Jangan gunakan kunci akun layanan.
2. Aktifkan Google di Authentication. Tambahkan domain aplikasi ke Authorized domains.
3. Buat Cloud Firestore default dan aktifkan Cloud Storage. Cloud Storage for Firebase memerlukan paket Blaze. Publikasikan rules dengan `firebase deploy --only firestore:rules,storage --project PROJECT_ID`. Beri izin lintas layanan Cloud Storage ke Firestore ketika diminta.
4. Setel CORS bucket untuk origin situs dan metode GET agar SDK dapat membaca foto sebagai Blob. Lihat https://firebase.google.com/docs/storage/web/download-files#cors_configuration.
5. Sajikan direktori `dist` dari HTTPS. Uji dua akun, penerbitan tautan publik, dan pencabutan akses.

## Tautan dan subdomain

Tanpa domain induk, tombol bagikan menghasilkan `/?galeri=nama`. Untuk `nama.atlas.example.com`, arahkan DNS wildcard ke hosting yang mendukung wildcard dan sertifikat TLS, lalu isi `galleryDomain` dengan `atlas.example.com`. Semua host galeri harus menyajikan direktori `dist` yang sama. Gunakan domain utama untuk login dan tambahkan CORS GET untuk origin galeri. Untuk subdomain arbitrer, konfigurasi CORS bucket dapat memakai origin `*` dengan SDK bearer token. Aturan Firebase tetap menentukan siapa yang dapat membaca foto.

## Data peta

Data mencakup 119 kabupaten dan kota di Banten, Jakarta, Jawa Barat, Jawa Tengah, DI Yogyakarta, dan Jawa Timur. Data berasal dari [KPU OSM Boundaries, versi 2026-10-10b](https://github.com/ahsa29/kpu-osm-boundaries-2026), berdasarkan OpenStreetMap. Geometri disederhanakan dengan Mapshaper menggunakan interval 35 meter. ID album Jawa dari versi sebelumnya dipertahankan.

Peta dunia memakai [Natural Earth Admin 0 Countries 1:110m](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/). Provinsi Indonesia yang masih terkunci berasal dari peta nasional pada sumber OSM yang sama. Data gabungan tersedia di `dist/world.json`.

Saat Firebase aktif, pengajuan wilayah tersimpan di Firestore pada `regionRequests/{uid}/places/{place}` dan dapat dilihat melalui Firebase Console. Mode demo menyimpan pengajuan di browser.

© OpenStreetMap contributors. Data turunan tersedia sebagai `dist/regions.json` dengan [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).


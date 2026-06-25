# TokoZyphra

TokoZyphra adalah aplikasi e-commerce responsif berbasis Express.js, EJS, dan MongoDB. Proyek ini menyediakan registrasi OTP email, CAPTCHA, katalog dan keranjang, checkout, voucher, dompet pengguna, produk digital maupun fisik, ulasan terverifikasi, panel administrator, serta pembayaran Pakasir.

## Fitur Utama

- Registrasi pengguna dengan email, kata sandi, CAPTCHA, dan OTP melalui Nodemailer.
- Login pengguna dan administrator terpisah dengan CAPTCHA.
- Katalog, pencarian, kategori, flash sale, keranjang, dan checkout.
- Produk digital, produk gratis, dan produk fisik dengan alamat pengiriman.
- Voucher persentase atau nominal dengan periode aktif, minimal transaksi, kuota global, dan batas per pengguna.
- Dompet pengguna, top-up Pakasir, riwayat saldo, penggunaan saldo saat checkout, dan refund pembatalan.
- Pembayaran QRIS atau Virtual Account melalui Pakasir.
- Webhook yang selalu memverifikasi ulang transaksi melalui Transaction Detail API.
- Rekonsiliasi pembayaran dan kedaluwarsa pesanan/top-up secara terjadwal.
- Ulasan hanya dari pengguna dengan pembelian yang telah selesai.
- Panel admin untuk produk, voucher, pesanan, pengguna, penyesuaian saldo, dan moderasi ulasan.
- Audit log tindakan administrator.
- Pagination pada katalog dan daftar data utama.
- Session MongoDB, CSRF signed-cookie, Helmet/CSP, rate limiting MongoDB, password hashing, session versioning, dan cookie aman.
- Operasi saldo, voucher, order, stok, refund, dan top-up menggunakan MongoDB transaction serta idempotency key.

## Persyaratan

- Node.js 20 atau lebih baru.
- MongoDB replica set, MongoDB Atlas, atau mongos.
- Akun SMTP untuk pengiriman OTP pada production.
- Proyek Pakasir untuk transaksi pembayaran production.

MongoDB standalone tidak aman untuk operasi finansial proyek ini. Checkout, refund, fulfillment, voucher, dan top-up membutuhkan transaction. Untuk pengembangan lokal, jalankan MongoDB sebagai single-node replica set atau gunakan MongoDB Atlas.

## Instalasi

```bash
npm ci
cp .env.example .env
```

Isi `.env`, lalu jalankan:

```bash
npm run seed
npm run dev
```

Aplikasi tersedia di `http://localhost:3000` secara default.

Pada development, OTP dicetak ke terminal apabila SMTP belum dikonfigurasi. SMTP wajib tersedia pada production.

## Konfigurasi Environment

Gunakan `.env.example` sebagai acuan. Konfigurasi utama:

- `MONGODB_URI`: koneksi MongoDB replica set atau Atlas.
- `SESSION_SECRET`: secret acak minimal 32 karakter.
- `SESSION_TTL_SECONDS`: masa aktif session dalam detik.
- `TRUST_PROXY_HOPS`: jumlah reverse proxy tepercaya; gunakan `0` untuk akses langsung lokal.
- `REQUIRE_MONGODB_TRANSACTIONS`: pemeriksaan dukungan transaction saat startup.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, dan `MAIL_FROM`.
- `PAKASIR_PROJECT_SLUG`, `PAKASIR_API_KEY`, dan `PAKASIR_DEFAULT_METHOD`.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, dan `ADMIN_NAME`.
- `JOB_SECRET` atau `CRON_SECRET`: secret minimal 32 karakter untuk endpoint rekonsiliasi.
- `ENABLE_INTERNAL_JOBS`: menjalankan scheduler di dalam proses Node.js.
- `INTERNAL_JOB_INTERVAL_MINUTES`: interval scheduler internal.

Jangan commit `.env` ke repository.

## Menjalankan MongoDB Replica Set Lokal

Contoh konfigurasi single-node replica set:

```bash
mongod --dbpath ./data --replSet rs0
```

Setelah MongoDB aktif, inisialisasi satu kali melalui `mongosh`:

```javascript
rs.initiate()
```

Gunakan URI seperti berikut:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/tokozyphra?replicaSet=rs0
```

## Seed Administrator

`npm run seed` memerlukan `ADMIN_EMAIL` dan `ADMIN_PASSWORD`. Password harus berjumlah 12–72 karakter serta memuat huruf dan angka. Tidak ada password admin default.

Seed tidak mengubah password admin yang sudah ada dan tidak akan mempromosikan akun pengguna biasa yang kebetulan memakai `ADMIN_EMAIL`. Untuk mereset password admin secara eksplisit:

```env
RESET_ADMIN_PASSWORD=true
```

Setelah reset selesai, hapus atau ubah kembali nilai tersebut menjadi `false`.

## Konfigurasi Pakasir

1. Buat proyek di dashboard Pakasir.
2. Masukkan slug proyek dan API key ke environment.
3. Atur webhook ke:

```text
https://domain-anda.example/webhooks/pakasir
```

4. Uji seluruh status pembayaran pada lingkungan sandbox sebelum production.

Body webhook tidak langsung dipercaya. Server mencari order/top-up lokal, memanggil Transaction Detail API, lalu mencocokkan project, nomor referensi, nominal, dan status transaksi sebelum fulfillment atau kredit saldo dilakukan.

## Rekonsiliasi Pembayaran

Jalankan rekonsiliasi manual dengan:

```bash
npm run reconcile-payments
```

Untuk server Node.js yang berjalan terus-menerus, scheduler internal dapat diaktifkan:

```env
ENABLE_INTERNAL_JOBS=true
INTERNAL_JOB_INTERVAL_MINUTES=5
```

Untuk serverless, gunakan scheduler eksternal yang memanggil endpoint berikut dengan metode GET atau POST:

```text
/internal/jobs/reconcile-payments
```

Kirim header:

```text
Authorization: Bearer <JOB_SECRET-atau-CRON_SECRET>
```

Jangan mengaktifkan scheduler internal pada banyak instance sekaligus. Operasi rekonsiliasi bersifat idempoten, tetapi satu scheduler terpusat tetap lebih efisien.

## Endpoint Kesehatan

- `/health` atau `/health/live`: memeriksa proses aplikasi tanpa menunggu database.
- `/health/ready`: memastikan koneksi database tersedia.

## Deployment

1. Simpan proyek pada repository privat atau terkontrol.
2. Jalankan `npm ci` pada proses build/deploy.
3. Tambahkan seluruh environment production.
4. Pastikan MongoDB mendukung transaction.
5. Jalankan seed administrator satu kali dari lingkungan aman.
6. Konfigurasikan webhook Pakasir.
7. Konfigurasikan scheduler rekonsiliasi eksternal untuk deployment serverless.
8. Jalankan health check dan pengujian sandbox sebelum menerima transaksi nyata.

Aplikasi mengekspor instance Express melalui `module.exports = app` pada `index.js`, sehingga dapat digunakan oleh platform Node.js maupun adapter serverless yang mendukung Express.

## Penyimpanan Gambar

Panel admin menggunakan URL gambar produk. Gunakan object storage atau CDN untuk gambar produk pada production.

Foto profil pengguna saat ini disimpan sebagai data gambar terkompresi di MongoDB dengan batas 400 KB. Session hanya menyimpan penanda keberadaan avatar, bukan isi gambarnya. Untuk skala besar, pindahkan avatar ke object storage.

## Pemeriksaan Proyek

```bash
npm run check
npm audit --omit=dev
```

`npm run check` memeriksa sintaks seluruh file JavaScript dan mengompilasi seluruh template EJS.

## Catatan Client Protection

`public/js/protect.js` hanya menjadi deterrent ringan untuk klik kanan dan shortcut tertentu. Mekanisme tersebut bukan kontrol keamanan dan dapat dinonaktifkan:

```env
ENABLE_CLIENT_PROTECTION=false
```

Seluruh keputusan sensitif tetap dilakukan di server. Jangan menaruh API key, OTP, harga final, atau rahasia bisnis di JavaScript frontend.

## Pengembangan Lanjutan

Untuk skala produksi yang lebih besar, gunakan object storage untuk avatar, layanan antrean untuk email dan job, observability terpusat, backup database teruji, 2FA administrator, refund gateway otomatis, serta pengujian integrasi terhadap sandbox Pakasir dan MongoDB replica set.

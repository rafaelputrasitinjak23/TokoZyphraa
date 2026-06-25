# TokoZyphra

Website ecommerce responsif berbasis **Express.js, EJS, dan MongoDB** dengan registrasi OTP email, CAPTCHA, panel admin, flash sale, diskon, voucher, dompet pengguna, ulasan terverifikasi, produk gratis, dan pembayaran Pakasir.

## Fitur

- Registrasi pengguna dengan email, kata sandi, CAPTCHA, dan OTP melalui Nodemailer.
- OTP hanya dipakai pada registrasi; login menggunakan email, kata sandi, dan CAPTCHA.
- Login administrator terpisah dengan CAPTCHA.
- Katalog, pencarian, kategori, detail produk, keranjang, dan checkout.
- Harga diskon dan flash sale berdasarkan periode aktif.
- Voucher persentase atau nominal, minimal transaksi, batas diskon, kuota, dan batas per pengguna.
- Dompet pengguna dan riwayat transaksi saldo; pembatalan pesanan mengembalikan saldo serta kuota voucher secara idempoten.
- Produk gratis tanpa membuka transaksi payment gateway.
- Integrasi Pakasir via API untuk QRIS dan Virtual Account.
- Webhook Pakasir yang memverifikasi ulang transaksi melalui Transaction Detail API.
- Ulasan hanya dari pengguna yang memiliki pesanan selesai.
- Panel admin untuk produk, voucher, pesanan, pengguna/dompet, dan moderasi ulasan.
- UI dark-premium yang responsif untuk desktop, tablet, dan mobile.
- CSRF, rate limiting, Helmet, password hashing, secure cookie, dan session store MongoDB.
- Pencegah klik kanan dan shortcut DevTools di browser sebagai deterrent ringan.
- Siap diekspor sebagai satu Express Function di Vercel.

## Persyaratan

- Node.js 20 atau lebih baru.
- MongoDB Atlas atau MongoDB replica set yang dapat diakses aplikasi.
- Akun SMTP untuk Nodemailer.
- Proyek Pakasir untuk pembayaran produksi.

## Instalasi Lokal

```bash
npm install
cp .env.example .env
```

Isi `.env`, kemudian:

```bash
npm run seed
npm run dev
```

Buka `http://localhost:3000`.

Pada mode development, apabila SMTP belum diisi, kode OTP dicetak ke terminal. Pada mode production, konfigurasi SMTP wajib tersedia.

## Variabel Environment

Lihat `.env.example`. Variabel yang paling penting:

- `MONGODB_URI`
- `SESSION_SECRET`
- `APP_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`
- `PAKASIR_PROJECT_SLUG`, `PAKASIR_API_KEY`, `PAKASIR_DEFAULT_METHOD`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`

Gunakan secret acak minimal 32 karakter untuk `SESSION_SECRET`. Jangan commit `.env`.

## Konfigurasi Pakasir

1. Buat proyek di dashboard Pakasir.
2. Salin **slug proyek** dan **API key** ke environment.
3. Isi webhook proyek Pakasir dengan:

```text
https://domain-anda.vercel.app/webhooks/pakasir
```

4. Gunakan mode sandbox untuk menguji alur pembayaran dan webhook.
5. Sistem tidak langsung mempercayai body webhook. Endpoint akan memanggil Transaction Detail API dan mencocokkan `project`, `order_id`, `amount`, dan `status`.

## Deployment ke Vercel

1. Push folder ini ke repository Git.
2. Import repository ke Vercel.
3. Tambahkan seluruh environment variable pada Project Settings → Environment Variables.
4. Deploy.
5. Jalankan seed satu kali dari mesin lokal yang memakai `MONGODB_URI` produksi, atau gunakan shell aman:

```bash
npm run seed
```

Express diekspor melalui `module.exports = app` pada `index.js`. Vercel mendeteksinya sebagai satu Express Function.

### MongoDB Atlas dan Vercel

Aplikasi memakai cache koneksi global agar koneksi Mongoose dapat digunakan kembali antar-invocation. Untuk deployment serverless tanpa private networking, Atlas mungkin memerlukan IP access `0.0.0.0/0`. Pilihan ini membuka akses jaringan secara luas; gunakan kredensial database yang kuat dan hak akses minimum. Private networking lebih aman bila tersedia.

## Penyimpanan Gambar

Panel admin menyimpan **URL gambar**, bukan upload file lokal. Filesystem Vercel bersifat sementara, sehingga gunakan layanan object storage/CDN seperti Cloudinary, S3, atau Vercel Blob dan masukkan URL hasil upload.

## Catatan Keamanan Anti-DevTools

`public/js/protect.js` memblokir klik kanan dan beberapa shortcut umum. Perlindungan ini tidak dapat mencegah pengguna teknis membuka DevTools, melihat request, atau mengambil asset yang sudah dikirim ke browser. Jangan menyimpan API key, logika pembayaran, harga final, OTP, atau rahasia bisnis di JavaScript frontend. Semua keputusan sensitif pada proyek ini dilakukan di server.

Untuk menonaktifkan deterrent tersebut:

```env
ENABLE_CLIENT_PROTECTION=false
```

## Pemeriksaan Proyek

```bash
npm run check
```

Perintah tersebut memeriksa sintaks seluruh JavaScript dan mengompilasi seluruh template EJS.

## Akun Admin

Akun admin dibuat oleh `npm run seed` menggunakan nilai `ADMIN_EMAIL` dan `ADMIN_PASSWORD`. Ganti password default sebelum seed dan jangan menggunakan kredensial contoh di produksi.

## Batasan yang Perlu Dikembangkan untuk Skala Besar

- Tambahkan layanan upload object storage langsung dari panel admin.
- Tambahkan email transaksi dan notifikasi fulfillment.
- Gunakan transaksi MongoDB untuk reservasi stok dengan volume tinggi.
- Tambahkan refund otomatis dan rekonsiliasi terjadwal.
- Tambahkan audit log administrator dan 2FA admin.
- Tambahkan kebijakan privasi, syarat layanan, dan proses penghapusan akun sesuai kebutuhan bisnis.

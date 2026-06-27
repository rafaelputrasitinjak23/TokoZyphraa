require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const validator = require('validator');
const { validateEnvironment } = require('../src/config/env');
const connectDatabase = require('../src/config/database');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const Voucher = require('../src/models/Voucher');

function validateAdminCredentials() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (!validator.isEmail(email)) throw new Error('ADMIN_EMAIL wajib berupa email yang valid.');
  if (password.length < 12 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('ADMIN_PASSWORD wajib 12–72 karakter dan memuat huruf serta angka.');
  }
  return { email, password };
}

async function seed() {
  validateEnvironment();
  const { email: adminEmail, password: adminPassword } = validateAdminCredentials();
  await connectDatabase();

  const existingAdmin = await User.findOne({ email: adminEmail });
  if (!existingAdmin) {
    await User.create({
      name: process.env.ADMIN_NAME || 'Administrator',
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 12),
      role: 'admin',
      emailVerifiedAt: new Date(),
      isActive: true
    });
  } else {
    if (existingAdmin.role !== 'admin') {
      throw new Error('ADMIN_EMAIL sudah digunakan oleh akun pengguna. Seed tidak akan mempromosikan akun pengguna secara otomatis.');
    }
    existingAdmin.name = process.env.ADMIN_NAME || existingAdmin.name || 'Administrator';
    existingAdmin.isActive = true;
    existingAdmin.emailVerifiedAt ||= new Date();
    if (process.env.RESET_ADMIN_PASSWORD === 'true') {
      existingAdmin.passwordHash = await bcrypt.hash(adminPassword, 12);
      existingAdmin.passwordChangedAt = new Date();
      existingAdmin.sessionVersion += 1;
    }
    await existingAdmin.save();
  }

  const now = Date.now();
  const products = [
    {
      name: 'Starter UI Kit Premium', slug: 'starter-ui-kit-premium', category: 'UI/UX',
      shortDescription: 'Kumpulan komponen modern untuk mempercepat pembuatan antarmuka.',
      description: 'UI kit digital dengan komponen dashboard, ecommerce, autentikasi, dan landing page. Cocok untuk kebutuhan personal maupun komersial sesuai lisensi toko.',
      imageUrl: '/images/product-placeholder.svg', price: 85000, discountPercent: 20, stock: 100,
      isActive: true, isFeatured: true, deliveryType: 'digital',
      fulfillmentContent: 'Tautan unduhan demo: https://example.com/download/ui-kit\nGanti konten ini melalui panel admin sebelum produksi.'
    },
    {
      name: 'Template Landing Page SaaS', slug: 'template-landing-page-saas', category: 'Template',
      shortDescription: 'Template landing page responsif dengan desain modern dan conversion-focused.',
      description: 'Template siap pakai untuk produk SaaS, aplikasi, dan layanan digital. Struktur halaman mencakup hero, fitur, harga, testimoni, FAQ, serta CTA.',
      imageUrl: '/images/product-placeholder.svg', price: 65000, discountPercent: 10, stock: 80,
      isActive: true, isFeatured: true, deliveryType: 'digital',
      fulfillmentContent: 'Tautan akses produk akan diletakkan di sini oleh admin.'
    },
    {
      name: 'Flash Sale Asset Creator Pack', slug: 'flash-sale-asset-creator-pack', category: 'Asset Digital',
      shortDescription: 'Paket aset kreatif untuk konten media sosial dan promosi bisnis.',
      description: 'Berisi aset visual, template promosi, dan elemen desain yang mudah disesuaikan.',
      imageUrl: '/images/product-placeholder.svg', price: 120000, discountPercent: 0, stock: 50,
      isActive: true, isFeatured: true, isFlashSale: true, flashSalePrice: 29000,
      flashSaleStart: new Date(now - 60 * 60 * 1000), flashSaleEnd: new Date(now + 23 * 60 * 60 * 1000),
      deliveryType: 'digital', fulfillmentContent: 'Konten akses flash sale. Ubah melalui panel admin.'
    },
    {
      name: 'Panduan Gratis Memulai Toko Digital', slug: 'panduan-gratis-toko-digital', category: 'Gratis',
      shortDescription: 'Panduan ringkas untuk menyusun katalog dan alur penjualan produk digital.',
      description: 'Produk gratis untuk mendemonstrasikan checkout tanpa payment gateway.',
      imageUrl: '/images/product-placeholder.svg', price: 0, discountPercent: 0, stock: 1000,
      isActive: true, isFeatured: true, deliveryType: 'digital',
      fulfillmentContent: 'Terima kasih. Ini adalah contoh konten produk gratis TokoRafael.'
    }
  ];

  for (const product of products) {
    await Product.findOneAndUpdate({ slug: product.slug }, product, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
  }

  await Voucher.findOneAndUpdate(
    { code: 'RAFAEL10' },
    {
      $setOnInsert: { usedCount: 0 },
      $set: {
        description: 'Diskon 10% untuk pengguna TokoRafael',
        type: 'percent', value: 10, minPurchase: 25000, maxDiscount: 50000,
        usageLimit: 1000, perUserLimit: 1, startsAt: new Date(now - 86400000),
        expiresAt: new Date(now + 365 * 86400000), isActive: true
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true }
  );

  console.log('Seed selesai.');
  console.log(`Admin: ${adminEmail}`);
  if (existingAdmin && process.env.RESET_ADMIN_PASSWORD !== 'true') {
    console.log('Password admin yang sudah ada tidak diubah. Set RESET_ADMIN_PASSWORD=true untuk meresetnya.');
  }
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

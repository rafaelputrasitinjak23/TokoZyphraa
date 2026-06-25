require('dotenv').config();
const dns = require('dns')

dns.setServers([
  '1.1.1.1',
  '8.8.8.8'
])
const bcrypt = require('bcryptjs');
const connectDatabase = require('../src/config/database');
const User = require('../src/models/User');
const Product = require('../src/models/Product');
const Voucher = require('../src/models/Voucher');

async function seed() {
  await connectDatabase();

  const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@tokozypra.local').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'GantiPasswordAdmin123!';
  await User.findOneAndUpdate(
    { email: adminEmail },
    {
      name: process.env.ADMIN_NAME || 'Administrator',
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 12),
      role: 'admin',
      emailVerifiedAt: new Date(),
      isActive: true
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

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
      fulfillmentContent: 'Terima kasih. Ini adalah contoh konten produk gratis TokoZyphra.'
    }
  ];

  for (const product of products) {
    await Product.findOneAndUpdate({ slug: product.slug }, product, { upsert: true, new: true, setDefaultsOnInsert: true });
  }

  await Voucher.findOneAndUpdate(
    { code: 'ZYPHRA10' },
    {
      code: 'ZYPHRA10', description: 'Diskon 10% untuk pengguna TokoZyphra',
      type: 'percent', value: 10, minPurchase: 25000, maxDiscount: 50000,
      usageLimit: 1000, perUserLimit: 1, startsAt: new Date(now - 86400000),
      expiresAt: new Date(now + 365 * 86400000), isActive: true
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log('Seed selesai.');
  console.log(`Admin: ${adminEmail}`);
  console.log('Segera ganti ADMIN_PASSWORD sebelum menjalankan seed di produksi.');
  process.exit(0);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});

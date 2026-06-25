const express = require('express');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const validator = require('validator');
const User = require('../models/User');
const Product = require('../models/Product');
const Voucher = require('../models/Voucher');
const Order = require('../models/Order');
const Review = require('../models/Review');
const WalletTransaction = require('../models/WalletTransaction');
const { requireAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimits');
const { verifyCaptcha } = require('../utils/captcha');
const { completeOrder } = require('../services/orderFulfillment');
const { cancelPendingOrderSafely } = require('../services/orderCancellation');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function checkbox(value) {
  return value === 'on' || value === 'true' || value === '1';
}

function nullableNumber(value) {
  return value === '' || value == null ? null : Number(value);
}

function nullableDate(value) {
  return value ? new Date(value) : null;
}

router.get('/login', (req, res) => {
  if (req.session.user?.role === 'admin') return res.redirect('/admin');
  res.render('admin/login', { title: 'Login Administrator' });
});

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!verifyCaptcha(req, 'admin', req.body.captcha)) {
    req.flash('error', 'CAPTCHA tidak sesuai atau sudah kedaluwarsa.');
    return res.redirect('/admin/login');
  }

  const admin = validator.isEmail(email) ? await User.findOne({ email, role: 'admin', isActive: true }) : null;
  if (!admin || !await bcrypt.compare(password, admin.passwordHash)) {
    req.flash('error', 'Kredensial administrator tidak valid.');
    return res.redirect('/admin/login');
  }

  admin.lastLoginAt = new Date();
  await admin.save();
  req.session.regenerate((error) => {
    if (error) return res.status(500).send('Gagal membuat sesi.');
    req.session.user = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
    res.redirect('/admin');
  });
}));

router.use(requireAdmin);

router.get('/', asyncHandler(async (req, res) => {
  const [productCount, userCount, pendingCount, completedCount, revenueAgg, recentOrders] = await Promise.all([
    Product.countDocuments(),
    User.countDocuments({ role: 'user' }),
    Order.countDocuments({ status: 'pending' }),
    Order.countDocuments({ status: 'completed' }),
    Order.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, revenue: { $sum: '$payableAmount' } } }]),
    Order.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(8).lean()
  ]);
  res.render('admin/dashboard', {
    title: 'Admin Dashboard', productCount, userCount, pendingCount, completedCount,
    revenue: revenueAgg[0]?.revenue || 0, recentOrders
  });
}));

router.get('/products', asyncHandler(async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 }).lean();
  res.render('admin/products/index', { title: 'Kelola Produk', products });
}));

router.get('/products/new', (req, res) => res.render('admin/products/form', {
  title: 'Tambah Produk', product: null, action: '/admin/products'
}));

router.post('/products', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const slug = slugify(req.body.slug || name, { lower: true, strict: true, locale: 'id' });
  if (!name || !slug || !req.body.description || !Number.isFinite(Number(req.body.price))) {
    req.flash('error', 'Nama, slug, deskripsi, dan harga wajib diisi.');
    return res.redirect('/admin/products/new');
  }
  await Product.create({
    name, slug,
    shortDescription: String(req.body.shortDescription || '').trim(),
    description: String(req.body.description || '').trim(),
    category: String(req.body.category || 'Umum').trim(),
    imageUrl: String(req.body.imageUrl || '/images/product-placeholder.svg').trim(),
    price: Math.max(0, Number(req.body.price)),
    discountPercent: Math.min(100, Math.max(0, Number(req.body.discountPercent || 0))),
    stock: Math.max(0, Number(req.body.stock || 0)),
    isActive: checkbox(req.body.isActive),
    isFeatured: checkbox(req.body.isFeatured),
    isFlashSale: checkbox(req.body.isFlashSale),
    flashSalePrice: nullableNumber(req.body.flashSalePrice),
    flashSaleStart: nullableDate(req.body.flashSaleStart),
    flashSaleEnd: nullableDate(req.body.flashSaleEnd),
    deliveryType: req.body.deliveryType === 'physical' ? 'physical' : 'digital',
    fulfillmentContent: String(req.body.fulfillmentContent || '').trim()
  });
  req.flash('success', 'Produk berhasil ditambahkan.');
  res.redirect('/admin/products');
}));

router.get('/products/:id/edit', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) return res.sendStatus(404);
  res.render('admin/products/form', { title: 'Edit Produk', product, action: `/admin/products/${product._id}?_method=PUT` });
}));

router.put('/products/:id', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const slug = slugify(req.body.slug || name, { lower: true, strict: true, locale: 'id' });
  await Product.findByIdAndUpdate(req.params.id, {
    name, slug,
    shortDescription: String(req.body.shortDescription || '').trim(),
    description: String(req.body.description || '').trim(),
    category: String(req.body.category || 'Umum').trim(),
    imageUrl: String(req.body.imageUrl || '/images/product-placeholder.svg').trim(),
    price: Math.max(0, Number(req.body.price || 0)),
    discountPercent: Math.min(100, Math.max(0, Number(req.body.discountPercent || 0))),
    stock: Math.max(0, Number(req.body.stock || 0)),
    isActive: checkbox(req.body.isActive),
    isFeatured: checkbox(req.body.isFeatured),
    isFlashSale: checkbox(req.body.isFlashSale),
    flashSalePrice: nullableNumber(req.body.flashSalePrice),
    flashSaleStart: nullableDate(req.body.flashSaleStart),
    flashSaleEnd: nullableDate(req.body.flashSaleEnd),
    deliveryType: req.body.deliveryType === 'physical' ? 'physical' : 'digital',
    fulfillmentContent: String(req.body.fulfillmentContent || '').trim()
  }, { runValidators: true });
  req.flash('success', 'Produk berhasil diperbarui.');
  res.redirect('/admin/products');
}));

router.delete('/products/:id', asyncHandler(async (req, res) => {
  await Product.findByIdAndUpdate(req.params.id, { isActive: false });
  req.flash('success', 'Produk dinonaktifkan.');
  res.redirect('/admin/products');
}));

router.get('/vouchers', asyncHandler(async (req, res) => {
  const vouchers = await Voucher.find().sort({ createdAt: -1 }).lean();
  res.render('admin/vouchers/index', { title: 'Kelola Voucher', vouchers });
}));

router.get('/vouchers/new', (req, res) => res.render('admin/vouchers/form', {
  title: 'Tambah Voucher', voucher: null, action: '/admin/vouchers'
}));

router.post('/vouchers', asyncHandler(async (req, res) => {
  await Voucher.create({
    code: String(req.body.code || '').trim().toUpperCase(),
    description: String(req.body.description || '').trim(),
    type: req.body.type === 'fixed' ? 'fixed' : 'percent',
    value: Math.max(0, Number(req.body.value || 0)),
    minPurchase: Math.max(0, Number(req.body.minPurchase || 0)),
    maxDiscount: nullableNumber(req.body.maxDiscount),
    usageLimit: nullableNumber(req.body.usageLimit),
    perUserLimit: Math.max(1, Number(req.body.perUserLimit || 1)),
    startsAt: nullableDate(req.body.startsAt) || new Date(),
    expiresAt: nullableDate(req.body.expiresAt),
    isActive: checkbox(req.body.isActive)
  });
  req.flash('success', 'Voucher berhasil ditambahkan.');
  res.redirect('/admin/vouchers');
}));

router.get('/vouchers/:id/edit', asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id).lean();
  if (!voucher) return res.sendStatus(404);
  res.render('admin/vouchers/form', { title: 'Edit Voucher', voucher, action: `/admin/vouchers/${voucher._id}?_method=PUT` });
}));

router.put('/vouchers/:id', asyncHandler(async (req, res) => {
  await Voucher.findByIdAndUpdate(req.params.id, {
    code: String(req.body.code || '').trim().toUpperCase(),
    description: String(req.body.description || '').trim(),
    type: req.body.type === 'fixed' ? 'fixed' : 'percent',
    value: Math.max(0, Number(req.body.value || 0)),
    minPurchase: Math.max(0, Number(req.body.minPurchase || 0)),
    maxDiscount: nullableNumber(req.body.maxDiscount),
    usageLimit: nullableNumber(req.body.usageLimit),
    perUserLimit: Math.max(1, Number(req.body.perUserLimit || 1)),
    startsAt: nullableDate(req.body.startsAt) || new Date(),
    expiresAt: nullableDate(req.body.expiresAt),
    isActive: checkbox(req.body.isActive)
  }, { runValidators: true });
  req.flash('success', 'Voucher berhasil diperbarui.');
  res.redirect('/admin/vouchers');
}));

router.delete('/vouchers/:id', asyncHandler(async (req, res) => {
  await Voucher.findByIdAndUpdate(req.params.id, { isActive: false });
  req.flash('success', 'Voucher dinonaktifkan.');
  res.redirect('/admin/vouchers');
}));

router.get('/orders', asyncHandler(async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  const orders = await Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).limit(300).lean();
  res.render('admin/orders', { title: 'Kelola Pesanan', orders, selectedStatus: req.query.status || '' });
}));

router.post('/orders/:id/status', asyncHandler(async (req, res) => {
  const allowed = ['pending', 'paid', 'completed', 'cancelled', 'expired', 'manual_review'];
  if (!allowed.includes(req.body.status)) return res.sendStatus(400);
  const order = await Order.findById(req.params.id);
  if (!order) return res.sendStatus(404);
  if (req.body.status === 'completed') await completeOrder(order);
  else if (['cancelled', 'expired'].includes(req.body.status)) {
    await cancelPendingOrderSafely(order, req.body.status, String(req.body.notes || '').trim());
  } else {
    order.status = req.body.status;
    order.notes = String(req.body.notes || order.notes || '').trim();
    await order.save();
  }
  req.flash('success', 'Status pesanan diperbarui.');
  res.redirect('/admin/orders');
}));

router.get('/users', asyncHandler(async (req, res) => {
  const users = await User.find({ role: 'user' }).sort({ createdAt: -1 }).limit(300).lean();
  res.render('admin/users', { title: 'Kelola Pengguna', users });
}));

router.post('/users/:id/wallet', asyncHandler(async (req, res) => {
  const amount = Math.floor(Math.abs(Number(req.body.amount || 0)));
  const type = req.body.type === 'debit' ? 'debit' : 'credit';
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
    req.flash('error', 'Nominal penyesuaian dompet tidak valid.');
    return res.redirect('/admin/users');
  }
  const delta = type === 'credit' ? amount : -amount;
  const filter = type === 'debit' ? { _id: req.params.id, walletBalance: { $gte: amount } } : { _id: req.params.id };
  const user = await User.findOneAndUpdate(filter, { $inc: { walletBalance: delta } }, { new: true });
  if (!user) {
    req.flash('error', 'Saldo pengguna tidak mencukupi atau pengguna tidak ditemukan.');
    return res.redirect('/admin/users');
  }
  await WalletTransaction.create({
    user: user._id, type, amount, balanceAfter: user.walletBalance,
    source: 'admin', reference: `ADMIN:${req.session.user.id}`,
    note: String(req.body.note || 'Penyesuaian oleh admin').trim()
  });
  req.flash('success', 'Saldo dompet pengguna berhasil diperbarui.');
  res.redirect('/admin/users');
}));

router.post('/users/:id/toggle', asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'user' });
  if (!user) return res.sendStatus(404);
  user.isActive = !user.isActive;
  await user.save();
  req.flash('success', `Akun pengguna ${user.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
  res.redirect('/admin/users');
}));

router.get('/reviews', asyncHandler(async (req, res) => {
  const reviews = await Review.find().populate('user', 'name email').populate('product', 'name slug').sort({ createdAt: -1 }).limit(300).lean();
  res.render('admin/reviews', { title: 'Moderasi Ulasan', reviews });
}));

router.post('/reviews/:id/toggle', asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) return res.sendStatus(404);
  review.isPublished = !review.isPublished;
  await review.save();
  const stats = await Review.aggregate([
    { $match: { product: review.product, isPublished: true } },
    { $group: { _id: '$product', average: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
  await Product.updateOne({ _id: review.product }, { averageRating: stats[0]?.average || 0, reviewCount: stats[0]?.count || 0 });
  req.flash('success', 'Status ulasan diperbarui.');
  res.redirect('/admin/reviews');
}));

module.exports = router;

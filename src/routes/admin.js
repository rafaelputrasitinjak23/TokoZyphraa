const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const validator = require('validator');
const User = require('../models/User');
const Product = require('../models/Product');
const Voucher = require('../models/Voucher');
const Order = require('../models/Order');
const Review = require('../models/Review');
const WalletTopup = require('../models/WalletTopup');
const AdminAuditLog = require('../models/AdminAuditLog');
const { requireAdmin } = require('../middleware/auth');
const noStore = require('../middleware/noStore');
const { authLimiter } = require('../middleware/rateLimits');
const { verifyCaptcha } = require('../utils/captcha');
const { completeOrder } = require('../services/orderFulfillment');
const { cancelPendingOrderSafely } = require('../services/orderCancellation');
const { adjustWallet } = require('../services/walletService');
const { toggleReviewPublication } = require('../services/reviewService');
const { approveWalletTopup, rejectWalletTopup } = require('../services/walletTopupResolution');
const { checkbox, parseDate, parseInteger, parsePage } = require('../utils/input');
const { sessionUser, regenerateSession } = require('../utils/session');
const { ADMIN_PAGE_SIZE } = require('../constants/limits');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
router.use(noStore);

const ORDER_TRANSITIONS = Object.freeze({
  pending: new Set(['paid', 'completed', 'cancelled', 'expired', 'manual_review']),
  paid: new Set(['completed', 'manual_review']),
  manual_review: new Set(['completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
  expired: new Set()
});

function pagination(page, total, query = {}) {
  return { page, totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)), query };
}

function normalizeImageUrl(value) {
  const imageUrl = String(value || '/images/product-placeholder.svg').trim();
  if (imageUrl.startsWith('/')) return imageUrl;
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch (_) {}
  const error = new Error('URL gambar harus berupa path lokal atau URL HTTPS.');
  error.status = 400;
  throw error;
}

function productPayload(body) {
  const name = String(body.name || '').trim();
  const slug = slugify(body.slug || name, { lower: true, strict: true, locale: 'id' });
  const description = String(body.description || '').trim();
  if (name.length < 2 || name.length > 140 || !slug || description.length < 5 || description.length > 8000) {
    const error = new Error('Nama, slug, dan deskripsi produk tidak valid.');
    error.status = 400;
    throw error;
  }
  const payload = {
    name,
    slug,
    shortDescription: String(body.shortDescription || '').trim(),
    description,
    category: String(body.category || 'Umum').trim(),
    imageUrl: normalizeImageUrl(body.imageUrl),
    price: parseInteger(body.price, { name: 'Harga', min: 0, max: 1000000000 }),
    discountPercent: parseInteger(body.discountPercent || 0, { name: 'Diskon', min: 0, max: 100 }),
    stock: parseInteger(body.stock || 0, { name: 'Stok', min: 0, max: 100000000 }),
    isActive: checkbox(body.isActive),
    isFeatured: checkbox(body.isFeatured),
    isFlashSale: checkbox(body.isFlashSale),
    flashSalePrice: parseInteger(body.flashSalePrice, { name: 'Harga flash sale', min: 0, max: 1000000000, nullable: true }),
    flashSaleStart: parseDate(body.flashSaleStart, { name: 'Mulai flash sale', nullable: true }),
    flashSaleEnd: parseDate(body.flashSaleEnd, { name: 'Akhir flash sale', nullable: true }),
    deliveryType: body.deliveryType === 'physical' ? 'physical' : 'digital',
    fulfillmentContent: String(body.fulfillmentContent || '').trim()
  };
  if (payload.shortDescription.length > 220 || payload.category.length > 60 || payload.fulfillmentContent.length > 8000) {
    const error = new Error('Deskripsi singkat, kategori, atau konten fulfillment terlalu panjang.');
    error.status = 400;
    throw error;
  }
  if (payload.isFlashSale) {
    if (payload.flashSalePrice == null || !payload.flashSaleStart || !payload.flashSaleEnd || payload.flashSaleEnd <= payload.flashSaleStart) {
      const error = new Error('Flash sale aktif memerlukan harga, waktu mulai, dan waktu berakhir yang valid.');
      error.status = 400;
      throw error;
    }
  }
  return payload;
}

function voucherPayload(body) {
  const code = String(body.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    const error = new Error('Kode voucher harus terdiri dari 3–40 huruf kapital, angka, garis bawah, atau tanda hubung.');
    error.status = 400;
    throw error;
  }
  const startsAt = parseDate(body.startsAt || new Date(), { name: 'Waktu mulai' });
  const expiresAt = parseDate(body.expiresAt, { name: 'Waktu berakhir' });
  if (expiresAt <= startsAt) {
    const error = new Error('Waktu berakhir voucher harus setelah waktu mulai.');
    error.status = 400;
    throw error;
  }
  const type = body.type === 'fixed' ? 'fixed' : 'percent';
  const value = parseInteger(body.value, { name: 'Nilai voucher', min: 0, max: type === 'percent' ? 100 : 1000000000 });
  return {
    code,
    description: String(body.description || '').trim(),
    type,
    value,
    minPurchase: parseInteger(body.minPurchase || 0, { name: 'Minimal pembelian', min: 0, max: 1000000000 }),
    maxDiscount: parseInteger(body.maxDiscount, { name: 'Maksimal diskon', min: 0, max: 1000000000, nullable: true }),
    usageLimit: parseInteger(body.usageLimit, { name: 'Kuota total', min: 1, max: 100000000, nullable: true }),
    perUserLimit: parseInteger(body.perUserLimit || 1, { name: 'Batas per pengguna', min: 1, max: 1000 }),
    startsAt,
    expiresAt,
    isActive: checkbox(body.isActive)
  };
}

async function audit(req, action, targetType, targetId, details = {}) {
  await AdminAuditLog.create({
    admin: req.session.user.id,
    action,
    targetType,
    targetId: String(targetId),
    details,
    ip: req.ip
  });
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
  await regenerateSession(req);
  req.session.user = sessionUser(admin);
  res.redirect('/admin');
}));

router.use(requireAdmin);

router.get('/', asyncHandler(async (req, res) => {
  const [productCount, userCount, pendingCount, completedCount, revenueAgg, recentOrders] = await Promise.all([
    Product.countDocuments(),
    User.countDocuments({ role: 'user' }),
    Order.countDocuments({ status: 'pending' }),
    Order.countDocuments({ status: 'completed' }),
    Order.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, revenue: { $sum: { $add: ['$payableAmount', '$walletUsed'] } } } }
    ]),
    Order.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(8).lean()
  ]);
  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    productCount,
    userCount,
    pendingCount,
    completedCount,
    revenue: revenueAgg[0]?.revenue || 0,
    recentOrders
  });
}));

router.get('/products', asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const [products, total] = await Promise.all([
    Product.find().sort({ createdAt: -1 }).skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    Product.countDocuments()
  ]);
  res.render('admin/products/index', { title: 'Kelola Produk', products, pagination: pagination(page, total) });
}));

router.get('/products/new', (req, res) => res.render('admin/products/form', {
  title: 'Tambah Produk', product: null, action: '/admin/products'
}));

router.post('/products', asyncHandler(async (req, res) => {
  const product = await Product.create(productPayload(req.body));
  await audit(req, 'product.create', 'Product', product._id, { name: product.name });
  req.flash('success', 'Produk berhasil ditambahkan.');
  res.redirect('/admin/products');
}));

router.get('/products/:id/edit', asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) return res.sendStatus(404);
  res.render('admin/products/form', { title: 'Edit Produk', product, action: `/admin/products/${product._id}?_method=PUT` });
}));

router.put('/products/:id', asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, productPayload(req.body), { new: true, runValidators: true });
  if (!product) return res.sendStatus(404);
  await audit(req, 'product.update', 'Product', product._id, { name: product.name });
  req.flash('success', 'Produk berhasil diperbarui.');
  res.redirect('/admin/products');
}));

router.delete('/products/:id', asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!product) return res.sendStatus(404);
  await audit(req, 'product.disable', 'Product', product._id, { name: product.name });
  req.flash('success', 'Produk dinonaktifkan.');
  res.redirect('/admin/products');
}));

router.get('/vouchers', asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const [vouchers, total] = await Promise.all([
    Voucher.find().sort({ createdAt: -1 }).skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    Voucher.countDocuments()
  ]);
  res.render('admin/vouchers/index', { title: 'Kelola Voucher', vouchers, pagination: pagination(page, total) });
}));

router.get('/vouchers/new', (req, res) => res.render('admin/vouchers/form', {
  title: 'Tambah Voucher', voucher: null, action: '/admin/vouchers'
}));

router.post('/vouchers', asyncHandler(async (req, res) => {
  const voucher = await Voucher.create(voucherPayload(req.body));
  await audit(req, 'voucher.create', 'Voucher', voucher._id, { code: voucher.code });
  req.flash('success', 'Voucher berhasil ditambahkan.');
  res.redirect('/admin/vouchers');
}));

router.get('/vouchers/:id/edit', asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id).lean();
  if (!voucher) return res.sendStatus(404);
  res.render('admin/vouchers/form', { title: 'Edit Voucher', voucher, action: `/admin/vouchers/${voucher._id}?_method=PUT` });
}));

router.put('/vouchers/:id', asyncHandler(async (req, res) => {
  const existing = await Voucher.findById(req.params.id);
  if (!existing) return res.sendStatus(404);
  const payload = voucherPayload(req.body);
  if (existing.usedCount > 0 && payload.code !== existing.code) {
    req.flash('error', 'Kode voucher yang sudah pernah digunakan tidak dapat diubah.');
    return res.redirect(`/admin/vouchers/${existing._id}/edit`);
  }
  if (payload.usageLimit != null && payload.usageLimit < existing.usedCount) {
    req.flash('error', 'Kuota total tidak boleh lebih kecil dari jumlah penggunaan saat ini.');
    return res.redirect(`/admin/vouchers/${existing._id}/edit`);
  }
  Object.assign(existing, payload);
  await existing.save();
  await audit(req, 'voucher.update', 'Voucher', existing._id, { code: existing.code });
  req.flash('success', 'Voucher berhasil diperbarui.');
  res.redirect('/admin/vouchers');
}));

router.delete('/vouchers/:id', asyncHandler(async (req, res) => {
  const voucher = await Voucher.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!voucher) return res.sendStatus(404);
  await audit(req, 'voucher.disable', 'Voucher', voucher._id, { code: voucher.code });
  req.flash('success', 'Voucher dinonaktifkan.');
  res.redirect('/admin/vouchers');
}));

router.get('/orders', asyncHandler(async (req, res) => {
  const allowedStatuses = new Set(['pending', 'paid', 'completed', 'cancelled', 'expired', 'manual_review']);
  const selectedStatus = allowedStatuses.has(req.query.status) ? req.query.status : '';
  const filter = selectedStatus ? { status: selectedStatus } : {};
  const page = parsePage(req.query.page);
  const [orders, total] = await Promise.all([
    Order.find(filter).populate('user', 'name email').sort({ createdAt: -1 })
      .skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    Order.countDocuments(filter)
  ]);
  const ordersWithTransitions = orders.map((order) => ({
    ...order,
    allowedStatuses: [order.status, ...(ORDER_TRANSITIONS[order.status] || [])]
  }));
  res.render('admin/orders', {
    title: 'Kelola Pesanan',
    orders: ordersWithTransitions,
    selectedStatus,
    pagination: pagination(page, total, { status: selectedStatus })
  });
}));

router.post('/orders/:id/status', asyncHandler(async (req, res) => {
  const targetStatus = String(req.body.status || '');
  const order = await Order.findById(req.params.id);
  if (!order) return res.sendStatus(404);
  const previousStatus = order.status;
  if (targetStatus === order.status) {
    req.flash('success', 'Status pesanan tidak berubah.');
    return res.redirect('/admin/orders');
  }
  if (!ORDER_TRANSITIONS[order.status]?.has(targetStatus)) {
    req.flash('error', `Transisi status ${order.status} ke ${targetStatus} tidak diizinkan.`);
    return res.redirect('/admin/orders');
  }

  const notes = String(req.body.notes || '').trim().slice(0, 1000);
  if (order.payableAmount > 0 && !order.paidAt && ['paid', 'completed'].includes(targetStatus) && notes.length < 5) {
    req.flash('error', 'Catatan minimal 5 karakter wajib diisi untuk override pembayaran eksternal.');
    return res.redirect('/admin/orders');
  }

  let result = order;
  if (targetStatus === 'completed') {
    result = await completeOrder(order, order.paidAt || new Date(), notes);
  } else if (['cancelled', 'expired'].includes(targetStatus)) {
    result = await cancelPendingOrderSafely(order, targetStatus, notes);
  } else {
    order.status = targetStatus;
    if (targetStatus === 'paid') order.paidAt ||= new Date();
    if (notes) order.notes = `${order.notes || ''}\n${notes}`.trim();
    await order.save();
  }

  await audit(req, 'order.status', 'Order', order._id, { from: previousStatus, to: result.status, orderNumber: order.orderNumber });
  req.flash(result.status === targetStatus ? 'success' : 'error', result.status === targetStatus
    ? 'Status pesanan diperbarui.'
    : `Pesanan belum dapat diselesaikan dan berstatus ${result.status}.`);
  res.redirect('/admin/orders');
}));

router.get('/users', asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const filter = { role: 'user' };
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    User.countDocuments(filter)
  ]);
  const usersWithTokens = users.map((user) => ({ ...user, adjustmentToken: crypto.randomUUID() }));
  res.render('admin/users', { title: 'Kelola Pengguna', users: usersWithTokens, pagination: pagination(page, total) });
}));

router.post('/users/:id/wallet', asyncHandler(async (req, res) => {
  const amount = parseInteger(req.body.amount, { name: 'Nominal penyesuaian', min: 1, max: 100000000 });
  const type = req.body.type === 'debit' ? 'debit' : 'credit';
  const note = String(req.body.note || 'Penyesuaian oleh admin').trim().slice(0, 500);
  const adjustmentToken = String(req.body.adjustmentToken || '');
  if (!/^[a-f0-9-]{36}$/i.test(adjustmentToken)) {
    const error = new Error('Token penyesuaian saldo tidak valid. Muat ulang halaman pengguna.');
    error.status = 400;
    throw error;
  }
  const result = await adjustWallet({
    userId: req.params.id,
    amount,
    type,
    adminId: req.session.user.id,
    note,
    adjustmentToken
  });
  if (!result.duplicate) await audit(req, 'wallet.adjust', 'User', result.user._id, { type, amount, note });
  req.flash('success', result.duplicate ? 'Penyesuaian saldo tersebut sudah diproses.' : 'Saldo dompet pengguna berhasil diperbarui.');
  res.redirect('/admin/users');
}));

router.post('/users/:id/toggle', asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id, role: 'user' });
  if (!user) return res.sendStatus(404);
  user.isActive = !user.isActive;
  user.sessionVersion += 1;
  await user.save();
  await audit(req, 'user.toggle', 'User', user._id, { isActive: user.isActive });
  req.flash('success', `Akun pengguna ${user.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
  res.redirect('/admin/users');
}));


router.get('/topups', asyncHandler(async (req, res) => {
  const allowedStatuses = new Set(['pending', 'processing', 'completed', 'cancelled', 'expired', 'manual_review']);
  const selectedStatus = allowedStatuses.has(req.query.status) ? req.query.status : '';
  const filter = selectedStatus ? { status: selectedStatus } : {};
  const page = parsePage(req.query.page);
  const [topups, total] = await Promise.all([
    WalletTopup.find(filter).populate('user', 'name email').sort({ createdAt: -1 })
      .skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    WalletTopup.countDocuments(filter)
  ]);
  res.render('admin/topups', {
    title: 'Kelola Top Up',
    topups,
    selectedStatus,
    pagination: pagination(page, total, { status: selectedStatus })
  });
}));

router.post('/topups/:id/resolve', asyncHandler(async (req, res) => {
  const action = String(req.body.action || '');
  const note = String(req.body.note || '').trim().slice(0, 500);
  if (!['approve', 'reject'].includes(action) || note.length < 5) {
    req.flash('error', 'Pilih tindakan dan isi catatan minimal 5 karakter.');
    return res.redirect('/admin/topups?status=manual_review');
  }

  const topup = action === 'approve'
    ? await approveWalletTopup(req.params.id, note)
    : await rejectWalletTopup(req.params.id, note);
  if (!topup) return res.sendStatus(404);
  await audit(req, `topup.${action}`, 'WalletTopup', topup._id, {
    topupNumber: topup.topupNumber,
    amount: topup.amount,
    note
  });
  req.flash('success', action === 'approve' ? 'Top up disetujui dan saldo dikreditkan.' : 'Top up ditolak.');
  res.redirect('/admin/topups?status=manual_review');
}));

router.get('/reviews', asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const [reviews, total] = await Promise.all([
    Review.find().populate('user', 'name email').populate('product', 'name slug').sort({ createdAt: -1 })
      .skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    Review.countDocuments()
  ]);
  res.render('admin/reviews', { title: 'Moderasi Ulasan', reviews, pagination: pagination(page, total) });
}));

router.post('/reviews/:id/toggle', asyncHandler(async (req, res) => {
  const review = await toggleReviewPublication(req.params.id);
  if (!review) return res.sendStatus(404);
  await audit(req, 'review.toggle', 'Review', review._id, { isPublished: review.isPublished });
  req.flash('success', 'Status ulasan diperbarui.');
  res.redirect('/admin/reviews');
}));

module.exports = router;

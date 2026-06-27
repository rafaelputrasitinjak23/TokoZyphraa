const express = require('express');
const crypto = require('crypto');
const slugify = require('slugify');
const User = require('../models/User');
const Product = require('../models/Product');
const Voucher = require('../models/Voucher');
const Order = require('../models/Order');
const Review = require('../models/Review');
const WalletTopup = require('../models/WalletTopup');
const AdminAuditLog = require('../models/AdminAuditLog');
const SystemLock = require('../models/SystemLock');
const SupportTicket = require('../models/SupportTicket');
const { requireAdmin, requirePermission } = require('../middleware/auth');
const noStore = require('../middleware/noStore');
const { verifyCsrfRequest } = require('../middleware/common');
const { completeOrder } = require('../services/orderFulfillment');
const { cancelPendingOrderSafely } = require('../services/orderCancellation');
const { adjustWallet } = require('../services/walletService');
const { toggleReviewPublication } = require('../services/reviewService');
const { approveWalletTopup, rejectWalletTopup } = require('../services/walletTopupResolution');
const { createNotification } = require('../services/notificationService');
const { checkbox, parseDate, parseInteger, parsePage } = require('../utils/input');
const { ADMIN_PAGE_SIZE } = require('../constants/limits');
const { ADMIN_PERMISSIONS, normalizePermissions } = require('../constants/adminPermissions');
const asyncHandler = require('../utils/asyncHandler');
const { withMongoTransaction } = require('../utils/transaction');

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

const jakartaDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const jakartaDateLabelFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: '2-digit',
  month: 'short'
});

function jakartaDateParts(date) {
  return Object.fromEntries(
    jakartaDatePartsFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
}

function jakartaDateKey(date) {
  const parts = jakartaDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function jakartaDayStart(date) {
  const parts = jakartaDateParts(date);
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  ) - 7 * 60 * 60 * 1000);
}

function buildDailySalesSeries(rows, days, endDate) {
  const rowMap = new Map(rows.map((row) => [row._id, row]));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(endDate.getTime() - (days - 1 - index) * 24 * 60 * 60 * 1000);
    const key = jakartaDateKey(date);
    const row = rowMap.get(key);
    return {
      date: key,
      label: jakartaDateLabelFormatter.format(date),
      revenue: Number(row?.revenue || 0),
      orders: Number(row?.orders || 0)
    };
  });
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

function normalizeDigitalUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch (_) {}
  const error = new Error('Link file digital harus menggunakan URL HTTPS yang valid.');
  error.status = 400;
  throw error;
}

function productPayload(body, existingProduct = null) {
  const name = String(body.name || '').trim();
  const slug = slugify(body.slug || name, { lower: true, strict: true, locale: 'id' });
  const description = String(body.description || '').trim();
  if (name.length < 2 || name.length > 140 || !slug || description.length < 5 || description.length > 8000) {
    const error = new Error('Nama, slug, dan deskripsi produk tidak valid.');
    error.status = 400;
    throw error;
  }

  const deliveryType = body.deliveryType === 'physical' ? 'physical' : 'digital';
  const serialKeyEnabled = deliveryType === 'digital' && checkbox(body.serialKeyEnabled);
  const payload = {
    name,
    slug,
    shortDescription: String(body.shortDescription || '').trim(),
    description,
    category: String(body.category || 'Umum').trim(),
    imageUrl: normalizeImageUrl(body.imageUrl),
    price: parseInteger(body.price, { name: 'Harga', min: 0, max: 1000000000 }),
    discountPercent: parseInteger(body.discountPercent || 0, { name: 'Diskon', min: 0, max: 100 }),
    stock: serialKeyEnabled
      ? Number(existingProduct?.stock || 0)
      : parseInteger(body.stock || 0, { name: 'Stok', min: 0, max: 100000000 }),
    isActive: checkbox(body.isActive),
    isFeatured: checkbox(body.isFeatured),
    isFlashSale: checkbox(body.isFlashSale),
    flashSalePrice: parseInteger(body.flashSalePrice, { name: 'Harga flash sale', min: 0, max: 1000000000, nullable: true }),
    flashSaleStart: parseDate(body.flashSaleStart, { name: 'Mulai flash sale', nullable: true }),
    flashSaleEnd: parseDate(body.flashSaleEnd, { name: 'Akhir flash sale', nullable: true }),
    deliveryType,
    fulfillmentContent: String(body.fulfillmentContent || '').trim(),
    downloadLimit: parseInteger(body.downloadLimit || 5, { name: 'Batas unduhan', min: 0, max: 1000 }),
    serialKeyEnabled
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

  const removeAsset = deliveryType === 'physical' || checkbox(body.removeDigitalAsset);
  const submittedUrl = removeAsset ? '' : normalizeDigitalUrl(body.digitalFileUrl);
  const existingUrl = existingProduct?.digitalAssetType === 'url' ? existingProduct.digitalFileUrl : '';
  const digitalFileUrl = submittedUrl || (removeAsset ? '' : existingUrl);
  const digitalFileName = digitalFileUrl
    ? String(body.digitalFileName || existingProduct?.digitalFileName || 'Unduh produk').trim().slice(0, 255)
    : '';

  Object.assign(payload, {
    digitalAssetType: digitalFileUrl ? 'url' : 'none',
    digitalFileName,
    digitalFileUrl
  });

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

router.all('/login', (req, res) => {
  res.redirect(303, '/auth/login?next=/admin');
});

router.use(requireAdmin);

router.get('/', requirePermission('analytics'), asyncHandler(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const endDate = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startDate = new Date(jakartaDayStart(endDate).getTime() - (days - 1) * dayMs);
  const previousStart = new Date(startDate.getTime() - days * dayMs);

  const [
    productCount,
    userCount,
    newUserCount,
    pendingCount,
    completedCount,
    openTicketCount,
    revenueAgg,
    previousRevenueAgg,
    dailyRevenue,
    statusBreakdown,
    topProducts,
    paymentMethods,
    recentOrders
  ] = await Promise.all([
    Product.countDocuments(),
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: startDate } }),
    Order.countDocuments({ status: 'pending' }),
    Order.countDocuments({ status: 'completed' }),
    SupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    Order.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: startDate } } },
      { $group: { _id: null, revenue: { $sum: { $add: ['$payableAmount', '$walletUsed'] } }, orders: { $sum: 1 } } }
    ]),
    Order.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: previousStart, $lt: startDate } } },
      { $group: { _id: null, revenue: { $sum: { $add: ['$payableAmount', '$walletUsed'] } } } }
    ]),
    Order.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: 'Asia/Jakarta' } },
          revenue: { $sum: { $add: ['$payableAmount', '$walletUsed'] } },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]),
    Order.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: startDate } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          name: { $first: '$items.name' },
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' }
        }
      },
      { $sort: { quantity: -1 } },
      { $limit: 8 }
    ]),
    Order.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: startDate } } },
      { $group: { _id: { $ifNull: ['$paymentMethod', 'unknown'] }, count: { $sum: 1 }, revenue: { $sum: { $add: ['$payableAmount', '$walletUsed'] } } } },
      { $sort: { count: -1 } }
    ]),
    Order.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(8).lean()
  ]);

  const revenue = revenueAgg[0]?.revenue || 0;
  const previousRevenue = previousRevenueAgg[0]?.revenue || 0;
  const revenueGrowth = previousRevenue > 0
    ? Math.round(((revenue - previousRevenue) / previousRevenue) * 1000) / 10
    : revenue > 0 ? 100 : 0;
  const dailySalesSeries = buildDailySalesSeries(dailyRevenue, days, endDate);
  const salesChartJson = JSON.stringify(dailySalesSeries).replace(/</g, '\\u003c');

  res.render('admin/dashboard', {
    title: 'Dashboard Analitik',
    days,
    productCount,
    userCount,
    newUserCount,
    pendingCount,
    completedCount,
    openTicketCount,
    revenue,
    revenueGrowth,
    completedInPeriod: revenueAgg[0]?.orders || 0,
    dailyRevenue,
    salesChartJson,
    statusBreakdown,
    topProducts,
    paymentMethods,
    recentOrders
  });
}));

router.get('/products', requirePermission('products'), asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const [products, total] = await Promise.all([
    Product.find().sort({ createdAt: -1 }).skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    Product.countDocuments()
  ]);
  res.render('admin/products/index', { title: 'Kelola Produk', products, pagination: pagination(page, total) });
}));

router.get('/products/new', requirePermission('products'), (req, res) => res.render('admin/products/form', {
  title: 'Tambah Produk', product: null, action: '/admin/products'
}));

router.post(
  '/products',
  requirePermission('products'),
  verifyCsrfRequest,
  asyncHandler(async (req, res) => {
    const product = await Product.create(productPayload(req.body));
    await audit(req, 'product.create', 'Product', product._id, { name: product.name, digitalAssetType: product.digitalAssetType });
    req.flash('success', 'Produk berhasil ditambahkan.');
    res.redirect('/admin/products');
  })
);

router.get('/products/:id/edit', requirePermission('products'), asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).lean();
  if (!product) return res.sendStatus(404);
  res.render('admin/products/form', { title: 'Edit Produk', product, action: `/admin/products/${product._id}?_method=PUT` });
}));

router.put(
  '/products/:id',
  requirePermission('products'),
  verifyCsrfRequest,
  asyncHandler(async (req, res) => {
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.sendStatus(404);

    const payload = productPayload(req.body, existing);
    const product = await Product.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (product.serialKeyEnabled) {
      const SerialKey = require('../models/SerialKey');
      product.stock = await SerialKey.countDocuments({ product: product._id, status: 'available' });
      await product.save();
    }
    await audit(req, 'product.update', 'Product', product._id, { name: product.name, digitalAssetType: product.digitalAssetType });
    req.flash('success', 'Produk berhasil diperbarui.');
    res.redirect('/admin/products');
  })
);

router.delete('/products/:id', requirePermission('products'), asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!product) return res.sendStatus(404);
  await audit(req, 'product.disable', 'Product', product._id, { name: product.name });
  req.flash('success', 'Produk dinonaktifkan.');
  res.redirect('/admin/products');
}));

router.get('/vouchers', requirePermission('vouchers'), asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const [vouchers, total] = await Promise.all([
    Voucher.find().sort({ createdAt: -1 }).skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    Voucher.countDocuments()
  ]);
  res.render('admin/vouchers/index', { title: 'Kelola Voucher', vouchers, pagination: pagination(page, total) });
}));

router.get('/vouchers/new', requirePermission('vouchers'), (req, res) => res.render('admin/vouchers/form', {
  title: 'Tambah Voucher', voucher: null, action: '/admin/vouchers'
}));

router.post('/vouchers', requirePermission('vouchers'), asyncHandler(async (req, res) => {
  const voucher = await Voucher.create(voucherPayload(req.body));
  await audit(req, 'voucher.create', 'Voucher', voucher._id, { code: voucher.code });
  req.flash('success', 'Voucher berhasil ditambahkan.');
  res.redirect('/admin/vouchers');
}));

router.get('/vouchers/:id/edit', requirePermission('vouchers'), asyncHandler(async (req, res) => {
  const voucher = await Voucher.findById(req.params.id).lean();
  if (!voucher) return res.sendStatus(404);
  res.render('admin/vouchers/form', { title: 'Edit Voucher', voucher, action: `/admin/vouchers/${voucher._id}?_method=PUT` });
}));

router.put('/vouchers/:id', requirePermission('vouchers'), asyncHandler(async (req, res) => {
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

router.delete('/vouchers/:id', requirePermission('vouchers'), asyncHandler(async (req, res) => {
  const voucher = await Voucher.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!voucher) return res.sendStatus(404);
  await audit(req, 'voucher.disable', 'Voucher', voucher._id, { code: voucher.code });
  req.flash('success', 'Voucher dinonaktifkan.');
  res.redirect('/admin/vouchers');
}));

router.get('/orders', requirePermission('orders'), asyncHandler(async (req, res) => {
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

router.post('/orders/:id/status', requirePermission('orders'), asyncHandler(async (req, res) => {
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
    await createNotification({
      userId: order.user,
      type: 'order',
      title: 'Status pesanan diperbarui',
      message: `Pesanan ${order.orderNumber} sekarang berstatus ${targetStatus}.`,
      link: `/account/orders/${order.orderNumber}`,
      idempotencyKey: `order-admin-status:${order.orderNumber}:${targetStatus}:${order.updatedAt.getTime()}`
    });
  }

  await audit(req, 'order.status', 'Order', order._id, { from: previousStatus, to: result.status, orderNumber: order.orderNumber });
  req.flash(result.status === targetStatus ? 'success' : 'error', result.status === targetStatus
    ? 'Status pesanan diperbarui.'
    : `Pesanan belum dapat diselesaikan dan berstatus ${result.status}.`);
  res.redirect('/admin/orders');
}));

router.get('/users', requirePermission('users'), asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const [users, total] = await Promise.all([
    User.find().sort({ createdAt: -1 }).skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    User.countDocuments()
  ]);
  const usersWithTokens = users.map((user) => ({ ...user, adjustmentToken: crypto.randomUUID() }));
  res.render('admin/users', {
    title: 'Kelola Pengguna',
    users: usersWithTokens,
    currentAdminId: String(req.session.user.id),
    adminPermissions: ADMIN_PERMISSIONS,
    pagination: pagination(page, total)
  });
}));

router.post('/users/:id/wallet', requirePermission('wallet'), asyncHandler(async (req, res) => {
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

router.post('/users/:id/role', requirePermission('users'), asyncHandler(async (req, res) => {
  const targetRole = req.body.role === 'admin' ? 'admin' : 'user';
  const currentAdminId = String(req.session.user.id);
  if (String(req.params.id) === currentAdminId) {
    req.flash('error', 'Role akun yang sedang digunakan tidak dapat diubah dari sesi ini.');
    return res.redirect('/admin/users');
  }

  const result = await withMongoTransaction(async (session) => {
    await SystemLock.findOneAndUpdate(
      { _id: 'admin-role-management' },
      { $inc: { version: 1 } },
      { upsert: true, new: true, session, setDefaultsOnInsert: true }
    );

    const user = await User.findById(req.params.id).session(session);
    if (!user) return { notFound: true };
    if (user.role === targetRole) return { user, unchanged: true, previousRole: user.role };

    if (user.role === 'admin' && targetRole === 'user' && user.isActive) {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true }).session(session);
      if (activeAdminCount <= 1) return { blocked: true, message: 'Admin aktif terakhir tidak dapat diturunkan menjadi pengguna biasa.' };
    }

    const previousRole = user.role;
    user.role = targetRole;
    user.adminPermissions = targetRole === 'admin'
      ? (normalizePermissions(req.body.permissions).length ? normalizePermissions(req.body.permissions) : ADMIN_PERMISSIONS.map((item) => item.key))
      : [];
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    await user.save({ session });
    return { user, previousRole };
  });

  if (result.notFound) return res.sendStatus(404);
  if (result.blocked) {
    req.flash('error', result.message);
    return res.redirect('/admin/users');
  }
  if (result.unchanged) {
    req.flash('success', 'Role akun tersebut sudah sesuai.');
    return res.redirect('/admin/users');
  }

  await audit(req, 'user.role', 'User', result.user._id, { from: result.previousRole, to: result.user.role, permissions: result.user.adminPermissions });
  req.flash('success', result.user.role === 'admin'
    ? 'Pengguna berhasil dijadikan admin. Sesi aktif akun tersebut telah dicabut agar hak akses diperbarui.'
    : 'Akses admin berhasil dicabut. Sesi aktif akun tersebut telah dicabut.');
  res.redirect('/admin/users');
}));

router.post('/users/:id/permissions', requirePermission('users'), asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.session.user.id)) {
    req.flash('error', 'Permission akun admin yang sedang digunakan tidak dapat diubah dari sesi ini.');
    return res.redirect('/admin/users');
  }
  const permissions = normalizePermissions(req.body.permissions);
  if (!permissions.length) {
    req.flash('error', 'Pilih minimal satu permission untuk akun admin.');
    return res.redirect('/admin/users');
  }
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'admin' },
    { $set: { adminPermissions: permissions }, $inc: { sessionVersion: 1 } },
    { new: true, runValidators: true }
  );
  if (!user) return res.sendStatus(404);
  await audit(req, 'user.permissions', 'User', user._id, { permissions });
  req.flash('success', 'Permission admin diperbarui. Sesi aktif akun tersebut telah dicabut.');
  res.redirect('/admin/users');
}));

router.post('/users/:id/toggle', requirePermission('users'), asyncHandler(async (req, res) => {
  const currentAdminId = String(req.session.user.id);
  if (String(req.params.id) === currentAdminId) {
    req.flash('error', 'Akun yang sedang digunakan tidak dapat dinonaktifkan dari sesi ini.');
    return res.redirect('/admin/users');
  }

  const result = await withMongoTransaction(async (session) => {
    await SystemLock.findOneAndUpdate(
      { _id: 'admin-role-management' },
      { $inc: { version: 1 } },
      { upsert: true, new: true, session, setDefaultsOnInsert: true }
    );

    const user = await User.findById(req.params.id).session(session);
    if (!user) return { notFound: true };

    if (user.role === 'admin' && user.isActive) {
      const activeAdminCount = await User.countDocuments({ role: 'admin', isActive: true }).session(session);
      if (activeAdminCount <= 1) return { blocked: true, message: 'Admin aktif terakhir tidak dapat dinonaktifkan.' };
    }

    user.isActive = !user.isActive;
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    await user.save({ session });
    return { user };
  });

  if (result.notFound) return res.sendStatus(404);
  if (result.blocked) {
    req.flash('error', result.message);
    return res.redirect('/admin/users');
  }

  await audit(req, 'user.toggle', 'User', result.user._id, { isActive: result.user.isActive, role: result.user.role });
  req.flash('success', `Akun ${result.user.isActive ? 'diaktifkan' : 'dinonaktifkan'}.`);
  res.redirect('/admin/users');
}));


router.get('/topups', requirePermission('wallet'), asyncHandler(async (req, res) => {
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

router.post('/topups/:id/resolve', requirePermission('wallet'), asyncHandler(async (req, res) => {
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

router.get('/reviews', requirePermission('reviews'), asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const [reviews, total] = await Promise.all([
    Review.find().populate('user', 'name email').populate('product', 'name slug').sort({ createdAt: -1 })
      .skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).lean(),
    Review.countDocuments()
  ]);
  res.render('admin/reviews', { title: 'Moderasi Ulasan', reviews, pagination: pagination(page, total) });
}));

router.post('/reviews/:id/toggle', requirePermission('reviews'), asyncHandler(async (req, res) => {
  const review = await toggleReviewPublication(req.params.id);
  if (!review) return res.sendStatus(404);
  await audit(req, 'review.toggle', 'Review', review._id, { isPublished: review.isPublished });
  req.flash('success', 'Status ulasan diperbarui.');
  res.redirect('/admin/reviews');
}));

module.exports = router;

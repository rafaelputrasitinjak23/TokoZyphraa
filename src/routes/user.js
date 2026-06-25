const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const QRCode = require('qrcode');
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const WalletTransaction = require('../models/WalletTransaction');
const WalletTopup = require('../models/WalletTopup');
const { requireUser } = require('../middleware/auth');
const noStore = require('../middleware/noStore');
const { authLimiter, paymentLimiter } = require('../middleware/rateLimits');
const { cancelPendingOrderSafely } = require('../services/orderCancellation');
const { getTransactionDetail } = require('../services/pakasir');
const { verifyPakasirTransaction, pakasirCompletedAt } = require('../services/paymentVerification');
const { completeWalletTopup } = require('../services/walletTopup');
const { setupTopupPayment } = require('../services/paymentSetup');
const { createVerifiedReview } = require('../services/reviewService');
const { normalizePaymentMethod } = require('../constants/paymentMethods');
const { MAX_AVATAR_BYTES, MIN_TOPUP, MAX_TOPUP, TOPUP_PRESETS, DEFAULT_PAGE_SIZE } = require('../constants/limits');
const { parsePage } = require('../utils/input');
const { safeRefererPath } = require('../utils/redirect');
const { regenerateSession, sessionUser } = require('../utils/session');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
router.use(noStore);
router.use(requireUser);

function makeTopupNumber() {
  return `TZTOP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function getPurchaseStats(userId) {
  const [result] = await Order.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId) } },
    {
      $facet: {
        orderSummary: [
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              completedOrders: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
              pendingOrders: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } }
            }
          }
        ],
        purchaseSummary: [
          { $match: { status: 'completed' } },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$_id',
              orderValue: { $first: { $add: ['$payableAmount', '$walletUsed'] } },
              productCount: { $sum: '$items.quantity' },
              uniqueProducts: { $addToSet: '$items.product' }
            }
          },
          {
            $group: {
              _id: null,
              totalSpent: { $sum: '$orderValue' },
              totalProducts: { $sum: '$productCount' },
              productSets: { $push: '$uniqueProducts' }
            }
          },
          {
            $project: {
              _id: 0,
              totalSpent: 1,
              totalProducts: 1,
              uniqueProducts: {
                $size: {
                  $reduce: { input: '$productSets', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } }
                }
              }
            }
          }
        ]
      }
    }
  ]);

  const orderSummary = result?.orderSummary?.[0] || {};
  const purchaseSummary = result?.purchaseSummary?.[0] || {};
  return {
    totalOrders: orderSummary.totalOrders || 0,
    completedOrders: orderSummary.completedOrders || 0,
    pendingOrders: orderSummary.pendingOrders || 0,
    totalSpent: purchaseSummary.totalSpent || 0,
    totalProducts: purchaseSummary.totalProducts || 0,
    uniqueProducts: purchaseSummary.uniqueProducts || 0
  };
}

function decodeAvatarData(value) {
  const avatarData = String(value || '').trim();
  if (!avatarData) return '';
  const match = avatarData.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error('Format foto profil tidak didukung. Gunakan JPG, PNG, atau WebP.');
    error.status = 400;
    throw error;
  }

  const mime = match[1];
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    const error = new Error('Ukuran foto profil maksimal 400 KB setelah dikompresi.');
    error.status = 400;
    throw error;
  }

  const isJpeg = mime === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = mime === 'png' && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = mime === 'webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) {
    const error = new Error('Isi file foto profil tidak valid.');
    error.status = 400;
    throw error;
  }
  return `data:image/${mime};base64,${bytes.toString('base64')}`;
}

router.get('/', asyncHandler(async (req, res) => {
  const [user, recentOrders, purchaseStats] = await Promise.all([
    User.findById(req.session.user.id).select('name email phone bio walletBalance createdAt emailVerifiedAt').lean(),
    Order.find({ user: req.session.user.id }).sort({ createdAt: -1 }).limit(10).lean(),
    getPurchaseStats(req.session.user.id)
  ]);
  res.render('user/dashboard', { title: 'Dashboard Akun', user, recentOrders, purchaseStats });
}));

router.get('/avatar', asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.user.id).select('avatarData').lean();
  if (!user?.avatarData) return res.sendStatus(404);
  const match = user.avatarData.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.sendStatus(404);
  res.type(`image/${match[1]}`).set('Cache-Control', 'private, no-store').send(Buffer.from(match[2], 'base64'));
}));

router.get('/profile', asyncHandler(async (req, res) => {
  const [user, purchaseStats] = await Promise.all([
    User.findById(req.session.user.id).select('name email phone bio walletBalance createdAt emailVerifiedAt').lean(),
    getPurchaseStats(req.session.user.id)
  ]);
  res.render('user/profile', { title: 'Profil Saya', user, purchaseStats });
}));

router.post('/profile', asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.session.user.id, isActive: true });
  if (!user) {
    req.flash('error', 'Akun tidak ditemukan. Silakan masuk kembali.');
    return res.redirect('/auth/login');
  }

  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const bio = String(req.body.bio || '').trim();
  if (name.length < 2 || name.length > 80) {
    req.flash('error', 'Nama harus terdiri dari 2–80 karakter.');
    return res.redirect('/account/profile');
  }
  if (phone && !/^[0-9+()\-\s]{8,24}$/.test(phone)) {
    req.flash('error', 'Nomor telepon tidak valid.');
    return res.redirect('/account/profile');
  }
  if (bio.length > 250) {
    req.flash('error', 'Bio maksimal 250 karakter.');
    return res.redirect('/account/profile');
  }

  let avatarData = user.avatarData;
  if (String(req.body.removeAvatar || '') === '1') avatarData = '';
  else if (req.body.avatarData) {
    try {
      avatarData = decodeAvatarData(req.body.avatarData);
    } catch (error) {
      req.flash('error', error.message);
      return res.redirect('/account/profile');
    }
  }

  user.name = name;
  user.phone = phone;
  user.bio = bio;
  user.avatarData = avatarData;
  await user.save();
  req.session.user = sessionUser(user);
  req.flash('success', 'Profil berhasil diperbarui.');
  res.redirect('/account/profile');
}));

router.post('/password', authLimiter, asyncHandler(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const passwordConfirm = String(req.body.passwordConfirm || '');
  if (newPassword.length < 8 || newPassword.length > 72 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    req.flash('error', 'Kata sandi baru minimal 8 karakter dan harus memuat huruf serta angka.');
    return res.redirect('/account/profile#password');
  }
  if (newPassword !== passwordConfirm) {
    req.flash('error', 'Konfirmasi kata sandi baru tidak sama.');
    return res.redirect('/account/profile#password');
  }

  const user = await User.findOne({ _id: req.session.user.id, isActive: true });
  if (!user || !await bcrypt.compare(currentPassword, user.passwordHash)) {
    req.flash('error', 'Kata sandi saat ini tidak sesuai.');
    return res.redirect('/account/profile#password');
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    req.flash('error', 'Kata sandi baru harus berbeda dari kata sandi saat ini.');
    return res.redirect('/account/profile#password');
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.passwordChangedAt = new Date();
  user.sessionVersion += 1;
  await user.save();
  await regenerateSession(req);
  req.session.user = sessionUser(user);
  req.flash('success', 'Kata sandi berhasil diubah dan sesi lain telah dicabut.');
  res.redirect('/account/profile#password');
}));

router.get('/orders', asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const [orders, total] = await Promise.all([
    Order.find({ user: req.session.user.id }).sort({ createdAt: -1 })
      .skip((page - 1) * DEFAULT_PAGE_SIZE).limit(DEFAULT_PAGE_SIZE).lean(),
    Order.countDocuments({ user: req.session.user.id })
  ]);
  res.render('user/orders', {
    title: 'Pesanan Saya',
    orders,
    pagination: { page, totalPages: Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE)), query: {} }
  });
}));

router.get('/orders/:orderNumber', asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id }).lean();
  if (!order) {
    return res.status(404).render('error', {
      title: 'Pesanan Tidak Ditemukan', status: 404, message: 'Pesanan tidak tersedia.'
    });
  }
  const existingReviews = await Review.find({
    user: req.session.user.id,
    product: { $in: order.items.map((item) => item.product) }
  }).lean();
  const reviewed = new Set(existingReviews.map((review) => String(review.product)));
  res.render('user/order-detail', { title: order.orderNumber, order, reviewed });
}));

router.post('/orders/:orderNumber/cancel', asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id });
  if (!order || order.status !== 'pending') {
    req.flash('error', 'Pesanan ini tidak dapat dibatalkan.');
    return res.redirect('/account/orders');
  }
  await cancelPendingOrderSafely(order, 'cancelled', 'Dibatalkan oleh pengguna.');
  req.flash('success', 'Pesanan dibatalkan. Saldo dompet dan kuota voucher telah dikembalikan bila digunakan.');
  res.redirect(`/account/orders/${order.orderNumber}`);
}));

router.get('/wallet', asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const [user, transactions, topups, summaryRows] = await Promise.all([
    User.findById(userId).select('name email walletBalance').lean(),
    WalletTransaction.find({ user: userId }).sort({ createdAt: -1 }).limit(150).lean(),
    WalletTopup.find({ user: userId }).sort({ createdAt: -1 }).limit(25).lean(),
    WalletTransaction.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalCredit: { $sum: { $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0] } },
          totalDebit: { $sum: { $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0] } },
          totalTopup: { $sum: { $cond: [{ $eq: ['$source', 'topup'] }, '$amount', 0] } }
        }
      }
    ])
  ]);

  const enrichedTransactions = transactions.map((transaction) => ({
    ...transaction,
    historyKind: transaction.source === 'topup' ? 'topup' : transaction.type === 'debit' ? 'usage' : 'credit'
  }));
  res.render('user/wallet', {
    title: 'Dompet Saya',
    user,
    transactions: enrichedTransactions,
    topups,
    topupPresets: TOPUP_PRESETS,
    topupToken: crypto.randomUUID(),
    walletSummary: summaryRows[0] || { totalCredit: 0, totalDebit: 0, totalTopup: 0 }
  });
}));

router.post('/wallet/topup', paymentLimiter, asyncHandler(async (req, res) => {
  const amount = Number(req.body.amount);
  const paymentMethod = normalizePaymentMethod(req.body.paymentMethod);
  const requestToken = String(req.body.topupToken || '');
  if (!Number.isSafeInteger(amount) || amount < MIN_TOPUP || amount > MAX_TOPUP) {
    req.flash('error', 'Nominal top up harus antara Rp10.000 dan Rp10.000.000.');
    return res.redirect('/account/wallet#topup');
  }
  if (!/^[a-f0-9-]{32,80}$/i.test(requestToken)) {
    req.flash('error', 'Token top up tidak valid. Muat ulang halaman dompet.');
    return res.redirect('/account/wallet#topup');
  }

  let topup = await WalletTopup.findOne({ user: req.session.user.id, requestToken });
  if (!topup) {
    try {
      topup = await WalletTopup.create({
        topupNumber: makeTopupNumber(),
        requestToken,
        user: req.session.user.id,
        amount,
        paymentMethod
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      topup = await WalletTopup.findOne({ user: req.session.user.id, requestToken });
    }
  }

  if (topup.paymentSetupStatus !== 'ready') {
    try {
      await setupTopupPayment(topup, paymentMethod);
    } catch (error) {
      req.flash('error', 'Permintaan top up tersimpan, tetapi kanal pembayaran belum berhasil dibuat.');
    }
  }
  res.redirect(`/account/wallet/topup/${topup.topupNumber}`);
}));

router.get('/wallet/topup/:topupNumber', asyncHandler(async (req, res) => {
  const topup = await WalletTopup.findOne({ topupNumber: req.params.topupNumber, user: req.session.user.id }).lean();
  if (!topup) {
    return res.status(404).render('error', {
      title: 'Top Up Tidak Ditemukan', status: 404, message: 'Permintaan top up tidak tersedia.'
    });
  }
  const qrDataUrl = topup.paymentMethod === 'qris' && topup.paymentNumber
    ? await QRCode.toDataURL(topup.paymentNumber, { width: 320, margin: 1 })
    : null;
  res.render('user/topup-payment', { title: `Top Up ${topup.topupNumber}`, topup, qrDataUrl });
}));

router.post('/wallet/topup/:topupNumber/retry', paymentLimiter, asyncHandler(async (req, res) => {
  const topup = await WalletTopup.findOne({ topupNumber: req.params.topupNumber, user: req.session.user.id });
  if (!topup || !['pending', 'expired'].includes(topup.status) || topup.credited) {
    req.flash('error', 'Top up ini tidak dapat dibuat ulang.');
    return res.redirect('/account/wallet');
  }
  if (topup.paymentNumber && topup.status === 'pending' && (!topup.paymentExpiresAt || topup.paymentExpiresAt > new Date())) {
    req.flash('error', 'Kanal pembayaran top up saat ini masih aktif.');
    return res.redirect(`/account/wallet/topup/${topup.topupNumber}`);
  }
  const paymentMethod = normalizePaymentMethod(req.body.paymentMethod, normalizePaymentMethod(topup.paymentMethod));
  let targetTopup = topup;
  if (topup.status === 'expired') {
    targetTopup = await WalletTopup.create({
      topupNumber: makeTopupNumber(),
      requestToken: crypto.randomUUID(),
      user: req.session.user.id,
      amount: topup.amount,
      paymentMethod
    });
  }

  try {
    const result = await setupTopupPayment(targetTopup, paymentMethod);
    req.flash(result.inProgress ? 'error' : 'success', result.inProgress
      ? 'Pembuatan kanal pembayaran masih diproses.'
      : 'Kanal pembayaran top up berhasil dibuat.');
  } catch (error) {
    req.flash('error', `Kanal pembayaran top up belum berhasil dibuat: ${error.message}`);
  }
  res.redirect(`/account/wallet/topup/${targetTopup.topupNumber}`);
}));

router.post('/wallet/topup/:topupNumber/check', paymentLimiter, asyncHandler(async (req, res) => {
  const topup = await WalletTopup.findOne({ topupNumber: req.params.topupNumber, user: req.session.user.id });
  if (!topup) return res.sendStatus(404);
  if (topup.status === 'completed' && topup.credited) return res.redirect('/account/wallet');
  if (!topup.paymentNumber) {
    req.flash('error', 'Kanal pembayaran top up belum tersedia.');
    return res.redirect(`/account/wallet/topup/${topup.topupNumber}`);
  }

  const transaction = await getTransactionDetail({ orderId: topup.topupNumber, amount: topup.amount });
  if (!verifyPakasirTransaction(transaction, topup.topupNumber, topup.amount)) {
    const error = new Error('Detail transaksi Pakasir tidak cocok dengan top up.');
    error.status = 409;
    throw error;
  }
  if (transaction.status === 'completed') {
    const completed = await completeWalletTopup(topup, pakasirCompletedAt(transaction));
    if (completed.status === 'completed' && completed.credited) {
      req.flash('success', `Top up ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(topup.amount)} berhasil masuk ke dompet.`);
    } else {
      req.flash('error', 'Pembayaran top up terverifikasi, tetapi saldo memerlukan pemeriksaan admin.');
    }
    return res.redirect('/account/wallet');
  }
  req.flash('error', `Pembayaran top up belum selesai. Status saat ini: ${transaction.status || 'pending'}.`);
  res.redirect(`/account/wallet/topup/${topup.topupNumber}`);
}));

router.post('/reviews/:productId', asyncHandler(async (req, res) => {
  const rating = Number(req.body.rating);
  const comment = String(req.body.comment || '').trim();
  if (!mongoose.isValidObjectId(req.params.productId) || !Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length < 5 || comment.length > 1500) {
    req.flash('error', 'Rating atau isi ulasan tidak valid.');
    return res.redirect(safeRefererPath(req, '/account/orders'));
  }

  try {
    const result = await createVerifiedReview({
      userId: req.session.user.id,
      productId: req.params.productId,
      rating,
      comment
    });
    req.flash('success', 'Ulasan berhasil dikirim.');
    return res.redirect(`/account/orders/${result.order.orderNumber}`);
  } catch (error) {
    if (error.code === 11000) {
      req.flash('error', 'Anda sudah memberikan ulasan untuk produk ini.');
      return res.redirect('/account/orders');
    }
    if (error.status === 403) {
      req.flash('error', error.message);
      return res.redirect('/account/orders');
    }
    throw error;
  }
}));

module.exports = router;

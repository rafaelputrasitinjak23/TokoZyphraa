const express = require('express');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Product = require('../models/Product');
const WalletTransaction = require('../models/WalletTransaction');
const { requireUser } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimits');
const asyncHandler = require('../utils/asyncHandler');
const { cancelPendingOrderSafely } = require('../services/orderCancellation');

const router = express.Router();
const MAX_AVATAR_BYTES = 400 * 1024;

router.use(requireUser);

async function getPurchaseStats(userId) {
  const [stats] = await Order.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(userId),
        status: 'completed'
      }
    },
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
        completedOrders: { $sum: 1 },
        totalSpent: { $sum: '$orderValue' },
        totalProducts: { $sum: '$productCount' },
        productSets: { $push: '$uniqueProducts' }
      }
    },
    {
      $project: {
        _id: 0,
        completedOrders: 1,
        totalSpent: 1,
        totalProducts: 1,
        uniqueProducts: {
          $size: {
            $reduce: {
              input: '$productSets',
              initialValue: [],
              in: { $setUnion: ['$$value', '$$this'] }
            }
          }
        }
      }
    }
  ]);

  return stats || {
    completedOrders: 0,
    totalSpent: 0,
    totalProducts: 0,
    uniqueProducts: 0
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
  const isPng = mime === 'png'
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isWebp = mime === 'webp'
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!isJpeg && !isPng && !isWebp) {
    const error = new Error('Isi file foto profil tidak valid.');
    error.status = 400;
    throw error;
  }

  return `data:image/${mime};base64,${bytes.toString('base64')}`;
}

router.get('/', asyncHandler(async (req, res) => {
  const [user, recentOrders, purchaseStats] = await Promise.all([
    User.findById(req.session.user.id).lean(),
    Order.find({ user: req.session.user.id }).sort({ createdAt: -1 }).limit(5).lean(),
    getPurchaseStats(req.session.user.id)
  ]);

  res.render('user/dashboard', {
    title: 'Dashboard Akun',
    user,
    recentOrders,
    purchaseStats
  });
}));

router.get('/profile', asyncHandler(async (req, res) => {
  const [user, purchaseStats] = await Promise.all([
    User.findById(req.session.user.id).lean(),
    getPurchaseStats(req.session.user.id)
  ]);

  res.render('user/profile', {
    title: 'Profil Saya',
    user,
    purchaseStats
  });
}));

router.post('/profile', asyncHandler(async (req, res) => {
  const user = await User.findById(req.session.user.id);
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
  if (String(req.body.removeAvatar || '') === '1') {
    avatarData = '';
  } else if (req.body.avatarData) {
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

  req.session.user = {
    ...req.session.user,
    name: user.name,
    avatarData: user.avatarData || ''
  };

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

  const user = await User.findById(req.session.user.id);
  const currentPasswordValid = user && await bcrypt.compare(currentPassword, user.passwordHash);
  if (!currentPasswordValid) {
    req.flash('error', 'Kata sandi saat ini tidak sesuai.');
    return res.redirect('/account/profile#password');
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    req.flash('error', 'Kata sandi baru harus berbeda dari kata sandi saat ini.');
    return res.redirect('/account/profile#password');
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();

  req.flash('success', 'Kata sandi berhasil diubah.');
  res.redirect('/account/profile#password');
}));

router.get('/orders', asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.session.user.id }).sort({ createdAt: -1 }).lean();
  res.render('user/orders', { title: 'Pesanan Saya', orders });
}));

router.get('/orders/:orderNumber', asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id }).lean();
  if (!order) return res.status(404).render('error', { title: 'Pesanan Tidak Ditemukan', status: 404, message: 'Pesanan tidak tersedia.' });
  const existingReviews = await Review.find({ user: req.session.user.id, product: { $in: order.items.map((i) => i.product) } }).lean();
  const reviewed = new Set(existingReviews.map((r) => String(r.product)));
  res.render('user/order-detail', { title: order.orderNumber, order, reviewed });
}));

router.post('/orders/:orderNumber/cancel', asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id });
  if (!order || !['pending', 'expired'].includes(order.status)) {
    req.flash('error', 'Pesanan ini tidak dapat dibatalkan.');
    return res.redirect('/account/orders');
  }
  await cancelPendingOrderSafely(order, 'cancelled', 'Dibatalkan oleh pengguna.');
  req.flash('success', 'Pesanan dibatalkan. Saldo dompet dan kuota voucher telah dikembalikan bila digunakan.');
  res.redirect(`/account/orders/${order.orderNumber}`);
}));

router.get('/wallet', asyncHandler(async (req, res) => {
  const [user, transactions] = await Promise.all([
    User.findById(req.session.user.id).lean(),
    WalletTransaction.find({ user: req.session.user.id }).sort({ createdAt: -1 }).limit(100).lean()
  ]);
  res.render('user/wallet', { title: 'Dompet Saya', user, transactions });
}));

router.post('/reviews/:productId', asyncHandler(async (req, res) => {
  const rating = Number(req.body.rating);
  const comment = String(req.body.comment || '').trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length < 5 || comment.length > 1500) {
    req.flash('error', 'Rating atau isi ulasan tidak valid.');
    return res.redirect(req.get('referer') || '/account/orders');
  }

  const order = await Order.findOne({
    user: req.session.user.id,
    status: 'completed',
    'items.product': req.params.productId
  }).sort({ completedAt: -1 });
  if (!order) {
    req.flash('error', 'Ulasan hanya dapat diberikan setelah pembelian terverifikasi.');
    return res.redirect('/account/orders');
  }

  try {
    await Review.create({
      user: req.session.user.id,
      product: req.params.productId,
      order: order._id,
      rating,
      comment
    });
  } catch (error) {
    if (error.code === 11000) {
      req.flash('error', 'Anda sudah memberikan ulasan untuk produk ini.');
      return res.redirect(`/account/orders/${order.orderNumber}`);
    }
    throw error;
  }

  const stats = await Review.aggregate([
    { $match: { product: order.items.find((i) => String(i.product) === req.params.productId).product, isPublished: true } },
    { $group: { _id: '$product', average: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
  await Product.updateOne({ _id: req.params.productId }, {
    averageRating: stats[0]?.average || 0,
    reviewCount: stats[0]?.count || 0
  });
  req.flash('success', 'Ulasan berhasil dikirim.');
  res.redirect(`/account/orders/${order.orderNumber}`);
}));

module.exports = router;

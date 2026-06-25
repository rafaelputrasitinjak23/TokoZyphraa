const express = require('express');
const User = require('../models/User');
const Order = require('../models/Order');
const Review = require('../models/Review');
const Product = require('../models/Product');
const WalletTransaction = require('../models/WalletTransaction');
const { requireUser } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { cancelPendingOrderSafely } = require('../services/orderCancellation');

const router = express.Router();
router.use(requireUser);

router.get('/', asyncHandler(async (req, res) => {
  const [user, recentOrders, orderCount] = await Promise.all([
    User.findById(req.session.user.id).lean(),
    Order.find({ user: req.session.user.id }).sort({ createdAt: -1 }).limit(5).lean(),
    Order.countDocuments({ user: req.session.user.id })
  ]);
  res.render('user/dashboard', { title: 'Dashboard Akun', user, recentOrders, orderCount });
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

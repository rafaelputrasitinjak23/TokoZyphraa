const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const { requireUser } = require('../middleware/auth');
const noStore = require('../middleware/noStore');
const { paymentLimiter } = require('../middleware/rateLimits');
const { calculateProductPrice } = require('../utils/order');
const { normalizePaymentMethod } = require('../constants/paymentMethods');
const { normalizeCart, createCheckoutOrder } = require('../services/checkoutService');
const { setupOrderPayment } = require('../services/paymentSetup');
const { getTransactionDetail } = require('../services/pakasir');
const { verifyPakasirTransaction, pakasirCompletedAt } = require('../services/paymentVerification');
const { completeOrder } = require('../services/orderFulfillment');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
router.use(noStore);

async function buildCartPreview(sessionCart) {
  const normalized = normalizeCart(sessionCart);
  const ids = normalized.map((entry) => entry.productId);
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const map = new Map(products.map((product) => [String(product._id), product]));
  return normalized.map((entry) => {
    const product = map.get(entry.productId);
    if (!product || product.stock < entry.quantity) return null;
    const unitPrice = calculateProductPrice(product);
    return { product, quantity: entry.quantity, unitPrice, lineTotal: unitPrice * entry.quantity };
  }).filter(Boolean);
}

function fulfillmentFlash(req, result, successMessage) {
  if (result.status === 'completed') {
    req.flash('success', successMessage);
  } else {
    req.flash('error', 'Pembayaran terverifikasi, tetapi pesanan memerlukan pemeriksaan admin sebelum dapat diselesaikan.');
  }
}

router.get('/', requireUser, asyncHandler(async (req, res) => {
  let items;
  try {
    items = await buildCartPreview(req.session.cart);
  } catch (error) {
    req.flash('error', error.message);
    return res.redirect('/cart');
  }
  if (!items.length || items.length !== (req.session.cart || []).length) {
    req.flash('error', 'Keranjang berubah karena stok atau produk tidak lagi tersedia. Periksa kembali keranjang Anda.');
    return res.redirect('/cart');
  }
  const user = await User.findOne({ _id: req.session.user.id, isActive: true }).lean();
  if (!user) return req.session.destroy(() => res.redirect('/auth/login'));
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const requiresShipping = items.some((item) => item.product.deliveryType === 'physical');
  res.render('checkout', {
    title: 'Checkout',
    items,
    subtotal,
    user,
    requiresShipping,
    checkoutToken: crypto.randomUUID()
  });
}));

router.post('/', requireUser, paymentLimiter, asyncHandler(async (req, res) => {
  const paymentMethod = normalizePaymentMethod(req.body.paymentMethod);
  let result;
  try {
    result = await createCheckoutOrder({
      userId: req.session.user.id,
      cart: req.session.cart,
      voucherCode: req.body.voucherCode,
      useWallet: req.body.useWallet === 'on',
      paymentMethod,
      checkoutToken: req.body.checkoutToken,
      shippingInput: req.body
    });
  } catch (error) {
    req.flash('error', error.message);
    return res.redirect(error.status === 403 ? '/auth/login' : '/checkout');
  }

  const order = result.order;
  req.session.cart = [];

  if (!result.created) {
    if (order.payableAmount === 0 && order.status === 'pending') {
      const completed = await completeOrder(order);
      fulfillmentFlash(req, completed, 'Permintaan checkout yang sama sudah diproses dan pesanan telah diselesaikan.');
    } else {
      req.flash('success', 'Permintaan checkout yang sama sudah diproses.');
    }
    return res.redirect(order.payableAmount > 0
      ? `/checkout/payment/${order.orderNumber}`
      : `/account/orders/${order.orderNumber}`);
  }

  if (order.payableAmount === 0) {
    const completed = await completeOrder(order);
    fulfillmentFlash(req, completed, 'Pesanan berhasil diproses tanpa pembayaran tambahan.');
    return res.redirect(`/account/orders/${order.orderNumber}`);
  }

  try {
    await setupOrderPayment(order, paymentMethod);
  } catch (error) {
    req.flash('error', 'Pesanan tersimpan, tetapi kanal pembayaran belum berhasil dibuat. Gunakan tombol buat ulang pembayaran.');
  }
  res.redirect(`/checkout/payment/${order.orderNumber}`);
}));

router.get('/payment/:orderNumber', requireUser, asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id }).lean();
  if (!order) {
    return res.status(404).render('error', {
      title: 'Pesanan Tidak Ditemukan', status: 404, message: 'Pesanan tidak tersedia.'
    });
  }
  const isQris = order.paymentMethod === 'qris' && order.paymentNumber;
  const qrDataUrl = isQris ? await QRCode.toDataURL(order.paymentNumber, { width: 320, margin: 1 }) : null;
  res.render('payment', { title: `Pembayaran ${order.orderNumber}`, order, qrDataUrl });
}));

router.post('/payment/:orderNumber/retry', requireUser, paymentLimiter, asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id });
  if (!order || order.payableAmount <= 0 || order.status !== 'pending' || order.walletRefunded) {
    req.flash('error', 'Transaksi ini tidak dapat dibuat ulang. Buat pesanan baru jika transaksi sebelumnya telah kedaluwarsa.');
    return res.redirect('/account/orders');
  }

  if (order.paymentNumber && (!order.paymentExpiresAt || order.paymentExpiresAt > new Date())) {
    req.flash('error', 'Kanal pembayaran saat ini masih aktif.');
    return res.redirect(`/checkout/payment/${order.orderNumber}`);
  }

  const method = normalizePaymentMethod(req.body.paymentMethod, normalizePaymentMethod(order.paymentMethod));
  try {
    const result = await setupOrderPayment(order, method);
    req.flash(result.inProgress ? 'error' : 'success', result.inProgress
      ? 'Pembuatan kanal pembayaran masih diproses. Muat ulang halaman beberapa saat lagi.'
      : 'Kanal pembayaran berhasil dibuat.');
  } catch (error) {
    req.flash('error', `Kanal pembayaran belum berhasil dibuat: ${error.message}`);
  }
  res.redirect(`/checkout/payment/${order.orderNumber}`);
}));

router.post('/payment/:orderNumber/check', requireUser, paymentLimiter, asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id });
  if (!order) return res.sendStatus(404);
  if (order.status === 'completed') return res.redirect(`/account/orders/${order.orderNumber}`);
  if (!order.paymentNumber || order.payableAmount <= 0) {
    req.flash('error', 'Kanal pembayaran belum tersedia.');
    return res.redirect(`/checkout/payment/${order.orderNumber}`);
  }

  const transaction = await getTransactionDetail({ orderId: order.orderNumber, amount: order.payableAmount });
  if (!verifyPakasirTransaction(transaction, order.orderNumber, order.payableAmount)) {
    const error = new Error('Detail transaksi Pakasir tidak cocok dengan pesanan.');
    error.status = 409;
    throw error;
  }

  if (transaction.status === 'completed') {
    const completed = await completeOrder(order, pakasirCompletedAt(transaction));
    fulfillmentFlash(req, completed, 'Pembayaran telah terverifikasi dan pesanan selesai.');
    return res.redirect(`/account/orders/${order.orderNumber}`);
  }
  req.flash('error', `Pembayaran belum selesai. Status saat ini: ${transaction.status || 'pending'}.`);
  res.redirect(`/checkout/payment/${order.orderNumber}`);
}));

module.exports = router;

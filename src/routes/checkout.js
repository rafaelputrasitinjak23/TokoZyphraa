const express = require('express');
const QRCode = require('qrcode');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const Voucher = require('../models/Voucher');
const WalletTransaction = require('../models/WalletTransaction');
const { requireUser } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimits');
const { calculateProductPrice, makeOrderNumber } = require('../utils/order');
const { resolveVoucher } = require('../utils/voucher');
const { createTransaction, getTransactionDetail } = require('../services/pakasir');
const { completeOrder } = require('../services/orderFulfillment');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const allowedMethods = new Set([
  'qris', 'cimb_niaga_va', 'bni_va', 'sampoerna_va', 'bnc_va',
  'maybank_va', 'permata_va', 'atm_bersama_va', 'artha_graha_va', 'bri_va'
]);

async function buildCart(sessionCart) {
  const rawCart = sessionCart || [];
  const ids = rawCart.map((item) => item.productId);
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const map = new Map(products.map((p) => [String(p._id), p]));
  return rawCart.map((entry) => {
    const product = map.get(entry.productId);
    if (!product) return null;
    const quantity = Math.max(1, Math.min(10, Number(entry.quantity || 1)));
    const unitPrice = calculateProductPrice(product);
    return { product, quantity, unitPrice, lineTotal: unitPrice * quantity };
  }).filter(Boolean);
}

router.get('/', requireUser, asyncHandler(async (req, res) => {
  const items = await buildCart(req.session.cart);
  if (!items.length) {
    req.flash('error', 'Keranjang Anda masih kosong.');
    return res.redirect('/cart');
  }
  const user = await User.findById(req.session.user.id).lean();
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  res.render('checkout', { title: 'Checkout', items, subtotal, user });
}));

router.post('/', requireUser, paymentLimiter, asyncHandler(async (req, res) => {
  const items = await buildCart(req.session.cart);
  if (!items.length) {
    req.flash('error', 'Keranjang Anda masih kosong.');
    return res.redirect('/cart');
  }
  for (const item of items) {
    if (item.product.stock < item.quantity) {
      req.flash('error', `Stok ${item.product.name} tidak mencukupi.`);
      return res.redirect('/cart');
    }
  }

  const user = await User.findById(req.session.user.id);
  if (!user || !user.isActive) return req.session.destroy(() => res.redirect('/auth/login'));

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  let voucherResult = { voucher: null, discount: 0 };
  try {
    voucherResult = await resolveVoucher({ code: req.body.voucherCode, subtotal, userId: user._id });
  } catch (error) {
    req.flash('error', error.message);
    return res.redirect('/checkout');
  }

  const afterDiscount = Math.max(0, subtotal - voucherResult.discount);
  const walletRequested = req.body.useWallet === 'on';
  const walletUsed = walletRequested ? Math.min(user.walletBalance, afterDiscount) : 0;
  const payableAmount = Math.max(0, afterDiscount - walletUsed);
  const method = allowedMethods.has(req.body.paymentMethod) ? req.body.paymentMethod : 'qris';

  if (walletUsed > 0) {
    const updated = await User.findOneAndUpdate(
      { _id: user._id, walletBalance: { $gte: walletUsed } },
      { $inc: { walletBalance: -walletUsed } },
      { new: true }
    );
    if (!updated) {
      req.flash('error', 'Saldo dompet berubah. Silakan ulangi checkout.');
      return res.redirect('/checkout');
    }
    user.walletBalance = updated.walletBalance;
  }

  let order;
  try {
    order = await Order.create({
      orderNumber: makeOrderNumber(),
      user: user._id,
      items: items.map((item) => ({
        product: item.product._id,
        name: item.product.name,
        slug: item.product.slug,
        imageUrl: item.product.imageUrl,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        fulfillmentContent: item.product.fulfillmentContent || ''
      })),
      subtotal,
      discountAmount: voucherResult.discount,
      voucherCode: voucherResult.voucher?.code || null,
      walletUsed,
      payableAmount,
      paymentMethod: payableAmount > 0 ? method : 'wallet/free'
    });

    if (walletUsed > 0) {
      await WalletTransaction.create({
        user: user._id, type: 'debit', amount: walletUsed,
        balanceAfter: user.walletBalance, source: 'order',
        reference: order.orderNumber, note: 'Pembayaran pesanan'
      });
    }
    if (voucherResult.voucher) {
      await Voucher.updateOne({ _id: voucherResult.voucher._id }, { $inc: { usedCount: 1 } });
    }
  } catch (error) {
    if (walletUsed > 0) await User.updateOne({ _id: user._id }, { $inc: { walletBalance: walletUsed } });
    throw error;
  }

  req.session.cart = [];

  if (payableAmount === 0) {
    await completeOrder(order);
    req.flash('success', 'Pesanan berhasil diproses tanpa pembayaran tambahan.');
    return res.redirect(`/account/orders/${order.orderNumber}`);
  }

  try {
    const payment = await createTransaction({ orderId: order.orderNumber, amount: payableAmount, method });
    order.paymentFee = Number(payment.fee || 0);
    order.totalPayment = Number(payment.total_payment || payableAmount);
    order.paymentMethod = payment.payment_method || method;
    order.paymentNumber = payment.payment_number || null;
    order.paymentExpiresAt = payment.expired_at ? new Date(payment.expired_at) : null;
    await order.save();
  } catch (error) {
    order.notes = `Pembuatan transaksi Pakasir gagal: ${error.message}`;
    await order.save();
    req.flash('error', 'Pesanan tersimpan, tetapi kanal pembayaran belum berhasil dibuat. Silakan coba lagi.');
  }

  res.redirect(`/checkout/payment/${order.orderNumber}`);
}));

router.get('/payment/:orderNumber', requireUser, asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id }).lean();
  if (!order) return res.status(404).render('error', { title: 'Pesanan Tidak Ditemukan', status: 404, message: 'Pesanan tidak tersedia.' });
  const isQris = order.paymentMethod === 'qris' && order.paymentNumber;
  const qrDataUrl = isQris ? await QRCode.toDataURL(order.paymentNumber, { width: 320, margin: 1 }) : null;
  res.render('payment', { title: `Pembayaran ${order.orderNumber}`, order, qrDataUrl });
}));

router.post('/payment/:orderNumber/retry', requireUser, paymentLimiter, asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id });
  if (!order || order.payableAmount <= 0 || !['pending', 'expired'].includes(order.status) || order.walletRefunded) {
    req.flash('error', 'Transaksi ini tidak dapat dibuat ulang.');
    return res.redirect('/account/orders');
  }
  const method = allowedMethods.has(req.body.paymentMethod) ? req.body.paymentMethod : (order.paymentMethod || 'qris');
  const payment = await createTransaction({ orderId: order.orderNumber, amount: order.payableAmount, method });
  order.status = 'pending';
  order.paymentFee = Number(payment.fee || 0);
  order.totalPayment = Number(payment.total_payment || order.payableAmount);
  order.paymentMethod = payment.payment_method || method;
  order.paymentNumber = payment.payment_number || null;
  order.paymentExpiresAt = payment.expired_at ? new Date(payment.expired_at) : null;
  await order.save();
  req.flash('success', 'Kanal pembayaran berhasil dibuat.');
  res.redirect(`/checkout/payment/${order.orderNumber}`);
}));

router.post('/payment/:orderNumber/check', requireUser, paymentLimiter, asyncHandler(async (req, res) => {
  const order = await Order.findOne({ orderNumber: req.params.orderNumber, user: req.session.user.id });
  if (!order) return res.sendStatus(404);
  if (order.status === 'completed') return res.redirect(`/account/orders/${order.orderNumber}`);

  const transaction = await getTransactionDetail({ orderId: order.orderNumber, amount: order.payableAmount });
  const valid = transaction.order_id === order.orderNumber &&
    Number(transaction.amount) === order.payableAmount &&
    transaction.project === process.env.PAKASIR_PROJECT_SLUG;

  if (valid && transaction.status === 'completed') {
    await completeOrder(order, transaction.completed_at ? new Date(transaction.completed_at) : new Date());
    req.flash('success', 'Pembayaran telah terverifikasi dan pesanan selesai.');
    return res.redirect(`/account/orders/${order.orderNumber}`);
  }
  req.flash('error', `Pembayaran belum selesai. Status saat ini: ${transaction.status || 'pending'}.`);
  res.redirect(`/checkout/payment/${order.orderNumber}`);
}));

module.exports = router;

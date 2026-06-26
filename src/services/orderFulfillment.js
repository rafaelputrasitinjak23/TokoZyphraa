const Order = require('../models/Order');
const Product = require('../models/Product');
const SerialKey = require('../models/SerialKey');
const { withMongoTransaction } = require('../utils/transaction');
const { awardOrderLoyalty } = require('./loyaltyService');
const { notifyOrderCompleted, createNotification, notifyAdmins } = require('./notificationService');

class InsufficientStockError extends Error {
  constructor(productName) {
    super(`Stok produk ${productName} tidak mencukupi saat pemrosesan.`);
    this.name = 'InsufficientStockError';
  }
}

class InsufficientSerialKeyError extends Error {
  constructor(productName) {
    super(`Serial key produk ${productName} tidak mencukupi saat pemrosesan.`);
    this.name = 'InsufficientSerialKeyError';
  }
}

function hasReleasedResources(order) {
  return ['cancelled', 'expired'].includes(order.status) || order.walletRefunded || order.voucherReleased;
}

async function appendManualReview(orderId, message, paidAt) {
  const updated = await Order.findOneAndUpdate(
    { _id: orderId, status: { $ne: 'completed' } },
    [{
      $set: {
        status: 'manual_review',
        paidAt: { $ifNull: ['$paidAt', paidAt] },
        notes: {
          $trim: {
            input: {
              $concat: [
                { $ifNull: ['$notes', ''] },
                { $cond: [{ $eq: [{ $ifNull: ['$notes', ''] }, ''] }, '', '\n'] },
                message
              ]
            }
          }
        }
      }
    }],
    { new: true }
  );
  const order = updated || await Order.findById(orderId);
  if (order) {
    await createNotification({
      userId: order.user,
      type: 'order',
      title: 'Pesanan memerlukan pemeriksaan',
      message: `Pembayaran pesanan ${order.orderNumber} telah diterima, tetapi produk memerlukan pemeriksaan admin.`,
      link: `/account/orders/${order.orderNumber}`,
      idempotencyKey: `order-manual-review:${order.orderNumber}`
    });
    await notifyAdmins({
      type: 'order',
      adminPermission: 'orders',
      title: 'Pesanan perlu diperiksa',
      message: `${order.orderNumber} masuk ke pemeriksaan manual.`,
      link: '/admin/orders?status=manual_review',
      idempotencyKey: `order-manual-review-admin:${order.orderNumber}`
    });
  }
  return order;
}

async function assignSerialKeys({ product, item, order, session }) {
  if (!item.serialKeyEnabled || item.serialKeys.length >= item.quantity) return;
  const needed = item.quantity - item.serialKeys.length;
  for (let index = 0; index < needed; index += 1) {
    const serial = await SerialKey.findOneAndUpdate(
      { product: product._id, status: 'available' },
      {
        $set: {
          status: 'assigned',
          order: order._id,
          user: order.user,
          assignedAt: new Date()
        }
      },
      { new: true, session, sort: { createdAt: 1 } }
    ).select('+value');
    if (!serial) throw new InsufficientSerialKeyError(item.name);
    item.serialKeys.push(serial.value);
  }
}

async function completeOrder(orderOrId, paidAt = new Date(), note = '') {
  const orderId = typeof orderOrId === 'string' ? orderOrId : orderOrId._id;
  try {
    return await withMongoTransaction(async (session) => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error('Pesanan tidak ditemukan.');
      if (order.status === 'completed') return order;

      if (hasReleasedResources(order)) {
        order.status = 'manual_review';
        order.paidAt ||= paidAt;
        order.notes = [
          order.notes,
          note,
          'Pembayaran diterima setelah pesanan dibatalkan, kedaluwarsa, atau sumber dana telah dikembalikan. Lakukan rekonsiliasi manual.'
        ].filter(Boolean).join('\n');
        await order.save({ session });
        await createNotification({
          userId: order.user,
          type: 'order',
          title: 'Pesanan memerlukan pemeriksaan',
          message: `Pembayaran pesanan ${order.orderNumber} diterima setelah sumber dana atau kuota pesanan dikembalikan.`,
          link: `/account/orders/${order.orderNumber}`,
          idempotencyKey: `order-late-payment-review:${order.orderNumber}`,
          session
        });
        await notifyAdmins({
          type: 'order',
          adminPermission: 'orders',
          title: 'Pembayaran terlambat perlu direkonsiliasi',
          message: `${order.orderNumber} dibayar setelah pesanan tidak aktif.`,
          link: '/admin/orders?status=manual_review',
          idempotencyKey: `order-late-payment-review-admin:${order.orderNumber}`
        }, session);
        return order;
      }

      if (!order.stockProcessed) {
        for (const item of order.items) {
          const product = await Product.findOneAndUpdate(
            { _id: item.product, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity, soldCount: item.quantity } },
            { new: true, session, runValidators: true }
          );
          if (!product) throw new InsufficientStockError(item.name);
          await assignSerialKeys({ product, item, order, session });
        }
        order.stockProcessed = true;
      }

      order.status = 'completed';
      order.paidAt ||= paidAt;
      order.completedAt = new Date();
      order.paymentSetupStatus = order.payableAmount > 0 ? 'ready' : order.paymentSetupStatus;
      if (note) order.notes = [order.notes, note].filter(Boolean).join('\n');
      await awardOrderLoyalty(order, session);
      await order.save({ session });
      await notifyOrderCompleted(order, session);
      return order;
    });
  } catch (error) {
    if (error instanceof InsufficientStockError || error instanceof InsufficientSerialKeyError) {
      return appendManualReview(orderId, [note, error.message].filter(Boolean).join('\n'), paidAt);
    }
    throw error;
  }
}

module.exports = { completeOrder, InsufficientStockError, InsufficientSerialKeyError };

const Order = require('../models/Order');
const Product = require('../models/Product');
const { withMongoTransaction } = require('../utils/transaction');

class InsufficientStockError extends Error {
  constructor(productName) {
    super(`Stok produk ${productName} tidak mencukupi saat pemrosesan.`);
    this.name = 'InsufficientStockError';
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
  return updated || Order.findById(orderId);
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
        }
        order.stockProcessed = true;
      }

      order.status = 'completed';
      order.paidAt ||= paidAt;
      order.completedAt = new Date();
      order.paymentSetupStatus = order.payableAmount > 0 ? 'ready' : order.paymentSetupStatus;
      if (note) order.notes = [order.notes, note].filter(Boolean).join('\n');
      await order.save({ session });
      return order;
    });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return appendManualReview(orderId, [note, error.message].filter(Boolean).join('\n'), paidAt);
    }
    throw error;
  }
}

module.exports = { completeOrder, InsufficientStockError };

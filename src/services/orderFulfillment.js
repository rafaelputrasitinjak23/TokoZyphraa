const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');

class InsufficientStockError extends Error {
  constructor(productName) {
    super(`Stok produk ${productName} tidak mencukupi saat pemrosesan.`);
    this.name = 'InsufficientStockError';
  }
}

function needsManualReview(order) {
  return order.status === 'cancelled' || order.walletRefunded || order.voucherReleased;
}

async function markLatePaymentForReview(order, paidAt, saveOptions = {}) {
  order.status = 'manual_review';
  order.paidAt ||= paidAt;
  order.notes = `${order.notes || ''}\nPembayaran diterima setelah pesanan dibatalkan atau sumber dana telah dikembalikan. Lakukan rekonsiliasi manual.`.trim();
  await order.save(saveOptions);
  return order;
}

async function completeWithoutTransaction(orderId, paidAt) {
  const order = await Order.findById(orderId);
  if (!order) throw new Error('Pesanan tidak ditemukan.');
  if (order.status === 'completed') return order;
  if (needsManualReview(order)) return markLatePaymentForReview(order, paidAt);

  const decremented = [];
  if (!order.stockProcessed) {
    for (const item of order.items) {
      const product = await Product.findOneAndUpdate(
        { _id: item.product, isActive: true, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity, soldCount: item.quantity } },
        { new: true }
      );
      if (!product) {
        for (const previous of decremented) {
          await Product.updateOne(
            { _id: previous.product },
            { $inc: { stock: previous.quantity, soldCount: -previous.quantity } }
          );
        }
        order.status = 'manual_review';
        order.notes = `${order.notes || ''}\nStok produk ${item.name} tidak mencukupi saat pemrosesan.`.trim();
        await order.save();
        return order;
      }
      decremented.push({ product: item.product, quantity: item.quantity });
    }
    order.stockProcessed = true;
  }

  order.status = 'completed';
  order.paidAt ||= paidAt;
  order.completedAt = new Date();
  await order.save();
  return order;
}

function isTransactionUnsupported(error) {
  const message = String(error?.message || '');
  return message.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
    message.includes('Transaction support is not available');
}

async function completeOrder(orderOrId, paidAt = new Date()) {
  const orderId = typeof orderOrId === 'string' ? orderOrId : orderOrId._id;
  const session = await mongoose.startSession();
  let completedOrder;

  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new Error('Pesanan tidak ditemukan.');
      if (order.status === 'completed') {
        completedOrder = order;
        return;
      }
      if (needsManualReview(order)) {
        completedOrder = await markLatePaymentForReview(order, paidAt, { session });
        return;
      }

      if (!order.stockProcessed) {
        for (const item of order.items) {
          const product = await Product.findOneAndUpdate(
            { _id: item.product, isActive: true, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity, soldCount: item.quantity } },
            { new: true, session }
          );
          if (!product) throw new InsufficientStockError(item.name);
        }
        order.stockProcessed = true;
      }

      order.status = 'completed';
      order.paidAt ||= paidAt;
      order.completedAt = new Date();
      await order.save({ session });
      completedOrder = order;
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' }
    });

    return completedOrder || Order.findById(orderId);
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      return completeWithoutTransaction(orderId, paidAt);
    }
    if (error instanceof InsufficientStockError) {
      const order = await Order.findById(orderId);
      if (order && order.status !== 'completed') {
        order.status = 'manual_review';
        order.notes = `${order.notes || ''}\n${error.message}`.trim();
        await order.save();
      }
      return order;
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { completeOrder };

const Order = require('../models/Order');
const WalletTopup = require('../models/WalletTopup');
const { getTransactionDetail, cancelTransaction } = require('../services/pakasir');
const { verifyPakasirTransaction, pakasirCompletedAt } = require('../services/paymentVerification');
const { completeOrder } = require('../services/orderFulfillment');
const { completeWalletTopup } = require('../services/walletTopup');
const { cancelOrder } = require('../services/orderCancellation');

async function reconcileOrder(order, now) {
  if (order.payableAmount === 0) {
    const result = await completeOrder(order, order.paidAt || now);
    return { reference: order.orderNumber, status: result.status };
  }

  if (order.paymentNumber) {
    const transaction = await getTransactionDetail({ orderId: order.orderNumber, amount: order.payableAmount });
    if (!verifyPakasirTransaction(transaction, order.orderNumber, order.payableAmount)) {
      throw new Error(`Transaksi ${order.orderNumber} tidak cocok dengan data Pakasir.`);
    }
    if (transaction.status === 'completed') {
      const result = await completeOrder(order, pakasirCompletedAt(transaction, now));
      return { reference: order.orderNumber, status: result.status };
    }
  }

  const expired = order.paymentExpiresAt && order.paymentExpiresAt <= now;
  const abandoned = !order.paymentNumber && order.createdAt <= new Date(now.getTime() - 30 * 60 * 1000);
  if (expired || abandoned) {
    if (order.paymentNumber) {
      await cancelTransaction({ orderId: order.orderNumber, amount: order.payableAmount });
    }
    const result = await cancelOrder(order, 'expired', 'Pesanan kedaluwarsa otomatis.');
    return { reference: order.orderNumber, status: result.status };
  }
  return { reference: order.orderNumber, status: order.status };
}

async function reconcileTopup(topup, now) {
  if (topup.paymentNumber) {
    const transaction = await getTransactionDetail({ orderId: topup.topupNumber, amount: topup.amount });
    if (!verifyPakasirTransaction(transaction, topup.topupNumber, topup.amount)) {
      throw new Error(`Transaksi ${topup.topupNumber} tidak cocok dengan data Pakasir.`);
    }
    if (transaction.status === 'completed') {
      const result = await completeWalletTopup(topup, pakasirCompletedAt(transaction, now));
      return { reference: topup.topupNumber, status: result.status };
    }
  }

  const expired = topup.paymentExpiresAt && topup.paymentExpiresAt <= now;
  const abandoned = !topup.paymentNumber && topup.createdAt <= new Date(now.getTime() - 30 * 60 * 1000);
  if (expired || abandoned) {
    if (topup.paymentNumber) {
      await cancelTransaction({ orderId: topup.topupNumber, amount: topup.amount });
    }
    const result = await WalletTopup.findOneAndUpdate(
      { _id: topup._id, status: 'pending', credited: false },
      { $set: { status: 'expired', paymentSetupStatus: 'idle' } },
      { new: true }
    );
    return { reference: topup.topupNumber, status: result?.status || topup.status };
  }
  return { reference: topup.topupNumber, status: topup.status };
}

async function mapWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await handler(items[index]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function reconcilePayments({ limit = 50, concurrency = 5 } = {}) {
  const now = new Date();
  const safeLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 500) : 50;
  const safeConcurrency = Number.isSafeInteger(concurrency) ? Math.min(Math.max(concurrency, 1), 10) : 5;
  const [orders, topups] = await Promise.all([
    Order.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(safeLimit),
    WalletTopup.find({ status: 'pending', credited: false }).sort({ createdAt: 1 }).limit(safeLimit)
  ]);

  const orderResults = await mapWithConcurrency(orders, safeConcurrency, async (order) => {
    try {
      return { type: 'order', ...(await reconcileOrder(order, now)) };
    } catch (error) {
      return { type: 'order', reference: order.orderNumber, status: 'error', error: error.message };
    }
  });

  const topupResults = await mapWithConcurrency(topups, safeConcurrency, async (topup) => {
    try {
      return { type: 'topup', ...(await reconcileTopup(topup, now)) };
    } catch (error) {
      return { type: 'topup', reference: topup.topupNumber, status: 'error', error: error.message };
    }
  });

  const results = [...orderResults, ...topupResults];
  return {
    processed: results.length,
    errors: results.filter((item) => item.status === 'error').length,
    results
  };
}

module.exports = { reconcilePayments, reconcileOrder, reconcileTopup, mapWithConcurrency };

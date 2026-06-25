const Order = require('../models/Order');
const User = require('../models/User');
const Voucher = require('../models/Voucher');
const WalletTransaction = require('../models/WalletTransaction');
const { getTransactionDetail, cancelTransaction } = require('./pakasir');
const { completeOrder } = require('./orderFulfillment');

async function cancelOrder(orderOrId, status = 'cancelled', note = '') {
  if (!['cancelled', 'expired'].includes(status)) throw new Error('Status pembatalan tidak valid.');
  const orderId = typeof orderOrId === 'string' ? orderOrId : orderOrId._id;

  let current = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: { $in: ['pending', 'paid', 'expired', 'manual_review'] }
    },
    { $set: { status } },
    { new: true }
  );

  if (!current) {
    current = await Order.findById(orderId);
    if (!current) throw new Error('Pesanan tidak ditemukan.');
    if (current.status === status) return current;
    if (current.status === 'completed') throw new Error('Pesanan selesai tidak dapat dibatalkan.');
    throw new Error('Pesanan tidak dapat dibatalkan pada status saat ini.');
  }

  if (note) {
    current.notes = `${current.notes || ''}\n${note}`.trim();
    await current.save();
  }

  if (current.walletUsed > 0 && !current.walletRefunded) {
    const claimed = await Order.findOneAndUpdate(
      { _id: current._id, walletRefunded: false },
      { $set: { walletRefunded: true } },
      { new: true }
    );
    if (claimed) {
      const user = await User.findByIdAndUpdate(
        claimed.user,
        { $inc: { walletBalance: claimed.walletUsed } },
        { new: true }
      );
      if (user) {
        await WalletTransaction.create({
          user: user._id,
          type: 'credit',
          amount: claimed.walletUsed,
          balanceAfter: user.walletBalance,
          source: 'refund',
          reference: claimed.orderNumber,
          note: `Pengembalian saldo pesanan ${status}`
        });
      }
    }
  }

  if (current.voucherCode && !current.voucherReleased) {
    const claimedVoucher = await Order.findOneAndUpdate(
      { _id: current._id, voucherReleased: false },
      { $set: { voucherReleased: true } },
      { new: true }
    );
    if (claimedVoucher) {
      await Voucher.updateOne(
        { code: claimedVoucher.voucherCode, usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } }
      );
    }
  }

  return Order.findById(current._id);
}

async function cancelPendingOrderSafely(orderOrId, status = 'cancelled', note = '') {
  const order = typeof orderOrId === 'string' ? await Order.findById(orderOrId) : orderOrId;
  if (!order) throw new Error('Pesanan tidak ditemukan.');

  if (order.payableAmount > 0 && order.paymentNumber) {
    const transaction = await getTransactionDetail({ orderId: order.orderNumber, amount: order.payableAmount });
    const valid = transaction.order_id === order.orderNumber &&
      Number(transaction.amount) === order.payableAmount &&
      transaction.project === process.env.PAKASIR_PROJECT_SLUG;
    if (!valid) throw new Error('Detail transaksi Pakasir tidak cocok dengan pesanan.');
    if (transaction.status === 'completed') {
      await completeOrder(order, transaction.completed_at ? new Date(transaction.completed_at) : new Date());
      const error = new Error('Pembayaran sudah selesai sehingga pesanan tidak dapat dibatalkan.');
      error.status = 409;
      throw error;
    }
    await cancelTransaction({ orderId: order.orderNumber, amount: order.payableAmount });
  }

  return cancelOrder(order, status, note);
}

module.exports = { cancelOrder, cancelPendingOrderSafely };

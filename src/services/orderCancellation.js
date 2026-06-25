const Order = require('../models/Order');
const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const Voucher = require('../models/Voucher');
const { releaseVoucher } = require('../utils/voucher');
const { withMongoTransaction } = require('../utils/transaction');
const { getTransactionDetail, cancelTransaction } = require('./pakasir');
const { verifyPakasirTransaction, pakasirCompletedAt } = require('./paymentVerification');
const { completeOrder } = require('./orderFulfillment');

async function cancelOrder(orderOrId, status = 'cancelled', note = '') {
  if (!['cancelled', 'expired'].includes(status)) throw new Error('Status pembatalan tidak valid.');
  const orderId = typeof orderOrId === 'string' ? orderOrId : orderOrId._id;

  return withMongoTransaction(async (session) => {
    const order = await Order.findById(orderId).session(session);
    if (!order) throw new Error('Pesanan tidak ditemukan.');
    if (order.status === status && order.walletRefunded === (order.walletUsed > 0) && order.voucherReleased === Boolean(order.voucher || order.voucherCode)) {
      return order;
    }
    if (order.status === 'completed' || (order.paidAt && order.payableAmount > 0)) {
      const error = new Error('Pesanan dengan pembayaran eksternal yang telah diterima atau pesanan selesai tidak dapat dibatalkan tanpa proses refund pembayaran.');
      error.status = 409;
      throw error;
    }
    if (!['pending', 'expired', 'manual_review', 'cancelled'].includes(order.status)) {
      const error = new Error('Pesanan tidak dapat dibatalkan pada status saat ini.');
      error.status = 409;
      throw error;
    }

    if (order.walletUsed > 0 && !order.walletRefunded) {
      const user = await User.findByIdAndUpdate(
        order.user,
        { $inc: { walletBalance: order.walletUsed } },
        { new: true, session, runValidators: true }
      );
      if (!user) throw new Error('Pengguna pesanan tidak ditemukan.');
      await WalletTransaction.create([{
        user: user._id,
        type: 'credit',
        amount: order.walletUsed,
        balanceAfter: user.walletBalance,
        source: 'refund',
        reference: order.orderNumber,
        idempotencyKey: `order-refund:${order.orderNumber}`,
        note: `Pengembalian saldo pesanan ${status}`
      }], { session });
      order.walletRefunded = true;
    }

    if ((order.voucher || order.voucherCode) && !order.voucherReleased) {
      let voucherId = order.voucher;
      if (!voucherId && order.voucherCode) {
        const legacyVoucher = await Voucher.findOne({ code: order.voucherCode }).select('_id').session(session);
        voucherId = legacyVoucher?._id || null;
      }
      if (voucherId) await releaseVoucher({ voucherId, userId: order.user, session });
      order.voucherReleased = true;
    }

    order.status = status;
    order.paymentSetupStatus = 'idle';
    if (note) order.notes = `${order.notes || ''}\n${note}`.trim();
    await order.save({ session });
    return order;
  });
}

async function cancelPendingOrderSafely(orderOrId, status = 'cancelled', note = '') {
  const order = typeof orderOrId === 'string' ? await Order.findById(orderOrId) : orderOrId;
  if (!order) throw new Error('Pesanan tidak ditemukan.');
  if (order.status === 'completed' || (order.paidAt && order.payableAmount > 0)) {
    const error = new Error('Pesanan dengan pembayaran eksternal yang telah diterima tidak dapat dibatalkan.');
    error.status = 409;
    throw error;
  }

  if (order.payableAmount > 0 && order.paymentNumber) {
    const transaction = await getTransactionDetail({ orderId: order.orderNumber, amount: order.payableAmount });
    if (!verifyPakasirTransaction(transaction, order.orderNumber, order.payableAmount)) {
      throw new Error('Detail transaksi Pakasir tidak cocok dengan pesanan.');
    }
    if (transaction.status === 'completed') {
      await completeOrder(order, pakasirCompletedAt(transaction));
      const error = new Error('Pembayaran sudah selesai sehingga pesanan tidak dapat dibatalkan.');
      error.status = 409;
      throw error;
    }
    await cancelTransaction({ orderId: order.orderNumber, amount: order.payableAmount });
  }

  return cancelOrder(order, status, note);
}

module.exports = { cancelOrder, cancelPendingOrderSafely };

const Order = require('../models/Order');
const WalletTopup = require('../models/WalletTopup');
const { createTransaction } = require('./pakasir');

function paymentValues(payment, amount, fallbackMethod) {
  const fee = Number(payment.fee || 0);
  const totalPayment = Number(payment.total_payment || amount);
  if (!Number.isSafeInteger(fee) || fee < 0 || !Number.isSafeInteger(totalPayment) || totalPayment < amount) {
    throw new Error('Pakasir mengembalikan nilai pembayaran yang tidak valid.');
  }
  const expiresAt = payment.expired_at ? new Date(payment.expired_at) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error('Waktu kedaluwarsa pembayaran tidak valid.');
  return {
    paymentFee: fee,
    totalPayment,
    paymentMethod: payment.payment_method || fallbackMethod,
    paymentNumber: payment.payment_number || null,
    paymentExpiresAt: expiresAt,
    paymentSetupStatus: 'ready'
  };
}

async function setupOrderPayment(orderOrId, method) {
  const orderId = typeof orderOrId === 'string' ? orderOrId : orderOrId._id;
  const staleAt = new Date(Date.now() - 2 * 60 * 1000);
  const claimed = await Order.findOneAndUpdate(
    {
      _id: orderId,
      status: 'pending',
      payableAmount: { $gt: 0 },
      walletRefunded: false,
      $or: [
        { paymentSetupStatus: { $ne: 'creating' } },
        { updatedAt: { $lte: staleAt } }
      ]
    },
    { $set: { paymentSetupStatus: 'creating', paymentMethod: method } },
    { new: true }
  );

  if (!claimed) {
    const current = await Order.findById(orderId);
    if (!current) throw new Error('Pesanan tidak ditemukan.');
    return { order: current, created: false, inProgress: current.paymentSetupStatus === 'creating' };
  }

  try {
    const payment = await createTransaction({ orderId: claimed.orderNumber, amount: claimed.payableAmount, method });
    const order = await Order.findOneAndUpdate(
      { _id: claimed._id, status: 'pending', paymentSetupStatus: 'creating' },
      { $set: paymentValues(payment, claimed.payableAmount, method) },
      { new: true, runValidators: true }
    );
    if (!order) throw new Error('Status pesanan berubah saat kanal pembayaran dibuat.');
    return { order, created: true, inProgress: false };
  } catch (error) {
    await Order.updateOne(
      { _id: claimed._id, paymentSetupStatus: 'creating' },
      { $set: { paymentSetupStatus: 'idle', notes: `Pembuatan transaksi Pakasir gagal: ${error.message}` } }
    );
    throw error;
  }
}

async function setupTopupPayment(topupOrId, method) {
  const topupId = typeof topupOrId === 'string' ? topupOrId : topupOrId._id;
  const staleAt = new Date(Date.now() - 2 * 60 * 1000);
  const claimed = await WalletTopup.findOneAndUpdate(
    {
      _id: topupId,
      status: 'pending',
      credited: false,
      $or: [
        { paymentSetupStatus: { $ne: 'creating' } },
        { updatedAt: { $lte: staleAt } }
      ]
    },
    { $set: { paymentSetupStatus: 'creating', paymentMethod: method } },
    { new: true }
  );

  if (!claimed) {
    const current = await WalletTopup.findById(topupId);
    if (!current) throw new Error('Top up tidak ditemukan.');
    return { topup: current, created: false, inProgress: current.paymentSetupStatus === 'creating' };
  }

  try {
    const payment = await createTransaction({ orderId: claimed.topupNumber, amount: claimed.amount, method });
    const topup = await WalletTopup.findOneAndUpdate(
      { _id: claimed._id, status: 'pending', credited: false, paymentSetupStatus: 'creating' },
      { $set: paymentValues(payment, claimed.amount, method) },
      { new: true, runValidators: true }
    );
    if (!topup) throw new Error('Status top up berubah saat kanal pembayaran dibuat.');
    return { topup, created: true, inProgress: false };
  } catch (error) {
    await WalletTopup.updateOne(
      { _id: claimed._id, paymentSetupStatus: 'creating' },
      { $set: { paymentSetupStatus: 'idle', notes: `Pembuatan transaksi Pakasir gagal: ${error.message}` } }
    );
    throw error;
  }
}

module.exports = { setupOrderPayment, setupTopupPayment };

const User = require('../models/User');
const WalletTopup = require('../models/WalletTopup');
const WalletTransaction = require('../models/WalletTransaction');
const { withMongoTransaction } = require('../utils/transaction');
const { notifyWalletTopup, createNotification } = require('./notificationService');

function transactionKey(topupNumber) {
  return `topup:${topupNumber}`;
}

async function approveWalletTopup(topupId, note) {
  return withMongoTransaction(async (session) => {
    const topup = await WalletTopup.findById(topupId).session(session);
    if (!topup) return null;
    if (topup.status === 'completed' && topup.credited) return topup;
    if (topup.status !== 'manual_review') {
      const error = new Error('Hanya top up berstatus manual_review yang dapat disetujui secara manual.');
      error.status = 409;
      throw error;
    }

    const existing = await WalletTransaction.findOne({ idempotencyKey: transactionKey(topup.topupNumber) }).session(session);
    let resolutionNote = `Disetujui admin: ${note}`;
    if (!existing) {
      let user;
      if (topup.credited) {
        user = await User.findOne({ _id: topup.user }).session(session);
        resolutionNote = `Diselesaikan tanpa menambah saldo ulang karena top up sudah memiliki tanda credited: ${note}`;
      } else {
        user = await User.findOneAndUpdate(
          { _id: topup.user },
          { $inc: { walletBalance: topup.amount } },
          { new: true, session, runValidators: true }
        );
      }
      if (!user) throw new Error('Pengguna top up tidak ditemukan.');

      await WalletTransaction.create([{
        user: user._id,
        type: 'credit',
        amount: topup.amount,
        balanceAfter: user.walletBalance,
        source: 'topup',
        reference: topup.topupNumber,
        idempotencyKey: transactionKey(topup.topupNumber),
        note: resolutionNote
      }], { session });
    }

    topup.status = 'completed';
    topup.credited = true;
    topup.creditedAt ||= existing?.createdAt || new Date();
    topup.notes = [topup.notes, resolutionNote].filter(Boolean).join('\n');
    await topup.save({ session });
    await notifyWalletTopup(topup, session);
    return topup;
  });
}

async function rejectWalletTopup(topupId, note) {
  return withMongoTransaction(async (session) => {
    const topup = await WalletTopup.findById(topupId).session(session);
    if (!topup) return null;
    if (topup.status !== 'manual_review' || topup.credited) {
      const error = new Error('Top up ini tidak dapat ditolak pada status saat ini.');
      error.status = 409;
      throw error;
    }
    const existing = await WalletTransaction.exists({ idempotencyKey: transactionKey(topup.topupNumber) }).session(session);
    if (existing) {
      const error = new Error('Top up sudah memiliki transaksi kredit dan tidak dapat ditolak.');
      error.status = 409;
      throw error;
    }
    topup.status = 'cancelled';
    topup.notes = [topup.notes, `Ditolak admin: ${note}`].filter(Boolean).join('\n');
    await topup.save({ session });
    await createNotification({
      userId: topup.user,
      type: 'wallet',
      title: 'Top up ditolak',
      message: `Top up ${topup.topupNumber} ditolak setelah pemeriksaan admin.`,
      link: '/account/wallet',
      idempotencyKey: `topup-rejected:${topup.topupNumber}`,
      session
    });
    return topup;
  });
}

module.exports = { approveWalletTopup, rejectWalletTopup };

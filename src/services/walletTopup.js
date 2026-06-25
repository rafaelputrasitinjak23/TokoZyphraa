const User = require('../models/User');
const WalletTopup = require('../models/WalletTopup');
const WalletTransaction = require('../models/WalletTransaction');
const { withMongoTransaction } = require('../utils/transaction');

function transactionKey(topupNumber) {
  return `topup:${topupNumber}`;
}

async function completeWalletTopup(topupOrId, completedAt = new Date()) {
  const topupId = typeof topupOrId === 'string' ? topupOrId : topupOrId._id;

  return withMongoTransaction(async (session) => {
    const topup = await WalletTopup.findById(topupId).session(session);
    if (!topup) throw new Error('Top up tidak ditemukan.');
    if (topup.status === 'completed' && topup.credited) return topup;

    const existing = await WalletTransaction.findOne({ idempotencyKey: transactionKey(topup.topupNumber) }).session(session);
    if (existing) {
      topup.status = 'completed';
      topup.credited = true;
      topup.creditedAt ||= existing.createdAt || completedAt;
      topup.paymentSetupStatus = 'ready';
      await topup.save({ session });
      return topup;
    }

    if (['cancelled', 'expired', 'manual_review'].includes(topup.status)) {
      topup.status = 'manual_review';
      topup.notes = `${topup.notes || ''}\nPembayaran diterima pada top up yang tidak aktif. Lakukan rekonsiliasi manual.`.trim();
      await topup.save({ session });
      return topup;
    }

    const user = await User.findOneAndUpdate(
      { _id: topup.user, role: 'user' },
      { $inc: { walletBalance: topup.amount } },
      { new: true, session, runValidators: true }
    );
    if (!user) throw new Error('Pengguna top up tidak ditemukan.');

    await WalletTransaction.create([{
      user: user._id,
      type: 'credit',
      amount: topup.amount,
      balanceAfter: user.walletBalance,
      source: 'topup',
      reference: topup.topupNumber,
      idempotencyKey: transactionKey(topup.topupNumber),
      note: 'Top up saldo melalui Pakasir'
    }], { session });

    topup.status = 'completed';
    topup.credited = true;
    topup.creditedAt = completedAt;
    topup.paymentSetupStatus = 'ready';
    await topup.save({ session });
    return topup;
  });
}

module.exports = { completeWalletTopup };

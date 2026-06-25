const mongoose = require('mongoose');
const User = require('../models/User');
const WalletTopup = require('../models/WalletTopup');
const WalletTransaction = require('../models/WalletTransaction');

function isTransactionUnsupported(error) {
  const message = String(error?.message || '');
  return message.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
    message.includes('Transaction support is not available');
}

function transactionKey(topupNumber) {
  return `topup:${topupNumber}`;
}

async function recoverCompletedTopup(topup, saveOptions = {}) {
  const existing = await WalletTransaction.findOne({ idempotencyKey: transactionKey(topup.topupNumber) })
    .session(saveOptions.session || null);
  if (!existing) return null;

  topup.status = 'completed';
  topup.credited = true;
  topup.creditedAt ||= existing.createdAt || new Date();
  await topup.save(saveOptions);
  return topup;
}

async function completeWithoutTransaction(topupId, completedAt) {
  let topup = await WalletTopup.findById(topupId);
  if (!topup) throw new Error('Top up tidak ditemukan.');
  if (topup.status === 'completed' && topup.credited) return topup;

  const recovered = await recoverCompletedTopup(topup);
  if (recovered) return recovered;

  topup = await WalletTopup.findOneAndUpdate(
    { _id: topupId, credited: false, status: { $in: ['pending', 'expired', 'processing'] } },
    { $set: { credited: true, status: 'processing' } },
    { new: true }
  );
  if (!topup) return WalletTopup.findById(topupId);

  try {
    const user = await User.findByIdAndUpdate(
      topup.user,
      { $inc: { walletBalance: topup.amount } },
      { new: true }
    );
    if (!user) throw new Error('Pengguna top up tidak ditemukan.');

    await WalletTransaction.create({
      user: user._id,
      type: 'credit',
      amount: topup.amount,
      balanceAfter: user.walletBalance,
      source: 'topup',
      reference: topup.topupNumber,
      idempotencyKey: transactionKey(topup.topupNumber),
      note: 'Top up saldo melalui Pakasir'
    });

    topup.status = 'completed';
    topup.creditedAt = completedAt;
    await topup.save();
    return topup;
  } catch (error) {
    topup.status = 'manual_review';
    topup.notes = `${topup.notes || ''}\nTop up perlu diperiksa manual: ${error.message}`.trim();
    await topup.save().catch(() => {});
    throw error;
  }
}

async function completeWalletTopup(topupOrId, completedAt = new Date()) {
  const topupId = typeof topupOrId === 'string' ? topupOrId : topupOrId._id;
  const session = await mongoose.startSession();
  let completedTopup;

  try {
    await session.withTransaction(async () => {
      const topup = await WalletTopup.findById(topupId).session(session);
      if (!topup) throw new Error('Top up tidak ditemukan.');
      if (topup.status === 'completed' && topup.credited) {
        completedTopup = topup;
        return;
      }
      if (topup.status === 'cancelled' || topup.status === 'manual_review') {
        topup.status = 'manual_review';
        topup.notes = `${topup.notes || ''}\nPembayaran diterima pada top up yang tidak aktif. Lakukan rekonsiliasi manual.`.trim();
        await topup.save({ session });
        completedTopup = topup;
        return;
      }

      const existing = await WalletTransaction.findOne({
        idempotencyKey: transactionKey(topup.topupNumber)
      }).session(session);
      if (existing) {
        topup.status = 'completed';
        topup.credited = true;
        topup.creditedAt ||= existing.createdAt || completedAt;
        await topup.save({ session });
        completedTopup = topup;
        return;
      }

      const user = await User.findByIdAndUpdate(
        topup.user,
        { $inc: { walletBalance: topup.amount } },
        { new: true, session }
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
      await topup.save({ session });
      completedTopup = topup;
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' }
    });

    return completedTopup || WalletTopup.findById(topupId);
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      return completeWithoutTransaction(topupId, completedAt);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { completeWalletTopup };

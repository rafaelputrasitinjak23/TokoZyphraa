const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');
const { withMongoTransaction } = require('../utils/transaction');

async function findExistingAdjustment(idempotencyKey) {
  const transaction = await WalletTransaction.findOne({ idempotencyKey }).lean();
  if (!transaction) return null;
  const user = await User.findById(transaction.user);
  return user ? { user, duplicate: true } : null;
}

async function adjustWallet({ userId, amount, type, adminId, note, adjustmentToken }) {
  const idempotencyKey = `admin-adjustment:${adminId}:${userId}:${adjustmentToken}`;
  const existing = await findExistingAdjustment(idempotencyKey);
  if (existing) return existing;

  try {
    return await withMongoTransaction(async (session) => {
      const duplicate = await WalletTransaction.findOne({ idempotencyKey }).session(session);
      if (duplicate) {
        const user = await User.findById(duplicate.user).session(session);
        if (!user) throw new Error('Pengguna transaksi tidak ditemukan.');
        return { user, duplicate: true };
      }

      const delta = type === 'credit' ? amount : -amount;
      const filter = type === 'debit'
        ? { _id: userId, role: 'user', walletBalance: { $gte: amount } }
        : { _id: userId, role: 'user' };
      const user = await User.findOneAndUpdate(
        filter,
        { $inc: { walletBalance: delta } },
        { new: true, session, runValidators: true }
      );
      if (!user) throw new Error('Saldo pengguna tidak mencukupi atau pengguna tidak ditemukan.');

      await WalletTransaction.create([{
        user: user._id,
        type,
        amount,
        balanceAfter: user.walletBalance,
        source: 'admin',
        reference: `ADMIN:${adminId}`,
        idempotencyKey,
        note
      }], { session });
      return { user, duplicate: false };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await findExistingAdjustment(idempotencyKey);
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

module.exports = { adjustWallet };

const User = require('../models/User');
const Referral = require('../models/Referral');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const WalletTransaction = require('../models/WalletTransaction');
const { createNotification } = require('./notificationService');
const { withMongoTransaction } = require('../utils/transaction');

const POINTS_PER_RUPIAH_UNIT = 1000;
const REFERRER_REWARD = 100;
const REFERRED_REWARD = 50;
const REDEEM_RATE_RUPIAH = 10;
const MIN_REDEEM_POINTS = 100;

async function creditPoints({ userId, points, source, reference, note, idempotencyKey, session }) {
  if (!Number.isSafeInteger(points) || points <= 0) return null;
  const existing = await LoyaltyTransaction.findOne({ idempotencyKey }).session(session);
  if (existing) return existing;
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { loyaltyPoints: points } },
    { new: true, session, runValidators: true }
  );
  if (!user) throw new Error('Pengguna poin loyalitas tidak ditemukan.');
  const [transaction] = await LoyaltyTransaction.create([{
    user: user._id,
    type: 'credit',
    points,
    balanceAfter: user.loyaltyPoints,
    source,
    reference,
    note,
    idempotencyKey
  }], { session });
  return transaction;
}

async function awardOrderLoyalty(order, session) {
  if (order.loyaltyAwarded) return;
  const orderValue = Number(order.payableAmount || 0) + Number(order.walletUsed || 0);
  const points = Math.max(0, Math.floor(orderValue / POINTS_PER_RUPIAH_UNIT));
  if (points > 0) {
    await creditPoints({
      userId: order.user,
      points,
      source: 'order',
      reference: order.orderNumber,
      note: `Poin dari pesanan ${order.orderNumber}`,
      idempotencyKey: `order-loyalty:${order.orderNumber}`,
      session
    });
    await createNotification({
      userId: order.user,
      type: 'loyalty',
      title: 'Poin loyalitas bertambah',
      message: `Anda memperoleh ${points} poin dari pesanan ${order.orderNumber}.`,
      link: '/account#loyalty',
      idempotencyKey: `order-loyalty-notification:${order.orderNumber}`,
      session
    });
  }
  order.loyaltyAwarded = true;
  order.loyaltyPointsEarned = points;

  const referral = await Referral.findOne({ referredUser: order.user, status: 'registered' }).session(session);
  if (!referral) return;
  const completedBefore = await require('../models/Order').countDocuments({
    user: order.user,
    status: 'completed',
    _id: { $ne: order._id }
  }).session(session);
  if (completedBefore > 0) return;

  await creditPoints({
    userId: referral.referrer,
    points: REFERRER_REWARD,
    source: 'referral',
    reference: order.orderNumber,
    note: 'Bonus referral dari transaksi pertama teman',
    idempotencyKey: `referral-referrer:${referral._id}`,
    session
  });
  await creditPoints({
    userId: referral.referredUser,
    points: REFERRED_REWARD,
    source: 'referral',
    reference: order.orderNumber,
    note: 'Bonus pengguna baru dari referral',
    idempotencyKey: `referral-referred:${referral._id}`,
    session
  });
  referral.status = 'rewarded';
  referral.referrerPoints = REFERRER_REWARD;
  referral.referredPoints = REFERRED_REWARD;
  referral.rewardedAt = new Date();
  await referral.save({ session });
  order.referralRewarded = true;

  await createNotification({
    userId: referral.referrer,
    type: 'referral',
    title: 'Bonus referral diterima',
    message: `Anda memperoleh ${REFERRER_REWARD} poin karena teman yang Anda undang menyelesaikan transaksi pertamanya.`,
    link: '/account#loyalty',
    idempotencyKey: `referral-notification:${referral._id}`,
    session
  });
}

async function redeemPoints({ userId, points, token }) {
  if (!Number.isSafeInteger(points) || points < MIN_REDEEM_POINTS || points % 100 !== 0) {
    const error = new Error(`Penukaran minimal ${MIN_REDEEM_POINTS} poin dan harus kelipatan 100.`);
    error.status = 400;
    throw error;
  }
  if (!/^[a-f0-9-]{32,80}$/i.test(String(token || ''))) {
    const error = new Error('Token penukaran poin tidak valid.');
    error.status = 400;
    throw error;
  }

  return withMongoTransaction(async (session) => {
    const idempotencyKey = `loyalty-redeem:${userId}:${token}`;
    const existing = await LoyaltyTransaction.findOne({ idempotencyKey }).session(session);
    if (existing) return { duplicate: true, transaction: existing };

    const rupiah = points * REDEEM_RATE_RUPIAH;
    const user = await User.findOneAndUpdate(
      { _id: userId, loyaltyPoints: { $gte: points } },
      { $inc: { loyaltyPoints: -points, walletBalance: rupiah } },
      { new: true, session, runValidators: true }
    );
    if (!user) {
      const error = new Error('Poin loyalitas tidak mencukupi.');
      error.status = 409;
      throw error;
    }

    const [transaction] = await LoyaltyTransaction.create([{
      user: user._id,
      type: 'debit',
      points,
      balanceAfter: user.loyaltyPoints,
      source: 'redeem',
      reference: token,
      note: `Ditukar menjadi saldo Rp${rupiah}`,
      idempotencyKey
    }], { session });

    await WalletTransaction.create([{
      user: user._id,
      type: 'credit',
      amount: rupiah,
      balanceAfter: user.walletBalance,
      source: 'adjustment',
      reference: `LOYALTY-${token}`,
      idempotencyKey: `loyalty-wallet:${userId}:${token}`,
      note: `Konversi ${points} poin loyalitas`
    }], { session });

    await createNotification({
      userId: user._id,
      type: 'loyalty',
      title: 'Poin berhasil ditukar',
      message: `${points} poin telah dikonversi menjadi saldo dompet Rp${rupiah}.`,
      link: '/account/wallet',
      idempotencyKey: `loyalty-redeem-notification:${userId}:${token}`,
      session
    });

    return { duplicate: false, transaction, user, rupiah };
  });
}

module.exports = {
  awardOrderLoyalty,
  redeemPoints,
  MIN_REDEEM_POINTS,
  REDEEM_RATE_RUPIAH,
  POINTS_PER_RUPIAH_UNIT
};

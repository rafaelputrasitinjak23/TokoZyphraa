const Voucher = require('../models/Voucher');
const VoucherUsage = require('../models/VoucherUsage');
const Order = require('../models/Order');

function calculateDiscount(voucher, subtotal) {
  let discount = voucher.type === 'percent'
    ? Math.round(subtotal * voucher.value / 100)
    : voucher.value;
  if (voucher.maxDiscount != null) discount = Math.min(discount, voucher.maxDiscount);
  return Math.max(0, Math.min(subtotal, discount));
}

async function reserveVoucher({ code, subtotal, userId, session }) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return { voucher: null, discount: 0 };

  const now = new Date();
  const voucher = await Voucher.findOne({
    code: normalizedCode,
    isActive: true,
    startsAt: { $lte: now },
    expiresAt: { $gte: now }
  }).session(session);

  if (!voucher) throw new Error('Voucher tidak aktif atau sudah kedaluwarsa.');
  if (subtotal < voucher.minPurchase) {
    throw new Error(`Minimal pembelian voucher adalah Rp${voucher.minPurchase.toLocaleString('id-ID')}.`);
  }

  const voucherFilter = { _id: voucher._id, isActive: true, startsAt: { $lte: now }, expiresAt: { $gte: now } };
  if (voucher.usageLimit != null) voucherFilter.usedCount = { $lt: voucher.usageLimit };

  const reservedVoucher = await Voucher.findOneAndUpdate(
    voucherFilter,
    { $inc: { usedCount: 1 } },
    { new: true, session }
  );
  if (!reservedVoucher) throw new Error('Kuota voucher sudah habis atau voucher tidak lagi aktif.');

  const existingUsage = await VoucherUsage.findOne({ voucher: voucher._id, user: userId }).session(session);
  if (!existingUsage) {
    const historicalUsage = await Order.countDocuments({
      user: userId,
      $or: [{ voucher: voucher._id }, { voucherCode: voucher.code }],
      status: { $nin: ['cancelled', 'expired'] }
    }).session(session);
    await VoucherUsage.updateOne(
      { voucher: voucher._id, user: userId },
      { $setOnInsert: { usedCount: historicalUsage } },
      { upsert: true, session }
    );
  }

  const usage = await VoucherUsage.findOneAndUpdate(
    { voucher: voucher._id, user: userId, usedCount: { $lt: voucher.perUserLimit } },
    { $inc: { usedCount: 1 } },
    { new: true, session }
  );
  if (!usage) throw new Error('Batas penggunaan voucher untuk akun ini sudah tercapai.');

  return { voucher: reservedVoucher, discount: calculateDiscount(voucher, subtotal) };
}

async function releaseVoucher({ voucherId, userId, session }) {
  if (!voucherId) return;
  await Voucher.updateOne(
    { _id: voucherId, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
    { session }
  );
  await VoucherUsage.updateOne(
    { voucher: voucherId, user: userId, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
    { session }
  );
}

module.exports = { reserveVoucher, releaseVoucher, calculateDiscount };

const Voucher = require('../models/Voucher');
const Order = require('../models/Order');

async function resolveVoucher({ code, subtotal, userId }) {
  if (!code) return { voucher: null, discount: 0 };
  const voucher = await Voucher.findOne({ code: String(code).trim().toUpperCase(), isActive: true });
  const now = new Date();
  if (!voucher || now < voucher.startsAt || now > voucher.expiresAt) throw new Error('Voucher tidak aktif atau sudah kedaluwarsa.');
  if (subtotal < voucher.minPurchase) throw new Error(`Minimal pembelian voucher adalah Rp${voucher.minPurchase.toLocaleString('id-ID')}.`);
  if (voucher.usageLimit && voucher.usedCount >= voucher.usageLimit) throw new Error('Kuota voucher sudah habis.');

  const userUsage = await Order.countDocuments({ user: userId, voucherCode: voucher.code, status: { $nin: ['cancelled', 'expired'] } });
  if (userUsage >= voucher.perUserLimit) throw new Error('Batas penggunaan voucher untuk akun ini sudah tercapai.');

  let discount = voucher.type === 'percent' ? Math.round(subtotal * voucher.value / 100) : voucher.value;
  if (voucher.maxDiscount != null) discount = Math.min(discount, voucher.maxDiscount);
  discount = Math.max(0, Math.min(subtotal, discount));
  return { voucher, discount };
}

module.exports = { resolveVoucher };

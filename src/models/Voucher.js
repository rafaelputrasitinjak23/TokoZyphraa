const mongoose = require('mongoose');

const integer = {
  type: Number,
  min: 0,
  validate: { validator: Number.isSafeInteger, message: 'Nilai voucher harus berupa bilangan bulat.' }
};

const voucherSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true, maxlength: 40 },
  description: { type: String, default: '', maxlength: 180 },
  type: { type: String, enum: ['percent', 'fixed'], required: true },
  value: { ...integer, required: true },
  minPurchase: { ...integer, default: 0 },
  maxDiscount: { ...integer, default: null },
  usageLimit: { ...integer, default: null, min: 1 },
  usedCount: { ...integer, default: 0 },
  perUserLimit: { ...integer, default: 1, min: 1 },
  startsAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });

voucherSchema.index({ isActive: 1, startsAt: 1, expiresAt: 1 });

module.exports = mongoose.models.Voucher || mongoose.model('Voucher', voucherSchema);

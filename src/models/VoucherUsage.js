const mongoose = require('mongoose');

const voucherUsageSchema = new mongoose.Schema({
  voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  usedCount: {
    type: Number,
    default: 0,
    min: 0,
    validate: { validator: Number.isSafeInteger, message: 'Jumlah penggunaan voucher tidak valid.' }
  }
}, { timestamps: true });

voucherUsageSchema.index({ voucher: 1, user: 1 }, { unique: true });

module.exports = mongoose.models.VoucherUsage || mongoose.model('VoucherUsage', voucherUsageSchema);

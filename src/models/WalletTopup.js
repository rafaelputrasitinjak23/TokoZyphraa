const mongoose = require('mongoose');

const walletTopupSchema = new mongoose.Schema({
  topupNumber: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true, min: 10000, max: 10000000 },
  paymentFee: { type: Number, default: 0, min: 0 },
  totalPayment: { type: Number, default: 0, min: 0 },
  paymentMethod: { type: String, default: 'qris' },
  paymentNumber: { type: String, default: null },
  paymentExpiresAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled', 'expired', 'manual_review'],
    default: 'pending',
    index: true
  },
  credited: { type: Boolean, default: false, index: true },
  creditedAt: { type: Date, default: null },
  notes: { type: String, default: '', maxlength: 1000 }
}, { timestamps: true });

module.exports = mongoose.models.WalletTopup || mongoose.model('WalletTopup', walletTopupSchema);

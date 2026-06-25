const mongoose = require('mongoose');

const integerMoney = {
  type: Number,
  min: 0,
  validate: { validator: Number.isSafeInteger, message: 'Nilai harus berupa bilangan bulat.' }
};

const walletTopupSchema = new mongoose.Schema({
  topupNumber: { type: String, required: true, unique: true, index: true },
  requestToken: { type: String, default: null, maxlength: 80 },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { ...integerMoney, required: true, min: 10000, max: 10000000 },
  paymentFee: { ...integerMoney, default: 0 },
  totalPayment: { ...integerMoney, default: 0 },
  paymentMethod: { type: String, default: 'qris' },
  paymentNumber: { type: String, default: null },
  paymentExpiresAt: { type: Date, default: null },
  paymentSetupStatus: { type: String, enum: ['idle', 'creating', 'ready'], default: 'idle' },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'cancelled', 'expired', 'manual_review'],
    default: 'pending',
    index: true
  },
  credited: { type: Boolean, default: false, index: true },
  creditedAt: { type: Date, default: null },
  notes: { type: String, default: '', maxlength: 2000 }
}, { timestamps: true });

walletTopupSchema.index({ user: 1, createdAt: -1 });
walletTopupSchema.index(
  { user: 1, requestToken: 1 },
  { unique: true, partialFilterExpression: { requestToken: { $type: 'string' } } }
);
walletTopupSchema.index({ status: 1, paymentExpiresAt: 1 });

module.exports = mongoose.models.WalletTopup || mongoose.model('WalletTopup', walletTopupSchema);

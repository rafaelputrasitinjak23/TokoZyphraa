const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true, min: 0 },
  balanceAfter: { type: Number, required: true, min: 0 },
  source: { type: String, enum: ['admin', 'order', 'refund', 'adjustment', 'topup'], required: true },
  reference: { type: String, default: '' },
  idempotencyKey: { type: String, default: undefined, unique: true, sparse: true },
  note: { type: String, default: '', maxlength: 500 }
}, { timestamps: true });

module.exports = mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', walletTransactionSchema);

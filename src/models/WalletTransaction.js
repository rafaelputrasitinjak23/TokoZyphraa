const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: {
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isSafeInteger, message: 'Nominal transaksi harus berupa bilangan bulat.' }
  },
  balanceAfter: {
    type: Number,
    required: true,
    min: 0,
    validate: { validator: Number.isSafeInteger, message: 'Saldo akhir harus berupa bilangan bulat.' }
  },
  source: { type: String, enum: ['admin', 'order', 'refund', 'adjustment', 'topup'], required: true },
  reference: { type: String, default: '', maxlength: 120 },
  idempotencyKey: { type: String, default: undefined, unique: true, sparse: true },
  note: { type: String, default: '', maxlength: 500 }
}, { timestamps: true });

walletTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.WalletTransaction || mongoose.model('WalletTransaction', walletTransactionSchema);

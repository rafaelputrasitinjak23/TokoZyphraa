const mongoose = require('mongoose');

const loyaltyTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  points: { type: Number, required: true, min: 1, validate: { validator: Number.isSafeInteger } },
  balanceAfter: { type: Number, required: true, min: 0, validate: { validator: Number.isSafeInteger } },
  source: { type: String, enum: ['order', 'referral', 'redeem', 'admin'], required: true, index: true },
  reference: { type: String, default: '', trim: true, maxlength: 160 },
  note: { type: String, default: '', trim: true, maxlength: 500 },
  idempotencyKey: { type: String, required: true, unique: true, maxlength: 200 }
}, { timestamps: true });

loyaltyTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.LoyaltyTransaction || mongoose.model('LoyaltyTransaction', loyaltyTransactionSchema);

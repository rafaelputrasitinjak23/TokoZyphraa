const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  referredUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  code: { type: String, required: true, uppercase: true, trim: true, maxlength: 24 },
  status: { type: String, enum: ['registered', 'rewarded'], default: 'registered', index: true },
  referrerPoints: { type: Number, default: 0, min: 0 },
  referredPoints: { type: Number, default: 0, min: 0 },
  rewardedAt: { type: Date, default: null }
}, { timestamps: true });

referralSchema.index({ referrer: 1, createdAt: -1 });

module.exports = mongoose.models.Referral || mongoose.model('Referral', referralSchema);

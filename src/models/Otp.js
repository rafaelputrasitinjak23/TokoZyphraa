const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  purpose: { type: String, enum: ['register'], default: 'register' },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  lastSentAt: { type: Date, default: Date.now }
}, { timestamps: true });

otpSchema.index({ email: 1, purpose: 1 }, { unique: true });

module.exports = mongoose.models.Otp || mongoose.model('Otp', otpSchema);

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  avatarData: { type: String, default: '', maxlength: 600000 },
  phone: { type: String, default: '', trim: true, maxlength: 24 },
  bio: { type: String, default: '', trim: true, maxlength: 250 },
  emailVerifiedAt: { type: Date, default: null },
  walletBalance: {
    type: Number,
    default: 0,
    min: 0,
    validate: { validator: Number.isSafeInteger, message: 'Saldo dompet harus berupa bilangan bulat.' }
  },
  isActive: { type: Boolean, default: true, index: true },
  lastLoginAt: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null },
  sessionVersion: {
    type: Number,
    default: 0,
    min: 0,
    validate: { validator: Number.isSafeInteger, message: 'Versi sesi tidak valid.' }
  }
}, { timestamps: true });

userSchema.index({ role: 1, createdAt: -1 });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

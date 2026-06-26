const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: {
    type: String,
    enum: ['order', 'payment', 'wallet', 'ticket', 'system', 'referral', 'loyalty'],
    default: 'system',
    index: true
  },
  title: { type: String, required: true, trim: true, maxlength: 140 },
  message: { type: String, required: true, trim: true, maxlength: 1000 },
  link: { type: String, default: '', trim: true, maxlength: 500 },
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null },
  idempotencyKey: { type: String, default: null, maxlength: 200 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
notificationSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);

const mongoose = require('mongoose');

const serialKeySchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  value: { type: String, required: true, trim: true, maxlength: 1000, select: false },
  normalizedValue: { type: String, required: true, trim: true, maxlength: 1000 },
  status: { type: String, enum: ['available', 'assigned', 'disabled'], default: 'available', index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  assignedAt: { type: Date, default: null }
}, { timestamps: true });

serialKeySchema.index({ product: 1, normalizedValue: 1 }, { unique: true });
serialKeySchema.index({ product: 1, status: 1, createdAt: 1 });

module.exports = mongoose.models.SerialKey || mongoose.model('SerialKey', serialKeySchema);

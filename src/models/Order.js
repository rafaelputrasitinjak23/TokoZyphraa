const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  imageUrl: { type: String, default: '' },
  unitPrice: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, required: true, min: 0 },
  fulfillmentContent: { type: String, default: '' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [orderItemSchema], required: true },
  subtotal: { type: Number, required: true, min: 0 },
  discountAmount: { type: Number, default: 0, min: 0 },
  voucherCode: { type: String, default: null },
  walletUsed: { type: Number, default: 0, min: 0 },
  walletRefunded: { type: Boolean, default: false },
  voucherReleased: { type: Boolean, default: false },
  payableAmount: { type: Number, required: true, min: 0 },
  paymentFee: { type: Number, default: 0, min: 0 },
  totalPayment: { type: Number, default: 0, min: 0 },
  paymentMethod: { type: String, default: null },
  paymentNumber: { type: String, default: null },
  paymentExpiresAt: { type: Date, default: null },
  status: {
    type: String,
    enum: ['pending', 'paid', 'completed', 'cancelled', 'expired', 'manual_review'],
    default: 'pending',
    index: true
  },
  paidAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  stockProcessed: { type: Boolean, default: false },
  notes: { type: String, default: '', maxlength: 1000 }
}, { timestamps: true });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);

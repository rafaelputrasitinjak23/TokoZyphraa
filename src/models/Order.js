const mongoose = require('mongoose');

const integerMoney = {
  type: Number,
  min: 0,
  validate: { validator: Number.isSafeInteger, message: 'Nilai harus berupa bilangan bulat.' }
};

const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  imageUrl: { type: String, default: '' },
  unitPrice: { ...integerMoney, required: true },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    validate: { validator: Number.isSafeInteger, message: 'Jumlah produk harus berupa bilangan bulat.' }
  },
  lineTotal: { ...integerMoney, required: true },
  deliveryType: { type: String, enum: ['digital', 'physical'], default: 'digital' },
  fulfillmentContent: { type: String, default: '' }
}, { _id: false });

const shippingAddressSchema = new mongoose.Schema({
  receiverName: { type: String, trim: true, maxlength: 80, default: '' },
  phone: { type: String, trim: true, maxlength: 24, default: '' },
  address: { type: String, trim: true, maxlength: 500, default: '' },
  city: { type: String, trim: true, maxlength: 100, default: '' },
  postalCode: { type: String, trim: true, maxlength: 10, default: '' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  checkoutToken: { type: String, default: null, maxlength: 80 },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [orderItemSchema], required: true, validate: [(items) => items.length > 0, 'Pesanan harus memiliki item.'] },
  shippingAddress: { type: shippingAddressSchema, default: null },
  subtotal: { ...integerMoney, required: true },
  discountAmount: { ...integerMoney, default: 0 },
  voucher: { type: mongoose.Schema.Types.ObjectId, ref: 'Voucher', default: null },
  voucherCode: { type: String, default: null },
  walletUsed: { ...integerMoney, default: 0 },
  walletRefunded: { type: Boolean, default: false },
  voucherReleased: { type: Boolean, default: false },
  payableAmount: { ...integerMoney, required: true },
  paymentFee: { ...integerMoney, default: 0 },
  totalPayment: { ...integerMoney, default: 0 },
  paymentMethod: { type: String, default: null },
  paymentNumber: { type: String, default: null },
  paymentExpiresAt: { type: Date, default: null },
  paymentSetupStatus: { type: String, enum: ['idle', 'creating', 'ready'], default: 'idle' },
  status: {
    type: String,
    enum: ['pending', 'paid', 'completed', 'cancelled', 'expired', 'manual_review'],
    default: 'pending',
    index: true
  },
  paidAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  stockProcessed: { type: Boolean, default: false },
  notes: { type: String, default: '', maxlength: 4000 }
}, { timestamps: true });

orderSchema.index(
  { user: 1, checkoutToken: 1 },
  { unique: true, partialFilterExpression: { checkoutToken: { $type: 'string' } } }
);
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ status: 1, paymentExpiresAt: 1 });
orderSchema.index({ user: 1, voucher: 1, status: 1 });

module.exports = mongoose.models.Order || mongoose.model('Order', orderSchema);

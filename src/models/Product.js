const mongoose = require('mongoose');

const integerMoney = {
  type: Number,
  min: 0,
  validate: { validator: (value) => value == null || Number.isSafeInteger(value), message: 'Nilai harus berupa bilangan bulat.' }
};

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  shortDescription: { type: String, default: '', trim: true, maxlength: 220 },
  description: { type: String, required: true, trim: true, maxlength: 8000 },
  category: { type: String, default: 'Umum', trim: true, maxlength: 60, index: true },
  imageUrl: { type: String, default: '/images/product-placeholder.svg', maxlength: 2000 },
  price: { ...integerMoney, required: true },
  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
    validate: { validator: Number.isSafeInteger, message: 'Persentase diskon harus berupa bilangan bulat.' }
  },
  stock: { ...integerMoney, default: 0 },
  soldCount: { ...integerMoney, default: 0 },
  isActive: { type: Boolean, default: true, index: true },
  isFeatured: { type: Boolean, default: false, index: true },
  isFlashSale: { type: Boolean, default: false, index: true },
  flashSalePrice: { ...integerMoney, default: null },
  flashSaleStart: { type: Date, default: null },
  flashSaleEnd: { type: Date, default: null },
  deliveryType: { type: String, enum: ['digital', 'physical'], default: 'digital' },
  fulfillmentContent: { type: String, default: '', maxlength: 8000 },
  digitalAssetType: { type: String, enum: ['none', 'local', 'url'], default: 'none' },
  digitalFilePath: { type: String, default: '', maxlength: 1000 },
  digitalFileName: { type: String, default: '', maxlength: 255 },
  digitalFileMime: { type: String, default: '', maxlength: 160 },
  digitalFileSize: { ...integerMoney, default: 0 },
  digitalFileUrl: { type: String, default: '', maxlength: 2000 },
  downloadLimit: {
    type: Number,
    default: 5,
    min: 0,
    max: 1000,
    validate: { validator: Number.isSafeInteger, message: 'Batas unduhan harus berupa bilangan bulat.' }
  },
  serialKeyEnabled: { type: Boolean, default: false, index: true },
  averageRating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { ...integerMoney, default: 0 }
}, { timestamps: true });

productSchema.index({ name: 'text', shortDescription: 'text', description: 'text', category: 'text' });
productSchema.index({ isActive: 1, isFeatured: -1, createdAt: -1 });
productSchema.index({ isActive: 1, isFlashSale: 1, flashSaleEnd: 1 });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);

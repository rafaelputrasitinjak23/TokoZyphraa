const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 140 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  shortDescription: { type: String, default: '', trim: true, maxlength: 220 },
  description: { type: String, required: true, trim: true, maxlength: 8000 },
  category: { type: String, default: 'Umum', trim: true, maxlength: 60, index: true },
  imageUrl: { type: String, default: '/images/product-placeholder.svg' },
  price: { type: Number, required: true, min: 0 },
  discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  stock: { type: Number, default: 0, min: 0 },
  soldCount: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true, index: true },
  isFeatured: { type: Boolean, default: false, index: true },
  isFlashSale: { type: Boolean, default: false, index: true },
  flashSalePrice: { type: Number, default: null, min: 0 },
  flashSaleStart: { type: Date, default: null },
  flashSaleEnd: { type: Date, default: null },
  deliveryType: { type: String, enum: ['digital', 'physical'], default: 'digital' },
  fulfillmentContent: { type: String, default: '', maxlength: 8000 },
  averageRating: { type: Number, default: 0, min: 0, max: 5 },
  reviewCount: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

productSchema.index({ name: 'text', shortDescription: 'text', description: 'text', category: 'text' });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);

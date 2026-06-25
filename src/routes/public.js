const express = require('express');
const Product = require('../models/Product');
const Review = require('../models/Review');
const { calculateProductPrice } = require('../utils/order');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const query = { isActive: true };
  const search = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  if (search) query.$text = { $search: search };
  if (category) query.category = category;

  const [products, flashSaleProducts, categories] = await Promise.all([
    Product.find(query).sort({ isFeatured: -1, createdAt: -1 }).limit(60).lean(),
    Product.find({
      isActive: true, isFlashSale: true,
      flashSaleStart: { $lte: new Date() }, flashSaleEnd: { $gte: new Date() }
    }).sort({ flashSaleEnd: 1 }).limit(4).lean(),
    Product.distinct('category', { isActive: true })
  ]);

  res.render('home', {
    title: 'Produk Digital Pilihan',
    products: products.map((p) => ({ ...p, effectivePrice: calculateProductPrice(p) })),
    flashSaleProducts: flashSaleProducts.map((p) => ({ ...p, effectivePrice: calculateProductPrice(p) })),
    categories: categories.sort(), search, category
  });
}));

router.get('/products/:slug', asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true }).lean();
  if (!product) return res.status(404).render('error', { title: 'Produk Tidak Ditemukan', status: 404, message: 'Produk tidak tersedia.' });

  const reviews = await Review.find({ product: product._id, isPublished: true })
    .populate('user', 'name').sort({ createdAt: -1 }).limit(30).lean();

  res.render('products/detail', {
    title: product.name,
    product: { ...product, effectivePrice: calculateProductPrice(product) },
    reviews
  });
}));

router.get('/health', (req, res) => res.json({ ok: true, service: 'TokoZyphra', timestamp: new Date().toISOString() }));

module.exports = router;

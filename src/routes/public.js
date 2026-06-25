const express = require('express');
const Product = require('../models/Product');
const Review = require('../models/Review');
const { calculateProductPrice } = require('../utils/order');
const { parsePage } = require('../utils/input');
const { DEFAULT_PAGE_SIZE } = require('../constants/limits');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const query = { isActive: true };
  const search = String(req.query.q || '').trim().slice(0, 100);
  const category = String(req.query.category || '').trim().slice(0, 60);
  const page = parsePage(req.query.page);
  if (search) query.$text = { $search: search };
  if (category) query.category = category;

  const sort = search ? { score: { $meta: 'textScore' }, isFeatured: -1 } : { isFeatured: -1, createdAt: -1 };
  const productQuery = Product.find(query);
  if (search) productQuery.select({ score: { $meta: 'textScore' } });

  const [products, totalProducts, flashSaleProducts, categories] = await Promise.all([
    productQuery.sort(sort).skip((page - 1) * DEFAULT_PAGE_SIZE).limit(DEFAULT_PAGE_SIZE).lean(),
    Product.countDocuments(query),
    Product.find({
      isActive: true,
      isFlashSale: true,
      flashSaleStart: { $lte: new Date() },
      flashSaleEnd: { $gte: new Date() }
    }).sort({ flashSaleEnd: 1 }).limit(4).lean(),
    Product.distinct('category', { isActive: true })
  ]);

  res.render('home', {
    title: 'Produk Digital Pilihan',
    products: products.map((product) => ({ ...product, effectivePrice: calculateProductPrice(product) })),
    flashSaleProducts: flashSaleProducts.map((product) => ({ ...product, effectivePrice: calculateProductPrice(product) })),
    categories: categories.sort(),
    search,
    category,
    pagination: {
      page,
      totalPages: Math.max(1, Math.ceil(totalProducts / DEFAULT_PAGE_SIZE)),
      query: { q: search, category }
    }
  });
}));

router.get('/products/:slug', asyncHandler(async (req, res) => {
  const product = await Product.findOne({ slug: req.params.slug, isActive: true }).lean();
  if (!product) {
    return res.status(404).render('error', {
      title: 'Produk Tidak Ditemukan', status: 404, message: 'Produk tidak tersedia.'
    });
  }

  const reviews = await Review.find({ product: product._id, isPublished: true })
    .populate('user', 'name').sort({ createdAt: -1 }).limit(30).lean();

  res.render('products/detail', {
    title: product.name,
    product: { ...product, effectivePrice: calculateProductPrice(product) },
    reviews
  });
}));

module.exports = router;

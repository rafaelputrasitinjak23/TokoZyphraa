const express = require('express');
const Product = require('../models/Product');
const Review = require('../models/Review');
const Wishlist = require('../models/Wishlist');
const { calculateProductPrice } = require('../utils/order');
const { parsePage } = require('../utils/input');
const { DEFAULT_PAGE_SIZE } = require('../constants/limits');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseMoneyFilter(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

router.get('/', asyncHandler(async (req, res) => {
  const search = String(req.query.q || '').trim().slice(0, 100);
  const category = String(req.query.category || '').trim().slice(0, 60);
  const sort = ['featured', 'newest', 'price_asc', 'price_desc', 'popular', 'rating'].includes(req.query.sort)
    ? req.query.sort
    : 'featured';
  const availability = req.query.availability === 'in_stock' ? 'in_stock' : '';
  const minimumRating = [1, 2, 3, 4, 5].includes(Number(req.query.rating)) ? Number(req.query.rating) : 0;
  let minPrice = parseMoneyFilter(req.query.minPrice);
  let maxPrice = parseMoneyFilter(req.query.maxPrice);
  if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  const page = parsePage(req.query.page);
  const now = new Date();

  const baseMatch = { isActive: true };
  if (category) baseMatch.category = category;
  if (availability) baseMatch.stock = { $gt: 0 };
  if (minimumRating) baseMatch.averageRating = { $gte: minimumRating };
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    baseMatch.$or = [
      { name: regex },
      { shortDescription: regex },
      { description: regex },
      { category: regex }
    ];
  }

  const priceMatch = {};
  if (minPrice != null) priceMatch.$gte = minPrice;
  if (maxPrice != null) priceMatch.$lte = maxPrice;

  const sortMap = {
    featured: { isFeatured: -1, createdAt: -1 },
    newest: { createdAt: -1 },
    price_asc: { effectivePrice: 1, createdAt: -1 },
    price_desc: { effectivePrice: -1, createdAt: -1 },
    popular: { soldCount: -1, createdAt: -1 },
    rating: { averageRating: -1, reviewCount: -1, createdAt: -1 }
  };

  const pipeline = [
    { $match: baseMatch },
    {
      $addFields: {
        effectivePrice: {
          $cond: [
            {
              $and: [
                '$isFlashSale',
                { $ne: ['$flashSalePrice', null] },
                { $lte: ['$flashSaleStart', now] },
                { $gte: ['$flashSaleEnd', now] }
              ]
            },
            '$flashSalePrice',
            {
              $max: [
                0,
                {
                  $subtract: [
                    '$price',
                    { $floor: { $divide: [{ $multiply: ['$price', '$discountPercent'] }, 100] } }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  ];
  if (Object.keys(priceMatch).length) pipeline.push({ $match: { effectivePrice: priceMatch } });
  pipeline.push(
    { $sort: sortMap[sort] },
    {
      $facet: {
        products: [{ $skip: (page - 1) * DEFAULT_PAGE_SIZE }, { $limit: DEFAULT_PAGE_SIZE }],
        total: [{ $count: 'count' }]
      }
    }
  );

  const [result, flashSaleProducts, categories] = await Promise.all([
    Product.aggregate(pipeline),
    Product.find({
      isActive: true,
      isFlashSale: true,
      flashSaleStart: { $lte: now },
      flashSaleEnd: { $gte: now }
    }).sort({ flashSaleEnd: 1 }).limit(4).lean(),
    Product.distinct('category', { isActive: true })
  ]);

  const products = result[0]?.products || [];
  const totalProducts = result[0]?.total?.[0]?.count || 0;
  let wishlistIds = new Set();
  if (req.session.user?.id && products.length) {
    const wishlistRows = await Wishlist.find({
      user: req.session.user.id,
      product: { $in: products.map((product) => product._id) }
    }).select('product').lean();
    wishlistIds = new Set(wishlistRows.map((row) => String(row.product)));
  }

  res.render('home', {
    title: 'Produk Digital Pilihan',
    products: products.map((product) => ({ ...product, isWishlisted: wishlistIds.has(String(product._id)) })),
    flashSaleProducts: flashSaleProducts.map((product) => ({ ...product, effectivePrice: calculateProductPrice(product) })),
    categories: categories.sort(),
    filters: { search, category, sort, availability, minimumRating, minPrice, maxPrice },
    search,
    category,
    pagination: {
      page,
      totalPages: Math.max(1, Math.ceil(totalProducts / DEFAULT_PAGE_SIZE)),
      query: {
        q: search,
        category,
        sort,
        availability,
        rating: minimumRating || '',
        minPrice: minPrice ?? '',
        maxPrice: maxPrice ?? ''
      }
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

  const [reviews, wishlist] = await Promise.all([
    Review.find({ product: product._id, isPublished: true })
      .populate('user', 'name').sort({ createdAt: -1 }).limit(30).lean(),
    req.session.user?.id ? Wishlist.exists({ user: req.session.user.id, product: product._id }) : null
  ]);

  res.render('products/detail', {
    title: product.name,
    product: { ...product, effectivePrice: calculateProductPrice(product), isWishlisted: Boolean(wishlist) },
    reviews
  });
}));

module.exports = router;

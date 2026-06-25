const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { calculateProductPrice } = require('../utils/order');
const { MAX_CART_QUANTITY, MAX_CART_ITEMS } = require('../constants/limits');
const { safeRefererPath } = require('../utils/redirect');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function validQuantity(value, fallback = 1) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= MAX_CART_QUANTITY ? quantity : fallback;
}

function submittedQuantities(body) {
  const quantities = {};
  for (const [key, value] of Object.entries(body || {})) {
    const match = key.match(/^quantities\[([a-f0-9]{24})\]$/i);
    if (match) quantities[match[1]] = value;
  }
  return quantities;
}

router.get('/', asyncHandler(async (req, res) => {
  const rawCart = Array.isArray(req.session.cart) ? req.session.cart : [];
  const ids = rawCart.map((item) => item.productId).filter(mongoose.isValidObjectId);
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const normalizedCart = [];
  const items = [];

  for (const entry of rawCart) {
    const product = productMap.get(String(entry.productId));
    if (!product) continue;
    const quantity = Math.min(product.stock, validQuantity(entry.quantity));
    if (quantity < 1) continue;
    normalizedCart.push({ productId: String(product._id), quantity });
    const unitPrice = calculateProductPrice(product);
    items.push({ product, quantity, unitPrice, lineTotal: unitPrice * quantity });
  }

  if (JSON.stringify(normalizedCart) !== JSON.stringify(rawCart)) req.session.cart = normalizedCart;
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  res.render('cart', { title: 'Keranjang', items, subtotal });
}));

router.post('/add/:productId', asyncHandler(async (req, res) => {
  const fallback = safeRefererPath(req, '/');
  if (!mongoose.isValidObjectId(req.params.productId)) {
    req.flash('error', 'Produk tidak valid.');
    return res.redirect(fallback);
  }
  const product = await Product.findOne({ _id: req.params.productId, isActive: true });
  if (!product || product.stock < 1) {
    req.flash('error', 'Produk sedang tidak tersedia.');
    return res.redirect(fallback);
  }

  const requestedQuantity = Number(req.body.quantity || 1);
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1 || requestedQuantity > MAX_CART_QUANTITY) {
    req.flash('error', `Jumlah produk harus antara 1 dan ${MAX_CART_QUANTITY}.`);
    return res.redirect(fallback);
  }

  req.session.cart ||= [];
  const existing = req.session.cart.find((item) => item.productId === product.id);
  if (existing) {
    existing.quantity = Math.min(product.stock, validQuantity(existing.quantity) + requestedQuantity, MAX_CART_QUANTITY);
  } else {
    if (req.session.cart.length >= MAX_CART_ITEMS) {
      req.flash('error', `Keranjang maksimal memuat ${MAX_CART_ITEMS} produk berbeda.`);
      return res.redirect(fallback);
    }
    req.session.cart.push({ productId: product.id, quantity: Math.min(product.stock, requestedQuantity) });
  }
  req.flash('success', `${product.name} ditambahkan ke keranjang.`);
  res.redirect(req.body.buyNow === '1' ? '/cart' : fallback);
}));

router.post('/update', (req, res) => {
  const quantities = submittedQuantities(req.body);
  const invalid = [];
  req.session.cart = (req.session.cart || []).map((item) => {
    const value = Number(quantities[item.productId] ?? item.quantity);
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CART_QUANTITY) {
      invalid.push(item.productId);
      return item;
    }
    return { ...item, quantity: value };
  });
  req.flash(invalid.length ? 'error' : 'success', invalid.length
    ? `Jumlah produk harus antara 1 dan ${MAX_CART_QUANTITY}.`
    : 'Keranjang diperbarui.');
  res.redirect('/cart');
});

router.post('/remove/:productId', (req, res) => {
  req.session.cart = (req.session.cart || []).filter((item) => item.productId !== req.params.productId);
  req.flash('success', 'Produk dihapus dari keranjang.');
  res.redirect('/cart');
});

module.exports = router;

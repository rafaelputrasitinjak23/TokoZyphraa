const express = require('express');
const Product = require('../models/Product');
const { calculateProductPrice } = require('../utils/order');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const rawCart = req.session.cart || [];
  const ids = rawCart.map((item) => item.productId);
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const productMap = new Map(products.map((p) => [String(p._id), p]));
  const items = rawCart.map((entry) => {
    const product = productMap.get(entry.productId);
    if (!product) return null;
    const unitPrice = calculateProductPrice(product);
    return { product, quantity: entry.quantity, unitPrice, lineTotal: unitPrice * entry.quantity };
  }).filter(Boolean);
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  res.render('cart', { title: 'Keranjang', items, subtotal });
}));

router.post('/add/:productId', asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.productId, isActive: true });
  if (!product || product.stock < 1) {
    req.flash('error', 'Produk sedang tidak tersedia.');
    return res.redirect(req.get('referer') || '/');
  }
  const quantity = Math.max(1, Math.min(10, Number(req.body.quantity || 1)));
  req.session.cart ||= [];
  const existing = req.session.cart.find((item) => item.productId === product.id);
  if (existing) existing.quantity = Math.min(product.stock, existing.quantity + quantity, 10);
  else req.session.cart.push({ productId: product.id, quantity: Math.min(product.stock, quantity) });
  req.flash('success', `${product.name} ditambahkan ke keranjang.`);
  res.redirect(req.body.buyNow === '1' ? '/cart' : (req.get('referer') || '/'));
}));

router.post('/update', (req, res) => {
  const quantities = req.body.quantities || {};
  req.session.cart = (req.session.cart || []).map((item) => ({
    ...item,
    quantity: Math.max(1, Math.min(10, Number(quantities[item.productId] || item.quantity)))
  }));
  req.flash('success', 'Keranjang diperbarui.');
  res.redirect('/cart');
});

router.post('/remove/:productId', (req, res) => {
  req.session.cart = (req.session.cart || []).filter((item) => item.productId !== req.params.productId);
  req.flash('success', 'Produk dihapus dari keranjang.');
  res.redirect('/cart');
});

module.exports = router;

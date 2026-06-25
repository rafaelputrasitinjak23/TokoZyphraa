const express = require('express');
const Order = require('../models/Order');
const { getTransactionDetail } = require('../services/pakasir');
const { completeOrder } = require('../services/orderFulfillment');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/pakasir', asyncHandler(async (req, res) => {
  const orderId = String(req.body.order_id || '');
  const amount = Number(req.body.amount);
  const project = String(req.body.project || '');
  if (!orderId || !Number.isFinite(amount) || project !== process.env.PAKASIR_PROJECT_SLUG) {
    return res.status(400).json({ ok: false });
  }

  const order = await Order.findOne({ orderNumber: orderId });
  if (!order || order.payableAmount !== amount) return res.status(404).json({ ok: false });
  if (order.status === 'completed') return res.json({ ok: true, duplicate: true });

  const transaction = await getTransactionDetail({ orderId, amount });
  const verified = transaction.order_id === orderId &&
    Number(transaction.amount) === amount &&
    transaction.project === process.env.PAKASIR_PROJECT_SLUG &&
    transaction.status === 'completed';
  if (!verified) return res.status(400).json({ ok: false, verified: false });

  await completeOrder(order, transaction.completed_at ? new Date(transaction.completed_at) : new Date());
  res.json({ ok: true });
}));

module.exports = router;

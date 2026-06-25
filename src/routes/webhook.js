const express = require('express');
const Order = require('../models/Order');
const WalletTopup = require('../models/WalletTopup');
const { getTransactionDetail } = require('../services/pakasir');
const { completeOrder } = require('../services/orderFulfillment');
const { completeWalletTopup } = require('../services/walletTopup');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function isVerifiedTransaction(transaction, reference, amount) {
  return transaction.order_id === reference &&
    Number(transaction.amount) === amount &&
    transaction.project === process.env.PAKASIR_PROJECT_SLUG &&
    transaction.status === 'completed';
}

router.post('/pakasir', asyncHandler(async (req, res) => {
  const reference = String(req.body.order_id || '');
  const amount = Number(req.body.amount);
  const project = String(req.body.project || '');
  if (!reference || !Number.isFinite(amount) || project !== process.env.PAKASIR_PROJECT_SLUG) {
    return res.status(400).json({ ok: false });
  }

  const topup = await WalletTopup.findOne({ topupNumber: reference });
  if (topup) {
    if (topup.amount !== amount) return res.status(400).json({ ok: false });
    if (topup.status === 'completed' && topup.credited) {
      return res.json({ ok: true, duplicate: true, type: 'wallet_topup' });
    }

    const transaction = await getTransactionDetail({ orderId: reference, amount });
    if (!isVerifiedTransaction(transaction, reference, amount)) {
      return res.status(400).json({ ok: false, verified: false });
    }

    await completeWalletTopup(
      topup,
      transaction.completed_at ? new Date(transaction.completed_at) : new Date()
    );
    return res.json({ ok: true, type: 'wallet_topup' });
  }

  const order = await Order.findOne({ orderNumber: reference });
  if (!order || order.payableAmount !== amount) return res.status(404).json({ ok: false });
  if (order.status === 'completed') return res.json({ ok: true, duplicate: true, type: 'order' });

  const transaction = await getTransactionDetail({ orderId: reference, amount });
  if (!isVerifiedTransaction(transaction, reference, amount)) {
    return res.status(400).json({ ok: false, verified: false });
  }

  await completeOrder(order, transaction.completed_at ? new Date(transaction.completed_at) : new Date());
  res.json({ ok: true, type: 'order' });
}));

module.exports = router;

const express = require('express');
const Order = require('../models/Order');
const WalletTopup = require('../models/WalletTopup');
const { getTransactionDetail } = require('../services/pakasir');
const { verifyPakasirTransaction, pakasirCompletedAt } = require('../services/paymentVerification');
const { completeOrder } = require('../services/orderFulfillment');
const { completeWalletTopup } = require('../services/walletTopup');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.post('/pakasir', asyncHandler(async (req, res) => {
  const reference = String(req.body.order_id || '').trim();
  const amount = Number(req.body.amount);
  const project = String(req.body.project || '').trim();
  if (!reference || !Number.isSafeInteger(amount) || amount <= 0 || project !== process.env.PAKASIR_PROJECT_SLUG) {
    return res.status(400).json({ ok: false });
  }

  const topup = await WalletTopup.findOne({ topupNumber: reference });
  if (topup) {
    if (topup.amount !== amount) return res.status(400).json({ ok: false });
    if (topup.status === 'completed' && topup.credited) {
      return res.json({ ok: true, duplicate: true, type: 'wallet_topup', status: topup.status });
    }
    const transaction = await getTransactionDetail({ orderId: reference, amount });
    if (!verifyPakasirTransaction(transaction, reference, amount, { requireCompleted: true })) {
      return res.status(400).json({ ok: false, verified: false });
    }
    const result = await completeWalletTopup(topup, pakasirCompletedAt(transaction));
    return res.json({ ok: true, type: 'wallet_topup', status: result.status });
  }

  const order = await Order.findOne({ orderNumber: reference });
  if (!order || order.payableAmount !== amount) return res.status(404).json({ ok: false });
  if (order.status === 'completed') {
    return res.json({ ok: true, duplicate: true, type: 'order', status: order.status });
  }

  const transaction = await getTransactionDetail({ orderId: reference, amount });
  if (!verifyPakasirTransaction(transaction, reference, amount, { requireCompleted: true })) {
    return res.status(400).json({ ok: false, verified: false });
  }
  const result = await completeOrder(order, pakasirCompletedAt(transaction));
  res.json({ ok: true, type: 'order', status: result.status });
}));

module.exports = router;

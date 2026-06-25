const crypto = require('crypto');
const express = require('express');
const { reconcilePayments } = require('../jobs/reconcilePayments');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

function secureEquals(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

const runReconciliation = asyncHandler(async (req, res) => {
  const authorization = String(req.get('authorization') || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!process.env.JOB_SECRET || !secureEquals(token, process.env.JOB_SECRET)) {
    return res.status(401).json({ ok: false });
  }
  const result = await reconcilePayments();
  res.json({ ok: true, ...result });
});

router.get('/jobs/reconcile-payments', runReconciliation);
router.post('/jobs/reconcile-payments', runReconciliation);

module.exports = router;

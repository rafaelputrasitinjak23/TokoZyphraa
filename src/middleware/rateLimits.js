const { rateLimit } = require('express-rate-limit');

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('error', {
    title: 'Terlalu Banyak Permintaan', status: 429,
    message: 'Terlalu banyak percobaan. Silakan coba lagi beberapa saat.'
  })
};

const authLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 20 });
const otpLimiter = rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: 8 });
const paymentLimiter = rateLimit({ ...base, windowMs: 10 * 60 * 1000, limit: 30 });

module.exports = { authLimiter, otpLimiter, paymentLimiter };

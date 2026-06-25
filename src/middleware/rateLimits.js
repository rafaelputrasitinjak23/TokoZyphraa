const { rateLimit } = require('express-rate-limit');
const RateLimitCounter = require('../models/RateLimitCounter');

class MongoRateLimitStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.windowMs = 60000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  key(key) {
    return `${this.prefix}:${key}`;
  }

  async increment(key) {
    const id = this.key(key);
    const now = new Date();
    const resetAt = new Date(now.getTime() + this.windowMs);

    const reset = await RateLimitCounter.findOneAndUpdate(
      { _id: id, resetAt: { $lte: now } },
      { $set: { hits: 1, resetAt } },
      { new: true }
    ).lean();
    if (reset) return { totalHits: reset.hits, resetTime: reset.resetAt };

    const active = await RateLimitCounter.findOneAndUpdate(
      { _id: id, resetAt: { $gt: now } },
      { $inc: { hits: 1 } },
      { new: true }
    ).lean();
    if (active) return { totalHits: active.hits, resetTime: active.resetAt };

    try {
      const created = await RateLimitCounter.create({ _id: id, hits: 1, resetAt });
      return { totalHits: created.hits, resetTime: created.resetAt };
    } catch (error) {
      if (error.code !== 11000) throw error;
      const retried = await RateLimitCounter.findOneAndUpdate(
        { _id: id },
        { $inc: { hits: 1 } },
        { new: true }
      ).lean();
      return { totalHits: retried.hits, resetTime: retried.resetAt };
    }
  }

  async decrement(key) {
    await RateLimitCounter.updateOne({ _id: this.key(key), hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    await RateLimitCounter.deleteOne({ _id: this.key(key) });
  }
}

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipFailedRequests: false,
  handler: (req, res) => res.status(429).render('error', {
    title: 'Terlalu Banyak Permintaan',
    status: 429,
    message: 'Terlalu banyak percobaan. Silakan coba lagi beberapa saat.'
  })
};

const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  store: new MongoRateLimitStore('auth')
});
const otpLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 8,
  store: new MongoRateLimitStore('otp')
});
const paymentLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 30,
  store: new MongoRateLimitStore('payment')
});
const captchaLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 60,
  store: new MongoRateLimitStore('captcha')
});

module.exports = { authLimiter, otpLimiter, paymentLimiter, captchaLimiter };

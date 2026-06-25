const mongoose = require('mongoose');

const rateLimitCounterSchema = new mongoose.Schema({
  _id: { type: String },
  hits: { type: Number, required: true, min: 0 },
  resetAt: { type: Date, required: true, index: { expires: 0 } }
}, { versionKey: false });

module.exports = mongoose.models.RateLimitCounter || mongoose.model('RateLimitCounter', rateLimitCounterSchema);

const mongoose = require('mongoose');

const systemLockSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  version: {
    type: Number,
    default: 0,
    min: 0,
    validate: { validator: Number.isSafeInteger, message: 'Versi lock sistem tidak valid.' }
  }
}, { timestamps: true });

module.exports = mongoose.models.SystemLock || mongoose.model('SystemLock', systemLockSchema);

const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema({
  ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderRole: { type: String, enum: ['user', 'admin'], required: true },
  message: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 }
}, { timestamps: true });

supportMessageSchema.index({ ticket: 1, createdAt: 1 });

module.exports = mongoose.models.SupportMessage || mongoose.model('SupportMessage', supportMessageSchema);

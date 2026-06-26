const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema({
  ticketNumber: { type: String, required: true, unique: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  subject: { type: String, required: true, trim: true, minlength: 5, maxlength: 160 },
  category: {
    type: String,
    enum: ['product', 'payment', 'refund', 'account', 'download', 'other'],
    default: 'other',
    index: true
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'resolved', 'closed'],
    default: 'open',
    index: true
  },
  priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  lastReplyBy: { type: String, enum: ['user', 'admin'], default: 'user' },
  closedAt: { type: Date, default: null }
}, { timestamps: true });

supportTicketSchema.index({ user: 1, lastMessageAt: -1 });
supportTicketSchema.index({ status: 1, priority: -1, lastMessageAt: -1 });

module.exports = mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);

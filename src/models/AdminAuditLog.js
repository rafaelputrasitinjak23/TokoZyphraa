const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true, maxlength: 100, index: true },
  targetType: { type: String, required: true, maxlength: 60 },
  targetId: { type: String, required: true, maxlength: 120 },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '', maxlength: 100 }
}, { timestamps: true });

adminAuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.models.AdminAuditLog || mongoose.model('AdminAuditLog', adminAuditLogSchema);

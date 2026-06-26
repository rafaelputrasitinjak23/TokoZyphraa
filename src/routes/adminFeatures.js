const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const SerialKey = require('../models/SerialKey');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const AdminAuditLog = require('../models/AdminAuditLog');
const { requireAdmin, requirePermission } = require('../middleware/auth');
const noStore = require('../middleware/noStore');
const { createNotification } = require('../services/notificationService');
const { withMongoTransaction } = require('../utils/transaction');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
router.use(noStore);
router.use(requireAdmin);

async function audit(req, action, targetType, targetId, details = {}) {
  await AdminAuditLog.create({
    admin: req.session.user.id,
    action,
    targetType,
    targetId: String(targetId),
    details,
    ip: req.ip
  });
}

router.get('/tickets', requirePermission('tickets'), asyncHandler(async (req, res) => {
  const allowedStatuses = new Set(['open', 'in_progress', 'resolved', 'closed']);
  const status = allowedStatuses.has(req.query.status) ? req.query.status : '';
  const filter = status ? { status } : {};
  const tickets = await SupportTicket.find(filter)
    .populate('user', 'name email')
    .populate('order', 'orderNumber status')
    .sort({ priority: -1, lastMessageAt: -1 })
    .limit(250)
    .lean();
  res.render('admin/tickets/index', { title: 'Tiket Bantuan', tickets, selectedStatus: status });
}));

router.get('/tickets/:ticketNumber', requirePermission('tickets'), asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findOne({ ticketNumber: req.params.ticketNumber })
    .populate('user', 'name email')
    .populate('order', 'orderNumber status')
    .lean();
  if (!ticket) return res.sendStatus(404);
  const messages = await SupportMessage.find({ ticket: ticket._id }).populate('sender', 'name role').sort({ createdAt: 1 }).lean();
  res.render('admin/tickets/detail', { title: ticket.ticketNumber, ticket, messages });
}));

router.post('/tickets/:ticketNumber/messages', requirePermission('tickets'), asyncHandler(async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (message.length < 1 || message.length > 4000) {
    req.flash('error', 'Pesan harus terdiri dari 1–4000 karakter.');
    return res.redirect(`/admin/tickets/${req.params.ticketNumber}`);
  }
  const ticket = await SupportTicket.findOne({ ticketNumber: req.params.ticketNumber });
  if (!ticket || ticket.status === 'closed') {
    req.flash('error', 'Tiket tidak ditemukan atau sudah ditutup.');
    return res.redirect('/admin/tickets');
  }
  await SupportMessage.create({ ticket: ticket._id, sender: req.session.user.id, senderRole: 'admin', message });
  ticket.lastMessageAt = new Date();
  ticket.lastReplyBy = 'admin';
  if (ticket.status === 'open') ticket.status = 'in_progress';
  await ticket.save();
  await createNotification({
    userId: ticket.user,
    type: 'ticket',
    title: 'Admin membalas tiket Anda',
    message: `${ticket.ticketNumber}: ${ticket.subject}`,
    link: `/account/tickets/${ticket.ticketNumber}`,
    idempotencyKey: `ticket-admin-reply:${ticket.ticketNumber}:${ticket.lastMessageAt.getTime()}`
  });
  await audit(req, 'ticket.reply', 'SupportTicket', ticket._id, { ticketNumber: ticket.ticketNumber });
  res.redirect(`/admin/tickets/${ticket.ticketNumber}`);
}));

router.post('/tickets/:ticketNumber/status', requirePermission('tickets'), asyncHandler(async (req, res) => {
  const allowedStatuses = new Set(['open', 'in_progress', 'resolved', 'closed']);
  const status = allowedStatuses.has(req.body.status) ? req.body.status : null;
  const priority = ['low', 'normal', 'high', 'urgent'].includes(req.body.priority) ? req.body.priority : 'normal';
  if (!status) return res.sendStatus(400);
  const ticket = await SupportTicket.findOne({ ticketNumber: req.params.ticketNumber });
  if (!ticket) return res.sendStatus(404);
  const previousStatus = ticket.status;
  ticket.status = status;
  ticket.priority = priority;
  ticket.closedAt = status === 'closed' ? new Date() : null;
  await ticket.save();
  await createNotification({
    userId: ticket.user,
    type: 'ticket',
    title: 'Status tiket diperbarui',
    message: `Tiket ${ticket.ticketNumber} sekarang berstatus ${status}.`,
    link: `/account/tickets/${ticket.ticketNumber}`,
    idempotencyKey: `ticket-status:${ticket.ticketNumber}:${status}:${ticket.updatedAt.getTime()}`
  });
  await audit(req, 'ticket.status', 'SupportTicket', ticket._id, { from: previousStatus, to: status, priority });
  req.flash('success', 'Status tiket diperbarui.');
  res.redirect(`/admin/tickets/${ticket.ticketNumber}`);
}));

router.get('/products/:productId/serial-keys', requirePermission('products'), asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.productId).lean();
  if (!product) return res.sendStatus(404);
  const [keys, counts] = await Promise.all([
    SerialKey.find({ product: product._id }).select('+value').populate('user', 'name email').populate('order', 'orderNumber').sort({ createdAt: -1 }).limit(300).lean(),
    SerialKey.aggregate([
      { $match: { product: new mongoose.Types.ObjectId(product._id) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
  ]);
  const summary = { available: 0, assigned: 0, disabled: 0 };
  counts.forEach((row) => { summary[row._id] = row.count; });
  res.render('admin/serial-keys/index', { title: `Serial Key ${product.name}`, product, keys, summary });
}));

router.post('/products/:productId/serial-keys', requirePermission('products'), asyncHandler(async (req, res) => {
  const normalizedEntries = new Map();
  String(req.body.serialKeys || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      const normalizedValue = value.toUpperCase();
      if (!normalizedEntries.has(normalizedValue) && normalizedEntries.size < 5000) {
        normalizedEntries.set(normalizedValue, value);
      }
    });
  const values = [...normalizedEntries.entries()];
  if (!values.length) {
    req.flash('error', 'Masukkan minimal satu serial key.');
    return res.redirect(`/admin/products/${req.params.productId}/serial-keys`);
  }

  const result = await withMongoTransaction(async (session) => {
    const product = await Product.findById(req.params.productId).session(session);
    if (!product) return { notFound: true };
    const operations = values.map(([normalizedValue, value]) => ({
      updateOne: {
        filter: { product: product._id, normalizedValue },
        update: { $setOnInsert: { product: product._id, value, normalizedValue, status: 'available' } },
        upsert: true
      }
    }));
    const writeResult = await SerialKey.bulkWrite(operations, { session, ordered: false });
    const inserted = writeResult.upsertedCount || 0;
    const available = await SerialKey.countDocuments({ product: product._id, status: 'available' }).session(session);
    product.serialKeyEnabled = true;
    product.stock = available;
    await product.save({ session });
    return { product, inserted };
  });
  if (result.notFound) return res.sendStatus(404);
  await audit(req, 'serial.bulk_add', 'Product', result.product._id, { inserted: result.inserted, submitted: values.length });
  req.flash('success', `${result.inserted} serial key baru ditambahkan. Duplikat dilewati.`);
  res.redirect(`/admin/products/${req.params.productId}/serial-keys`);
}));

router.post('/serial-keys/:id/disable', requirePermission('products'), asyncHandler(async (req, res) => {
  const result = await withMongoTransaction(async (session) => {
    const serial = await SerialKey.findOneAndUpdate(
      { _id: req.params.id, status: 'available' },
      { $set: { status: 'disabled' } },
      { new: true, session }
    );
    if (!serial) return null;
    const available = await SerialKey.countDocuments({ product: serial.product, status: 'available' }).session(session);
    await Product.updateOne({ _id: serial.product }, { $set: { stock: available } }, { session, runValidators: true });
    return serial;
  });
  if (!result) {
    req.flash('error', 'Serial key tidak ditemukan atau sudah digunakan.');
    return res.redirect('/admin/products');
  }
  await audit(req, 'serial.disable', 'SerialKey', result._id, { product: result.product });
  req.flash('success', 'Serial key dinonaktifkan.');
  res.redirect(`/admin/products/${result.product}/serial-keys`);
}));

module.exports = router;

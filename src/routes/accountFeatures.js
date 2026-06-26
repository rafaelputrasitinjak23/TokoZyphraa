const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product');
const Order = require('../models/Order');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const { requireUser } = require('../middleware/auth');
const noStore = require('../middleware/noStore');
const { parsePage } = require('../utils/input');
const { safeRefererPath } = require('../utils/redirect');
const { calculateProductPrice } = require('../utils/order');
const { withMongoTransaction } = require('../utils/transaction');
const { createNotification, notifyAdmins } = require('../services/notificationService');
const { redeemPoints } = require('../services/loyaltyService');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const PAGE_SIZE = 20;
const projectRoot = path.resolve(__dirname, '../..');
const privateRoot = path.resolve(projectRoot, 'private_uploads/products');

router.use(noStore);
router.use(requireUser);

function makeTicketNumber() {
  return `TKT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

router.get('/notifications', asyncHandler(async (req, res) => {
  const page = parsePage(req.query.page);
  const filter = { user: req.session.user.id };
  const [notifications, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Notification.countDocuments(filter)
  ]);
  res.render('account/notifications', {
    title: 'Notifikasi',
    notifications,
    pagination: { page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)), query: {} }
  });
}));

router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany(
    { user: req.session.user.id, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
  res.redirect('/account/notifications');
}));

router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
  if (mongoose.isValidObjectId(req.params.id)) {
    await Notification.updateOne(
      { _id: req.params.id, user: req.session.user.id },
      { $set: { isRead: true, readAt: new Date() } }
    );
  }
  res.redirect(safeRefererPath(req, '/account/notifications'));
}));

router.get('/wishlist', asyncHandler(async (req, res) => {
  const rows = await Wishlist.find({ user: req.session.user.id })
    .populate({ path: 'product', match: { isActive: true } })
    .sort({ createdAt: -1 })
    .lean();
  const products = rows
    .filter((row) => row.product)
    .map((row) => ({ ...row.product, effectivePrice: calculateProductPrice(row.product), isWishlisted: true }));
  res.render('account/wishlist', { title: 'Wishlist', products });
}));

router.post('/wishlist/:productId/toggle', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.productId) || !await Product.exists({ _id: req.params.productId, isActive: true })) {
    req.flash('error', 'Produk tidak ditemukan.');
    return res.redirect(safeRefererPath(req, '/'));
  }
  const existing = await Wishlist.findOne({ user: req.session.user.id, product: req.params.productId });
  if (existing) {
    await existing.deleteOne();
    req.flash('success', 'Produk dihapus dari wishlist.');
  } else {
    await Wishlist.create({ user: req.session.user.id, product: req.params.productId });
    req.flash('success', 'Produk ditambahkan ke wishlist.');
  }
  res.redirect(safeRefererPath(req, '/account/wishlist'));
}));

router.get('/tickets', asyncHandler(async (req, res) => {
  const tickets = await SupportTicket.find({ user: req.session.user.id })
    .populate('order', 'orderNumber')
    .sort({ lastMessageAt: -1 })
    .limit(100)
    .lean();
  res.render('account/tickets', { title: 'Bantuan & Komplain', tickets });
}));

router.get('/tickets/new', asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.session.user.id }).select('orderNumber status createdAt').sort({ createdAt: -1 }).limit(50).lean();
  res.render('account/ticket-new', {
    title: 'Buat Tiket Bantuan',
    orders,
    selectedOrder: String(req.query.order || '')
  });
}));

router.post('/tickets', asyncHandler(async (req, res) => {
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();
  const allowedCategories = new Set(['product', 'payment', 'refund', 'account', 'download', 'other']);
  const category = allowedCategories.has(req.body.category) ? req.body.category : 'other';
  if (subject.length < 5 || subject.length > 160 || message.length < 5 || message.length > 4000) {
    req.flash('error', 'Subjek atau isi pesan tidak valid.');
    return res.redirect('/account/tickets/new');
  }

  let order = null;
  if (req.body.orderNumber) {
    order = await Order.findOne({ orderNumber: String(req.body.orderNumber), user: req.session.user.id }).select('_id orderNumber').lean();
    if (!order) {
      req.flash('error', 'Pesanan yang dipilih tidak ditemukan.');
      return res.redirect('/account/tickets/new');
    }
  }

  const ticket = await withMongoTransaction(async (session) => {
    const [created] = await SupportTicket.create([{
      ticketNumber: makeTicketNumber(),
      user: req.session.user.id,
      order: order?._id || null,
      subject,
      category,
      lastMessageAt: new Date(),
      lastReplyBy: 'user'
    }], { session });
    await SupportMessage.create([{
      ticket: created._id,
      sender: req.session.user.id,
      senderRole: 'user',
      message
    }], { session });
    await createNotification({
      userId: req.session.user.id,
      type: 'ticket',
      title: 'Tiket bantuan dibuat',
      message: `Tiket ${created.ticketNumber} telah diterima oleh tim admin.`,
      link: `/account/tickets/${created.ticketNumber}`,
      idempotencyKey: `ticket-created-user:${created.ticketNumber}`,
      session
    });
    return created;
  });

  await notifyAdmins({
    type: 'ticket',
    adminPermission: 'tickets',
    title: 'Tiket bantuan baru',
    message: `${ticket.ticketNumber}: ${ticket.subject}`,
    link: `/admin/tickets/${ticket.ticketNumber}`,
    idempotencyKey: `ticket-created-admin:${ticket.ticketNumber}`
  });
  req.flash('success', 'Tiket bantuan berhasil dibuat.');
  res.redirect(`/account/tickets/${ticket.ticketNumber}`);
}));

router.get('/tickets/:ticketNumber', asyncHandler(async (req, res) => {
  const ticket = await SupportTicket.findOne({ ticketNumber: req.params.ticketNumber, user: req.session.user.id })
    .populate('order', 'orderNumber status')
    .lean();
  if (!ticket) return res.sendStatus(404);
  const messages = await SupportMessage.find({ ticket: ticket._id }).populate('sender', 'name role').sort({ createdAt: 1 }).lean();
  res.render('account/ticket-detail', { title: ticket.ticketNumber, ticket, messages });
}));

router.post('/tickets/:ticketNumber/messages', asyncHandler(async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (message.length < 1 || message.length > 4000) {
    req.flash('error', 'Pesan harus terdiri dari 1–4000 karakter.');
    return res.redirect(`/account/tickets/${req.params.ticketNumber}`);
  }
  const ticket = await SupportTicket.findOne({ ticketNumber: req.params.ticketNumber, user: req.session.user.id });
  if (!ticket || ticket.status === 'closed') {
    req.flash('error', 'Tiket tidak ditemukan atau sudah ditutup.');
    return res.redirect('/account/tickets');
  }
  await SupportMessage.create({ ticket: ticket._id, sender: req.session.user.id, senderRole: 'user', message });
  ticket.lastMessageAt = new Date();
  ticket.lastReplyBy = 'user';
  if (ticket.status === 'resolved') ticket.status = 'open';
  await ticket.save();
  await notifyAdmins({
    type: 'ticket',
    adminPermission: 'tickets',
    title: 'Balasan tiket dari pengguna',
    message: `${ticket.ticketNumber}: ${ticket.subject}`,
    link: `/admin/tickets/${ticket.ticketNumber}`,
    idempotencyKey: `ticket-user-reply:${ticket.ticketNumber}:${ticket.lastMessageAt.getTime()}`
  });
  res.redirect(`/account/tickets/${ticket.ticketNumber}`);
}));

router.post('/loyalty/redeem', asyncHandler(async (req, res) => {
  const points = Number(req.body.points);
  const result = await redeemPoints({ userId: req.session.user.id, points, token: req.body.redeemToken });
  req.flash('success', result.duplicate
    ? 'Permintaan penukaran poin tersebut sudah diproses.'
    : `${points} poin berhasil ditukar menjadi saldo dompet.`);
  res.redirect('/account#loyalty');
}));

router.get('/downloads/:orderNumber/:itemIndex', asyncHandler(async (req, res) => {
  const itemIndex = Number(req.params.itemIndex);
  if (!Number.isSafeInteger(itemIndex) || itemIndex < 0 || itemIndex > 1000) return res.sendStatus(400);

  const order = await Order.findOne({
    orderNumber: req.params.orderNumber,
    user: req.session.user.id,
    status: 'completed'
  }).lean();
  const item = order?.items?.[itemIndex];
  if (!order || !item || item.deliveryType !== 'digital' || !['local', 'url'].includes(item.digitalAsset?.type)) {
    return res.status(404).render('error', { title: 'File Tidak Ditemukan', status: 404, message: 'File digital tidak tersedia untuk pesanan ini.' });
  }

  let targetUrl = null;
  let absolutePath = null;
  if (item.digitalAsset.type === 'url') {
    try {
      targetUrl = new URL(item.digitalAsset.url);
    } catch (_) {
      return res.status(404).render('error', { title: 'Link Tidak Valid', status: 404, message: 'Link produk digital tidak tersedia.' });
    }
    if (targetUrl.protocol !== 'https:') return res.sendStatus(403);
  } else {
    absolutePath = path.resolve(projectRoot, item.digitalAsset.filePath || '');
    if (!absolutePath.startsWith(`${privateRoot}${path.sep}`) || !fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return res.status(404).render('error', { title: 'File Tidak Ditemukan', status: 404, message: 'File digital tidak tersedia di penyimpanan server.' });
    }
  }

  const limit = Number(item.digitalAsset.downloadLimit || 0);
  const filter = { _id: order._id, user: req.session.user.id, status: 'completed' };
  if (limit > 0) filter[`items.${itemIndex}.digitalAsset.downloadCount`] = { $lt: limit };
  const updated = await Order.findOneAndUpdate(
    filter,
    {
      $inc: { [`items.${itemIndex}.digitalAsset.downloadCount`]: 1 },
      $set: { [`items.${itemIndex}.digitalAsset.lastDownloadedAt`]: new Date() }
    },
    { new: true }
  );
  if (!updated) {
    return res.status(403).render('error', { title: 'Batas Unduhan Tercapai', status: 403, message: 'Batas unduhan produk digital ini telah tercapai. Buat tiket bantuan jika Anda memerlukan akses kembali.' });
  }

  if (targetUrl) return res.redirect(targetUrl.toString());
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  return res.download(absolutePath, item.digitalAsset.fileName || path.basename(absolutePath));
}));

router.get('/loyalty/history', asyncHandler(async (req, res) => {
  const transactions = await LoyaltyTransaction.find({ user: req.session.user.id }).sort({ createdAt: -1 }).limit(100).lean();
  res.render('account/loyalty-history', { title: 'Riwayat Poin', transactions });
}));

module.exports = router;

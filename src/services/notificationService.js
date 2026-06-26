const Notification = require('../models/Notification');
const User = require('../models/User');

async function createNotification({ userId, type = 'system', title, message, link = '', idempotencyKey = null, metadata = {}, session = null }) {
  const payload = {
    user: userId,
    type,
    title: String(title || '').trim().slice(0, 140),
    message: String(message || '').trim().slice(0, 1000),
    link: String(link || '').trim().slice(0, 500),
    idempotencyKey,
    metadata
  };
  if (!payload.title || !payload.message) return null;

  if (idempotencyKey) {
    return Notification.findOneAndUpdate(
      { user: userId, idempotencyKey },
      { $setOnInsert: payload },
      { upsert: true, new: true, session, setDefaultsOnInsert: true }
    );
  }

  const [notification] = await Notification.create([payload], session ? { session } : undefined);
  return notification;
}

async function notifyAdmins(payload, session = null) {
  const { adminPermission, ...notificationPayload } = payload;
  const filter = { role: 'admin', isActive: true };
  if (adminPermission) {
    filter.$or = [
      { adminPermissions: { $exists: false } },
      { adminPermissions: { $size: 0 } },
      { adminPermissions: adminPermission }
    ];
  }
  const admins = await User.find(filter).select('_id').session(session || null).lean();
  const notifications = [];
  for (const admin of admins) {
    notifications.push(await createNotification({ ...notificationPayload, userId: admin._id, session }));
  }
  return notifications;
}

async function notifyOrderCreated(order, session = null) {
  await createNotification({
    userId: order.user,
    type: 'order',
    title: 'Pesanan berhasil dibuat',
    message: `Pesanan ${order.orderNumber} telah dibuat dan menunggu proses pembayaran.`,
    link: `/account/orders/${order.orderNumber}`,
    idempotencyKey: `order-created:${order.orderNumber}`,
    metadata: { orderNumber: order.orderNumber },
    session
  });
}

async function notifyOrderCompleted(order, session = null) {
  await createNotification({
    userId: order.user,
    type: 'order',
    title: 'Pesanan selesai',
    message: `Pembayaran pesanan ${order.orderNumber} telah terverifikasi. Produk digital Anda sudah dapat diakses.`,
    link: `/account/orders/${order.orderNumber}`,
    idempotencyKey: `order-completed:${order.orderNumber}`,
    metadata: { orderNumber: order.orderNumber },
    session
  });
}

async function notifyOrderCancelled(order, session = null) {
  await createNotification({
    userId: order.user,
    type: 'order',
    title: order.status === 'expired' ? 'Pesanan kedaluwarsa' : 'Pesanan dibatalkan',
    message: `Pesanan ${order.orderNumber} berstatus ${order.status}. Saldo dan voucher dikembalikan bila sebelumnya digunakan.`,
    link: `/account/orders/${order.orderNumber}`,
    idempotencyKey: `order-${order.status}:${order.orderNumber}`,
    metadata: { orderNumber: order.orderNumber, status: order.status },
    session
  });
}

async function notifyWalletTopup(topup, session = null) {
  await createNotification({
    userId: topup.user,
    type: 'wallet',
    title: 'Top up berhasil',
    message: `Top up ${topup.topupNumber} telah masuk ke saldo dompet Anda.`,
    link: '/account/wallet',
    idempotencyKey: `topup-completed:${topup.topupNumber}`,
    metadata: { topupNumber: topup.topupNumber, amount: topup.amount },
    session
  });
}

module.exports = {
  createNotification,
  notifyAdmins,
  notifyOrderCreated,
  notifyOrderCompleted,
  notifyOrderCancelled,
  notifyWalletTopup
};

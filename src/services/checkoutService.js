const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const WalletTransaction = require('../models/WalletTransaction');
const { MAX_CART_QUANTITY, MAX_CART_ITEMS } = require('../constants/limits');
const { calculateProductPrice, makeOrderNumber } = require('../utils/order');
const { reserveVoucher } = require('../utils/voucher');
const { withMongoTransaction } = require('../utils/transaction');
const { notifyOrderCreated, notifyAdmins } = require('./notificationService');

function normalizeCart(cart) {
  const merged = new Map();
  for (const entry of Array.isArray(cart) ? cart : []) {
    const productId = String(entry.productId || '');
    const quantity = Number(entry.quantity);
    if (!mongoose.isValidObjectId(productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_CART_QUANTITY) {
      const error = new Error('Isi keranjang tidak valid. Muat ulang keranjang lalu coba kembali.');
      error.status = 400;
      throw error;
    }
    const nextQuantity = (merged.get(productId) || 0) + quantity;
    if (nextQuantity > MAX_CART_QUANTITY) {
      const error = new Error(`Jumlah maksimal per produk adalah ${MAX_CART_QUANTITY}.`);
      error.status = 400;
      throw error;
    }
    merged.set(productId, nextQuantity);
  }

  if (merged.size > MAX_CART_ITEMS) {
    const error = new Error(`Keranjang maksimal memuat ${MAX_CART_ITEMS} produk berbeda.`);
    error.status = 400;
    throw error;
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

function normalizeShipping(input, required) {
  if (!required) return null;
  const shipping = {
    receiverName: String(input.receiverName || '').trim(),
    phone: String(input.shippingPhone || '').trim(),
    address: String(input.shippingAddress || '').trim(),
    city: String(input.shippingCity || '').trim(),
    postalCode: String(input.shippingPostalCode || '').trim()
  };
  if (shipping.receiverName.length < 2 || shipping.receiverName.length > 80) throw new Error('Nama penerima tidak valid.');
  if (!/^[0-9+()\-\s]{8,24}$/.test(shipping.phone)) throw new Error('Nomor telepon penerima tidak valid.');
  if (shipping.address.length < 10 || shipping.address.length > 500) throw new Error('Alamat pengiriman harus terdiri dari 10–500 karakter.');
  if (shipping.city.length < 2 || shipping.city.length > 100) throw new Error('Kota pengiriman tidak valid.');
  if (!/^[0-9]{5,10}$/.test(shipping.postalCode)) throw new Error('Kode pos tidak valid.');
  return shipping;
}

async function createCheckoutOrder({ userId, cart, voucherCode, useWallet, paymentMethod, checkoutToken, shippingInput }) {
  if (!/^[a-f0-9-]{32,80}$/i.test(String(checkoutToken || ''))) {
    const error = new Error('Token checkout tidak valid. Muat ulang halaman checkout.');
    error.status = 400;
    throw error;
  }

  const existingOrder = await Order.findOne({ user: userId, checkoutToken });
  if (existingOrder) return { order: existingOrder, created: false };

  const normalizedCart = normalizeCart(cart);
  if (!normalizedCart.length) {
    const error = new Error('Keranjang Anda masih kosong.');
    error.status = 400;
    throw error;
  }

  try {
    return await withMongoTransaction(async (session) => {
      const existing = await Order.findOne({ user: userId, checkoutToken }).session(session);
      if (existing) return { order: existing, created: false };

      const user = await User.findOne({ _id: userId, isActive: true }).session(session);
      if (!user) {
        const error = new Error('Akun pengguna tidak aktif atau tidak ditemukan.');
        error.status = 403;
        throw error;
      }

      const productIds = normalizedCart.map((entry) => entry.productId);
      const products = await Product.find({ _id: { $in: productIds }, isActive: true }).session(session);
      const productMap = new Map(products.map((product) => [String(product._id), product]));
      const items = normalizedCart.map((entry) => {
        const product = productMap.get(entry.productId);
        if (!product) throw new Error('Salah satu produk tidak lagi tersedia.');
        if (product.stock < entry.quantity) throw new Error(`Stok ${product.name} tidak mencukupi.`);
        const unitPrice = calculateProductPrice(product);
        const lineTotal = unitPrice * entry.quantity;
        if (!Number.isSafeInteger(unitPrice) || !Number.isSafeInteger(lineTotal)) {
          throw new Error(`Harga ${product.name} tidak valid.`);
        }
        return { product, quantity: entry.quantity, unitPrice, lineTotal };
      });

      const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
      if (!Number.isSafeInteger(subtotal)) throw new Error('Total belanja tidak valid.');
      const voucherResult = await reserveVoucher({ code: voucherCode, subtotal, userId: user._id, session });
      const afterDiscount = subtotal - voucherResult.discount;
      const walletUsed = useWallet ? Math.min(user.walletBalance, afterDiscount) : 0;
      const payableAmount = afterDiscount - walletUsed;
      const requiresShipping = items.some((item) => item.product.deliveryType === 'physical');
      const shippingAddress = normalizeShipping(shippingInput, requiresShipping);
      const orderNumber = makeOrderNumber();

      if (walletUsed > 0) {
        const debitedUser = await User.findOneAndUpdate(
          { _id: user._id, walletBalance: { $gte: walletUsed } },
          { $inc: { walletBalance: -walletUsed } },
          { new: true, session, runValidators: true }
        );
        if (!debitedUser) throw new Error('Saldo dompet berubah. Silakan ulangi checkout.');
        user.walletBalance = debitedUser.walletBalance;
      }

      const [order] = await Order.create([{
        orderNumber,
        checkoutToken,
        user: user._id,
        items: items.map((item) => ({
          product: item.product._id,
          name: item.product.name,
          slug: item.product.slug,
          imageUrl: item.product.imageUrl,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          lineTotal: item.lineTotal,
          deliveryType: item.product.deliveryType,
          fulfillmentContent: item.product.fulfillmentContent || '',
          serialKeyEnabled: Boolean(item.product.serialKeyEnabled),
          digitalAsset: {
            type: item.product.digitalAssetType === 'url' ? 'url' : 'none',
            fileName: item.product.digitalFileName || '',
            url: item.product.digitalFileUrl || '',
            downloadLimit: item.product.downloadLimit ?? 5,
            downloadCount: 0
          }
        })),
        shippingAddress,
        subtotal,
        discountAmount: voucherResult.discount,
        voucher: voucherResult.voucher?._id || null,
        voucherCode: voucherResult.voucher?.code || null,
        walletUsed,
        payableAmount,
        totalPayment: payableAmount,
        paymentMethod: payableAmount > 0 ? paymentMethod : 'wallet/free'
      }], { session });

      if (walletUsed > 0) {
        await WalletTransaction.create([{
          user: user._id,
          type: 'debit',
          amount: walletUsed,
          balanceAfter: user.walletBalance,
          source: 'order',
          reference: orderNumber,
          idempotencyKey: `order-debit:${orderNumber}`,
          note: 'Pembayaran pesanan'
        }], { session });
      }

      await notifyOrderCreated(order, session);
      await notifyAdmins({
        type: 'order',
        adminPermission: 'orders',
        title: 'Pesanan baru',
        message: `${order.orderNumber} dibuat dengan total ${subtotal}.`,
        link: '/admin/orders',
        idempotencyKey: `order-created-admin:${order.orderNumber}`,
        metadata: { orderNumber: order.orderNumber, subtotal }
      }, session);
      return { order, created: true };
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await Order.findOne({ user: userId, checkoutToken });
      if (existing) return { order: existing, created: false };
    }
    throw error;
  }
}

module.exports = { createCheckoutOrder, normalizeCart };

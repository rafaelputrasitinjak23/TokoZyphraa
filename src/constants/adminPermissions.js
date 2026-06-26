const ADMIN_PERMISSIONS = Object.freeze([
  { key: 'analytics', label: 'Dashboard analitik' },
  { key: 'products', label: 'Produk, file digital, dan serial key' },
  { key: 'orders', label: 'Pesanan' },
  { key: 'users', label: 'Pengguna, role, dan permission' },
  { key: 'wallet', label: 'Dompet dan top up' },
  { key: 'tickets', label: 'Tiket bantuan dan komplain' },
  { key: 'vouchers', label: 'Voucher' },
  { key: 'reviews', label: 'Ulasan' }
]);

const ADMIN_PERMISSION_KEYS = Object.freeze(ADMIN_PERMISSIONS.map((item) => item.key));

function normalizePermissions(values) {
  const requested = Array.isArray(values) ? values : values ? [values] : [];
  return [...new Set(requested.filter((value) => ADMIN_PERMISSION_KEYS.includes(value)))];
}

const PERMISSION_ROUTES = Object.freeze({
  analytics: '/admin',
  products: '/admin/products',
  orders: '/admin/orders',
  users: '/admin/users',
  wallet: '/admin/topups',
  tickets: '/admin/tickets',
  vouchers: '/admin/vouchers',
  reviews: '/admin/reviews'
});

function hasAdminPermission(user, permission) {
  if (!user || user.role !== 'admin') return false;
  const permissions = Array.isArray(user.adminPermissions) ? user.adminPermissions : [];
  return permissions.length === 0 || permissions.includes(permission);
}

function adminLandingPath(user) {
  if (!user || user.role !== 'admin') return '/account';
  const allowed = ADMIN_PERMISSION_KEYS.find((permission) => hasAdminPermission(user, permission));
  return allowed ? PERMISSION_ROUTES[allowed] : '/account';
}

module.exports = { ADMIN_PERMISSIONS, ADMIN_PERMISSION_KEYS, normalizePermissions, hasAdminPermission, adminLandingPath };

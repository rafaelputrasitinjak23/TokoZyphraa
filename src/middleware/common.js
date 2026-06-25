const crypto = require('crypto');

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function flashMiddleware(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, message) => setFlash(req, type, message);
  next();
}

function attachLocals(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  res.locals.currentUser = req.session.user || null;
  res.locals.isAdmin = req.session.user?.role === 'admin';
  res.locals.csrfToken = req.session.csrfToken;
  res.locals.cartCount = (req.session.cart || []).reduce((total, item) => total + item.quantity, 0);
  res.locals.currentPath = req.path;
  res.locals.appName = 'TokoZyphra';
  res.locals.enableClientProtection = process.env.ENABLE_CLIENT_PROTECTION !== 'false';
  res.locals.formatRupiah = (value) => new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(Number(value || 0));
  res.locals.formatDate = (value) => value ? new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta'
  }).format(new Date(value)) : '-';
  next();
}

function csrfMiddleware(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const supplied = String(req.body?._csrf || req.get('x-csrf-token') || '');
  const expected = String(req.session.csrfToken || '');
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (!supplied || !expected || suppliedBuffer.length !== expectedBuffer.length) {
    return res.status(403).render('error', {
      title: 'Permintaan Ditolak', status: 403,
      message: 'Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.'
    });
  }
  const valid = crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
  if (!valid) {
    return res.status(403).render('error', {
      title: 'Permintaan Ditolak', status: 403,
      message: 'Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.'
    });
  }
  next();
}

module.exports = { attachLocals, flashMiddleware, csrfMiddleware, setFlash };

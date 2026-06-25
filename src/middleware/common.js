const crypto = require('crypto');

const CSRF_COOKIE = 'tz.csrf';

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) return cookies;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch (_) {
      cookies[key] = '';
    }
    return cookies;
  }, {});
}

function csrfSignature(token) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(token).digest('hex');
}

function readCsrfCookie(req) {
  const value = parseCookies(req.get('cookie'))[CSRF_COOKIE] || '';
  const [token, signature] = value.split('.');
  if (!/^[a-f0-9]{64}$/.test(token || '') || !/^[a-f0-9]{64}$/.test(signature || '')) return '';
  const expected = csrfSignature(token);
  const suppliedBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return suppliedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
    ? token
    : '';
}

function ensureCsrfToken(req, res) {
  let token = readCsrfCookie(req);
  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, `${token}.${csrfSignature(token)}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 7
    });
  }
  return token;
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function flashMiddleware(req, res, next) {
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) delete req.session.flash;
  req.flash = (type, message) => setFlash(req, type, message);
  next();
}

function attachLocals(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.canAccessAdmin = req.session.user?.role === 'admin';
  res.locals.isAdmin = req.path === '/admin' || req.path.startsWith('/admin/');
  res.locals.csrfToken = ensureCsrfToken(req, res);
  res.locals.cartCount = (req.session.cart || []).reduce((total, item) => {
    const quantity = Number(item.quantity);
    return total + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
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

function renderCsrfError(res) {
  return res.status(403).render('error', {
    title: 'Permintaan Ditolak',
    status: 403,
    message: 'Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.'
  });
}

function csrfMiddleware(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const supplied = String(req.body?._csrf || req.get('x-csrf-token') || '');
  const expected = readCsrfCookie(req);
  if (!supplied || !expected || supplied.length !== expected.length) return renderCsrfError(res);
  const suppliedBuffer = Buffer.from(supplied, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (!crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return renderCsrfError(res);
  next();
}

module.exports = { attachLocals, flashMiddleware, csrfMiddleware, setFlash, ensureCsrfToken };

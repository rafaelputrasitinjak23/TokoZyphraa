const User = require('../models/User');
const { destroySession, sessionUser } = require('../utils/session');

async function loadSessionUser(req) {
  const stored = req.session.user;
  if (!stored?.id) return null;
  const user = await User.findOne({ _id: stored.id, role: stored.role, isActive: true })
    .select('name email role sessionVersion isActive')
    .lean();
  if (!user || Number(user.sessionVersion || 0) !== Number(stored.version || 0)) {
    await destroySession(req);
    return null;
  }
  req.session.user = sessionUser(user, stored.hasAvatar);
  return user;
}

function redirectToLogin(req, res, role) {
  if (req.session) {
    req.flash('error', role === 'admin' ? 'Akses administrator diperlukan.' : 'Silakan masuk terlebih dahulu.');
  }
  return res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireRole(role) {
  return async (req, res, next) => {
    try {
      if (!req.session.user || req.session.user.role !== role) return redirectToLogin(req, res, role);
      const user = await loadSessionUser(req);
      if (!user || user.role !== role) return redirectToLogin(req, res, role);
      req.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function requireGuest(req, res, next) {
  try {
    if (!req.session.user) return next();
    const user = await loadSessionUser(req);
    if (!user) return next();
    return res.redirect(user.role === 'admin' ? '/admin' : '/account');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireUser: requireRole('user'),
  requireAdmin: requireRole('admin'),
  requireGuest,
  loadSessionUser
};

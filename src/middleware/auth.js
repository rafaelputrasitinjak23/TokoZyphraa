const User = require('../models/User');
const { destroySession, sessionUser } = require('../utils/session');
const { hasAdminPermission, adminLandingPath } = require('../constants/adminPermissions');

async function loadSessionUser(req) {
  const stored = req.session.user;
  if (!stored?.id) return null;

  const user = await User.findOne({ _id: stored.id, role: stored.role, isActive: true })
    .select('name email role adminPermissions sessionVersion isActive')
    .lean();

  if (!user || Number(user.sessionVersion || 0) !== Number(stored.version || 0)) {
    await destroySession(req);
    return null;
  }

  req.session.user = sessionUser(user, stored.hasAvatar);
  return user;
}

function redirectToLogin(req, res, adminRequired = false) {
  if (req.session) {
    req.flash('error', adminRequired ? 'Akses administrator diperlukan.' : 'Silakan masuk terlebih dahulu.');
  }
  return res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
}

async function requireAuthenticated(req, res, next) {
  try {
    if (!req.session.user) return redirectToLogin(req, res);
    const user = await loadSessionUser(req);
    if (!user) return redirectToLogin(req, res);
    req.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(req, res, next) {
  try {
    if (!req.session.user) return redirectToLogin(req, res, true);
    const user = await loadSessionUser(req);
    if (!user) return redirectToLogin(req, res, true);
    if (user.role !== 'admin') {
      req.flash('error', 'Akses administrator diperlukan.');
      return res.redirect('/account');
    }
    req.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

function requirePermission(permission) {
  return async function permissionMiddleware(req, res, next) {
    try {
      if (!req.authUser) {
        const user = await loadSessionUser(req);
        if (!user) return redirectToLogin(req, res, true);
        req.authUser = user;
      }
      if (!hasAdminPermission(req.authUser, permission)) {
        req.flash('error', 'Akun admin Anda tidak memiliki permission untuk modul tersebut.');
        return res.redirect(adminLandingPath(req.authUser));
      }
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
    return res.redirect('/account');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireAuthenticated,
  requireUser: requireAuthenticated,
  requireAdmin,
  requirePermission,
  requireGuest,
  loadSessionUser
};

function requireUser(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Silakan masuk terlebih dahulu.');
    return res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

function requireGuest(req, res, next) {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/account');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    req.flash('error', 'Akses administrator diperlukan.');
    return res.redirect('/admin/login');
  }
  next();
}

module.exports = { requireUser, requireGuest, requireAdmin };

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store, private, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
}

module.exports = noStore;

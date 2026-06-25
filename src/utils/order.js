const crypto = require('crypto');

function makeOrderNumber() {
  const date = new Date();
  const ymd = date.toISOString().slice(0, 10).replaceAll('-', '');
  return `TZ-${ymd}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function calculateProductPrice(product) {
  const now = new Date();
  const flashActive = product.isFlashSale && product.flashSalePrice != null &&
    product.flashSaleStart && product.flashSaleEnd &&
    now >= new Date(product.flashSaleStart) && now <= new Date(product.flashSaleEnd);

  if (flashActive) return Math.max(0, Number(product.flashSalePrice));
  if (product.discountPercent > 0) {
    return Math.max(0, Math.round(product.price * (1 - product.discountPercent / 100)));
  }
  return Math.max(0, Number(product.price));
}

module.exports = { makeOrderNumber, calculateProductPrice };

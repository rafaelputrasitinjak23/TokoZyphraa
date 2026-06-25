const PAYMENT_METHODS = Object.freeze([
  'qris',
  'cimb_niaga_va',
  'bni_va',
  'sampoerna_va',
  'bnc_va',
  'maybank_va',
  'permata_va',
  'atm_bersama_va',
  'artha_graha_va',
  'bri_va'
]);

const PAYMENT_METHOD_SET = new Set(PAYMENT_METHODS);

function normalizePaymentMethod(value, fallback = 'qris') {
  return PAYMENT_METHOD_SET.has(value) ? value : fallback;
}

module.exports = { PAYMENT_METHODS, PAYMENT_METHOD_SET, normalizePaymentMethod };

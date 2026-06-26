const crypto = require('crypto');

function parseInteger(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} harus berupa bilangan bulat antara ${min} dan ${max}.`);
  }
  return value;
}

function parseBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} harus bernilai true atau false.`);
}

function isPlaceholder(value) {
  return /^(ganti-|change-me|replace-me|contoh-|example-)/i.test(String(value || '').trim());
}

function validateEnvironment() {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI wajib dikonfigurasi.');

  if (!process.env.SESSION_SECRET) {
    if (isProduction) throw new Error('SESSION_SECRET wajib dikonfigurasi pada production.');
    process.env.SESSION_SECRET = crypto.randomBytes(48).toString('hex');
    console.warn('SESSION_SECRET tidak diatur. Secret sementara dibuat untuk proses development ini.');
  }
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET harus memiliki panjang minimal 32 karakter.');
  }
  if (isProduction && isPlaceholder(process.env.SESSION_SECRET)) {
    throw new Error('SESSION_SECRET production tidak boleh menggunakan nilai contoh dari .env.example.');
  }

  const config = {
    isProduction,
    port: parseInteger('PORT', 3000, { min: 1, max: 65535 }),
    trustProxy: parseInteger('TRUST_PROXY_HOPS', isProduction ? 1 : 0, { min: 0, max: 10 }),
    sessionTtlSeconds: parseInteger('SESSION_TTL_SECONDS', 60 * 60 * 24 * 7, { min: 300, max: 60 * 60 * 24 * 30 }),
    otpTtlMinutes: parseInteger('OTP_TTL_MINUTES', 10, { min: 1, max: 30 }),
    otpResendSeconds: parseInteger('OTP_RESEND_SECONDS', 60, { min: 15, max: 3600 }),
    requireTransactions: parseBoolean('REQUIRE_MONGODB_TRANSACTIONS', isProduction),
    enableInternalJobs: parseBoolean('ENABLE_INTERNAL_JOBS', false),
    internalJobIntervalMinutes: parseInteger('INTERNAL_JOB_INTERVAL_MINUTES', 5, { min: 1, max: 1440 }),
    maxProductFileBytes: parseInteger('MAX_PRODUCT_FILE_BYTES', 100 * 1024 * 1024, { min: 1024, max: 1024 * 1024 * 1024 })
  };

  process.env.REQUIRE_MONGODB_TRANSACTIONS = String(config.requireTransactions);
  process.env.OTP_TTL_MINUTES = String(config.otpTtlMinutes);
  process.env.OTP_RESEND_SECONDS = String(config.otpResendSeconds);
  process.env.MAX_PRODUCT_FILE_BYTES = String(config.maxProductFileBytes);

  const secretCandidates = [process.env.JOB_SECRET, process.env.CRON_SECRET].filter(Boolean);
  const jobSecret = secretCandidates.find((value) => !isPlaceholder(value)) || secretCandidates[0] || '';
  if (jobSecret) process.env.JOB_SECRET = jobSecret;

  if (isProduction) {
    const smtpComplete = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
    if (!smtpComplete) throw new Error('SMTP_HOST, SMTP_USER, dan SMTP_PASS wajib pada production.');
    if (!process.env.PAKASIR_PROJECT_SLUG || !process.env.PAKASIR_API_KEY) {
      throw new Error('PAKASIR_PROJECT_SLUG dan PAKASIR_API_KEY wajib pada production.');
    }
    if (jobSecret.length < 32 || isPlaceholder(jobSecret)) {
      throw new Error('JOB_SECRET atau CRON_SECRET production harus acak, minimal 32 karakter, dan bukan nilai contoh.');
    }
  }

  return config;
}

module.exports = { validateEnvironment };

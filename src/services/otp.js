const crypto = require('crypto');
const Otp = require('../models/Otp');
const { sendRegistrationOtp, sendPasswordResetOtp } = require('./mailer');

function hashOtp(code) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(String(code)).digest('hex');
}

async function issueOtp({ email, purpose, send }) {
  const ttlMinutes = Number(process.env.OTP_TTL_MINUTES || 10);
  const resendSeconds = Number(process.env.OTP_RESEND_SECONDS || 60);
  const existing = await Otp.findOne({ email, purpose }).lean();

  if (existing?.lastSentAt && Date.now() - new Date(existing.lastSentAt).getTime() < resendSeconds * 1000) {
    const wait = Math.ceil((resendSeconds * 1000 - (Date.now() - new Date(existing.lastSentAt).getTime())) / 1000);
    const error = new Error(`Tunggu ${wait} detik sebelum meminta OTP baru.`);
    error.status = 429;
    throw error;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await Otp.findOneAndUpdate(
    { email, purpose },
    {
      codeHash: hashOtp(code),
      attempts: 0,
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      lastSentAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    await send({ code, ttlMinutes });
  } catch (error) {
    await Otp.deleteOne({ email, purpose });
    throw error;
  }
}

async function verifyOtp(email, purpose, code) {
  const record = await Otp.findOne({ email, purpose });
  if (!record || record.expiresAt < new Date()) {
    await Otp.deleteOne({ email, purpose });
    return { ok: false, reason: 'Kode OTP kedaluwarsa atau tidak ditemukan.' };
  }
  if (record.attempts >= 5) return { ok: false, reason: 'Terlalu banyak percobaan OTP. Minta kode baru.' };

  const normalizedCode = String(code || '').trim();
  if (!/^\d{6}$/.test(normalizedCode)) return { ok: false, reason: 'Kode OTP harus terdiri dari 6 angka.' };
  const supplied = hashOtp(normalizedCode);
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  const expectedBuffer = Buffer.from(record.codeHash, 'hex');
  const valid = suppliedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);

  if (!valid) {
    record.attempts += 1;
    await record.save();
    return { ok: false, reason: 'Kode OTP tidak sesuai.' };
  }

  await record.deleteOne();
  return { ok: true };
}

function issueRegistrationOtp({ email, name }) {
  return issueOtp({
    email,
    purpose: 'register',
    send: ({ code, ttlMinutes }) => sendRegistrationOtp({ email, name, code, ttlMinutes })
  });
}

function verifyRegistrationOtp(email, code) {
  return verifyOtp(email, 'register', code);
}

function issuePasswordResetOtp({ email, name }) {
  return issueOtp({
    email,
    purpose: 'password_reset',
    send: ({ code, ttlMinutes }) => sendPasswordResetOtp({ email, name, code, ttlMinutes })
  });
}

function verifyPasswordResetOtp(email, code) {
  return verifyOtp(email, 'password_reset', code);
}

module.exports = {
  issueRegistrationOtp,
  verifyRegistrationOtp,
  issuePasswordResetOtp,
  verifyPasswordResetOtp
};

const crypto = require('crypto');
const Otp = require('../models/Otp');
const { sendRegistrationOtp } = require('./mailer');

function hashOtp(code) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(String(code)).digest('hex');
}

async function issueRegistrationOtp({ email, name }) {
  const ttlMinutes = Number(process.env.OTP_TTL_MINUTES || 10);
  const resendSeconds = Number(process.env.OTP_RESEND_SECONDS || 60);
  const existing = await Otp.findOne({ email, purpose: 'register' }).lean();

  if (existing?.lastSentAt && Date.now() - new Date(existing.lastSentAt).getTime() < resendSeconds * 1000) {
    const wait = Math.ceil((resendSeconds * 1000 - (Date.now() - new Date(existing.lastSentAt).getTime())) / 1000);
    const error = new Error(`Tunggu ${wait} detik sebelum meminta OTP baru.`);
    error.status = 429;
    throw error;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await Otp.findOneAndUpdate(
    { email, purpose: 'register' },
    {
      codeHash: hashOtp(code),
      attempts: 0,
      expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
      lastSentAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  try {
    await sendRegistrationOtp({ email, name, code, ttlMinutes });
  } catch (error) {
    await Otp.deleteOne({ email, purpose: 'register' });
    throw error;
  }
}

async function verifyRegistrationOtp(email, code) {
  const record = await Otp.findOne({ email, purpose: 'register' });
  if (!record || record.expiresAt < new Date()) {
    await Otp.deleteOne({ email, purpose: 'register' });
    return { ok: false, reason: 'Kode OTP kedaluwarsa atau tidak ditemukan.' };
  }
  if (record.attempts >= 5) return { ok: false, reason: 'Terlalu banyak percobaan OTP. Minta kode baru.' };

  const normalizedCode = String(code || '').trim();
  if (!/^\d{6}$/.test(normalizedCode)) return { ok: false, reason: 'Kode OTP harus terdiri dari 6 angka.' };
  const supplied = hashOtp(normalizedCode);
  const valid = crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(record.codeHash, 'hex'));

  if (!valid) {
    record.attempts += 1;
    await record.save();
    return { ok: false, reason: 'Kode OTP tidak sesuai.' };
  }

  await record.deleteOne();
  return { ok: true };
}

module.exports = { issueRegistrationOtp, verifyRegistrationOtp };

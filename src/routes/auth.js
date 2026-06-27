const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const User = require('../models/User');
const Otp = require('../models/Otp');
const { createCaptcha, verifyCaptcha } = require('../utils/captcha');
const {
  issueRegistrationOtp,
  verifyRegistrationOtp,
  issuePasswordResetOtp,
  verifyPasswordResetOtp
} = require('../services/otp');
const { authLimiter, otpLimiter, captchaLimiter } = require('../middleware/rateLimits');
const { requireGuest } = require('../middleware/auth');
const noStore = require('../middleware/noStore');
const { regenerateSession, sessionUser } = require('../utils/session');
const { safeLocalPath } = require('../utils/redirect');
const asyncHandler = require('../utils/asyncHandler');
const { normalizeReferralCode, generateReferralCode, resolveReferrer, createReferral } = require('../services/referralService');
const { withMongoTransaction } = require('../utils/transaction');

const router = express.Router();
const REGISTRATION_SESSION_MS = 30 * 60 * 1000;
const PASSWORD_RESET_SESSION_MS = 30 * 60 * 1000;
const PASSWORD_RESET_VERIFIED_MS = 10 * 60 * 1000;

router.use(noStore);

function isStrongPassword(password) {
  return password.length >= 8
    && password.length <= 72
    && /[A-Za-z]/.test(password)
    && /\d/.test(password);
}

function getPendingPasswordReset(req) {
  const pending = req.session.pendingPasswordReset;
  if (!pending || Date.now() - Number(pending.createdAt || 0) > PASSWORD_RESET_SESSION_MS) {
    delete req.session.pendingPasswordReset;
    return null;
  }
  return pending;
}

router.get('/captcha/:context.svg', captchaLimiter, (req, res) => {
  const allowed = ['register', 'login', 'admin', 'forgot'];
  if (!allowed.includes(req.params.context)) return res.sendStatus(404);
  res.type('svg').set('Cache-Control', 'no-store, no-cache, must-revalidate').send(createCaptcha(req, req.params.context));
});

router.get('/register', requireGuest, (req, res) => res.render('auth/register', {
  title: 'Daftar Akun',
  referralCode: normalizeReferralCode(req.query.ref)
}));

router.post('/register', requireGuest, otpLimiter, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const passwordConfirm = String(req.body.passwordConfirm || '');
  const referralCode = normalizeReferralCode(req.body.referralCode);

  if (!verifyCaptcha(req, 'register', req.body.captcha)) {
    req.flash('error', 'CAPTCHA tidak sesuai atau sudah kedaluwarsa.');
    return res.redirect('/auth/register');
  }
  if (name.length < 2 || name.length > 80) {
    req.flash('error', 'Nama harus terdiri dari 2–80 karakter.');
    return res.redirect('/auth/register');
  }
  if (!validator.isEmail(email) || email.length > 254) {
    req.flash('error', 'Format email tidak valid.');
    return res.redirect('/auth/register');
  }
  if (!isStrongPassword(password)) {
    req.flash('error', 'Kata sandi minimal 8 karakter dan harus memuat huruf serta angka.');
    return res.redirect('/auth/register');
  }
  if (password !== passwordConfirm) {
    req.flash('error', 'Konfirmasi kata sandi tidak sama.');
    return res.redirect('/auth/register');
  }
  if (await User.exists({ email })) {
    req.flash('error', 'Email tersebut sudah terdaftar.');
    return res.redirect('/auth/login');
  }

  let referrer = null;
  if (referralCode) {
    referrer = await resolveReferrer(referralCode);
    if (!referrer) {
      req.flash('error', 'Kode referral tidak ditemukan atau tidak aktif.');
      return res.redirect(`/auth/register?ref=${encodeURIComponent(referralCode)}`);
    }
  }

  req.session.pendingRegistration = {
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    referralCode: referrer?.referralCode || '',
    referrerId: referrer?._id ? String(referrer._id) : '',
    createdAt: Date.now()
  };
  await issueRegistrationOtp({ email, name });
  req.flash('success', 'Kode OTP telah dikirim ke email Anda.');
  res.redirect('/auth/verify-registration');
}));

router.get('/verify-registration', requireGuest, (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending || Date.now() - pending.createdAt > REGISTRATION_SESSION_MS) {
    delete req.session.pendingRegistration;
    return res.redirect('/auth/register');
  }
  res.render('auth/verify', { title: 'Verifikasi OTP', email: pending.email });
});

router.post('/verify-registration', requireGuest, authLimiter, asyncHandler(async (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending || Date.now() - pending.createdAt > REGISTRATION_SESSION_MS) {
    delete req.session.pendingRegistration;
    req.flash('error', 'Sesi registrasi kedaluwarsa. Silakan mengulang registrasi.');
    return res.redirect('/auth/register');
  }

  const result = await verifyRegistrationOtp(pending.email, req.body.otp);
  if (!result.ok) {
    req.flash('error', result.reason);
    return res.redirect('/auth/verify-registration');
  }

  let user;
  try {
    user = await withMongoTransaction(async (session) => {
      const referralCode = await generateReferralCode(pending.name);
      const [createdUser] = await User.create([{
        name: pending.name,
        email: pending.email,
        passwordHash: pending.passwordHash,
        emailVerifiedAt: new Date(),
        referralCode,
        referredBy: pending.referrerId || null
      }], { session });
      if (pending.referrerId) {
        await createReferral({
          referrerId: pending.referrerId,
          referredUserId: createdUser._id,
          code: pending.referralCode,
          session
        });
      }
      return createdUser;
    });
  } catch (error) {
    if (error.code === 11000) {
      req.flash('error', 'Email tersebut sudah terdaftar.');
      return res.redirect('/auth/login');
    }
    throw error;
  }

  await regenerateSession(req);
  req.session.user = sessionUser(user);
  req.flash('success', 'Registrasi berhasil. Selamat datang di TokoRafael.');
  res.redirect('/account');
}));

router.post('/resend-registration-otp', requireGuest, otpLimiter, asyncHandler(async (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending || Date.now() - pending.createdAt > REGISTRATION_SESSION_MS) {
    delete req.session.pendingRegistration;
    req.flash('error', 'Sesi registrasi kedaluwarsa. Silakan mengulang registrasi.');
    return res.redirect('/auth/register');
  }
  await issueRegistrationOtp({ email: pending.email, name: pending.name });
  req.flash('success', 'Kode OTP baru telah dikirim.');
  res.redirect('/auth/verify-registration');
}));

router.get('/forgot-password', requireGuest, (req, res) => {
  res.render('auth/forgot-password', { title: 'Lupa Kata Sandi' });
});

router.post('/forgot-password', requireGuest, otpLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!verifyCaptcha(req, 'forgot', req.body.captcha)) {
    req.flash('error', 'CAPTCHA tidak sesuai atau sudah kedaluwarsa.');
    return res.redirect('/auth/forgot-password');
  }
  if (!validator.isEmail(email) || email.length > 254) {
    req.flash('error', 'Format email tidak valid.');
    return res.redirect('/auth/forgot-password');
  }

  req.session.pendingPasswordReset = {
    email,
    createdAt: Date.now(),
    verifiedAt: null
  };

  const user = await User.findOne({ email, isActive: true }).select('name email').lean();
  if (user) await issuePasswordResetOtp({ email: user.email, name: user.name });

  req.flash('success', 'Jika email terdaftar, kode OTP reset telah dikirim.');
  res.redirect('/auth/verify-password-reset');
}));

router.get('/verify-password-reset', requireGuest, (req, res) => {
  const pending = getPendingPasswordReset(req);
  if (!pending) {
    req.flash('error', 'Sesi reset kata sandi kedaluwarsa. Silakan mulai kembali.');
    return res.redirect('/auth/forgot-password');
  }
  res.render('auth/verify-password-reset', {
    title: 'Verifikasi Reset Kata Sandi',
    email: pending.email
  });
});

router.post('/verify-password-reset', requireGuest, authLimiter, asyncHandler(async (req, res) => {
  const pending = getPendingPasswordReset(req);
  if (!pending) {
    req.flash('error', 'Sesi reset kata sandi kedaluwarsa. Silakan mulai kembali.');
    return res.redirect('/auth/forgot-password');
  }

  const result = await verifyPasswordResetOtp(pending.email, req.body.otp);
  if (!result.ok) {
    req.flash('error', 'Kode OTP tidak sesuai, sudah kedaluwarsa, atau tidak ditemukan.');
    return res.redirect('/auth/verify-password-reset');
  }

  pending.verifiedAt = Date.now();
  req.session.pendingPasswordReset = pending;
  res.redirect('/auth/reset-password');
}));

router.post('/resend-password-reset-otp', requireGuest, otpLimiter, asyncHandler(async (req, res) => {
  const pending = getPendingPasswordReset(req);
  if (!pending) {
    req.flash('error', 'Sesi reset kata sandi kedaluwarsa. Silakan mulai kembali.');
    return res.redirect('/auth/forgot-password');
  }

  const user = await User.findOne({ email: pending.email, isActive: true }).select('name email').lean();
  if (user) await issuePasswordResetOtp({ email: user.email, name: user.name });

  req.flash('success', 'Jika email terdaftar, kode OTP baru telah dikirim.');
  res.redirect('/auth/verify-password-reset');
}));

router.get('/reset-password', requireGuest, (req, res) => {
  const pending = getPendingPasswordReset(req);
  const verifiedAt = Number(pending?.verifiedAt || 0);
  if (!pending || !verifiedAt || Date.now() - verifiedAt > PASSWORD_RESET_VERIFIED_MS) {
    if (pending) pending.verifiedAt = null;
    req.flash('error', 'Verifikasi reset tidak tersedia atau sudah kedaluwarsa.');
    return res.redirect('/auth/forgot-password');
  }
  res.render('auth/reset-password', { title: 'Buat Kata Sandi Baru' });
});

router.post('/reset-password', requireGuest, authLimiter, asyncHandler(async (req, res) => {
  const pending = getPendingPasswordReset(req);
  const verifiedAt = Number(pending?.verifiedAt || 0);
  if (!pending || !verifiedAt || Date.now() - verifiedAt > PASSWORD_RESET_VERIFIED_MS) {
    req.flash('error', 'Verifikasi reset tidak tersedia atau sudah kedaluwarsa.');
    return res.redirect('/auth/forgot-password');
  }

  const password = String(req.body.password || '');
  const passwordConfirm = String(req.body.passwordConfirm || '');
  if (!isStrongPassword(password)) {
    req.flash('error', 'Kata sandi minimal 8 karakter dan harus memuat huruf serta angka.');
    return res.redirect('/auth/reset-password');
  }
  if (password !== passwordConfirm) {
    req.flash('error', 'Konfirmasi kata sandi tidak sama.');
    return res.redirect('/auth/reset-password');
  }

  const user = await User.findOne({ email: pending.email, isActive: true });
  if (!user) {
    delete req.session.pendingPasswordReset;
    req.flash('error', 'Reset kata sandi tidak dapat diselesaikan. Silakan mulai kembali.');
    return res.redirect('/auth/forgot-password');
  }

  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordChangedAt = new Date();
  user.sessionVersion = Number(user.sessionVersion || 0) + 1;
  await user.save();
  await Otp.deleteOne({ email: user.email, purpose: 'password_reset' });

  await regenerateSession(req);
  req.flash('success', 'Kata sandi berhasil diperbarui. Silakan masuk kembali.');
  res.redirect('/auth/login');
}));

router.get('/login', requireGuest, (req, res) => res.render('auth/login', {
  title: 'Masuk',
  next: safeLocalPath(req.query.next, '')
}));

router.post('/login', requireGuest, authLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const nextUrl = safeLocalPath(req.body.next, '/account');

  if (!verifyCaptcha(req, 'login', req.body.captcha)) {
    req.flash('error', 'CAPTCHA tidak sesuai atau sudah kedaluwarsa.');
    return res.redirect('/auth/login');
  }

  const user = validator.isEmail(email) ? await User.findOne({ email, isActive: true }) : null;
  const valid = user && await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    req.flash('error', 'Email atau kata sandi tidak sesuai.');
    return res.redirect('/auth/login');
  }

  user.lastLoginAt = new Date();
  await user.save();
  await regenerateSession(req);
  req.session.user = sessionUser(user);

  const destination = nextUrl.startsWith('/admin')
    ? (user.role === 'admin' ? nextUrl : '/account')
    : nextUrl;
  res.redirect(destination);
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('tz.sid', { path: '/' });
  res.clearCookie('tz.csrf', { path: '/' });
  res.redirect('/');
}));

module.exports = router;

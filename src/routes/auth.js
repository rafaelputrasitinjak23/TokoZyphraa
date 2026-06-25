const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const User = require('../models/User');
const { createCaptcha, verifyCaptcha } = require('../utils/captcha');
const { issueRegistrationOtp, verifyRegistrationOtp } = require('../services/otp');
const { authLimiter, otpLimiter, captchaLimiter } = require('../middleware/rateLimits');
const { requireGuest } = require('../middleware/auth');
const noStore = require('../middleware/noStore');
const { regenerateSession, sessionUser } = require('../utils/session');
const { safeLocalPath } = require('../utils/redirect');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();
const REGISTRATION_SESSION_MS = 30 * 60 * 1000;

router.use(noStore);

router.get('/captcha/:context.svg', captchaLimiter, (req, res) => {
  const allowed = ['register', 'login', 'admin'];
  if (!allowed.includes(req.params.context)) return res.sendStatus(404);
  res.type('svg').set('Cache-Control', 'no-store, no-cache, must-revalidate').send(createCaptcha(req, req.params.context));
});

router.get('/register', requireGuest, (req, res) => res.render('auth/register', { title: 'Daftar Akun' }));

router.post('/register', requireGuest, otpLimiter, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const passwordConfirm = String(req.body.passwordConfirm || '');

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
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
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

  req.session.pendingRegistration = {
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
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
    user = await User.create({
      name: pending.name,
      email: pending.email,
      passwordHash: pending.passwordHash,
      emailVerifiedAt: new Date()
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
  req.flash('success', 'Registrasi berhasil. Selamat datang di TokoZyphra.');
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

  const destination = user.role === 'admin'
    ? (nextUrl.startsWith('/admin') ? nextUrl : '/admin')
    : (nextUrl.startsWith('/admin') ? '/account' : nextUrl);
  res.redirect(destination);
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('tz.sid', { path: '/' });
  res.clearCookie('tz.csrf', { path: '/' });
  res.redirect('/');
}));

module.exports = router;

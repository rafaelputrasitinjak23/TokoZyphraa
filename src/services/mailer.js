const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT tidak valid.');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000
  });
  return transporter;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

async function sendOtpEmail({ email, name, code, ttlMinutes, subject, heading, message }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV OTP] ${email}: ${code}`);
      return;
    }
    throw new Error('Konfigurasi SMTP belum lengkap.');
  }

  const mailer = getTransporter();
  await mailer.sendMail({
    from: process.env.MAIL_FROM || `TokoRafael <${process.env.SMTP_USER}>`,
    to: email,
    subject,
    text: `Halo ${name}, kode OTP ${message.toLowerCase()} Anda adalah ${code}. Kode berlaku ${ttlMinutes} menit. Jangan berikan kode ini kepada siapa pun.`,
    disableFileAccess: true,
    disableUrlAccess: true,
    html: `
      <div style="font-family:Arial,sans-serif;background:#1b0d08;padding:32px;color:#e5e7eb">
        <div style="max-width:560px;margin:auto;background:#111827;border:1px solid #3f2319;border-radius:20px;padding:28px">
          <h1 style="margin:0 0 12px;color:#fff">Toko<span style="color:#dc2626">Rafael</span></h1>
          <p>Halo <strong>${escapeHtml(name)}</strong>,</p>
          <p>${escapeHtml(heading)}</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#0f172a;padding:18px;border-radius:14px;color:#f97316">${code}</div>
          <p style="color:#94a3b8">Kode berlaku selama ${ttlMinutes} menit dan hanya dapat digunakan satu kali.</p>
          <p style="color:#94a3b8">Abaikan email ini apabila Anda tidak melakukan permintaan tersebut.</p>
        </div>
      </div>`
  });
}

function sendRegistrationOtp({ email, name, code, ttlMinutes }) {
  return sendOtpEmail({
    email,
    name,
    code,
    ttlMinutes,
    subject: 'Kode OTP Registrasi TokoRafael',
    heading: 'Masukkan kode berikut untuk menyelesaikan registrasi:',
    message: 'registrasi TokoRafael'
  });
}

function sendPasswordResetOtp({ email, name, code, ttlMinutes }) {
  return sendOtpEmail({
    email,
    name,
    code,
    ttlMinutes,
    subject: 'Kode OTP Reset Kata Sandi TokoRafael',
    heading: 'Masukkan kode berikut untuk mengatur ulang kata sandi akun Anda:',
    message: 'reset kata sandi TokoRafael'
  });
}

module.exports = { sendRegistrationOtp, sendPasswordResetOtp };

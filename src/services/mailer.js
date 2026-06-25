const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  const port = Number(process.env.SMTP_PORT || 587);
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
    maxMessages: 100
  });
  return transporter;
}

async function sendRegistrationOtp({ email, name, code, ttlMinutes }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV OTP] ${email}: ${code}`);
      return;
    }
    throw new Error('Konfigurasi SMTP belum lengkap.');
  }

  const mailer = getTransporter();
  await mailer.sendMail({
    from: process.env.MAIL_FROM || `TokoZyphra <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Kode OTP Registrasi TokoZyphra',
    text: `Halo ${name}, kode OTP registrasi TokoZyphra Anda adalah ${code}. Kode berlaku ${ttlMinutes} menit. Jangan berikan kode ini kepada siapa pun.`,
    disableFileAccess: true,
    disableUrlAccess: true,
    html: `
      <div style="font-family:Arial,sans-serif;background:#0b1020;padding:32px;color:#e5e7eb">
        <div style="max-width:560px;margin:auto;background:#111827;border:1px solid #26324a;border-radius:20px;padding:28px">
          <h1 style="margin:0 0 12px;color:#fff">Toko<span style="color:#7c3aed">Zyphra</span></h1>
          <p>Halo <strong>${escapeHtml(name)}</strong>,</p>
          <p>Masukkan kode berikut untuk menyelesaikan registrasi:</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:10px;text-align:center;background:#0f172a;padding:18px;border-radius:14px;color:#a78bfa">${code}</div>
          <p style="color:#94a3b8">Kode berlaku selama ${ttlMinutes} menit dan hanya dapat digunakan satu kali.</p>
        </div>
      </div>`
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

module.exports = { sendRegistrationOtp };

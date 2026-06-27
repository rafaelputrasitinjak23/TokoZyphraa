const crypto = require('crypto');

const CAPTCHA_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CAPTCHA_LENGTH = 5;

function randomInteger(min, max) {
  return crypto.randomInt(min, max + 1);
}

function createCaptchaCode() {
  return Array.from(
    { length: CAPTCHA_LENGTH },
    () => CAPTCHA_CHARACTERS[randomInteger(0, CAPTCHA_CHARACTERS.length - 1)]
  ).join('');
}

function createCaptchaSvg(code) {
  const width = 320;
  const height = 104;

  const dots = Array.from({ length: 18 }, () => {
    const x = randomInteger(16, width - 16);
    const y = randomInteger(12, height - 12);
    const radius = randomInteger(1, 3);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#cbd5e1" opacity="0.9"/>`;
  }).join('');

  const lines = Array.from({ length: 2 }, (_, index) => {
    const startY = randomInteger(18, height - 18);
    const endY = randomInteger(18, height - 18);
    const controlY = randomInteger(10, height - 10);
    const stroke = index === 0 ? '#fdba74' : '#fdba74';

    return `<path d="M10 ${startY} Q${width / 2} ${controlY} ${width - 10} ${endY}" stroke="${stroke}" stroke-width="2" fill="none" opacity="0.9"/>`;
  }).join('');

  const characters = [...code].map((character, index) => {
    const x = 45 + (index * 57);
    const y = 70 + randomInteger(-4, 4);
    const rotation = randomInteger(-7, 7);

    return `<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="800" fill="#111827">${character}</text>`;
  }).join('');

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Kode CAPTCHA">
      <rect width="100%" height="100%" rx="16" fill="#f8fafc"/>
      ${dots}
      ${lines}
      ${characters}
    </svg>
  `;
}

function createCaptcha(req, context) {
  const code = createCaptchaCode();

  req.session.captchas ||= {};
  req.session.captchas[context] = {
    answer: code.toLowerCase(),
    expiresAt: Date.now() + 5 * 60 * 1000
  };

  return createCaptchaSvg(code);
}

function verifyCaptcha(req, context, answer) {
  const challenge = req.session.captchas?.[context];
  if (req.session.captchas) delete req.session.captchas[context];
  if (!challenge || challenge.expiresAt < Date.now()) return false;

  return String(answer || '').trim().toLowerCase() === challenge.answer;
}

module.exports = { createCaptcha, verifyCaptcha };

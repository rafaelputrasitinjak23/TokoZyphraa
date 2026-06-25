const svgCaptcha = require('svg-captcha');

function createCaptcha(req, context) {
  const captcha = svgCaptcha.create({
    size: 6,
    noise: 3,
    color: true,
    background: '#0f172a',
    ignoreChars: '0oO1ilI',
    width: 190,
    height: 56,
    fontSize: 44
  });
  req.session.captchas ||= {};
  req.session.captchas[context] = {
    answer: captcha.text.toLowerCase(),
    expiresAt: Date.now() + 5 * 60 * 1000
  };
  return captcha.data;
}

function verifyCaptcha(req, context, answer) {
  const challenge = req.session.captchas?.[context];
  if (req.session.captchas) delete req.session.captchas[context];
  if (!challenge || challenge.expiresAt < Date.now()) return false;
  return String(answer || '').trim().toLowerCase() === challenge.answer;
}

module.exports = { createCaptcha, verifyCaptcha };

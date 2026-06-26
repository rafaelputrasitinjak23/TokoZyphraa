const crypto = require('crypto');
const User = require('../models/User');
const Referral = require('../models/Referral');

function normalizeReferralCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}

async function generateReferralCode(name = 'USER') {
  const prefix = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'USER';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `${prefix}${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    if (!await User.exists({ referralCode: code })) return code;
  }
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

async function ensureReferralCode(userOrId, session = null) {
  const user = typeof userOrId === 'object'
    ? userOrId
    : await User.findById(userOrId).session(session || null);
  if (!user) return null;
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    user.referralCode = await generateReferralCode(user.name);
    try {
      await user.save(session ? { session } : undefined);
      return user.referralCode;
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  throw new Error('Kode referral tidak dapat dibuat. Silakan coba kembali.');
}

async function resolveReferrer(code) {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  return User.findOne({ referralCode: normalized, isActive: true }).select('_id name referralCode').lean();
}

async function createReferral({ referrerId, referredUserId, code, session = null }) {
  if (!referrerId || String(referrerId) === String(referredUserId)) return null;
  try {
    const [referral] = await Referral.create([{
      referrer: referrerId,
      referredUser: referredUserId,
      code: normalizeReferralCode(code)
    }], session ? { session } : undefined);
    return referral;
  } catch (error) {
    if (error.code === 11000) return Referral.findOne({ referredUser: referredUserId }).session(session || null);
    throw error;
  }
}

module.exports = { normalizeReferralCode, generateReferralCode, ensureReferralCode, resolveReferrer, createReferral };

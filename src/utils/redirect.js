function safeLocalPath(value, fallback = '/') {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\u0000-\u001F\u007F]/.test(path)) {
    return fallback;
  }
  try {
    const parsed = new URL(path, 'https://local.invalid');
    if (parsed.origin !== 'https://local.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_) {
    return fallback;
  }
}

function safeRefererPath(req, fallback = '/') {
  const referer = req.get('referer');
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    const host = req.get('host');
    if (!host || url.host !== host) return fallback;
    return safeLocalPath(`${url.pathname}${url.search}${url.hash}`, fallback);
  } catch (_) {
    return fallback;
  }
}

module.exports = { safeLocalPath, safeRefererPath };

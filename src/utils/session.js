function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function destroySession(req) {
  return new Promise((resolve) => req.session.destroy(() => resolve()));
}

function sessionUser(user, hasAvatar = Boolean(user.avatarData)) {
  return {
    id: user.id || String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    version: Number(user.sessionVersion || 0),
    hasAvatar: Boolean(hasAvatar)
  };
}

module.exports = { regenerateSession, destroySession, sessionUser };

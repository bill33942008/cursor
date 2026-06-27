const { db } = require("../db");

function parseBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function optionalAuth(req, _res, next) {
  const token = parseBearerToken(req);
  if (!token) {
    req.user = null;
    return next();
  }

  const session = db
    .prepare(
      `
      SELECT s.token, s.user_id, s.expires_at, u.nickname, u.avatar_url, u.is_banned
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
      `
    )
    .get(token);
  if (!session) {
    req.user = null;
    return next();
  }
  if (new Date(session.expires_at).getTime() < Date.now() || Number(session.is_banned || 0) === 1) {
    req.user = null;
    return next();
  }

  req.user = {
    id: session.user_id,
    nickname: session.nickname,
    avatarUrl: session.avatar_url,
    token: session.token,
  };
  return next();
}

module.exports = {
  optionalAuth,
};

const { db } = require("../db");
const { trackUserActivity } = require("../services/activity");

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "missing access token" });
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
    return res.status(401).json({ message: "invalid access token" });
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
    return res.status(401).json({ message: "access token expired" });
  }

  if (session.is_banned) {
    return res.status(403).json({ message: "user is banned" });
  }

  req.user = {
    id: session.user_id,
    nickname: session.nickname,
    avatarUrl: session.avatar_url,
    token: session.token,
  };
  trackUserActivity(session.user_id);
  next();
}

module.exports = {
  authRequired,
};

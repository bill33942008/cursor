const { db } = require("../db");

const lastTrackMap = new Map();
const TRACK_INTERVAL_MS = Number(process.env.USER_ACTIVITY_TRACK_INTERVAL_MS || 60000);

function nowIso() {
  return new Date().toISOString();
}

function shouldSkipTrack(userId, force) {
  if (force) return false;
  const now = Date.now();
  const last = lastTrackMap.get(userId) || 0;
  if (now - last < TRACK_INTERVAL_MS) {
    return true;
  }
  lastTrackMap.set(userId, now);
  return false;
}

function trackUserActivity(userId, { force = false } = {}) {
  if (!userId) return;
  if (shouldSkipTrack(userId, force)) return;

  db.prepare("UPDATE users SET last_active_at = ?, updated_at = datetime('now') WHERE id = ?").run(nowIso(), userId);
  db.prepare(
    `
    INSERT OR IGNORE INTO daily_active_users (user_id, activity_date)
    VALUES (?, date('now'))
    `
  ).run(userId);
}

function getActivityStats() {
  const onlineWindowMinutes = Math.max(Number(process.env.ONLINE_WINDOW_MINUTES || 5), 1);
  const onlineUsers = db
    .prepare(
      `
      SELECT COUNT(1) AS c
      FROM users
      WHERE last_active_at IS NOT NULL
        AND datetime(last_active_at) >= datetime('now', ?)
      `
    )
    .get(`-${onlineWindowMinutes} minutes`).c;

  const dau = db
    .prepare(
      `
      SELECT COUNT(DISTINCT user_id) AS c
      FROM daily_active_users
      WHERE activity_date = date('now')
      `
    )
    .get().c;

  const mau = db
    .prepare(
      `
      SELECT COUNT(DISTINCT user_id) AS c
      FROM daily_active_users
      WHERE activity_date >= date('now', '-29 day')
      `
    )
    .get().c;

  return {
    onlineUsers: Number(onlineUsers || 0),
    dau: Number(dau || 0),
    mau: Number(mau || 0),
  };
}

module.exports = {
  trackUserActivity,
  getActivityStats,
};

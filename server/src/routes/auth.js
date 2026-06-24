const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");

const router = express.Router();

const loginSchema = z.object({
  code: z.string().min(2),
  nickname: z.string().min(1).max(32).default("在路上用户"),
  avatarUrl: z.string().url().optional(),
});

router.post("/wx-login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid login payload", errors: parsed.error.issues });
  }

  const { code, nickname, avatarUrl } = parsed.data;
  const mockOpenId = `mock_wx_${code}`;

  const existingUser = db.prepare("SELECT id FROM users WHERE wx_openid = ?").get(mockOpenId);
  const userId = existingUser?.id || uuidv4();

  if (existingUser) {
    db.prepare(
      `
      UPDATE users
      SET nickname = ?, avatar_url = COALESCE(?, avatar_url), updated_at = datetime('now')
      WHERE id = ?
    `
    ).run(nickname, avatarUrl || null, userId);
  } else {
    db.prepare(
      `
      INSERT INTO users (id, wx_openid, nickname, avatar_url)
      VALUES (?, ?, ?, ?)
    `
    ).run(userId, mockOpenId, nickname, avatarUrl || null);
  }

  const ttlHours = Number(process.env.TOKEN_TTL_HOURS || 168);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const token = uuidv4();
  db.prepare(
    `
    INSERT INTO user_sessions (token, user_id, expires_at)
    VALUES (?, ?, ?)
  `
  ).run(token, userId, expiresAt);

  const user = db
    .prepare("SELECT id, nickname, avatar_url AS avatarUrl, bio, created_at AS createdAt FROM users WHERE id = ?")
    .get(userId);

  return res.json({
    accessToken: token,
    expiresAt,
    user,
    note: "MVP uses mock wx login code. Replace with code2Session in production.",
  });
});

router.get("/me", authRequired, (req, res) => {
  const user = db
    .prepare("SELECT id, nickname, avatar_url AS avatarUrl, bio, created_at AS createdAt FROM users WHERE id = ?")
    .get(req.user.id);
  return res.json({ user });
});

module.exports = router;

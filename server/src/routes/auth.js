const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { exchangeCodeForOpenId, isRealLoginMode } = require("../services/wechat");
const { trackUserActivity } = require("../services/activity");
const {
  getUserPolicyBundle,
  normalizeMembershipTier,
  resolveEffectiveMembershipTier,
} = require("../services/profilePolicy");

const router = express.Router();

const loginSchema = z.object({
  code: z.string().min(2),
  nickname: z.string().min(1).max(32).default("在路上用户"),
  avatarUrl: z.string().url().optional(),
});

router.post("/wx-login", async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid login payload", errors: parsed.error.issues });
  }

  try {
    const { code, nickname, avatarUrl } = parsed.data;
    const loginResult = await exchangeCodeForOpenId(code);
    const wxOpenId = loginResult.openid;

    const existingUser = db.prepare("SELECT id FROM users WHERE wx_openid = ?").get(wxOpenId);
    const userId = existingUser?.id || uuidv4();

    db.prepare(
      `
      INSERT INTO users (id, wx_openid, nickname, avatar_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(wx_openid) DO UPDATE SET
        nickname = excluded.nickname,
        avatar_url = COALESCE(excluded.avatar_url, users.avatar_url),
        updated_at = datetime('now')
    `
    ).run(userId, wxOpenId, nickname, avatarUrl || null);

    const resolvedUser = db.prepare("SELECT id FROM users WHERE wx_openid = ?").get(wxOpenId);
    const ttlHours = Number(process.env.TOKEN_TTL_HOURS || 168);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
    const token = uuidv4();
    db.prepare(
      `
      INSERT INTO user_sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `
    ).run(token, resolvedUser.id, expiresAt);
    trackUserActivity(resolvedUser.id, { force: true });

    const user = db
      .prepare(
        `
        SELECT
          id,
          nickname,
          avatar_url AS avatarUrl,
          bio,
          membership_tier AS membershipTier,
          vip_expires_at AS vipExpiresAt,
          created_at AS createdAt
        FROM users
        WHERE id = ?
        `
      )
      .get(resolvedUser.id);
    const bundle = getUserPolicyBundle(resolvedUser.id);
    const effectiveTier = bundle?.featurePolicy?.membershipTier || resolveEffectiveMembershipTier(user);

    return res.json({
      accessToken: token,
      expiresAt,
      user: {
        ...user,
        membershipTier: effectiveTier || normalizeMembershipTier(user?.membershipTier),
        vipExpiresAt: String(user?.vipExpiresAt || ""),
      },
      profilePolicy: bundle?.profilePolicy || null,
      featurePolicy: bundle?.featurePolicy || null,
      loginMode: isRealLoginMode() ? "real" : "mock",
    });
  } catch (err) {
    const message = err.message || "login failed";
    if (message.includes("code2Session")) {
      return res.status(400).json({ message });
    }
    return next(err);
  }
});

router.get("/me", authRequired, (req, res) => {
  const user = db
    .prepare(
      `
      SELECT
        id,
        nickname,
        avatar_url AS avatarUrl,
        bio,
        membership_tier AS membershipTier,
        vip_expires_at AS vipExpiresAt,
        created_at AS createdAt
      FROM users
      WHERE id = ?
      `
    )
    .get(req.user.id);
  if (!user) {
    return res.status(404).json({ message: "user not found" });
  }
  const bundle = getUserPolicyBundle(req.user.id);
  return res.json({
    user: {
      ...user,
      membershipTier:
        bundle?.featurePolicy?.membershipTier || resolveEffectiveMembershipTier(user) || normalizeMembershipTier(user.membershipTier),
      vipExpiresAt: String(user.vipExpiresAt || ""),
    },
    profilePolicy: bundle?.profilePolicy || null,
    featurePolicy: bundle?.featurePolicy || null,
  });
});

module.exports = router;

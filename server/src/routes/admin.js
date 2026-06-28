const express = require("express");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { adminAuthRequired } = require("../middleware/adminAuth");
const {
  hasAdminJwtSecret,
  MIN_ADMIN_JWT_SECRET_LENGTH,
  isStrongPassword,
  hashAdminPassword,
  verifyAdminPassword,
  signAdminToken,
} = require("../services/adminAuth");
const { getActivityStats } = require("../services/activity");
const { getRealtimePresenceStats } = require("../realtime/hub");
const { parsePagination } = require("../utils");
const { isMockDataEnabled, setMockDataEnabled } = require("../services/appSettings");
const {
  clampFeatureValue,
  formatFeaturePolicy,
  getCurrentCycleYear,
  getDefaultProfileChangeLimit,
  getTierFeatureDefaults,
  getUserFeaturePolicy,
  getUserPolicyBundle,
  getUserProfilePolicy,
  normalizeMembershipTier,
} = require("../services/profilePolicy");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "too many login attempts, please retry later" },
});

function logAdminAction({ actionType, targetType, targetId, payload, adminId }) {
  db.prepare(
    `
    INSERT INTO admin_actions (id, action_type, target_type, target_id, payload_json)
    VALUES (?, ?, ?, ?, ?)
    `
  ).run(
    uuidv4(),
    actionType,
    targetType,
    targetId,
    JSON.stringify({
      adminId: adminId || null,
      payload: payload || null,
    })
  );
}

function mapAdminUser(row) {
  const currentYear = getCurrentCycleYear();
  const membershipTier = normalizeMembershipTier(row.membershipTier);
  const profileChangeLimitPerYear = Math.max(
    0,
    Number(row.profileChangeLimitPerYear || getDefaultProfileChangeLimit(membershipTier))
  );
  const cycleYear = Number(row.profileChangeCycleYear || currentYear);
  const rawUsed = Math.max(0, Number(row.profileChangeUsedThisYear || 0));
  const profileChangeUsedThisYear = cycleYear === currentYear ? rawUsed : 0;
  const featurePolicy = formatFeaturePolicy(row);
  return {
    ...row,
    isBanned: Boolean(Number(row.isBanned || 0)),
    membershipTier,
    profileChangeLimitPerYear,
    profileChangeUsedThisYear,
    profileChangeCycleYear: cycleYear === currentYear ? cycleYear : currentYear,
    profileChangeRemaining: Math.max(profileChangeLimitPerYear - profileChangeUsedThisYear, 0),
    featurePolicy,
  };
}

router.post("/auth/login", loginLimiter, async (req, res) => {
  const schema = z.object({
    username: z.string().min(3).max(64),
    password: z.string().min(1).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }

  const username = parsed.data.username.trim();
  const admin = db
    .prepare(
      `
      SELECT id, username, password_hash AS passwordHash, role, status
      FROM admin_users
      WHERE username = ?
      `
    )
    .get(username);
  if (!admin || admin.status !== "active") {
    return res.status(401).json({ message: "invalid username or password" });
  }

  const matched = await verifyAdminPassword(parsed.data.password, admin.passwordHash);
  if (!matched) {
    return res.status(401).json({ message: "invalid username or password" });
  }

  if (!hasAdminJwtSecret()) {
    return res.status(503).json({
      message: `admin jwt not configured, please set ADMIN_JWT_SECRET (>=${MIN_ADMIN_JWT_SECRET_LENGTH} chars)`,
    });
  }

  db.prepare(
    `
    UPDATE admin_users
    SET last_login_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
    `
  ).run(admin.id);

  const accessToken = signAdminToken(admin);
  logAdminAction({
    actionType: "admin_login",
    targetType: "admin_user",
    targetId: admin.id,
    adminId: admin.id,
  });

  return res.json({
    accessToken,
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
    },
  });
});

router.use(adminAuthRequired);

router.get("/auth/me", (req, res) => {
  res.json({
    admin: {
      id: req.admin.id,
      username: req.admin.username,
      role: req.admin.role,
      authMode: req.admin.authMode,
    },
  });
});

router.post("/auth/change-password", async (req, res) => {
  const schema = z.object({
    oldPassword: z.string().min(1).max(200),
    newPassword: z.string().min(10).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  if (!isStrongPassword(parsed.data.newPassword)) {
    return res.status(400).json({
      message: "new password is too weak (10+ chars, upper/lower/number/symbol required)",
    });
  }

  const current = db
    .prepare("SELECT id, password_hash AS passwordHash FROM admin_users WHERE id = ?")
    .get(req.admin.id);
  if (!current) {
    return res.status(404).json({ message: "admin user not found" });
  }
  const matched = await verifyAdminPassword(parsed.data.oldPassword, current.passwordHash);
  if (!matched) {
    return res.status(400).json({ message: "old password incorrect" });
  }
  const newHash = await hashAdminPassword(parsed.data.newPassword);
  db.prepare("UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(
    newHash,
    req.admin.id
  );
  logAdminAction({
    actionType: "change_password",
    targetType: "admin_user",
    targetId: req.admin.id,
    adminId: req.admin.id,
  });
  return res.json({ success: true });
});

router.get("/overview", (_req, res) => {
  const openReports = Number(db.prepare("SELECT COUNT(1) AS c FROM reports WHERE status = 'open'").get().c || 0);
  const pendingPosts = Number(
    db.prepare("SELECT COUNT(1) AS c FROM posts WHERE moderation_status = 'review'").get().c || 0
  );
  const pendingMedia = Number(
    db.prepare("SELECT COUNT(1) AS c FROM media_assets WHERE moderation_status = 'review'").get().c || 0
  );
  const bannedUsers = Number(db.prepare("SELECT COUNT(1) AS c FROM users WHERE is_banned = 1").get().c || 0);
  const totalUsers = Number(db.prepare("SELECT COUNT(1) AS c FROM users").get().c || 0);
  const totalGroups = Number(db.prepare("SELECT COUNT(1) AS c FROM groups_table").get().c || 0);
  const totalPosts = Number(db.prepare("SELECT COUNT(1) AS c FROM posts").get().c || 0);
  const totalMessages = Number(db.prepare("SELECT COUNT(1) AS c FROM group_messages").get().c || 0);
  const newUsersToday = Number(
    db.prepare("SELECT COUNT(1) AS c FROM users WHERE date(created_at) = date('now')").get().c || 0
  );
  const newUsersThisMonth = Number(
    db
      .prepare("SELECT COUNT(1) AS c FROM users WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')")
      .get().c || 0
  );

  const activity = getActivityStats();
  const realtime = getRealtimePresenceStats();

  res.json({
    overview: {
      openReports,
      pendingPosts,
      pendingMedia,
      bannedUsers,
      totalUsers,
      totalGroups,
      totalPosts,
      totalMessages,
      newUsersToday,
      newUsersThisMonth,
      onlineUsers: Math.max(activity.onlineUsers, realtime.connectedUsers),
      dau: activity.dau,
      mau: activity.mau,
      connectedUsers: realtime.connectedUsers,
      mockDataEnabled: isMockDataEnabled(),
    },
  });
});

router.get("/settings/mock-data", (_req, res) => {
  res.json({ enabled: isMockDataEnabled() });
});

router.post("/settings/mock-data", (req, res) => {
  const schema = z.object({
    enabled: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  setMockDataEnabled(parsed.data.enabled);
  logAdminAction({
    actionType: "toggle_mock_data",
    targetType: "app_setting",
    targetId: "mock_data_enabled",
    payload: parsed.data,
    adminId: req.admin.id,
  });
  return res.json({ success: true, enabled: isMockDataEnabled() });
});

router.get("/trends", (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);
  const rows = db
    .prepare(
      `
      WITH RECURSIVE dates(date_value) AS (
        SELECT date('now', ?)
        UNION ALL
        SELECT date(date_value, '+1 day')
        FROM dates
        WHERE date_value < date('now')
      )
      SELECT
        d.date_value AS date,
        COALESCE((
          SELECT COUNT(DISTINCT dau.user_id)
          FROM daily_active_users dau
          WHERE dau.activity_date = d.date_value
        ), 0) AS dau,
        COALESCE((
          SELECT COUNT(1)
          FROM users u
          WHERE date(u.created_at) = d.date_value
        ), 0) AS newUsers,
        COALESCE((
          SELECT COUNT(1)
          FROM posts p
          WHERE date(p.created_at) = d.date_value
        ), 0) AS newPosts
      FROM dates d
      ORDER BY d.date_value ASC
      `
    )
    .all(`-${days - 1} day`);
  res.json({ days, items: rows });
});

router.get("/users", (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const keyword = (req.query.keyword || "").trim();
  const status = req.query.status || "all";

  let sql = `
    SELECT
      id,
      nickname,
      avatar_url AS avatarUrl,
      bio,
      is_banned AS isBanned,
      last_active_at AS lastActiveAt,
      membership_tier AS membershipTier,
      profile_change_limit_per_year AS profileChangeLimitPerYear,
      profile_change_used_this_year AS profileChangeUsedThisYear,
      profile_change_cycle_year AS profileChangeCycleYear,
      daily_post_limit_override AS dailyPostLimitOverride,
      daily_group_create_limit_override AS dailyGroupCreateLimitOverride,
      scene_window_max_minutes_override AS sceneWindowMaxMinutesOverride,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM users
    WHERE 1 = 1
  `;
  const params = [];

  if (keyword) {
    sql += " AND (nickname LIKE ? OR id LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (status === "active") {
    sql += " AND is_banned = 0";
  } else if (status === "banned") {
    sql += " AND is_banned = 1";
  }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params).map(mapAdminUser);

  res.json({ items, pagination: { limit, offset } });
});

router.post("/users/:id/profile-policy", (req, res) => {
  const schema = z
    .object({
      membershipTier: z.enum(["normal", "vip"]).optional(),
      profileChangeLimitPerYear: z.number().int().min(0).max(100).optional(),
      resetUsage: z.boolean().optional(),
      dailyPostLimit: z.number().int().min(1).max(500).optional(),
      dailyGroupCreateLimit: z.number().int().min(1).max(100).optional(),
      sceneWindowMaxMinutes: z.number().int().min(30).max(10080).optional(),
      clearFeatureOverrides: z.boolean().optional(),
    })
    .refine(
      (value) =>
        value.membershipTier !== undefined ||
        value.profileChangeLimitPerYear !== undefined ||
        value.resetUsage !== undefined ||
        value.dailyPostLimit !== undefined ||
        value.dailyGroupCreateLimit !== undefined ||
        value.sceneWindowMaxMinutes !== undefined ||
        value.clearFeatureOverrides !== undefined,
      {
        message: "at least one field is required",
        path: ["membershipTier"],
      }
    );
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }

  const userId = req.params.id;
  const current = db
    .prepare(
      `
      SELECT
        id,
        membership_tier AS membershipTier,
        profile_change_limit_per_year AS profileChangeLimitPerYear,
        profile_change_used_this_year AS profileChangeUsedThisYear,
        profile_change_cycle_year AS profileChangeCycleYear,
        daily_post_limit_override AS dailyPostLimitOverride,
        daily_group_create_limit_override AS dailyGroupCreateLimitOverride,
        scene_window_max_minutes_override AS sceneWindowMaxMinutesOverride
      FROM users
      WHERE id = ?
      `
    )
    .get(userId);
  if (!current) {
    return res.status(404).json({ message: "user not found" });
  }

  const currentYear = getCurrentCycleYear();
  const nextTier = parsed.data.membershipTier
    ? normalizeMembershipTier(parsed.data.membershipTier)
    : normalizeMembershipTier(current.membershipTier);
  const nextLimit =
    parsed.data.profileChangeLimitPerYear !== undefined
      ? parsed.data.profileChangeLimitPerYear
      : parsed.data.membershipTier !== undefined
      ? getDefaultProfileChangeLimit(nextTier)
      : Math.max(0, Number(current.profileChangeLimitPerYear || getDefaultProfileChangeLimit(nextTier)));
  const shouldResetUsage = Boolean(parsed.data.resetUsage);
  const oldCycleYear = Number(current.profileChangeCycleYear || 0);
  const oldUsed = Math.max(0, Number(current.profileChangeUsedThisYear || 0));
  const nextUsed = shouldResetUsage ? 0 : oldCycleYear === currentYear ? oldUsed : 0;
  const tierDefaults = getTierFeatureDefaults(nextTier);
  let nextDailyPostLimitOverride = current.dailyPostLimitOverride;
  let nextDailyGroupCreateLimitOverride = current.dailyGroupCreateLimitOverride;
  let nextSceneWindowMaxMinutesOverride = current.sceneWindowMaxMinutesOverride;
  if (parsed.data.clearFeatureOverrides) {
    nextDailyPostLimitOverride = null;
    nextDailyGroupCreateLimitOverride = null;
    nextSceneWindowMaxMinutesOverride = null;
  }
  if (parsed.data.dailyPostLimit !== undefined) {
    nextDailyPostLimitOverride = clampFeatureValue(
      "dailyPostLimit",
      parsed.data.dailyPostLimit,
      tierDefaults.dailyPostLimit
    );
  }
  if (parsed.data.dailyGroupCreateLimit !== undefined) {
    nextDailyGroupCreateLimitOverride = clampFeatureValue(
      "dailyGroupCreateLimit",
      parsed.data.dailyGroupCreateLimit,
      tierDefaults.dailyGroupCreateLimit
    );
  }
  if (parsed.data.sceneWindowMaxMinutes !== undefined) {
    nextSceneWindowMaxMinutesOverride = clampFeatureValue(
      "sceneWindowMaxMinutes",
      parsed.data.sceneWindowMaxMinutes,
      tierDefaults.sceneWindowMaxMinutes
    );
  }

  db.prepare(
    `
    UPDATE users
    SET membership_tier = ?,
        profile_change_limit_per_year = ?,
        profile_change_used_this_year = ?,
        profile_change_cycle_year = ?,
        daily_post_limit_override = ?,
        daily_group_create_limit_override = ?,
        scene_window_max_minutes_override = ?,
        updated_at = datetime('now')
    WHERE id = ?
    `
  ).run(
    nextTier,
    nextLimit,
    nextUsed,
    currentYear,
    nextDailyPostLimitOverride,
    nextDailyGroupCreateLimitOverride,
    nextSceneWindowMaxMinutesOverride,
    userId
  );

  logAdminAction({
    actionType: "update_user_profile_policy",
    targetType: "user",
    targetId: userId,
    payload: parsed.data,
    adminId: req.admin.id,
  });

  return res.json({
    success: true,
    profilePolicy: getUserProfilePolicy(userId),
    featurePolicy: getUserFeaturePolicy(userId),
    policyBundle: getUserPolicyBundle(userId),
  });
});

function handleUserStatus(req, res, parsedData) {
  const userId = req.params.id;
  const exists = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!exists) {
    return res.status(404).json({ message: "user not found" });
  }

  db.prepare("UPDATE users SET is_banned = ?, updated_at = datetime('now') WHERE id = ?").run(
    parsedData.ban ? 1 : 0,
    userId
  );
  if (parsedData.ban) {
    db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
  }

  logAdminAction({
    actionType: parsedData.ban ? "ban_user" : "unban_user",
    targetType: "user",
    targetId: userId,
    payload: parsedData,
    adminId: req.admin.id,
  });

  return res.json({ success: true });
}

router.post("/users/:id/status", (req, res) => {
  const schema = z.object({
    ban: z.boolean(),
    reason: z.string().max(200).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  return handleUserStatus(req, res, parsed.data);
});

router.post("/users/:id/ban", (req, res) => {
  const schema = z.object({
    ban: z.boolean(),
    reason: z.string().max(200).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  return handleUserStatus(req, res, parsed.data);
});

router.get("/reports", (req, res) => {
  const status = req.query.status || "open";
  const items = db
    .prepare(
      `
      SELECT id, reporter_user_id AS reporterUserId, target_type AS targetType, target_id AS targetId,
             reason, status, handled_by_admin AS handledByAdmin, handled_at AS handledAt, created_at AS createdAt
      FROM reports
      WHERE (? = 'all' OR status = ?)
      ORDER BY created_at DESC
      LIMIT 500
      `
    )
    .all(status, status);
  res.json({ items });
});

router.post("/reports/:id/resolve", (req, res) => {
  const schema = z.object({
    status: z.enum(["resolved", "dismissed"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }

  const reportId = req.params.id;
  const exists = db.prepare("SELECT id FROM reports WHERE id = ?").get(reportId);
  if (!exists) {
    return res.status(404).json({ message: "report not found" });
  }

  db.prepare(
    `
    UPDATE reports
    SET status = ?, handled_by_admin = ?, handled_at = datetime('now')
    WHERE id = ?
    `
  ).run(parsed.data.status, req.admin.username, reportId);

  logAdminAction({
    actionType: "resolve_report",
    targetType: "report",
    targetId: reportId,
    payload: parsed.data,
    adminId: req.admin.id,
  });

  res.json({ success: true });
});

router.get("/media", (req, res) => {
  const status = req.query.status || "review";
  const items = db
    .prepare(
      `
      SELECT
        m.id,
        m.user_id AS userId,
        u.nickname,
        m.provider,
        m.storage_key AS storageKey,
        m.url,
        m.mime_type AS mimeType,
        m.size_bytes AS sizeBytes,
        m.moderation_status AS moderationStatus,
        m.moderation_reason AS moderationReason,
        m.created_at AS createdAt
      FROM media_assets m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE (? = 'all' OR m.moderation_status = ?)
      ORDER BY m.created_at DESC
      LIMIT 500
      `
    )
    .all(status, status);
  res.json({ items });
});

router.post("/media/:id/moderate", (req, res) => {
  const schema = z.object({
    status: z.enum(["approved", "rejected"]),
    reason: z.string().max(200).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }

  const mediaId = req.params.id;
  const exists = db.prepare("SELECT id FROM media_assets WHERE id = ?").get(mediaId);
  if (!exists) {
    return res.status(404).json({ message: "media asset not found" });
  }
  db.prepare("UPDATE media_assets SET moderation_status = ?, moderation_reason = ? WHERE id = ?").run(
    parsed.data.status,
    parsed.data.reason || null,
    mediaId
  );
  logAdminAction({
    actionType: "moderate_media",
    targetType: "media",
    targetId: mediaId,
    payload: parsed.data,
    adminId: req.admin.id,
  });
  res.json({ success: true });
});

router.get("/posts", (req, res) => {
  const status = req.query.status || "review";
  const items = db
    .prepare(
      `
      SELECT
        p.id,
        p.user_id AS userId,
        u.nickname,
        p.content,
        p.media_json AS mediaJson,
        p.moderation_status AS moderationStatus,
        p.created_at AS createdAt
      FROM posts p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE (? = 'all' OR p.moderation_status = ?)
      ORDER BY p.created_at DESC
      LIMIT 500
      `
    )
    .all(status, status)
    .map((item) => ({
      ...item,
      media: JSON.parse(item.mediaJson || "[]"),
      mediaJson: undefined,
    }));
  res.json({ items });
});

router.post("/posts/:id/moderate", (req, res) => {
  const schema = z.object({
    status: z.enum(["approved", "rejected"]),
    reason: z.string().max(200).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }

  const postId = req.params.id;
  const exists = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!exists) {
    return res.status(404).json({ message: "post not found" });
  }
  db.prepare("UPDATE posts SET moderation_status = ?, updated_at = datetime('now') WHERE id = ?").run(
    parsed.data.status,
    postId
  );
  logAdminAction({
    actionType: "moderate_post",
    targetType: "post",
    targetId: postId,
    payload: parsed.data,
    adminId: req.admin.id,
  });
  res.json({ success: true });
});

router.get("/groups", (req, res) => {
  const status = req.query.status || "active";
  const items = db
    .prepare(
      `
      SELECT
        g.id,
        g.name,
        g.category,
        g.destination,
        g.route_code AS routeCode,
        g.status,
        g.moderation_status AS moderationStatus,
        g.created_at AS createdAt,
        g.updated_at AS updatedAt,
        u.nickname AS ownerNickname,
        (
          SELECT COUNT(1)
          FROM group_members gm
          WHERE gm.group_id = g.id
        ) AS memberCount
      FROM groups_table g
      LEFT JOIN users u ON u.id = g.owner_user_id
      WHERE (? = 'all' OR g.status = ?)
      ORDER BY g.created_at DESC
      LIMIT 500
      `
    )
    .all(status, status);
  res.json({ items });
});

router.post("/groups/:id/disband", (req, res) => {
  const groupId = req.params.id;
  const exists = db.prepare("SELECT id FROM groups_table WHERE id = ?").get(groupId);
  if (!exists) {
    return res.status(404).json({ message: "group not found" });
  }

  db.prepare("UPDATE groups_table SET status = 'disbanded', updated_at = datetime('now') WHERE id = ?").run(groupId);

  logAdminAction({
    actionType: "disband_group",
    targetType: "group",
    targetId: groupId,
    adminId: req.admin.id,
  });

  res.json({ success: true });
});

module.exports = router;

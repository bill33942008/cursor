const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { adminAuthRequired } = require("../middleware/adminAuth");

const router = express.Router();

router.use(adminAuthRequired);

function logAdminAction({ actionType, targetType, targetId, payload }) {
  db.prepare(
    `
    INSERT INTO admin_actions (id, action_type, target_type, target_id, payload_json)
    VALUES (?, ?, ?, ?, ?)
    `
  ).run(uuidv4(), actionType, targetType, targetId, payload ? JSON.stringify(payload) : null);
}

router.get("/overview", (_req, res) => {
  const openReports = db.prepare("SELECT COUNT(1) AS c FROM reports WHERE status = 'open'").get().c;
  const pendingPosts = db.prepare("SELECT COUNT(1) AS c FROM posts WHERE moderation_status = 'review'").get().c;
  const pendingMedia = db
    .prepare("SELECT COUNT(1) AS c FROM media_assets WHERE moderation_status = 'review'")
    .get().c;
  const bannedUsers = db.prepare("SELECT COUNT(1) AS c FROM users WHERE is_banned = 1").get().c;

  res.json({
    overview: {
      openReports,
      pendingPosts,
      pendingMedia,
      bannedUsers,
    },
  });
});

router.get("/reports", (req, res) => {
  const status = req.query.status || "open";
  const rows = db
    .prepare(
      `
      SELECT id, reporter_user_id AS reporterUserId, target_type AS targetType, target_id AS targetId,
             reason, status, handled_by_admin AS handledByAdmin, handled_at AS handledAt, created_at AS createdAt
      FROM reports
      WHERE status = ?
      ORDER BY created_at DESC
      LIMIT 200
      `
    )
    .all(status);
  res.json({ items: rows });
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
    SET status = ?, handled_by_admin = 'admin-token', handled_at = datetime('now')
    WHERE id = ?
    `
  ).run(parsed.data.status, reportId);

  logAdminAction({
    actionType: "resolve_report",
    targetType: "report",
    targetId: reportId,
    payload: parsed.data,
  });

  res.json({ success: true });
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

  const userId = req.params.id;
  const exists = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!exists) {
    return res.status(404).json({ message: "user not found" });
  }

  db.prepare("UPDATE users SET is_banned = ?, updated_at = datetime('now') WHERE id = ?").run(
    parsed.data.ban ? 1 : 0,
    userId
  );
  if (parsed.data.ban) {
    db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
  }

  logAdminAction({
    actionType: parsed.data.ban ? "ban_user" : "unban_user",
    targetType: "user",
    targetId: userId,
    payload: parsed.data,
  });

  res.json({ success: true });
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
  });

  res.json({ success: true });
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
  });
  res.json({ success: true });
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
  });
  res.json({ success: true });
});

module.exports = router;

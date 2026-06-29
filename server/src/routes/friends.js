const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { isFeatureEnabled } = require("../services/featureFlags");

const router = express.Router();

function rejectFeatureDisabled(res) {
  return res.status(403).json({
    code: "FEATURE_DISABLED",
    featureKey: "profile_social_enabled",
    message: "社交功能当前阶段未开放",
  });
}

router.post("/request", authRequired, (req, res) => {
  if (!isFeatureEnabled("profile_social_enabled", true)) {
    return rejectFeatureDisabled(res);
  }
  const schema = z.object({
    toUserId: z.string().uuid(),
    message: z.string().max(120).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }

  const { toUserId, message } = parsed.data;

  if (toUserId === req.user.id) {
    return res.status(400).json({ message: "cannot add yourself" });
  }

  const targetUser = db.prepare("SELECT id FROM users WHERE id = ?").get(toUserId);
  if (!targetUser) {
    return res.status(404).json({ message: "target user not found" });
  }

  const existingFriend = db
    .prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_user_id = ?")
    .get(req.user.id, toUserId);
  if (existingFriend) {
    return res.status(400).json({ message: "already friends" });
  }

  const existingRequest = db
    .prepare(
      `
      SELECT id FROM friend_requests
      WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
      `
    )
    .get(req.user.id, toUserId);
  if (existingRequest) {
    return res.status(400).json({ message: "request already pending" });
  }

  const requestId = uuidv4();
  db.prepare(
    `
    INSERT INTO friend_requests (id, from_user_id, to_user_id, message)
    VALUES (?, ?, ?, ?)
    `
  ).run(requestId, req.user.id, toUserId, message || null);

  return res.status(201).json({ requestId, status: "pending" });
});

router.delete("/request/:id", authRequired, (req, res) => {
  if (!isFeatureEnabled("profile_social_enabled", true)) {
    return rejectFeatureDisabled(res);
  }
  const requestId = req.params.id;
  const target = db
    .prepare(
      `
      SELECT id, status, from_user_id AS fromUserId
      FROM friend_requests
      WHERE id = ?
      `
    )
    .get(requestId);
  if (!target) {
    return res.status(404).json({ message: "request not found" });
  }
  if (target.fromUserId !== req.user.id) {
    return res.status(403).json({ message: "cannot revoke this request" });
  }
  if (target.status !== "pending") {
    return res.status(400).json({ message: "only pending request can be revoked" });
  }

  db.prepare("UPDATE friend_requests SET status = 'revoked', updated_at = datetime('now') WHERE id = ?").run(requestId);
  return res.json({ success: true, status: "revoked" });
});

router.post("/request/:id/respond", authRequired, (req, res) => {
  if (!isFeatureEnabled("profile_social_enabled", true)) {
    return rejectFeatureDisabled(res);
  }
  const schema = z.object({
    action: z.enum(["accept", "reject"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }

  const requestId = req.params.id;
  const request = db
    .prepare(
      `
      SELECT id, from_user_id AS fromUserId, to_user_id AS toUserId, status
      FROM friend_requests
      WHERE id = ?
      `
    )
    .get(requestId);
  if (!request) {
    return res.status(404).json({ message: "request not found" });
  }
  if (request.toUserId !== req.user.id) {
    return res.status(403).json({ message: "cannot operate this request" });
  }
  if (request.status !== "pending") {
    return res.status(400).json({ message: "request already processed" });
  }

  const action = parsed.data.action;
  db.prepare(
    "UPDATE friend_requests SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(action === "accept" ? "accepted" : "rejected", requestId);

  if (action === "accept") {
    db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_user_id) VALUES (?, ?)").run(
      request.fromUserId,
      request.toUserId
    );
    db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_user_id) VALUES (?, ?)").run(
      request.toUserId,
      request.fromUserId
    );
  }

  return res.json({ status: action === "accept" ? "accepted" : "rejected" });
});

router.get("/", authRequired, (req, res) => {
  if (!isFeatureEnabled("profile_social_enabled", true)) {
    return res.json({
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      featureDisabled: true,
      featureKey: "profile_social_enabled",
    });
  }
  const friends = db
    .prepare(
      `
      SELECT u.id, u.nickname, u.avatar_url AS avatarUrl, u.bio
      FROM friendships f
      JOIN users u ON u.id = f.friend_user_id
      WHERE f.user_id = ?
      ORDER BY u.created_at DESC
      `
    )
    .all(req.user.id);

  const incomingRequests = db
    .prepare(
      `
      SELECT fr.id, fr.message, fr.created_at AS createdAt, u.id AS fromUserId, u.nickname AS fromNickname
      FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
      `
    )
    .all(req.user.id);

  const outgoingRequests = db
    .prepare(
      `
      SELECT fr.id, fr.message, fr.created_at AS createdAt, u.id AS toUserId, u.nickname AS toNickname
      FROM friend_requests fr
      JOIN users u ON u.id = fr.to_user_id
      WHERE fr.from_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
      `
    )
    .all(req.user.id);

  res.json({ friends, incomingRequests, outgoingRequests });
});

module.exports = router;

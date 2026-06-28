const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { optionalAuth } = require("../middleware/optionalAuth");
const { parsePagination } = require("../utils");
const { moderateText } = require("../services/moderation");
const { broadcastGroupMessage } = require("../realtime/hub");
const { isMockDataEnabled } = require("../services/appSettings");
const { getMockGroups } = require("../services/mockData");
const { getUserFeaturePolicy } = require("../services/profilePolicy");

const router = express.Router();

const groupSchema = z.object({
  name: z.string().min(1).max(40),
  category: z.enum(["destination", "flight", "rail", "road_trip", "custom"]),
  destination: z.string().max(64).optional(),
  routeCode: z.string().max(32).optional(),
  description: z.string().max(240).optional(),
  expiresAt: z.string().datetime().optional(),
});

function getUserOpenId(userId) {
  const user = db.prepare("SELECT wx_openid AS openid FROM users WHERE id = ?").get(userId);
  return user?.openid || "";
}

function getCurrentGroupForUser(userId) {
  const current = db
    .prepare("SELECT current_group_id AS currentGroupId FROM users WHERE id = ?")
    .get(userId);
  const currentGroupId = current?.currentGroupId || "";
  if (!currentGroupId) {
    return null;
  }

  const group = db
    .prepare(
      `
      SELECT
        g.id,
        g.name,
        g.category,
        g.destination,
        g.route_code AS routeCode,
        g.description,
        g.status,
        g.created_at AS createdAt,
        owner.id AS ownerUserId,
        owner.nickname AS ownerNickname,
        (
          SELECT COUNT(1)
          FROM group_members gm
          WHERE gm.group_id = g.id
        ) AS memberCount,
        (
          SELECT COUNT(1)
          FROM group_messages msg
          WHERE msg.group_id = g.id
            AND msg.created_at >= datetime('now', '-24 hours')
        ) AS messageCount24h
      FROM groups_table g
      JOIN users owner ON owner.id = g.owner_user_id
      JOIN group_members me ON me.group_id = g.id AND me.user_id = ?
      WHERE g.id = ?
        AND g.status = 'active'
        AND g.moderation_status = 'approved'
      `
    )
    .get(userId, currentGroupId);

  if (!group) {
    db.prepare("UPDATE users SET current_group_id = NULL, updated_at = datetime('now') WHERE id = ?").run(userId);
    return null;
  }

  return {
    ...group,
    memberCount: Number(group.memberCount || 0),
    messageCount24h: Number(group.messageCount24h || 0),
  };
}

router.post("/", authRequired, async (req, res, next) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  try {
    const data = parsed.data;
    const featurePolicy = getUserFeaturePolicy(req.user.id);
    if (!featurePolicy) {
      return res.status(404).json({ message: "user not found" });
    }
    if (featurePolicy.remainingGroupsToday <= 0) {
      return res.status(429).json({
        message: `今日创建群组次数已达上限（${featurePolicy.dailyGroupCreateLimit}次），可升级VIP或联系管理员调整`,
        featurePolicy,
      });
    }

    const groupId = uuidv4();
    const moderation = await moderateText({
      content: `${data.name}\n${data.description || ""}`,
      openid: getUserOpenId(req.user.id),
    });
    if (moderation.status === "rejected") {
      return res.status(400).json({ message: "group content rejected by moderation", moderation });
    }

    db.prepare(
      `
      INSERT INTO groups_table (
        id, owner_user_id, name, category, destination, route_code, description, status, moderation_status, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `
    ).run(
      groupId,
      req.user.id,
      data.name,
      data.category,
      data.destination || null,
      data.routeCode || null,
      data.description || null,
      moderation.status,
      data.expiresAt || null
    );

    db.prepare(
      "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')"
    ).run(groupId, req.user.id);
    db.prepare("UPDATE users SET current_group_id = ?, updated_at = datetime('now') WHERE id = ?").run(
      groupId,
      req.user.id
    );

    db.prepare(
      `
      INSERT INTO moderation_events (id, target_type, target_id, moderator_type, status, reason)
      VALUES (?, 'group', ?, ?, ?, ?)
      `
    ).run(uuidv4(), groupId, moderation.provider, moderation.status, moderation.reason || null);

    return res.status(201).json({
      groupId,
      moderationStatus: moderation.status,
      currentGroup: getCurrentGroupForUser(req.user.id),
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/discover", optionalAuth, (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const category = req.query.category;
  const destination = req.query.destination;
  const keyword = String(req.query.keyword || "").trim();

  let query = `
    SELECT
      g.id,
      g.name,
      g.category,
      g.destination,
      g.route_code AS routeCode,
      g.description,
      g.status,
      g.expires_at AS expiresAt,
      g.created_at AS createdAt,
      owner.id AS ownerUserId,
      owner.nickname AS ownerNickname,
      (
        SELECT COUNT(1)
        FROM group_members gm
        WHERE gm.group_id = g.id
      ) AS memberCount
    FROM groups_table g
    JOIN users owner ON owner.id = g.owner_user_id
    WHERE g.status = 'active'
      AND g.moderation_status = 'approved'
  `;
  const params = [];

  if (category) {
    query += " AND g.category = ?";
    params.push(category);
  }
  if (destination) {
    query += " AND g.destination LIKE ?";
    params.push(`%${destination}%`);
  }
  if (keyword) {
    query += " AND (g.name LIKE ? OR g.destination LIKE ? OR g.route_code LIKE ? OR g.description LIKE ?)";
    const like = `%${keyword}%`;
    params.push(like, like, like, like);
  }

  query += " ORDER BY g.created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(query).all(...params);
  const mergedItems = isMockDataEnabled() ? [...items, ...getMockGroups()] : items;
  res.json({ items: mergedItems, pagination: { limit, offset }, mockDataEnabled: isMockDataEnabled() });
});

router.get("/current", authRequired, (req, res) => {
  const group = getCurrentGroupForUser(req.user.id);
  return res.json({ group });
});

router.post("/:id/join", authRequired, (req, res) => {
  const groupId = req.params.id;
  const group = db
    .prepare("SELECT id, status, moderation_status AS moderationStatus FROM groups_table WHERE id = ?")
    .get(groupId);
  if (!group) {
    return res.status(404).json({ message: "group not found" });
  }
  if (group.status !== "active") {
    return res.status(400).json({ message: "group is not active" });
  }
  if (group.moderationStatus !== "approved") {
    return res.status(400).json({ message: "group is under review" });
  }

  // Keep only one active member-group at a time (owner groups are kept).
  db.prepare("DELETE FROM group_members WHERE user_id = ? AND group_id != ? AND role = 'member'").run(
    req.user.id,
    groupId
  );
  db.prepare(
    "INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')"
  ).run(groupId, req.user.id);
  db.prepare("UPDATE users SET current_group_id = ?, updated_at = datetime('now') WHERE id = ?").run(
    groupId,
    req.user.id
  );

  res.json({
    joined: true,
    currentGroup: getCurrentGroupForUser(req.user.id),
  });
});

router.post("/:id/leave", authRequired, (req, res) => {
  const groupId = req.params.id;
  const membership = db
    .prepare("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, req.user.id);
  if (!membership) {
    return res.status(404).json({ message: "membership not found" });
  }
  if (membership.role === "owner") {
    return res.status(400).json({ message: "owner should disband group instead of leave" });
  }

  db.prepare("DELETE FROM group_members WHERE group_id = ? AND user_id = ?").run(groupId, req.user.id);
  const user = db
    .prepare("SELECT current_group_id AS currentGroupId FROM users WHERE id = ?")
    .get(req.user.id);
  if ((user?.currentGroupId || "") === groupId) {
    db.prepare("UPDATE users SET current_group_id = NULL, updated_at = datetime('now') WHERE id = ?").run(req.user.id);
  }
  res.json({ left: true, currentGroup: getCurrentGroupForUser(req.user.id) });
});

router.post("/:id/disband", authRequired, (req, res) => {
  const groupId = req.params.id;
  const group = db
    .prepare("SELECT id, owner_user_id AS ownerUserId, status FROM groups_table WHERE id = ?")
    .get(groupId);
  if (!group) {
    return res.status(404).json({ message: "group not found" });
  }
  if (group.ownerUserId !== req.user.id) {
    return res.status(403).json({ message: "only owner can disband group" });
  }
  if (group.status !== "active") {
    return res.status(400).json({ message: "group already inactive" });
  }

  db.prepare(
    "UPDATE groups_table SET status = 'disbanded', updated_at = datetime('now') WHERE id = ?"
  ).run(groupId);
  db.prepare("UPDATE users SET current_group_id = NULL, updated_at = datetime('now') WHERE current_group_id = ?").run(
    groupId
  );

  res.json({ disbanded: true });
});

router.get("/:id/messages", authRequired, (req, res) => {
  const groupId = req.params.id;
  const membership = db
    .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, req.user.id);
  if (!membership) {
    return res.status(403).json({ message: "join group first" });
  }

  const { limit, offset } = parsePagination(req.query);

  const messages = db
    .prepare(
      `
      SELECT
        gm.id,
        gm.content,
        gm.is_anonymous AS isAnonymous,
        gm.moderation_status AS moderationStatus,
        gm.created_at AS createdAt,
        u.id AS userId,
        u.nickname
      FROM group_messages gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
        AND gm.moderation_status = 'approved'
      ORDER BY gm.created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(groupId, limit, offset)
    .map((item) => ({
      ...item,
      displayName: item.isAnonymous ? "匿名群友" : item.nickname,
      nickname: undefined,
    }));

  res.json({ items: messages.reverse(), pagination: { limit, offset } });
});

router.post("/:id/messages", authRequired, async (req, res, next) => {
  const groupId = req.params.id;
  const schema = z.object({
    content: z.string().min(1).max(500),
    isAnonymous: z.boolean().default(false),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }

  const membership = db
    .prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, req.user.id);
  if (!membership) {
    return res.status(403).json({ message: "join group first" });
  }

  try {
    const moderation = await moderateText({
      content: parsed.data.content,
      openid: getUserOpenId(req.user.id),
    });
    if (moderation.status === "rejected") {
      return res.status(400).json({ message: "message rejected by moderation", moderation });
    }

    const messageId = uuidv4();
    db.prepare(
      `
      INSERT INTO group_messages (id, group_id, user_id, content, is_anonymous, moderation_status)
      VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(
      messageId,
      groupId,
      req.user.id,
      parsed.data.content,
      parsed.data.isAnonymous ? 1 : 0,
      moderation.status
    );

    db.prepare(
      `
      INSERT INTO moderation_events (id, target_type, target_id, moderator_type, status, reason)
      VALUES (?, 'group_message', ?, ?, ?, ?)
      `
    ).run(uuidv4(), messageId, moderation.provider, moderation.status, moderation.reason || null);

    const created = db
      .prepare(
        `
        SELECT gm.id, gm.content, gm.is_anonymous AS isAnonymous,
               gm.created_at AS createdAt, gm.moderation_status AS moderationStatus,
               u.id AS userId, u.nickname
        FROM group_messages gm
        JOIN users u ON u.id = gm.user_id
        WHERE gm.id = ?
        `
      )
      .get(messageId);

    const wsPayload = {
      ...created,
      displayName: created.isAnonymous ? "匿名群友" : created.nickname,
      nickname: undefined,
    };
    if (created.moderationStatus === "approved") {
      broadcastGroupMessage(groupId, wsPayload);
    }

    return res.status(201).json({ messageId, moderationStatus: moderation.status });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

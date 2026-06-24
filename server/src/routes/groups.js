const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { parsePagination } = require("../utils");

const router = express.Router();

const groupSchema = z.object({
  name: z.string().min(1).max(40),
  category: z.enum(["destination", "flight", "rail", "road_trip", "custom"]),
  destination: z.string().max(64).optional(),
  routeCode: z.string().max(32).optional(),
  description: z.string().max(240).optional(),
  expiresAt: z.string().datetime().optional(),
});

router.post("/", authRequired, (req, res) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  const data = parsed.data;
  const groupId = uuidv4();

  db.prepare(
    `
    INSERT INTO groups_table (
      id, owner_user_id, name, category, destination, route_code, description, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    groupId,
    req.user.id,
    data.name,
    data.category,
    data.destination || null,
    data.routeCode || null,
    data.description || null,
    data.expiresAt || null
  );

  db.prepare(
    "INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'owner')"
  ).run(groupId, req.user.id);

  res.status(201).json({ groupId });
});

router.get("/discover", authRequired, (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const category = req.query.category;
  const destination = req.query.destination;

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

  query += " ORDER BY g.created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(query).all(...params);
  res.json({ items, pagination: { limit, offset } });
});

router.post("/:id/join", authRequired, (req, res) => {
  const groupId = req.params.id;
  const group = db
    .prepare("SELECT id, status FROM groups_table WHERE id = ?")
    .get(groupId);
  if (!group) {
    return res.status(404).json({ message: "group not found" });
  }
  if (group.status !== "active") {
    return res.status(400).json({ message: "group is not active" });
  }

  db.prepare(
    "INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')"
  ).run(groupId, req.user.id);

  res.json({ joined: true });
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
  res.json({ left: true });
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
        gm.created_at AS createdAt,
        u.id AS userId,
        u.nickname
      FROM group_messages gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
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

router.post("/:id/messages", authRequired, (req, res) => {
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

  const messageId = uuidv4();
  db.prepare(
    `
    INSERT INTO group_messages (id, group_id, user_id, content, is_anonymous)
    VALUES (?, ?, ?, ?, ?)
    `
  ).run(messageId, groupId, req.user.id, parsed.data.content, parsed.data.isAnonymous ? 1 : 0);

  res.status(201).json({ messageId });
});

module.exports = router;

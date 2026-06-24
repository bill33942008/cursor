const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { optionalAuth } = require("../middleware/optionalAuth");
const { parsePagination } = require("../utils");

const router = express.Router();

const timelineSchema = z.object({
  title: z.string().min(1).max(80),
  location: z.string().min(1).max(80),
  note: z.string().max(500).optional(),
  occurredAt: z.string().min(4).max(40),
  isPublic: z.boolean().default(true),
});

function mapTimelineEvent(item) {
  return {
    ...item,
    isPublic: Boolean(Number(item.isPublic || 0)),
  };
}

function getRelationship(viewerId, targetUserId) {
  if (!viewerId) {
    return {
      isSelf: false,
      isFriend: false,
      hasOutgoingPendingRequest: false,
      hasIncomingPendingRequest: false,
    };
  }

  const isSelf = viewerId === targetUserId;
  const isFriend = Boolean(
    db.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_user_id = ?").get(viewerId, targetUserId)
  );
  const hasOutgoingPendingRequest = Boolean(
    db
      .prepare(
        `
        SELECT 1
        FROM friend_requests
        WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
        `
      )
      .get(viewerId, targetUserId)
  );
  const hasIncomingPendingRequest = Boolean(
    db
      .prepare(
        `
        SELECT 1
        FROM friend_requests
        WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
        `
      )
      .get(targetUserId, viewerId)
  );

  return {
    isSelf,
    isFriend,
    hasOutgoingPendingRequest,
    hasIncomingPendingRequest,
  };
}

router.get("/me/timeline/visibility", authRequired, (req, res) => {
  const row = db
    .prepare("SELECT timeline_is_public AS timelineIsPublic FROM users WHERE id = ?")
    .get(req.user.id);
  if (!row) {
    return res.status(404).json({ message: "user not found" });
  }
  return res.json({ timelineIsPublic: Boolean(Number(row.timelineIsPublic || 0)) });
});

router.post("/me/timeline/visibility", authRequired, (req, res) => {
  const schema = z.object({
    timelineIsPublic: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  db.prepare("UPDATE users SET timeline_is_public = ?, updated_at = datetime('now') WHERE id = ?").run(
    parsed.data.timelineIsPublic ? 1 : 0,
    req.user.id
  );
  return res.json({ success: true, timelineIsPublic: parsed.data.timelineIsPublic });
});

router.get("/me/timeline", authRequired, (req, res) => {
  const { limit, offset } = parsePagination(req.query);
  const items = db
    .prepare(
      `
      SELECT
        id,
        user_id AS userId,
        title,
        location,
        note,
        occurred_at AS occurredAt,
        is_public AS isPublic,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM user_timeline_events
      WHERE user_id = ?
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(req.user.id, limit, offset)
    .map(mapTimelineEvent);
  return res.json({ items, pagination: { limit, offset } });
});

router.post("/me/timeline", authRequired, (req, res) => {
  const parsed = timelineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  const eventId = uuidv4();
  db.prepare(
    `
    INSERT INTO user_timeline_events (id, user_id, title, location, note, occurred_at, is_public)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    eventId,
    req.user.id,
    parsed.data.title.trim(),
    parsed.data.location.trim(),
    parsed.data.note?.trim() || null,
    parsed.data.occurredAt,
    parsed.data.isPublic ? 1 : 0
  );

  const created = db
    .prepare(
      `
      SELECT
        id,
        user_id AS userId,
        title,
        location,
        note,
        occurred_at AS occurredAt,
        is_public AS isPublic,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM user_timeline_events
      WHERE id = ?
      `
    )
    .get(eventId);
  return res.status(201).json({ event: mapTimelineEvent(created) });
});

router.put("/me/timeline/:eventId", authRequired, (req, res) => {
  const parsed = timelineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  const eventId = req.params.eventId;
  const existing = db
    .prepare("SELECT id FROM user_timeline_events WHERE id = ? AND user_id = ?")
    .get(eventId, req.user.id);
  if (!existing) {
    return res.status(404).json({ message: "timeline event not found" });
  }

  db.prepare(
    `
    UPDATE user_timeline_events
    SET title = ?, location = ?, note = ?, occurred_at = ?, is_public = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
    `
  ).run(
    parsed.data.title.trim(),
    parsed.data.location.trim(),
    parsed.data.note?.trim() || null,
    parsed.data.occurredAt,
    parsed.data.isPublic ? 1 : 0,
    eventId,
    req.user.id
  );

  const updated = db
    .prepare(
      `
      SELECT
        id,
        user_id AS userId,
        title,
        location,
        note,
        occurred_at AS occurredAt,
        is_public AS isPublic,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM user_timeline_events
      WHERE id = ?
      `
    )
    .get(eventId);
  return res.json({ event: mapTimelineEvent(updated) });
});

router.delete("/me/timeline/:eventId", authRequired, (req, res) => {
  const eventId = req.params.eventId;
  const result = db
    .prepare("DELETE FROM user_timeline_events WHERE id = ? AND user_id = ?")
    .run(eventId, req.user.id);
  if (!result.changes) {
    return res.status(404).json({ message: "timeline event not found" });
  }
  return res.json({ success: true });
});

router.get("/:id/public-profile", optionalAuth, (req, res) => {
  const targetUserId = req.params.id;
  const user = db
    .prepare(
      `
      SELECT
        id,
        nickname,
        avatar_url AS avatarUrl,
        bio,
        timeline_is_public AS timelineIsPublic,
        created_at AS createdAt
      FROM users
      WHERE id = ?
      `
    )
    .get(targetUserId);
  if (!user) {
    return res.status(404).json({ message: "user not found" });
  }

  const relation = getRelationship(req.user?.id || null, targetUserId);
  const timelineIsPublic = Boolean(Number(user.timelineIsPublic || 0));
  const canViewTimeline = relation.isSelf || timelineIsPublic;

  const timelineCount = db
    .prepare(
      `
      SELECT COUNT(1) AS c
      FROM user_timeline_events
      WHERE user_id = ?
        AND (? = 1 OR is_public = 1)
      `
    )
    .get(targetUserId, relation.isSelf ? 1 : 0).c;

  return res.json({
    profile: {
      ...user,
      timelineIsPublic,
      canViewTimeline,
      timelineCount: Number(timelineCount || 0),
    },
    relation,
  });
});

router.get("/:id/timeline", optionalAuth, (req, res) => {
  const targetUserId = req.params.id;
  const { limit, offset } = parsePagination(req.query);
  const user = db
    .prepare("SELECT id, timeline_is_public AS timelineIsPublic FROM users WHERE id = ?")
    .get(targetUserId);
  if (!user) {
    return res.status(404).json({ message: "user not found" });
  }
  const relation = getRelationship(req.user?.id || null, targetUserId);
  const canViewTimeline = relation.isSelf || Boolean(Number(user.timelineIsPublic || 0));

  if (!canViewTimeline) {
    return res.json({ allowed: false, items: [], pagination: { limit, offset } });
  }

  const items = db
    .prepare(
      `
      SELECT
        id,
        user_id AS userId,
        title,
        location,
        note,
        occurred_at AS occurredAt,
        is_public AS isPublic,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM user_timeline_events
      WHERE user_id = ?
        AND (? = 1 OR is_public = 1)
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(targetUserId, relation.isSelf ? 1 : 0, limit, offset)
    .map(mapTimelineEvent);

  return res.json({ allowed: true, items, pagination: { limit, offset } });
});

module.exports = router;

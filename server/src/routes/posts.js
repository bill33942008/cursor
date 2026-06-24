const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { parsePagination } = require("../utils");

const router = express.Router();

const postSchema = z.object({
  content: z.string().min(1).max(1000),
  visibility: z.enum(["public", "friends"]).default("public"),
  isAnonymous: z.boolean().default(false),
  media: z.array(z.string().url()).max(9).default([]),
  journeyId: z.string().uuid().optional(),
});

router.post("/", authRequired, (req, res) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid post payload", errors: parsed.error.issues });
  }
  const data = parsed.data;
  const postId = uuidv4();

  db.prepare(
    `
    INSERT INTO posts (id, user_id, journey_id, content, media_json, visibility, is_anonymous)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    postId,
    req.user.id,
    data.journeyId || null,
    data.content,
    JSON.stringify(data.media || []),
    data.visibility,
    data.isAnonymous ? 1 : 0
  );

  const created = db
    .prepare(
      `
      SELECT id, content, media_json AS mediaJson, visibility,
             is_anonymous AS isAnonymous, like_count AS likeCount,
             comment_count AS commentCount, created_at AS createdAt
      FROM posts
      WHERE id = ?
      `
    )
    .get(postId);

  res.status(201).json({
    post: {
      ...created,
      media: JSON.parse(created.mediaJson || "[]"),
      mediaJson: undefined,
    },
  });
});

router.get("/square", authRequired, (req, res) => {
  const { limit, offset } = parsePagination(req.query);

  const items = db
    .prepare(
      `
      SELECT
        p.id,
        p.content,
        p.media_json AS mediaJson,
        p.visibility,
        p.is_anonymous AS isAnonymous,
        p.like_count AS likeCount,
        p.comment_count AS commentCount,
        p.created_at AS createdAt,
        u.id AS userId,
        u.nickname,
        j.transport_type AS transportType,
        j.route_code AS routeCode,
        j.origin,
        j.destination
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN journeys j ON j.id = p.journey_id
      WHERE p.visibility = 'public'
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(limit, offset)
    .map((item) => ({
      ...item,
      displayName: item.isAnonymous ? "匿名旅友" : item.nickname,
      media: JSON.parse(item.mediaJson || "[]"),
      mediaJson: undefined,
      nickname: undefined,
    }));

  res.json({ items, pagination: { limit, offset } });
});

router.post("/:id/like", authRequired, (req, res) => {
  const postId = req.params.id;
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) {
    return res.status(404).json({ message: "post not found" });
  }

  try {
    db.prepare("INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)").run(postId, req.user.id);
    db.prepare("UPDATE posts SET like_count = like_count + 1 WHERE id = ?").run(postId);
  } catch (_err) {
    return res.json({ liked: false, message: "already liked" });
  }

  return res.json({ liked: true });
});

router.post("/:id/report", authRequired, (req, res) => {
  const schema = z.object({
    reason: z.string().min(2).max(200),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid report payload", errors: parsed.error.issues });
  }

  const postId = req.params.id;
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) {
    return res.status(404).json({ message: "post not found" });
  }

  db.prepare(
    `
    INSERT INTO reports (id, reporter_user_id, target_type, target_id, reason)
    VALUES (?, ?, 'post', ?, ?)
    `
  ).run(uuidv4(), req.user.id, postId, parsed.data.reason);

  res.status(201).json({ success: true });
});

module.exports = router;

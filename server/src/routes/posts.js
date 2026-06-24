const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { parsePagination } = require("../utils");
const { moderateText } = require("../services/moderation");

const router = express.Router();

const postSchema = z.object({
  content: z.string().min(1).max(1000),
  visibility: z.enum(["public", "friends"]).default("public"),
  isAnonymous: z.boolean().default(false),
  mediaAssetIds: z.array(z.string().uuid()).max(9).default([]),
  journeyId: z.string().uuid().optional(),
});

const commentSchema = z.object({
  content: z.string().min(1).max(500),
  isAnonymous: z.boolean().default(false),
});

function getUserOpenId(userId) {
  const user = db.prepare("SELECT wx_openid AS openid FROM users WHERE id = ?").get(userId);
  return user?.openid || "";
}

router.post("/", authRequired, async (req, res, next) => {
  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid post payload", errors: parsed.error.issues });
  }

  try {
    const data = parsed.data;
    const postId = uuidv4();
    const moderation = await moderateText({
      content: data.content,
      openid: getUserOpenId(req.user.id),
    });
    if (moderation.status === "rejected") {
      return res.status(400).json({
        message: "content rejected by moderation",
        moderation,
      });
    }

    let mediaUrls = [];
    if (data.mediaAssetIds.length) {
      const rows = db
        .prepare(
          `
          SELECT id, url, moderation_status AS moderationStatus
          FROM media_assets
          WHERE user_id = ? AND id IN (${data.mediaAssetIds.map(() => "?").join(",")})
          `
        )
        .all(req.user.id, ...data.mediaAssetIds);
      if (rows.length !== data.mediaAssetIds.length) {
        return res.status(400).json({ message: "invalid media assets" });
      }
      if (rows.some((item) => item.moderationStatus === "rejected")) {
        return res.status(400).json({ message: "contains rejected media asset" });
      }
      mediaUrls = rows.map((item) => item.url);
    }

    db.prepare(
      `
      INSERT INTO posts (
        id, user_id, journey_id, content, media_json, visibility, is_anonymous, moderation_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      postId,
      req.user.id,
      data.journeyId || null,
      data.content,
      JSON.stringify(mediaUrls),
      data.visibility,
      data.isAnonymous ? 1 : 0,
      moderation.status
    );

    db.prepare(
      `
      INSERT INTO moderation_events (id, target_type, target_id, moderator_type, status, reason)
      VALUES (?, 'post', ?, ?, ?, ?)
      `
    ).run(uuidv4(), postId, moderation.provider, moderation.status, moderation.reason || null);

    const created = db
      .prepare(
        `
        SELECT id, content, media_json AS mediaJson, visibility,
               is_anonymous AS isAnonymous, moderation_status AS moderationStatus,
               like_count AS likeCount, comment_count AS commentCount, created_at AS createdAt
        FROM posts
        WHERE id = ?
        `
      )
      .get(postId);

    return res.status(201).json({
      post: {
        ...created,
        media: JSON.parse(created.mediaJson || "[]"),
        mediaJson: undefined,
      },
    });
  } catch (err) {
    return next(err);
  }
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
        p.moderation_status AS moderationStatus,
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
        AND p.moderation_status = 'approved'
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

router.get("/:id/comments", authRequired, (req, res) => {
  const postId = req.params.id;
  const { limit, offset } = parsePagination(req.query);
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) {
    return res.status(404).json({ message: "post not found" });
  }

  const items = db
    .prepare(
      `
      SELECT
        c.id,
        c.post_id AS postId,
        c.user_id AS userId,
        c.content,
        c.is_anonymous AS isAnonymous,
        c.created_at AS createdAt,
        u.nickname
      FROM post_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ?
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(postId, limit, offset)
    .map((item) => ({
      ...item,
      isAnonymous: Boolean(Number(item.isAnonymous || 0)),
      displayName: Number(item.isAnonymous || 0) === 1 ? "匿名旅友" : item.nickname,
      nickname: undefined,
    }));

  return res.json({ items: items.reverse(), pagination: { limit, offset } });
});

router.post("/:id/comments", authRequired, async (req, res, next) => {
  const postId = req.params.id;
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid comment payload", errors: parsed.error.issues });
  }

  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) {
    return res.status(404).json({ message: "post not found" });
  }

  try {
    const moderation = await moderateText({
      content: parsed.data.content,
      openid: getUserOpenId(req.user.id),
    });
    if (moderation.status === "rejected") {
      return res.status(400).json({
        message: "comment rejected by moderation",
        moderation,
      });
    }

    const commentId = uuidv4();
    db.prepare(
      `
      INSERT INTO post_comments (id, post_id, user_id, content, is_anonymous)
      VALUES (?, ?, ?, ?, ?)
      `
    ).run(commentId, postId, req.user.id, parsed.data.content, parsed.data.isAnonymous ? 1 : 0);
    db.prepare("UPDATE posts SET comment_count = comment_count + 1, updated_at = datetime('now') WHERE id = ?").run(
      postId
    );

    const created = db
      .prepare(
        `
        SELECT
          c.id,
          c.post_id AS postId,
          c.user_id AS userId,
          c.content,
          c.is_anonymous AS isAnonymous,
          c.created_at AS createdAt,
          u.nickname
        FROM post_comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.id = ?
        `
      )
      .get(commentId);

    return res.status(201).json({
      comment: {
        ...created,
        isAnonymous: Boolean(Number(created.isAnonymous || 0)),
        displayName: Number(created.isAnonymous || 0) === 1 ? "匿名旅友" : created.nickname,
        nickname: undefined,
      },
    });
  } catch (err) {
    return next(err);
  }
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

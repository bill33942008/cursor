const express = require("express");
const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { optionalAuth } = require("../middleware/optionalAuth");
const { parsePagination } = require("../utils");
const {
  getCurrentCycleYear,
  getUserPolicyBundle,
  getUserProfilePolicy,
  normalizeMembershipTier,
} = require("../services/profilePolicy");

const router = express.Router();

const timelineSchema = z.object({
  title: z.string().min(1).max(80),
  location: z.string().min(1).max(80),
  note: z.string().max(500).optional(),
  occurredAt: z.string().min(4).max(40),
  isPublic: z.boolean().default(true),
  mediaAssetIds: z.array(z.string().uuid()).max(9).default([]),
  keepMediaUrls: z.array(z.string().min(1).max(2000)).max(9).optional().default([]),
});

const profileUpdateSchema = z
  .object({
    nickname: z.string().trim().min(1).max(32).optional(),
    avatarUrl: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.nickname !== undefined || value.avatarUrl !== undefined, {
    message: "nickname or avatarUrl is required",
    path: ["nickname"],
  });

function isValidAvatarUrl(value) {
  if (!value) return true;
  return /^https?:\/\//i.test(value) || value.startsWith("/");
}

function mapTimelineEvent(item) {
  let media = [];
  try {
    media = JSON.parse(item.mediaJson || "[]");
  } catch (_err) {
    media = [];
  }
  return {
    ...item,
    isPublic: Boolean(Number(item.isPublic || 0)),
    media,
    mediaJson: undefined,
  };
}

function resolveMediaUrlsForUser(userId, mediaAssetIds = []) {
  if (!mediaAssetIds.length) {
    return [];
  }
  const rows = db
    .prepare(
      `
      SELECT id, url, moderation_status AS moderationStatus
      FROM media_assets
      WHERE user_id = ? AND id IN (${mediaAssetIds.map(() => "?").join(",")})
      `
    )
    .all(userId, ...mediaAssetIds);

  if (rows.length !== mediaAssetIds.length) {
    return null;
  }
  if (rows.some((item) => item.moderationStatus === "rejected")) {
    return false;
  }
  return rows.map((item) => item.url);
}

function normalizeTimelineMedia(userId, mediaAssetIds, keepMediaUrls) {
  const nextKeepUrls = Array.from(new Set((keepMediaUrls || []).filter((url) => typeof url === "string" && url.trim())));
  const uploadedUrls = resolveMediaUrlsForUser(userId, mediaAssetIds || []);
  if (uploadedUrls === null) {
    return { error: "invalid media assets" };
  }
  if (uploadedUrls === false) {
    return { error: "contains rejected media asset" };
  }
  const media = Array.from(new Set([...nextKeepUrls, ...uploadedUrls])).slice(0, 9);
  return { media };
}

function mapPublicPost(item) {
  let media = [];
  try {
    media = JSON.parse(item.mediaJson || "[]");
  } catch (_err) {
    media = [];
  }
  return {
    ...item,
    media,
    mediaJson: undefined,
    displayName: Number(item.isAnonymous || 0) === 1 ? "匿名旅友" : item.nickname,
    nickname: undefined,
    isAnonymous: Boolean(Number(item.isAnonymous || 0)),
  };
}

function getRelationship(viewerId, targetUserId) {
  if (!viewerId) {
    return {
      isSelf: false,
      isFriend: false,
      hasOutgoingPendingRequest: false,
      hasIncomingPendingRequest: false,
      outgoingPendingRequestId: "",
      incomingPendingRequestId: "",
    };
  }

  const isSelf = viewerId === targetUserId;
  const isFriend = Boolean(
    db.prepare("SELECT 1 FROM friendships WHERE user_id = ? AND friend_user_id = ?").get(viewerId, targetUserId)
  );
  const outgoingPendingRequest = db
    .prepare(
      `
      SELECT id
      FROM friend_requests
      WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
      `
    )
    .get(viewerId, targetUserId);
  const incomingPendingRequest = db
    .prepare(
      `
      SELECT id
      FROM friend_requests
      WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
      `
    )
    .get(targetUserId, viewerId);

  return {
    isSelf,
    isFriend,
    hasOutgoingPendingRequest: Boolean(outgoingPendingRequest),
    hasIncomingPendingRequest: Boolean(incomingPendingRequest),
    outgoingPendingRequestId: outgoingPendingRequest?.id || "",
    incomingPendingRequestId: incomingPendingRequest?.id || "",
  };
}

router.get("/me/profile-policy", authRequired, (req, res) => {
  const bundle = getUserPolicyBundle(req.user.id);
  if (!bundle?.profilePolicy) {
    return res.status(404).json({ message: "user not found" });
  }
  return res.json({
    profilePolicy: bundle.profilePolicy,
    featurePolicy: bundle.featurePolicy,
  });
});

router.put("/me/profile", authRequired, (req, res) => {
  const parsed = profileUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "invalid payload", errors: parsed.error.issues });
  }
  const incomingNickname = parsed.data.nickname;
  const incomingAvatarUrl = parsed.data.avatarUrl;
  if (incomingAvatarUrl !== undefined && !isValidAvatarUrl(incomingAvatarUrl)) {
    return res.status(400).json({ message: "avatarUrl should be an http(s) url or local path" });
  }

  const currentUser = db
    .prepare(
      `
      SELECT
        id,
        nickname,
        avatar_url AS avatarUrl,
        membership_tier AS membershipTier
      FROM users
      WHERE id = ?
      `
    )
    .get(req.user.id);
  if (!currentUser) {
    return res.status(404).json({ message: "user not found" });
  }

  const nextNickname = incomingNickname !== undefined ? incomingNickname.trim() : currentUser.nickname;
  const nextAvatarUrl = incomingAvatarUrl !== undefined ? incomingAvatarUrl.trim() : currentUser.avatarUrl || "";
  if (!nextNickname) {
    return res.status(400).json({ message: "nickname is required" });
  }

  const hasChanged =
    nextNickname !== String(currentUser.nickname || "") ||
    nextAvatarUrl !== String(currentUser.avatarUrl || "");
  const profilePolicy = getUserProfilePolicy(req.user.id);
  if (!profilePolicy) {
    return res.status(404).json({ message: "user not found" });
  }
  if (!hasChanged) {
    return res.json({
      user: {
        ...currentUser,
        nickname: nextNickname,
        avatarUrl: nextAvatarUrl,
        membershipTier: normalizeMembershipTier(currentUser.membershipTier),
      },
      profilePolicy,
      unchanged: true,
    });
  }
  if (profilePolicy.remainingChanges <= 0) {
    return res.status(429).json({ message: "本年度资料修改次数已用完，请联系管理员调整额度" });
  }

  const currentYear = getCurrentCycleYear();
  const result = db
    .prepare(
      `
      UPDATE users
      SET nickname = ?,
          avatar_url = ?,
          profile_change_used_this_year = profile_change_used_this_year + 1,
          updated_at = datetime('now')
      WHERE id = ?
        AND profile_change_cycle_year = ?
        AND profile_change_used_this_year < profile_change_limit_per_year
      `
    )
    .run(nextNickname, nextAvatarUrl || null, req.user.id, currentYear);
  if (!result.changes) {
    return res.status(429).json({ message: "资料修改次数不足，请稍后重试或联系管理员" });
  }

  const updatedUser = db
    .prepare(
      `
      SELECT
        id,
        nickname,
        avatar_url AS avatarUrl,
        bio,
        membership_tier AS membershipTier,
        created_at AS createdAt
      FROM users
      WHERE id = ?
      `
    )
    .get(req.user.id);
  return res.json({
    user: {
      ...updatedUser,
      membershipTier: normalizeMembershipTier(updatedUser.membershipTier),
    },
    profilePolicy: getUserProfilePolicy(req.user.id),
    featurePolicy: getUserPolicyBundle(req.user.id)?.featurePolicy || null,
  });
});

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
        media_json AS mediaJson,
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
  const { media, error } = normalizeTimelineMedia(
    req.user.id,
    parsed.data.mediaAssetIds,
    []
  );
  if (error) {
    return res.status(400).json({ message: error });
  }
  const eventId = uuidv4();
  db.prepare(
    `
    INSERT INTO user_timeline_events (id, user_id, title, location, note, media_json, occurred_at, is_public)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    eventId,
    req.user.id,
    parsed.data.title.trim(),
    parsed.data.location.trim(),
    parsed.data.note?.trim() || null,
    JSON.stringify(media),
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
        media_json AS mediaJson,
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
    .prepare("SELECT id, media_json AS mediaJson FROM user_timeline_events WHERE id = ? AND user_id = ?")
    .get(eventId, req.user.id);
  if (!existing) {
    return res.status(404).json({ message: "timeline event not found" });
  }

  let existedMedia = [];
  try {
    existedMedia = JSON.parse(existing.mediaJson || "[]");
  } catch (_err) {
    existedMedia = [];
  }
  const hasKeepMediaUrls = Array.isArray(req.body?.keepMediaUrls);
  const keepMediaUrls = hasKeepMediaUrls ? parsed.data.keepMediaUrls : existedMedia;
  const { media, error } = normalizeTimelineMedia(req.user.id, parsed.data.mediaAssetIds, keepMediaUrls);
  if (error) {
    return res.status(400).json({ message: error });
  }

  db.prepare(
    `
    UPDATE user_timeline_events
    SET title = ?, location = ?, note = ?, media_json = ?, occurred_at = ?, is_public = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
    `
  ).run(
    parsed.data.title.trim(),
    parsed.data.location.trim(),
    parsed.data.note?.trim() || null,
    JSON.stringify(media),
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
        media_json AS mediaJson,
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
        media_json AS mediaJson,
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

router.get("/:id/public-posts", optionalAuth, (req, res) => {
  const targetUserId = req.params.id;
  const { limit, offset } = parsePagination(req.query);
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId);
  if (!user) {
    return res.status(404).json({ message: "user not found" });
  }

  const relation = getRelationship(req.user?.id || null, targetUserId);
  const includeNonPublic = relation.isSelf ? 1 : 0;
  const items = db
    .prepare(
      `
      SELECT
        p.id,
        p.user_id AS userId,
        p.content,
        p.media_json AS mediaJson,
        p.visibility,
        p.is_anonymous AS isAnonymous,
        p.like_count AS likeCount,
        p.comment_count AS commentCount,
        p.created_at AS createdAt,
        p.updated_at AS updatedAt,
        p.moderation_status AS moderationStatus,
        j.transport_type AS transportType,
        j.origin,
        j.destination,
        u.nickname
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN journeys j ON j.id = p.journey_id
      WHERE p.user_id = ?
        AND p.moderation_status = 'approved'
        AND (p.visibility = 'public' OR ? = 1)
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(targetUserId, includeNonPublic, limit, offset)
    .map(mapPublicPost);

  return res.json({
    items,
    pagination: { limit, offset },
  });
});

module.exports = router;

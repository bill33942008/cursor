const express = require("express");
const { optionalAuth } = require("../middleware/optionalAuth");
const { db } = require("../db");
const { isMockDataEnabled } = require("../services/appSettings");
const { getMockSceneTracks } = require("../services/mockData");

const router = express.Router();

const TRANSPORT_LABELS = {
  high_speed_rail: "高铁",
  flight: "航班",
  train: "列车",
  bus: "大巴",
  road_trip: "自驾",
  other: "出行",
};

const SCENE_EMOJI_MAP = {
  high_speed_rail: "🚄",
  flight: "✈️",
  train: "🚆",
  bus: "🚌",
  road_trip: "🚗",
  other: "📍",
};

function safeParseMedia(mediaJson) {
  try {
    const parsed = JSON.parse(mediaJson || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function normalizeDestination(value) {
  return String(value || "").trim();
}

function buildTransportPrompt(transportType, routeCode) {
  const label = TRANSPORT_LABELS[transportType] || "旅程";
  const code = String(routeCode || "").trim();
  if (code) {
    return `尊敬的乘客您好，您乘坐的 ${code} ${label}即将发车，请准备好欣赏这一波同行信息。`;
  }
  return `欢迎进入${label}场景剧场，正在为你聚合同程旅友动态。`;
}

function mapPostRowToSceneItem(row) {
  const isAnonymous = Boolean(Number(row.isAnonymous || 0));
  return {
    id: row.id,
    userId: row.userId,
    nickname: isAnonymous ? "匿名旅友" : row.nickname,
    avatarUrl: isAnonymous
      ? "https://api.dicebear.com/9.x/thumbs/svg?seed=anon-traveler"
      : row.avatarUrl || "https://api.dicebear.com/9.x/thumbs/svg?seed=tongxing-user",
    content: row.content,
    media: safeParseMedia(row.mediaJson),
    createdAt: row.createdAt,
    origin: row.origin || "",
    destination: row.destination || "",
  };
}

function appendPostToScene(map, sceneId, initializer, sceneItem) {
  if (!map.has(sceneId)) {
    map.set(sceneId, initializer());
  }
  const scene = map.get(sceneId);
  scene.posts.push(sceneItem);
  scene.postCount = scene.posts.length;
  scene.lastUpdatedAt = sceneItem.createdAt;
}

function buildSceneTracks(rows) {
  const transportMap = new Map();
  const scenicMap = new Map();

  rows.forEach((row) => {
    const transportType = String(row.transportType || "").trim();
    const routeCode = String(row.routeCode || "").trim();
    const destination = normalizeDestination(row.destination);
    const sceneItem = mapPostRowToSceneItem(row);

    if (routeCode) {
      const transportLabel = TRANSPORT_LABELS[transportType] || "出行";
      const sceneId = `transport:${transportType}:${routeCode}`;
      appendPostToScene(
        transportMap,
        sceneId,
        () => ({
          sceneId,
          sceneType: "transport",
          transportType,
          routeCode,
          title: `${routeCode} 同${transportLabel}剧场`,
          subtitle: `${row.origin || "出发地"} → ${row.destination || "目的地"}`,
          coverEmoji: SCENE_EMOJI_MAP[transportType] || "🚄",
          promptText: buildTransportPrompt(transportType, routeCode),
          posts: [],
          postCount: 0,
          lastUpdatedAt: row.createdAt,
        }),
        sceneItem
      );
    }

    if (destination) {
      const sceneId = `scenic:${destination}`;
      appendPostToScene(
        scenicMap,
        sceneId,
        () => ({
          sceneId,
          sceneType: "scenic",
          transportType: transportType || "other",
          routeCode: "",
          title: `${destination} 场景剧场`,
          subtitle: "同目的地旅友聚合",
          coverEmoji: "🏞️",
          promptText: `已抵达 ${destination} 场景，正在为你调取同目的地旅友动态。`,
          posts: [],
          postCount: 0,
          lastUpdatedAt: row.createdAt,
        }),
        sceneItem
      );
    }
  });

  const transportTracks = Array.from(transportMap.values()).map((scene) => ({
    ...scene,
    posts: scene.posts.slice(0, 12),
  }));
  const scenicTracks = Array.from(scenicMap.values()).map((scene) => ({
    ...scene,
    posts: scene.posts.slice(0, 12),
  }));

  return {
    transportTracks,
    scenicTracks,
  };
}

router.get("/vertical-feed", optionalAuth, (req, res) => {
  const sceneType = String(req.query.sceneType || "all").trim();
  const keyword = String(req.query.keyword || "").trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 120, 10), 300);

  let sql = `
    SELECT
      p.id,
      p.content,
      p.media_json AS mediaJson,
      p.is_anonymous AS isAnonymous,
      p.created_at AS createdAt,
      u.id AS userId,
      u.nickname,
      u.avatar_url AS avatarUrl,
      j.transport_type AS transportType,
      j.route_code AS routeCode,
      j.origin,
      j.destination
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN journeys j ON j.id = p.journey_id
    WHERE p.visibility = 'public'
      AND p.moderation_status = 'approved'
      AND j.id IS NOT NULL
  `;
  const params = [];
  if (keyword) {
    sql += " AND (j.route_code LIKE ? OR j.destination LIKE ? OR p.content LIKE ?)";
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  sql += " ORDER BY p.created_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  const { transportTracks, scenicTracks } = buildSceneTracks(rows);

  let tracks = [];
  if (sceneType === "transport") {
    tracks = transportTracks;
  } else if (sceneType === "scenic") {
    tracks = scenicTracks;
  } else {
    tracks = [...transportTracks, ...scenicTracks];
  }

  if (isMockDataEnabled()) {
    const mockTracks = getMockSceneTracks();
    tracks = tracks.concat(
      mockTracks.filter((item) => sceneType === "all" || item.sceneType === sceneType)
    );
  }

  tracks.sort((a, b) => {
    const diff = Number(b.postCount || 0) - Number(a.postCount || 0);
    if (diff !== 0) return diff;
    return String(b.lastUpdatedAt || "").localeCompare(String(a.lastUpdatedAt || ""));
  });

  res.json({
    items: tracks,
    sceneType,
    mockDataEnabled: isMockDataEnabled(),
    keyword,
  });
});

module.exports = router;

const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");
const { authRequired } = require("../middleware/auth");
const { uploadBuffer } = require("../services/storage");
const { moderateMedia } = require("../services/moderation");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

function getUserOpenId(userId) {
  const user = db.prepare("SELECT wx_openid AS openid FROM users WHERE id = ?").get(userId);
  return user?.openid || "";
}

router.post("/upload", authRequired, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "file is required" });
    }

    const uploaded = await uploadBuffer(req.file);
    const openid = getUserOpenId(req.user.id);
    const isVideo = req.file.mimetype === "video/mp4";
    const moderation = await moderateMedia({
      mediaUrl: uploaded.url.startsWith("http")
        ? uploaded.url
        : `${process.env.PUBLIC_BASE_URL || "http://localhost:3000"}${uploaded.url}`,
      mediaType: isVideo ? 2 : 1,
      openid,
    });

    const mediaAsset = {
      id: uuidv4(),
      userId: req.user.id,
      provider: uploaded.provider,
      storageKey: uploaded.key,
      url: uploaded.url,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      moderationStatus: moderation.status,
      moderationReason: moderation.reason || null,
    };

    db.prepare(
      `
      INSERT INTO media_assets (
        id, user_id, provider, storage_key, url, mime_type, size_bytes, moderation_status, moderation_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      mediaAsset.id,
      mediaAsset.userId,
      mediaAsset.provider,
      mediaAsset.storageKey,
      mediaAsset.url,
      mediaAsset.mimeType,
      mediaAsset.sizeBytes,
      mediaAsset.moderationStatus,
      mediaAsset.moderationReason
    );

    return res.status(201).json({
      asset: mediaAsset,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/my-assets", authRequired, (req, res) => {
  const items = db
    .prepare(
      `
      SELECT
        id,
        provider,
        storage_key AS storageKey,
        url,
        mime_type AS mimeType,
        size_bytes AS sizeBytes,
        moderation_status AS moderationStatus,
        moderation_reason AS moderationReason,
        created_at AS createdAt
      FROM media_assets
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100
      `
    )
    .all(req.user.id);

  res.json({ items });
});

module.exports = router;

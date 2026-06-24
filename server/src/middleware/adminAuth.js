const { db } = require("../db");
const { hasAdminJwtSecret, verifyAdminToken } = require("../services/adminAuth");

function parseAuthToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7);
  }
  return req.headers["x-admin-token"] || "";
}

function adminAuthRequired(req, res, next) {
  const token = parseAuthToken(req);
  if (!token) {
    return res.status(401).json({ message: "missing admin token" });
  }

  // Backward compatible static token mode (for emergency scripts).
  const legacyToken = process.env.ADMIN_TOKEN || "";
  if (legacyToken && token === legacyToken) {
    req.admin = {
      id: "legacy-admin-token",
      username: "legacy-token",
      role: "super_admin",
      authMode: "legacy_token",
    };
    return next();
  }

  if (!hasAdminJwtSecret()) {
    return res.status(503).json({
      message: "admin jwt not configured, set ADMIN_JWT_SECRET (at least 16 chars)",
    });
  }

  try {
    const payload = verifyAdminToken(token);
    const admin = db
      .prepare(
        `
        SELECT id, username, role, status
        FROM admin_users
        WHERE id = ?
        `
      )
      .get(payload.sub);
    if (!admin || admin.status !== "active") {
      return res.status(401).json({ message: "admin account inactive or missing" });
    }
    req.admin = {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      authMode: "jwt",
    };
    return next();
  } catch (_err) {
    return res.status(401).json({ message: "invalid admin token" });
  }
}

module.exports = {
  adminAuthRequired,
};

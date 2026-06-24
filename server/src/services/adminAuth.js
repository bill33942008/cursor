const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { db } = require("../db");

const MIN_ADMIN_JWT_SECRET_LENGTH = 16;

function hasAdminJwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET || "";
  return secret.length >= MIN_ADMIN_JWT_SECRET_LENGTH;
}

function getJwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET || "";
  if (!hasAdminJwtSecret()) {
    throw new Error(
      `ADMIN_JWT_SECRET must be configured and at least ${MIN_ADMIN_JWT_SECRET_LENGTH} chars`
    );
  }
  return secret;
}

function getJwtExpiresIn() {
  return process.env.ADMIN_JWT_EXPIRES_IN || "12h";
}

function isStrongPassword(password) {
  if (typeof password !== "string") return false;
  // Minimum 10 chars and include lower/upper/number/symbol.
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,}$/.test(password);
}

function hashAdminPassword(password) {
  return bcrypt.hash(password, 12);
}

function verifyAdminPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signAdminToken(adminUser) {
  const payload = {
    sub: adminUser.id,
    username: adminUser.username,
    role: adminUser.role,
    type: "admin_access",
  };
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: "HS256",
    expiresIn: getJwtExpiresIn(),
    issuer: "tongxing-admin",
    audience: "tongxing-admin-panel",
  });
}

function verifyAdminToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"],
    issuer: "tongxing-admin",
    audience: "tongxing-admin-panel",
  });
}

async function ensureBootstrapAdmin() {
  const existing = db.prepare("SELECT COUNT(1) AS c FROM admin_users").get();
  if (Number(existing?.c || 0) > 0) {
    return;
  }

  const username = process.env.ADMIN_INIT_USERNAME || "";
  const password = process.env.ADMIN_INIT_PASSWORD || "";
  if (!username || !password) {
    console.warn(
      "[admin] no bootstrap admin configured. Set ADMIN_INIT_USERNAME and ADMIN_INIT_PASSWORD to initialize."
    );
    return;
  }
  if (!isStrongPassword(password)) {
    throw new Error(
      "ADMIN_INIT_PASSWORD does not meet strength requirement (10+ chars, upper/lower/number/symbol)"
    );
  }

  const passwordHash = await hashAdminPassword(password);
  db.prepare(
    `
    INSERT INTO admin_users (id, username, password_hash, role, status)
    VALUES (?, ?, ?, 'super_admin', 'active')
    `
  ).run(uuidv4(), username, passwordHash);
  console.log(`[admin] bootstrap admin user created: ${username}`);
}

module.exports = {
  MIN_ADMIN_JWT_SECRET_LENGTH,
  hasAdminJwtSecret,
  isStrongPassword,
  hashAdminPassword,
  verifyAdminPassword,
  signAdminToken,
  verifyAdminToken,
  ensureBootstrapAdmin,
};

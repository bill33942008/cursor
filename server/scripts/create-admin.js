#!/usr/bin/env node
const { v4: uuidv4 } = require("uuid");
const { initializeDatabase, initSchema, db } = require("../src/db");
const { isStrongPassword, hashAdminPassword } = require("../src/services/adminAuth");

async function main() {
  const username = (process.argv[2] || "").trim();
  const password = process.argv[3] || "";

  if (!username || !password) {
    console.error("Usage: npm run admin:create -- <username> <password>");
    process.exit(1);
  }
  if (!isStrongPassword(password)) {
    console.error("Password too weak: 10+ chars with upper/lower/number/symbol required.");
    process.exit(1);
  }

  await initializeDatabase();
  initSchema();

  const hash = await hashAdminPassword(password);
  const existing = db.prepare("SELECT id FROM admin_users WHERE username = ?").get(username);
  if (existing) {
    db.prepare(
      `
      UPDATE admin_users
      SET password_hash = ?, status = 'active', updated_at = datetime('now')
      WHERE id = ?
      `
    ).run(hash, existing.id);
    console.log(`Admin updated: ${username}`);
    return;
  }

  db.prepare(
    `
    INSERT INTO admin_users (id, username, password_hash, role, status)
    VALUES (?, ?, ?, 'super_admin', 'active')
    `
  ).run(uuidv4(), username, hash);
  console.log(`Admin created: ${username}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

const dbPath = process.env.DB_PATH || "./data/tongxing.db";
const absoluteDbPath = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(absoluteDbPath), { recursive: true });

let sqlDb = null;
let initPromise = null;

function assertReady() {
  if (!sqlDb) {
    throw new Error("database is not initialized");
  }
}

function persistDb() {
  assertReady();
  const data = sqlDb.export();
  fs.writeFileSync(absoluteDbPath, Buffer.from(data));
}

function normalizeParams(params) {
  if (!params || params.length === 0) {
    return [];
  }
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0];
  }
  return params;
}

class StatementWrapper {
  constructor(sql) {
    this.sql = sql;
  }

  get(...params) {
    assertReady();
    const stmt = sqlDb.prepare(this.sql);
    const normalized = normalizeParams(params);
    if (normalized.length) {
      stmt.bind(normalized);
    }
    let row = undefined;
    if (stmt.step()) {
      row = stmt.getAsObject();
    }
    stmt.free();
    return row;
  }

  all(...params) {
    assertReady();
    const stmt = sqlDb.prepare(this.sql);
    const normalized = normalizeParams(params);
    if (normalized.length) {
      stmt.bind(normalized);
    }
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }

  run(...params) {
    assertReady();
    const stmt = sqlDb.prepare(this.sql);
    const normalized = normalizeParams(params);
    stmt.run(normalized);
    stmt.free();
    const changes = sqlDb.getRowsModified();
    persistDb();
    return { changes };
  }
}

const db = {
  pragma(_sql) {
    // sql.js does not require pragma config for this MVP.
  },
  exec(sql) {
    assertReady();
    sqlDb.exec(sql);
    persistDb();
  },
  prepare(sql) {
    return new StatementWrapper(sql);
  },
};

async function initializeDatabase() {
  if (sqlDb) {
    return;
  }
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    const SQL = await initSqlJs();
    if (fs.existsSync(absoluteDbPath)) {
      const fileBuffer = fs.readFileSync(absoluteDbPath);
      sqlDb = new SQL.Database(new Uint8Array(fileBuffer));
    } else {
      sqlDb = new SQL.Database();
      persistDb();
    }
  })();

  await initPromise;
}

function addColumnIfMissing(tableName, columnName, definitionSql) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql};`);
  }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      wx_openid TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      avatar_url TEXT,
      bio TEXT,
      is_banned INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT,
      timeline_is_public INTEGER NOT NULL DEFAULT 0,
      current_group_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS journeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      transport_type TEXT NOT NULL,
      route_code TEXT,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      phase TEXT NOT NULL,
      departure_window TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      journey_id TEXT,
      content TEXT NOT NULL,
      media_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'public',
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      like_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (journey_id) REFERENCES journeys(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS post_likes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL,
      friend_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, friend_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS groups_table (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      destination TEXT,
      route_code TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      handled_by_admin TEXT,
      handled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      moderation_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS moderation_events (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      moderator_type TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_actions (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'super_admin',
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_active_users (
      user_id TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, activity_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      parent_comment_id TEXT,
      reply_to_user_id TEXT,
      content TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_comment_id) REFERENCES post_comments(id) ON DELETE CASCADE,
      FOREIGN KEY (reply_to_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS user_timeline_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      note TEXT,
      media_json TEXT NOT NULL DEFAULT '[]',
      occurred_at TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

  `);

  addColumnIfMissing("posts", "moderation_status", "moderation_status TEXT NOT NULL DEFAULT 'approved'");
  addColumnIfMissing("groups_table", "moderation_status", "moderation_status TEXT NOT NULL DEFAULT 'approved'");
  addColumnIfMissing(
    "group_messages",
    "moderation_status",
    "moderation_status TEXT NOT NULL DEFAULT 'approved'"
  );
  addColumnIfMissing("reports", "handled_by_admin", "handled_by_admin TEXT");
  addColumnIfMissing("reports", "handled_at", "handled_at TEXT");
  addColumnIfMissing("users", "last_active_at", "last_active_at TEXT");
  addColumnIfMissing("users", "timeline_is_public", "timeline_is_public INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("users", "current_group_id", "current_group_id TEXT");
  addColumnIfMissing("post_comments", "parent_comment_id", "parent_comment_id TEXT");
  addColumnIfMissing("post_comments", "reply_to_user_id", "reply_to_user_id TEXT");
  addColumnIfMissing("user_timeline_events", "media_json", "media_json TEXT NOT NULL DEFAULT '[]'");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts (visibility);
    CREATE INDEX IF NOT EXISTS idx_posts_mod_status ON posts (moderation_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_journeys_user_id ON journeys (user_id);
    CREATE INDEX IF NOT EXISTS idx_journeys_transport_dest ON journeys (transport_type, destination);
    CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages (group_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_group_messages_mod_status ON group_messages (moderation_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_groups_mod_status ON groups_table (moderation_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_assets_user_id ON media_assets (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_assets_mod_status ON media_assets (moderation_status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_last_active_at ON users (last_active_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_timeline_public ON users (timeline_is_public);
    CREATE INDEX IF NOT EXISTS idx_users_current_group_id ON users (current_group_id);
    CREATE INDEX IF NOT EXISTS idx_daily_active_users_date ON daily_active_users (activity_date DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users (username);
    CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings (setting_key);
    CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments (post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_post_comments_parent_id ON post_comments (parent_comment_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_user_timeline_events_user_id ON user_timeline_events (user_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_timeline_events_public ON user_timeline_events (is_public, occurred_at DESC);
  `);
}

function checkConnection() {
  db.prepare("SELECT 1").get();
}

module.exports = {
  db,
  initializeDatabase,
  initSchema,
  checkConnection,
};

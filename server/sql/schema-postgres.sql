-- PostgreSQL schema used by the Node service.
-- This schema intentionally keeps several SQLite-like data shapes
-- (TEXT ids, INTEGER flags, JSON stored as TEXT) to minimize code changes.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  wx_openid VARCHAR(128) UNIQUE NOT NULL,
  nickname VARCHAR(32) NOT NULL,
  avatar_url TEXT,
  bio VARCHAR(240),
  is_banned INTEGER NOT NULL DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  timeline_is_public INTEGER NOT NULL DEFAULT 0,
  current_group_id TEXT,
  membership_tier VARCHAR(16) NOT NULL DEFAULT 'normal',
  vip_expires_at TIMESTAMPTZ,
  profile_change_limit_per_year INTEGER NOT NULL DEFAULT 2,
  profile_change_used_this_year INTEGER NOT NULL DEFAULT 0,
  profile_change_cycle_year INTEGER NOT NULL DEFAULT CAST(EXTRACT(YEAR FROM CURRENT_DATE) AS INTEGER),
  daily_post_limit_override INTEGER,
  daily_group_create_limit_override INTEGER,
  scene_window_max_minutes_override INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_last_active_at ON users(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_timeline_public ON users(timeline_is_public);
CREATE INDEX IF NOT EXISTS idx_users_current_group_id ON users(current_group_id);
CREATE INDEX IF NOT EXISTS idx_users_membership_tier ON users(membership_tier);
CREATE INDEX IF NOT EXISTS idx_users_vip_expires_at ON users(vip_expires_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS journeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transport_type VARCHAR(32) NOT NULL,
  route_code VARCHAR(32),
  origin VARCHAR(64) NOT NULL,
  destination VARCHAR(64) NOT NULL,
  phase VARCHAR(32) NOT NULL,
  departure_window VARCHAR(64),
  visibility VARCHAR(16) NOT NULL DEFAULT 'public',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_journeys_user_id ON journeys(user_id);
CREATE INDEX IF NOT EXISTS idx_journeys_transport_dest ON journeys(transport_type, destination);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey_id TEXT REFERENCES journeys(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  media_json TEXT NOT NULL DEFAULT '[]',
  visibility VARCHAR(16) NOT NULL DEFAULT 'public',
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  moderation_status VARCHAR(16) NOT NULL DEFAULT 'approved',
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);
CREATE INDEX IF NOT EXISTS idx_posts_mod_status ON posts(moderation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id TEXT REFERENCES post_comments(id) ON DELETE CASCADE,
  reply_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_parent_id ON post_comments(parent_comment_id, created_at ASC);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message VARCHAR(120),
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_status ON friend_requests(to_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, friend_user_id)
);

CREATE TABLE IF NOT EXISTS groups_table (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(40) NOT NULL,
  category VARCHAR(24) NOT NULL,
  destination VARCHAR(64),
  route_code VARCHAR(32),
  description VARCHAR(240),
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  moderation_status VARCHAR(16) NOT NULL DEFAULT 'approved',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_groups_mod_status ON groups_table(moderation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL REFERENCES groups_table(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(16) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups_table(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  moderation_status VARCHAR(16) NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_mod_status ON group_messages(moderation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type VARCHAR(16) NOT NULL,
  target_id TEXT NOT NULL,
  reason VARCHAR(200) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  handled_by_admin VARCHAR(64),
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(16) NOT NULL,
  storage_key TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  size_bytes INTEGER NOT NULL,
  moderation_status VARCHAR(16) NOT NULL DEFAULT 'approved',
  moderation_reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_media_assets_user_id ON media_assets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_mod_status ON media_assets(moderation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_events (
  id TEXT PRIMARY KEY,
  target_type VARCHAR(24) NOT NULL,
  target_id TEXT NOT NULL,
  moderator_type VARCHAR(24) NOT NULL,
  status VARCHAR(16) NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY,
  action_type VARCHAR(64) NOT NULL,
  target_type VARCHAR(24) NOT NULL,
  target_id TEXT NOT NULL,
  payload_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(setting_key);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'super_admin',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);

CREATE TABLE IF NOT EXISTS daily_active_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, activity_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_active_users_date ON daily_active_users(activity_date DESC);

CREATE TABLE IF NOT EXISTS user_timeline_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(80) NOT NULL,
  location VARCHAR(80) NOT NULL,
  note VARCHAR(500),
  media_json TEXT NOT NULL DEFAULT '[]',
  occurred_at TIMESTAMPTZ NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_timeline_events_user_id ON user_timeline_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_timeline_events_public ON user_timeline_events(is_public, occurred_at DESC);

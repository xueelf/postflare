-- 表结构：多用户邮箱，每个用户一个独立邮箱

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  language TEXT NOT NULL DEFAULT 'en',
  -- 登录失败计数与最近一次失败时间，用于限流（同 Roundcube 的 failed_login）
  failed_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 所有者唯一
CREATE UNIQUE INDEX idx_users_owner ON users (role) WHERE role = 'owner';

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- 一次性链接：user_id 为空表示邀请，被邀请者自己选用户名与昵称，非空表示重置密码
-- max_uses 与 used_count 限定邀请链接可供几人注册，重置链接固定一人一次
CREATE TABLE user_tokens (
  id TEXT PRIMARY KEY,
  
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_user_tokens_user ON user_tokens (user_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox TEXT NOT NULL DEFAULT 'inbox' CHECK (mailbox IN ('inbox', 'sent', 'drafts', 'spam', 'trash')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  seen INTEGER NOT NULL DEFAULT 0 CHECK (seen IN (0, 1)),
  from_address TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT,
  body_html TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  "references" TEXT,
  raw_storage_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_mailbox ON messages (user_id, mailbox, created_at);

-- 草稿按更新时间排序
CREATE INDEX idx_messages_draft_order ON messages (user_id, mailbox, updated_at);

-- 定时清理回收站与垃圾邮件按更新时间范围扫描
CREATE INDEX idx_messages_updated ON messages (updated_at);

-- 入站邮件按 Message-ID 去重（Email Routing 为至少一次投递，重投会重复入库）
CREATE UNIQUE INDEX idx_messages_message_id
  ON messages (user_id, message_id)
  WHERE message_id IS NOT NULL AND direction = 'inbound';

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_templates_user ON templates (user_id, updated_at);

-- 附件归属邮件或模板，二选一
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((message_id IS NULL) <> (template_id IS NULL))
);

CREATE INDEX idx_attachments_message ON attachments (message_id);
CREATE INDEX idx_attachments_template ON attachments (template_id);

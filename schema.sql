-- 创建笔记表
CREATE TABLE IF NOT EXISTS notes (
    path TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    is_locked BOOLEAN DEFAULT 0,
    lock_type TEXT CHECK(lock_type IN ('read', 'write', NULL)),
    password_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    view_count INTEGER DEFAULT 0
);

-- 创建管理日志表
CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    target_path TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    details TEXT
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_view_count ON notes(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_timestamp ON admin_logs(timestamp DESC);
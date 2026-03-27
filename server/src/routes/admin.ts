import { Hono } from 'hono';
import { AppContext, Note, AdminStats } from '../types';
import { createJWT } from '../utils/jwt';
import { requireAuth } from '../middleware/auth';
import { verifyPassword, hashPassword } from '../utils/crypto';

const admin = new Hono<{ Bindings: AppContext['env'] }>();

// 管理面板页面
admin.get('/', async (c) => {
  return c.html(getAdminPanelHTML());
});

// 管理员登录
admin.post('/login', async (c) => {
  const { username, password } = await c.req.json<{
    username: string;
    password: string;
  }>();
  
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }
  
  // 验证管理员账号
  if (username !== c.env.ADMIN_USER || password !== c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  
  const duration = parseInt(c.env.SESSION_DURATION) || 86400;
  const token = await createJWT(c.env.JWT_SECRET, username, duration);
  
  return c.json({ 
    success: true, 
    token,
    expiresIn: duration 
  });
});

// 获取统计信息
admin.get('/stats', requireAuth, async (c) => {
  const totalNotes = await c.env.DB
    .prepare('SELECT COUNT(*) as count FROM notes')
    .first<{ count: number }>();
  
  const lockedNotes = await c.env.DB
    .prepare('SELECT COUNT(*) as count FROM notes WHERE is_locked = 1')
    .first<{ count: number }>();
  
  const totalViews = await c.env.DB
    .prepare('SELECT SUM(view_count) as total FROM notes')
    .first<{ total: number }>();
  
  const stats: AdminStats = {
    total_notes: totalNotes?.count || 0,
    locked_notes: lockedNotes?.count || 0,
    total_views: totalViews?.total || 0
  };
  
  return c.json(stats);
});

// 获取所有笔记列表
admin.get('/notes', requireAuth, async (c) => {
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '20');
  const search = c.req.query('search') || '';
  const offset = (page - 1) * limit;
  
  let query = 'SELECT * FROM notes';
  let countQuery = 'SELECT COUNT(*) as count FROM notes';
  const params: any[] = [];
  
  if (search) {
    query += ' WHERE path LIKE ? OR content LIKE ?';
    countQuery += ' WHERE path LIKE ? OR content LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
  
  const result = await c.env.DB
    .prepare(query)
    .bind(...params, limit, offset)
    .all<Note>();
  
  const total = await c.env.DB
    .prepare(countQuery)
    .bind(...(search ? params : []))
    .first<{ count: number }>();
  
  return c.json({
    notes: result.results,
    total: total?.count || 0,
    page,
    limit,
    totalPages: Math.ceil((total?.count || 0) / limit)
  });
});

// 获取单个笔记
admin.get('/notes/:path', requireAuth, async (c) => {
  const path = c.req.param('path');
  
  const note = await c.env.DB
    .prepare('SELECT * FROM notes WHERE path = ?')
    .bind(path)
    .first<Note>();
  
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }
  
  return c.json(note);
});

// 更新笔记
admin.put('/notes/:path', requireAuth, async (c) => {
  const path = c.req.param('path');
  const { content, is_locked, lock_type, password } = await c.req.json<{
    content?: string;
    is_locked?: boolean;
    lock_type?: 'read' | 'write';
    password?: string;
  }>();
  
  // 检查笔记是否存在
  const existing = await c.env.DB
    .prepare('SELECT * FROM notes WHERE path = ?')
    .bind(path)
    .first<Note>();
  
  if (!existing) {
    return c.json({ error: 'Note not found' }, 404);
  }
  
  // 构建更新查询
  const updates: string[] = [];
  const values: any[] = [];
  
  if (content !== undefined) {
    updates.push('content = ?');
    values.push(content);
  }
  
  if (is_locked !== undefined) {
    updates.push('is_locked = ?');
    values.push(is_locked ? 1 : 0);
    
    if (is_locked && lock_type) {
      updates.push('lock_type = ?');
      values.push(lock_type);
      
      if (password) {
        const passwordHash = await hashPassword(password);
        updates.push('password_hash = ?');
        values.push(passwordHash);
      }
    } else if (!is_locked) {
      updates.push('lock_type = NULL');
      updates.push('password_hash = NULL');
    }
  }
  
  if (updates.length === 0) {
    return c.json({ error: 'No updates provided' }, 400);
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(path);
  
  await c.env.DB
    .prepare(`UPDATE notes SET ${updates.join(', ')} WHERE path = ?`)
    .bind(...values)
    .run();
  
  // 清除缓存
  await c.env.CACHE.delete(`note:${path}`);
  
  return c.json({ success: true });
});

// 删除笔记
admin.delete('/notes/:path', requireAuth, async (c) => {
  const path = c.req.param('path');
  
  const result = await c.env.DB
    .prepare('DELETE FROM notes WHERE path = ?')
    .bind(path)
    .run();
  
  if (result.meta?.changes === 0) {
    return c.json({ error: 'Note not found' }, 404);
  }
  
  // 清除缓存
  await c.env.CACHE.delete(`note:${path}`);
  
  return c.json({ success: true });
});

// 创建新笔记
admin.post('/notes', requireAuth, async (c) => {
  const { path, content, is_locked, lock_type, password } = await c.req.json<{
    path: string;
    content?: string;
    is_locked?: boolean;
    lock_type?: 'read' | 'write';
    password?: string;
  }>();
  
  if (!path) {
    return c.json({ error: 'Path is required' }, 400);
  }
  
  // 检查路径是否已存在
  const existing = await c.env.DB
    .prepare('SELECT 1 FROM notes WHERE path = ?')
    .bind(path)
    .first();
  
  if (existing) {
    return c.json({ error: 'Path already exists' }, 409);
  }
  
  // 准备插入数据
  const fields = ['path', 'content'];
  const values: any[] = [path, content || ''];
  const placeholders = ['?', '?'];
  
  if (is_locked && password) {
    fields.push('is_locked', 'lock_type', 'password_hash');
    values.push(1, lock_type || 'write', await hashPassword(password));
    placeholders.push('?', '?', '?');
  }
  
  await c.env.DB
    .prepare(`INSERT INTO notes (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`)
    .bind(...values)
    .run();
  
  return c.json({ success: true, path });
});

// 导出所有笔记
admin.get('/export', requireAuth, async (c) => {
  const notes = await c.env.DB
    .prepare('SELECT * FROM notes')
    .all<Note>();
  
  const exportData = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    notes: notes.results.map(note => ({
      path: note.path,
      content: note.content,
      is_locked: note.is_locked,
      lock_type: note.lock_type,
      view_count: note.view_count,
      created_at: note.created_at,
      updated_at: note.updated_at
    }))
  };
  
  // 保存到存储
  const filename = `export-${Date.now()}.json`;
  await c.env.STORAGE.put(
    `exports/${filename}`,
    JSON.stringify(exportData, null, 2)
  );
  
  return c.json({
    success: true,
    filename,
    count: notes.results.length,
    data: exportData
  });
});

// 导入笔记
admin.post('/import', requireAuth, async (c) => {
  const body = await c.req.json<{
    notes: Array<{
      path: string;
      content: string;
      is_locked?: boolean;
      lock_type?: 'read' | 'write';
      password?: string;
    }>;
  }>();
  
  if (!body.notes || !Array.isArray(body.notes)) {
    return c.json({ error: 'Invalid import data' }, 400);
  }
  
  let imported = 0;
  let failed = 0;
  
  for (const note of body.notes) {
    try {
      // 检查是否已存在
      const existing = await c.env.DB
        .prepare('SELECT id FROM notes WHERE path = ?')
        .bind(note.path)
        .first();
      
      if (existing) {
        // 更新现有笔记
        if (note.is_locked && note.password) {
          const passwordHash = await hashPassword(note.password);
          await c.env.DB
            .prepare('UPDATE notes SET content = ?, is_locked = ?, lock_type = ?, password_hash = ? WHERE path = ?')
            .bind(note.content, 1, note.lock_type || 'write', passwordHash, note.path)
            .run();
        } else {
          await c.env.DB
            .prepare('UPDATE notes SET content = ? WHERE path = ?')
            .bind(note.content, note.path)
            .run();
        }
      } else {
        // 创建新笔记
        if (note.is_locked && note.password) {
          const passwordHash = await hashPassword(note.password);
          await c.env.DB
            .prepare('INSERT INTO notes (path, content, is_locked, lock_type, password_hash) VALUES (?, ?, ?, ?, ?)')
            .bind(note.path, note.content, 1, note.lock_type || 'write', passwordHash)
            .run();
        } else {
          await c.env.DB
            .prepare('INSERT INTO notes (path, content) VALUES (?, ?)')
            .bind(note.path, note.content)
            .run();
        }
      }
      
      imported++;
      
      // 清除缓存
      await c.env.CACHE.delete(`note:${note.path}`);
    } catch (error) {
      console.error(`Failed to import note ${note.path}:`, error);
      failed++;
    }
  }
  
  return c.json({
    success: true,
    imported,
    failed,
    total: body.notes.length
  });
});

// 创建备份
admin.post('/backup', requireAuth, async (c) => {
  const notes = await c.env.DB
    .prepare('SELECT * FROM notes')
    .all<Note>();
  
  const backup = {
    version: '1.0',
    created_at: new Date().toISOString(),
    notes: notes.results
  };
  
  const filename = `backup-${Date.now()}.json`;
  await c.env.STORAGE.put(
    `backups/${filename}`,
    JSON.stringify(backup, null, 2)
  );
  
  return c.json({
    success: true,
    filename,
    size: JSON.stringify(backup).length,
    notes: notes.results.length
  });
});

function getAdminPanelHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CloudNote Admin Panel</title>
  <link href="https://cdn.quilljs.com/1.3.6/quill.snow.css" rel="stylesheet">
  <style>
    :root {
      --primary-color: #2563eb;
      --primary-hover: #1d4ed8;
      --secondary-color: #6b7280;
      --success-color: #10b981;
      --error-color: #ef4444;
      --warning-color: #f59e0b;
      --bg-color: #ffffff;
      --bg-secondary: #f8fafc;
      --text-primary: #1f2937;
      --text-secondary: #6b7280;
      --text-muted: #9ca3af;
      --border-color: #e5e7eb;
      --spacing-xs: 0.25rem;
      --spacing-sm: 0.5rem;
      --spacing-md: 1rem;
      --spacing-lg: 1.5rem;
      --spacing-xl: 2rem;
      --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
      --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      --border-radius: 8px;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-primary);
      background: var(--bg-secondary);
    }
    
    /* 登录页面 */
    .login-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
    }
    
    .login-box {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
      width: 100%;
      max-width: 400px;
      padding: 40px;
    }
    
    /* 管理面板布局 */
    .admin-container {
      display: none;
      min-height: 100vh;
      background: var(--bg-secondary);
    }
    
    /* 顶部导航栏 */
    .navbar {
      background: var(--bg-color);
      border-bottom: 1px solid var(--border-color);
      padding: var(--spacing-md) var(--spacing-lg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: var(--shadow-sm);
    }
    
    .navbar-brand {
      font-size: 20px;
      font-weight: 600;
      color: var(--text-primary);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }
    
    .navbar-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
    }
    
    /* 主要内容区 */
    .main-content {
      max-width: 1400px;
      margin: 0 auto;
      padding: var(--spacing-xl);
    }
    
    /* 统计卡片 */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: var(--spacing-lg);
      margin-bottom: var(--spacing-xl);
    }
    
    .stat-card {
      background: var(--bg-color);
      padding: var(--spacing-lg);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-sm);
      border: 1px solid var(--border-color);
    }
    
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      color: var(--primary-color);
      margin-bottom: var(--spacing-xs);
    }
    
    .stat-label {
      color: var(--text-secondary);
      font-size: 14px;
    }
    
    /* 工具栏 */
    .toolbar {
      background: var(--bg-color);
      padding: var(--spacing-md);
      border-radius: var(--border-radius);
      margin-bottom: var(--spacing-lg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: var(--spacing-md);
      box-shadow: var(--shadow-sm);
    }
    
    .toolbar-left {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      flex-wrap: wrap;
    }
    
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }
    
    /* 搜索框 */
    .search-box {
      position: relative;
      min-width: 300px;
    }
    
    .search-input {
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      padding-left: 36px;
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius);
      font-size: 14px;
      transition: all 0.3s;
    }
    
    .search-input:focus {
      outline: none;
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    
    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
    }
    
    /* 表格 */
    .table-container {
      background: var(--bg-color);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    
    thead {
      background: var(--bg-secondary);
      border-bottom: 2px solid var(--border-color);
    }
    
    th {
      padding: var(--spacing-md);
      text-align: left;
      font-weight: 600;
      color: var(--text-primary);
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    tbody tr {
      border-bottom: 1px solid var(--border-color);
      transition: background 0.2s;
    }
    
    tbody tr:hover {
      background: var(--bg-secondary);
    }
    
    td {
      padding: var(--spacing-md);
      color: var(--text-primary);
    }
    
    .note-path {
      font-family: monospace;
      color: var(--primary-color);
      text-decoration: none;
      font-weight: 500;
    }
    
    .note-path:hover {
      text-decoration: underline;
    }
    
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .badge-locked {
      background: #fee;
      color: #c33;
    }
    
    .badge-unlocked {
      background: #e6f7ff;
      color: #0050b3;
    }
    
    /* 按钮 */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-xs);
      padding: var(--spacing-sm) var(--spacing-md);
      font-size: 14px;
      font-weight: 500;
      border: 1px solid transparent;
      border-radius: var(--border-radius);
      cursor: pointer;
      transition: all 0.2s ease;
      text-decoration: none;
      white-space: nowrap;
      user-select: none;
      background: var(--bg-color);
      color: var(--text-primary);
      border-color: var(--border-color);
    }
    
    .btn:hover:not(:disabled) {
      background: var(--bg-secondary);
      transform: translateY(-1px);
    }
    
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .btn-primary {
      background: var(--primary-color);
      color: white;
      border-color: var(--primary-color);
    }
    
    .btn-primary:hover:not(:disabled) {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }
    
    .btn-success {
      background: var(--success-color);
      color: white;
      border-color: var(--success-color);
    }
    
    .btn-danger {
      background: var(--error-color);
      color: white;
      border-color: var(--error-color);
    }
    
    .btn-small {
      padding: 4px 8px;
      font-size: 12px;
    }
    
    .btn-group {
      display: flex;
      gap: var(--spacing-xs);
    }
    
    /* 模态框 */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    
    .modal.show {
      display: flex;
    }
    
    .modal-content {
      background: var(--bg-color);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-lg);
      width: 90%;
      max-width: 800px;
      max-height: 90vh;
      overflow-y: auto;
    }
    
    .modal-header {
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .modal-title {
      font-size: 20px;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    .modal-close {
      background: none;
      border: none;
      font-size: 24px;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    }
    
    .modal-close:hover {
      background: var(--bg-secondary);
      color: var(--text-primary);
    }
    
    .modal-body {
      padding: var(--spacing-lg);
    }
    
    .modal-footer {
      padding: var(--spacing-lg);
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-sm);
    }
    
    /* 表单 */
    .form-group {
      margin-bottom: var(--spacing-md);
    }
    
    .form-label {
      display: block;
      margin-bottom: var(--spacing-xs);
      color: var(--text-primary);
      font-weight: 500;
      font-size: 14px;
    }
    
    .form-input,
    .form-select,
    .form-textarea {
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius);
      font-size: 14px;
      transition: all 0.3s;
      background: var(--bg-color);
    }
    
    .form-textarea {
      min-height: 100px;
      resize: vertical;
    }
    
    .form-input:focus,
    .form-select:focus,
    .form-textarea:focus {
      outline: none;
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    
    .form-checkbox {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }
    
    /* Quill编辑器 */
    #noteEditor {
      height: 400px;
      margin-bottom: var(--spacing-md);
    }
    
    .ql-container {
      font-size: 16px;
    }
    
    /* 分页 */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-xs);
      margin-top: var(--spacing-lg);
    }
    
    .page-btn {
      padding: 6px 12px;
      border: 1px solid var(--border-color);
      background: var(--bg-color);
      color: var(--text-primary);
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .page-btn:hover:not(:disabled) {
      background: var(--bg-secondary);
      border-color: var(--primary-color);
      color: var(--primary-color);
    }
    
    .page-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .page-btn.active {
      background: var(--primary-color);
      color: white;
      border-color: var(--primary-color);
    }
    
    /* 消息提示 */
    .toast {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: var(--spacing-md);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      z-index: 2000;
      animation: slideIn 0.3s ease;
    }
    
    .toast-success {
      background: var(--success-color);
      color: white;
    }
    
    .toast-error {
      background: var(--error-color);
      color: white;
    }
    
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    /* 加载动画 */
    .loading {
      display: none;
      text-align: center;
      padding: var(--spacing-xl);
      color: var(--text-secondary);
    }
    
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid var(--border-color);
      border-top: 4px solid var(--primary-color);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto var(--spacing-md);
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    /* 响应式 */
    @media (max-width: 768px) {
      .main-content {
        padding: var(--spacing-md);
      }
      
      .stats-grid {
        grid-template-columns: 1fr;
      }
      
      .toolbar {
        flex-direction: column;
        align-items: stretch;
      }
      
      .toolbar-left,
      .toolbar-right {
        width: 100%;
      }
      
      .search-box {
        min-width: 100%;
      }
      
      .table-container {
        overflow-x: auto;
      }
      
      table {
        min-width: 600px;
      }
    }
  </style>
</head>
<body>
  <!-- 登录页面 -->
  <div class="login-container" id="loginPage">
    <div class="login-box">
      <h1 style="text-align: center; margin-bottom: 30px;">CloudNote Admin</h1>
      
      <div id="loginError" style="display: none; background: #fee; color: #c33; padding: 10px; border-radius: 6px; margin-bottom: 20px;"></div>
      
      <div class="form-group">
        <label class="form-label" for="username">用户名</label>
        <input type="text" id="username" class="form-input" placeholder="输入管理员用户名" autocomplete="username">
      </div>
      
      <div class="form-group">
        <label class="form-label" for="password">密码</label>
        <input type="password" id="password" class="form-input" placeholder="输入管理员密码" autocomplete="current-password">
      </div>
      
      <button class="btn btn-primary" style="width: 100%;" onclick="login()">登录</button>
    </div>
  </div>
  
  <!-- 管理面板 -->
  <div class="admin-container" id="adminPage">
    <!-- 导航栏 -->
    <div class="navbar">
      <a href="/" class="navbar-brand">
        CloudNote Admin
      </a>
      <div class="navbar-actions">
        <span id="adminUser" style="color: var(--text-secondary); margin-right: 10px;"></span>
        <button class="btn" onclick="logout()">退出登录</button>
      </div>
    </div>
    
    <!-- 主内容 -->
    <div class="main-content">
      <!-- 统计卡片 -->
      <div class="stats-grid" id="statsGrid">
        <div class="stat-card">
          <div class="stat-value">-</div>
          <div class="stat-label">总笔记数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">-</div>
          <div class="stat-label">已锁定</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">-</div>
          <div class="stat-label">总浏览量</div>
        </div>
      </div>
      
      <!-- 工具栏 -->
      <div class="toolbar">
        <div class="toolbar-left">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="text" id="searchInput" class="search-input" placeholder="搜索笔记路径或内容..." onkeyup="handleSearch(event)">
          </div>
          <button class="btn btn-primary" onclick="showCreateModal()">➕ 新建笔记</button>
        </div>
        <div class="toolbar-right">
          <button class="btn" onclick="refreshNotes()">🔄 刷新</button>
          <button class="btn" onclick="exportNotes()">📥 导出</button>
          <button class="btn" onclick="showImportModal()">📤 导入</button>
          <button class="btn" onclick="createBackup()">💾 备份</button>
        </div>
      </div>
      
      <!-- 笔记表格 -->
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 30%;">路径</th>
              <th style="width: 15%;">状态</th>
              <th style="width: 10%;">浏览量</th>
              <th style="width: 20%;">更新时间</th>
              <th style="width: 25%;">操作</th>
            </tr>
          </thead>
          <tbody id="notesTable">
            <tr>
              <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">
                加载中...
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <!-- 分页 -->
      <div class="pagination" id="pagination"></div>
    </div>
  </div>
  
  <!-- 编辑笔记模态框 -->
  <div class="modal" id="editModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title" id="editModalTitle">编辑笔记</h2>
        <button class="modal-close" onclick="closeEditModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">路径</label>
          <input type="text" id="editPath" class="form-input" readonly>
        </div>
        
        <div class="form-group">
          <label class="form-label">内容</label>
          <div id="noteEditor"></div>
        </div>
        
        <div class="form-group">
          <div class="form-checkbox">
            <input type="checkbox" id="editLocked" onchange="toggleLockOptions()">
            <label for="editLocked">锁定笔记</label>
          </div>
        </div>
        
        <div id="lockOptions" style="display: none;">
          <div class="form-group">
            <label class="form-label">锁定类型</label>
            <select id="editLockType" class="form-select">
              <option value="write">限制编辑</option>
              <option value="read">限制访问</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">密码（留空保持原密码）</label>
            <input type="password" id="editPassword" class="form-input" placeholder="输入新密码">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeEditModal()">取消</button>
        <button class="btn btn-primary" onclick="saveNote()">保存</button>
      </div>
    </div>
  </div>
  
  <!-- 创建笔记模态框 -->
  <div class="modal" id="createModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">创建新笔记</h2>
        <button class="modal-close" onclick="closeCreateModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">路径</label>
          <input type="text" id="createPath" class="form-input" placeholder="输入笔记路径">
        </div>
        
        <div class="form-group">
          <label class="form-label">内容（可选）</label>
          <textarea id="createContent" class="form-textarea" placeholder="输入笔记内容"></textarea>
        </div>
        
        <div class="form-group">
          <div class="form-checkbox">
            <input type="checkbox" id="createLocked" onchange="toggleCreateLockOptions()">
            <label for="createLocked">锁定笔记</label>
          </div>
        </div>
        
        <div id="createLockOptions" style="display: none;">
          <div class="form-group">
            <label class="form-label">锁定类型</label>
            <select id="createLockType" class="form-select">
              <option value="write">限制编辑</option>
              <option value="read">限制访问</option>
            </select>
          </div>
          
          <div class="form-group">
            <label class="form-label">密码</label>
            <input type="password" id="createPassword" class="form-input" placeholder="输入密码">
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeCreateModal()">取消</button>
        <button class="btn btn-primary" onclick="createNote()">创建</button>
      </div>
    </div>
  </div>
  
  <!-- 导入模态框 -->
  <div class="modal" id="importModal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">导入笔记</h2>
        <button class="modal-close" onclick="closeImportModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">选择JSON文件</label>
          <input type="file" id="importFile" accept=".json" class="form-input">
        </div>
        <div class="form-group">
          <label class="form-label">或粘贴JSON内容</label>
          <textarea id="importContent" class="form-textarea" style="min-height: 200px;" placeholder='{"notes": [{"path": "example", "content": "..."}]}'></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="closeImportModal()">取消</button>
        <button class="btn btn-primary" onclick="importNotes()">导入</button>
      </div>
    </div>
  </div>
  
  <script src="https://cdn.quilljs.com/1.3.6/quill.js"></script>
  <script>
    let token = localStorage.getItem('adminToken');
    let quillEditor = null;
    let currentPage = 1;
    let totalPages = 1;
    let searchQuery = '';
    
    // 初始化
    if (token) {
      checkAuth();
    }
    
    // 检查认证
    async function checkAuth() {
      try {
        const response = await fetch('/admin/stats', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (response.ok) {
          showAdminPanel();
          loadStats();
          loadNotes();
        } else {
          localStorage.removeItem('adminToken');
          token = null;
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    }
    
    // 登录
    async function login() {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const error = document.getElementById('loginError');
      
      if (!username || !password) {
        error.textContent = '请输入用户名和密码';
        error.style.display = 'block';
        return;
      }
      
      try {
        const response = await fetch('/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          token = data.token;
          localStorage.setItem('adminToken', token);
          document.getElementById('adminUser').textContent = username;
          showAdminPanel();
          loadStats();
          loadNotes();
        } else {
          error.textContent = data.error || '登录失败';
          error.style.display = 'block';
        }
      } catch (err) {
        error.textContent = '网络错误，请重试';
        error.style.display = 'block';
      }
    }
    
    // 显示管理面板
    function showAdminPanel() {
      document.getElementById('loginPage').style.display = 'none';
      document.getElementById('adminPage').style.display = 'block';
    }
    
    // 退出登录
    function logout() {
      localStorage.removeItem('adminToken');
      window.location.reload();
    }
    
    // 加载统计
    async function loadStats() {
      try {
        const response = await fetch('/admin/stats', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (response.ok) {
          const stats = await response.json();
          const cards = document.querySelectorAll('.stat-card');
          cards[0].querySelector('.stat-value').textContent = stats.total_notes || 0;
          cards[1].querySelector('.stat-value').textContent = stats.locked_notes || 0;
          cards[2].querySelector('.stat-value').textContent = stats.total_views || 0;
        }
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    }
    
    // 加载笔记列表
    async function loadNotes(page = 1) {
      currentPage = page;
      try {
        const params = new URLSearchParams({
          page: page.toString(),
          limit: '10',
          search: searchQuery
        });
        
        const response = await fetch('/admin/notes?' + params, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (response.ok) {
          const data = await response.json();
          totalPages = data.totalPages;
          renderNotes(data.notes);
          renderPagination();
        }
      } catch (error) {
        console.error('Failed to load notes:', error);
        showToast('加载笔记失败', 'error');
      }
    }
    
    // 渲染笔记列表
    function renderNotes(notes) {
      const tbody = document.getElementById('notesTable');
      
      if (notes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 40px; color: var(--text-muted);">暂无笔记</td></tr>';
        return;
      }
      
      tbody.innerHTML = notes.map(note => \`
        <tr>
          <td>
            <a href="/\${note.path}" target="_blank" class="note-path">/\${note.path}</a>
          </td>
          <td>
            <span class="badge \${note.is_locked ? 'badge-locked' : 'badge-unlocked'}">
              \${note.is_locked ? '🔒 ' + (note.lock_type === 'read' ? '访问锁定' : '编辑锁定') : '🔓 未锁定'}
            </span>
          </td>
          <td>\${note.view_count || 0}</td>
          <td>\${new Date(note.updated_at).toLocaleString('zh-CN')}</td>
          <td>
            <div class="btn-group">
              <button class="btn btn-small" onclick="viewNote('\${note.path}')">查看</button>
              <button class="btn btn-small" onclick="editNote('\${note.path}')">编辑</button>
              <button class="btn btn-small btn-danger" onclick="deleteNote('\${note.path}')">删除</button>
            </div>
          </td>
        </tr>
      \`).join('');
    }
    
    // 渲染分页
    function renderPagination() {
      const pagination = document.getElementById('pagination');
      
      if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
      }
      
      let html = '';
      
      // 上一页
      html += \`<button class="page-btn" onclick="loadNotes(\${currentPage - 1})" \${currentPage === 1 ? 'disabled' : ''}>上一页</button>\`;
      
      // 页码
      for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
          html += \`<button class="page-btn \${i === currentPage ? 'active' : ''}" onclick="loadNotes(\${i})">\${i}</button>\`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
          html += '<span style="padding: 0 8px;">...</span>';
        }
      }
      
      // 下一页
      html += \`<button class="page-btn" onclick="loadNotes(\${currentPage + 1})" \${currentPage === totalPages ? 'disabled' : ''}>下一页</button>\`;
      
      pagination.innerHTML = html;
    }
    
    // 搜索处理
    function handleSearch(event) {
      if (event.key === 'Enter' || event.type === 'input') {
        searchQuery = event.target.value;
        loadNotes(1);
      }
    }
    
    // 刷新
    function refreshNotes() {
      loadStats();
      loadNotes(currentPage);
      showToast('已刷新', 'success');
    }
    
    // 查看笔记
    function viewNote(path) {
      window.open('/' + path, '_blank');
    }
    
    // 编辑笔记
    async function editNote(path) {
      try {
        const response = await fetch('/admin/notes/' + path, {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (response.ok) {
          const note = await response.json();
          
          document.getElementById('editPath').value = note.path;
          document.getElementById('editLocked').checked = note.is_locked;
          
          if (note.is_locked) {
            document.getElementById('lockOptions').style.display = 'block';
            document.getElementById('editLockType').value = note.lock_type;
          }
          
          // 初始化Quill编辑器
          if (!quillEditor) {
            quillEditor = new Quill('#noteEditor', {
              theme: 'snow',
              modules: {
                toolbar: [
                  [{ 'header': [1, 2, 3, false] }],
                  ['bold', 'italic', 'underline', 'strike'],
                  ['blockquote', 'code-block'],
                  [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                  ['link', 'image'],
                  ['clean']
                ]
              }
            });
          }
          
          quillEditor.root.innerHTML = note.content || '';
          document.getElementById('editModalTitle').textContent = '编辑笔记: /' + path;
          document.getElementById('editModal').classList.add('show');
        }
      } catch (error) {
        console.error('Failed to load note:', error);
        showToast('加载笔记失败', 'error');
      }
    }
    
    // 保存笔记
    async function saveNote() {
      const path = document.getElementById('editPath').value;
      const content = quillEditor.root.innerHTML;
      const isLocked = document.getElementById('editLocked').checked;
      const lockType = document.getElementById('editLockType').value;
      const password = document.getElementById('editPassword').value;
      
      const data = { content, is_locked: isLocked };
      
      if (isLocked) {
        data.lock_type = lockType;
        if (password) {
          data.password = password;
        }
      }
      
      try {
        const response = await fetch('/admin/notes/' + path, {
          method: 'PUT',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
        
        if (response.ok) {
          closeEditModal();
          loadNotes(currentPage);
          showToast('保存成功', 'success');
        } else {
          showToast('保存失败', 'error');
        }
      } catch (error) {
        console.error('Failed to save note:', error);
        showToast('保存失败', 'error');
      }
    }
    
    // 删除笔记
    async function deleteNote(path) {
      if (!confirm('确定要删除笔记 /' + path + ' 吗？')) {
        return;
      }
      
      try {
        const response = await fetch('/admin/notes/' + path, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (response.ok) {
          loadNotes(currentPage);
          loadStats();
          showToast('删除成功', 'success');
        } else {
          showToast('删除失败', 'error');
        }
      } catch (error) {
        console.error('Failed to delete note:', error);
        showToast('删除失败', 'error');
      }
    }
    
    // 创建笔记
    async function createNote() {
      const path = document.getElementById('createPath').value.trim();
      const content = document.getElementById('createContent').value;
      const isLocked = document.getElementById('createLocked').checked;
      const lockType = document.getElementById('createLockType').value;
      const password = document.getElementById('createPassword').value;
      
      if (!path) {
        showToast('请输入笔记路径', 'error');
        return;
      }
      
      const data = { path, content };
      
      if (isLocked) {
        if (!password) {
          showToast('请输入密码', 'error');
          return;
        }
        data.is_locked = true;
        data.lock_type = lockType;
        data.password = password;
      }
      
      try {
        const response = await fetch('/admin/notes', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
        
        if (response.ok) {
          closeCreateModal();
          loadNotes(1);
          loadStats();
          showToast('创建成功', 'success');
        } else {
          const error = await response.json();
          showToast(error.error || '创建失败', 'error');
        }
      } catch (error) {
        console.error('Failed to create note:', error);
        showToast('创建失败', 'error');
      }
    }
    
    // 导出笔记
    async function exportNotes() {
      try {
        const response = await fetch('/admin/export', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // 下载JSON文件
          const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = data.filename;
          a.click();
          URL.revokeObjectURL(url);
          
          showToast('导出成功', 'success');
        } else {
          showToast('导出失败', 'error');
        }
      } catch (error) {
        console.error('Failed to export notes:', error);
        showToast('导出失败', 'error');
      }
    }
    
    // 导入笔记
    async function importNotes() {
      let data;
      
      const file = document.getElementById('importFile').files[0];
      const content = document.getElementById('importContent').value;
      
      if (file) {
        const text = await file.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
          showToast('无效的JSON文件', 'error');
          return;
        }
      } else if (content) {
        try {
          data = JSON.parse(content);
        } catch (e) {
          showToast('无效的JSON格式', 'error');
          return;
        }
      } else {
        showToast('请选择文件或输入JSON内容', 'error');
        return;
      }
      
      if (!data.notes || !Array.isArray(data.notes)) {
        showToast('JSON格式错误，需要包含notes数组', 'error');
        return;
      }
      
      try {
        const response = await fetch('/admin/import', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ notes: data.notes })
        });
        
        if (response.ok) {
          const result = await response.json();
          closeImportModal();
          loadNotes(1);
          loadStats();
          showToast(\`导入成功: \${result.imported}个，失败: \${result.failed}个\`, 'success');
        } else {
          showToast('导入失败', 'error');
        }
      } catch (error) {
        console.error('Failed to import notes:', error);
        showToast('导入失败', 'error');
      }
    }
    
    // 创建备份
    async function createBackup() {
      try {
        const response = await fetch('/admin/backup', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        
        if (response.ok) {
          const data = await response.json();
          showToast(\`备份成功：\${data.filename}\`, 'success');
        } else {
          showToast('备份失败', 'error');
        }
      } catch (error) {
        console.error('Failed to create backup:', error);
        showToast('备份失败', 'error');
      }
    }
    
    // 模态框控制
    function showCreateModal() {
      document.getElementById('createModal').classList.add('show');
    }
    
    function closeCreateModal() {
      document.getElementById('createModal').classList.remove('show');
      document.getElementById('createPath').value = '';
      document.getElementById('createContent').value = '';
      document.getElementById('createLocked').checked = false;
      document.getElementById('createPassword').value = '';
      document.getElementById('createLockOptions').style.display = 'none';
    }
    
    function closeEditModal() {
      document.getElementById('editModal').classList.remove('show');
      document.getElementById('editPassword').value = '';
    }
    
    function showImportModal() {
      document.getElementById('importModal').classList.add('show');
    }
    
    function closeImportModal() {
      document.getElementById('importModal').classList.remove('show');
      document.getElementById('importFile').value = '';
      document.getElementById('importContent').value = '';
    }
    
    function toggleLockOptions() {
      const locked = document.getElementById('editLocked').checked;
      document.getElementById('lockOptions').style.display = locked ? 'block' : 'none';
    }
    
    function toggleCreateLockOptions() {
      const locked = document.getElementById('createLocked').checked;
      document.getElementById('createLockOptions').style.display = locked ? 'block' : 'none';
    }
    
    // 显示提示消息
    function showToast(message, type = 'success') {
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      document.body.appendChild(toast);
      
      setTimeout(() => {
        toast.remove();
      }, 3000);
    }
    
    // Enter键登录
    document.getElementById('password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        login();
      }
    });
    
    // ESC关闭模态框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal.show').forEach(modal => {
          modal.classList.remove('show');
        });
      }
    });
  </script>
</body>
</html>`;
}

export default admin;
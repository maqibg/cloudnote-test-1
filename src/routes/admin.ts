import { Hono } from 'hono';
import type { Bindings, Note, LoginRequest, ImportRequest } from '../types';
import { requireAuth } from '../middleware/auth';
import { createJWT, verifyJWT } from '../utils/jwt';
import { hashPassword, verifyPassword } from '../utils/crypto';

const admin = new Hono<{ Bindings: Bindings }>();

// Admin登录页面
admin.get('/', async (c) => {
  return c.html(getAdminLoginHTML());
});

// Admin管理面板 - 不需要requireAuth，因为是HTML页面，会在前端检查token
admin.get('/dashboard', async (c) => {
  return c.html(getAdminDashboardHTML());
});

// Admin API - 登录
admin.post('/api/login', async (c) => {
  const body = await c.req.json<LoginRequest>();
  
  if (body.username !== c.env.ADMIN_USERNAME) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  
  const validPassword = await verifyPassword(body.password, c.env.ADMIN_PASSWORD);
  if (!validPassword) {
    // 如果是明文密码比较（初始设置）
    if (body.password === c.env.ADMIN_PASSWORD) {
      // 生成token
      const duration = parseInt(c.env.SESSION_DURATION || '86400');
      const token = await createJWT(c.env.JWT_SECRET, body.username, duration);
      
      // 记录登录日志
      await c.env.DB.prepare(
        'INSERT INTO admin_logs (action, details) VALUES (?, ?)'
      ).bind('login', `Admin ${body.username} logged in`).run();
      
      return c.json({ token, expires_in: duration });
    }
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  
  const duration = parseInt(c.env.SESSION_DURATION || '86400');
  const token = await createJWT(c.env.JWT_SECRET, body.username, duration);
  
  // 记录登录日志
  await c.env.DB.prepare(
    'INSERT INTO admin_logs (action, details) VALUES (?, ?)'
  ).bind('login', `Admin ${body.username} logged in`).run();
  
  return c.json({ token, expires_in: duration });
});

// 获取所有笔记列表
admin.get('/api/notes', requireAuth, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT path, is_locked, lock_type, created_at, updated_at, view_count FROM notes ORDER BY updated_at DESC'
    ).all<Note>();
    
    return c.json({ notes: results });
  } catch (error) {
    console.error('Error fetching notes:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// 删除笔记
admin.delete('/api/note/:path', requireAuth, async (c) => {
  const path = c.req.param('path');
  
  try {
    await c.env.DB.prepare(
      'DELETE FROM notes WHERE path = ?'
    ).bind(path).run();
    
    // 清除缓存
    await c.env.CACHE.delete(`note:${path}`);
    
    // 记录日志
    await c.env.DB.prepare(
      'INSERT INTO admin_logs (action, target_path, details) VALUES (?, ?, ?)'
    ).bind('delete', path, `Deleted note: ${path}`).run();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting note:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// 修改笔记
admin.put('/api/note/:path', requireAuth, async (c) => {
  const path = c.req.param('path');
  const body = await c.req.json<{ content: string }>();
  
  try {
    await c.env.DB.prepare(
      'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?'
    ).bind(body.content, path).run();
    
    // 清除缓存
    await c.env.CACHE.delete(`note:${path}`);
    
    // 记录日志
    await c.env.DB.prepare(
      'INSERT INTO admin_logs (action, target_path, details) VALUES (?, ?, ?)'
    ).bind('update', path, `Updated note: ${path}`).run();
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error updating note:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// 导出所有笔记
admin.post('/api/export', requireAuth, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM notes ORDER BY path'
    ).all<Note>();
    
    const exportData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      notes: results
    };
    
    // 保存到R2
    const filename = `export-${Date.now()}.json`;
    await c.env.STORAGE.put(filename, JSON.stringify(exportData));
    
    // 记录日志
    await c.env.DB.prepare(
      'INSERT INTO admin_logs (action, details) VALUES (?, ?)'
    ).bind('export', `Exported ${results.length} notes to ${filename}`).run();
    
    return c.json({ 
      success: true,
      filename,
      data: exportData
    });
  } catch (error) {
    console.error('Error exporting notes:', error);
    return c.json({ error: 'Export failed' }, 500);
  }
});

// 导入笔记
admin.post('/api/import', requireAuth, async (c) => {
  const body = await c.req.json<ImportRequest>();
  
  if (!body.notes || !Array.isArray(body.notes)) {
    return c.json({ error: 'Invalid import data' }, 400);
  }
  
  let imported = 0;
  let failed = 0;
  
  for (const note of body.notes) {
    try {
      let passwordHash = null;
      if (note.password) {
        passwordHash = await hashPassword(note.password);
      }
      
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO notes 
         (path, content, is_locked, lock_type, password_hash) 
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        note.path,
        note.content,
        note.is_locked ? 1 : 0,
        note.lock_type || null,
        passwordHash
      ).run();
      
      imported++;
    } catch (error) {
      console.error(`Failed to import note ${note.path}:`, error);
      failed++;
    }
  }
  
  // 记录日志
  await c.env.DB.prepare(
    'INSERT INTO admin_logs (action, details) VALUES (?, ?)'
  ).bind('import', `Imported ${imported} notes, ${failed} failed`).run();
  
  return c.json({ 
    success: true,
    imported,
    failed
  });
});

// 获取管理日志
admin.get('/api/logs', requireAuth, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT 100'
    ).all();
    
    return c.json({ logs: results });
  } catch (error) {
    console.error('Error fetching logs:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

function getAdminLoginHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login - CloudNote</title>
  <style>
    /* CSS变量 - 设计系统 */
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
      --font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body { 
      font-family: var(--font-family-sans);
      font-size: 14px;
      line-height: 1.5;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .login-container {
      background: var(--bg-color);
      padding: var(--spacing-xl);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-lg);
      width: 100%;
      max-width: 400px;
      animation: slideUp 0.3s ease;
    }
    
    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    
    .login-header {
      text-align: center;
      margin-bottom: var(--spacing-xl);
    }
    
    .logo {
      font-size: 24px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: var(--spacing-xs);
    }
    
    .subtitle {
      color: var(--text-secondary);
      font-size: 14px;
    }
    
    .form-group {
      margin-bottom: var(--spacing-md);
    }
    
    label {
      display: block;
      margin-bottom: var(--spacing-xs);
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 500;
    }
    
    input {
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius);
      font-size: 14px;
      transition: all 0.2s ease;
      background: var(--bg-color);
    }
    
    input:focus {
      outline: none;
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    
    button {
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      background: var(--primary-color);
      color: white;
      border: none;
      border-radius: var(--border-radius);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: var(--spacing-lg);
    }
    
    button:hover {
      background: var(--primary-hover);
      transform: translateY(-1px);
    }
    
    .error {
      color: var(--error-color);
      margin-top: var(--spacing-md);
      text-align: center;
      font-size: 13px;
      display: none;
    }
    
    @media (max-width: 480px) {
      .login-container {
        margin: 1rem;
      }
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <h1 class="logo">CloudNote Admin</h1>
      <p class="subtitle">管理员登录</p>
    </div>
    <form id="loginForm">
      <div class="form-group">
        <label for="username">用户名</label>
        <input type="text" id="username" name="username" required autocomplete="username">
      </div>
      <div class="form-group">
        <label for="password">密码</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit">登录</button>
      <div class="error" id="error"></div>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const errorDiv = document.getElementById('error');
      
      try {
        const response = await fetch('/admin/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          localStorage.setItem('adminToken', data.token);
          window.location.href = '/admin/dashboard';
        } else {
          errorDiv.textContent = data.error || '登录失败';
          errorDiv.style.display = 'block';
        }
      } catch (error) {
        errorDiv.textContent = '网络错误';
        errorDiv.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

function getAdminDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard - CloudNote</title>
  <style>
    /* CSS变量 - 设计系统 */
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
      --font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body { 
      font-family: var(--font-family-sans);
      font-size: 14px;
      line-height: 1.5;
      color: var(--text-primary);
      background: var(--bg-secondary);
    }
    
    /* 头部 */
    .header {
      background: var(--bg-color);
      padding: var(--spacing-md) var(--spacing-lg);
      box-shadow: var(--shadow-sm);
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    
    .header-left {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
    }
    
    .logo {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    .header-right {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }
    
    /* 容器 */
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: var(--spacing-xl) var(--spacing-lg);
    }
    
    /* 统计卡片 */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-xl);
    }
    
    .stat-card {
      background: var(--bg-color);
      padding: var(--spacing-lg);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-sm);
      transition: all 0.2s ease;
    }
    
    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }
    
    .stat-label {
      color: var(--text-secondary);
      font-size: 12px;
      margin-bottom: var(--spacing-xs);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .stat-value {
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    .stat-icon {
      display: inline-block;
      margin-left: var(--spacing-xs);
      font-size: 20px;
    }
    
    /* 操作区 */
    .actions-card {
      background: var(--bg-color);
      padding: var(--spacing-lg);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-sm);
      margin-bottom: var(--spacing-xl);
    }
    
    .actions-header {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: var(--spacing-md);
      color: var(--text-primary);
    }
    
    .action-buttons {
      display: flex;
      gap: var(--spacing-sm);
      flex-wrap: wrap;
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
    
    .btn:hover {
      background: var(--bg-secondary);
      transform: translateY(-1px);
    }
    
    .btn-primary {
      background: var(--primary-color);
      color: white;
      border-color: var(--primary-color);
    }
    
    .btn-primary:hover {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }
    
    .btn-danger {
      background: var(--error-color);
      color: white;
      border-color: var(--error-color);
    }
    
    .btn-danger:hover {
      background: #dc2626;
      border-color: #dc2626;
    }
    
    .btn-small {
      padding: var(--spacing-xs) var(--spacing-sm);
      font-size: 12px;
    }
    
    /* 表格 */
    .table-card {
      background: var(--bg-color);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-sm);
      overflow: hidden;
    }
    
    .table-header {
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .table-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    .search-box {
      display: flex;
      gap: var(--spacing-sm);
    }
    
    .search-input {
      padding: var(--spacing-xs) var(--spacing-sm);
      border: 1px solid var(--border-color);
      border-radius: var(--border-radius);
      font-size: 14px;
      width: 200px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    
    th, td {
      padding: var(--spacing-md);
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    
    th {
      background: var(--bg-secondary);
      font-weight: 500;
      color: var(--text-secondary);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    td {
      font-size: 14px;
    }
    
    tr:hover {
      background: var(--bg-secondary);
    }
    
    /* 徽章 */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
    }
    
    .badge-locked {
      background: #fef3c7;
      color: #92400e;
    }
    
    .badge-open {
      background: #d4edda;
      color: #155724;
    }
    
    /* 加载器 */
    .spinner {
      width: 20px;
      height: 20px;
      border: 2px solid var(--border-color);
      border-top: 2px solid var(--primary-color);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      display: inline-block;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    /* 消息提示 */
    .message {
      position: fixed;
      top: var(--spacing-lg);
      right: var(--spacing-lg);
      background: var(--success-color);
      color: white;
      padding: var(--spacing-md);
      border-radius: var(--border-radius);
      box-shadow: var(--shadow-md);
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      z-index: 1500;
      max-width: 300px;
      animation: slideIn 0.3s ease;
    }
    
    .message.error {
      background: var(--error-color);
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
    
    /* 响应式 */
    @media (max-width: 768px) {
      .container {
        padding: var(--spacing-md);
      }
      
      .stats-grid {
        grid-template-columns: 1fr;
      }
      
      .action-buttons {
        flex-direction: column;
      }
      
      .action-buttons .btn {
        width: 100%;
      }
      
      .table-header {
        flex-direction: column;
        gap: var(--spacing-md);
      }
      
      .search-input {
        width: 100%;
      }
      
      table {
        font-size: 12px;
      }
      
      th, td {
        padding: var(--spacing-sm);
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h1 class="logo">CloudNote Admin</h1>
    </div>
    <div class="header-right">
      <button class="btn btn-small" onclick="refreshData()">
        刷新数据
      </button>
      <button class="btn btn-small" onclick="logout()">
        退出登录
      </button>
    </div>
  </div>
  
  <div class="container">
    <!-- 统计卡片 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">总笔记数</div>
        <div class="stat-value">
          <span id="totalNotes">0</span>
          <span class="stat-icon">📄</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">锁定笔记</div>
        <div class="stat-value">
          <span id="lockedNotes">0</span>
          <span class="stat-icon">🔒</span>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">总访问量</div>
        <div class="stat-value">
          <span id="totalViews">0</span>
          <span class="stat-icon">👁️</span>
        </div>
      </div>
    </div>
    
    <!-- 操作区 -->
    <div class="actions-card">
      <h2 class="actions-header">批量操作</h2>
      <div class="action-buttons">
        <button class="btn btn-primary" onclick="exportNotes()">
          导出所有笔记
        </button>
        <button class="btn" onclick="showImportDialog()">
          导入笔记
        </button>
        <button class="btn" onclick="viewLogs()">
          查看操作日志
        </button>
      </div>
    </div>
    
    <!-- 笔记列表 -->
    <div class="table-card">
      <div class="table-header">
        <h2 class="table-title">笔记列表</h2>
        <div class="search-box">
          <input type="text" class="search-input" placeholder="搜索路径..." id="searchInput" onkeyup="filterTable()">
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>路径</th>
            <th>状态</th>
            <th>访问量</th>
            <th>创建时间</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="notesTableBody">
          <tr>
            <td colspan="6" style="text-align: center; padding: 2rem;">
              <div class="spinner"></div>
              <div style="margin-top: 1rem;">加载中...</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  
  <script>
    const token = localStorage.getItem('adminToken');
    if (!token) {
      window.location.href = '/admin';
    }
    
    let allNotes = [];
    
    async function fetchNotes() {
      try {
        const response = await fetch('/admin/api/notes', {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        });
        
        if (!response.ok) {
          if (response.status === 401) {
            localStorage.removeItem('adminToken');
            window.location.href = '/admin';
          }
          throw new Error('Failed to fetch notes');
        }
        
        const data = await response.json();
        allNotes = data.notes;
        displayNotes(data.notes);
        updateStats(data.notes);
      } catch (error) {
        console.error('Error fetching notes:', error);
        showMessage('加载笔记失败', 'error');
      }
    }
    
    function displayNotes(notes) {
      const tbody = document.getElementById('notesTableBody');
      
      if (notes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-muted);">暂无笔记</td></tr>';
        return;
      }
      
      tbody.innerHTML = notes.map(note => {
        const lockBadge = note.is_locked 
          ? '<span class="badge badge-locked">' + (note.lock_type === 'read' ? '访问锁定' : '编辑锁定') + '</span>'
          : '<span class="badge badge-open">开放</span>';
        
        return \`
          <tr>
            <td>
              <a href="/\${note.path}" target="_blank" style="color: var(--primary-color); text-decoration: none;">
                /\${note.path}
              </a>
            </td>
            <td>\${lockBadge}</td>
            <td>\${note.view_count}</td>
            <td>\${formatDate(note.created_at)}</td>
            <td>\${formatDate(note.updated_at)}</td>
            <td>
              <button class="btn btn-danger btn-small" onclick="deleteNote('\${note.path}')">
                删除
              </button>
            </td>
          </tr>
        \`;
      }).join('');
    }
    
    function updateStats(notes) {
      document.getElementById('totalNotes').textContent = notes.length;
      document.getElementById('lockedNotes').textContent = notes.filter(n => n.is_locked).length;
      document.getElementById('totalViews').textContent = notes.reduce((sum, n) => sum + n.view_count, 0);
    }
    
    function formatDate(dateStr) {
      const date = new Date(dateStr);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    
    function filterTable() {
      const searchTerm = document.getElementById('searchInput').value.toLowerCase();
      const filtered = allNotes.filter(note => 
        note.path.toLowerCase().includes(searchTerm)
      );
      displayNotes(filtered);
    }
    
    async function deleteNote(path) {
      if (!confirm('确定要删除笔记 /' + path + ' 吗？此操作不可恢复。')) return;
      
      try {
        const response = await fetch('/admin/api/note/' + path, {
          method: 'DELETE',
          headers: {
            'Authorization': 'Bearer ' + token
          }
        });
        
        if (response.ok) {
          showMessage('笔记已删除', 'success');
          fetchNotes();
        } else {
          showMessage('删除失败', 'error');
        }
      } catch (error) {
        console.error('Error deleting note:', error);
        showMessage('删除失败', 'error');
      }
    }
    
    async function exportNotes() {
      try {
        const response = await fetch('/admin/api/export', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token
          }
        });
        
        const data = await response.json();
        if (data.success) {
          const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = data.filename;
          a.click();
          showMessage('导出成功', 'success');
        }
      } catch (error) {
        console.error('Error exporting notes:', error);
        showMessage('导出失败', 'error');
      }
    }
    
    function showImportDialog() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const text = await file.text();
        const data = JSON.parse(text);
        
        try {
          const response = await fetch('/admin/api/import', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notes: data.notes || data })
          });
          
          const result = await response.json();
          if (result.success) {
            showMessage(\`成功导入 \${result.imported} 条笔记，失败 \${result.failed} 条\`, 'success');
            fetchNotes();
          }
        } catch (error) {
          console.error('Error importing notes:', error);
          showMessage('导入失败', 'error');
        }
      };
      input.click();
    }
    
    async function viewLogs() {
      try {
        const response = await fetch('/admin/api/logs', {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        });
        
        const data = await response.json();
        console.log('操作日志:', data.logs);
        showMessage('操作日志已在控制台输出', 'success');
      } catch (error) {
        console.error('Error fetching logs:', error);
        showMessage('获取日志失败', 'error');
      }
    }
    
    function refreshData() {
      fetchNotes();
      showMessage('数据已刷新', 'success');
    }
    
    function logout() {
      localStorage.removeItem('adminToken');
      window.location.href = '/admin';
    }
    
    function showMessage(text, type = 'success') {
      const existing = document.querySelector('.message');
      if (existing) {
        existing.remove();
      }
      
      const message = document.createElement('div');
      message.className = 'message ' + (type === 'error' ? 'error' : '');
      message.textContent = text;
      document.body.appendChild(message);
      
      setTimeout(() => {
        message.remove();
      }, 3000);
    }
    
    // 初始加载
    fetchNotes();
    
    // 定期刷新
    setInterval(fetchNotes, 60000);
  </script>
</body>
</html>`;
}

export { admin as adminRoutes };
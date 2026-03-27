import { Hono } from 'hono';
import { AppContext, Note, NoteResponse } from '../types';
import { hashPassword, verifyPassword, validatePath, sanitizeHtml } from '../utils/crypto';

const api = new Hono<{ Bindings: AppContext['env'] }>();

// 获取笔记
api.get('/note/:path', async (c) => {
  const path = c.req.param('path');
  const minLength = parseInt(c.env.PATH_MIN_LENGTH) || 1;
  const maxLength = parseInt(c.env.PATH_MAX_LENGTH) || 20;
  
  if (!validatePath(path, minLength, maxLength)) {
    return c.json({ error: 'Invalid path' }, 400);
  }
  
  // 先检查缓存
  const cached = await c.env.CACHE.get(`note:${path}`);
  if (cached) {
    const note = JSON.parse(cached);
    // 异步更新访问计数
    c.env.DB.prepare('UPDATE notes SET view_count = view_count + 1 WHERE path = ?')
      .bind(path)
      .run();
    return c.json(note);
  }
  
  const result = await c.env.DB
    .prepare('SELECT * FROM notes WHERE path = ?')
    .bind(path)
    .first<Note>();
  
  if (!result) {
    return c.json({ exists: false });
  }
  
  // 处理锁定逻辑
  if (result.is_locked && result.lock_type === 'read') {
    return c.json({
      exists: true,
      requires_password: true,
      lock_type: 'read'
    });
  }
  
  const response: NoteResponse = {
    exists: true,
    content: result.content || '',
    is_locked: result.is_locked,
    lock_type: result.lock_type,
    view_count: result.view_count,
    created_at: result.created_at,
    updated_at: result.updated_at
  };
  
  // 异步更新访问计数
  c.env.DB.prepare('UPDATE notes SET view_count = view_count + 1 WHERE path = ?')
    .bind(path)
    .run();
  
  // 缓存热门笔记
  if (result.view_count >= 2) {
    const ttl = Math.min(86400, Math.max(300, result.view_count * 180));
    await c.env.CACHE.put(`note:${path}`, JSON.stringify(response), {
      expirationTtl: ttl
    });
  }
  
  return c.json(response);
});

// 保存笔记
api.post('/note/:path', async (c) => {
  const path = c.req.param('path');
  const minLength = parseInt(c.env.PATH_MIN_LENGTH) || 1;
  const maxLength = parseInt(c.env.PATH_MAX_LENGTH) || 20;
  
  if (!validatePath(path, minLength, maxLength)) {
    return c.json({ error: 'Invalid path' }, 400);
  }
  
  const body = await c.req.json<{
    content: string;
    password?: string;
  }>();
  
  const content = sanitizeHtml(body.content || '');
  
  // 检查是否存在
  const existing = await c.env.DB
    .prepare('SELECT * FROM notes WHERE path = ?')
    .bind(path)
    .first<Note>();
  
  if (existing) {
    // 检查锁定
    if (existing.is_locked && existing.password_hash) {
      if (!body.password) {
        return c.json({ error: 'Password required' }, 403);
      }
      
      const valid = await verifyPassword(body.password, existing.password_hash);
      if (!valid) {
        return c.json({ error: 'Invalid password' }, 403);
      }
    }
    
    // 更新笔记
    await c.env.DB
      .prepare('UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?')
      .bind(content, path)
      .run();
    
    // 清除缓存
    await c.env.CACHE.delete(`note:${path}`);
  } else {
    // 创建新笔记
    await c.env.DB
      .prepare('INSERT INTO notes (path, content) VALUES (?, ?)')
      .bind(path, content)
      .run();
  }
  
  return c.json({ success: true });
});

// 解锁笔记
api.post('/note/:path/unlock', async (c) => {
  const path = c.req.param('path');
  const { password } = await c.req.json<{ password: string }>();
  
  const note = await c.env.DB
    .prepare('SELECT * FROM notes WHERE path = ?')
    .bind(path)
    .first<Note>();
  
  if (!note || !note.is_locked || !note.password_hash) {
    return c.json({ error: 'Note not found or not locked' }, 404);
  }
  
  const valid = await verifyPassword(password, note.password_hash);
  if (!valid) {
    return c.json({ error: 'Invalid password' }, 403);
  }
  
  // 清除缓存
  await c.env.CACHE.delete(`note:${path}`);
  
  return c.json({
    success: true,
    note: {
      content: note.content,
      lock_type: note.lock_type,
      view_count: note.view_count,
      created_at: note.created_at,
      updated_at: note.updated_at
    }
  });
});

// 设置锁定
api.post('/note/:path/lock', async (c) => {
  const path = c.req.param('path');
  const { password, lock_type } = await c.req.json<{
    password: string;
    lock_type: 'read' | 'write';
  }>();
  
  if (!password || !lock_type) {
    return c.json({ error: 'Password and lock_type required' }, 400);
  }
  
  const note = await c.env.DB
    .prepare('SELECT * FROM notes WHERE path = ?')
    .bind(path)
    .first<Note>();
  
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }
  
  const passwordHash = await hashPassword(password);
  
  await c.env.DB
    .prepare('UPDATE notes SET is_locked = 1, lock_type = ?, password_hash = ? WHERE path = ?')
    .bind(lock_type, passwordHash, path)
    .run();
  
  // 清除缓存
  await c.env.CACHE.delete(`note:${path}`);
  
  return c.json({ success: true });
});

// 移除锁定
api.delete('/note/:path/lock', async (c) => {
  const path = c.req.param('path');
  const { password } = await c.req.json<{ password: string }>();
  
  const note = await c.env.DB
    .prepare('SELECT * FROM notes WHERE path = ?')
    .bind(path)
    .first<Note>();
  
  if (!note || !note.is_locked || !note.password_hash) {
    return c.json({ error: 'Note not found or not locked' }, 404);
  }
  
  const valid = await verifyPassword(password, note.password_hash);
  if (!valid) {
    return c.json({ error: 'Invalid password' }, 403);
  }
  
  await c.env.DB
    .prepare('UPDATE notes SET is_locked = 0, lock_type = NULL, password_hash = NULL WHERE path = ?')
    .bind(path)
    .run();
  
  // 清除缓存
  await c.env.CACHE.delete(`note:${path}`);
  
  return c.json({ success: true });
});

export default api;
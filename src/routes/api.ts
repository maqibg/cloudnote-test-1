import { Hono } from 'hono';
import type { Bindings, Note, SaveNoteRequest, UnlockRequest, LockRequest } from '../types';
import { hashPassword, verifyPassword, validatePath, generateRandomPath, sanitizeHtml } from '../utils/crypto';

const api = new Hono<{ Bindings: Bindings }>();

// 获取笔记内容
api.get('/note/:path', async (c) => {
  const path = c.req.param('path');
  const minLength = parseInt(c.env.PATH_MIN_LENGTH || '1');
  const maxLength = parseInt(c.env.PATH_MAX_LENGTH || '4');
  
  if (!validatePath(path, minLength, maxLength)) {
    return c.json({ error: 'Invalid path' }, 400);
  }
  
  try {
    // 先从缓存获取
    const cached = await c.env.CACHE.get(`note:${path}`);
    if (cached) {
      const note = JSON.parse(cached);
      
      // 更新访问计数
      await c.env.DB.prepare(
        'UPDATE notes SET view_count = view_count + 1 WHERE path = ?'
      ).bind(path).run();
      
      return c.json(note);
    }
    
    // 从数据库获取
    const result = await c.env.DB.prepare(
      'SELECT * FROM notes WHERE path = ?'
    ).bind(path).first<Note>();
    
    if (!result) {
      return c.json({ exists: false });
    }
    
    // 更新访问计数（异步执行，不阻塞响应）
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        'UPDATE notes SET view_count = view_count + 1 WHERE path = ?'
      ).bind(path).run()
    );
    
    // 缓存策略优化：降低门槛，使用动态TTL
    if (result.view_count >= 2) { // 降低缓存门槛从10次到2次
      // 异步写入缓存，不阻塞响应
      c.executionCtx.waitUntil(
        c.env.CACHE.put(`note:${path}`, JSON.stringify(result), {
          // 动态TTL：访问越多，缓存时间越长
          expirationTtl: Math.min(86400, Math.max(300, result.view_count * 180))
        })
      );
    }
    
    // 如果是读锁定，返回锁定状态
    if (result.is_locked && result.lock_type === 'read') {
      return c.json({
        exists: true,
        is_locked: true,
        lock_type: 'read',
        requires_password: true
      });
    }
    
    return c.json(result);
  } catch (error) {
    console.error('Error fetching note:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// 保存笔记
api.post('/note/:path', async (c) => {
  const path = c.req.param('path');
  const minLength = parseInt(c.env.PATH_MIN_LENGTH || '1');
  const maxLength = parseInt(c.env.PATH_MAX_LENGTH || '4');
  
  if (!validatePath(path, minLength, maxLength)) {
    return c.json({ error: 'Invalid path' }, 400);
  }
  
  const body = await c.req.json<SaveNoteRequest>();
  const content = sanitizeHtml(body.content || '');
  
  // 不保存空白笔记
  if (!content.trim()) {
    return c.json({ error: 'Content cannot be empty' }, 400);
  }
  
  try {
    // 检查笔记是否存在和是否锁定
    const existing = await c.env.DB.prepare(
      'SELECT * FROM notes WHERE path = ?'
    ).bind(path).first<Note>();
    
    if (existing) {
      // 如果有写锁定，验证密码
      if (existing.is_locked && existing.lock_type === 'write' && existing.password_hash) {
        if (!body.password) {
          return c.json({ error: 'Password required for editing' }, 403);
        }
        
        const valid = await verifyPassword(body.password, existing.password_hash);
        if (!valid) {
          return c.json({ error: 'Invalid password' }, 403);
        }
      }
      
      // 更新笔记
      await c.env.DB.prepare(
        'UPDATE notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE path = ?'
      ).bind(content, path).run();
    } else {
      // 创建新笔记
      await c.env.DB.prepare(
        'INSERT INTO notes (path, content) VALUES (?, ?)'
      ).bind(path, content).run();
    }
    
    // 清除缓存
    await c.env.CACHE.delete(`note:${path}`);
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error saving note:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// 解锁笔记
api.post('/note/:path/unlock', async (c) => {
  const path = c.req.param('path');
  const body = await c.req.json<UnlockRequest>();
  
  try {
    const note = await c.env.DB.prepare(
      'SELECT * FROM notes WHERE path = ?'
    ).bind(path).first<Note>();
    
    if (!note) {
      return c.json({ error: 'Note not found' }, 404);
    }
    
    if (!note.is_locked || !note.password_hash) {
      return c.json({ error: 'Note is not locked' }, 400);
    }
    
    const valid = await verifyPassword(body.password, note.password_hash);
    if (!valid) {
      return c.json({ error: 'Invalid password' }, 403);
    }
    
    // 清除缓存
    await c.env.CACHE.delete(`note:${path}`);
    
    return c.json({
      success: true,
      note: note
    });
  } catch (error) {
    console.error('Error unlocking note:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// 锁定笔记
api.post('/note/:path/lock', async (c) => {
  const path = c.req.param('path');
  const body = await c.req.json<LockRequest>();
  
  if (!body.password || !body.lock_type) {
    return c.json({ error: 'Password and lock_type required' }, 400);
  }
  
  if (body.lock_type !== 'read' && body.lock_type !== 'write') {
    return c.json({ error: 'Invalid lock_type' }, 400);
  }
  
  try {
    const note = await c.env.DB.prepare(
      'SELECT * FROM notes WHERE path = ?'
    ).bind(path).first<Note>();
    
    if (!note) {
      return c.json({ error: 'Note not found' }, 404);
    }
    
    const passwordHash = await hashPassword(body.password);
    
    await c.env.DB.prepare(
      'UPDATE notes SET is_locked = 1, lock_type = ?, password_hash = ? WHERE path = ?'
    ).bind(body.lock_type, passwordHash, path).run();
    
    // 清除缓存
    await c.env.CACHE.delete(`note:${path}`);
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error locking note:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// 解除锁定
api.delete('/note/:path/lock', async (c) => {
  const path = c.req.param('path');
  const body = await c.req.json<{ password: string }>();
  
  try {
    const note = await c.env.DB.prepare(
      'SELECT * FROM notes WHERE path = ?'
    ).bind(path).first<Note>();
    
    if (!note) {
      return c.json({ error: 'Note not found' }, 404);
    }
    
    if (!note.is_locked || !note.password_hash) {
      return c.json({ error: 'Note is not locked' }, 400);
    }
    
    // 验证密码
    const valid = await verifyPassword(body.password, note.password_hash);
    if (!valid) {
      return c.json({ error: 'Invalid password' }, 403);
    }
    
    // 解除锁定
    await c.env.DB.prepare(
      'UPDATE notes SET is_locked = 0, lock_type = NULL, password_hash = NULL WHERE path = ?'
    ).bind(path).run();
    
    // 清除缓存
    await c.env.CACHE.delete(`note:${path}`);
    
    return c.json({ success: true });
  } catch (error) {
    console.error('Error removing lock:', error);
    return c.json({ error: 'Database error' }, 500);
  }
});

// 生成新路径
api.get('/generate-path', async (c) => {
  const minLength = parseInt(c.env.PATH_MIN_LENGTH || '1');
  const maxLength = parseInt(c.env.PATH_MAX_LENGTH || '4');
  const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
  
  let attempts = 0;
  let path: string;
  
  do {
    path = generateRandomPath(length);
    const existing = await c.env.DB.prepare(
      'SELECT 1 FROM notes WHERE path = ?'
    ).bind(path).first();
    
    if (!existing) {
      return c.json({ path });
    }
    
    attempts++;
  } while (attempts < 10);
  
  return c.json({ error: 'Could not generate unique path' }, 500);
});

export { api as apiRoutes };
import { Context } from 'hono';
import type { Bindings } from '../types';

const RATE_LIMIT_PREFIX = 'ratelimit:';

export function rateLimiter() {
  return async (c: Context<{ Bindings: Bindings }>, next: Function) => {
    // 优化1：只对写操作进行速率限制（GET和HEAD请求直接放行）
    if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
      return next();
    }
    
    // 优化2：只保护关键路径
    const protectedPaths = [
      '/api/note/',     // 笔记保存API
      '/api/admin/',    // 管理API
      '/admin/api/',    // 管理后台API
    ];
    
    // 检查当前路径是否需要速率限制
    const needsRateLimit = protectedPaths.some(path => 
      c.req.path.startsWith(path)
    );
    
    // 如果不是关键路径，直接放行
    if (!needsRateLimit) {
      return next();
    }
    
    // 获取客户端IP
    const ip = c.req.header('CF-Connecting-IP') || 
               c.req.header('X-Forwarded-For') || 
               'unknown';
    
    const key = `${RATE_LIMIT_PREFIX}${ip}`;
    const limit = parseInt(c.env.RATE_LIMIT_PER_MINUTE || '60');
    
    try {
      // 检查当前请求计数
      const current = await c.env.CACHE.get(key);
      const count = current ? parseInt(current) : 0;
      
      // 如果超过限制，返回429错误
      if (count >= limit) {
        return c.json(
          { 
            error: 'Too many requests',
            message: '请求过于频繁，请稍后再试'
          },
          429
        );
      }
      
      // 更新计数器
      await c.env.CACHE.put(key, String(count + 1), {
        expirationTtl: 60 // 60秒后自动过期
      });
    } catch (error) {
      // 速率限制错误不应该影响正常请求
      console.error('Rate limiter error:', error);
      // 继续处理请求
    }
    
    await next();
  };
}
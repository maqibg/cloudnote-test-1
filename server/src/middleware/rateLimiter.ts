import { Next } from 'hono';
import { AppContext } from '../types';

export async function rateLimiter(c: AppContext, next: Next) {
  // 跳过 GET 请求
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    return next();
  }
  
  // 只对关键路径进行速率限制
  const protectedPaths = ['/api/note/', '/api/admin/', '/admin/api/'];
  const needsRateLimit = protectedPaths.some(path => c.req.path.startsWith(path));
  
  if (!needsRateLimit) {
    return next();
  }
  
  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const key = `rate_limit:${ip}`;
  const limit = parseInt(c.env.RATE_LIMIT_PER_MINUTE) || 60;
  
  const current = await c.env.CACHE.get(key);
  const count = current ? parseInt(current) : 0;
  
  if (count >= limit) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }
  
  await c.env.CACHE.put(key, String(count + 1), { expirationTtl: 60 });
  
  await next();
}
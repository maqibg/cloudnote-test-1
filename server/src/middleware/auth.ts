import { Next } from 'hono';
import { AppContext } from '../types';
import { verifyJWT, extractToken } from '../utils/jwt';

export async function requireAuth(c: AppContext, next: Next) {
  const token = extractToken(c.req.header('Authorization'));
  
  if (!token) {
    return c.json({ error: 'Authentication required' }, 401);
  }
  
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  
  if (!payload || payload.role !== 'admin') {
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  c.set('user', payload);
  await next();
}
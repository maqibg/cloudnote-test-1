import { Context } from 'hono';
import type { Bindings } from '../types';
import { extractToken, verifyJWT } from '../utils/jwt';

export async function requireAuth(c: Context<{ Bindings: Bindings }>, next: Function) {
  const authorization = c.req.header('Authorization');
  const token = extractToken(authorization);
  
  if (!token) {
    return c.json(
      { error: 'Authentication required' },
      401
    );
  }
  
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  
  if (!payload || payload.role !== 'admin') {
    return c.json(
      { error: 'Invalid or expired token' },
      401
    );
  }
  
  c.set('user', payload);
  await next();
}
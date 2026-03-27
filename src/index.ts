import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Bindings } from './types';
import { noteRoutes } from './routes/note';
import { adminRoutes } from './routes/admin';
import { apiRoutes } from './routes/api';
import { serveStatic } from './middleware/static';
import { rateLimiter } from './middleware/rateLimiter';

const app = new Hono<{ Bindings: Bindings }>();

// 中间件配置
app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.quilljs.com", "https://cdn.jsdelivr.net"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.quilljs.com", "https://fonts.googleapis.com"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'"]
  }
}));
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));
app.use('*', rateLimiter());

// 静态资源服务
app.use('/static/*', serveStatic());

// API路由
app.route('/api', apiRoutes);

// Admin路由
app.route('/admin', adminRoutes);

// 笔记路由（必须放在最后）
app.route('/', noteRoutes);

// 错误处理
app.onError((err, c) => {
  console.error('Application error:', err);
  return c.json(
    { error: 'Internal Server Error' },
    500
  );
});

// 404处理
app.notFound((c) => {
  return c.json(
    { error: 'Not Found' },
    404
  );
});

export default app;
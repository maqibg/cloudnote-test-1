import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

// 导入适配器
import { D1Database } from './adapters/database';
import { KVStore } from './adapters/cache';
import { R2Storage } from './adapters/storage';

// 导入路由
import apiRoutes from './routes/api';
import adminRoutes from './routes/admin';
import noteRoutes from './routes/note';

// 导入中间件
import { rateLimiter } from './middleware/rateLimiter';

// 创建应用实例
const app = new Hono();

// 初始化适配器
const db = new D1Database(process.env.DATABASE_PATH || './data/cloudnote.db');
const cache = new KVStore(
  parseInt(process.env.CACHE_TTL || '3600'),
  parseInt(process.env.CACHE_CHECK_PERIOD || '600')
);
const storage = new R2Storage(process.env.STORAGE_PATH || './storage');

// 创建环境对象
const env = {
  DB: db,
  CACHE: cache,
  STORAGE: storage,
  JWT_SECRET: process.env.JWT_SECRET || (() => {
    console.error('⚠️  JWT_SECRET not set! Please set JWT_SECRET environment variable.');
    console.error('⚠️  Generate a secret key with: openssl rand -base64 32');
    process.exit(1);
  })(),
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || (() => {
    console.error('⚠️  ADMIN_PASSWORD not set! Please set ADMIN_PASSWORD environment variable.');
    process.exit(1);
  })(),
  PATH_MIN_LENGTH: process.env.PATH_MIN_LENGTH || '1',
  PATH_MAX_LENGTH: process.env.PATH_MAX_LENGTH || '20',
  RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE || '60',
  SESSION_DURATION: process.env.SESSION_DURATION || '86400'
};

// 全局中间件
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

// 添加环境到上下文
app.use('*', async (c, next) => {
  c.env = env;
  await next();
});

// 速率限制中间件
app.use('/api/*', rateLimiter);

// 挂载路由
app.route('/api', apiRoutes);
app.route('/admin', adminRoutes);
app.route('/', noteRoutes);

// 健康检查
app.get('/health', (c) => {
  return c.text('healthy\n', 200);
});

// 404 处理
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// 错误处理
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// 启动服务器
const port = parseInt(process.env.PORT || '3000');
const host = process.env.HOST || '0.0.0.0';

console.log(`
╔═══════════════════════════════════════╗
║       CloudNote Server v1.0.0         ║
╚═══════════════════════════════════════╝

🚀 Starting server...
📁 Database: ${process.env.DATABASE_PATH || './data/cloudnote.db'}
💾 Storage: ${process.env.STORAGE_PATH || './storage'}
🔐 Admin user: ${env.ADMIN_USER}
`);

serve({
  fetch: app.fetch,
  port,
  hostname: host
}, (info) => {
  console.log(`
✅ Server is running!
🌐 URL: http://${host}:${port}
📝 Open http://${host}:${port} to create a note
🔑 Admin panel: http://${host}:${port}/admin

Press Ctrl+C to stop the server.
`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  db.close();
  console.log('👋 Goodbye!');
  process.exit(0);
});
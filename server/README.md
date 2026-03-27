# CloudNote Server - Node.js 独立部署版

一个基于 Node.js 的云笔记应用服务端，提供富文本编辑、笔记加密、管理后台等功能。

## ✨ 特性

- 🚀 基于 Hono 框架的高性能 Web 服务
- 📝 支持富文本编辑（Quill.js）
- 🔒 笔记加密保护（读/写锁定）
- 👨‍💼 完整的管理后台
- 💾 SQLite 本地数据库
- 🔐 JWT 认证
- 📊 笔记统计分析
- 📤 导入/导出功能
- 💼 数据备份
- 🎨 与 Cloudflare Workers 版本一致的 UI

## 📋 系统要求

- Node.js 18.0 或更高版本
- npm 或 yarn 包管理器
- Windows/Linux/macOS 操作系统

## 🚀 快速开始

### 1. 克隆仓库

```bash
# 克隆整个项目
git clone https://github.com/maqibg/cloudnote.git
cd cloudnote/server

# 或者只克隆 server 目录（使用 sparse-checkout）
git clone --filter=blob:none --sparse https://github.com/maqibg/cloudnote.git cloudnote-server
cd cloudnote-server
git sparse-checkout set server
cd server
```

### 2. 安装依赖

```bash
npm install
# 或
yarn install
```

### 3. 配置环境变量

复制 `.env.example` 创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置以下参数：

```env
# 服务器配置
PORT=3000
HOST=localhost

# 数据库配置
DATABASE_PATH=./data/cloudnote.db

# 存储配置
STORAGE_PATH=./storage

# 缓存配置
CACHE_TTL=3600
CACHE_CHECK_PERIOD=600

# 安全配置
JWT_SECRET=your-secret-key-change-this-in-production
SESSION_DURATION=86400

# 管理员配置
ADMIN_USER=admin
ADMIN_PASSWORD=admin123

# 应用配置
PATH_MIN_LENGTH=1
PATH_MAX_LENGTH=20
RATE_LIMIT_PER_MINUTE=60
```

### 4. 启动服务

```bash
# 开发模式（支持热重载）
npm run dev

# 生产模式
npm run build
npm start
```

服务启动后访问：
- 主应用：http://localhost:3000
- 管理后台：http://localhost:3000/admin

## 📁 项目结构

```
server/
├── src/
│   ├── adapters/       # 适配器层（数据库、缓存、存储）
│   │   ├── cache.ts    # KV 缓存适配器
│   │   ├── database.ts # D1 数据库适配器
│   │   └── storage.ts   # R2 存储适配器
│   ├── middleware/      # 中间件
│   │   ├── auth.ts      # JWT 认证中间件
│   │   └── rateLimiter.ts # 速率限制中间件
│   ├── routes/          # 路由处理
│   │   ├── admin.ts     # 管理后台路由
│   │   ├── api.ts       # API 路由
│   │   └── note.ts      # 笔记页面路由
│   ├── utils/           # 工具函数
│   │   ├── crypto.ts    # 加密相关
│   │   └── jwt.ts       # JWT 处理
│   ├── types.ts         # TypeScript 类型定义
│   └── index.ts         # 应用入口
├── data/                # SQLite 数据库文件
├── storage/             # 文件存储目录
├── .env                 # 环境变量配置
├── .env.example         # 环境变量示例
├── package.json         # 项目依赖
├── tsconfig.json        # TypeScript 配置
└── README.md            # 本文档
```

## 🔧 API 接口

### 笔记操作

- `GET /api/note/:path` - 获取笔记
- `POST /api/note/:path` - 保存笔记
- `DELETE /api/note/:path` - 删除笔记
- `POST /api/note/:path/lock` - 锁定笔记
- `DELETE /api/note/:path/lock` - 解锁笔记
- `POST /api/note/:path/unlock` - 验证密码解锁

### 管理后台

- `POST /admin/login` - 管理员登录
- `GET /admin/stats` - 获取统计信息
- `GET /admin/notes` - 获取笔记列表（支持搜索、分页）
- `GET /admin/notes/:path` - 获取单个笔记
- `PUT /admin/notes/:path` - 更新笔记
- `DELETE /admin/notes/:path` - 删除笔记
- `POST /admin/notes` - 创建笔记
- `GET /admin/export` - 导出所有笔记
- `POST /admin/import` - 导入笔记
- `POST /admin/backup` - 创建备份

## 🚀 生产部署

### 🐳 Docker 部署（推荐）

#### Docker 部署步骤

请按照以下步骤手动部署：

##### 1. 准备环境变量

```bash
# 复制环境变量示例文件
cp .env.example .env

# 编辑 .env 文件，修改以下重要配置
nano .env
```

必须修改的配置：
- `JWT_SECRET` - 生成随机密钥：`openssl rand -base64 32`
- `ADMIN_PASSWORD` - 设置强管理员密码

##### 2. 构建 Docker 镜像

```bash
# 构建镜像
docker build -t cloudnote-server:latest .

# 或使用 docker-compose 构建
docker-compose build
```

##### 3. 创建必要的目录

```bash
# 创建数据和存储目录
mkdir -p data storage backups

# 设置权限（Linux/macOS）
chmod 755 data storage backups
```

##### 4. 启动容器

**方式一：使用 docker run**

```bash
docker run -d \
  --name cloudnote-server \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/storage:/app/storage \
  -v $(pwd)/.env:/app/.env:ro \
  --restart unless-stopped \
  cloudnote-server:latest
```

**方式二：使用 docker-compose（推荐）**

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重启服务
docker-compose restart
```

##### 5. 配置 Nginx 反向代理（可选）

如果需要 Nginx 反向代理，创建 `nginx.conf`：

```nginx
events {
    worker_connections 1024;
}

http {
    upstream cloudnote {
        server cloudnote:3000;
    }

    server {
        listen 80;
        server_name your-domain.com;

        client_max_body_size 50M;

        location / {
            proxy_pass http://cloudnote;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

然后使用带 Nginx 的配置启动：

```bash
# 启动带 Nginx 的服务
docker-compose --profile with-nginx up -d
```

##### 6. 配置自动备份（可选）

启用自动备份服务：

```bash
# 启动带备份的服务
docker-compose --profile with-backup up -d

# 手动执行备份
docker-compose exec cloudnote tar -czf /backups/manual_backup_$(date +%Y%m%d_%H%M%S).tar.gz /app/data /app/storage

# 查看备份文件
ls -la backups/
```

#### Docker 管理命令

```bash
# 查看容器状态
docker-compose ps

# 查看实时日志
docker-compose logs -f cloudnote

# 进入容器内部
docker-compose exec cloudnote sh

# 查看容器资源使用
docker stats cloudnote-server

# 更新镜像并重启
docker-compose pull
docker-compose up -d --build

# 清理未使用的镜像
docker image prune -a

# 备份数据
docker-compose exec cloudnote tar -czf /tmp/backup.tar.gz /app/data /app/storage
docker cp cloudnote-server:/tmp/backup.tar.gz ./backup_$(date +%Y%m%d).tar.gz

# 恢复数据
docker cp backup.tar.gz cloudnote-server:/tmp/
docker-compose exec cloudnote tar -xzf /tmp/backup.tar.gz -C /
```

#### Docker 环境变量说明

在 `.env` 文件中配置：

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 容器内部端口 | 3000 |
| `HOST` | 监听地址 | 0.0.0.0 |
| `NODE_ENV` | 运行环境 | production |
| `DATABASE_PATH` | 数据库路径 | ./data/cloudnote.db |
| `STORAGE_PATH` | 存储路径 | ./storage |
| `JWT_SECRET` | JWT 密钥 | 必须修改 |
| `ADMIN_PASSWORD` | 管理员密码 | 必须修改 |

#### Docker 部署故障排除

**容器无法启动：**
```bash
# 查看详细错误日志
docker-compose logs cloudnote

# 检查端口占用
netstat -tulpn | grep 3000

# 检查 Docker 状态
docker system df
docker system prune
```

**权限问题：**
```bash
# Linux 系统修复权限
sudo chown -R 1001:1001 data storage
chmod 755 data storage
```

**网络问题：**
```bash
# 检查 Docker 网络
docker network ls
docker network inspect cloudnote_cloudnote-network

# 重建网络
docker-compose down
docker network prune
docker-compose up -d
```

### 使用 PM2

```bash
# 安装 PM2
npm install -g pm2

# 构建项目
npm run build

# 使用 PM2 启动
pm2 start dist/index.js --name cloudnote-server

# 设置开机自启
pm2 startup
pm2 save

# 查看日志
pm2 logs cloudnote-server
```


### 使用 Systemd (Linux)

创建 `/etc/systemd/system/cloudnote.service`：

```ini
[Unit]
Description=CloudNote Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/cloudnote/server
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=cloudnote

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudnote
sudo systemctl start cloudnote
```

### 使用 Nginx 反向代理

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书配置
    ssl_certificate /path/to/ssl/cert.pem;
    ssl_certificate_key /path/to/ssl/key.pem;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 🔒 安全建议

### 1. 修改默认配置

```bash
# 生成强随机 JWT 密钥
openssl rand -base64 32

# 生成强管理员密码
openssl rand -base64 16
```

### 2. 文件权限

```bash
# 设置正确的文件权限
chmod 700 data/
chmod 700 storage/
chmod 600 .env
```

### 3. 防火墙配置

```bash
# 只允许必要的端口
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### 4. 定期备份

```bash
# 创建备份脚本
cat > backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backup/cloudnote"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/cloudnote_$DATE.tar.gz data/ storage/
# 保留最近30天的备份
find $BACKUP_DIR -name "cloudnote_*.tar.gz" -mtime +30 -delete
EOF

chmod +x backup.sh

# 添加到 crontab (每天凌晨2点备份)
crontab -e
# 添加: 0 2 * * * /path/to/backup.sh
```

## 📊 性能优化

### 数据库优化

```bash
# 定期执行 VACUUM 优化 SQLite
sqlite3 data/cloudnote.db "VACUUM;"

# 分析查询性能
sqlite3 data/cloudnote.db "ANALYZE;"
```

### 缓存策略

- 调整 `CACHE_TTL` 以平衡性能和实时性
- 热门笔记自动缓存
- 使用内存缓存减少数据库访问

### 监控

使用 PM2 监控：

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
```

## 🔄 数据迁移

### 从 Cloudflare Workers 版本迁移

1. 在 CF 版本管理后台导出数据
2. 将导出的 JSON 文件保存
3. 在 Server 版本管理后台导入数据

### 迁移到 Cloudflare Workers 版本

1. 在 Server 版本管理后台导出数据
2. 使用 Wrangler 工具导入到 D1 数据库：

```bash
# 转换为 SQL 语句
node scripts/json-to-sql.js export.json > import.sql

# 导入到 D1
wrangler d1 execute cloudnote-db --file=import.sql
```

## 🐛 故障排除

### 端口被占用

```bash
# Windows
netstat -aon | findstr :3000
taskkill /PID <PID> /F

# Linux/macOS
lsof -i :3000
kill -9 <PID>
```

### 数据库锁定

如果遇到 "database is locked" 错误：

```bash
# 检查是否有其他进程访问数据库
lsof data/cloudnote.db

# 启用 WAL 模式
sqlite3 data/cloudnote.db "PRAGMA journal_mode=WAL;"
```

### 权限问题

```bash
# Linux/macOS
sudo chown -R $(whoami):$(whoami) .
chmod 755 data storage
```

## 📝 开发指南

### 运行测试

```bash
npm test
```

### 代码格式化

```bash
npm run format
```

### 类型检查

```bash
npm run type-check
```

### 添加新功能

1. 在 `src/routes/` 添加新路由
2. 在 `src/types.ts` 添加类型定义
3. 更新 API 文档
4. 编写测试用例

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

MIT License - 详见 [LICENSE](../LICENSE) 文件

## 🔗 相关链接

- [Cloudflare Workers 版本](../)
- [在线演示](https://cloudnote.example.com)
- [API 文档](./docs/API.md)
- [更新日志](./CHANGELOG.md)

## 💡 常见问题

**Q: Server 版本和 CF Workers 版本有什么区别？**

A: 
- **Server 版本**：独立部署，使用 SQLite 本地数据库，适合 VPS/服务器部署，数据完全自主可控
- **CF Workers 版本**：基于 Cloudflare 边缘计算，使用 D1/KV/R2，全球分布式部署，自动扩展

**Q: 如何修改笔记路径长度限制？**

A: 编辑 `.env` 文件中的 `PATH_MIN_LENGTH` 和 `PATH_MAX_LENGTH`

**Q: 如何启用调试模式？**

A: 设置环境变量 `NODE_ENV=development` 或使用 `npm run dev`

**Q: 数据库文件在哪里？**

A: 默认在 `./data/cloudnote.db`，可通过 `DATABASE_PATH` 环境变量修改

**Q: 如何重置管理员密码？**

A: 修改 `.env` 文件中的 `ADMIN_PASSWORD` 并重启服务

**Q: 支持哪些数据库？**

A: 目前只支持 SQLite，未来可能支持 PostgreSQL/MySQL

**Q: 可以导入 Markdown 文件吗？**

A: 可以通过管理后台的导入功能，支持 JSON 格式批量导入

## 📞 支持

- 提交 [Issue](https://github.com/maqibg/cloudnote/issues)
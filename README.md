# CloudNote - 云笔记系统

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/maqibg/cloudnote)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 项目概述

CloudNote 是一个现代化的云笔记应用，提供两个版本：

- **Cloudflare Workers 版本**：基于边缘计算的全球分布式部署
- **Node.js Server 版本**：适合自托管的独立服务器部署

两个版本共享相同的 UI 设计和核心功能，可根据需求选择合适的部署方式。

### 在线演示
- 演示地址：`https://cloudnote.example.com`
- 管理后台：`https://cloudnote.example.com/admin`
- 演示账号：admin / admin

![PixPin_2025-09-06_16-18-04](https://github.com/user-attachments/assets/1015e060-4464-4beb-af63-5167a1e22343)
![PixPin_2025-09-06_16-18-39](https://github.com/user-attachments/assets/25339ef5-6f5e-4cae-8578-4b5e909cbe8e)

## ✨ 核心特性

### 1. 动态路径笔记
- 📝 通过 URL 路径直接创建笔记（如：`https://domain.com/mynote`）
- 🔢 路径长度可配置（默认 1-20 个字符）
- 🔄 访问根路径自动分配空白笔记或创建新路径
- 💾 防止创建空白笔记（需要有内容才保存）

### 2. 富文本编辑器
- ✏️ 基于 Quill.js 的现代富文本编辑体验
- 🎨 支持格式化文本、列表、引用、代码块等
- ⚡ 自动保存功能（2秒防抖处理）
- 📱 响应式设计，移动端优化
- 💾 手动保存按钮，方便移动端操作

### 3. 访问控制
- 🔒 笔记锁定功能
- 🔑 两种锁定模式：
  - **限制访问**：需要密码才能查看和编辑
  - **限制编辑**：可以查看但需要密码才能编辑
- 🔐 基于 PBKDF2 的密码加密存储

### 4. 管理后台
- 👨‍💼 固定路径 `/admin` 访问
- 📊 功能包括：
  - 查看所有笔记列表
  - 删除指定笔记
  - 批量导入/导出笔记
  - 查看访问统计
  - 操作日志审计
- 🛡️ JWT 认证保护

### 5. 安全特性
- 🛡️ CSRF 防护
- 🚫 XSS 防护（CSP 头）
- 💉 SQL 注入防护（参数化查询）
- ⏱️ 速率限制
- 🔐 密码加密存储
- 🎫 JWT token 认证

## 🎯 版本选择指南

### Cloudflare Workers 版本
适合场景：
- ✅ 需要全球分布式部署
- ✅ 访问量大，需要自动扩展
- ✅ 希望零运维成本
- ✅ 需要边缘计算性能

技术栈：
- 运行时: Cloudflare Workers
- 数据库: D1 (SQLite)
- 缓存: Workers KV
- 存储: R2

### Node.js Server 版本
适合场景：
- ✅ 需要完全自主控制数据
- ✅ 在内网或私有云部署
- ✅ 需要与现有系统集成
- ✅ 对数据隐私有严格要求

技术栈：
- 运行时: Node.js
- 数据库: SQLite (本地)
- 缓存: 内存缓存
- 存储: 本地文件系统

## 📦 快速部署

### 🌩️ 部署 Cloudflare Workers 版本

#### 一键部署（推荐）

```bash
# 克隆项目
git clone https://github.com/maqibg/cloudnote.git
cd cloudnote

# 运行部署脚本
chmod +x deploy.sh
./deploy.sh
```

#### 手动部署

1. **克隆项目**
```bash
# 完整克隆
git clone https://github.com/maqibg/cloudnote.git
cd cloudnote

# 或只克隆 CF 版本（使用 sparse-checkout）
git clone --filter=blob:none --sparse https://github.com/maqibg/cloudnote.git cloudnote-cf
cd cloudnote-cf
git sparse-checkout set src schema.sql wrangler.toml package.json tsconfig.json
```

2. **安装依赖**
```bash
npm install
```

3. **创建 Cloudflare 资源**
```bash
# 创建 D1 数据库
npx wrangler d1 create cloudnote-db

# 创建 KV 命名空间
npx wrangler kv:namespace create CACHE

# 创建 R2 存储桶
npx wrangler r2 bucket create cloudnote-storage
```

4. **配置 wrangler.toml**
```toml
name = "cloudnote"
main = "src/index.ts"
compatibility_date = "2025-09-06"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "cloudnote-db"
database_id = "你的数据库ID"

[[kv_namespaces]]
binding = "CACHE"
id = "你的KV命名空间ID"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "cloudnote-storage"
```

5. **初始化数据库**
```bash
npx wrangler d1 execute cloudnote-db --file=./schema.sql --remote
```

6. **设置环境变量**
```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
```

7. **部署**
```bash
npm run deploy
```

### 💻 部署 Node.js Server 版本

#### 手动部署

```bash
# 克隆项目
git clone https://github.com/maqibg/cloudnote.git
cd cloudnote/server

# 或只克隆 server 版本（使用 sparse-checkout）
git clone --filter=blob:none --sparse https://github.com/maqibg/cloudnote.git cloudnote-server
cd cloudnote-server
git sparse-checkout set server
cd server

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件设置管理员密码等

# 启动服务
npm run dev  # 开发模式
npm run build && npm start  # 生产模式
```

#### Docker 部署

```bash
# 使用 Docker
docker build -t cloudnote-server .
docker run -d -p 3000:3000 \
  -v ./data:/app/data \
  -v ./storage:/app/storage \
  cloudnote-server

# 使用 Docker Compose
docker-compose up -d
```

#### PM2 部署

```bash
npm run build
pm2 start dist/index.js --name cloudnote-server
pm2 startup
pm2 save
```

## 🔄 数据迁移

### CF Workers → Server 版本

1. 在 CF 版本管理后台导出数据（JSON 格式）
2. 将导出文件保存到本地
3. 在 Server 版本管理后台导入数据

### Server → CF Workers 版本

1. 在 Server 版本管理后台导出数据
2. 使用转换脚本生成 SQL：
```bash
node scripts/json-to-sql.js export.json > import.sql
```
3. 导入到 D1 数据库：
```bash
wrangler d1 execute cloudnote-db --file=import.sql
```

## ⚡ 性能对比

| 特性 | CF Workers 版本 | Server 版本 |
|------|----------------|-------------|
| 响应时间 | 50-100ms (全球) | 10-50ms (本地) |
| 并发能力 | 无限自动扩展 | 取决于服务器配置 |
| 运维成本 | $0（免费额度） | 服务器费用 |
| 数据控制 | Cloudflare 托管 | 完全自主控制 |
| 部署难度 | 简单 | 中等 |
| 可用性 | 99.99% | 取决于运维 |

## 🔧 环境变量配置

### 共同配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `ADMIN_USERNAME/ADMIN_USER` | 管理员用户名 | admin |
| `ADMIN_PASSWORD` | 管理员密码 | - |
| `JWT_SECRET` | JWT 签名密钥 | - |
| `PATH_MIN_LENGTH` | 笔记路径最小长度 | 1 |
| `PATH_MAX_LENGTH` | 笔记路径最大长度 | 20 |
| `RATE_LIMIT_PER_MINUTE` | 每分钟请求限制 | 60 |
| `SESSION_DURATION` | 会话持续时间（秒） | 86400 |

### Server 版本额外配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务器端口 | 3000 |
| `HOST` | 服务器地址 | localhost |
| `DATABASE_PATH` | SQLite 数据库路径 | ./data/cloudnote.db |
| `STORAGE_PATH` | 文件存储路径 | ./storage |
| `CACHE_TTL` | 缓存过期时间 | 3600 |

## 💻 本地开发

### CF Workers 版本
```bash
# 开发服务器
npm run dev

# 构建
npm run build

# 部署
npm run deploy

# 测试
npm test
```

### Server 版本
```bash
cd server

# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 生产模式
npm start

# 测试
npm test
```

## 📋 API 文档

两个版本提供相同的 API 接口：

### 笔记操作

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/:path` | 获取或创建笔记页面 |
| GET | `/api/note/:path` | 获取笔记内容 |
| POST | `/api/note/:path` | 保存笔记 |
| POST | `/api/note/:path/unlock` | 解锁笔记 |
| POST | `/api/note/:path/lock` | 设置笔记锁 |
| DELETE | `/api/note/:path/lock` | 移除笔记锁 |

### 管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/admin` | 管理面板页面 |
| POST | `/admin/login` | 管理员登录 |
| GET | `/admin/stats` | 获取统计信息 |
| GET | `/admin/notes` | 获取笔记列表 |
| GET | `/admin/notes/:path` | 获取单个笔记 |
| PUT | `/admin/notes/:path` | 更新笔记 |
| DELETE | `/admin/notes/:path` | 删除笔记 |
| POST | `/admin/notes` | 创建笔记 |
| GET | `/admin/export` | 导出笔记 |
| POST | `/admin/import` | 导入笔记 |
| POST | `/admin/backup` | 创建备份 |

## 🏗️ 项目结构

```
cloudnote/
├── src/                  # CF Workers 版本源码
│   ├── index.ts          # 应用入口
│   ├── routes/           # 路由模块
│   ├── middleware/       # 中间件
│   ├── utils/            # 工具函数
│   └── types/            # 类型定义
├── server/               # Node.js Server 版本
│   ├── src/              # 源代码
│   │   ├── adapters/     # 适配器层
│   │   ├── routes/       # 路由处理
│   │   ├── middleware/   # 中间件
│   │   ├── utils/        # 工具函数
│   │   └── index.ts      # 入口文件
│   ├── data/             # SQLite 数据库
│   ├── storage/          # 文件存储
│   ├── .env.example      # 环境变量示例
│   └── README.md         # Server 版本文档
├── schema.sql            # 数据库结构
├── wrangler.toml         # CF Workers 配置
├── package.json          # 项目依赖
├── deploy.sh             # 部署脚本
└── README.md             # 本文档
```

## 🔒 安全建议

1. **强密码策略**: 使用至少 12 位包含大小写字母、数字和特殊字符的密码
2. **定期备份**: 通过管理后台定期导出笔记数据
3. **HTTPS 强制**: 
   - CF Workers 版本默认 HTTPS
   - Server 版本建议使用 Nginx 反向代理配置 SSL
4. **定期更新**: 及时更新依赖包
5. **访问监控**: 定期检查管理日志
6. **密钥轮换**: 定期更换 JWT_SECRET

## 📊 限制说明

### CF Workers 版本
| 资源 | 限制 |
|------|------|
| D1 数据库 | 单个数据库 10GB |
| KV 存储 | 单个值最大 25MB |
| R2 存储 | 无限制 |
| Workers 脚本 | 10MB（压缩后） |
| 请求大小 | 100MB |
| 执行时间 | 30 秒 |

### Server 版本
| 资源 | 限制 |
|------|------|
| SQLite 数据库 | 理论上限 281TB |
| 单个请求 | 取决于服务器配置 |
| 并发连接 | 取决于服务器配置 |
| 存储空间 | 取决于磁盘大小 |

## 🐛 故障排除

### 常见问题

**Q: 如何选择合适的版本？**
A: 
- 需要全球访问、自动扩展 → CF Workers 版本
- 需要数据自主、内网部署 → Server 版本

**Q: 两个版本的数据可以互相迁移吗？**
A: 可以，通过管理后台的导入/导出功能实现数据迁移

**Q: Server 版本支持哪些数据库？**
A: 目前只支持 SQLite，未来可能支持 PostgreSQL/MySQL

**Q: CF Workers 版本的费用如何？**
A: 在免费额度内完全免费，包括：
- 100,000 请求/天
- 1GB D1 数据库
- 1GB KV 存储
- 10GB R2 存储

**Q: 如何实现高可用部署？**
A: 
- CF Workers 版本：自动高可用
- Server 版本：使用负载均衡 + 多实例部署

## 🤝 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 📮 联系方式

- 提交 [Issue](https://github.com/maqibg/cloudnote/issues)

## 🙏 致谢

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Hono](https://hono.dev/)
- [Quill.js](https://quilljs.com/)
- [Node.js](https://nodejs.org/)

---

⭐ 如果这个项目对你有帮助，请给个 Star！
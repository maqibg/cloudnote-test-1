# 多阶段构建，减小最终镜像体积
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 安装所有依赖（包括开发依赖）
RUN npm ci

# 复制源代码
COPY . .

# 构建项目
RUN npm run build

# 生产阶段
FROM node:20-alpine

# 安装 dumb-init 来正确处理信号
RUN apk add --no-cache dumb-init

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 设置工作目录
WORKDIR /app

# 复制 package 文件
COPY package*.json ./

# 只安装生产依赖
RUN npm ci --only=production && \
    npm cache clean --force

# 从构建阶段复制构建结果
COPY --from=builder /app/dist ./dist

# 复制必要的文件
COPY --chown=nodejs:nodejs . .

# 创建数据和存储目录
RUN mkdir -p data storage && \
    chown -R nodejs:nodejs data storage

# 切换到非 root 用户
USER nodejs

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1))"

# 使用 dumb-init 启动应用
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
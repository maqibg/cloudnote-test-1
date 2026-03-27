#!/bin/bash

# CloudNote 一键部署脚本
# 用法: ./deploy.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() { echo -e "${BLUE}ℹ️ $1${NC}"; }
print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️ $1${NC}"; }
print_error() { echo -e "${RED}❌ $1${NC}"; }

echo "========================================="
echo "   CloudNote 一键部署脚本 v1.1"
echo "========================================="
echo ""

# 检查操作系统
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    print_warning "检测到 Windows 系统，建议使用 deploy.bat"
    echo "是否继续？(y/n)"
    read -r CONTINUE
    if [[ "$CONTINUE" != "y" ]]; then
        exit 0
    fi
fi

# 检查依赖
print_info "检查依赖..."
if ! command -v node &> /dev/null; then
    print_error "Node.js 未安装，请先安装 Node.js 16+"
    echo "访问 https://nodejs.org/ 下载安装"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    print_error "npm 未安装"
    exit 1
fi

print_success "Node.js 版本: $(node -v)"
print_success "npm 版本: $(npm -v)"
echo ""

# 安装依赖
print_info "安装项目依赖..."
npm install --silent
print_success "依赖安装完成"
echo ""

# 检查 wrangler 是否安装
if ! command -v wrangler &> /dev/null; then
    print_info "安装 Wrangler CLI..."
    npm install -g wrangler
fi
print_success "Wrangler 版本: $(npx wrangler --version)"
echo ""

# 登录 Cloudflare
print_info "登录 Cloudflare..."
echo "请在浏览器中完成登录授权"
npx wrangler login
print_success "登录成功"
echo ""

# 询问部署名称
echo -n "请输入 Worker 名称 (默认: cloudnote): "
read WORKER_NAME
WORKER_NAME=${WORKER_NAME:-cloudnote}

# 更新 wrangler.toml
sed -i.bak "s/^name = .*/name = \"$WORKER_NAME\"/" wrangler.toml

# 创建 D1 数据库
print_info "创建 D1 数据库..."
DB_NAME="${WORKER_NAME}-db"
DB_OUTPUT=$(npx wrangler d1 create "$DB_NAME" 2>&1 || true)

if echo "$DB_OUTPUT" | grep -q "already exists"; then
    print_warning "数据库已存在，跳过创建"
    DB_ID=$(npx wrangler d1 list | grep "$DB_NAME" | awk '{print $2}')
else
    DB_ID=$(echo "$DB_OUTPUT" | grep -oP '(?<=database_id = ")[^"]+' || echo "")
    print_success "数据库创建成功"
fi

if [ -z "$DB_ID" ]; then
    print_error "无法获取数据库 ID"
    echo "请手动创建数据库: npx wrangler d1 create $DB_NAME"
    exit 1
fi
print_info "数据库 ID: $DB_ID"
echo ""

# 创建 KV 命名空间
print_info "创建 KV 命名空间..."
KV_OUTPUT=$(npx wrangler kv:namespace create CACHE 2>&1 || true)

if echo "$KV_OUTPUT" | grep -q "already exists"; then
    print_warning "KV 命名空间已存在，跳过创建"
    KV_ID=$(npx wrangler kv:namespace list | grep CACHE | grep -oP '(?<="id":")[^"]+' || echo "")
else
    KV_ID=$(echo "$KV_OUTPUT" | grep -oP '(?<=id = ")[^"]+' || echo "")
    print_success "KV 命名空间创建成功"
fi

if [ -z "$KV_ID" ]; then
    print_error "无法获取 KV 命名空间 ID"
    echo "请手动创建: npx wrangler kv:namespace create CACHE"
    exit 1
fi
print_info "KV 命名空间 ID: $KV_ID"
echo ""

# 创建 R2 存储桶
print_info "创建 R2 存储桶..."
R2_NAME="${WORKER_NAME}-storage"
R2_OUTPUT=$(npx wrangler r2 bucket create "$R2_NAME" 2>&1 || true)

if echo "$R2_OUTPUT" | grep -q "already exists"; then
    print_warning "R2 存储桶已存在，跳过创建"
else
    print_success "R2 存储桶创建成功"
fi
echo ""

# 更新 wrangler.toml
print_info "更新配置文件..."
if [ -f "wrangler.toml" ]; then
    # 更新数据库配置
    sed -i.tmp "s/database_name = \"[^\"]*\"/database_name = \"$DB_NAME\"/" wrangler.toml
    sed -i.tmp "s/database_id = \"[^\"]*\"/database_id = \"$DB_ID\"/" wrangler.toml
    
    # 更新 KV 配置
    sed -i.tmp "s/^id = \"[^\"]*\"/id = \"$KV_ID\"/" wrangler.toml
    
    # 更新 R2 配置
    sed -i.tmp "s/bucket_name = \"[^\"]*\"/bucket_name = \"$R2_NAME\"/" wrangler.toml
    
    rm -f wrangler.toml.tmp
    print_success "配置文件更新完成"
else
    print_error "wrangler.toml 文件不存在"
    exit 1
fi
echo ""

# 初始化数据库
print_info "初始化数据库..."
if [ -f "schema.sql" ]; then
    npx wrangler d1 execute "$DB_NAME" --file=./schema.sql --remote
    print_success "数据库初始化完成"
else
    print_error "schema.sql 文件不存在"
    exit 1
fi
echo ""

# 设置环境变量
print_info "设置环境变量..."
echo ""

# 管理员用户名
echo -n "请输入管理员用户名 (默认: admin): "
read ADMIN_USERNAME
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
echo "$ADMIN_USERNAME" | npx wrangler secret put ADMIN_USERNAME
print_success "管理员用户名设置成功"
echo ""

# 管理员密码
while true; do
    echo -n "请输入管理员密码: "
    read -s ADMIN_PASSWORD
    echo ""
    if [ -z "$ADMIN_PASSWORD" ]; then
        print_warning "密码不能为空，请重新输入"
    else
        break
    fi
done
echo "$ADMIN_PASSWORD" | npx wrangler secret put ADMIN_PASSWORD
print_success "管理员密码设置成功"
echo ""

# JWT 密钥
print_info "生成 JWT 密钥..."
if command -v openssl &> /dev/null; then
    JWT_SECRET=$(openssl rand -base64 32)
else
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
fi
echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET
print_success "JWT 密钥设置成功"
echo ""

# 部署
print_info "部署到 Cloudflare Workers..."
npm run deploy
echo ""

# 获取部署信息
echo "========================================="
echo -e "${GREEN}   ✨ 部署成功！${NC}"
echo "========================================="
echo ""
echo -e "${BLUE}📌 访问地址:${NC} https://${WORKER_NAME}.[你的子域名].workers.dev"
echo -e "${BLUE}📌 管理后台:${NC} https://${WORKER_NAME}.[你的子域名].workers.dev/admin"
echo -e "${BLUE}📌 管理员用户名:${NC} $ADMIN_USERNAME"
echo -e "${BLUE}📌 管理员密码:${NC} [您设置的密码]"
echo ""
echo -e "${YELLOW}💡 提示：${NC}"
echo "   1. 请妥善保管管理员密码"
echo "   2. 建议定期备份笔记数据"
echo "   3. 可通过管理后台导入/导出笔记"
echo "   4. 首次访问可能需要等待几秒钟"
echo ""
echo -e "${GREEN}🎉 感谢使用 CloudNote！${NC}"
echo ""
echo "遇到问题？访问 https://github.com/maqibg/cloudnote/issues"
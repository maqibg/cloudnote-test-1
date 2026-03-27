@echo off
setlocal enabledelayedexpansion

echo CloudNote - Cloudflare Workers 部署脚本
echo =======================================

:: 检查是否安装了wrangler
where wrangler >nul 2>nul
if %errorlevel% neq 0 (
    echo 错误: 未找到 wrangler。请先安装: npm install -g wrangler
    exit /b 1
)

:: 检查是否登录
echo 检查 Cloudflare 账户登录状态...
wrangler whoami
if %errorlevel% neq 0 (
    echo 请先登录 Cloudflare：
    wrangler login
)

:: 创建 D1 数据库
echo.
echo 步骤 1: 创建 D1 数据库...
set DB_NAME=cloudnote-db
wrangler d1 create %DB_NAME% 2>&1 | findstr "database_id" > temp.txt
if %errorlevel% equ 0 (
    for /f "tokens=3 delims= " %%a in (temp.txt) do set DB_ID=%%a
    set DB_ID=!DB_ID:"=!
    echo 数据库创建成功，ID: !DB_ID!
) else (
    echo 数据库已存在或创建失败，请手动检查
    set DB_ID=YOUR_DATABASE_ID
)
del temp.txt 2>nul

:: 更新 wrangler.toml
echo 更新 wrangler.toml 配置...
powershell -Command "(Get-Content wrangler.toml) -replace 'YOUR_DATABASE_ID', '%DB_ID%' | Set-Content wrangler.toml"

:: 初始化数据库表
echo.
echo 步骤 2: 初始化数据库表...
wrangler d1 execute %DB_NAME% --file=schema.sql

:: 创建 KV 命名空间
echo.
echo 步骤 3: 创建 KV 命名空间...
wrangler kv:namespace create CACHE 2>&1 | findstr "id" > temp.txt
if %errorlevel% equ 0 (
    for /f "tokens=3 delims= " %%a in (temp.txt) do set KV_ID=%%a
    set KV_ID=!KV_ID:"=!
    echo KV 命名空间创建成功，ID: !KV_ID!
) else (
    echo KV 命名空间已存在或创建失败
    set KV_ID=YOUR_KV_NAMESPACE_ID
)
del temp.txt 2>nul

:: 更新 wrangler.toml
powershell -Command "(Get-Content wrangler.toml) -replace 'YOUR_KV_NAMESPACE_ID', '%KV_ID%' | Set-Content wrangler.toml"

:: 创建 R2 存储桶
echo.
echo 步骤 4: 创建 R2 存储桶...
wrangler r2 bucket create cloudnote-storage

:: 设置环境变量
echo.
echo 步骤 5: 设置环境变量...
set /p ADMIN_USER="请输入管理员用户名 (默认: admin): "
if "%ADMIN_USER%"=="" set ADMIN_USER=admin

set /p ADMIN_PASS="请输入管理员密码: "
if "%ADMIN_PASS%"=="" (
    echo 密码不能为空！
    exit /b 1
)

echo 正在生成 JWT 密钥...
:: 使用 PowerShell 生成随机密钥
for /f "delims=" %%a in ('powershell -Command "[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Random -Maximum 999999999).ToString()))"') do set JWT_SECRET=%%a

echo.
echo 设置环境变量...
echo %ADMIN_USER% | wrangler secret put ADMIN_USERNAME
echo %ADMIN_PASS% | wrangler secret put ADMIN_PASSWORD
echo %JWT_SECRET% | wrangler secret put JWT_SECRET

:: 安装依赖
echo.
echo 步骤 6: 安装依赖...
npm install

:: 部署
echo.
echo 步骤 7: 部署到 Cloudflare Workers...
wrangler deploy

echo.
echo =======================================
echo 部署完成！
echo.
echo 您的 CloudNote 实例已部署成功。
echo 管理员用户名: %ADMIN_USER%
echo 访问 /admin 路径进入管理后台
echo =======================================

pause
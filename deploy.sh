#!/bin/bash

# 部署脚本 - 上传代码到服务器并部署
# 使用方法: ./deploy.sh user@host:/path/to/deploy

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查参数
if [ -z "$1" ]; then
    echo -e "${RED}错误: 请提供服务器地址${NC}"
    echo "使用方法: ./deploy.sh user@host:/path/to/deploy"
    echo "示例: ./deploy.sh root@192.168.1.100:/opt/device-collector"
    exit 1
fi

SERVER_PATH="$1"
SERVER_USER=$(echo "$SERVER_PATH" | cut -d'@' -f1)
SERVER_HOST=$(echo "$SERVER_PATH" | cut -d'@' -f2 | cut -d':' -f1)
DEPLOY_PATH=$(echo "$SERVER_PATH" | cut -d':' -f2)

echo -e "${GREEN}开始部署到服务器...${NC}"
echo "服务器: $SERVER_USER@$SERVER_HOST"
echo "部署路径: $DEPLOY_PATH"
echo ""

# 需要上传的文件列表（排除 node_modules 和 .env）
FILES=(
    "server.js"
    "db.js"
    "app.js"
    "index.html"
    "styles.css"
    "package.json"
    "schema.sql"
    "README.md"
    "微信配置说明.md"
    "IO优化说明.md"
    "排错指南.md"
)

echo -e "${YELLOW}步骤 1: 上传代码文件...${NC}"
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  上传: $file"
        scp "$file" "$SERVER_PATH/"
    else
        echo -e "  ${RED}警告: $file 不存在，跳过${NC}"
    fi
done

echo ""
echo -e "${YELLOW}步骤 2: 在服务器上执行部署命令...${NC}"

# 生成远程部署命令
REMOTE_CMD="
cd $DEPLOY_PATH && \
echo '安装依赖...' && \
npm install --production && \
echo '部署完成！' && \
echo '' && \
echo '下一步操作：' && \
echo '1. 配置 .env 文件（数据库连接、微信配置等）' && \
echo '2. 初始化数据库: psql -U user -d database -f schema.sql' && \
echo '3. 启动服务: npm start' && \
echo '   或使用 PM2: pm2 start server.js --name device-collector'
"

ssh "$SERVER_USER@$SERVER_HOST" "$REMOTE_CMD"

echo ""
echo -e "${GREEN}部署完成！${NC}"
echo ""
echo -e "${YELLOW}重要提示：${NC}"
echo "1. 请在服务器上创建 .env 文件并配置数据库连接"
echo "2. 确保数据库已初始化（执行 schema.sql）"
echo "3. 启动服务前检查端口是否被占用"


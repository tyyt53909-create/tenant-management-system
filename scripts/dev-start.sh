#!/bin/bash

echo "🚀 启动租客管理系统开发环境..."

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker 未运行，请先启动 Docker"
  exit 1
fi

# 启动服务
echo "📦 启动 Docker 服务..."
docker-compose up -d

# 等待服务健康检查通过
echo "⏳ 等待服务就绪..."
sleep 5

# 检查服务状态
if docker-compose ps | grep -q "Up"; then
  echo "✅ 所有服务已启动"
  echo ""
  echo "📊 服务信息:"
  echo "  PostgreSQL: localhost:5432"
  echo "  Redis: localhost:6379"
  echo ""
  echo "🔧 下一步:"
  echo "  cd backend && npm run prisma:migrate"
  echo "  npm run start:dev"
else
  echo "❌ 服务启动失败，请检查日志:"
  echo "  docker-compose logs"
fi

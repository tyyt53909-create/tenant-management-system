#!/bin/bash

echo "🧹 清理 Vite 缓存..."
cd "$(dirname "$0")/.."

if [ -d "node_modules/.vite" ]; then
  rm -rf node_modules/.vite
  echo "✅ 已删除 node_modules/.vite"
fi

if [ -d "dist" ]; then
  rm -rf dist
  echo "✅ 已删除 dist"
fi

echo ""
echo "🔄 请重新启动开发服务器："
echo "   npm run dev"
echo ""

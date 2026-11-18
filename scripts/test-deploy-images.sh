#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

scratch="$(mktemp -d)"
project="tenant-images-$(basename "$scratch" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')"
export BACKEND_IMAGE="${project}-backend" WEB_IMAGE="${project}-web" TAG=check
export WEB_PORT=127.0.0.1:0
export DB_USER=image_check DB_NAME=image_check
DB_PASSWORD="$(openssl rand -hex 16)"
JWT_SECRET="$(openssl rand -hex 32)"
ENCRYPTION_KEY="$(openssl rand -hex 16)"
export CORS_ORIGINS=https://image-check.example.test
export QUEUE_ENABLED=true STORAGE_DRIVER=local REDIS_URL='' REDIS_PASSWORD=''
export ADMIN_EMAIL=admin@image-check.example.test CLEANER_EMAIL=cleaner@image-check.example.test
ADMIN_PASSWORD="$(openssl rand -hex 16)"
CLEANER_PASSWORD="$(openssl rand -hex 16)"
export DB_PASSWORD JWT_SECRET ENCRYPTION_KEY ADMIN_PASSWORD CLEANER_PASSWORD

compose() {
  docker compose --env-file /dev/null -p "$project" -f docker-compose.prod.yml "$@"
}

cleanup() {
  local result=$?
  if [ "$result" -ne 0 ]; then
    compose ps --all || true
    compose logs --tail 60 migrate backend worker web || true
  fi
  compose down --volumes --remove-orphans || true
  rm -rf "$scratch"
}
trap cleanup EXIT

compose build backend
compose build web
compose up --detach --wait --wait-timeout 180
compose --profile seed run --rm --no-deps seed

# Compose 的直连入口已启动。另以 npm 入口验证其加载的是同一个 Worker 产物。
compose exec -T worker node --check dist/backend/src/worker.js
compose exec -T worker node -e '
  const pkg = require("./package.json");
  if (pkg.scripts["start:worker"] !== "node dist/backend/src/worker.js") process.exit(1);
'

worker_id="$(compose ps -q worker)"
worker_ready=false
for ((attempt = 0; attempt < 30; attempt++)); do
  if docker logs "$worker_id" 2>&1 | grep 'Worker 已启动' > /dev/null; then
    # CLIENT LIST 反映 Redis 已接收 BullMQ Worker 的阻塞取任务连接。
    if compose exec -T redis redis-cli CLIENT LIST | grep 'cmd=bzpopmin' > /dev/null; then
      worker_ready=true
      break
    fi
  fi
  sleep 1
done
test "$worker_ready" = true
test "$(docker inspect --format '{{.RestartCount}}' "$worker_id")" = 0

address="$(compose port web 8080)"
curl --fail --silent --show-error "http://$address/admin/" --output "$scratch/admin.html"
curl --fail --silent --show-error "http://$address/landing/" --output "$scratch/landing.html"
grep -q '<script type="module"' "$scratch/admin.html"
test -s "$scratch/landing.html"
smoke_command="$(ruby scripts/deploy-staging.test.rb --smoke-command)"
STAGING_URL="http://$address/api" bash -c "$smoke_command"

#!/usr/bin/env bash
# OPS-07 / T280：从 custom-format 备份恢复。会清空目标库现有对象，必须显式 --yes。
#
# 用法：
#   DATABASE_URL=postgresql://... ./scripts/restore-db.sh backups/tenant-....dump --yes
set -euo pipefail

FILE="${1:-}"
CONFIRM="${2:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法：DATABASE_URL=... $0 <backup.dump> --yes" >&2
  exit 1
fi
if [ "$CONFIRM" != "--yes" ]; then
  echo "拒绝执行：恢复会删除目标库现有对象。确认后追加 --yes。" >&2
  exit 1
fi
: "${DATABASE_URL:?必须设置 DATABASE_URL（目标库）}"
command -v pg_restore >/dev/null || { echo "缺少 pg_restore（安装 postgresql-client）" >&2; exit 1; }

if [ -f "$FILE.sha256" ]; then
  echo "[restore] 校验 sha256"
  expected="$(awk 'NR==1 { print $1 }' "$FILE.sha256")"
  actual="$(sha256sum "$FILE" | awk '{ print $1 }')"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "拒绝执行：sha256 不一致" >&2
    exit 1
  fi
fi

echo "[restore] 开始：$(date -u +%FT%TZ) <- $FILE"
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$FILE"
echo "[restore] 完成：$(date -u +%FT%TZ)"

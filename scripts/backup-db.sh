#!/usr/bin/env bash
# OPS-07 / T280：PostgreSQL 逻辑备份（custom format）+ sha256 + 保留策略。
#
# 用法：
#   DATABASE_URL=postgresql://... BACKUP_DIR=/var/backups/tenant ./scripts/backup-db.sh
#
# 环境变量：
#   DATABASE_URL    必填
#   BACKUP_DIR      默认 ./backups
#   RETENTION_DAYS  默认 14；0 表示不自动清理
#   DB_NAME         仅用于文件名，默认 tenant
set -euo pipefail

: "${DATABASE_URL:?必须设置 DATABASE_URL}"
command -v pg_dump >/dev/null || { echo "缺少 pg_dump（安装 postgresql-client）" >&2; exit 1; }

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_NAME="${DB_NAME:-tenant}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
SAFE_DB="$(printf '%s' "$DB_NAME" | tr -c 'A-Za-z0-9_.-' '_')"
FILE="$BACKUP_DIR/tenant-${SAFE_DB}-${STAMP}.dump"
TMP="$BACKUP_DIR/.tmp-${STAMP}-$$.dump"

mkdir -p "$BACKUP_DIR"
umask 077

cleanup() {
  rm -f "$TMP"
}
trap cleanup EXIT

echo "[backup] 开始：$(date -u +%FT%TZ) -> $FILE"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "$TMP"

mv "$TMP" "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
trap - EXIT

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
echo "[backup] 完成：$FILE（${SIZE} bytes）"

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -maxdepth 1 -name 'tenant-*.dump' -type f -mtime "+$RETENTION_DAYS" -print -delete
  find "$BACKUP_DIR" -maxdepth 1 -name 'tenant-*.dump.sha256' -type f -mtime "+$RETENTION_DAYS" -print -delete
  echo "[backup] 已清理 ${RETENTION_DAYS} 天前的备份"
fi

#!/usr/bin/env bash
# OPS-07 / T280：恢复演练。恢复到独立空库，校验关键表后再提醒清理。
#
# 用法：
#   DATABASE_URL=postgresql://.../tenant_system \
#   REHEARSAL_DATABASE_URL=postgresql://.../tenant_rehearsal \
#     ./scripts/restore-rehearsal.sh backups/tenant-....dump --yes
#
# 安全：拒绝 REHEARSAL_DATABASE_URL 与 DATABASE_URL 相同，避免覆盖生产库。
set -euo pipefail

FILE="${1:-}"
CONFIRM="${2:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法：DATABASE_URL=... REHEARSAL_DATABASE_URL=... $0 <backup.dump> --yes" >&2
  exit 1
fi
if [ "$CONFIRM" != "--yes" ]; then
  echo "拒绝执行：演练会清空目标库。确认后追加 --yes。" >&2
  exit 1
fi
: "${DATABASE_URL:?必须设置 DATABASE_URL（用于比对来源库）}"
: "${REHEARSAL_DATABASE_URL:?必须设置 REHEARSAL_DATABASE_URL（独立空库）}"
command -v psql >/dev/null || { echo "缺少 psql" >&2; exit 1; }

if [ -n "${PGHOSTADDR:-}" ] || [ -n "${PGPORT:-}" ] || [ -n "${PGSERVICE:-}" ]; then
  echo "拒绝执行：PGHOSTADDR、PGPORT 或 PGSERVICE 可覆盖连接目标" >&2
  exit 1
fi
unset PGHOSTADDR PGPORT PGSERVICE

comparison=0
TARGET_URL="$(node "$(dirname "$0")/backup-core.mjs" rehearsal-target)" || comparison=$?
if [ "$comparison" -eq 3 ]; then
  echo "拒绝执行：演练库不能与 DATABASE_URL 指向同一数据库" >&2
  exit 1
fi
if [ "$comparison" -ne 0 ] || [ -z "$TARGET_URL" ]; then
  echo "拒绝执行：无法比较或准备来源库和演练库连接串" >&2
  exit 1
fi

echo "[rehearsal] 恢复到演练库：$(date -u +%FT%TZ)"
DATABASE_URL="$TARGET_URL" "$(dirname "$0")/restore-db.sh" "$FILE" --yes

echo "[rehearsal] 校验关键表"
TABLE_COUNT="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
BILL_COUNT="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM bills")"
USER_COUNT="$(psql "$TARGET_URL" -tAc "SELECT count(*) FROM users")"
echo "[rehearsal] public 表数=${TABLE_COUNT}，bills=${BILL_COUNT}，users=${USER_COUNT}"

if [ "${TABLE_COUNT:-0}" -lt 20 ]; then
  echo "[rehearsal] 失败：表数量异常（<20）" >&2
  exit 1
fi

echo "[rehearsal] 通过。演练库保留供抽查；确认后手动 DROP DATABASE。"

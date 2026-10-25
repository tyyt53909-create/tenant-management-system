#!/usr/bin/env bash
# 为整合测试准备非超级用户和库标记。
# 只建角色、转移既有表的所有权、写入 integration_guard.marker。
# 不会 TRUNCATE，不会回退到 DATABASE_URL。
set -euo pipefail

if [[ "${ALLOW_INTEGRATION_RESET:-}" != "true" ]]; then
  echo "缺少显式开关 ALLOW_INTEGRATION_RESET=true，拒绝准备整合测试库" >&2
  exit 1
fi
if [[ -z "${INTEGRATION_ADMIN_DATABASE_URL:-}" ]]; then
  echo "必须设置 INTEGRATION_ADMIN_DATABASE_URL。不会回退到 DATABASE_URL" >&2
  exit 1
fi
if [[ -z "${INTEGRATION_DATABASE_MARKER:-}" || ${#INTEGRATION_DATABASE_MARKER} -lt 16 ]]; then
  echo "INTEGRATION_DATABASE_MARKER 至少 16 个字符" >&2
  exit 1
fi
if [[ -z "${INTEGRATION_TESTER_PASSWORD:-}" ]]; then
  echo "必须设置 INTEGRATION_TESTER_PASSWORD" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "需要 psql。CI 安装 postgresql-client；本地可用 postgres 镜像里的客户端" >&2
  exit 1
fi

psql "$INTEGRATION_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v tester_password="$INTEGRATION_TESTER_PASSWORD" \
  -v marker="$INTEGRATION_DATABASE_MARKER" <<'SQL'
SELECT current_database() AS preparing_database, current_user AS admin_user;

SELECT CASE
  WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'integration_tester')
  THEN format(
    'ALTER ROLE integration_tester WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
    :'tester_password'
  )
  ELSE format(
    'CREATE ROLE integration_tester LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
    :'tester_password'
  )
END
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO integration_tester', current_database())
\gexec

GRANT USAGE ON SCHEMA public TO integration_tester;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO integration_tester', item.tablename);
  END LOOP;

  FOR item IN
    SELECT sequencename
    FROM pg_sequences
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO integration_tester', item.sequencename);
  END LOOP;
END $$;

CREATE SCHEMA IF NOT EXISTS integration_guard;
CREATE TABLE IF NOT EXISTS integration_guard.marker (
  id integer PRIMARY KEY,
  token text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO integration_guard.marker (id, token)
VALUES (1, :'marker')
ON CONFLICT (id) DO UPDATE
SET token = EXCLUDED.token, marked_at = now();

REVOKE ALL ON SCHEMA integration_guard FROM PUBLIC;
GRANT USAGE ON SCHEMA integration_guard TO integration_tester;
GRANT SELECT ON integration_guard.marker TO integration_tester;
SQL

echo "整合测试库已标记。测试进程必须使用 integration_tester，而不是管理员账号。"

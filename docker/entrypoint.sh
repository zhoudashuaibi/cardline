#!/bin/sh
set -e

DB_URL="${DATABASE_URL:-file:/data/cardline.db}"
echo "[cardline] 数据库：${DB_URL}"

DB_FILE=$(echo "$DB_URL" | sed 's/^file://')
DB_DIR=$(dirname "$DB_FILE")
mkdir -p "$DB_DIR" 2>/dev/null || true
if [ -d "$DB_DIR" ] && [ ! -w "$DB_DIR" ]; then
  echo "[cardline] 警告：$DB_DIR 不可写，请检查挂载卷权限"
fi

if [ "${SKIP_DB_INIT:-0}" != "1" ]; then
  echo "[cardline] 初始化数据库表结构…"
  node apps/server/scripts/bootstrap-db.js
fi

echo "[cardline] 启动服务：$*"
exec "$@"

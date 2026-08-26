#!/bin/sh
set -eu

cd /app

echo "[aiecom-api] prisma migrate deploy"
pnpm exec prisma migrate deploy --schema=prisma/schema.prisma

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[aiecom-api] prisma seed (RUN_SEED=true)"
  pnpm exec tsx prisma/seed.ts
fi

# Nest 上传路径为 process.cwd()/../../uploads/...，cwd 需在 apps/api
echo "[aiecom-api] starting nest"
cd /app/apps/api
exec node dist/main.js

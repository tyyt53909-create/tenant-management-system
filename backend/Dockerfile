# OPT-25 / T198：后端生产镜像（多阶段）
#   deps    -> 安装全部依赖（含 dev，用于构建）
#   builder -> prisma generate + nest build + 预编译 seed（tsc 编译，运行期不需要 TS 执行器）
#   runner  -> 非 root 运行；app / migrate / seed 共用同一镜像
#              （seed 为预编译 JS，运行时不需要 TS 执行器）
# 构建：docker build -f backend/Dockerfile ./backend

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY prisma/schema.prisma ./prisma/
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
# Alpine 上 Prisma 自动探测 OpenSSL 经常失败，显式锁定 musl + openssl3 引擎；
# openssl 运行库 builder/runner 都要（generate/seed/migrate/app 都加载引擎）。
RUN apk add --no-cache openssl
# 引擎按目标架构选择（uname 即镜像架构，与运行处一致；本地 arm64 / 生产 amd64）
# 注意：不要用 $TARGETARCH，它只在 buildx 下才有值，普通 docker build 为空。
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ARCH="$(uname -m)" \
  && if [ "$ARCH" = "aarch64" ] ; then export PRISMA_CLI_BINARY_TARGETS=linux-musl-arm64-openssl-3.0.x KEEP_PAT="arm64-openssl-3.0.x" ; else export PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x KEEP_PAT="musl-openssl-3.0.x" ; fi \
  && npx prisma generate \
  && npm run build \
  && npx tsc prisma/seed.ts --outDir dist-seed --module nodenext --moduleResolution nodenext --target es2023 --skipLibCheck --esModuleInterop --resolvePackageJsonExports \
  && for d in node_modules/@prisma/engines node_modules/.prisma/client node_modules/@prisma/client ; do \
       [ -d "$d" ] || continue ; \
       find "$d" -type f \( -name "*openssl-1.1.x*" -o -name "*darwin*" -o -name "*debian*" -o -name "*windows*" -o -name "*rhel*" \) -delete ; \
       find "$d" -type f -name "*openssl-3.0.x*" ! -name "*${KEEP_PAT}*" -delete ; \
     done \
  && npm prune --omit=dev \
  && npm cache clean --force
# 断言：镜像里必须留下与运行架构一致的 Prisma 查询引擎。
# 之前出现过「构建成功、启动即崩」的错架构镜像（arm64 镜像里是 x64 引擎 → Prisma
# 找不到 libquery_engine-linux-musl-arm64-*.so.node，容器 crash loop，T208）。
# 有了这一步，同类问题会在构建期就失败，而不是等到部署。
RUN ARCH="$(uname -m)" \
  && ENG="$(find node_modules/@prisma/engines node_modules/.prisma/client -name 'libquery_engine-*.so.node' 2>/dev/null | head -1)" \
  && if [ -z "$ENG" ]; then echo "❌ 未找到 Prisma 查询引擎（generate 未产出或被 prune 删除）"; exit 1; fi \
  && echo "✅ Prisma 引擎: $ENG (arch=$ARCH)" \
  && if [ "$ARCH" = "aarch64" ] && ! echo "$ENG" | grep -q "arm64" ; then echo "❌ arm64 镜像里出现非 arm64 引擎: $ENG"; exit 1; fi \
  && if [ "$ARCH" != "aarch64" ] && echo "$ENG" | grep -q "arm64" ; then echo "❌ 非 arm64 构建里出现 arm64 引擎: $ENG"; exit 1; fi

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
  PORT=3000
# 非 root 运行（验收项）
RUN apk add --no-cache openssl \
  && addgroup -S app && adduser -S -u 1001 -G app app \
  && mkdir -p /app/uploads && chown -R app:app /app
COPY --from=builder --chown=app:app /app/package.json ./
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/dist-seed ./dist-seed
# migrate one-shot 需要 schema + migrations
COPY --from=builder --chown=app:app /app/prisma ./prisma
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main"]

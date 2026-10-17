# OPT-25 / T198：管理后台 + 落地页静态镜像（nginx）
# 构建：docker build --build-arg VITE_API_BASE_URL=/api -f frontend-admin/Dockerfile .
# 注意 context 为仓库根（需同时拿到 landing/）。

FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY frontend-admin/package.json frontend-admin/package-lock.json ./frontend-admin/
RUN cd frontend-admin && npm ci
COPY frontend-admin/ ./frontend-admin/
RUN cd frontend-admin && npm run build

FROM nginx:1.27-alpine AS runner
# 非 root 监听 8080/8443（compose 映射宿主机 80/443）
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/nginx-admin.conf /etc/nginx/conf.d/admin.conf
COPY --from=builder /app/frontend-admin/dist /usr/share/nginx/html/admin
COPY landing /usr/share/nginx/html/landing
RUN chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/run \
  && chmod -R 755 /usr/share/nginx/html \
  && ln -sf /tmp/nginx.pid /var/run/nginx.pid
USER nginx
EXPOSE 8080 8443
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

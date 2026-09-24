# syntax=docker/dockerfile:1
#
# Çok aşamalı imaj. Hiçbir sır build ARG/ENV olarak geçilmez; tüm yapılandırma
# çalışma zamanında `env_file` / ortam değişkenleriyle verilir (bkz. docker-compose.yml).
#
# Hedefler:
#   web    — Next.js standalone çıktı, yalnızca üretim bağımlılıkları, non-root
#   worker — BullMQ işçisi, gRPC servisi, migration/seed görevleri (tsx ile)

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- Tüm bağımlılıklar (build için) -------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npx prisma generate

# --- Yalnızca üretim bağımlılıkları (worker için) ---------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts && npx prisma generate && npm cache clean --force

# --- Next.js build ----------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Giriş betiği (Windows checkout'larındaki CRLF temizlenir) ------------------------
FROM base AS entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN tr -d '\015' < /entrypoint.sh > /entrypoint.lf && chmod 0755 /entrypoint.lf

# --- web: standalone sunucu ---------------------------------------------------------
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=entrypoint /entrypoint.lf /usr/local/bin/entrypoint.sh
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
ENTRYPOINT ["/bin/sh", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]

# --- worker: işçi / gRPC / migrate+seed ------------------------------------------------
FROM base AS worker
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001 -G nodejs
COPY --from=prod-deps --chown=worker:nodejs /app/node_modules ./node_modules
COPY --chown=worker:nodejs package.json tsconfig.json ./
COPY --chown=worker:nodejs prisma ./prisma
COPY --chown=worker:nodejs proto ./proto
COPY --chown=worker:nodejs src ./src
COPY --chown=worker:nodejs services ./services
COPY --chown=worker:nodejs scripts ./scripts
COPY --chown=worker:nodejs data ./data
COPY --from=entrypoint /entrypoint.lf /usr/local/bin/entrypoint.sh
USER worker
ENTRYPOINT ["/bin/sh", "/usr/local/bin/entrypoint.sh"]
CMD ["npx", "tsx", "--conditions=react-server", "src/worker/index.ts"]

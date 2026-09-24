#!/bin/sh
# Konteyner giriş noktası.
#
# Sırlar ortam değişkeni olarak verilmişse onlar kullanılır. Verilmemişse, compose'daki
# `secrets-init` görevinin paylaşılan birimde ürettiği rastgele değerler okunur. İmajda
# hiçbir sır ve bilinen varsayılan değer yoktur; değer değer asla loglanmaz.
set -eu

KEYFILE_DIR="${KEYFILE_DIR:-/run/booking-secrets}"

# Uygulama sırları: ortam değişkeni öncelikli, yoksa üretilmiş dosya.
for name in JWT_SECRET INTERNAL_API_SECRET TRANSFER_SIGNING_SECRET PSP_WEBHOOK_SECRET METRICS_TOKEN; do
  eval "current=\${$name:-}"
  if [ -z "$current" ] && [ -f "$KEYFILE_DIR/$name" ]; then
    export "$name=$(cat "$KEYFILE_DIR/$name")"
  fi
done

# Altyapı parolaları: compose'da db/redis aynı dosyadan beslendiği için dosya öncelikli.
for name in POSTGRES_PASSWORD REDIS_PASSWORD; do
  if [ -f "$KEYFILE_DIR/$name" ]; then
    export "$name=$(cat "$KEYFILE_DIR/$name")"
  fi
done

if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_HOST:-}" ]; then
  export DATABASE_URL="postgresql://${POSTGRES_USER:-booking}:${POSTGRES_PASSWORD:-}@${POSTGRES_HOST}:5432/${POSTGRES_DB:-booking}?connection_limit=10&pool_timeout=15"
fi

if [ -z "${REDIS_URL:-}" ] && [ -n "${REDIS_HOST:-}" ]; then
  export REDIS_URL="redis://:${REDIS_PASSWORD:-}@${REDIS_HOST}:${REDIS_PORT:-6379}"
fi

exec "$@"

/**
 * Demo seed'i production ortamında (NODE_ENV=production) varsayılan olarak
 * ÇALIŞMAZ: bilinen demo parolalı hesaplar (admin dahil) gerçek bir ortama
 * sızmamalıdır. Yalnızca açık `DEMO_SEED=true` ile (ör. docker compose demo
 * ortamı) izin verilir.
 */
export function assertSeedAllowed(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production" && env.DEMO_SEED !== "true") {
    throw new Error(
      "Demo seed production'da devre dışı. Demo ortamı için DEMO_SEED=true ayarlayın."
    );
  }
}

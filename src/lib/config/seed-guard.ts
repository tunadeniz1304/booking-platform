import { isDemoMode } from "./demo";

/**
 * Demo seed'i (bilinen `Password123!` parolalı admin/host/misafir hesapları) yalnızca
 * demo modunda çalışır (v3#11): `DEMO_MODE=false` iken — ve production'da açık
 * `DEMO_MODE=true` verilmedikçe — reddedilir; bu hesaplar gerçek bir ortama sızmaz.
 */
export function assertSeedAllowed(env: Record<string, string | undefined> = process.env): void {
  if (!isDemoMode(env)) {
    throw new Error(
      "Demo seed yalnızca demo modunda çalışır. Demo ortamı için DEMO_MODE=true ayarlayın."
    );
  }
}

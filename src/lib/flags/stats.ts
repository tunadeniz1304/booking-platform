import { prisma } from "@/lib/prisma";
import { loadFlags } from "./config";

/**
 * Deney sonuçları (P1-3, /admin): kol başına maruziyet, dönüşüm ve %95 Wilson aralığı.
 *
 * Dönüşüm = maruz kalan KULLANICININ maruziyetten SONRA oluşturduğu onaylı/tamamlanmış
 * rezervasyon. Oturum (anonim) özneleri maruziyette sayılır ama dönüşümü ölçülemez;
 * oran yalnız kimliği bilinen özneler üzerinden hesaplanır.
 */
export interface WilsonInterval {
  low: number;
  high: number;
}

/** Wilson skor aralığı (z=1.96 → %95). n=0 → [0, 1]. */
export function wilson(successes: number, n: number, z = 1.96): WilsonInterval {
  if (n <= 0) return { low: 0, high: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export interface VariantResult {
  variant: string;
  exposures: number;
  users: number;
  conversions: number;
  rate: number;
  ci: WilsonInterval;
}

export interface ExperimentResult {
  flagKey: string;
  enabled: boolean;
  variants: VariantResult[];
}

export async function experimentResults(): Promise<ExperimentResult[]> {
  const flags = loadFlags();
  const out: ExperimentResult[] = [];
  for (const [flagKey, flag] of Object.entries(flags)) {
    const rows = await prisma.$queryRaw<
      Array<{ variant: string; exposures: bigint; users: bigint; conversions: bigint }>
    >`
      SELECT e.variant,
             count(*) AS exposures,
             count(e."userId") AS users,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "Booking" b
               WHERE b."userId" = e."userId"
                 AND b."createdAt" >= e."createdAt"
                 AND b.status IN ('CONFIRMED', 'COMPLETED')
             )) AS conversions
      FROM "ExperimentExposure" e
      WHERE e."flagKey" = ${flagKey}
      GROUP BY e.variant`;
    const byVariant = new Map(rows.map((r) => [r.variant, r]));
    out.push({
      flagKey,
      enabled: flag.enabled,
      variants: Object.keys(flag.variants).map((variant) => {
        const r = byVariant.get(variant);
        const users = Number(r?.users ?? 0);
        const conversions = Number(r?.conversions ?? 0);
        return {
          variant,
          exposures: Number(r?.exposures ?? 0),
          users,
          conversions,
          rate: users > 0 ? conversions / users : 0,
          ci: wilson(conversions, users),
        };
      }),
    });
  }
  return out;
}

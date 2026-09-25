import { z } from "zod";
import murmurhash from "murmurhash";
import flagsJson from "../../../config/flags.json";

/**
 * Deney bayrakları (P1-3) — `config/flags.json`, sınırda zod ile doğrulanır.
 *
 * Her bayrak: `enabled` (kapalıysa herkes `defaultVariant` alır, maruziyet yazılmaz),
 * `variants` (kol adı → yüzde ağırlık, toplam 100). Kol seçimi deterministiktir:
 * `murmurhash3(flagKey:subject) mod BUCKETS` → aynı kullanıcı daima aynı kolda.
 */
export const BUCKETS = 10_000;

const FlagSchema = z
  .object({
    enabled: z.boolean(),
    defaultVariant: z.string().min(1),
    variants: z.record(z.string().min(1), z.number().min(0).max(100)),
  })
  .refine((f) => f.defaultVariant in f.variants, "defaultVariant kollar arasında olmalı")
  .refine(
    (f) => Math.abs(Object.values(f.variants).reduce((s, w) => s + w, 0) - 100) < 1e-9,
    "Kol ağırlıklarının toplamı 100 olmalı"
  );

export const FlagsFileSchema = z.record(z.string().min(1), FlagSchema);

export type FlagDefinition = z.infer<typeof FlagSchema>;
export type FlagsFile = z.infer<typeof FlagsFileSchema>;

export function parseFlags(raw: unknown): FlagsFile {
  return FlagsFileSchema.parse(raw);
}

let cached: FlagsFile | null = null;

export function loadFlags(): FlagsFile {
  cached ??= parseFlags(flagsJson);
  return cached;
}

/** 0..BUCKETS-1 arası deterministik kova (UTF-8 bayt dizisi üzerinden MurmurHash3). */
export function bucketOf(flagKey: string, subject: string): number {
  return murmurhash.v3(new TextEncoder().encode(`${flagKey}:${subject}`)) % BUCKETS;
}

/** Kovayı kol ağırlıklarına göre bir kola eşler (anahtar sırası JSON'daki sıra). */
export function assignVariant(flag: FlagDefinition, flagKey: string, subject: string): string {
  const bucket = bucketOf(flagKey, subject);
  let edge = 0;
  for (const [variant, weight] of Object.entries(flag.variants)) {
    edge += (weight / 100) * BUCKETS;
    if (bucket < edge) return variant;
  }
  return flag.defaultVariant;
}

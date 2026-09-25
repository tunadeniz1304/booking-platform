import {
  OpenFeature,
  InMemoryProvider,
  type Client,
  type EvaluationContext,
} from "@openfeature/server-sdk";
import { prisma } from "@/lib/prisma";
import { appendOutbox } from "@/lib/cqrs/outbox";
import { EventTypes, makeEvent } from "@/lib/events/events";
import { logger, errorFields } from "@/lib/observability/logger";
import { assignVariant, loadFlags, type FlagsFile } from "./config";

/**
 * Deney altyapısı (P1-3): resmi OpenFeature SDK + süreç içi (in-memory) sağlayıcı.
 *
 * Bayraklar `config/flags.json`'dan okunur; `contextEvaluator` kolu `targetingKey`
 * (kullanıcı id'si veya analitik izinli oturum çerezi) üzerinden murmurhash ile seçer.
 * Ağ/uzak servis yok → çevrimdışı çalışır. Bayrak kapalıysa SDK çağıranın varsayılanını
 * (DISABLED) döner ve maruziyet yazılmaz. Maruziyet, bayrak başına özne başına BİR kez
 * `ExperimentExposure` + outbox (`experiment.exposure`) olarak aynı işlemde kaydedilir.
 */
export const RANKING_FLAG = "search-ranking";
export const RANKING_VARIANTS = ["ranking.weighted", "ranking.ltr"] as const;
export type RankingVariant = (typeof RANKING_VARIANTS)[number];

const DOMAIN = "booking";

export function buildProvider(flags: FlagsFile): InMemoryProvider {
  const config = Object.fromEntries(
    Object.entries(flags).map(([key, flag]) => [
      key,
      {
        variants: Object.fromEntries(Object.keys(flag.variants).map((v) => [v, v])),
        defaultVariant: flag.defaultVariant,
        disabled: !flag.enabled,
        contextEvaluator: (ctx: EvaluationContext) =>
          ctx.targetingKey ? assignVariant(flag, key, ctx.targetingKey) : flag.defaultVariant,
      },
    ])
  );
  return new InMemoryProvider(config);
}

let client: Client | null = null;

/** Yalnız testler: farklı bayrak dosyasıyla sağlayıcıyı yeniden kurar (null → config/flags.json). */
export async function setFlagsForTests(flags: FlagsFile | null): Promise<void> {
  await OpenFeature.setProviderAndWait(DOMAIN, buildProvider(flags ?? loadFlags()));
  client = OpenFeature.getClient(DOMAIN);
}

async function getClient(): Promise<Client> {
  if (!client) await setFlagsForTests(null);
  return client!;
}

export interface Subject {
  /** Kovalama anahtarı: `user:<id>` veya `session:<id>`. */
  key: string;
  userId?: string;
}

export interface Assignment<V extends string = string> {
  variant: V;
  /** true → deneye dahil (kovalandı, maruziyet kaydedildi). */
  inExperiment: boolean;
}

/** Bir bayrağı değerlendirir; hedeflenmişse maruziyeti kaydeder (hata aramayı düşürmez). */
export async function evaluateFlag(
  flagKey: string,
  fallback: string,
  subject: Subject
): Promise<Assignment> {
  const details = await (
    await getClient()
  ).getStringDetails(flagKey, fallback, {
    targetingKey: subject.key,
  });
  const inExperiment = details.reason === "TARGETING_MATCH";
  if (inExperiment) await recordExposure(flagKey, details.value, subject);
  return { variant: details.value, inExperiment };
}

export async function getRankingVariant(
  subject: Subject | null
): Promise<Assignment<RankingVariant>> {
  if (!subject) return { variant: "ranking.weighted", inExperiment: false };
  const result = await evaluateFlag(RANKING_FLAG, "ranking.weighted", subject);
  const variant = (RANKING_VARIANTS as readonly string[]).includes(result.variant)
    ? (result.variant as RankingVariant)
    : "ranking.weighted";
  return { variant, inExperiment: result.inExperiment };
}

export async function recordExposure(
  flagKey: string,
  variant: string,
  subject: Subject
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.experimentExposure.createMany({
        data: [{ flagKey, variant, subjectId: subject.key, userId: subject.userId ?? null }],
        skipDuplicates: true,
      });
      if (count === 0) return;
      await appendOutbox(
        tx,
        makeEvent(EventTypes.ExperimentExposure, subject.key, "Experiment", {
          flagKey,
          variant,
          subjectId: subject.key,
          userId: subject.userId ?? null,
        })
      );
    });
  } catch (error) {
    logger.warn({ ...errorFields(error), flagKey }, "Deney maruziyeti kaydedilemedi");
  }
}

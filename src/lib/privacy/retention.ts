import { Prisma } from "@prisma/client";
import { maxDiscountReferenceDays } from "@/lib/compliance/market-rules";
import { prisma } from "@/lib/prisma";
import { getConfig, type AppConfig } from "@/lib/config/app-config";
import { addDays, todayUtc, toDbDate } from "@/lib/time/nights";
import { logger } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";

/**
 * Veri yaşam döngüsü (P0-5): operasyonel kayıtların saklama süresi dolunca partiler hâlinde
 * silinmesi. Bölümlenmiş (partitioned) tablo yok → `DELETE … WHERE id IN (SELECT … LIMIT n)`
 * partileri (kısa kilitler, tek dev işlem yok); her tablo çalıştırma başına en çok
 * `RETENTION_MAX_BATCHES` parti siler, kalan birikim sonraki gece erir.
 *
 * YASAL SAKLAMA — bu modül ASLA dokunmaz: `Invoice`, `JournalEntry/JournalLine`,
 * `Payment`, `HostPayout` (VUK/TTK, DAC7), `Notice`/`TakedownRequest`/`NoticeAppeal` (DSA),
 * `IdentityVerification` (KYC/MASAK), `Claim*` (çözüm merkezi). Denetim kaydında bu alanlara ait
 * eylemler `LEGAL_HOLD_AUDIT_PREFIXES` ile korunur. Gerekçe: docs/COMPLIANCE.md.
 */

/** Silinmeyen denetim eylemleri (önek eşleşmesi). Yeni yasal kayıt eylemi → buraya ekle. */
export const LEGAL_HOLD_AUDIT_PREFIXES = [
  "dsa.",
  "takedown.",
  "accessibility.",
  "kyc.",
  "claim.",
  "agent_mandate.",
  "payment.",
  "refund.",
  "cart.",
  "transfer.",
  "ledger.",
  "fraud.",
  "user.role",
  "message.blocked",
] as const;

export type RetentionTable =
  | "AuditLog"
  | "PaymentEvent"
  | "OutboxMessage"
  | "InventoryPriceHistory"
  | "MessageRiskFlag"
  | "AuthToken";

export type RetentionResult = Record<RetentionTable, number>;

const deleted = counter("data_retention_deleted_total", "Saklama süresi dolup silinen satırlar", [
  "table",
]);

const DAY_MS = 86_400_000;

type RetentionConfig = Pick<
  AppConfig,
  | "RETENTION_AUDIT_LOG_DAYS"
  | "RETENTION_PAYMENT_EVENT_DAYS"
  | "RETENTION_OUTBOX_DAYS"
  | "RETENTION_PRICE_HISTORY_DAYS"
  | "RETENTION_MESSAGE_RISK_DAYS"
  | "RETENTION_AUTH_TOKEN_DAYS"
  | "RETENTION_BATCH_SIZE"
  | "RETENTION_MAX_BATCHES"
>;

/**
 * Tablo başına kesim anları. Fiyat geçmişi en uzun pazar indirim referans penceresinden
 * (P1-7 `maxDiscountReferenceDays`) kısa tutulamaz.
 */
export function retentionCutoffs(
  config: RetentionConfig,
  now: Date,
  omnibusDays: number = maxDiscountReferenceDays()
) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const priceDays = Math.max(config.RETENTION_PRICE_HISTORY_DAYS, omnibusDays + 1);
  return {
    auditLog: ago(config.RETENTION_AUDIT_LOG_DAYS),
    paymentEvent: ago(config.RETENTION_PAYMENT_EVENT_DAYS),
    outbox: ago(config.RETENTION_OUTBOX_DAYS),
    priceHistory: ago(priceDays),
    /** Konaklama gecesi bu tarihten eskiyse geçmiş satırlarının hiçbiri bir teklifte kullanılmaz. */
    priceHistoryStayDate: toDbDate(addDays(todayUtc(now), -priceDays)),
    messageRisk: ago(config.RETENTION_MESSAGE_RISK_DAYS),
    authToken: ago(config.RETENTION_AUTH_TOKEN_DAYS),
  };
}

function batchStatements(
  cut: ReturnType<typeof retentionCutoffs>,
  limit: number
): Record<RetentionTable, Prisma.Sql> {
  const holds = LEGAL_HOLD_AUDIT_PREFIXES.map((p) => `${p}%`);
  return {
    AuditLog: Prisma.sql`
      DELETE FROM "AuditLog" WHERE id IN (
        SELECT id FROM "AuditLog"
        WHERE "createdAt" < ${cut.auditLog} AND NOT (action LIKE ANY(${holds}::text[]))
        LIMIT ${limit})`,
    PaymentEvent: Prisma.sql`
      DELETE FROM "PaymentEvent" WHERE id IN (
        SELECT id FROM "PaymentEvent" WHERE "receivedAt" < ${cut.paymentEvent} LIMIT ${limit})`,
    OutboxMessage: Prisma.sql`
      DELETE FROM "OutboxMessage" WHERE id IN (
        SELECT id FROM "OutboxMessage"
        WHERE status = 'DONE' AND COALESCE("processedAt", "createdAt") < ${cut.outbox}
        LIMIT ${limit})`,
    // Bir satır ancak kesimden ÖNCE daha yeni bir satırca geçersiz kılındıysa silinir: Omnibus
    // penceresi (≤ saklama süresi) başında yürürlükteki fiyat her zaman korunur. Geçmişte kalmış
    // konaklama gecelerinin satırları ise tümüyle silinir.
    InventoryPriceHistory: Prisma.sql`
      DELETE FROM "InventoryPriceHistory" WHERE id IN (
        SELECT h.id FROM "InventoryPriceHistory" h
        WHERE h.date < ${cut.priceHistoryStayDate}
           OR (h."effectiveAt" < ${cut.priceHistory} AND EXISTS (
                SELECT 1 FROM "InventoryPriceHistory" n
                WHERE n."roomTypeId" = h."roomTypeId" AND n.date = h.date
                  AND n."effectiveAt" <= ${cut.priceHistory}
                  AND (n."effectiveAt" > h."effectiveAt"
                       OR (n."effectiveAt" = h."effectiveAt" AND n.id > h.id))))
        LIMIT ${limit})`,
    MessageRiskFlag: Prisma.sql`
      DELETE FROM "MessageRiskFlag" WHERE id IN (
        SELECT id FROM "MessageRiskFlag"
        WHERE blocked = false AND "createdAt" < ${cut.messageRisk} LIMIT ${limit})`,
    AuthToken: Prisma.sql`
      DELETE FROM "AuthToken" WHERE id IN (
        SELECT id FROM "AuthToken" WHERE "expiresAt" < ${cut.authToken} LIMIT ${limit})`,
  };
}

/**
 * Tüm saklama hedeflerini partiler hâlinde budar. İdempotent; birden çok worker aynı anda
 * çalışsa da en kötü ihtimalle aynı satırı silmeye çalışan parti 0 satır döner.
 */
export async function pruneExpiredData(
  now = new Date(),
  config: RetentionConfig = getConfig()
): Promise<RetentionResult> {
  const limit = config.RETENTION_BATCH_SIZE;
  const statements = batchStatements(retentionCutoffs(config, now), limit);
  const result = {} as RetentionResult;
  for (const [table, sql] of Object.entries(statements) as Array<[RetentionTable, Prisma.Sql]>) {
    let total = 0;
    for (let batch = 0; batch < config.RETENTION_MAX_BATCHES; batch++) {
      const n = await prisma.$executeRaw(sql);
      total += n;
      if (n < limit) break;
    }
    result[table] = total;
    if (total > 0) deleted.inc({ table }, total);
  }
  logger.info({ deleted: result }, "data retention pruned");
  return result;
}

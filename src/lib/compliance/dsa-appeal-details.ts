import type { NoticeGround } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppealContext } from "@/lib/compliance/dsa-appeal";

/**
 * İtiraz sayfası için kararın yapılandırılmış alanları ve sonuçlanmış itirazın gerekçesi.
 * Yalnız `getAppealContext` (imza doğrulanmış) sonucuyla çağrılır.
 */
export interface AppealDecisionDetails {
  ground: NoticeGround | null;
  legalReference: string | null;
  /** Gerekçeli karar bildirimindeki "Olgular ve gerekçe" satırı; ayrıştırılamazsa null. */
  facts: string | null;
  appealResponse: string | null;
  appealDecidedAt: string | null;
}

// dsa.ts `buildStatementOfReasons` satır etiketleri (metin biçimi değişirse facts null döner).
const FACTS_PREFIX = "Olgular ve gerekçe / Facts and reasoning: ";
const FACTS_END = "\nOtomatik araç / Automated means: ";

export function factsFromStatement(statement: string): string | null {
  const start = statement.indexOf(FACTS_PREFIX);
  if (start < 0) return null;
  const from = start + FACTS_PREFIX.length;
  const end = statement.indexOf(FACTS_END, from);
  const facts = (end < 0 ? statement.slice(from) : statement.slice(from, end)).trim();
  return facts || null;
}

export async function getAppealDecisionDetails(ctx: AppealContext): Promise<AppealDecisionDetails> {
  const [notice, appeal] = await Promise.all([
    prisma.notice.findUnique({
      where: { id: ctx.noticeId },
      select: { decisionGround: true, legalReference: true },
    }),
    ctx.appeal
      ? prisma.noticeAppeal.findUnique({
          where: { id: ctx.appeal.id },
          select: { response: true, decidedAt: true },
        })
      : null,
  ]);
  return {
    ground: notice?.decisionGround ?? null,
    legalReference: notice?.legalReference?.trim() || null,
    facts: factsFromStatement(ctx.statementOfReasons),
    appealResponse: appeal?.response?.trim() || null,
    appealDecidedAt: appeal?.decidedAt?.toISOString() ?? null,
  };
}

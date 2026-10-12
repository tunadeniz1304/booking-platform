import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { minorToDecimalString } from "@/lib/money/currencies";
import { prisma } from "@/lib/prisma";

const HEADER = [
  "created_at",
  "paid_at",
  "kind",
  "status",
  "amount",
  "currency",
  "reference",
  "failure_code",
  "id",
] as const;

/** CSV hücresi: ayraç/tırnak kaçışlanır; =,+,-,@ ile başlayan metin formüle karşı öneklenir. */
const csvCell = (value: string | null) => {
  const s = value ?? "";
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * Ev sahibi payout geçmişinin tamamı, CSV (banka ekstresiyle mutabakat için). Ekrandaki liste
 * (`getHostPayoutOverview`) yalnız son kayıtları gösterir; sıralama ve tür aynıdır.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireRole(req, ["HOST", "ADMIN"]);
    const select = {
      id: true,
      amountMinor: true,
      currency: true,
      status: true,
      reference: true,
      createdAt: true,
      paidAt: true,
    } as const;
    const [legacy, host] = await Promise.all([
      prisma.payout.findMany({ where: { userId: actor.userId }, select }),
      prisma.hostPayout.findMany({
        where: { userId: actor.userId },
        select: { ...select, failureCode: true },
      }),
    ]);
    const rows = [
      ...legacy.map((p) => ({ ...p, kind: "transfer", failureCode: null as string | null })),
      ...host.map((p) => ({ ...p, kind: "host" })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const lines = [HEADER.join(",")];
    for (const p of rows) {
      const cells = [
        p.createdAt.toISOString(),
        p.paidAt?.toISOString() ?? "",
        p.kind,
        p.status,
        minorToDecimalString(p.amountMinor, p.currency),
        p.currency,
        csvCell(p.reference),
        csvCell(p.failureCode),
        p.id,
      ];
      lines.push(cells.join(","));
    }
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(lines.join("\n") + "\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="payouts-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error, "host.payouts.export");
  }
}

export const dynamic = "force-dynamic";

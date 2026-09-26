import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { buildTransparencyReport, transparencyReportCsv } from "@/lib/compliance/dsa";

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  format: z.enum(["json", "csv"]).default("json"),
});

/**
 * DSA şeffaflık raporu export'u (ADMIN, P1-13b): `?from=2026-01-01&to=2026-07-01&format=csv`.
 * Toplulaştırılmış sayılar; kişisel veri içermez.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole(req, ["ADMIN"]);
    const sp = req.nextUrl.searchParams;
    const q = querySchema.parse({
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
      format: sp.get("format") ?? undefined,
    });
    const report = await buildTransparencyReport(q.from, q.to);
    if (q.format === "csv") {
      return new NextResponse(transparencyReportCsv(report), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="transparency-${q.from.toISOString().slice(0, 10)}.csv"`,
        },
      });
    }
    return NextResponse.json(report);
  } catch (error) {
    return toErrorResponse(error, "admin.compliance.transparency");
  }
}

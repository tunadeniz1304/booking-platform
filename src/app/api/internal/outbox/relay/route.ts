import { NextRequest, NextResponse } from "next/server";
import { runOutboxRelay } from "@/lib/cqrs";
import { registerEventHandlers } from "@/lib/events/register";

/**
 * İç servis: Outbox mesajlarını anında boşaltır (on-demand drain).
 *
 * Bağımsız worker süreci (npm run worker) periyodik boşaltmayı yapar; bu
 * uç, test/operasyon ekibine eşzamanlı flush imkânı verir. Bir paylaşılan
 * sır başlığı ile korunur (INTERNAL_API_SECRET). Middleware rate-limit'ine
 * dahildir.
 */
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || "";

export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-internal-secret");
  if (!INTERNAL_SECRET || provided !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    registerEventHandlers();
    const published = await runOutboxRelay();
    return NextResponse.json({ published });
  } catch (error) {
    console.error("Outbox relay endpoint failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";

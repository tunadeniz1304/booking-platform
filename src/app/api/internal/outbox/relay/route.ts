import { NextRequest, NextResponse } from "next/server";
import { runOutboxRelay } from "@/lib/cqrs";
import { registerEventHandlers } from "@/lib/events/register";
import { authorizeInternalRequest } from "@/lib/security/internal-auth";
import { toErrorResponse } from "@/lib/http/errors";

/**
 * İç servis: Outbox mesajlarını anında boşaltır (operasyon/test için on-demand).
 * Periyodik boşaltmayı worker süreci yapar. `x-internal-secret` veya ADMIN JWT.
 */
export async function POST(req: NextRequest) {
  try {
    await authorizeInternalRequest(req);
    registerEventHandlers();
    return NextResponse.json({ published: await runOutboxRelay() });
  } catch (error) {
    return toErrorResponse(error, "internal.outbox.relay");
  }
}

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { acquireConnectionSlot } from "@/lib/live/hub";
import { resolveThreadAccess } from "@/lib/messaging/message-service";
import { subscribeThread, type MessageEvent } from "@/lib/messaging/hub";

/**
 * Mesaj akışı (SSE). Yetki GET ile aynı (misafir/ev sahibi, diğerleri 404); IP başına
 * eşzamanlı bağlantı sınırı canlı ısı haritasıyla ortak; periyodik heartbeat yorumu.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { userId } = await requireAuth(req);
    await resolveThreadAccess(id, userId);
  } catch (error) {
    return toErrorResponse(error, "bookings.messages.stream");
  }
  const config = getConfig();
  const release = await acquireConnectionSlot(
    clientKey(req.headers, {
      trustedProxyHops: config.TRUSTED_PROXY_HOPS,
      trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
    })
  );
  if (!release) {
    return NextResponse.json(
      { error: "Çok fazla eşzamanlı bağlantı", code: "TOO_MANY_STREAMS" },
      { status: 429 }
    );
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // akış kapanmış
        }
      };
      const unsubscribe = subscribeThread(id, (m: MessageEvent) =>
        write(`event: message\ndata: ${JSON.stringify(m)}\n\n`)
      );
      const heartbeat = setInterval(() => write(": ping\n\n"), config.MESSAGE_SSE_HEARTBEAT_MS);
      write(": connected\n\n");
      let done = false;
      cleanup = () => {
        if (done) return;
        done = true;
        clearInterval(heartbeat);
        unsubscribe();
        void release();
      };
      req.signal.addEventListener("abort", () => {
        cleanup?.();
        try {
          controller.close();
        } catch {
          // zaten kapalı
        }
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

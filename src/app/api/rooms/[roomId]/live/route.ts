import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRoomHeat, recordRoomView } from "@/lib/live/stats";
import { acquireConnectionSlot, subscribeHeat } from "@/lib/live/hub";
import { resolveViewer } from "@/lib/live/viewer";
import { getConfig } from "@/lib/config/app-config";
import { clientKey } from "@/lib/security/ip";
import { addDays, diffDays, parseIsoDate, todayUtc } from "@/lib/time/nights";

const querySchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/**
 * Canlı talep ısı haritası (SSE). Hata #11 düzeltmeleri: aralık ≤ LIVE_MAX_RANGE_DAYS,
 * IP başına bağlantı sınırı, bağlantı başına poll yerine paylaşılan poller + pub/sub,
 * görüntülenme sayımı yalnızca imzalı oturum/cihaz başına HyperLogLog ile (v4#18).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const config = getConfig();
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Geçersiz tarih" }, { status: 400 });

  let start: string;
  let end: string;
  try {
    start = parsed.data.start ? parseIsoDate(parsed.data.start) : todayUtc();
    end = parsed.data.end ? parseIsoDate(parsed.data.end) : addDays(parseIsoDate(start), 7);
  } catch {
    return NextResponse.json({ error: "Geçersiz tarih" }, { status: 400 });
  }
  const span = diffDays(parseIsoDate(start), parseIsoDate(end));
  if (span <= 0 || span > config.LIVE_MAX_RANGE_DAYS) {
    return NextResponse.json(
      {
        error: `Tarih aralığı 1–${config.LIVE_MAX_RANGE_DAYS} gün olmalı`,
        code: "RANGE_TOO_LARGE",
      },
      { status: 400 }
    );
  }

  const first = await getRoomHeat(roomId, start, end);
  if (!first) return NextResponse.json({ error: "Oda bulunamadı" }, { status: 404 });

  const ip = clientKey(req.headers, {
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
    trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
  });
  const release = await acquireConnectionSlot(ip);
  if (!release) {
    return NextResponse.json(
      { error: "Çok fazla eşzamanlı bağlantı", code: "TOO_MANY_STREAMS" },
      { status: 429 }
    );
  }
  const viewer = await resolveViewer(req);
  if (viewer.viewerId) await recordRoomView(roomId, viewer.viewerId);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (heat: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: heat\ndata: ${JSON.stringify(heat)}\n\n`));
        } catch {
          // akış kapanmış
        }
      };
      send(first);
      unsubscribe = subscribeHeat(roomId, start, end, send);
      req.signal.addEventListener("abort", () => {
        unsubscribe?.();
        void release();
        try {
          controller.close();
        } catch {
          // zaten kapalı
        }
      });
    },
    cancel() {
      unsubscribe?.();
      void release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(viewer.setCookie ? { "Set-Cookie": viewer.setCookie } : {}),
    },
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

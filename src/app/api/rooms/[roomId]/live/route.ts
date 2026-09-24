import { NextRequest } from "next/server";
import { getRoomHeat, recordRoomView } from "@/lib/live/stats";

/**
 * Canlı talep ısı haritası — Server-Sent Events (SSE) akışı.
 *
 * GET /api/rooms/[roomId]/live
 * Bağlantı boyunca her 3 saniyede bir oda ısısı (scarcity, views, demand, fiyat)
 * yayınlanır; kullanıcı sayfadan ayrılınca bağlantı kapanır. Middleware
 * rate-limit'ine tabidir; genel (auth gerektirmez) bir ısı haritasıdır.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start") ?? undefined;
  const end = searchParams.get("end") ?? undefined;

  // Her bağlantı bir görüntülenme sayar (canlı ilgi sinyali)
  await recordRoomView(roomId).catch(() => {});

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = async () => {
        if (closed) return;
        try {
          const heat = await getRoomHeat(roomId, start, end);
          if (!heat) {
            controller.enqueue(encoder.encode(`event: error\ndata: Oda bulunamadı\n\n`));
            return;
          }
          controller.enqueue(encoder.encode(`event: heat\ndata: ${JSON.stringify(heat)}\n\n`));
        } catch (error) {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify((error as Error).message)}\n\n`)
          );
        }
      };

      // Anında ilk yayın
      await send();

      const timer = setInterval(send, 3000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // zaten kapalı
        }
      });
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

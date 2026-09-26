import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture } from "./fixtures";
import { GET as live } from "@/app/api/rooms/[roomId]/live/route";
import { countRoomViewers } from "@/lib/live/stats";
import { VIEWER_COOKIE, signViewerId } from "@/lib/live/viewer";
import { signAccessToken } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";

describeInt("regression: v4#18 SSE görüntülenme sayısı şişirilemez", () => {
  const prisma = new PrismaClient();
  let roomId = "";
  let userId = "";

  beforeAll(async () => {
    process.env.LIVE_MAX_CONNECTIONS_PER_IP = "50";
    process.env.LIVE_VIEWER_MINT_MAX = "2";
    process.env.TRUSTED_PROXY_HOPS = "1";
    resetConfigForTests();
    const fx = await createStayFixture(prisma, { tag: "v4-18" });
    roomId = fx.roomId;
    userId = fx.userId;
  });

  afterAll(async () => {
    delete process.env.LIVE_MAX_CONNECTIONS_PER_IP;
    delete process.env.LIVE_VIEWER_MINT_MAX;
    delete process.env.TRUSTED_PROXY_HOPS;
    resetConfigForTests();
    await prisma.$disconnect();
  });

  /** SSE'ye bağlanıp hemen koparır (yuva serbest kalır); `Set-Cookie`'yi döner. */
  async function connect(ip: string, headers: Record<string, string> = {}) {
    const ctrl = new AbortController();
    const res = await live(
      new NextRequest(`http://localhost:3000/api/rooms/${roomId}/live`, {
        headers: { "x-forwarded-for": ip, ...headers },
        signal: ctrl.signal,
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(res.status).toBe(200);
    ctrl.abort();
    await res.body?.cancel().catch(() => undefined);
    return res.headers.get("set-cookie");
  }

  it("aynı imzalı cihaz / oturum tekrar bağlanınca sayı artmaz (HyperLogLog)", async () => {
    const device = `${VIEWER_COOKIE}=${signViewerId("device-aaaaaaaaaaaaaaaa")}`;
    for (let i = 0; i < 5; i++) await connect("198.51.100.1", { cookie: device });
    expect(await countRoomViewers(roomId)).toBe(1);

    const { token } = await signAccessToken(userId, "USER", 300);
    for (let i = 0; i < 3; i++) {
      await connect("198.51.100.1", { authorization: `Bearer ${token}` });
    }
    expect(await countRoomViewers(roomId)).toBe(2);
  });

  it("sahte çerez sayılmaz; çerezsiz yeniden bağlanma IP başına basım sınırında kalır", async () => {
    const before = await countRoomViewers(roomId);
    const forged = `${VIEWER_COOKIE}=device-bbbbbbbbbbbbbbbb.forged`;
    const cookies: Array<string | null> = [];
    for (let i = 0; i < 6; i++) cookies.push(await connect("198.51.100.2", { cookie: forged }));
    // Yalnızca ilk LIVE_VIEWER_MINT_MAX (2) bağlantıya yeni imzalı çerez basılır.
    expect(cookies.filter(Boolean)).toHaveLength(2);
    expect(await countRoomViewers(roomId)).toBe(before + 2);
  });
});

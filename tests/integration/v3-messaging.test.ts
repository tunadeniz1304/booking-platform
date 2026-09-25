import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken, type Role } from "@/lib/auth/tokens";
import { GET as messagesGet, POST as messagesPost } from "@/app/api/bookings/[id]/messages/route";
import { POST as draftPost } from "@/app/api/bookings/[id]/messages/draft/route";
import { GET as streamGet } from "@/app/api/bookings/[id]/messages/stream/route";

/** P1-6 mesajlaşma: IDOR (yalnızca misafir + ev sahibi), maskeleme, AI taslağı gönderilmez. */
describeInt("P1-6 rezervasyon mesajlaşması (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let bookingId = "";
  let heldId = "";
  const tokens: Record<"guest" | "host" | "stranger" | "strangerHost" | "admin", string> = {
    guest: "",
    host: "",
    stranger: "",
    strangerHost: "",
    admin: "",
  };

  const tokenFor = async (userId: string, role: Role) =>
    (await signAccessToken(userId, role, 300)).token;
  const req = (path: string, token: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "msg", days: 30 });
    const b = await fx.hold({ nights: 2, startInDays: 3 });
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
    bookingId = b.id;
    heldId = (await fx.hold({ nights: 1, startInDays: 10 })).id;
    const mk = (role: "USER" | "HOST" | "ADMIN", tag: string) =>
      prisma.user.create({
        data: {
          email: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@t.test`,
          passwordHash: "x",
          firstName: "X",
          lastName: "Y",
          role,
        },
      });
    const [stranger, strangerHost, admin] = await Promise.all([
      mk("USER", "s"),
      mk("HOST", "sh"),
      mk("ADMIN", "ad"),
    ]);
    tokens.guest = await tokenFor(fx.userId, "USER");
    tokens.host = await tokenFor(fx.hostId, "HOST");
    tokens.stranger = await tokenFor(stranger.id, "USER");
    tokens.strangerHost = await tokenFor(strangerHost.id, "HOST");
    tokens.admin = await tokenFor(admin.id, "ADMIN");
  });
  afterAll(() => prisma.$disconnect());

  it("misafir telefonu/IBAN'ı maskelenmiş olarak gönderir; ev sahibi okur", async () => {
    const res = await messagesPost(
      req(`/api/bookings/${bookingId}/messages`, tokens.guest, {
        body: "Merhaba, 0532 123 45 67 ya da TR33 0006 1005 1978 6457 8413 26 — https://x.io",
      }),
      ctx(bookingId)
    );
    expect(res.status).toBe(201);
    const { message } = await res.json();
    expect(message.senderRole).toBe("GUEST");
    expect(message.body).not.toMatch(/0532|TR33|x\.io/);
    expect(new Set(message.maskedKinds)).toEqual(new Set(["PHONE", "IBAN", "URL"]));
    const stored = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(stored.body).toBe(message.body); // ham metin DB'ye hiç yazılmaz

    const list = await messagesGet(
      req(`/api/bookings/${bookingId}/messages`, tokens.host),
      ctx(bookingId)
    );
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.role).toBe("HOST");
    expect(body.messages.map((m: { id: string }) => m.id)).toContain(message.id);
  });

  it("IDOR: başka misafir, başka ev sahibi ve ADMIN okuyamaz/yazamaz/akış açamaz (404)", async () => {
    for (const who of ["stranger", "strangerHost", "admin"] as const) {
      const path = `/api/bookings/${bookingId}/messages`;
      expect((await messagesGet(req(path, tokens[who]), ctx(bookingId))).status).toBe(404);
      expect(
        (await messagesPost(req(path, tokens[who], { body: "selam" }), ctx(bookingId))).status
      ).toBe(404);
      expect((await streamGet(req(`${path}/stream`, tokens[who]), ctx(bookingId))).status).toBe(
        404
      );
      expect((await draftPost(req(`${path}/draft`, tokens[who], {}), ctx(bookingId))).status).toBe(
        404
      );
    }
    const anon = new NextRequest(`http://localhost/api/bookings/${bookingId}/messages`);
    expect((await messagesGet(anon, ctx(bookingId))).status).toBe(401);
  });

  it("onaylanmamış (HELD) rezervasyonda mesaj gönderilemez; uzunluk sınırı uygulanır", async () => {
    const held = await messagesPost(
      req(`/api/bookings/${heldId}/messages`, tokens.guest, { body: "selam" }),
      ctx(heldId)
    );
    expect(held.status).toBe(409);
    const long = await messagesPost(
      req(`/api/bookings/${bookingId}/messages`, tokens.guest, { body: "a".repeat(50_000) }),
      ctx(bookingId)
    );
    expect(long.status).toBe(400);
  });

  it("AI taslağı yalnızca ev sahibine döner, kaydedilmez; misafir taslak işaretiyle gönderemez", async () => {
    const before = await prisma.message.count({ where: { thread: { bookingId } } });
    const guestDraft = await draftPost(
      req(`/api/bookings/${bookingId}/messages/draft`, tokens.guest, {}),
      ctx(bookingId)
    );
    expect(guestDraft.status).toBe(404);
    const res = await draftPost(
      req(`/api/bookings/${bookingId}/messages/draft`, tokens.host, {}),
      ctx(bookingId)
    );
    expect(res.status).toBe(200);
    const { draft } = await res.json();
    expect(draft.length).toBeGreaterThan(5);
    expect(await prisma.message.count({ where: { thread: { bookingId } } })).toBe(before);

    const spoof = await messagesPost(
      req(`/api/bookings/${bookingId}/messages`, tokens.guest, { body: "x", fromAiDraft: true }),
      ctx(bookingId)
    );
    expect(spoof.status).toBe(400);
    const approved = await messagesPost(
      req(`/api/bookings/${bookingId}/messages`, tokens.host, { body: draft, fromAiDraft: true }),
      ctx(bookingId)
    );
    expect(approved.status).toBe(201);
    expect((await approved.json()).message).toMatchObject({
      senderRole: "HOST",
      fromAiDraft: true,
    });
  });

  it("SSE akışı yetkili kullanıcıya açılır", async () => {
    const ac = new AbortController();
    const res = await streamGet(
      new NextRequest(`http://localhost/api/bookings/${bookingId}/messages/stream`, {
        headers: { authorization: `Bearer ${tokens.guest}` },
        signal: ac.signal,
      }),
      ctx(bookingId)
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain(": connected");
    ac.abort();
    await reader.cancel();
  });
});

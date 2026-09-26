import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import {
  completeCheckoutSession,
  createCheckoutSession,
  getCheckoutSession,
} from "@/lib/agentic/checkout";
import { draftHostReply, GUEST_NAME_PLACEHOLDER } from "@/lib/messaging/message-service";
import { generateSuggestions } from "@/lib/pricing/revenue";
import { getLlmClient } from "@/lib/llm/client";
import { Redactor } from "@/lib/llm/redaction";
import { registerEventHandlers } from "@/lib/events/register";
import { inlineFlow, setFulfilmentFlowForTests } from "@/lib/saga/booking-saga";
import { redis } from "@/lib/redis";
import type { AccessClaims } from "@/lib/auth";

/**
 * v4#3 (misafir adı pseudonimi, gelir açıklaması günlük önbelleği) ve v4#10 (ajan
 * checkout oturumu ↔ rezervasyon uzlaştırması) — gerçek Postgres/Redis ile.
 * LLM demo modunda (anahtar yok); ağa çıkılmaz.
 */
describeInt("v4 LLM harcaması + ajan checkout (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let day = 10;
  const key = () => `k-${Math.random().toString(36).slice(2)}`;
  function stay(nights = 2) {
    const start = day;
    day += nights + 1;
    return {
      room_id: fx.roomId,
      check_in: iso(utcDay(start)),
      check_out: iso(utcDay(start + nights)),
      guests: 1,
    };
  }

  beforeAll(async () => {
    registerEventHandlers();
    setFulfilmentFlowForTests(inlineFlow);
    fx = await createStayFixture(prisma, {
      tag: "v4llm",
      units: 3,
      days: 60,
      nightlyPrice: 1000 + Math.floor(Math.random() * 500),
    });
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await redis.del(`fraud:v:user:${fx.userId}`, "fraud:v:card:tok_mock_decline_0000");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.$disconnect();
  });

  it("regression: v4#3 mesaj taslağında misafir adı LLM'e gitmez (pseudonim), yanıtta geri konur", async () => {
    const guestName = "Zeynepcan";
    await prisma.user.update({ where: { id: fx.userId }, data: { firstName: guestName } });
    const held = await fx.hold({ startInDays: 45 });
    await prisma.booking.update({ where: { id: held.id }, data: { status: "CONFIRMED" } });
    const thread = await prisma.messageThread.create({ data: { bookingId: held.id } });
    await prisma.message.create({
      data: {
        threadId: thread.id,
        senderId: fx.userId,
        senderRole: "GUEST",
        body: `Merhaba, ben ${guestName}. Geç giriş mümkün mü?`,
      },
    });

    const client = getLlmClient();
    const spy = vi.spyOn(client, "completeJson");
    const demoDraft = await draftHostReply(held.id, fx.hostId);
    expect(demoDraft.draft).toContain(guestName); // demo çıktısı gerçek adla

    const [, , messages, opts] = spy.mock.calls[0];
    const user = JSON.parse(messages[1].content) as { guestName: string };
    expect(user.guestName).toBe(GUEST_NAME_PLACEHOLDER);
    expect(opts.knownNames).toContain(guestName);
    // İstemcinin uyguladığı redaksiyondan sonra ad hiçbir mesajda kalmaz.
    const redactor = new Redactor(opts.knownNames ?? []);
    for (const m of messages) expect(redactor.redact(m.content)).not.toContain(guestName);

    // Model yer tutucuyla yanıt verirse gerçek ad geri konur.
    spy.mockResolvedValueOnce({
      data: { reply: `Merhaba ${GUEST_NAME_PLACEHOLDER}, geç giriş mümkün.` },
      aiGenerated: true,
      llmMode: "live",
      model: "m",
      latencyMs: 1,
    } as never);
    const live = await draftHostReply(held.id, fx.hostId);
    expect(live.draft).toBe(`Merhaba ${guestName}, geç giriş mümkün.`);
  });

  it("regression: v4#3 gelir önerisi açıklamaları günlük önbellekten (ikinci üretimde LLM çağrısı yok)", async () => {
    const host: AccessClaims = {
      userId: fx.hostId,
      role: "HOST",
      jti: "t",
      exp: Math.floor(Date.now() / 1000) + 3600,
      tv: 0,
    };
    const spy = vi.spyOn(getLlmClient(), "completeText");
    const first = await generateSuggestions(host, fx.roomId);
    expect(first.length).toBeGreaterThan(0);
    const firstCalls = spy.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    const second = await generateSuggestions(host, fx.roomId);
    expect(spy.mock.calls.length).toBe(firstCalls);
    expect(second.map((s) => s.explanation)).toEqual(first.map((s) => s.explanation));
  });

  it("regression: v4#10 red sonrası hold süresi dolan oturum okunurken iptal edilir, tamamlanamaz", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay());
    await expect(
      completeCheckoutSession(fx.userId, session.id, key(), "spt_mock_decline")
    ).rejects.toMatchObject({ status: 402 });
    const open = await getCheckoutSession(fx.userId, session.id);
    expect(open.status).toBe("ready_for_payment");
    expect(open.order).not.toBeNull();

    // Hold süresi doldu (worker henüz EXPIRED yapmamış olsa bile).
    await prisma.booking.update({
      where: { id: open.order!.id },
      data: { holdExpiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await getCheckoutSession(fx.userId, session.id)).status).toBe("canceled");
    await expect(
      completeCheckoutSession(fx.userId, session.id, key(), "spt_mock_ok")
    ).rejects.toMatchObject({ status: 409, code: "CHECKOUT_CANCELED" });
  });

  it("regression: v4#10 rezervasyon EXPIRED ise ready_for_payment oturum da iptal olur", async () => {
    const { session } = await createCheckoutSession(fx.userId, key(), stay());
    await expect(
      completeCheckoutSession(fx.userId, session.id, key(), "spt_mock_decline")
    ).rejects.toMatchObject({ status: 402 });
    const open = await getCheckoutSession(fx.userId, session.id);
    await prisma.booking.update({ where: { id: open.order!.id }, data: { status: "EXPIRED" } });
    expect((await getCheckoutSession(fx.userId, session.id)).status).toBe("canceled");
  });
});

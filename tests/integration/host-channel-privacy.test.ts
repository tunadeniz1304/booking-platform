import { it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { bulkUpdateAvailability, updateProperty } from "@/lib/host/host-service";
import { applyAriMessage, exportRoomCalendar, importCalendar } from "@/lib/channel/channel";
import { deleteAccount, exportUserData } from "@/lib/privacy/privacy-service";
import { issueMandate, revokeMandate } from "@/lib/agentic/mandate";
import { hashPassword } from "@/lib/auth";
import type { AccessClaims } from "@/lib/auth";

const claims = (userId: string, role: AccessClaims["role"]): AccessClaims => ({
  userId,
  role,
  jti: "j",
  exp: 0,
  tv: 0,
});

describeInt("F7 host / kanal / KVKK (integration)", () => {
  it("host yalnızca kendi mülkü; ARI rezervasyonlu geceyi ezmez; kanal idempotent; iCal; KVKK", async () => {
    const prisma = new PrismaClient();
    const stamp = Date.now();
    const host = await prisma.user.create({
      data: {
        email: `h-${stamp}@t.test`,
        passwordHash: "gizli-hash",
        firstName: "H",
        lastName: "O",
        role: "HOST",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: `o-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "O",
        lastName: "T",
        role: "HOST",
      },
    });
    const loc = await prisma.location.create({
      data: { city: `HostCity-${stamp}`, country: "TEST" },
    });
    const p = await prisma.property.create({
      data: {
        licenseStatus: "VERIFIED",
        hostId: host.id,
        title: "Host",
        description: "host test",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePriceMinor: 80000n,
        isActive: false,
      },
    });
    const ratePlans = { create: [{ code: "STANDARD", name: "Standart", isDefault: true }] };
    const room = await prisma.roomType.create({
      data: { propertyId: p.id, name: "O", maxOccupancy: 2, bedType: "Ç", ratePlans },
    });
    await prisma.inventoryDay.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        roomTypeId: room.id,
        date: utcDay(i + 1),
        priceMinor: 80000n,
        total: 1,
      })),
    });
    // 5. gece satılmış (tek birim dolu): sayaç modelinde "rezervasyonlu gece" = sold > 0
    await prisma.inventoryDay.update({
      where: { roomTypeId_date: { roomTypeId: room.id, date: utcDay(5) } },
      data: { sold: 1 },
    });

    // IDOR: başka host 404; belge yoksa yayınlanamaz
    await expect(
      updateProperty(claims(other.id, "HOST"), p.id, { title: "Ele geçir" })
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      updateProperty(claims(host.id, "HOST"), p.id, { isActive: true })
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (
        await updateProperty(claims(host.id, "HOST"), p.id, {
          isActive: true,
          licenseNumber: "34-12345",
        })
      ).isActive
    ).toBe(true);

    // Allotment'ı 0'a indirme girişimi: satılmış gecede total, sold + held altına inemez
    const r = await bulkUpdateAvailability(claims(host.id, "HOST"), room.id, {
      from: iso(utcDay(1)),
      to: iso(utcDay(10)),
      price: 999,
      total: 0,
    });
    expect(r.skippedLocked).toBe(1);
    const lockedNight = await prisma.inventoryDay.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId: room.id, date: utcDay(5) } },
    });
    expect(lockedNight.total).toBe(1);
    expect(lockedNight.sold).toBe(1);
    const closedNight = await prisma.inventoryDay.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId: room.id, date: utcDay(4) } },
    });
    expect(closedNight.total).toBe(0);
    const [{ overbooked }] = await prisma.$queryRaw<Array<{ overbooked: number }>>`
      SELECT count(*)::int AS overbooked FROM "InventoryDay"
      WHERE "roomTypeId" = ${room.id} AND sold + held > total`;
    expect(overbooked).toBe(0);

    // ARI: aynı mesaj iki kez → tek etki; eski sıra reddedilir
    const msg = {
      roomId: room.id,
      sequence: 7,
      idempotencyKey: "ari-1",
      updates: [{ date: iso(utcDay(12)), price: "1234" }],
    };
    expect((await applyAriMessage(msg)).status).toBe("applied");
    expect((await applyAriMessage(msg)).status).toBe("duplicate");
    await expect(
      applyAriMessage({ ...msg, idempotencyKey: "ari-0", sequence: 6 })
    ).rejects.toMatchObject({ code: "STALE_SEQUENCE" });

    // iCal gidiş-dönüş: dışa aktarılan dolu gece başka odaya içe aktarılınca bloklanır
    const ics = await exportRoomCalendar(room.id);
    expect(ics).toContain("BEGIN:VCALENDAR");
    // Dışa aktarımda: satılmış 5. gece + total=0'a inen 1–4 ve 6–10. geceler
    const room2 = await prisma.roomType.create({
      data: { propertyId: p.id, name: "O2", maxOccupancy: 2, bedType: "Ç", ratePlans },
    });
    await prisma.inventoryDay.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        roomTypeId: room2.id,
        date: utcDay(i + 1),
        priceMinor: 80000n,
        total: 1,
      })),
    });
    const imported = await importCalendar(room2.id, ics, "ota-x");
    expect(imported).toMatchObject({ nights: 10, added: 10, removed: 0, conflicts: [] });
    const night5 = await prisma.inventoryDay.findUniqueOrThrow({
      where: { roomTypeId_date: { roomTypeId: room2.id, date: utcDay(5) } },
    });
    expect(night5.sold).toBe(1);
    expect(
      await prisma.externalBlock.count({
        where: { roomTypeId: room2.id, source: "ical:ota-x", date: utcDay(5) },
      })
    ).toBe(1);
    // Aynı takvim tekrar içe aktarılırsa uzlaştırma idempotent: yeni blok yok
    const again = await importCalendar(room2.id, ics, "ota-x");
    expect(again).toMatchObject({ added: 0, removed: 0 });

    // KVKK: dışa aktarımda parola özeti yok; silme sonrası kişisel alanlar pseudonim
    const exported = JSON.stringify(await exportUserData(host.id));
    expect(exported).not.toContain("passwordHash");
    expect(exported).not.toContain("gizli-hash");
    await deleteAccount(host.id);
    const anon = await prisma.user.findUniqueOrThrow({ where: { id: host.id } });
    expect(anon.email).toMatch(/@anon\.invalid$/);
    expect(anon.firstName).toBe("Silinmiş");
    await prisma.$disconnect();
  });

  it("KVKK dışa aktarımı: mesaj, mandate, talep, cüzdan, devir, passkey, oturum; gizli alan ve sızıntı yok", async () => {
    const prisma = new PrismaClient();
    const stamp = Date.now().toString(36);
    const guestHash = await hashPassword(`parola-${stamp}`);
    const mkUser = (tag: string, role: "USER" | "HOST", passwordHash = "x") =>
      prisma.user.create({
        data: {
          email: `${tag}-${stamp}@t.test`,
          passwordHash,
          firstName: `${tag}Ad`,
          lastName: `${tag}Soyad${stamp}`,
          role,
        },
      });
    const guest = await mkUser("misafir", "USER", guestHash);
    const host = await mkUser("evsahibi", "HOST");
    const stranger = await mkUser("yabanci", "USER");
    const loc = await prisma.location.create({ data: { city: `Kvkk-${stamp}`, country: "TEST" } });
    const property = await prisma.property.create({
      data: {
        licenseStatus: "VERIFIED",
        hostId: host.id,
        title: "Kvkk",
        description: "kvkk test",
        propertyType: "HOTEL",
        locationId: loc.id,
        basePriceMinor: 50000n,
      },
    });
    const room = await prisma.roomType.create({
      data: { propertyId: property.id, name: "K", maxOccupancy: 2, bedType: "Ç" },
    });
    const mkBooking = (userId: string) =>
      prisma.booking.create({
        data: {
          userId,
          propertyId: property.id,
          roomId: room.id,
          checkIn: utcDay(30),
          checkOut: utcDay(32),
          guestCount: 2,
          totalPriceMinor: 100000n,
          status: "CONFIRMED",
        },
      });
    const booking = await mkBooking(guest.id);
    const strangerBooking = await mkBooking(stranger.id);
    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        userId: guest.id,
        amountMinor: 100000n,
        provider: "mock",
        providerRef: `pi_mock_${stamp}`,
        status: "PAID",
      },
    });
    const thread = await prisma.messageThread.create({ data: { bookingId: booking.id } });
    const guestText = `misafir-mesaji-${stamp}`;
    const hostText = `evsahibi-yaniti-${stamp}`;
    await prisma.message.create({
      data: { threadId: thread.id, senderId: guest.id, senderRole: "GUEST", body: guestText },
    });
    await prisma.message.create({
      data: { threadId: thread.id, senderId: host.id, senderRole: "HOST", body: hostText },
    });
    const strangerThread = await prisma.messageThread.create({
      data: { bookingId: strangerBooking.id },
    });
    const strangerText = `yabanci-mesaji-${stamp}`;
    await prisma.message.create({
      data: {
        threadId: strangerThread.id,
        senderId: stranger.id,
        senderRole: "GUEST",
        body: strangerText,
      },
    });
    const mandate = await issueMandate(guest.id, {
      maxAmountMinor: 100000,
      currency: "TRY",
      expiresInMinutes: 10,
    });
    const revoked = await issueMandate(guest.id, {
      maxAmountMinor: 5000,
      currency: "TRY",
      expiresInMinutes: 10,
    });
    await revokeMandate(guest.id, revoked.claims.nonce);
    const strangerMandate = await issueMandate(stranger.id, {
      maxAmountMinor: 7000,
      currency: "TRY",
      expiresInMinutes: 10,
    });
    const alert = await prisma.priceAlert.create({
      data: {
        userId: guest.id,
        roomTypeId: room.id,
        checkIn: utcDay(40),
        checkOut: utcDay(41),
        currency: "TRY",
        lastTotalMinor: 50000,
      },
    });
    const claimText = `talep-aciklamasi-${stamp}`;
    const claimReply = `talep-yaniti-${stamp}`;
    const claim = await prisma.claim.create({
      data: {
        bookingId: booking.id,
        type: "GUEST_REFUND",
        openedById: guest.id,
        respondentId: host.id,
        amountRequestedMinor: 10000n,
        currency: "TRY",
        description: claimText,
      },
    });
    await prisma.claimMessage.create({
      data: { claimId: claim.id, authorId: host.id, role: "RESPONDENT", body: claimReply },
    });
    const credit = await prisma.walletCredit.create({
      data: {
        userId: guest.id,
        currency: "TRY",
        source: "CASHBACK",
        sourceRef: `cashback:kvkk-${stamp}`,
        amountMinor: 2000n,
        remainingMinor: 1500n,
        expiresAt: utcDay(365),
      },
    });
    const spend = await prisma.creditSpend.create({
      data: {
        userId: guest.id,
        bookingId: booking.id,
        currency: "TRY",
        amountMinor: 500n,
        status: "SPENT",
        allocations: { create: [{ creditId: credit.id, amountMinor: 500n }] },
      },
    });
    await prisma.loyaltyAccount.create({
      data: { userId: guest.id, completedStays: 3, tier: 1 },
    });
    const transferTokenHash = `transfer-token-hash-${stamp}`;
    const transfer = await prisma.bookingTransfer.create({
      data: {
        bookingId: booking.id,
        sellerId: guest.id,
        askPriceMinor: 90000n,
        tokenHash: transferTokenHash,
        expiresAt: utcDay(10),
      },
    });
    const publicKey = Buffer.from(`passkey-public-key-${stamp}`);
    const passkey = await prisma.webAuthnCredential.create({
      data: {
        id: `cred-${stamp}`,
        userId: guest.id,
        publicKey,
        counter: 42,
        name: `Anahtarım-${stamp}`,
      },
    });
    const session = await prisma.userSession.create({
      data: { id: `sess-${stamp}`, userId: guest.id, userAgent: "vitest", ipHint: "10.0.0.0/24" },
    });
    const authTokenHash = `auth-token-hash-${stamp}`;
    await prisma.authToken.create({
      data: {
        userId: guest.id,
        kind: "PASSWORD_RESET",
        tokenHash: authTokenHash,
        expiresAt: utcDay(1),
      },
    });

    const text = JSON.stringify(await exportUserData(guest.id));
    for (const needle of [
      booking.id,
      payment.id,
      guestText,
      hostText,
      mandate.claims.nonce,
      revoked.claims.nonce,
      alert.id,
      claim.id,
      claimText,
      claimReply,
      credit.id,
      spend.id,
      transfer.id,
      passkey.id,
      `Anahtarım-${stamp}`,
      session.id,
    ]) {
      expect(text, needle).toContain(needle);
    }
    const exported = JSON.parse(text) as {
      agentMandates?: Array<{ nonce: string; maxAmountMinor: number; revokedAt: string | null }>;
      loyalty?: { account: { tier: number } | null };
    };
    expect(exported.agentMandates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nonce: mandate.claims.nonce,
          maxAmountMinor: 100000,
          revokedAt: null,
        }),
        expect.objectContaining({ nonce: revoked.claims.nonce, revokedAt: expect.any(String) }),
      ])
    );
    expect(exported.loyalty?.account?.tier).toBe(1);

    // Gizli materyal yok (bcrypt özeti, token özetleri, passkey public key/counter)
    expect(text).not.toMatch(/\$2[aby]\$\d\d\$/);
    expect(text).not.toContain(guestHash);
    expect(text).not.toMatch(/passwordHash|tokenVersion|refreshToken|tokenHash|publicKey/i);
    expect(text).not.toContain(transferTokenHash);
    expect(text).not.toContain(authTokenHash);
    expect(text).not.toContain(publicKey.toString("base64"));
    // Başka kullanıcının verisi ve karşı tarafın kişisel alanları sızmaz
    expect(text).not.toContain(strangerText);
    expect(text).not.toContain(strangerMandate.claims.nonce);
    expect(text).not.toContain(strangerBooking.id);
    expect(text).not.toContain(stranger.email);
    expect(text).not.toContain(host.email);
    expect(text).not.toContain(host.lastName);

    // Ev sahibi tarafı: aldığı misafir mesajı ve kendi yanıtı var; misafirin mandate'i yok
    const hostExport = JSON.stringify(await exportUserData(host.id));
    expect(hostExport).toContain(guestText);
    expect(hostExport).toContain(hostText);
    expect(hostExport).toContain(claimReply);
    expect(hostExport).not.toContain(mandate.claims.nonce);
    expect(hostExport).not.toContain(guest.email);
    expect(hostExport).not.toContain(guest.lastName);
    expect(hostExport).not.toContain(strangerText);
    await prisma.$disconnect();
  });
});

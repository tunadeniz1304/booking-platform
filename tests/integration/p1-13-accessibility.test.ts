import { it, expect, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken, type Role } from "@/lib/auth/tokens";
import { searchProperties } from "@/lib/search";
import { listPublicFeatures } from "@/lib/compliance/accessibility";
import * as featuresRoute from "@/app/api/host/properties/[id]/accessibility/route";
import * as featureRoute from "@/app/api/host/properties/[id]/accessibility/[featureId]/route";
import * as adminList from "@/app/api/admin/accessibility/route";
import * as adminVerify from "@/app/api/admin/accessibility/[id]/route";
import { GET as searchGet } from "@/app/api/search/route";
import { STUB_MODEL_ID } from "@/lib/vision/stub-embedder";
import { solidImage } from "../helpers/test-images";

/**
 * P1-13(e) erişilebilirlik: host beyanı + kanıt fotoğrafı (ownership), admin doğrulaması
 * (audit), doğrulamanın kanıt değişince düşmesi ve arama filtresi (yalnız doğrulanmış, AND,
 * aynı oda tipinde).
 */

const ctx = <T>(params: T) => ({ params: Promise.resolve(params) });

async function tokenFor(userId: string, role: Role): Promise<string> {
  return (await signAccessToken(userId, role, 300, 0, Math.floor(Date.now() / 1000))).token;
}

describeInt("P1-13(e) erişilebilirlik özellikleri (integration)", () => {
  const prisma = new PrismaClient();
  const country = `A11Y${Date.now().toString(36)}`;
  let a: StayFixture;
  let b: StayFixture;
  let adminId: string;
  let photoA: string;
  let photoA2: string;
  let photoB: string;
  let roomA2: string;

  async function call(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    token: string,
    body?: unknown
  ) {
    return new NextRequest(`http://localhost${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function create(fx: StayFixture, body: unknown, propertyId = fx.propertyId) {
    const token = await tokenFor(fx.hostId, "HOST");
    const res = await featuresRoute.POST(
      await call("POST", `/api/host/properties/${propertyId}/accessibility`, token, body),
      ctx({ id: propertyId })
    );
    return { status: res.status, body: await res.json() };
  }

  async function verify(featureId: string, verified = true) {
    const token = await tokenFor(adminId, "ADMIN");
    const res = await adminVerify.POST(
      await call("POST", `/api/admin/accessibility/${featureId}`, token, { verified }),
      ctx({ id: featureId })
    );
    return { status: res.status, body: await res.json() };
  }

  /**
   * Kanıt fotoğrafı: analiz + embedding'i DOLU gerçek WebP — P1-10 backfill'leri (global
   * tarama) bu satırları işlemeye çalışmasın (paralel koşan v4-vision testini bozmasın).
   */
  async function photo(propertyId: string): Promise<string> {
    const data = await sharp(await solidImage(120, 32, 24))
      .webp()
      .toBuffer();
    const row = await prisma.propertyPhoto.create({
      data: {
        propertyId,
        contentType: "image/webp",
        data,
        width: 32,
        height: 24,
        byteSize: data.byteLength,
        pHash: "0000000000000000",
        qualityScore: 0.5,
        embeddingModel: STUB_MODEL_ID,
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "PropertyPhoto" SET embedding = array_fill(0.01::real, ARRAY[512])::vector WHERE id = $1`,
      row.id
    );
    return row.id;
  }

  const ids = async (codes: string) =>
    (await searchProperties({ country, accessibility: codes.split(",") as never })).results
      .map((r) => r.id)
      .sort();

  beforeAll(async () => {
    [a, b] = await Promise.all(
      ["a11y-a", "a11y-b"].map((tag) => createStayFixture(prisma, { tag, country, days: 1 }))
    );
    adminId = (
      await prisma.user.create({
        data: {
          email: `admin-a11y-${Date.now()}@t.test`,
          passwordHash: "x",
          firstName: "A",
          lastName: "D",
          role: "ADMIN",
        },
      })
    ).id;
    [photoA, photoA2, photoB] = await Promise.all([
      photo(a.propertyId),
      photo(a.propertyId),
      photo(b.propertyId),
    ]);
    roomA2 = (
      await prisma.roomType.create({
        data: {
          propertyId: a.propertyId,
          name: "Erişilebilir oda",
          maxOccupancy: 2,
          bedType: "DOUBLE",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ownership: başka host'un ilanında listeleme/ekleme/güncelleme/silme 404; yabancı kanıt fotoğrafı 400", async () => {
    const own = await create(a, { code: "ELEVATOR", evidencePhotoId: photoA });
    expect(own.status).toBe(201);
    expect(own.body.feature).toMatchObject({ code: "ELEVATOR", verified: false, roomTypeId: null });
    const featureId = own.body.feature.id as string;

    const tokenB = await tokenFor(b.hostId, "HOST");
    const url = `/api/host/properties/${a.propertyId}/accessibility`;
    expect(
      (await featuresRoute.GET(await call("GET", url, tokenB), ctx({ id: a.propertyId }))).status
    ).toBe(404);
    expect((await create(b, { code: "GRAB_BARS" }, a.propertyId)).status).toBe(404);
    const fctx = ctx({ id: a.propertyId, featureId });
    expect(
      (
        await featureRoute.PATCH(
          await call("PATCH", `${url}/${featureId}`, tokenB, { note: "x" }),
          fctx
        )
      ).status
    ).toBe(404);
    expect(
      (await featureRoute.DELETE(await call("DELETE", `${url}/${featureId}`, tokenB), fctx)).status
    ).toBe(404);
    // B kendi ilanındaki özelliği de A'nın özellik id'siyle hedefleyemez.
    expect(
      (
        await featureRoute.DELETE(
          await call(
            "DELETE",
            `/api/host/properties/${b.propertyId}/accessibility/${featureId}`,
            tokenB
          ),
          ctx({ id: b.propertyId, featureId })
        )
      ).status
    ).toBe(404);

    // Başka ilanın fotoğrafı kanıt olamaz; başka ilanın oda tipi bağlanamaz.
    expect((await create(a, { code: "GRAB_BARS", evidencePhotoId: photoB })).status).toBe(400);
    expect((await create(a, { code: "GRAB_BARS", roomTypeId: b.roomId })).status).toBe(404);
    // Genişlik yalnız kapı için; aynı kod aynı düzeyde iki kez → 409; bilinmeyen kod 400.
    expect((await create(a, { code: "ELEVATOR", widthCm: 90 })).status).toBe(400);
    expect((await create(a, { code: "ELEVATOR" })).status).toBe(409);
    expect((await create(a, { code: "HOVERBOARD" })).status).toBe(400);

    const list = await featuresRoute.GET(
      await call("GET", url, await tokenFor(a.hostId, "HOST")),
      ctx({ id: a.propertyId })
    );
    expect((await list.json()).features.map((f: { id: string }) => f.id)).toEqual([featureId]);
  });

  it("admin doğrulama: kanıtsız 409; doğrulama audit'li; kanıt değişince/silinince doğrulama düşer", async () => {
    const noEvidence = await create(a, { code: "VISUAL_ALARM" });
    expect((await verify(noEvidence.body.feature.id)).status).toBe(409);

    const door = await create(a, {
      code: "WIDE_DOORWAY",
      roomTypeId: roomA2,
      widthCm: 90,
      evidencePhotoId: photoA2,
    });
    expect(door.status).toBe(201);
    const doorId = door.body.feature.id as string;

    // Kuyrukta bekleyen olarak görünür (kanıtlı, doğrulanmamış).
    const pending = await adminList.GET(
      await call("GET", "/api/admin/accessibility?status=pending", await tokenFor(adminId, "ADMIN"))
    );
    expect((await pending.json()).features.map((f: { id: string }) => f.id)).toContain(doorId);

    const ok = await verify(doorId);
    expect(ok.status).toBe(200);
    expect(ok.body.feature).toMatchObject({
      verified: true,
      widthCm: 90,
      roomTypeName: "Erişilebilir oda",
    });
    const audit = await prisma.auditLog.findFirst({
      where: { action: "accessibility.verified", entityId: a.propertyId, actorId: adminId },
    });
    expect(audit?.meta).toMatchObject({ featureId: doorId, code: "WIDE_DOORWAY" });

    // Ölçü değişirse doğrulama düşer (DB tetiği).
    const tokenA = await tokenFor(a.hostId, "HOST");
    const url = `/api/host/properties/${a.propertyId}/accessibility/${doorId}`;
    const patched = await featureRoute.PATCH(
      await call("PATCH", url, tokenA, { widthCm: 85 }),
      ctx({ id: a.propertyId, featureId: doorId })
    );
    expect((await patched.json()).feature.verified).toBe(false);

    // Yeniden doğrula → kanıt fotoğrafı silinince (ON DELETE SET NULL) yine düşer.
    expect((await verify(doorId)).status).toBe(200);
    await prisma.propertyPhoto.delete({ where: { id: photoA2 } });
    const row = await prisma.accessibilityFeature.findUniqueOrThrow({ where: { id: doorId } });
    expect(row).toMatchObject({ evidencePhotoId: null, verifiedAt: null, verifiedById: null });

    // Admin olmayan doğrulayamaz.
    const hostTry = await adminVerify.POST(
      await call("POST", `/api/admin/accessibility/${doorId}`, tokenA, { verified: true }),
      ctx({ id: doorId })
    );
    expect(hostTry.status).toBe(403);
  });

  it("arama filtresi: yalnız doğrulanmış, AND ve aynı oda tipinde; ilan sayfası yalnız doğrulanmışı gösterir", async () => {
    // A: ilan düzeyinde ELEVATOR (ilk testte eklendi) — henüz doğrulanmadı.
    expect(await ids("ELEVATOR")).toEqual([]);
    const elevator = await prisma.accessibilityFeature.findFirstOrThrow({
      where: { propertyId: a.propertyId, code: "ELEVATOR" },
    });
    expect((await verify(elevator.id)).status).toBe(200);
    expect(await ids("ELEVATOR")).toEqual([a.propertyId]);

    // A: ROLL_IN_SHOWER oda 1'de, GRAB_BARS oda 2'de (ikisi de doğrulanmış) → birlikte eşleşmez.
    const photoA3 = await photo(a.propertyId);
    const shower = await create(a, {
      code: "ROLL_IN_SHOWER",
      roomTypeId: a.roomId,
      evidencePhotoId: photoA3,
    });
    const bars = await create(a, {
      code: "GRAB_BARS",
      roomTypeId: roomA2,
      evidencePhotoId: photoA3,
    });
    await verify(shower.body.feature.id);
    await verify(bars.body.feature.id);
    expect(await ids("ROLL_IN_SHOWER")).toEqual([a.propertyId]);
    expect(await ids("ROLL_IN_SHOWER,GRAB_BARS")).toEqual([]);
    // İlan düzeyi + oda düzeyi birleşir.
    expect(await ids("ELEVATOR,GRAB_BARS")).toEqual([a.propertyId]);

    // B: aynı kod doğrulanmamış beyan → filtreye girmez.
    expect((await create(b, { code: "ELEVATOR", evidencePhotoId: photoB })).status).toBe(201);
    expect(await ids("ELEVATOR")).toEqual([a.propertyId]);
    // Filtresiz arama ikisini de döner.
    expect((await searchProperties({ country })).results).toHaveLength(2);

    // HTTP: küçük harf kabul, bilinmeyen kod 400.
    const res = await searchGet(
      new NextRequest(
        `http://localhost/api/search?city=&accessibility=elevator,grab_bars&pageSize=50`
      ),
      undefined
    );
    expect(res.status).toBe(200);
    expect((await res.json()).results.map((r: { id: string }) => r.id)).toContain(a.propertyId);
    const bad = await searchGet(
      new NextRequest(`http://localhost/api/search?accessibility=NOPE`),
      undefined
    );
    expect(bad.status).toBe(400);

    // Geri alma → filtreden çıkar; ilan sayfası listesi yalnız doğrulanmışları içerir.
    expect((await verify(elevator.id, false)).status).toBe(200);
    expect(await ids("ELEVATOR")).toEqual([]);
    const pub = await listPublicFeatures(a.propertyId);
    expect(pub.map((f) => f.code).sort()).toEqual(["GRAB_BARS", "ROLL_IN_SHOWER"]);
    expect(await listPublicFeatures(b.propertyId)).toEqual([]);
  });
});

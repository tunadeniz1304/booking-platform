import { it, expect, beforeAll, afterAll } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { signAccessToken, type Role } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";
import { setImageEmbedderForTests } from "@/lib/vision/clip";
import { createStubImageEmbedder, STUB_MODEL_ID } from "@/lib/vision/stub-embedder";
import { searchProperties } from "@/lib/search";
import * as photosRoute from "@/app/api/host/properties/[id]/photos/route";
import * as photoRoute from "@/app/api/host/properties/[id]/photos/[photoId]/route";
import * as publicPhoto from "@/app/api/photos/[id]/route";
import { patternImage, solidImage } from "../helpers/test-images";

/**
 * P1-10 görsel zekâ (ADR 0022): yükleme hattı (kalite, pHash duplikat uyarısı, stub CLIP
 * embedding) ve aramada "bu fotoğraftaki gibi" görsel kNN kanalı. Ağ ve gerçek model yok.
 */

async function tokenFor(userId: string, role: Role): Promise<string> {
  return (await signAccessToken(userId, role, 300, 0, Math.floor(Date.now() / 1000))).token;
}

const ctx = <T>(params: T) => ({ params: Promise.resolve(params) });

describeInt("P1-10 görsel zekâ & çok-modlu arama (integration)", () => {
  const prisma = new PrismaClient();
  const country = `VIS${Date.now().toString(36)}`;
  let a: StayFixture;
  let b: StayFixture;
  let c: StayFixture;
  let original: Buffer;

  async function upload(fx: StayFixture, image: Buffer, propertyId = fx.propertyId) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(image)], { type: "image/png" }), "foto.png");
    const req = new NextRequest(`http://localhost/api/host/properties/${propertyId}/photos`, {
      method: "POST",
      headers: { authorization: `Bearer ${await tokenFor(fx.hostId, "HOST")}` },
      body: form,
    });
    const res = await photosRoute.POST(req, ctx({ id: propertyId }));
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    process.env.VISION_CLIP_ENABLED = "true";
    resetConfigForTests();
    setImageEmbedderForTests(createStubImageEmbedder());
    [a, b, c] = await Promise.all(
      ["vis-a", "vis-b", "vis-c"].map((tag) => createStayFixture(prisma, { tag, country, days: 1 }))
    );
    original = await patternImage(1, { width: 512, height: 384, format: "png" });
  });

  afterAll(async () => {
    delete process.env.VISION_CLIP_ENABLED;
    resetConfigForTests();
    setImageEmbedderForTests(undefined);
    await prisma.$disconnect();
  });

  it("yükleme: normalize WebP, kalite skoru, pHash, stub embedding; görsel herkese açık URL'de", async () => {
    const res = await upload(a, original);
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([]);
    expect(res.body.duplicate).toBeNull();
    expect(res.body.photo.embedded).toBe(true);
    expect(res.body.visual).toMatchObject({ enabled: true, reason: null });
    expect(res.body.photo.pHash).toMatch(/^[0-9a-f]{16}$/);
    expect(res.body.photo.quality.qualityScore).toBeGreaterThan(0.35);

    const row = await prisma.propertyPhoto.findUniqueOrThrow({ where: { id: res.body.photo.id } });
    expect(row.embeddingModel).toBe(STUB_MODEL_ID);
    const prop = await prisma.property.findUniqueOrThrow({ where: { id: a.propertyId } });
    expect(prop.images).toContain(`/api/photos/${row.id}`);

    const img = await publicPhoto.GET(
      new NextRequest(`http://localhost/api/photos/${row.id}`),
      ctx({ id: row.id })
    );
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).format).toBe("webp");
  });

  it("KK: aynı fotoğrafın yeniden boyutlandırılmış kopyası duplikat uyarısı verir (yükleme engellenmez)", async () => {
    const copy = await sharp(original).resize(300).jpeg({ quality: 70 }).toBuffer();
    const same = await upload(a, copy);
    expect(same.status).toBe(201);
    expect(same.body.warnings).toContain("DUPLICATE");
    expect(same.body.duplicate).toMatchObject({ scope: "SAME_PROPERTY", propertyId: a.propertyId });
    expect(same.body.duplicate.distance).toBeLessThanOrEqual(8);
    const row = await prisma.propertyPhoto.findUniqueOrThrow({ where: { id: same.body.photo.id } });
    expect(row.duplicateOfId).toBe(same.body.duplicate.photoId);

    // Başka host'un ilanında aynı fotoğraf: uyarı var, o ilanın kimliği sızdırılmaz.
    const other = await upload(c, copy);
    expect(other.body.duplicate).toEqual({ scope: "OTHER_LISTING", distance: expect.any(Number) });

    // Silme: kayıt ve `images` girdisi gider.
    const del = await photoRoute.DELETE(
      new NextRequest("http://localhost/x", {
        method: "DELETE",
        headers: { authorization: `Bearer ${await tokenFor(c.hostId, "HOST")}` },
      }),
      ctx({ id: c.propertyId, photoId: other.body.photo.id })
    );
    expect(del.status).toBe(200);
    const prop = await prisma.property.findUniqueOrThrow({ where: { id: c.propertyId } });
    expect(prop.images).not.toContain(`/api/photos/${other.body.photo.id}`);
  });

  it("düşük kalite uyarısı; başkasının ilanına yükleme 404; geçersiz dosya 400", async () => {
    const dark = await upload(b, await solidImage(3, 400, 300));
    expect(dark.status).toBe(201);
    expect(dark.body.warnings).toContain("LOW_QUALITY");
    await prisma.propertyPhoto.delete({ where: { id: dark.body.photo.id } });

    const foreign = await upload(b, original, a.propertyId);
    expect(foreign.status).toBe(404);
    const bad = await upload(b, Buffer.from("bu bir görsel değil"));
    expect(bad.status).toBe(400);
  });

  it("arama: similarToPhotoId görsel kNN listesi RRF'ye girer; kaynak ilan ve benzemeyenler dışarıda", async () => {
    const source = await prisma.propertyPhoto.findFirstOrThrow({
      where: { propertyId: a.propertyId, duplicateOfId: null },
    });
    // b: aynı sahnenin kırpılmış hâli (pHash duplikat değil, görsel olarak benzer); c: farklı sahne.
    const crop = await sharp(original)
      .extract({ left: 40, top: 30, width: 432, height: 324 })
      .png()
      .toBuffer();
    const similar = await upload(b, crop);
    expect(similar.body.duplicate).toBeNull();
    await upload(c, await patternImage(2, { width: 512, height: 384 }));

    const res = await searchProperties({ country, similarToPhotoId: source.id });
    expect(res.visual).toMatchObject({ enabled: true, applied: true });
    expect(res.semantic).toBe(true);
    expect(res.results.map((r) => r.id)).toEqual([b.propertyId]);
    expect(res.results[0]!.coverPhotoId).toBe(similar.body.photo.id);

    // Metin + görsel: görsel kanalda olan ilan RRF'de öne geçer.
    const plain = await searchProperties({ country });
    expect(plain.results).toHaveLength(3);
    const covers = new Map(plain.results.map((r) => [r.id, r.coverPhotoId]));
    expect(covers.get(a.propertyId)).toBe(source.id);
  });

  it("bayrak kapalı: görsel kanal uygulanmaz, yanıt nedenini açıklar", async () => {
    process.env.VISION_CLIP_ENABLED = "false";
    resetConfigForTests();
    try {
      const source = await prisma.propertyPhoto.findFirstOrThrow({
        where: { propertyId: a.propertyId },
      });
      const res = await searchProperties({ country, similarToPhotoId: source.id });
      expect(res.visual).toMatchObject({ enabled: false, applied: false, reason: "FLAG_OFF" });
      expect(res.visual!.message).toContain("VISION_CLIP_ENABLED");
      expect(res.results).toHaveLength(3);
      expect(res.results.every((r) => r.coverPhotoId === undefined)).toBe(true);

      // Kalite + duplikat bayraktan bağımsız; embedding yazılmaz.
      const up = await upload(c, await patternImage(9, { width: 320, height: 240 }));
      expect(up.status).toBe(201);
      expect(up.body.photo.embedded).toBe(false);
      expect(up.body.visual).toMatchObject({ enabled: false, reason: "FLAG_OFF" });
    } finally {
      process.env.VISION_CLIP_ENABLED = "true";
      resetConfigForTests();
    }
  });
});

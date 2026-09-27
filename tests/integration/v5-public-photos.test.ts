import { it, expect, afterAll } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture } from "./fixtures";
import * as publicPhoto from "@/app/api/photos/[id]/route";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());

describeInt("regression: v5#7 ilan fotoğrafı anonim erişim (integration)", () => {
  it("aktif ilanın görseli (erişilebilirlik kanıtı dahil) anonim 200; pasif ilan 404", async () => {
    const stay = await createStayFixture(prisma, { tag: `v5-7-${Date.now().toString(36)}` });
    const data = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#3366aa" },
    })
      .webp()
      .toBuffer();
    const photo = await prisma.propertyPhoto.create({
      data: {
        propertyId: stay.propertyId,
        contentType: "image/webp",
        data,
        width: 32,
        height: 24,
        byteSize: data.byteLength,
      },
    });
    const get = () =>
      publicPhoto.GET(new NextRequest(`http://localhost/api/photos/${photo.id}`), {
        params: Promise.resolve({ id: photo.id }),
      });

    const ok = await get();
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("cache-control")).toContain("public");

    await prisma.property.update({ where: { id: stay.propertyId }, data: { isActive: false } });
    expect((await get()).status).toBe(404);
  });
});

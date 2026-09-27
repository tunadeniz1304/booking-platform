import { it, expect, afterAll, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { createStayFixture } from "./fixtures";
import { signAccessToken } from "@/lib/auth/tokens";
import { resetConfigForTests } from "@/lib/config/app-config";
import { MULTIPART_OVERHEAD_BYTES } from "@/lib/http/body-limit";
import * as photosRoute from "@/app/api/host/properties/[id]/photos/route";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
afterEach(() => {
  delete process.env.VISION_MAX_UPLOAD_BYTES;
  resetConfigForTests();
});

describeInt("regression: v5#11 yükleme route'ları chunked gövdeyi sınırlar (integration)", () => {
  it("host fotoğraf yükleme: content-length'siz 2× sınır gövde → 413", async () => {
    process.env.VISION_MAX_UPLOAD_BYTES = "10000";
    resetConfigForTests();
    const fx = await createStayFixture(prisma, { tag: `v5-11-${Date.now().toString(36)}` });
    const token = (await signAccessToken(fx.hostId, "HOST", 300, 0, Math.floor(Date.now() / 1000)))
      .token;
    const total = 2 * (10000 + MULTIPART_OVERHEAD_BYTES);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= total) return controller.close();
        sent += 4096;
        controller.enqueue(new Uint8Array(4096).fill(97));
      },
    });
    const req = new NextRequest(`http://localhost/api/host/properties/${fx.propertyId}/photos`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "multipart/form-data; boundary=----v511",
      },
      body,
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1] & { duplex: "half" });
    const res = await photosRoute.POST(req, { params: Promise.resolve({ id: fx.propertyId }) });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("PAYLOAD_TOO_LARGE");
    expect(sent).toBeLessThan(total);
  });
});

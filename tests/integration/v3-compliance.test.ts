import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { updateProperty } from "@/lib/host/host-service";
import { searchProperties, invalidateSearchCache } from "@/lib/search";
import { buildSdepRows, sdepRowSchema, toSdepCsv, SDEP_HEADER } from "@/lib/compliance/sdep";
import type { AccessClaims } from "@/lib/auth";
import { GET as propertyGet } from "@/app/api/properties/[id]/route";
import { computeTotal } from "@/lib/pricing/quote";
import { createBooking } from "@/lib/booking-service";

/**
 * P1-10 belge/kayıt no (TR 7565, AB 2024/1028): doğrulanmamış ilan yayınlanamaz ve
 * aramada görünmez; SDEP aylık dışa aktarımı yalnızca toplam içerir.
 */
describeInt("P1-10 lisans doğrulama + SDEP (integration)", () => {
  const prisma = new PrismaClient();
  let fx: StayFixture;
  let host: AccessClaims;
  let city = "";

  beforeAll(async () => {
    fx = await createStayFixture(prisma, { tag: "lic", days: 40 });
    host = { userId: fx.hostId, role: "HOST" } as AccessClaims;
    const p = await prisma.property.findUniqueOrThrow({
      where: { id: fx.propertyId },
      select: { location: { select: { city: true } } },
    });
    city = p.location.city;
  });
  afterAll(() => prisma.$disconnect());

  async function visibleInSearch(): Promise<boolean> {
    await invalidateSearchCache();
    const res = await searchProperties({ city });
    return res.results.some((r) => r.id === fx.propertyId);
  }

  it("belgesiz ilan yayınlanamaz; kayıtta bulunmayan numara REJECTED ve yayından iner", async () => {
    await expect(updateProperty(host, fx.propertyId, { isActive: true })).rejects.toThrow(
      /Belge numarası/
    );
    const rejected = await updateProperty(host, fx.propertyId, { licenseNumber: "34-00000" });
    expect(rejected.licenseStatus).toBe("REJECTED");
    expect(rejected.isActive).toBe(false);
    await expect(updateProperty(host, fx.propertyId, { isActive: true })).rejects.toThrow(
      /Doğrulanmamış/
    );
    const verified = await updateProperty(host, fx.propertyId, {
      licenseNumber: "34-12345",
      isActive: true,
    });
    expect(verified).toMatchObject({ licenseStatus: "VERIFIED", isActive: true });
    expect(await visibleInSearch()).toBe(true);
  });

  it("regression: v3#25 aktif ama doğrulanmamış (PENDING) ilan aramada görünmez", async () => {
    await prisma.property.update({
      where: { id: fx.propertyId },
      data: { isActive: true, licenseStatus: "PENDING" },
    });
    expect(await visibleInSearch()).toBe(false);
    await prisma.property.update({
      where: { id: fx.propertyId },
      data: { licenseStatus: "VERIFIED" },
    });
    expect(await visibleInSearch()).toBe(true);
  });

  it("regression: v3#26 doğrulanmamış ilan detay API'si 404, teklif ve rezervasyon reddedilir", async () => {
    const detail = () =>
      propertyGet(new Request(`http://t/api/properties/${fx.propertyId}`), {
        params: Promise.resolve({ id: fx.propertyId }),
      });
    const stay = { checkIn: iso(utcDay(20)), checkOut: iso(utcDay(22)) };
    const quote = () =>
      computeTotal({ roomId: fx.roomId, propertyId: fx.propertyId, guests: 1, ...stay });
    const book = () =>
      createBooking({
        userId: fx.userId,
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        guestCount: 1,
        ...stay,
      });

    for (const licenseStatus of ["PENDING", "REJECTED"] as const) {
      await prisma.property.update({
        where: { id: fx.propertyId },
        data: { isActive: true, licenseStatus },
      });
      expect((await detail()).status).toBe(404);
      await expect(quote()).rejects.toMatchObject({ status: 404 });
      await expect(book()).rejects.toMatchObject({ status: 404 });
    }

    await prisma.property.update({
      where: { id: fx.propertyId },
      data: { licenseStatus: "VERIFIED" },
    });
    expect((await detail()).status).toBe(200);
    await expect(quote()).resolves.toMatchObject({ propertyId: fx.propertyId });
  });

  it("SDEP: kayıt no başına gece/misafir toplamı, şemaya uygun CSV", async () => {
    const bookingStart = utcDay(5);
    const period = `${bookingStart.getUTCFullYear()}-${String(bookingStart.getUTCMonth() + 1).padStart(2, "0")}`;
    const b = await fx.hold({ nights: 2, startInDays: 5 });
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CONFIRMED" } });
    const rows = await buildSdepRows(period);
    const mine = rows.find((r) => r.registration_number === "34-12345");
    expect(mine).toBeDefined();
    for (const r of rows) expect(sdepRowSchema.safeParse(r).success).toBe(true);
    expect(mine!.stays).toBeGreaterThanOrEqual(1);
    expect(mine!.guests).toBeGreaterThanOrEqual(1);
    const csv = toSdepCsv(rows);
    expect(csv.split("\n")[0]).toBe(SDEP_HEADER.join(","));
    expect(csv).not.toMatch(/@t\.test/); // kişisel veri yok
  });
});

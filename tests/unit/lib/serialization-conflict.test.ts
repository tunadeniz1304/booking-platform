import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { isSerializationFailure } from "@/lib/db/serialization";
import { backoffMs } from "@/lib/db/transactions";
import { toErrorResponse } from "@/lib/http/errors";
import { parseAppConfig } from "@/lib/config/app-config";

const p2034 = () =>
  new Prisma.PrismaClientKnownRequestError(
    "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
    { code: "P2034", clientVersion: "5.22.0" }
  );

describe("k6 payment-race bulgusu: eşzamanlı ödeme onayında serileştirme çakışması 500 dönmez", () => {
  it("P2034, meta 40001 ve 'could not serialize access' serileştirme hatasıdır", () => {
    expect(isSerializationFailure(p2034())).toBe(true);
    expect(
      isSerializationFailure(
        new Prisma.PrismaClientKnownRequestError("x", {
          code: "P2010",
          clientVersion: "5.22.0",
          meta: { code: "40001" },
        })
      )
    ).toBe(true);
    expect(isSerializationFailure(new Error("could not serialize access due to"))).toBe(true);
    expect(isSerializationFailure(new Error("başka hata"))).toBe(false);
    expect(isSerializationFailure(undefined)).toBe(false);
  });

  it("denemeler tükenince yanıt 409 TRANSACTION_CONFLICT + Retry-After (500 değil)", async () => {
    const res = toErrorResponse(p2034(), "bookings.pay");
    expect(res.status).toBe(409);
    expect(res.headers.get("Retry-After")).toBe("1");
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("TRANSACTION_CONFLICT");
    expect(body.error).not.toMatch(/deadlock|Prisma/i);
  });

  it("geri çekilme üstel ve rastgele pay [0, adım) aralığında", () => {
    expect(backoffMs(1, 15, () => 0)).toBe(15);
    expect(backoffMs(3, 15, () => 0)).toBe(60);
    expect(backoffMs(3, 15, () => 0.999)).toBe(119);
  });

  it("deneme sayısı ve taban yapılandırılabilir; varsayılanlar 6 / 15 ms", () => {
    const def = parseAppConfig({});
    expect(def.DB_SERIALIZABLE_RETRY_ATTEMPTS).toBe(6);
    expect(def.DB_SERIALIZABLE_RETRY_BASE_MS).toBe(15);
    const custom = parseAppConfig({
      DB_SERIALIZABLE_RETRY_ATTEMPTS: "10",
      DB_SERIALIZABLE_RETRY_BASE_MS: "5",
    });
    expect(custom.DB_SERIALIZABLE_RETRY_ATTEMPTS).toBe(10);
    expect(custom.DB_SERIALIZABLE_RETRY_BASE_MS).toBe(5);
  });
});

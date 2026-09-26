// test-stabilization (c)3: addCartItem READ COMMITTED + sepet satır kilidi.
// (1) farklı kullanıcıların eşzamanlı eklemeleri sahte serileştirme çakışması (P2034 /
// TRANSACTION_CONFLICT) üretmez; (2) aynı sepete eşzamanlı eklemelerde CART_MAX_ITEMS aşılmaz.
import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { describeInt, iso, utcDay } from "./helpers";
import { createStayFixture, type StayFixture } from "./fixtures";
import { addCartItem } from "@/lib/cart";
import { resetConfigForTests } from "@/lib/config/app-config";
import { HttpError } from "@/lib/http/errors";

describeInt("addCartItem eşzamanlılığı (READ COMMITTED + satır kilidi)", () => {
  const prisma = new PrismaClient();
  const previousMax = process.env.CART_MAX_ITEMS;
  let fx: StayFixture;
  let seq = 0;

  beforeAll(async () => {
    process.env.CART_MAX_ITEMS = "3";
    resetConfigForTests();
    fx = await createStayFixture(prisma, { tag: "cart-add-rc", units: 50 });
  });
  afterAll(async () => {
    if (previousMax === undefined) delete process.env.CART_MAX_ITEMS;
    else process.env.CART_MAX_ITEMS = previousMax;
    resetConfigForTests();
    await prisma.$disconnect();
  });

  async function newUser(): Promise<string> {
    const u = await prisma.user.create({
      data: {
        email: `cart-add-rc-${Date.now()}-${++seq}@t.test`,
        passwordHash: "x",
        firstName: "Sepet",
        lastName: "Test",
        emailVerifiedAt: new Date(),
      },
    });
    return u.id;
  }

  function item(start: number) {
    return {
      propertyId: fx.propertyId,
      roomTypeId: fx.roomId,
      checkIn: iso(utcDay(start)),
      checkOut: iso(utcDay(start + 1)),
      adults: 1,
      children: 0,
      quantity: 1,
    };
  }

  it("20 farklı kullanıcının eşzamanlı ilk kalem eklemesi hepsi başarılı (P2034 yok)", async () => {
    const users: string[] = [];
    for (let i = 0; i < 20; i++) users.push(await newUser());
    // Sepetler sırayla açılır; ikinci kalem eklemesi eşzamanlı (asıl ölçülen adım).
    for (const u of users) await addCartItem(u, item(10));

    const results = await Promise.allSettled(users.map((u) => addCartItem(u, item(12))));
    const failures = results.filter((r) => r.status === "rejected");
    expect(failures.map((f) => (f as PromiseRejectedResult).reason?.code)).toEqual([]);
    const counts = await prisma.cartItem.groupBy({
      by: ["cartId"],
      where: { cart: { userId: { in: users } } },
      _count: { _all: true },
    });
    expect(counts).toHaveLength(20);
    for (const c of counts) expect(c._count._all).toBe(2);
  });

  it("aynı sepete 8 eşzamanlı ekleme: en fazla CART_MAX_ITEMS (3) kalem, fazlası 400", async () => {
    const user = await newUser();
    await addCartItem(user, item(20));

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => addCartItem(user, item(22 + i * 2)))
    );
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(HttpError);
        expect((r.reason as HttpError).status).toBe(400);
      }
    }
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const n = await prisma.cartItem.count({ where: { cart: { userId: user } } });
    expect(n).toBe(3);
  });
});

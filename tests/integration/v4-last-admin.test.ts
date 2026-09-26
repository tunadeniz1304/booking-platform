import { afterAll, beforeAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { describeInt } from "./helpers";
import { PATCH as changeRole } from "@/app/api/admin/users/[id]/role/route";
import { signAccessToken } from "@/lib/auth/tokens";

describeInt("regression: v4#17 son ADMIN düşürülemez", () => {
  const prisma = new PrismaClient();
  const stamp = Date.now();
  let parked: string[] = [];

  beforeAll(async () => {
    // Sayım bu testin iki yöneticisiyle sınırlı kalsın: diğer ADMIN'ler geçici olarak USER.
    const others = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    parked = others.map((u) => u.id);
    await prisma.user.updateMany({ where: { id: { in: parked } }, data: { role: "USER" } });
  });

  afterAll(async () => {
    await prisma.user.updateMany({ where: { id: { in: parked } }, data: { role: "ADMIN" } });
    await prisma.$disconnect();
  });

  async function admin(tag: string) {
    return prisma.user.create({
      data: {
        email: `v4-17-${tag}-${stamp}@t.test`,
        passwordHash: "x",
        firstName: "A",
        lastName: "D",
        role: "ADMIN",
      },
    });
  }

  async function demote(actorId: string, targetId: string) {
    const { token } = await signAccessToken(actorId, "ADMIN", 300);
    return changeRole(
      new NextRequest(`http://localhost:3000/api/admin/users/${targetId}/role`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ role: "USER" }),
      }),
      { params: Promise.resolve({ id: targetId }) }
    );
  }

  it("iki yönetici eşzamanlı birbirini düşürürse biri 409 LAST_ADMIN alır", async () => {
    const a = await admin("a");
    const b = await admin("b");
    const [r1, r2] = await Promise.all([demote(a.id, b.id), demote(b.id, a.id)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const failed = r1.status === 409 ? r1 : r2;
    expect(((await failed.json()) as { code: string }).code).toBe("LAST_ADMIN");
    const remaining = await prisma.user.count({
      where: { id: { in: [a.id, b.id] }, role: "ADMIN" },
    });
    expect(remaining).toBe(1);
  });
});

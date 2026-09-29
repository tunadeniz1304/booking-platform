import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireVerifiedEmail: vi.fn() }));
vi.mock("@/lib/payment/rnpl", () => ({ getRnplOffer: vi.fn() }));

import { GET, dynamic } from "@/app/api/bookings/[id]/rnpl/route";
import { requireVerifiedEmail } from "@/lib/auth";
import { getRnplOffer } from "@/lib/payment/rnpl";
import { NotFoundError, UnauthorizedError } from "@/lib/http/errors";

const req = () => new NextRequest("http://localhost/api/bookings/b1/rnpl");
const ctx = { params: Promise.resolve({ id: "b1" }) };

describe("P1-3 GET /api/bookings/[id]/rnpl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dinamik route olarak işaretlidir", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("doğrulanmış sahibe teklifi döner", async () => {
    vi.mocked(requireVerifiedEmail).mockResolvedValue({ userId: "u1" } as never);
    vi.mocked(getRnplOffer).mockResolvedValue({ eligible: true } as never);
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ eligible: true });
    expect(getRnplOffer).toHaveBeenCalledWith("b1", "u1");
  });

  it("kimlik doğrulama hatasını 401'e eşler", async () => {
    vi.mocked(requireVerifiedEmail).mockRejectedValue(new UnauthorizedError());
    const res = await GET(req(), ctx);
    expect(res.status).toBe(401);
    expect(getRnplOffer).not.toHaveBeenCalled();
  });

  it("alan hatasını durum koduna eşler", async () => {
    vi.mocked(requireVerifiedEmail).mockResolvedValue({ userId: "u1" } as never);
    vi.mocked(getRnplOffer).mockRejectedValue(new NotFoundError());
    const res = await GET(req(), ctx);
    expect(res.status).toBe(404);
  });
});

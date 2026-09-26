import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/http/errors";
import { observed } from "@/lib/http/observed";
import { getWallet } from "@/lib/wallet/wallet-service";

/** Cüzdan (P1-7): seviye, para birimi başına kullanılabilir kredi, lot'lar ve bekleyen cashback. */
export const GET = observed("account.wallet", async function getHandler(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    return NextResponse.json(await getWallet(userId));
  } catch (error) {
    return toErrorResponse(error, "account.wallet");
  }
});

export const dynamic = "force-dynamic";

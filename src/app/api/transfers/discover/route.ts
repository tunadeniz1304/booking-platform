import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http/errors";
import { discoverTransfers } from "@/lib/transfer/transfer-service";

/** Public keşif listesi (satıcı adı maskeli, token yok). */
export async function GET() {
  try {
    return NextResponse.json(await discoverTransfers());
  } catch (error) {
    return toErrorResponse(error, "transfers.discover");
  }
}

export const dynamic = "force-dynamic";

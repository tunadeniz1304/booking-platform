import { NextResponse } from "next/server";
import { selectPaymentProvider } from "@/lib/payment";

/**
 * İstemcinin hangi ödeme formunu göstereceği (#10): `stripe` + yayımlanabilir anahtar varsa
 * Payment Element, aksi hâlde mock hosted fields. Yalnızca herkese açık bilgi döner.
 */
export async function GET() {
  let provider: "stripe" | "mock" = "mock";
  try {
    provider = selectPaymentProvider();
  } catch {
    provider = "mock";
  }
  const publishableKey = provider === "stripe" ? process.env.STRIPE_PUBLISHABLE_KEY || null : null;
  return NextResponse.json({ provider: publishableKey ? provider : "mock", publishableKey });
}

export const dynamic = "force-dynamic";

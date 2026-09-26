import { signMandate, type IssueMandateInput } from "@/lib/agentic/mandate";

/** Test yardımcısı: oturum için geniş limitli AP2 mandate'i + SPT (P1-11). */
export async function mandated(
  userId: string,
  session: { currency: string },
  token: string,
  overrides: Partial<IssueMandateInput> = {}
): Promise<{ token: string; mandate: string }> {
  const { mandate } = await signMandate(userId, {
    maxAmountMinor: 1_000_000_000,
    currency: session.currency,
    ...overrides,
  });
  return { token, mandate };
}

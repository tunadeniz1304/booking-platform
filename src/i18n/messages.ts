import type { Locale } from "./config";

/**
 * Mesaj ad alanları: her biri `messages/<locale>/<ad>.json` dosyasıdır. Yeni bir dosya
 * eklendiğinde buraya da yazılır; `scripts/i18n-check.ts` ve birim testi listeyle dizinin
 * ve iki dilin anahtar kümelerinin birebir örtüştüğünü doğrular.
 */
export const NAMESPACES = [
  "account",
  "admin",
  "auth",
  "booking",
  "cart",
  "chat",
  "checkout",
  "common",
  "compare",
  "compliance",
  "cookie",
  "footer",
  "home",
  "host",
  "locale",
  "mailbox",
  "nav",
  "payment",
  "payouts",
  "plan",
  "privacy",
  "property",
  "pwa",
  "quote",
  "ranking",
  "revenue",
  "reviews",
  "search",
  "transfers",
  "trust",
] as const;

export type Namespace = (typeof NAMESPACES)[number];
export type Messages = Record<Namespace, Record<string, unknown>>;

/** Bir dilin tüm ad alanlarını tek mesaj nesnesinde birleştirir. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  const entries = await Promise.all(
    NAMESPACES.map(
      async (ns) => [ns, (await import(`../../messages/${locale}/${ns}.json`)).default] as const
    )
  );
  return Object.fromEntries(entries) as Messages;
}

/**
 * Demo / production ayrımı (P0-9, v3#11).
 *
 * `DEMO_MODE=true` → bilinen parolalı demo hesaplar seed'lenebilir, `/dev/mailbox`
 * açıktır, MockPsp varsayılan ödeme sağlayıcısıdır ve arayüzde "DEMO" rozeti görünür.
 * `DEMO_MODE=false` → seed reddedilir, mailbox 404, MockPsp yalnızca açık
 * `PAYMENT_PROVIDER=mock` ile. Değişken hiç verilmemişse production dışı ortamlar
 * (yerel geliştirme, test) demo, production ise demo DEĞİL sayılır (güvenli varsayılan).
 */
export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.DEMO_MODE?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return env.NODE_ENV !== "production";
}

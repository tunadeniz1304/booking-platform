import { getConfig } from "@/lib/config/app-config";

/**
 * Web Push ayarları (P1-12). VAPID anahtarlarından biri eksik ya da konu (`VAPID_SUBJECT`)
 * `mailto:`/`https:` değilse push KAPALIDIR: abonelik API'si 503 döner, iş parçacıkları
 * hiçbir şey göndermez ve arayüz nedenini açıklar. Dış servis olmadan uygulama tam çalışır.
 */
export type PushDisabledReason = "VAPID_MISSING" | "VAPID_SUBJECT_INVALID";

export type PushSettings =
  | {
      enabled: true;
      publicKey: string;
      privateKey: string;
      subject: string;
    }
  | { enabled: false; reason: PushDisabledReason };

export function getPushSettings(): PushSettings {
  const cfg = getConfig();
  const publicKey = cfg.VAPID_PUBLIC_KEY.trim();
  const privateKey = cfg.VAPID_PRIVATE_KEY.trim();
  const subject = cfg.VAPID_SUBJECT.trim();
  if (!publicKey || !privateKey || !subject) return { enabled: false, reason: "VAPID_MISSING" };
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    return { enabled: false, reason: "VAPID_SUBJECT_INVALID" };
  }
  return { enabled: true, publicKey, privateKey, subject };
}

/** Abonelik uç noktası izinli bir push servisine mi ait? (sunucu bu adrese POST atar → SSRF). */
export function isAllowedPushEndpoint(endpoint: string, hostsCsv: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  return hostsCsv
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) =>
      rule.startsWith("*.")
        ? host.endsWith(rule.slice(1)) && host.length > rule.length - 1
        : host === rule
    );
}

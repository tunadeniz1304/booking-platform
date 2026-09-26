import type { AuthEmailRequestedPayload, PriceDroppedPayload } from "@/lib/events/events";
import { getConfig } from "@/lib/config/app-config";
import { sendEmail } from "./notifier";
import { openLink } from "@/lib/auth/link-crypto";
import { prisma } from "@/lib/prisma";
import { authLinkEmail, emailLocale, priceDropEmail, ttlLabel } from "./templates";

/** Alıcının kayıtlı dili (gönderim anında okunur; kullanıcı yoksa Türkçe). */
async function recipientLocale(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { locale: true } });
  return emailLocale(user?.locale);
}

/** Uygulamanın dışa açık kök adresi (e-posta bağlantıları için). */
function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Bağlantı yolu: şifreli bağlantı çözülür. Yükseltme anında kuyrukta kalmış eski
 * biçimli (ham `token`'lı) mesajlar da bir kez gönderilebilsin diye geriye uyumlu.
 */
function linkPath(p: AuthEmailRequestedPayload & { token?: string }): string {
  if (p.sealedLink) return openLink(p.sealedLink);
  const path = p.kind === "EMAIL_VERIFY" ? "/verify-email" : "/reset-password";
  return `${path}?token=${encodeURIComponent(p.token ?? "")}`;
}

/** Olay → doğrulama/sıfırlama e-postası (token başına tek e-posta: dedupeKey). */
export async function notifyAuthEmail(p: AuthEmailRequestedPayload) {
  const config = getConfig();
  const verify = p.kind === "EMAIL_VERIFY";
  const locale = await recipientLocale(p.userId);
  return sendEmail({
    dedupeKey: `auth.${p.kind.toLowerCase()}:${p.tokenId}`,
    userId: p.userId,
    to: p.to,
    content: authLinkEmail(
      {
        kind: p.kind,
        name: p.name,
        // Outbox'ta yalnızca şifreli bağlantı var; e-posta anında çözülür (v4#12).
        link: `${appBaseUrl()}${linkPath(p)}`,
        ttlLabel: verify
          ? ttlLabel(locale, "hours", config.AUTH_VERIFY_TOKEN_TTL_HOURS)
          : ttlLabel(locale, "minutes", config.AUTH_RESET_TOKEN_TTL_MINUTES),
      },
      locale
    ),
  });
}

/** Olay → fiyat düşüşü e-postası (alarm + gözlem günü başına tek e-posta). */
export async function notifyPriceDrop(p: PriceDroppedPayload) {
  const locale = await recipientLocale(p.userId);
  return sendEmail({
    dedupeKey: `price.dropped:${p.alertId}:${p.observedOn}`,
    userId: p.userId,
    to: p.to,
    content: priceDropEmail(
      {
        name: p.name,
        propertyTitle: p.propertyTitle,
        roomName: p.roomName,
        checkIn: p.checkIn,
        checkOut: p.checkOut,
        currency: p.currency,
        previousMinor: p.previousMinor,
        currentMinor: p.currentMinor,
        omnibusDays: getConfig().PRICE_OMNIBUS_DAYS,
        link: `${appBaseUrl()}/property/${encodeURIComponent(p.propertyId)}?checkIn=${p.checkIn}&checkOut=${p.checkOut}`,
      },
      locale
    ),
  });
}

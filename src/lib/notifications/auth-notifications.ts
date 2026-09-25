import type { AuthEmailRequestedPayload, PriceDroppedPayload } from "@/lib/events/events";
import { getConfig } from "@/lib/config/app-config";
import { sendEmail } from "./notifier";
import { authLinkEmail, priceDropEmail } from "./templates";

/** Uygulamanın dışa açık kök adresi (e-posta bağlantıları için). */
function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Olay → doğrulama/sıfırlama e-postası (token başına tek e-posta: dedupeKey). */
export async function notifyAuthEmail(p: AuthEmailRequestedPayload) {
  const config = getConfig();
  const verify = p.kind === "EMAIL_VERIFY";
  const path = verify ? "/verify-email" : "/reset-password";
  return sendEmail({
    dedupeKey: `auth.${p.kind.toLowerCase()}:${p.tokenId}`,
    userId: p.userId,
    to: p.to,
    content: authLinkEmail({
      kind: p.kind,
      name: p.name,
      link: `${appBaseUrl()}${path}?token=${encodeURIComponent(p.token)}`,
      ttlLabel: verify
        ? `${config.AUTH_VERIFY_TOKEN_TTL_HOURS} saat`
        : `${config.AUTH_RESET_TOKEN_TTL_MINUTES} dakika`,
    }),
  });
}

/** Olay → fiyat düşüşü e-postası (alarm + gözlem günü başına tek e-posta). */
export async function notifyPriceDrop(p: PriceDroppedPayload) {
  return sendEmail({
    dedupeKey: `price.dropped:${p.alertId}:${p.observedOn}`,
    userId: p.userId,
    to: p.to,
    content: priceDropEmail({
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
    }),
  });
}

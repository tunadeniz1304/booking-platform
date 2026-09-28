import type { RnplChargeFailedPayload } from "@/lib/events/events";
import { prisma } from "@/lib/prisma";
import { createFormatter } from "@/lib/i18n/format";
import { sendEmail } from "./notifier";
import { emailLocale, escapeHtml, type EmailContent, type EmailLocale } from "./templates";

/**
 * P1-3 RNPL: zamanlanmış tahsilat başarısız → misafire ek süre bildirimi (outbox tüketicisi).
 * dedupeKey deneme başına: yeniden teslimde tek e-posta, her başarısız denemede bir e-posta.
 */

const COPY = {
  tr: {
    subject: "Rezervasyonunuzun ödemesi alınamadı",
    line: (amount: string, cancelAt: string) =>
      `Kayıtlı kartınızdan ${amount} tahsil edilemedi. Yeniden deneyeceğiz; ${cancelAt} tarihine kadar ödeme alınamazsa rezervasyonunuz otomatik olarak iptal edilir. Kartınızı kontrol edin ya da rezervasyon sayfasından şimdi ödeyin.`,
    link: "Rezervasyon",
    footer: "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek konaklama satılmaz.",
  },
  en: {
    subject: "We could not charge your booking",
    line: (amount: string, cancelAt: string) =>
      `We could not charge ${amount} to your saved card. We will retry; if payment is not received by ${cancelAt}, your booking is cancelled automatically. Please check your card or pay now from the booking page.`,
    link: "Booking",
    footer: "This email was sent by a portfolio/demo project; no real stays are sold.",
  },
} as const;

function render(locale: EmailLocale, p: RnplChargeFailedPayload): EmailContent {
  const c = COPY[locale];
  const f = createFormatter(locale);
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  const url = `${base}/booking/${encodeURIComponent(p.bookingId)}`;
  const line = c.line(f.money(p.amountMinor, p.currency), f.date(p.cancelAt, "long"));
  const text = [line, "", `${c.link}: ${url}`, "", c.footer].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#111">
<p>${escapeHtml(line)}</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(c.link)}</a></p>
<p style="color:#666;font-size:12px">${escapeHtml(c.footer)}</p>
</body></html>`;
  return { subject: c.subject, text, html };
}

export async function notifyRnplChargeFailed(p: RnplChargeFailedPayload) {
  const user = await prisma.user.findUnique({
    where: { id: p.userId },
    select: { id: true, email: true, locale: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return "missing" as const;
  return sendEmail({
    dedupeKey: `rnpl.charge_failed:${p.scheduleId}:${p.attempt}`,
    userId: user.id,
    to: user.email,
    content: render(emailLocale(user.locale), p),
  });
}

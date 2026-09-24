import { formatMoney, money } from "@/lib/money/money";

/**
 * Türkçe e-posta şablonları (saf fonksiyonlar). HTML'e giren tüm kullanıcı verisi
 * kaçışlanır (e-posta istemcisinde XSS/HTML enjeksiyonu yok).
 */

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function trDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface BookingInfo {
  guestName: string;
  propertyTitle: string;
  city: string;
  checkIn: string;
  checkOut: string;
  bookingId: string;
}

function layout(title: string, lines: string[], footer: string): { text: string; html: string } {
  const text = [title, "", ...lines, "", footer].join("\n");
  const html = `<!doctype html><html lang="tr"><body style="font-family:Arial,sans-serif;color:#111">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>
</body></html>`;
  return { text, html };
}

const FOOTER =
  "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek ödeme alınmaz, gerçek konaklama satılmaz.";

export function bookingConfirmedEmail(
  b: BookingInfo & { totalMinor: number; currency: string }
): EmailContent {
  const subject = `Rezervasyonunuz onaylandı — ${b.propertyTitle}`;
  const body = layout(
    `Merhaba ${b.guestName}, rezervasyonunuz onaylandı!`,
    [
      `${b.propertyTitle} (${b.city})`,
      `Giriş: ${trDate(b.checkIn)} · Çıkış: ${trDate(b.checkOut)}`,
      `Ödenen tutar (vergiler dahil): ${formatMoney(money(b.totalMinor, b.currency))}`,
      `Rezervasyon no: ${b.bookingId}`,
    ],
    FOOTER
  );
  return { subject, ...body };
}

export function bookingCancelledEmail(
  b: BookingInfo & { refundMinor: number; currency: string }
): EmailContent {
  const subject = `Rezervasyonunuz iptal edildi — ${b.propertyTitle}`;
  const refund =
    b.refundMinor > 0
      ? `İade tutarı: ${formatMoney(money(b.refundMinor, b.currency))} (5–10 iş günü içinde kartınıza yansır).`
      : "İptal politikası gereği iade yapılmamaktadır.";
  const body = layout(
    `Merhaba ${b.guestName}, rezervasyonunuz iptal edildi.`,
    [
      `${b.propertyTitle} (${b.city})`,
      `Giriş: ${trDate(b.checkIn)} · Çıkış: ${trDate(b.checkOut)}`,
      refund,
      `Rezervasyon no: ${b.bookingId}`,
    ],
    FOOTER
  );
  return { subject, ...body };
}

export function bookingExpiredEmail(b: BookingInfo): EmailContent {
  const subject = `Ödeme süresi doldu — ${b.propertyTitle}`;
  const body = layout(
    `Merhaba ${b.guestName}, rezervasyon tutma süreniz doldu.`,
    [
      `${b.propertyTitle} için ${trDate(b.checkIn)} – ${trDate(b.checkOut)} tarihli tutma, ödeme tamamlanmadığı için serbest bırakıldı.`,
      "Oda hâlâ müsaitse yeniden rezervasyon yapabilirsiniz. Kartınızdan tahsilat yapılmadı.",
      `Rezervasyon no: ${b.bookingId}`,
    ],
    FOOTER
  );
  return { subject, ...body };
}

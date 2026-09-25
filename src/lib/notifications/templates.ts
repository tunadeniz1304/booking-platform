import { createFormatter } from "@/lib/i18n/format";

/**
 * İki dilli (tr/en) e-posta şablonları (P1-12; saf fonksiyonlar). Dil, alıcının kayıtlı
 * arayüz dilidir (`User.locale`); bilinmeyen dil Türkçeye düşer. HTML'e giren tüm kullanıcı
 * verisi kaçışlanır (e-posta istemcisinde XSS/HTML enjeksiyonu yok).
 */

export type EmailLocale = "tr" | "en";

export function emailLocale(value: string | null | undefined): EmailLocale {
  return value === "en" ? "en" : "tr";
}

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

interface BookingInfo {
  guestName: string;
  propertyTitle: string;
  city: string;
  checkIn: string;
  checkOut: string;
  bookingId: string;
}

function layout(
  locale: EmailLocale,
  title: string,
  lines: string[],
  footer: string
): { text: string; html: string } {
  const text = [title, "", ...lines, "", footer].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#111">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>
</body></html>`;
  return { text, html };
}

interface Fmt {
  date(iso: string): string;
  money(minor: number, currency: string): string;
}

function fmt(locale: EmailLocale): Fmt {
  const f = createFormatter(locale);
  return { date: (iso) => f.date(iso, "long"), money: (m, c) => f.money(m, c) };
}

/** Tüm e-posta metinleri; iki dil aynı anahtarlara sahiptir (tip ile zorlanır). */
interface Copy {
  footer: string;
  dates(f: Fmt, checkIn: string, checkOut: string): string;
  bookingNo(id: string): string;
  confirmedSubject(title: string): string;
  confirmedTitle(name: string): string;
  paid(amount: string): string;
  cancelledSubject(title: string): string;
  cancelledTitle(name: string): string;
  refund(amount: string): string;
  noRefund: string;
  expiredSubject(title: string): string;
  expiredTitle(name: string): string;
  expiredLine(title: string, checkIn: string, checkOut: string): string;
  expiredRetry: string;
  verifySubject: string;
  resetSubject: string;
  hello(name: string): string;
  verifyLine: string;
  resetLine: string;
  linkTtl(ttl: string): string;
  hours(h: number): string;
  minutes(m: number): string;
  dropSubject(title: string): string;
  dropTitle(name: string): string;
  newPrice(amount: string): string;
  previousPrice(days: number, amount: string): string;
}

const COPY: Record<EmailLocale, Copy> = {
  tr: {
    footer:
      "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek ödeme alınmaz, gerçek konaklama satılmaz.",
    dates: (f, i, o) => `Giriş: ${f.date(i)} · Çıkış: ${f.date(o)}`,
    bookingNo: (id) => `Rezervasyon no: ${id}`,
    confirmedSubject: (t) => `Rezervasyonunuz onaylandı — ${t}`,
    confirmedTitle: (n) => `Merhaba ${n}, rezervasyonunuz onaylandı!`,
    paid: (amount) => `Ödenen tutar (vergiler dahil): ${amount}`,
    cancelledSubject: (t) => `Rezervasyonunuz iptal edildi — ${t}`,
    cancelledTitle: (n) => `Merhaba ${n}, rezervasyonunuz iptal edildi.`,
    refund: (amount) => `İade tutarı: ${amount} (5–10 iş günü içinde kartınıza yansır).`,
    noRefund: "İptal politikası gereği iade yapılmamaktadır.",
    expiredSubject: (t) => `Ödeme süresi doldu — ${t}`,
    expiredTitle: (n) => `Merhaba ${n}, rezervasyon tutma süreniz doldu.`,
    expiredLine: (t, i, o) =>
      `${t} için ${i} – ${o} tarihli tutma, ödeme tamamlanmadığı için serbest bırakıldı.`,
    expiredRetry:
      "Oda hâlâ müsaitse yeniden rezervasyon yapabilirsiniz. Kartınızdan tahsilat yapılmadı.",
    verifySubject: "E-posta adresinizi doğrulayın",
    resetSubject: "Şifre sıfırlama bağlantınız",
    hello: (n) => `Merhaba ${n},`,
    verifyLine: "Hesabınızı etkinleştirmek için aşağıdaki bağlantıyı açın:",
    resetLine:
      "Şifrenizi sıfırlamak için aşağıdaki bağlantıyı açın. Bu isteği siz yapmadıysanız bu e-postayı yok sayın.",
    linkTtl: (ttl) => `Bağlantı tek kullanımlıktır ve ${ttl} geçerlidir.`,
    hours: (h) => `${h} saat`,
    minutes: (m) => `${m} dakika`,
    dropSubject: (t) => `Fiyat düştü — ${t}`,
    dropTitle: (n) => `Merhaba ${n}, izlediğiniz konaklamanın fiyatı düştü.`,
    newPrice: (amount) => `Yeni fiyat (vergiler dahil): ${amount}`,
    previousPrice: (days, amount) => `Önceki fiyat (son ${days} günün en düşüğü): ${amount}`,
  },
  en: {
    footer:
      "This email was sent by a portfolio/demo project; no real payments are taken and no real stays are sold.",
    dates: (f, i, o) => `Check-in: ${f.date(i)} · Check-out: ${f.date(o)}`,
    bookingNo: (id) => `Booking reference: ${id}`,
    confirmedSubject: (t) => `Your booking is confirmed — ${t}`,
    confirmedTitle: (n) => `Hello ${n}, your booking is confirmed!`,
    paid: (amount) => `Amount paid (taxes included): ${amount}`,
    cancelledSubject: (t) => `Your booking was cancelled — ${t}`,
    cancelledTitle: (n) => `Hello ${n}, your booking was cancelled.`,
    refund: (amount) =>
      `Refund amount: ${amount} (it will appear on your card within 5–10 business days).`,
    noRefund: "No refund is due under the cancellation policy.",
    expiredSubject: (t) => `Payment window expired — ${t}`,
    expiredTitle: (n) => `Hello ${n}, your booking hold has expired.`,
    expiredLine: (t, i, o) =>
      `The hold for ${t} from ${i} to ${o} was released because payment was not completed.`,
    expiredRetry:
      "If the room is still available you can book again. Your card has not been charged.",
    verifySubject: "Verify your email address",
    resetSubject: "Your password reset link",
    hello: (n) => `Hello ${n},`,
    verifyLine: "Open the link below to activate your account:",
    resetLine:
      "Open the link below to reset your password. If you did not request this, ignore this email.",
    linkTtl: (ttl) => `The link can be used once and is valid for ${ttl}.`,
    hours: (h) => `${h} ${h === 1 ? "hour" : "hours"}`,
    minutes: (m) => `${m} ${m === 1 ? "minute" : "minutes"}`,
    dropSubject: (t) => `Price drop — ${t}`,
    dropTitle: (n) => `Hello ${n}, the price of a stay you are watching has dropped.`,
    newPrice: (amount) => `New price (taxes included): ${amount}`,
    previousPrice: (days, amount) => `Previous price (lowest in the last ${days} days): ${amount}`,
  },
};

/** Bağlantı geçerlilik süresi etiketi (e-posta dilinde). */
export function ttlLabel(locale: EmailLocale, unit: "hours" | "minutes", value: number): string {
  return unit === "hours" ? COPY[locale].hours(value) : COPY[locale].minutes(value);
}

export function bookingConfirmedEmail(
  b: BookingInfo & { totalMinor: number; currency: string },
  locale: EmailLocale = "tr"
): EmailContent {
  const c = COPY[locale];
  const f = fmt(locale);
  const body = layout(
    locale,
    c.confirmedTitle(b.guestName),
    [
      `${b.propertyTitle} (${b.city})`,
      c.dates(f, b.checkIn, b.checkOut),
      c.paid(f.money(b.totalMinor, b.currency)),
      c.bookingNo(b.bookingId),
    ],
    c.footer
  );
  return { subject: c.confirmedSubject(b.propertyTitle), ...body };
}

export function bookingCancelledEmail(
  b: BookingInfo & { refundMinor: number; currency: string },
  locale: EmailLocale = "tr"
): EmailContent {
  const c = COPY[locale];
  const f = fmt(locale);
  const refund = b.refundMinor > 0 ? c.refund(f.money(b.refundMinor, b.currency)) : c.noRefund;
  const body = layout(
    locale,
    c.cancelledTitle(b.guestName),
    [
      `${b.propertyTitle} (${b.city})`,
      c.dates(f, b.checkIn, b.checkOut),
      refund,
      c.bookingNo(b.bookingId),
    ],
    c.footer
  );
  return { subject: c.cancelledSubject(b.propertyTitle), ...body };
}

export function bookingExpiredEmail(b: BookingInfo, locale: EmailLocale = "tr"): EmailContent {
  const c = COPY[locale];
  const f = fmt(locale);
  const body = layout(
    locale,
    c.expiredTitle(b.guestName),
    [
      c.expiredLine(b.propertyTitle, f.date(b.checkIn), f.date(b.checkOut)),
      c.expiredRetry,
      c.bookingNo(b.bookingId),
    ],
    c.footer
  );
  return { subject: c.expiredSubject(b.propertyTitle), ...body };
}

/** E-posta doğrulama / şifre sıfırlama bağlantısı (P0-8). */
export function authLinkEmail(
  input: {
    kind: "EMAIL_VERIFY" | "PASSWORD_RESET";
    name: string;
    link: string;
    ttlLabel: string;
  },
  locale: EmailLocale = "tr"
): EmailContent {
  const c = COPY[locale];
  const verify = input.kind === "EMAIL_VERIFY";
  const body = layout(
    locale,
    c.hello(input.name),
    [verify ? c.verifyLine : c.resetLine, input.link, c.linkTtl(input.ttlLabel)],
    c.footer
  );
  return { subject: verify ? c.verifySubject : c.resetSubject, ...body };
}

/**
 * Fiyat düşüşü (P1-4). "Önceki fiyat" Omnibus referansıdır: son N günün en düşük
 * gözlenen fiyatı (indirimden önceki tek bir yüksek fiyat değil).
 */
export function priceDropEmail(
  input: {
    name: string;
    propertyTitle: string;
    roomName: string;
    checkIn: string;
    checkOut: string;
    currency: string;
    previousMinor: number;
    currentMinor: number;
    omnibusDays: number;
    link: string;
  },
  locale: EmailLocale = "tr"
): EmailContent {
  const c = COPY[locale];
  const f = fmt(locale);
  const body = layout(
    locale,
    c.dropTitle(input.name),
    [
      `${input.propertyTitle} · ${input.roomName}`,
      c.dates(f, input.checkIn, input.checkOut),
      c.newPrice(f.money(input.currentMinor, input.currency)),
      c.previousPrice(input.omnibusDays, f.money(input.previousMinor, input.currency)),
      input.link,
    ],
    c.footer
  );
  return { subject: c.dropSubject(input.propertyTitle), ...body };
}

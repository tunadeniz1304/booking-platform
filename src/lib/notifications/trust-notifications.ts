import type { PartyRiskFlaggedPayload } from "@/lib/events/events";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "./notifier";
import { emailLocale, escapeHtml, type EmailContent, type EmailLocale } from "./templates";

/**
 * P1-6 güven-emniyet bildirimleri: parti riski eşik üstündeki rezervasyon için ev sahibine
 * açıklanabilir gerekçeli uyarı. Outbox tüketicisinde çalışır; dedupeKey ile tek e-posta.
 */

const REASON_TEXT: Record<EmailLocale, Record<string, string>> = {
  tr: {
    YOUNG_ACCOUNT: "Misafir hesabı yeni oluşturulmuş",
    SINGLE_NIGHT: "Tek gecelik konaklama",
    LARGE_GROUP: "Kalabalık grup",
    NEAR_DATE: "Girişe çok az süre var",
    WEEKEND: "Hafta sonu gecesi içeriyor",
  },
  en: {
    YOUNG_ACCOUNT: "The guest account is newly created",
    SINGLE_NIGHT: "Single-night stay",
    LARGE_GROUP: "Large group",
    NEAR_DATE: "Check-in is very soon",
    WEEKEND: "Includes a weekend night",
  },
};

const COPY = {
  tr: {
    subject: "Rezervasyonunuz için parti riski uyarısı",
    hello: (n: string) => `Merhaba ${n},`,
    intro: (title: string, dates: string, guests: number, score: number) =>
      `"${title}" ilanınızdaki ${dates} tarihli, ${guests} misafirlik rezervasyon parti riski açısından işaretlendi (skor ${score}/100).`,
    reasons: "Gerekçeler:",
    action:
      "Bu otomatik bir uyarıdır, rezervasyon iptal edilmedi. Misafirle platform mesajlaşması üzerinden ev kurallarını teyit etmenizi öneririz. Ayrıntılar ev sahibi panelinizde.",
    footer: "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek konaklama satılmaz.",
  },
  en: {
    subject: "Party-risk warning for your booking",
    hello: (n: string) => `Hello ${n},`,
    intro: (title: string, dates: string, guests: number, score: number) =>
      `The booking for "${title}" on ${dates} for ${guests} guests was flagged for party risk (score ${score}/100).`,
    reasons: "Reasons:",
    action:
      "This is an automated warning; the booking was not cancelled. We recommend confirming the house rules with the guest via platform messaging. Details are in your host dashboard.",
    footer: "This email was sent by a portfolio/demo project; no real stays are sold.",
  },
} as const;

export function partyRiskEmail(
  input: {
    name: string;
    propertyTitle: string;
    checkIn: string;
    checkOut: string;
    guestCount: number;
    score: number;
    reasons: string[];
  },
  locale: EmailLocale = "tr"
): EmailContent {
  const c = COPY[locale];
  const reasonLines = input.reasons.map((r) => `- ${REASON_TEXT[locale][r] ?? r}`);
  const intro = c.intro(
    input.propertyTitle,
    `${input.checkIn} → ${input.checkOut}`,
    input.guestCount,
    input.score
  );
  const title = c.hello(input.name);
  const text = [title, "", intro, "", c.reasons, ...reasonLines, "", c.action, "", c.footer].join(
    "\n"
  );
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#111">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
<p>${escapeHtml(intro)}</p>
<p>${escapeHtml(c.reasons)}</p>
<ul>${input.reasons.map((r) => `<li>${escapeHtml(REASON_TEXT[locale][r] ?? r)}</li>`).join("")}</ul>
<p>${escapeHtml(c.action)}</p>
<p style="color:#666;font-size:12px">${escapeHtml(c.footer)}</p>
</body></html>`;
  return { subject: c.subject, text, html };
}

/** Outbox tüketicisi (`trust.party_risk_flagged`). */
export async function notifyHostPartyRisk(p: PartyRiskFlaggedPayload): Promise<void> {
  const [assessment, host, booking] = await Promise.all([
    prisma.partyRiskAssessment.findUnique({ where: { bookingId: p.bookingId } }),
    prisma.user.findUnique({
      where: { id: p.hostId },
      select: { email: true, firstName: true, locale: true, deletedAt: true },
    }),
    prisma.booking.findUnique({
      where: { id: p.bookingId },
      select: {
        checkIn: true,
        checkOut: true,
        guestCount: true,
        property: { select: { title: true } },
      },
    }),
  ]);
  if (!assessment || !host || host.deletedAt || !booking) return;
  const content = partyRiskEmail(
    {
      name: host.firstName,
      propertyTitle: booking.property.title,
      checkIn: booking.checkIn.toISOString().slice(0, 10),
      checkOut: booking.checkOut.toISOString().slice(0, 10),
      guestCount: booking.guestCount,
      score: assessment.score,
      reasons: assessment.reasons,
    },
    emailLocale(host.locale)
  );
  await sendEmail({
    dedupeKey: `trust.party_risk:${p.bookingId}:host`,
    userId: p.hostId,
    to: host.email,
    content,
  });
  await prisma.partyRiskAssessment.updateMany({
    where: { bookingId: p.bookingId, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
}

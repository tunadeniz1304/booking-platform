import type { ClaimEventPayload } from "@/lib/events/events";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "./notifier";
import { emailLocale, escapeHtml, type EmailContent, type EmailLocale } from "./templates";

/**
 * Çözüm merkezi e-postaları (P1-5). Outbox tüketicisinde çalışır; dedupeKey sayesinde
 * yeniden teslimde tek e-posta. Tutar/ayrıntı değil yalnızca talep bağlantısı gönderilir.
 */

const COPY = {
  tr: {
    footer: "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek konaklama satılmaz.",
    openedSubject: "Rezervasyonunuzla ilgili bir talep açıldı",
    opened: (hours: string) =>
      `Çözüm merkezinde rezervasyonunuzla ilgili bir talep açıldı. Lütfen ${hours} içinde yanıt verin; aksi hâlde talep yöneticilere iletilir.`,
    escalatedSubject: "Çözüm merkezi: yönetici incelemesi gereken talep",
    escalated:
      "Bir talep eskale edildi (yanıt süresi aşıldı ya da ödeme itirazı). İnceleme bekliyor.",
    resolvedSubject: "Talebiniz karara bağlandı",
    resolved: "Çözüm merkezindeki talebiniz karara bağlandı. Ayrıntılar için talebi açın.",
    link: "Talep",
  },
  en: {
    footer: "This email was sent by a portfolio/demo project; no real stays are sold.",
    openedSubject: "A claim was opened about your booking",
    opened: (hours: string) =>
      `A claim about your booking was opened in the resolution center. Please respond within ${hours}; otherwise it is escalated to admins.`,
    escalatedSubject: "Resolution center: claim needs admin review",
    escalated:
      "A claim was escalated (response deadline missed or payment dispute). It awaits review.",
    resolvedSubject: "Your claim has been decided",
    resolved: "Your claim in the resolution center has been decided. Open the claim for details.",
    link: "Claim",
  },
} as const;

function claimUrl(claimId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/resolution/${claimId}`;
}

function render(locale: EmailLocale, subject: string, line: string, claimId: string): EmailContent {
  const c = COPY[locale];
  const url = claimUrl(claimId);
  const text = [line, "", `${c.link}: ${url}`, "", c.footer].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#111">
<p>${escapeHtml(line)}</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(c.link)}</a></p>
<p style="color:#666;font-size:12px">${escapeHtml(c.footer)}</p>
</body></html>`;
  return { subject, text, html };
}

async function userById(id: string | null) {
  if (!id) return null;
  return prisma.user.findUnique({ where: { id }, select: { id: true, email: true, locale: true } });
}

export async function notifyClaimOpened(p: ClaimEventPayload) {
  const claim = await prisma.claim.findUnique({ where: { id: p.claimId } });
  const to = await userById(claim?.respondentId ?? null);
  if (!claim || !to || !claim.slaDueAt) return "missing" as const;
  const locale = emailLocale(to.locale);
  const hours = Math.max(
    1,
    Math.round((claim.slaDueAt.getTime() - claim.createdAt.getTime()) / 3_600_000)
  );
  const c = COPY[locale];
  return sendEmail({
    dedupeKey: `claim.opened:${claim.id}`,
    userId: to.id,
    to: to.email,
    content: render(
      locale,
      c.openedSubject,
      c.opened(locale === "tr" ? `${hours} saat` : `${hours} hours`),
      claim.id
    ),
  });
}

export async function notifyClaimEscalated(p: ClaimEventPayload) {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true, email: true, locale: true },
    take: 50,
  });
  for (const a of admins) {
    const locale = emailLocale(a.locale);
    const c = COPY[locale];
    await sendEmail({
      dedupeKey: `claim.escalated:${p.claimId}:${a.id}`,
      userId: a.id,
      to: a.email,
      content: render(locale, c.escalatedSubject, c.escalated, p.claimId),
    });
  }
  return "sent" as const;
}

export async function notifyClaimResolved(p: ClaimEventPayload) {
  const claim = await prisma.claim.findUnique({ where: { id: p.claimId } });
  if (!claim) return "missing" as const;
  for (const id of [claim.openedById, claim.respondentId]) {
    const u = await userById(id);
    if (!u) continue;
    const locale = emailLocale(u.locale);
    const c = COPY[locale];
    await sendEmail({
      dedupeKey: `claim.resolved:${claim.id}:${u.id}`,
      userId: u.id,
      to: u.email,
      content: render(locale, c.resolvedSubject, c.resolved, claim.id),
    });
  }
  return "sent" as const;
}

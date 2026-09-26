import type { NoticeEventPayload } from "@/lib/compliance/dsa";
import { appealLink, type NoticeAppealEventPayload } from "@/lib/compliance/dsa-appeal";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "./notifier";
import { emailLocale, escapeHtml, type EmailContent, type EmailLocale } from "./templates";

/**
 * DSA bildirim-ve-eylem e-postaları (P1-13b): bildirene alındı onayı (md. 16(4)) ve karar
 * sonucu (md. 16(5)); ilan kaldırıldıysa ev sahibine gerekçeli karar bildirimi (md. 17).
 * Outbox tüketicisinde çalışır; dedupeKey sayesinde yeniden teslimde tek e-posta.
 */

const COPY = {
  tr: {
    footer: "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek konaklama satılmaz.",
    receivedSubject: "Bildiriminiz alındı",
    received: (id: string, url: string) => [
      `DSA bildiriminiz alındı (başvuru no: ${id}).`,
      `Bildirilen içerik: ${url}`,
      "Bildiriminiz insan incelemesinden geçirilecek; karar ve gerekçesi size e-postayla bildirilecektir.",
    ],
    decidedSubject: "Bildiriminiz hakkında karar",
    decision: { REMOVED: "İçerik yayından kaldırıldı.", NO_ACTION: "İçerik için işlem yapılmadı." },
    hostSubject: "İlanınız hakkında karar: gerekçeli karar bildirimi",
    host: "Bir bildirim üzerine ilanınız yayından kaldırıldı. Gerekçeli karar bildirimi aşağıdadır.",
    sor: "Gerekçeli karar bildirimi:",
    appeal: (link: string) => `Bu karara 6 ay içinde itiraz edebilirsiniz (DSA md. 20): ${link}`,
    appealReceivedSubject: "İtirazınız alındı",
    appealReceived: (id: string) => [
      `DSA md. 20 kapsamındaki itirazınız alındı (itiraz no: ${id}).`,
      "İtirazınız yetkili bir çalışan tarafından incelenecek; sonuç size e-postayla bildirilecektir.",
    ],
    appealDecidedSubject: "İtirazınız hakkında karar",
    appealOutcome: {
      UPHELD: "İtirazınız kabul edildi; önceki karar geri alındı.",
      REJECTED: "İtirazınız reddedildi; önceki karar geçerliliğini koruyor.",
    },
    appealResponse: "Gerekçe:",
    appealRedress:
      "Bu karara karşı DSA md. 21 kapsamında mahkeme dışı uyuşmazlık çözümüne veya yargı yoluna başvurabilirsiniz.",
    hostRestrictedSubject: "İlanınız itiraz kararıyla yayından kaldırıldı",
    hostRestricted:
      "Bir bildirime ilişkin itiraz kabul edildi ve ilanınız yayından kaldırıldı. Gerekçe aşağıdadır.",
  },
  en: {
    footer: "This email was sent by a portfolio/demo project; no real stays are sold.",
    receivedSubject: "We received your notice",
    received: (id: string, url: string) => [
      `We received your DSA notice (reference: ${id}).`,
      `Reported content: ${url}`,
      "A human will review your notice; you will be emailed the decision and its reasons.",
    ],
    decidedSubject: "Decision on your notice",
    decision: {
      REMOVED: "The content was removed.",
      NO_ACTION: "No action was taken on the content.",
    },
    hostSubject: "Decision on your listing: statement of reasons",
    host: "Your listing was removed following a notice. The statement of reasons is below.",
    sor: "Statement of reasons:",
    appeal: (link: string) => `You may appeal this decision within 6 months (DSA Art. 20): ${link}`,
    appealReceivedSubject: "We received your appeal",
    appealReceived: (id: string) => [
      `We received your appeal under DSA Art. 20 (reference: ${id}).`,
      "A qualified member of staff will review it; you will be emailed the outcome.",
    ],
    appealDecidedSubject: "Decision on your appeal",
    appealOutcome: {
      UPHELD: "Your appeal was upheld; the earlier decision has been reversed.",
      REJECTED: "Your appeal was rejected; the earlier decision stands.",
    },
    appealResponse: "Reasons:",
    appealRedress:
      "You may refer this decision to an out-of-court dispute settlement body (DSA Art. 21) or seek judicial redress.",
    hostRestrictedSubject: "Your listing was removed following an appeal",
    hostRestricted:
      "An appeal concerning a notice was upheld and your listing was removed. The reasons are below.",
  },
} as const;

function render(locale: EmailLocale, subject: string, lines: string[], pre?: string): EmailContent {
  const c = COPY[locale];
  const text = [...lines, ...(pre ? ["", pre] : []), "", c.footer].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#111">
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
${pre ? `<pre style="white-space:pre-wrap;font-family:inherit">${escapeHtml(pre)}</pre>` : ""}
<p style="color:#666;font-size:12px">${escapeHtml(c.footer)}</p>
</body></html>`;
  return { subject, text, html };
}

export async function notifyNoticeReceived(p: NoticeEventPayload) {
  const notice = await prisma.notice.findUnique({ where: { id: p.noticeId } });
  if (!notice) return "missing" as const;
  const locale = emailLocale(notice.locale);
  const c = COPY[locale];
  return sendEmail({
    dedupeKey: `dsa.notice_received:${notice.id}`,
    to: notice.reporterEmail,
    content: render(locale, c.receivedSubject, [...c.received(notice.id, notice.contentUrl)]),
  });
}

export async function notifyNoticeDecided(p: NoticeEventPayload) {
  const notice = await prisma.notice.findUnique({ where: { id: p.noticeId } });
  if (!notice || !notice.decision || !notice.statementOfReasons) return "missing" as const;
  const locale = emailLocale(notice.locale);
  const c = COPY[locale];
  await sendEmail({
    dedupeKey: `dsa.notice_decided:${notice.id}:reporter`,
    to: notice.reporterEmail,
    content: render(
      locale,
      c.decidedSubject,
      [c.decision[notice.decision], c.appeal(appealLink(notice.id, "REPORTER")), c.sor],
      notice.statementOfReasons
    ),
  });
  if (notice.decision !== "REMOVED" || !notice.propertyId) return "sent" as const;
  const property = await prisma.property.findUnique({
    where: { id: notice.propertyId },
    select: { host: { select: { id: true, email: true, locale: true } } },
  });
  if (!property) return "sent" as const;
  const hostLocale = emailLocale(property.host.locale);
  const h = COPY[hostLocale];
  await sendEmail({
    dedupeKey: `dsa.notice_decided:${notice.id}:host`,
    userId: property.host.id,
    to: property.host.email,
    content: render(
      hostLocale,
      h.hostSubject,
      [h.host, h.appeal(appealLink(notice.id, "HOST"))],
      notice.statementOfReasons
    ),
  });
  return "sent" as const;
}

export async function notifyNoticeAppealReceived(p: NoticeAppealEventPayload) {
  const appeal = await prisma.noticeAppeal.findUnique({ where: { id: p.appealId } });
  if (!appeal) return "missing" as const;
  const locale = emailLocale(appeal.locale);
  const c = COPY[locale];
  return sendEmail({
    dedupeKey: `dsa.appeal_received:${appeal.id}`,
    to: appeal.appellantEmail,
    content: render(locale, c.appealReceivedSubject, c.appealReceived(appeal.id)),
  });
}

export async function notifyNoticeAppealDecided(p: NoticeAppealEventPayload) {
  const appeal = await prisma.noticeAppeal.findUnique({ where: { id: p.appealId } });
  if (!appeal || appeal.status === "PENDING" || !appeal.response) return "missing" as const;
  const locale = emailLocale(appeal.locale);
  const c = COPY[locale];
  await sendEmail({
    dedupeKey: `dsa.appeal_decided:${appeal.id}`,
    to: appeal.appellantEmail,
    content: render(
      locale,
      c.appealDecidedSubject,
      [c.appealOutcome[appeal.status], c.appealRedress, c.appealResponse],
      appeal.response
    ),
  });
  // Bildirenin itirazı kabul edilip ilan kaldırıldıysa ev sahibi de gerekçeyle bilgilendirilir.
  if (appeal.status !== "UPHELD" || !appeal.decisionGround || !appeal.propertyId) {
    return "sent" as const;
  }
  const property = await prisma.property.findUnique({
    where: { id: appeal.propertyId },
    select: { host: { select: { id: true, email: true, locale: true } } },
  });
  if (!property) return "sent" as const;
  const h = COPY[emailLocale(property.host.locale)];
  await sendEmail({
    dedupeKey: `dsa.appeal_decided:${appeal.id}:host`,
    userId: property.host.id,
    to: property.host.email,
    content: render(
      emailLocale(property.host.locale),
      h.hostRestrictedSubject,
      [h.hostRestricted],
      appeal.response
    ),
  });
  return "sent" as const;
}

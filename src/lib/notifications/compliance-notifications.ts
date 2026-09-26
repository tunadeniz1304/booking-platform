import type { NoticeEventPayload } from "@/lib/compliance/dsa";
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
      [c.decision[notice.decision], c.sor],
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
    content: render(hostLocale, h.hostSubject, [h.host], notice.statementOfReasons),
  });
  return "sent" as const;
}

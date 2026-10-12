import { prisma } from "@/lib/prisma";
import { sendEmail } from "./notifier";
import { emailLocale, escapeHtml, type EmailContent, type EmailLocale } from "./templates";

/**
 * İnsan destek talebi durum e-postaları (F895): temsilci talebi üstlendiğinde (IN_PROGRESS) ya
 * da çözdüğünde (RESOLVED) talep sahibine haber verilir. Talep özeti gönderilmez; yalnızca
 * durumun izlendiği destek sayfasının bağlantısı. dedupeKey sayesinde durum başına tek e-posta.
 */

type NotifiedStatus = "IN_PROGRESS" | "RESOLVED";

const COPY = {
  tr: {
    footer: "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek konaklama satılmaz.",
    IN_PROGRESS: {
      subject: "Destek talebiniz incelemeye alındı",
      line: "Destek ekibimizden bir temsilci talebinizi incelemeye aldı. Size bu e-posta adresinden döneceğiz; talebin durumunu destek sayfasından izleyebilirsiniz.",
    },
    RESOLVED: {
      subject: "Destek talebiniz çözüldü",
      line: "Destek talebiniz çözüldü olarak işaretlendi. Sorununuz devam ediyorsa destek sayfasından yeni bir talep açabilirsiniz.",
    },
    link: "Destek talepleriniz",
  },
  en: {
    footer: "This email was sent by a portfolio/demo project; no real stays are sold.",
    IN_PROGRESS: {
      subject: "Your support request is being reviewed",
      line: "An agent from our support team has started reviewing your request. We will reply to this email address; you can follow the status on the support page.",
    },
    RESOLVED: {
      subject: "Your support request has been resolved",
      line: "Your support request was marked as resolved. If the problem persists, you can open a new request on the support page.",
    },
    link: "Your support requests",
  },
} as const;

function supportUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/support`;
}

function render(locale: EmailLocale, status: NotifiedStatus): EmailContent {
  const c = COPY[locale];
  const { subject, line } = c[status];
  const url = supportUrl();
  const text = [line, "", `${c.link}: ${url}`, "", c.footer].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#111">
<p>${escapeHtml(line)}</p>
<p><a href="${escapeHtml(url)}">${escapeHtml(c.link)}</a></p>
<p style="color:#666;font-size:12px">${escapeHtml(c.footer)}</p>
</body></html>`;
  return { subject, text, html };
}

/** Talep sahibine durum e-postası; talep/kullanıcı yoksa ya da durum OPEN ise gönderilmez. */
export async function notifySupportTicketStatus(ticketId: string, status: string) {
  if (status !== "IN_PROGRESS" && status !== "RESOLVED") return "skipped" as const;
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, userId: true },
  });
  const to = ticket
    ? await prisma.user.findFirst({
        where: { id: ticket.userId, deletedAt: null },
        select: { id: true, email: true, locale: true },
      })
    : null;
  if (!ticket || !to) return "missing" as const;
  return sendEmail({
    dedupeKey: `support.ticket.${status}:${ticket.id}`,
    userId: to.id,
    to: to.email,
    content: render(emailLocale(to.locale), status),
  });
}

import type { SplitShareInvitedPayload } from "@/lib/events/events";
import { prisma } from "@/lib/prisma";
import { formatMoney, minorFromDb, money } from "@/lib/money/money";
import { shareUrl, signShareToken } from "@/lib/cart/split-token";
import { sendEmail } from "./notifier";
import { emailLocale, escapeHtml, type EmailContent, type EmailLocale } from "./templates";

/**
 * Bölünmüş ödeme e-postaları (P1-2): katılımcıya pay daveti, süre dolunca organizatöre kalan
 * tutar için yedek ödeme çağrısı. Link olay anında pay kaydından üretilir (token outbox'a
 * yazılmaz); pay artık ödenebilir değilse e-posta gönderilmez.
 */

interface Copy {
  subject: string;
  hello: (n: string) => string;
  body: (organizer: string, amount: string, deadline: string) => string;
  action: string;
  footer: string;
}

const COPY: Record<SplitShareInvitedPayload["kind"], Record<EmailLocale, Copy>> = {
  INVITE: {
    tr: {
      subject: "Grup rezervasyonu: payınızı ödeyin",
      hello: () => "Merhaba,",
      body: (o, a, d) =>
        `${o} grup rezervasyonu için ödemeyi bölüştürdü. Size düşen pay ${a}. Son ödeme: ${d} UTC.`,
      action: "Ödemek için bağlantıyı açın (giriş yapmanız ve e-postanızı doğrulamanız gerekir):",
      footer:
        "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek ödeme alınmaz, gerçek konaklama satılmaz.",
    },
    en: {
      subject: "Group booking: pay your share",
      hello: () => "Hello,",
      body: (o, a, d) =>
        `${o} split the payment for a group booking. Your share is ${a}. Deadline: ${d} UTC.`,
      action: "Open the link to pay (you need to sign in with a verified email):",
      footer:
        "This email was sent by a portfolio/demo project; no real payments are taken and no real stays are sold.",
    },
  },
  FALLBACK: {
    tr: {
      subject: "Grup rezervasyonu: kalan tutar size düştü",
      hello: (n) => `Merhaba ${n},`,
      body: (_o, a, d) =>
        `Bazı katılımcılar paylarını süresinde ödemedi. Rezervasyonu korumak için kalan ${a} tutarını ${d} UTC'ye kadar ödeyin; aksi hâlde tüm ödemeler iade edilir ve odalar bırakılır.`,
      action: "Kalanı ödemek için:",
      footer:
        "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek ödeme alınmaz, gerçek konaklama satılmaz.",
    },
    en: {
      subject: "Group booking: the remaining amount is due",
      hello: (n) => `Hello ${n},`,
      body: (_o, a, d) =>
        `Some participants did not pay their share in time. To keep the booking, pay the remaining ${a} by ${d} UTC; otherwise all payments are refunded and the rooms are released.`,
      action: "Pay the remaining amount:",
      footer:
        "This email was sent by a portfolio/demo project; no real payments are taken and no real stays are sold.",
    },
  },
};

export function splitShareEmail(
  input: {
    kind: SplitShareInvitedPayload["kind"];
    name: string;
    organizer: string;
    amount: string;
    deadline: string;
    url: string;
  },
  locale: EmailLocale = "tr"
): EmailContent {
  const c = COPY[input.kind][locale];
  const deadline = input.deadline.slice(0, 16).replace("T", " ");
  const title = c.hello(input.name);
  const body = c.body(input.organizer, input.amount, deadline);
  const text = [title, "", body, "", c.action, input.url, "", c.footer].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#111">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
<p>${escapeHtml(body)}</p>
<p>${escapeHtml(c.action)} <a href="${escapeHtml(input.url)}">${escapeHtml(input.url)}</a></p>
<p style="color:#666;font-size:12px">${escapeHtml(c.footer)}</p>
</body></html>`;
  return { subject: c.subject, text, html };
}

/** Olay → davet / yedek ödeme e-postası (gönderim başına tek e-posta). */
export async function notifySplitShareInvited(p: SplitShareInvitedPayload) {
  const share = await prisma.paymentShare.findUnique({
    where: { id: p.shareId },
    select: {
      id: true,
      status: true,
      participantEmail: true,
      payerUserId: true,
      amountMinor: true,
      currency: true,
      inviteNonce: true,
      plan: { select: { status: true, deadlineAt: true, organizerId: true } },
    },
  });
  if (!share || !["INVITED", "FAILED"].includes(share.status)) return "skipped" as const;
  if (share.plan.status !== "COLLECTING" && share.plan.status !== "FALLBACK") {
    return "skipped" as const;
  }
  const organizer = await prisma.user.findUnique({
    where: { id: share.plan.organizerId },
    select: { email: true, firstName: true, locale: true },
  });
  if (!organizer) return "skipped" as const;
  const to = p.kind === "FALLBACK" ? organizer.email : share.participantEmail;
  if (!to) return "skipped" as const;
  const recipient =
    p.kind === "FALLBACK"
      ? null
      : await prisma.user.findUnique({ where: { email: to }, select: { id: true, locale: true } });
  const locale = emailLocale(p.kind === "FALLBACK" ? organizer.locale : recipient?.locale);
  const token = signShareToken({
    s: share.id,
    n: share.inviteNonce,
    e: share.plan.deadlineAt.getTime(),
  });
  return sendEmail({
    dedupeKey: `cart.split_share:${p.shareId}:${p.sendId}`,
    userId: p.kind === "FALLBACK" ? share.plan.organizerId : recipient?.id,
    to,
    content: splitShareEmail(
      {
        kind: p.kind,
        name: organizer.firstName,
        organizer: organizer.firstName,
        amount: formatMoney(
          money(minorFromDb(share.amountMinor), share.currency),
          locale === "tr" ? "tr-TR" : "en-US"
        ),
        deadline: share.plan.deadlineAt.toISOString(),
        url: shareUrl(token),
      },
      locale
    ),
  });
}

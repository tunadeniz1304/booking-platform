import type { SecurityAlertPayload } from "@/lib/events/events";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "./notifier";
import { emailLocale, escapeHtml, type EmailContent, type EmailLocale } from "./templates";

/**
 * Güvenlik bildirimleri (v4#2): hesaba yeni passkey eklendiğinde kullanıcıya e-posta.
 * Oturumu çalınmış bir kullanıcı, saldırganın eklediği passkey'i bu e-postayla fark eder
 * (yeni passkey ayrıca 24 saat ödeme step-up'ında kullanılamaz). Olay başına tek e-posta.
 */
const COPY: Record<
  EmailLocale,
  {
    subject: string;
    hello: (n: string) => string;
    body: (d: string | null, at: string) => string;
    action: string;
    footer: string;
  }
> = {
  tr: {
    subject: "Hesabınıza yeni bir passkey eklendi",
    hello: (n) => `Merhaba ${n},`,
    body: (d, at) => `Hesabınıza ${d ? `"${d}" adlı ` : ""}yeni bir passkey eklendi (${at} UTC).`,
    action:
      "Bu işlemi siz yapmadıysanız hemen parolanızı değiştirin ve Hesap ▸ Passkey'ler sayfasından bu passkey'i silin. Güvenliğiniz için yeni passkey 24 saat boyunca ödeme doğrulamasında kullanılamaz.",
    footer:
      "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek ödeme alınmaz, gerçek konaklama satılmaz.",
  },
  en: {
    subject: "A new passkey was added to your account",
    hello: (n) => `Hello ${n},`,
    body: (d, at) =>
      `A new passkey${d ? ` named "${d}"` : ""} was added to your account (${at} UTC).`,
    action:
      "If this wasn't you, change your password now and remove the passkey under Account ▸ Passkeys. For your safety, a new passkey cannot be used for payment verification for 24 hours.",
    footer:
      "This email was sent by a portfolio/demo project; no real payments are taken and no real stays are sold.",
  },
};

export function securityAlertEmail(
  input: { name: string; detail: string | null; occurredAt: string },
  locale: EmailLocale = "tr"
): EmailContent {
  const c = COPY[locale];
  const at = input.occurredAt.slice(0, 16).replace("T", " ");
  const lines = [c.body(input.detail, at), c.action];
  const title = c.hello(input.name);
  const text = [title, "", ...lines, "", c.footer].join("\n");
  const html = `<!doctype html><html lang="${locale}"><body style="font-family:Arial,sans-serif;color:#111">
<h1 style="font-size:20px">${escapeHtml(title)}</h1>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("\n")}
<p style="color:#666;font-size:12px">${escapeHtml(c.footer)}</p>
</body></html>`;
  return { subject: c.subject, text, html };
}

/** Olay → güvenlik e-postası (alertId başına tek e-posta). */
export async function notifySecurityAlert(p: SecurityAlertPayload) {
  const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { locale: true } });
  return sendEmail({
    dedupeKey: `auth.security_alert:${p.alertId}`,
    userId: p.userId,
    to: p.to,
    content: securityAlertEmail(
      { name: p.name, detail: p.detail, occurredAt: p.occurredAt },
      emailLocale(user?.locale)
    ),
  });
}

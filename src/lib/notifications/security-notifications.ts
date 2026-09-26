import type { SecurityAlertPayload } from "@/lib/events/events";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "./notifier";
import { emailLocale, escapeHtml, type EmailContent, type EmailLocale } from "./templates";

type AlertKind = SecurityAlertPayload["kind"];

/**
 * Güvenlik bildirimleri: hesaba yeni passkey eklendiğinde (v4#2) veya daha önce görülmemiş
 * bir cihazdan giriş yapıldığında (P0-4) kullanıcıya e-posta. Oturumu çalınmış bir kullanıcı
 * saldırganın eylemini bu e-postayla fark eder ve Hesap ▸ Oturumlar'dan uzaktan çıkış yapar.
 * Olay başına tek e-posta.
 */
interface AlertCopy {
  subject: string;
  body: (d: string | null, at: string) => string;
  action: string;
}

const COMMON: Record<EmailLocale, { hello: (n: string) => string; footer: string }> = {
  tr: {
    hello: (n) => `Merhaba ${n},`,
    footer:
      "Bu e-posta bir portföy/demo projesinden gönderilmiştir; gerçek ödeme alınmaz, gerçek konaklama satılmaz.",
  },
  en: {
    hello: (n) => `Hello ${n},`,
    footer:
      "This email was sent by a portfolio/demo project; no real payments are taken and no real stays are sold.",
  },
};

const COPY: Record<AlertKind, Record<EmailLocale, AlertCopy>> = {
  PASSKEY_ADDED: {
    tr: {
      subject: "Hesabınıza yeni bir passkey eklendi",
      body: (d, at) => `Hesabınıza ${d ? `"${d}" adlı ` : ""}yeni bir passkey eklendi (${at} UTC).`,
      action:
        "Bu işlemi siz yapmadıysanız hemen parolanızı değiştirin ve Hesap ▸ Passkey'ler sayfasından bu passkey'i silin. Güvenliğiniz için yeni passkey 24 saat boyunca ödeme doğrulamasında kullanılamaz.",
    },
    en: {
      subject: "A new passkey was added to your account",
      body: (d, at) =>
        `A new passkey${d ? ` named "${d}"` : ""} was added to your account (${at} UTC).`,
      action:
        "If this wasn't you, change your password now and remove the passkey under Account ▸ Passkeys. For your safety, a new passkey cannot be used for payment verification for 24 hours.",
    },
  },
  NEW_DEVICE_LOGIN: {
    tr: {
      subject: "Hesabınıza yeni bir cihazdan giriş yapıldı",
      body: (d, at) =>
        `Hesabınıza yeni bir cihazdan giriş yapıldı${d ? ` (${d})` : ""} — ${at} UTC.`,
      action:
        "Bu giriş size ait değilse Hesap ▸ Oturumlar sayfasından oturumu kapatın ve parolanızı hemen değiştirin.",
    },
    en: {
      subject: "New sign-in to your account from a new device",
      body: (d, at) =>
        `Your account was signed in from a new device${d ? ` (${d})` : ""} — ${at} UTC.`,
      action:
        "If this wasn't you, sign that session out under Account ▸ Sessions and change your password right away.",
    },
  },
};

export function securityAlertEmail(
  input: { name: string; detail: string | null; occurredAt: string; kind?: AlertKind },
  locale: EmailLocale = "tr"
): EmailContent {
  const c = { ...COMMON[locale], ...COPY[input.kind ?? "PASSKEY_ADDED"][locale] };
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
      { name: p.name, detail: p.detail, occurredAt: p.occurredAt, kind: p.kind },
      emailLocale(user?.locale)
    ),
  });
}

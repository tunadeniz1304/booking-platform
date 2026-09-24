import { Prisma } from "@prisma/client";
import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@/lib/prisma";
import { logger, errorFields } from "@/lib/observability/logger";
import { counter } from "@/lib/observability/metrics";
import type { EmailContent } from "./templates";

/**
 * E-posta gönderimi — outbox tüketicisi tarafından çağrılır (at-least-once teslim).
 *
 * Tekillik: `Notification.dedupeKey` (ör. `booking.confirmed:<bookingId>`) benzersizdir;
 * aynı olay iki kez tüketilirse ikinci ekleme P2002 ile düşer → tek e-posta.
 * Transport: `SMTP_HOST` tanımlıysa nodemailer/SMTP, değilse "dev mailbox"
 * (yalnızca veritabanına yazılır; `/dev/mailbox` sayfasında görüntülenir).
 */

const sent = counter("notifications_total", "Gönderilen bildirimler", [
  "transport",
  "outcome",
] as const);

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const host = process.env.SMTP_HOST;
  transporter = host
    ? nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: Number(process.env.SMTP_PORT ?? 587) === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? "" }
          : undefined,
      })
    : null;
  return transporter;
}

/** Yalnızca testler için: transport'u değiştirir (null → mailbox). */
export function setTransporterForTests(t: Transporter | null | undefined): void {
  transporter = t;
}

export async function sendEmail(input: {
  dedupeKey: string;
  userId?: string;
  to: string;
  content: EmailContent;
}): Promise<"sent" | "duplicate"> {
  const smtp = getTransporter();
  const transport = smtp ? "smtp" : "mailbox";
  let id: string;
  try {
    const row = await prisma.notification.create({
      data: {
        dedupeKey: input.dedupeKey,
        userId: input.userId,
        to: input.to,
        subject: input.content.subject,
        text: input.content.text,
        html: input.content.html,
        transport,
        status: smtp ? "PENDING" : "SENT",
        sentAt: smtp ? null : new Date(),
      },
      select: { id: true },
    });
    id = row.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      sent.inc({ transport, outcome: "duplicate" });
      return "duplicate";
    }
    throw error;
  }

  if (smtp) {
    try {
      await smtp.sendMail({
        from: process.env.SMTP_FROM || "booking-platform <no-reply@booking.test>",
        to: input.to,
        subject: input.content.subject,
        text: input.content.text,
        html: input.content.html,
      });
      await prisma.notification.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date() },
      });
    } catch (error) {
      await prisma.notification.update({
        where: { id },
        data: { status: "FAILED", error: (error as Error).message.slice(0, 300) },
      });
      sent.inc({ transport, outcome: "failed" });
      logger.error({ dedupeKey: input.dedupeKey, ...errorFields(error) }, "email send failed");
      return "sent";
    }
  }
  sent.inc({ transport, outcome: "sent" });
  return "sent";
}

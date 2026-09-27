import "server-only";
import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http/errors";
import { counter } from "@/lib/observability/metrics";
import { scanMessage, type MessageScanResult } from "./message-scan";
import { userLlmSubject } from "@/lib/llm/budget";
import { getMessageRiskClassifier } from "./message-scan-llm";

/**
 * Mesaj gönderim yoluna bağlanan dolandırıcılık taraması (P1-6): tarama ham metinde,
 * maskelemeden ÖNCE yapılır. Uyarı/yüksek risk → `MessageRiskFlag` + denetim kaydı; alıcı
 * mesajı uyarı bandıyla görür. `MESSAGE_SCAN_BLOCK_HIGH_RISK` açıksa yüksek riskli mesaj
 * kaydedilmez (422 MESSAGE_BLOCKED) ama engelleme de denetime yazılır.
 */

export interface MessageRiskView {
  level: "WARN" | "HIGH";
  reasons: string[];
}

const scanned = counter("message_scan_total", "Taranan mesajlar", ["level", "action"] as const);

export class MessageBlockedError extends HttpError {
  constructor(reasons: string[]) {
    super(
      422,
      "MESSAGE_BLOCKED",
      "Mesaj platform dışı ödeme/iletişim isteği içerdiği için gönderilmedi",
      { reasons }
    );
    this.name = "MessageBlockedError";
  }
}

function ownHosts(): string[] {
  const hosts: string[] = [];
  for (const raw of [
    process.env.NEXT_PUBLIC_APP_URL,
    ...(process.env.APP_ORIGINS ?? "").split(","),
  ]) {
    try {
      if (raw?.trim()) hosts.push(new URL(raw.trim()).hostname);
    } catch {
      // geçersiz URL yok sayılır
    }
  }
  return hosts;
}

/**
 * Ham mesaj metnini tarar (kurallar + opsiyonel LLM ek sinyali). LLM çağrısı gönderenin
 * günlük token bütçesine faturalanır.
 */
export function scanOutgoingMessage(body: string, senderId: string): Promise<MessageScanResult> {
  return scanMessage(body, {
    ownHosts: ownHosts(),
    classify: getMessageRiskClassifier(userLlmSubject(senderId)),
  });
}

const needsRecord = (scan: MessageScanResult) =>
  scan.level !== "NONE" || scan.llmSignal === "SUSPICIOUS";

/**
 * Engellenecekse kaydı + denetimi yazar ve `MessageBlockedError` fırlatır; değilse döner.
 */
export async function enforceMessageScan(
  scan: MessageScanResult,
  ctx: { bookingId: string; senderId: string }
): Promise<void> {
  if (!scan.blocked) return;
  scanned.inc({ level: scan.level, action: "blocked" });
  await prisma.$transaction([
    prisma.messageRiskFlag.create({
      data: {
        bookingId: ctx.bookingId,
        senderId: ctx.senderId,
        level: scan.level,
        score: scan.score,
        reasons: scan.reasons,
        llmSignal: scan.llmSignal,
        blocked: true,
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId: ctx.senderId,
        action: "message.blocked",
        entity: "booking",
        entityId: ctx.bookingId,
        meta: { score: scan.score, reasons: scan.reasons, llmSignal: scan.llmSignal },
      },
    }),
  ]);
  throw new MessageBlockedError(scan.reasons);
}

/** Kaydedilen mesaj için risk bayrağı + denetim; alıcıya gösterilecek görünümü döndürür. */
export async function recordMessageRisk(
  scan: MessageScanResult,
  ctx: { bookingId: string; senderId: string; messageId: string }
): Promise<MessageRiskView | null> {
  scanned.inc({ level: scan.level, action: needsRecord(scan) ? "flagged" : "passed" });
  if (!needsRecord(scan)) return null;
  await prisma.$transaction([
    prisma.messageRiskFlag.create({
      data: {
        messageId: ctx.messageId,
        bookingId: ctx.bookingId,
        senderId: ctx.senderId,
        level: scan.level,
        score: scan.score,
        reasons: scan.reasons,
        llmSignal: scan.llmSignal,
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId: ctx.senderId,
        action: "message.risk_flagged",
        entity: "message",
        entityId: ctx.messageId,
        meta: {
          bookingId: ctx.bookingId,
          level: scan.level,
          score: scan.score,
          reasons: scan.reasons,
          llmSignal: scan.llmSignal,
        },
      },
    }),
  ]);
  return toView(scan.level, scan.reasons);
}

/** Uyarı bandı yalnızca kural seviyesi WARN/HIGH iken (LLM sinyali tek başına bant açmaz). */
function toView(level: string, reasons: string[]): MessageRiskView | null {
  return level === "WARN" || level === "HIGH" ? { level, reasons } : null;
}

/** Mesaj kimlikleri için risk görünümleri (listeleme). */
export async function loadMessageRisks(
  messageIds: string[]
): Promise<Map<string, MessageRiskView>> {
  const out = new Map<string, MessageRiskView>();
  if (messageIds.length === 0) return out;
  const rows = await prisma.messageRiskFlag.findMany({
    where: { messageId: { in: messageIds } },
    select: { messageId: true, level: true, reasons: true },
  });
  for (const r of rows) {
    // LLM-yalnız kayıtlar (kural seviyesi NONE) bant açmaz.
    const view = r.messageId ? toView(r.level, r.reasons) : null;
    if (r.messageId && view) out.set(r.messageId, view);
  }
  return out;
}

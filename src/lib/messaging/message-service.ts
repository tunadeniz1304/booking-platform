import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/http/errors";
import { getLlmClient } from "@/lib/llm/client";
import { demoMessageDraft } from "@/lib/llm/demo";
import { assertNumbersGrounded, buildFactSet } from "@/lib/llm/guards";
import { maskMessage } from "./mask";
import { publishMessage, type MessageEvent } from "./hub";
import {
  enforceMessageScan,
  loadMessageRisks,
  recordMessageRisk,
  scanOutgoingMessage,
} from "@/lib/trust/message-risk";

/**
 * P1-6 misafir ↔ ev sahibi mesajlaşması. Yetki: yalnızca rezervasyonun misafiri ve
 * ilanın ev sahibi; diğer herkes (başka misafir/host, ADMIN dahil) 404 alır —
 * varlık bilgisi sızdırılmaz (IDOR). Gövde kaydedilmeden önce maskelenir.
 */
export type ThreadRole = "GUEST" | "HOST";

/** Mesaj gönderilebilen rezervasyon durumları (ödenmemiş/iptal edilmiş rezervasyonda yok). */
const WRITABLE = new Set(["CONFIRMED", "COMPLETED"]);

export interface ThreadAccess {
  bookingId: string;
  role: ThreadRole;
  status: string;
  propertyTitle: string;
  guestName: string;
  checkIn: Date;
  checkOut: Date;
  guestCount: number;
}

export async function resolveThreadAccess(
  bookingId: string,
  userId: string
): Promise<ThreadAccess> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      checkIn: true,
      checkOut: true,
      guestCount: true,
      user: { select: { firstName: true } },
      property: { select: { hostId: true, title: true } },
    },
  });
  const role: ThreadRole | null = !b
    ? null
    : b.userId === userId
      ? "GUEST"
      : b.property.hostId === userId
        ? "HOST"
        : null;
  if (!b || !role) throw new NotFoundError("Rezervasyon bulunamadı");
  return {
    bookingId: b.id,
    role,
    status: b.status,
    propertyTitle: b.property.title,
    guestName: b.user.firstName || "Misafir",
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    guestCount: b.guestCount,
  };
}

function toEvent(m: {
  id: string;
  senderId: string;
  senderRole: string;
  body: string;
  maskedKinds: string[];
  fromAiDraft: boolean;
  createdAt: Date;
}): MessageEvent {
  return { ...m, createdAt: m.createdAt.toISOString() };
}

export async function listMessages(bookingId: string, userId: string) {
  const access = await resolveThreadAccess(bookingId, userId);
  const thread = await prisma.messageThread.findUnique({ where: { bookingId } });
  const messages = thread
    ? await prisma.message.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: "desc" },
        take: getConfig().MESSAGE_PAGE_SIZE,
      })
    : [];
  const risks = await loadMessageRisks(messages.map((m) => m.id));
  return {
    role: access.role,
    canWrite: WRITABLE.has(access.status),
    messages: messages.reverse().map((m) => ({ ...toEvent(m), risk: risks.get(m.id) ?? null })),
  };
}

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1),
  /** Ev sahibinin onayladığı (düzenleyebildiği) yapay zekâ taslağından mı gönderiliyor. */
  fromAiDraft: z.boolean().optional(),
});

export async function sendMessage(
  bookingId: string,
  userId: string,
  input: z.infer<typeof sendMessageSchema>
): Promise<MessageEvent> {
  const access = await resolveThreadAccess(bookingId, userId);
  if (!WRITABLE.has(access.status)) {
    throw new ConflictError("Mesajlaşma yalnızca onaylı rezervasyonlarda açıktır");
  }
  const max = getConfig().MESSAGE_MAX_LENGTH;
  if (input.body.length > max) throw new ValidationError(`Mesaj en fazla ${max} karakter olabilir`);
  if (input.fromAiDraft && access.role !== "HOST") {
    throw new ValidationError("Yapay zekâ taslağı yalnızca ev sahibi tarafından gönderilebilir");
  }
  // P1-6: dolandırıcılık taraması ham metinde (maskeleme IBAN/link'i gizlemeden önce).
  const scan = await scanOutgoingMessage(input.body, userId);
  await enforceMessageScan(scan, { bookingId, senderId: userId });
  const masked = maskMessage(input.body);
  const thread = await prisma.messageThread.upsert({
    where: { bookingId },
    create: { bookingId },
    update: {},
  });
  const msg = await prisma.message.create({
    data: {
      threadId: thread.id,
      senderId: userId,
      senderRole: access.role,
      body: masked.text,
      maskedKinds: masked.kinds,
      fromAiDraft: input.fromAiDraft ?? false,
    },
  });
  await prisma.messageThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  const risk = await recordMessageRisk(scan, { bookingId, senderId: userId, messageId: msg.id });
  const event: MessageEvent = { ...toEvent(msg), risk };
  await publishMessage(bookingId, event);
  return event;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** LLM'e misafir adı yerine giden takma ad (pseudonim). */
export const GUEST_NAME_PLACEHOLDER = "[MISAFIR]";

/**
 * Ev sahibi için yanıt TASLAĞI: yalnızca öneridir, KAYDEDİLMEZ ve GÖNDERİLMEZ.
 * Ev sahibi metni düzenleyip `sendMessage(..., fromAiDraft: true)` ile kendisi gönderir.
 */
export async function draftHostReply(bookingId: string, userId: string) {
  const access = await resolveThreadAccess(bookingId, userId);
  if (access.role !== "HOST") throw new NotFoundError("Rezervasyon bulunamadı");
  const thread = await prisma.messageThread.findUnique({ where: { bookingId } });
  const recent = thread
    ? await prisma.message.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { senderRole: true, body: true },
      })
    : [];
  const lastGuest = recent.find((m) => m.senderRole === "GUEST")?.body ?? null;
  const facts = {
    propertyTitle: access.propertyTitle,
    guestName: access.guestName,
    checkIn: access.checkIn.toISOString().slice(0, 10),
    checkOut: access.checkOut.toISOString().slice(0, 10),
    lastGuestMessage: lastGuest,
  };
  const nights = Math.round((access.checkOut.getTime() - access.checkIn.getTime()) / DAY_MS);
  // v2-P0-7: taslaktaki her sayı/tarih rezervasyon olgularından gelmeli (tarihler, gece ve
  // misafir sayısı koddan). Mesaj geçmişi bilerek olgu sayılmaz: misafirin yazdığı bir
  // tutar ("1500 TL iade") modele tekrar ettirilip taahhüde dönüşemez → demo taslağı.
  const factSet = buildFactSet([
    access.propertyTitle,
    facts.checkIn,
    facts.checkOut,
    nights,
    access.guestCount,
  ]);
  // v4#3: misafirin adı modele GİTMEZ — yer tutucuyla gönderilir, yanıtta geri konur.
  // Geçmiş mesajlardaki ad da (≥3 harf) istemci redaksiyonunda `knownNames` ile maskelenir.
  const llmFacts = {
    ...facts,
    guestName: GUEST_NAME_PLACEHOLDER,
    nights,
    guestCount: access.guestCount,
  };
  const res = await getLlmClient().completeJson(
    "message_draft",
    z.object({ reply: z.string().min(5).max(getConfig().MESSAGE_MAX_LENGTH) }),
    [
      {
        role: "system",
        content: `Ev sahibi adına misafire kısa, nazik bir Türkçe yanıt taslağı yaz. Misafire hitap ederken adı yerine ${GUEST_NAME_PLACEHOLDER} yer tutucusunu aynen kullan. Söz verme, fiyat/iade taahhüdü verme, iletişim bilgisi veya harici bağlantı ekleme. JSON: {reply}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          ...llmFacts,
          history: recent.reverse().map((m) => `${m.senderRole}: ${m.body}`),
        }),
      },
    ],
    {
      demo: () => demoMessageDraft(facts),
      knownNames: [access.guestName],
      validate: (data) => assertNumbersGrounded(data.reply, factSet),
    }
  );
  const reply = res.data.reply.split(GUEST_NAME_PLACEHOLDER).join(access.guestName);
  // Taslak da platform dışı iletişim içeremez.
  return { draft: maskMessage(reply).text, llmMode: res.llmMode };
}

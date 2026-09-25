import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config/app-config";
import { analyticsAllowed } from "@/lib/privacy/consent";
import type { Subject } from "./index";

/** Oturum bazlı deney çerezi (yalnız analitik onayı varsa yazılır — KVKK/ePrivacy). */
export const EXPERIMENT_COOKIE = "exp_sid";
const SID_RE = /^[a-f0-9-]{36}$/;

export interface ResolvedSubject {
  subject: Subject | null;
  /** Yanıta yazılacak yeni oturum kimliği (yoksa null). */
  newSessionId: string | null;
}

/**
 * Kovalama öznesi: giriş yapmış kullanıcı → `user:<id>`; aksi halde analitik onayı
 * varsa `session:<exp_sid>`; onay yoksa özne yok → deney dışı (v2 davranışı).
 */
export function resolveSubject(req: NextRequest, userId: string | undefined): ResolvedSubject {
  if (userId) return { subject: { key: `user:${userId}`, userId }, newSessionId: null };
  if (!analyticsAllowed(req.headers.get("cookie") ?? ""))
    return { subject: null, newSessionId: null };
  const existing = req.cookies.get(EXPERIMENT_COOKIE)?.value;
  if (existing && SID_RE.test(existing)) {
    return { subject: { key: `session:${existing}` }, newSessionId: null };
  }
  const sid = randomUUID();
  return { subject: { key: `session:${sid}` }, newSessionId: sid };
}

export function setExperimentCookie(res: NextResponse, sid: string): void {
  res.cookies.set(EXPERIMENT_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: getConfig().EXPERIMENT_COOKIE_DAYS * 24 * 60 * 60,
  });
}

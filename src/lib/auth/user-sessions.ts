import { randomUUID } from "crypto";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { NotFoundError } from "@/lib/http/errors";
import { audit } from "@/lib/admin/audit";
import { appendOutbox } from "@/lib/cqrs/outbox";
import { EventTypes, makeEvent, type SecurityAlertPayload } from "@/lib/events/events";
import { trustedIpKey } from "@/lib/security/ip";
import { resolveDeviceId, setDeviceCookie } from "@/lib/risk/device-cookie";
import type { AuthRequest } from "./index";
import { issueSession, revokeFamily, type SessionContext, type SessionTokens } from "./session";

/**
 * Oturum listesi, uzaktan çıkış ve yeni cihaz bildirimi (P0-4).
 *
 * Her giriş bir `UserSession` satırı (id = yenileme ailesi = erişim token'ındaki `sid`)
 * açar. Cihaz, imzalı `did` çereziyle (risk/device-cookie.ts) tanınır: kullanıcının daha
 * önce hiç görülmemiş bir cihazdan girişi `auth.security_alert` (NEW_DEVICE_LOGIN) outbox
 * olayıyla e-posta bildirimine dönüşür. Uzaktan çıkış aileyi iptal eder; hem yenileme
 * hem `sid`'li erişim token'ı anında geçersizleşir.
 */

type RequestLike = AuthRequest;

/** Kaba IP ipucu: IPv4 → son oktet maskeli (/24), IPv6 zaten /64 kovası. */
export function maskIpHint(bucket: string | null): string | null {
  if (!bucket) return null;
  const v = bucket.replace(/^ip:/, "");
  const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(v);
  return m ? `${m[1]}.x` : v;
}

/** User-Agent → "Chrome · Windows" gibi kısa etiket (yalnızca görüntüleme). */
export function describeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  const label = [browser, os].filter(Boolean).join(" · ");
  return label || ua.slice(0, 60);
}

/** İstekten oturum bağlamı + cihaz kimliği (yeni basıldıysa `deviceIssued`). */
export function sessionContextFrom(req: RequestLike): {
  context: SessionContext;
  deviceIssued: boolean;
} {
  const config = getConfig();
  const { deviceId, issued } = resolveDeviceId(req.cookies);
  const ipKey = trustedIpKey(req.headers, {
    trustedProxyHops: config.TRUSTED_PROXY_HOPS,
    trustRealIpHeader: config.TRUST_REAL_IP_HEADER,
  });
  return {
    context: {
      deviceId,
      userAgent: req.headers.get("user-agent"),
      ipHint: maskIpHint(ipKey),
    },
    deviceIssued: issued,
  };
}

export interface StartedSession {
  session: SessionTokens;
  deviceId: string;
  deviceIssued: boolean;
  newDevice: boolean;
}

/**
 * Giriş/kayıt/yeniden doğrulama sonrası oturum açar. `alertNewDevice` ise ve kullanıcının
 * daha önce oturumu olup bu cihaz hiç görülmediyse güvenlik e-postası kuyruklanır.
 */
export async function startSession(
  req: RequestLike,
  user: { id: string; role: string; tokenVersion?: number },
  opts: { authTime?: number; alertNewDevice?: boolean } = {}
): Promise<StartedSession> {
  const { context, deviceIssued } = sessionContextFrom(req);
  const deviceId = context.deviceId as string;
  let newDevice = false;
  if (opts.alertNewDevice) {
    const [known, prior] = await Promise.all([
      prisma.userSession.count({ where: { userId: user.id, deviceId } }),
      prisma.userSession.count({ where: { userId: user.id } }),
    ]);
    newDevice = prior > 0 && known === 0;
  }
  const session = await issueSession(user, { authTime: opts.authTime, context });
  if (newDevice) await enqueueNewDeviceAlert(user.id, context);
  return { session, deviceId, deviceIssued, newDevice };
}

/** Yeni basılan cihaz çerezini yanıta yazar. */
export function applyDeviceCookie(res: NextResponse, started: StartedSession): void {
  if (started.deviceIssued) setDeviceCookie(res, started.deviceId);
}

async function enqueueNewDeviceAlert(userId: string, context: SessionContext): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true },
  });
  if (!user) return;
  const device = describeUserAgent(context.userAgent);
  const detail = [device, context.ipHint].filter(Boolean).join(" — ") || null;
  await appendOutbox(
    prisma,
    makeEvent<SecurityAlertPayload>(EventTypes.SecurityAlert, userId, "user", {
      alertId: randomUUID(),
      userId,
      to: user.email,
      name: user.firstName,
      kind: "NEW_DEVICE_LOGIN",
      detail,
      occurredAt: new Date().toISOString(),
    })
  );
  await audit(userId, "auth.new_device_login", "User", userId, { device, ipHint: context.ipHint });
}

export interface SessionView {
  id: string;
  current: boolean;
  device: string | null;
  ipHint: string | null;
  createdAt: string;
  lastSeenAt: string;
}

/** Etkin oturumlar (iptal edilmemiş, yenileme süresi dolmamış), en son kullanılan önce. */
export async function listUserSessions(
  userId: string,
  currentSessionId?: string
): Promise<SessionView[]> {
  const cutoff = new Date(Date.now() - getConfig().REFRESH_TOKEN_TTL_SECONDS * 1000);
  const rows = await prisma.userSession.findMany({
    where: { userId, revokedAt: null, lastSeenAt: { gte: cutoff } },
    orderBy: { lastSeenAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    current: r.id === currentSessionId,
    device: describeUserAgent(r.userAgent),
    ipHint: r.ipHint,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  }));
}

/** Tek oturumu uzaktan kapatır (yalnız kendi oturumu; yoksa 404). */
export async function revokeUserSession(userId: string, sessionId: string): Promise<void> {
  const row = await prisma.userSession.findFirst({
    where: { id: sessionId, userId, revokedAt: null },
    select: { id: true },
  });
  if (!row) throw new NotFoundError("Oturum bulunamadı");
  await revokeFamily(row.id);
  await audit(userId, "auth.session_revoked", "UserSession", row.id);
}

/** Mevcut oturum dışındaki tüm oturumları kapatır; kapatılan sayısını döner. */
export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string | undefined
): Promise<number> {
  const rows = await prisma.userSession.findMany({
    where: {
      userId,
      revokedAt: null,
      ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
    },
    select: { id: true },
  });
  for (const r of rows) await revokeFamily(r.id);
  if (rows.length > 0) {
    await audit(userId, "auth.sessions_revoked_others", "User", userId, { count: rows.length });
  }
  return rows.length;
}

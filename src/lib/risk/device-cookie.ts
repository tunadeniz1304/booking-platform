import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { NextResponse } from "next/server";
import { getJwtSecret } from "@/lib/auth/tokens";
import { getConfig } from "@/lib/config/app-config";

/**
 * Sunucu tarafı imzalı cihaz kimliği (v4#13).
 *
 * Fraud kuralları (yeni cihaz / aynı cihazda çok hesap) eskiden istemcinin gönderdiği
 * parmak izine güveniyordu; saldırgan her istekte farklı değer yollayarak kuralları
 * sıfırlayabiliyordu. Artık kimlik sunucuda üretilir, `did` httpOnly çerezinde
 * `<id>.<hmac>` biçiminde tutulur ve HMAC doğrulanmadan kullanılmaz. Anahtar, JWT sırrından
 * alan ayrımıyla türetilir (ayrı sır gerektirmez; JWT sırrı dönerse cihazlar "yeni" olur).
 */

export const DEVICE_COOKIE = "did";
const ID_BYTES = 16;
const ID_PATTERN = /^[a-f0-9]{32}$/;

function key(): Buffer {
  return createHmac("sha256", getJwtSecret()).update("device-id-cookie:v1").digest();
}

function mac(id: string): string {
  return createHmac("sha256", key()).update(id).digest("base64url");
}

export function signDeviceId(id: string): string {
  return `${id}.${mac(id)}`;
}

/** İmzası geçerliyse cihaz kimliğini, değilse `null` döner. */
export function readDeviceId(cookieValue: string | null | undefined): string | null {
  if (!cookieValue) return null;
  const [id, sig, extra] = cookieValue.split(".");
  if (!id || !sig || extra !== undefined || !ID_PATTERN.test(id)) return null;
  const expected = Buffer.from(mac(id));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
}

/**
 * İstekteki geçerli cihaz kimliği ya da yeni üretilmiş kimlik. `issued=true` ise çağıran
 * yanıtta `setDeviceCookie` ile çerezi yazmalıdır.
 */
export function resolveDeviceId(cookies: { get(name: string): { value: string } | undefined }): {
  deviceId: string;
  issued: boolean;
} {
  const existing = readDeviceId(cookies.get(DEVICE_COOKIE)?.value);
  if (existing) return { deviceId: existing, issued: false };
  return { deviceId: randomBytes(ID_BYTES).toString("hex"), issued: true };
}

export function setDeviceCookie(res: NextResponse, deviceId: string): void {
  res.cookies.set(DEVICE_COOKIE, signDeviceId(deviceId), {
    httpOnly: true,
    sameSite: "lax",
    // Oturum çerezleriyle aynı kural (cookies.ts).
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: getConfig().DEVICE_COOKIE_DAYS * 86_400,
  });
}

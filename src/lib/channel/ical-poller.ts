import dns from "node:dns";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { prisma } from "@/lib/prisma";
import { getConfig } from "@/lib/config/app-config";
import { NotFoundError, ValidationError } from "@/lib/http/errors";
import { logger, errorFields } from "@/lib/observability/logger";
import { assertFetchableUrl, isPrivateAddress } from "@/lib/security/url";
import { importCalendar, type ImportResult } from "./channel";

/**
 * iCal yoklayıcı (P1-9, v3#21): harici kanal takvimlerini `ICAL_POLL_MINUTES` aralığıyla
 * koşullu GET (ETag / If-Modified-Since) ile çeker ve `importCalendar` ile uzlaştırır.
 *
 * SSRF: yalnızca https; bağlanılacak IP DNS çözümlemesinden sonra doğrulanır (özel/iç
 * ağ → ret), yönlendirme izlenmez, gövde `ICAL_MAX_BYTES` ile, süre `ICAL_FETCH_TIMEOUT_MS`
 * ile sınırlıdır. Ağ hatası aboneliği düşürmez; durum satıra yazılır, sonraki turda denenir.
 */

export interface ConditionalHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

export type FetchOutcome =
  | { status: "not_modified" }
  | { status: "ok"; body: string; etag: string | null; lastModified: string | null };

export type IcalFetcher = (url: string, cond: ConditionalHeaders) => Promise<FetchOutcome>;

/** DNS sonucu özel adres içeriyorsa bağlantıyı reddeden `lookup` kancası. */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error("İç ağ adresine istek yapılamaz"), "", 0);
    }
    if (options.all)
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

/** Varsayılan fetcher: SSRF korumalı, zaman aşımlı, boyut sınırlı https GET. */
export const safeIcalFetch: IcalFetcher = (raw, cond) => {
  const url = assertFetchableUrl(raw);
  const { ICAL_FETCH_TIMEOUT_MS, ICAL_MAX_BYTES } = getConfig();
  const headers: Record<string, string> = { accept: "text/calendar, text/plain;q=0.5" };
  if (cond.etag) headers["if-none-match"] = cond.etag;
  if (cond.lastModified) headers["if-modified-since"] = cond.lastModified;
  return new Promise<FetchOutcome>((resolve, reject) => {
    const req = https.request(
      url,
      { method: "GET", headers, lookup: guardedLookup, timeout: ICAL_FETCH_TIMEOUT_MS },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code === 304) {
          res.resume();
          return resolve({ status: "not_modified" });
        }
        if (code !== 200) {
          res.resume();
          return reject(new Error(`Uzak takvim HTTP ${code} döndü`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > ICAL_MAX_BYTES) {
            req.destroy(new Error("Uzak takvim boyut sınırını aştı"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: "ok",
            body: Buffer.concat(chunks).toString("utf8"),
            etag: typeof res.headers.etag === "string" ? res.headers.etag : null,
            lastModified: res.headers["last-modified"] ?? null,
          })
        );
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("Uzak takvim zaman aşımı")));
    req.on("error", reject);
    req.end();
  });
};

export interface PollableSubscription {
  id: string;
  roomTypeId: string;
  source: string;
  url: string;
  etag: string | null;
  lastModified: string | null;
}

export type PollResult =
  | { status: "not_modified" }
  | { status: "ok"; import: ImportResult }
  | { status: "error"; error: string };

/** Tek aboneliği yoklar; sonucu satıra yazar. Hata fırlatmaz. */
export async function pollSubscription(
  sub: PollableSubscription,
  fetcher: IcalFetcher = safeIcalFetch
): Promise<PollResult> {
  const now = new Date();
  try {
    const fetched = await fetcher(sub.url, { etag: sub.etag, lastModified: sub.lastModified });
    if (fetched.status === "not_modified") {
      await prisma.icalSubscription.update({
        where: { id: sub.id },
        data: { lastPolledAt: now, lastStatus: "not_modified", lastError: null },
      });
      return { status: "not_modified" };
    }
    const result = await importCalendar(sub.roomTypeId, fetched.body, sub.source);
    await prisma.icalSubscription.update({
      where: { id: sub.id },
      data: {
        lastPolledAt: now,
        lastStatus: "ok",
        lastError: null,
        etag: fetched.etag?.slice(0, 512) ?? null,
        lastModified: fetched.lastModified?.slice(0, 128) ?? null,
      },
    });
    return { status: "ok", import: result };
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    logger.warn({ ...errorFields(error), subscriptionId: sub.id }, "iCal yoklaması başarısız");
    await prisma.icalSubscription.update({
      where: { id: sub.id },
      data: { lastPolledAt: now, lastStatus: "error", lastError: message },
    });
    return { status: "error", error: message };
  }
}

/** Vadesi gelen (hiç yoklanmamış veya aralığı dolmuş) abonelikleri sırayla yoklar. */
export async function pollDueSubscriptions(
  fetcher: IcalFetcher = safeIcalFetch,
  now = new Date()
): Promise<{ polled: number; ok: number; notModified: number; failed: number }> {
  const { ICAL_POLL_MINUTES, ICAL_POLL_BATCH } = getConfig();
  const cutoff = new Date(now.getTime() - ICAL_POLL_MINUTES * 60_000);
  const due = await prisma.icalSubscription.findMany({
    where: { active: true, OR: [{ lastPolledAt: null }, { lastPolledAt: { lte: cutoff } }] },
    orderBy: [{ lastPolledAt: { sort: "asc", nulls: "first" } }],
    take: ICAL_POLL_BATCH,
    select: { id: true, roomTypeId: true, source: true, url: true, etag: true, lastModified: true },
  });
  const summary = { polled: due.length, ok: 0, notModified: 0, failed: 0 };
  for (const sub of due) {
    const r = await pollSubscription(sub, fetcher);
    if (r.status === "ok") summary.ok += 1;
    else if (r.status === "not_modified") summary.notModified += 1;
    else summary.failed += 1;
  }
  return summary;
}

/** Abonelik ekler/günceller (oda + kaynak başına tek). URL SSRF kontrolünden geçer. */
export async function upsertSubscription(roomId: string, source: string, url: string) {
  try {
    assertFetchableUrl(url);
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }
  return prisma.icalSubscription.upsert({
    where: { roomTypeId_source: { roomTypeId: roomId, source } },
    create: { roomTypeId: roomId, source, url },
    update: { url, active: true, etag: null, lastModified: null, lastPolledAt: null },
  });
}

export function listSubscriptions(roomId: string) {
  return prisma.icalSubscription.findMany({
    where: { roomTypeId: roomId },
    orderBy: { createdAt: "asc" },
  });
}

export async function deleteSubscription(roomId: string, id: string): Promise<void> {
  const { count } = await prisma.icalSubscription.deleteMany({ where: { id, roomTypeId: roomId } });
  if (count === 0) throw new NotFoundError("Abonelik bulunamadı");
}

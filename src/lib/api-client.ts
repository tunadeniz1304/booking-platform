"use client";

import { clearOfflineUserData } from "@/lib/pwa/client";

/**
 * İstemci tarafı API yardımcıları.
 *
 * Kimlik YALNIZCA httpOnly çerezlerde taşınır (JS token'a erişemez → XSS ile
 * token sızmaz). Erişim token'ı süresi dolunca (401) bir kez
 * `POST /api/auth/refresh` denenir ve istek tekrarlanır.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Ağ kesintisi (fetch'in TypeError'ı: "Failed to fetch" / "Load failed") mi? Arayüz bu
 * durumda ham tarayıcı metni yerine yerelleştirilmiş "bağlantı kurulamadı" göstermeli (F52).
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

/** Yanıt süresinde gelmeyen isteğin `ApiError.code` değeri (status 0). */
export const TIMEOUT_CODE = "TIMEOUT";

/**
 * İstek zaman aşımına mı uğradı (F401)? İşlem sunucuda yine de tamamlanmış olabilir: ödeme
 * akışları bu durumda kaydın son hâlini yeniden okumalı (Idempotency-Key ile tekrar güvenli).
 */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof ApiError && err.code === TIMEOUT_CODE;
}

/**
 * Oturum süresi doldu (401 + yenileme başarısız) olayı (F402). Yalnız bu sekmede daha önce
 * oturum görüldüyse ve olay başına bir kez yayılır; `SessionExpiredDialog` dinler.
 */
export const SESSION_EXPIRED_EVENT = "session-expired";

/** Bu sekmede oturum görüldü mü (hiç giriş yapmamış ziyaretçiye "oturum doldu" denmez). */
let sessionSeen = false;

/**
 * Sunucunun JS'e açık oturum ipucu (`has_session=1`, sır içermez): yenileme çerezi httpOnly ve
 * yalnız `/api/auth`'a gittiğinden oturumun varlığı ancak bununla bilinir. İpucu yoksa anonim
 * ziyaretçi için `/api/user/me` ve `/api/auth/refresh` istekleri (401) hiç gönderilmez (F1145).
 */
function hasSessionHint(): boolean {
  return typeof document === "undefined" || /(?:^|;\s*)has_session=1/.test(document.cookie);
}

function notifySessionExpired(): void {
  if (!sessionSeen || typeof window === "undefined") return;
  sessionSeen = false;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

/** Varsayılan istek süresi; ödeme ve LLM uçları daha uzun, dosya yüklemeleri en uzun (F401). */
const DEFAULT_TIMEOUT_MS = 20_000;
const SLOW_TIMEOUT_MS = 45_000;
const UPLOAD_TIMEOUT_MS = 120_000;

/** Kart ödemesi/3DS onayı, paylaşımlı ve devir ödemesi ile LLM çağıran uçlar. */
const SLOW_PATHS = [
  /^\/api\/(?:ai|pay|search\/smart|support\/chat|transfers\/claim)(?:[/?]|$)/,
  /^\/api\/(?:search|properties|admin\/reviews|admin\/events)(?:\?|$)/,
  /\/(?:pay|confirm|draft|summary|suggestions)(?:[/?]|$)/,
];

function canTimeout(): boolean {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function";
}

function defaultTimeout(path: string, body: RequestInit["body"]): number {
  if (typeof FormData !== "undefined" && body instanceof FormData) return UPLOAD_TIMEOUT_MS;
  return SLOW_PATHS.some((re) => re.test(path)) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function isAbortTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "same-origin",
    ...(canTimeout() ? { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) } : {}),
  })
    .then((res) => {
      if (res.ok) sessionSeen = true;
      return res.ok;
    })
    .catch(() => false)
    .finally(() => {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

async function toApiError(res: Response): Promise<ApiError> {
  // Teknik, dilden bağımsız varsayılan: arayüz metni `useErrorText` ile yerelleştirilir (F515).
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  let details: unknown;
  try {
    const body = (await res.json()) as { error?: string; code?: string; details?: unknown };
    if (body.error) message = body.error;
    code = body.code;
    details = body.details;
  } catch {
    // yanıt JSON değilse varsayılan mesaj
  }
  return new ApiError(res.status, message, code, details);
}

export type ApiFetchOptions = RequestInit & {
  /**
   * Zaman aşımı (ms); `0` kapatır. Verilmezse uca göre seçilir. Çağıran kendi `signal`'ini
   * verdiyse uygulanmaz (iptal ve süre çağıranda).
   */
  timeoutMs?: number;
};

/**
 * Zaman aşımında `ApiError(0, "TIMEOUT", "TIMEOUT")` fırlatır (bkz. `isTimeoutError`); ağ
 * hatası `TypeError` olarak kalır (`isNetworkError`).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const { timeoutMs, ...rest } = options;
  let ms = 0;
  if (!rest.signal && canTimeout()) ms = timeoutMs ?? defaultTimeout(path, rest.body);
  // Her deneme (401 → yenileme → tekrar) kendi süresiyle başlar.
  const send = () =>
    fetch(path, {
      ...rest,
      credentials: "same-origin",
      headers: {
        // FormData (dosya yükleme): tarayıcı multipart sınırını kendisi yazar.
        ...(rest.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(rest.headers as Record<string, string> | undefined),
      },
      ...(ms > 0 ? { signal: AbortSignal.timeout(ms) } : {}),
    });

  try {
    let res = await send();
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      // İpucu yoksa yenileme çerezi de yoktur: yenileme denenmez (bu sekmede oturum görülmediyse).
      if ((hasSessionHint() || sessionSeen) && (await refreshSession())) res = await send();
      else notifySessionExpired();
    }
    if (!res.ok) throw await toApiError(res);
    return (await res.json()) as T;
  } catch (err) {
    if (ms > 0 && isAbortTimeout(err)) throw new ApiError(0, TIMEOUT_CODE, TIMEOUT_CODE);
    throw err;
  }
}

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "USER" | "HOST" | "ADMIN";
  /** E-posta doğrulandı mı (`/api/user/me`; ham zaman damgası gönderilmez). */
  emailVerified: boolean;
}

/**
 * Oturumdaki kullanıcı; oturum yoksa (ipucu çerezi yok ya da 401/403/404) `null`. Ağ hatası,
 * zaman aşımı ve 5xx'te fırlatır (F403): çağıran "giriş yapılmamış" ile "oturum bilgisi
 * alınamadı"yı ayırmalı.
 */
export async function fetchCurrentUser(): Promise<SessionUser | null> {
  // Oturum ipucu yok → anonim ziyaretçi; sunucuya sorulmaz (konsolda 401 gürültüsü olmaz).
  if (!hasSessionHint()) return null;
  try {
    const user = await apiFetch<SessionUser>("/api/user/me");
    sessionSeen = true;
    return user;
  } catch (err) {
    if (err instanceof ApiError && [401, 403, 404].includes(err.status)) return null;
    throw err;
  }
}

export async function logout(): Promise<void> {
  sessionSeen = false;
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // ağ hatasında çerezler sunucu tarafında zaten kısa ömürlü
  }
  // P1-12: paylaşılan cihazda çevrimdışı seyahat planı bir sonraki kullanıcıya kalmasın.
  await clearOfflineUserData();
}

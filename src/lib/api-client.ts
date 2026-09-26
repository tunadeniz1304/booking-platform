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

let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    });
  return refreshing;
}

async function toApiError(res: Response): Promise<ApiError> {
  let message = `İstek başarısız (${res.status})`;
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

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const init: RequestInit = {
    ...options,
    credentials: "same-origin",
    headers: {
      // FormData (dosya yükleme): tarayıcı multipart sınırını kendisi yazar.
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers as Record<string, string> | undefined),
    },
  };

  let res = await fetch(path, init);
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    if (await refreshSession()) res = await fetch(path, init);
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "USER" | "HOST" | "ADMIN";
}

/** Oturumdaki kullanıcı (yoksa `null`). */
export async function fetchCurrentUser(): Promise<SessionUser | null> {
  try {
    return await apiFetch<SessionUser>("/api/user/me");
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // ağ hatasında çerezler sunucu tarafında zaten kısa ömürlü
  }
  // P1-12: paylaşılan cihazda çevrimdışı seyahat planı bir sonraki kullanıcıya kalmasın.
  await clearOfflineUserData();
}

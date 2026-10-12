import { ApiError } from "@/lib/api-client";

interface RawResponse {
  status: number;
  text: string;
}

function send(
  path: string,
  body: FormData,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => signal?.removeEventListener("abort", onAbort);
    xhr.open("POST", path);
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      done();
      resolve({ status: xhr.status, text: xhr.responseText });
    };
    // fetch ile aynı sözleşme: ağ kesintisi TypeError olarak atılır (isNetworkError).
    xhr.onerror = () => {
      done();
      reject(new TypeError("Network request failed"));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      done();
      reject(new DOMException("Aborted", "AbortError"));
    };
    xhr.send(body);
  });
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * `apiFetch` ile aynı sözleşmede (çerezle kimlik, 401'de bir kez oturum yenileme, hata
 * gövdesinden `ApiError`) FormData yükler; farkı, gönderim ilerlemesini 0–1 arası oran
 * olarak bildirmesidir (`fetch` yükleme ilerlemesi vermez).
 */
export async function apiUploadWithProgress<T = unknown>(
  path: string,
  body: FormData,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<T> {
  let res = await send(path, body, onProgress, signal);
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (refreshed) {
      onProgress?.(0);
      res = await send(path, body, onProgress, signal);
    }
  }
  const parsed = parseJson(res.text);
  if (res.status < 200 || res.status >= 300) {
    const err = (parsed ?? {}) as { error?: string; code?: string; details?: unknown };
    throw new ApiError(res.status, err.error ?? `HTTP ${res.status}`, err.code, err.details);
  }
  return parsed as T;
}

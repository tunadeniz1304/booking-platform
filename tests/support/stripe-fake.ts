/**
 * Ağsız Stripe HTTP taklidi: SDK'ya `createFetchHttpClient(fake)` ile verilir.
 * Kayıtlı yanıt biçimleri Stripe API'sinin test modu çıktılarından sadeleştirilmiştir.
 */
export interface StripeCall {
  method: string;
  path: string;
  body: URLSearchParams;
  idempotencyKey: string | null;
}

export type StripeRoute = (call: StripeCall) => { status?: number; body: unknown } | undefined;

export function stripeFake(route: StripeRoute) {
  const calls: StripeCall[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call: StripeCall = {
      method: init?.method ?? "GET",
      path: new URL(String(url)).pathname,
      body: new URLSearchParams(String(init?.body ?? "")),
      idempotencyKey: new Headers(init?.headers).get("Idempotency-Key"),
    };
    calls.push(call);
    const out = route(call) ?? {
      status: 404,
      body: { error: { type: "invalid_request_error", code: "resource_missing" } },
    };
    return new Response(JSON.stringify(out.body), {
      status: out.status ?? 200,
      headers: { "content-type": "application/json", "request-id": "req_fake" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

export function intent(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    body: { id, object: "payment_intent", status, client_secret: `${id}_secret_x`, ...extra },
  };
}

"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";

interface Msg {
  id: string;
  senderId: string;
  senderRole: string;
  body: string;
  maskedKinds: string[];
  fromAiDraft: boolean;
  createdAt: string;
}

interface ThreadResponse {
  role: "GUEST" | "HOST";
  canWrite: boolean;
  messages: Msg[];
}

/**
 * Rezervasyon yazışması (P1-6). Canlı güncelleme SSE ile (çerez kimliği); iletişim
 * bilgileri sunucuda maskelenir. Ev sahibi yapay zekâ taslağı isteyebilir, ancak
 * taslak yalnızca kutuya yazılır — göndermek ev sahibinin onayıdır.
 */
export default function BookingMessages({ bookingId }: { bookingId: string }) {
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [text, setText] = useState("");
  const [fromDraft, setFromDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const add = useCallback((m: Msg) => {
    setThread((t) =>
      t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ThreadResponse>(`/api/bookings/${bookingId}/messages`)
      .then((t) => {
        if (!cancelled) setThread(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Mesajlar yüklenemedi");
      });
    const es = new EventSource(`/api/bookings/${bookingId}/messages/stream`);
    es.addEventListener("message", (e) => {
      try {
        add(JSON.parse((e as MessageEvent<string>).data) as Msg);
      } catch {
        // bozuk olay yok sayılır
      }
    });
    return () => {
      cancelled = true;
      es.close();
    };
  }, [bookingId, add]);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView?.({ block: "nearest" });
  }, [thread?.messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { message } = await apiFetch<{ message: Msg }>(`/api/bookings/${bookingId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: text, fromAiDraft: fromDraft }),
      });
      add(message);
      setText("");
      setFromDraft(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mesaj gönderilemedi");
    } finally {
      setBusy(false);
    }
  }

  async function draft() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ draft: string }>(`/api/bookings/${bookingId}/messages/draft`, {
        method: "POST",
      });
      setText(res.draft);
      setFromDraft(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Taslak oluşturulamadı");
    } finally {
      setBusy(false);
    }
  }

  if (!thread) {
    return (
      <section aria-labelledby="msg-title" className="border-t border-gray-100 pt-6">
        <h2 id="msg-title" className="text-lg font-semibold text-gray-900">
          Mesajlar
        </h2>
        <p className="mt-2 text-sm text-gray-500">{error ?? "Yükleniyor..."}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="msg-title" className="border-t border-gray-100 pt-6">
      <h2 id="msg-title" className="text-lg font-semibold text-gray-900">
        Mesajlar
      </h2>
      <p className="mt-1 text-xs text-gray-500">
        Güvenliğiniz için telefon, e-posta, IBAN ve bağlantılar otomatik gizlenir; ödemeyi yalnızca
        platform üzerinden yapın.
      </p>
      <ol ref={listRef} aria-live="polite" className="mt-4 max-h-80 space-y-2 overflow-y-auto">
        {thread.messages.length === 0 && (
          <li className="text-sm text-gray-500">Henüz mesaj yok.</li>
        )}
        {thread.messages.map((m) => {
          const mine = m.senderRole === thread.role;
          return (
            <li key={m.id} className={mine ? "text-right" : "text-left"}>
              <div
                className={`inline-block max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  mine ? "bg-[#003580] text-white" : "bg-gray-100 text-gray-900"
                }`}
              >
                <span className="sr-only">
                  {m.senderRole === "HOST" ? "Ev sahibi" : "Misafir"}:{" "}
                </span>
                {m.body}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {new Date(m.createdAt).toLocaleString("tr-TR")}
                {m.maskedKinds.length > 0 && " · iletişim bilgisi gizlendi"}
              </div>
            </li>
          );
        })}
      </ol>
      {thread.canWrite ? (
        <form onSubmit={send} className="mt-4 space-y-2">
          <label htmlFor="msg-body" className="sr-only">
            Mesajınız
          </label>
          <textarea
            id="msg-body"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm"
            placeholder="Mesajınızı yazın"
          />
          {fromDraft && (
            <p className="text-xs text-amber-800">
              Yapay zekâ taslağı — göndermeden önce kontrol edin ve düzenleyin.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !text.trim()}
              className="rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Gönder
            </button>
            {thread.role === "HOST" && (
              <button
                type="button"
                onClick={() => void draft()}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
              >
                Yanıt taslağı öner
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm text-gray-500">
          Mesajlaşma yalnızca onaylı rezervasyonlarda açıktır.
        </p>
      )}
    </section>
  );
}

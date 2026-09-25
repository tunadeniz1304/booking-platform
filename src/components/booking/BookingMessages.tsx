"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";

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
  const t = useTranslations("chat");
  const f = useFormat();
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [text, setText] = useState("");
  const [fromDraft, setFromDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const add = useCallback((m: Msg) => {
    setThread((prev) =>
      prev && !prev.messages.some((x) => x.id === m.id)
        ? { ...prev, messages: [...prev.messages, m] }
        : prev
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<ThreadResponse>(`/api/bookings/${bookingId}/messages`)
      .then((res) => {
        if (!cancelled) setThread(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t("loadFailed"));
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
  }, [bookingId, add, t]);

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
      setError(err instanceof ApiError ? err.message : t("sendFailed"));
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
      setError(err instanceof ApiError ? err.message : t("draftFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (!thread) {
    return (
      <section aria-labelledby="msg-title" className="border-t border-gray-100 pt-6">
        <h2 id="msg-title" className="text-lg font-semibold text-gray-900">
          {t("title")}
        </h2>
        <p className="mt-2 text-sm text-gray-500">{error ?? t("loading")}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="msg-title" className="border-t border-gray-100 pt-6">
      <h2 id="msg-title" className="text-lg font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p className="mt-1 text-xs text-gray-500">{t("safetyNotice")}</p>
      <ol ref={listRef} aria-live="polite" className="mt-4 max-h-80 space-y-2 overflow-y-auto">
        {thread.messages.length === 0 && <li className="text-sm text-gray-500">{t("empty")}</li>}
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
                  {m.senderRole === "HOST" ? t("host") : t("guest")}:{" "}
                </span>
                {m.body}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {f.dateTime(m.createdAt)}
                {m.maskedKinds.length > 0 && ` · ${t("contactMasked")}`}
              </div>
            </li>
          );
        })}
      </ol>
      {thread.canWrite ? (
        <form onSubmit={send} className="mt-4 space-y-2">
          <label htmlFor="msg-body" className="sr-only">
            {t("inputLabel")}
          </label>
          <textarea
            id="msg-body"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm"
            placeholder={t("placeholder")}
          />
          {fromDraft && <p className="text-xs text-amber-800">{t("aiDraftNotice")}</p>}
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
              {t("send")}
            </button>
            {thread.role === "HOST" && (
              <button
                type="button"
                onClick={() => void draft()}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
              >
                {t("suggestDraft")}
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm text-gray-500">{t("closed")}</p>
      )}
    </section>
  );
}

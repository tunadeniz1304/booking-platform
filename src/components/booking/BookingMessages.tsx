"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { focusRing, loginHref, useErrorText } from "@/components/ui/ui";

interface Msg {
  id: string;
  senderId: string;
  senderRole: string;
  body: string;
  maskedKinds: string[];
  fromAiDraft: boolean;
  createdAt: string;
  /** P1-6 dolandırıcılık taraması (yalnızca alıcıya bant olarak gösterilir). */
  risk?: { level: "WARN" | "HIGH"; reasons: string[] } | null;
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
export default function BookingMessages({
  bookingId,
  divider = true,
}: {
  bookingId: string;
  /** Üstte ayırıcı çizgi; kart içinde tek bölüm olarak kullanılınca kapatılır. */
  divider?: boolean;
}) {
  const t = useTranslations("chat");
  const tt = useTranslations("trust");
  const f = useFormat();
  const errorText = useErrorText();
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [text, setText] = useState("");
  const [fromDraft, setFromDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Kullanıcı listenin dibindeyse (ya da kendi mesajını gönderdiyse) yeni mesajda dibe kaydırılır. */
  const stickToBottom = useRef(true);
  const sectionClass = divider ? "border-t border-gray-100 pt-6" : undefined;

  /** Sunucu metnini doğrudan basmak yerine bilinen durumları çeviriyle eşler. */
  const describeError = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof ApiError) {
        if (err.status === 403 || err.status === 404) return t("notFound");
        if (!err.code) return fallback;
      }
      return errorText(err);
    },
    [errorText, t]
  );

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
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
        else setError(describeError(err, t("loadFailed")));
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
  }, [bookingId, add, t, describeError]);

  // Yalnız liste kabı kaydırılır (sayfa değil); eski mesajları okuyan kullanıcının
  // görünümü gelen yeni mesajla çekilmez.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length]);

  function onListScroll() {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    // Düğme odakta kalsın diye `disabled` yerine aria-disabled + erken dönüş kullanılır.
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { message } = await apiFetch<{ message: Msg }>(`/api/bookings/${bookingId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: text, fromAiDraft: fromDraft }),
      });
      stickToBottom.current = true;
      add(message);
      setText("");
      setFromDraft(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MESSAGE_BLOCKED")
        setError(tt("message.blocked"));
      else if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
      else setError(describeError(err, t("sendFailed")));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function draft() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ draft: string }>(`/api/bookings/${bookingId}/messages/draft`, {
        method: "POST",
      });
      setText(res.draft);
      setFromDraft(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
      else setError(describeError(err, t("draftFailed")));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const loginPrompt = (
    <p className="mt-2 text-sm text-gray-700">
      {t.rich("loginRequired", {
        link: (chunks) => (
          <Link
            href={loginHref()}
            className={`font-semibold text-[#003580] underline ${focusRing}`}
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );

  if (!thread) {
    return (
      <section aria-labelledby="msg-title" className={sectionClass}>
        <h2 id="msg-title" className="text-lg font-semibold text-gray-900">
          {t("title")}
        </h2>
        {needsLogin ? (
          loginPrompt
        ) : (
          <p aria-live="polite" className="mt-2 text-sm text-gray-500">
            {error ?? t("loading")}
          </p>
        )}
      </section>
    );
  }

  const sendDisabled = busy || !text.trim();

  return (
    <section aria-labelledby="msg-title" className={sectionClass}>
      <h2 id="msg-title" className="text-lg font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p className="mt-1 text-xs text-gray-500">{t("safetyNotice")}</p>
      {/* Kaydırılabilir kap klavyeyle odaklanabilir (Safari kaydırıcıyı kendiliğinden odaklamaz). */}
      <div
        ref={listRef}
        role="log"
        aria-labelledby="msg-title"
        tabIndex={0}
        onScroll={onListScroll}
        className="mt-4 max-h-80 overflow-y-auto"
      >
        <ol className="space-y-2">
          {thread.messages.length === 0 && <li className="text-sm text-gray-500">{t("empty")}</li>}
          {thread.messages.map((m) => {
            const mine = m.senderRole === thread.role;
            return (
              <li key={m.id} className={mine ? "text-right" : "text-left"}>
                {!mine && m.risk && (
                  <div
                    role="alert"
                    className={`mb-1 max-w-[80%] rounded-md border px-3 py-2 text-left text-xs ${
                      m.risk.level === "HIGH"
                        ? "border-red-300 bg-red-50 text-red-900"
                        : "border-amber-300 bg-amber-50 text-amber-900"
                    }`}
                  >
                    <p className="font-semibold">
                      {m.risk.level === "HIGH" ? tt("message.highTitle") : tt("message.warnTitle")}
                    </p>
                    <p>{tt("message.advice")}</p>
                    <p className="mt-1">
                      {tt("message.reasonsLabel")}{" "}
                      {m.risk.reasons
                        .map((r) => (tt.has(`reasons.${r}`) ? tt(`reasons.${r}`) : r))
                        .join(", ")}
                    </p>
                  </div>
                )}
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
      </div>
      {needsLogin && loginPrompt}
      {thread.canWrite ? (
        <form onSubmit={send} className="mt-4 space-y-2">
          <label htmlFor="msg-body" className="sr-only">
            {t("inputLabel")}
          </label>
          <textarea
            ref={inputRef}
            id="msg-body"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "msg-error" : undefined}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm"
            placeholder={t("placeholder")}
          />
          {fromDraft && <p className="text-xs text-amber-800">{t("aiDraftNotice")}</p>}
          <div aria-live="polite">
            {error && (
              <p id="msg-error" className="text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              aria-disabled={sendDisabled || undefined}
              aria-busy={busy || undefined}
              className="min-h-[44px] rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:min-h-0"
            >
              {t("send")}
            </button>
            {thread.role === "HOST" && (
              <button
                type="button"
                onClick={() => void draft()}
                aria-disabled={busy || undefined}
                aria-busy={busy || undefined}
                className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:min-h-0"
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

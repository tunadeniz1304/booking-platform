"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  LlmBadge,
  Status,
  focusRing,
  inputClass,
  useErrorText,
  useLoader,
  useSession,
} from "@/components/ui/ui";

interface ChatReply {
  reply: string;
  intent: string;
  handoff: { ticketId: string; reason: string } | null;
  disclosure: string;
  llmMode: string;
  ai_generated: true;
}

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  llmMode?: string;
  ticketId?: string;
  /** Yanıtın ilgili olduğu rezervasyon (bağlam satırı). */
  context?: string;
  /** Kullanıcı mesajı: yanıt bekleniyor / gönderilemedi (yeniden denenebilir). */
  status?: "sending" | "failed";
  /** "İnsana bağlan" ile gönderildi; yeniden denemede korunur. */
  requestHuman?: boolean;
}

interface MyBooking {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  property: { title: string };
}

interface MyTicket {
  id: string;
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  createdAt: string;
}

/** `/support?bookingId=…` ile gelinirse o rezervasyon önceden seçilir. */
function initialBookingId(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("bookingId") ?? "";
}

/** `/support?topic=accessibility&propertyId=…&propertyTitle=…`: taslağa konu ve tesis yazılır. */
function initialAccessibilityProperty(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("topic") !== "accessibility") return null;
  return params.get("propertyTitle")?.trim() || params.get("propertyId")?.trim() || "";
}

const MAX_MESSAGE = 1000;
/** Kalan karakter bu sayıya inince sınır uyarısı (bir kez) duyurulur. */
const LIMIT_WARNING_AT = 100;
/** Boş sohbette tıklanabilir örnek sorular (asistanın yanıtlayabildiği konular). */
const SUGGESTIONS = ["bookingStatus", "cancellationQuote", "checkInTimes"] as const;

/** Konuşma sekme kapanana dek sessionStorage'da, kullanıcı kimliğiyle anahtarlı tutulur. */
const STORAGE_PREFIX = "support-chat:";
const MAX_STORED_TURNS = 50;

let turnSeq = 0;
function newTurnId(): string {
  turnSeq += 1;
  return `${Date.now().toString(36)}-${turnSeq}`;
}

function loadTurns(userId: string): Turn[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + userId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is Turn =>
          typeof x === "object" &&
          x !== null &&
          typeof x.id === "string" &&
          (x.role === "user" || x.role === "assistant") &&
          typeof x.text === "string"
      )
      .map((x): Turn => (x.status === "sending" ? { ...x, status: "failed" } : x));
  } catch {
    return [];
  }
}

function saveTurns(userId: string, turns: Turn[]): void {
  try {
    const key = STORAGE_PREFIX + userId;
    if (turns.length === 0) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(turns.slice(-MAX_STORED_TURNS)));
  } catch {
    // depolama kapalı/dolu: konuşma yalnız bellekte kalır
  }
}

/**
 * v5 P1-4: misafir destek sohbeti. Üstte kalıcı "AI ile konuşuyorsunuz" bildirimi
 * (AI Act Md. 50); her asistan yanıtında "AI tarafından üretildi" rozeti; konuşma
 * `role="log"` + `aria-live` ile ekran okuyuculara duyurulur.
 */
export default function SupportChat() {
  const t = useTranslations("support.chat");
  const tStatus = useTranslations("support.admin.status");
  const locale = useLocale();
  const inputId = useId();
  const hintId = useId();
  const counterId = useId();
  const suggestId = useId();
  const bookingSelectId = useId();
  const ticketsHeadingId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const f = useFormat();
  const errorText = useErrorText();
  const session = useSession();
  const userId = session.status === "ready" ? (session.user?.id ?? null) : null;
  const bookings = useLoader(() => apiFetch<MyBooking[]>("/api/bookings"));
  const tickets = useLoader(() => apiFetch<{ tickets: MyTicket[] }>("/api/support/tickets"));
  const [now] = useState(() => Date.now());
  const upcoming = (bookings.data ?? [])
    .filter((b) => b.status !== "CANCELLED" && new Date(b.checkOut).getTime() >= now)
    .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime());
  const [chosenBooking, setChosenBooking] = useState(initialBookingId);
  const selectedBooking =
    upcoming.find((b) => b.id === chosenBooking) ?? (chosenBooking ? undefined : upcoming[0]);
  const bookingLabel = (b: MyBooking) =>
    `${b.property.title} · ${f.date(b.checkIn)} – ${f.date(b.checkOut)}`;
  const [message, setMessage] = useState(() => {
    const property = initialAccessibilityProperty();
    if (property === null) return "";
    const text = t("prefillAccessibility", { property, hasProperty: property ? "yes" : "no" });
    return text.slice(0, MAX_MESSAGE);
  });
  /** Yapıştırılan metin `maxLength` yüzünden kısaltıldı mı (uyarı gösterilir). */
  const [truncated, setTruncated] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Oturum belli olunca kayıtlı konuşma geri yüklenir (yenileme/gezinme sonrası).
  if (userId && userId !== restoredFor) {
    setRestoredFor(userId);
    setTurns((prev) => [...loadTurns(userId), ...prev]);
  }

  useEffect(() => {
    if (restoredFor) saveTurns(restoredFor, turns);
  }, [restoredFor, turns]);

  // Yeni tur ve bekleme göstergesi görünür kalsın (animasyonsuz: hareket azaltmaya uygun).
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns, busy]);

  const ask = async (text: string, requestHuman = false) => {
    if (!text || busy) return;
    const id = newTurnId();
    setBusy(true);
    setError(null);
    // Aynı metnin gönderilemeyen kopyası yerine yenisi konur (yeniden deneme).
    setTurns((prev) => [
      ...prev.filter((x) => !(x.status === "failed" && x.text === text)),
      { id, role: "user", text, status: "sending", ...(requestHuman ? { requestHuman } : {}) },
    ]);
    // Taslak yalnız gönderilen metinse temizlenir ("İnsana bağlan" taslağı silmez).
    setMessage((cur) => (cur.trim() === text ? "" : cur));
    const booking = selectedBooking;
    try {
      const res = await apiFetch<ChatReply>("/api/support/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          locale: locale === "en" ? "en" : "tr",
          ...(booking ? { bookingId: booking.id } : {}),
          ...(requestHuman ? { requestHuman: true } : {}),
        }),
      });
      setTurns((prev) => [
        ...prev.map((x): Turn => (x.id === id ? { ...x, status: undefined } : x)),
        {
          id: newTurnId(),
          role: "assistant",
          text: res.reply,
          llmMode: res.llmMode,
          ticketId: res.handoff?.ticketId,
          context: booking ? bookingLabel(booking) : undefined,
        },
      ]);
      if (res.handoff) tickets.reload();
    } catch (err) {
      setTurns((prev) => prev.map((x): Turn => (x.id === id ? { ...x, status: "failed" } : x)));
      // Yazılan metin kaybolmasın: kutu boşsa geri konur (düzenlenip yeniden gönderilebilir).
      if (!requestHuman) setMessage((cur) => (cur === "" ? text : cur));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    void ask(message.trim());
  };

  /** Ctrl+Enter / ⌘+Enter gönderir; düz Enter yeni satır açar. */
  const onMessageKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void ask(message.trim());
  };

  const onMessagePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const kept = el.value.length - (el.selectionEnd - el.selectionStart);
    setTruncated(kept + e.clipboardData.getData("text/plain").length > MAX_MESSAGE);
  };

  const retry = (turn: Turn) => {
    inputRef.current?.focus();
    void ask(turn.text, turn.requestHuman);
  };

  /** Örnek soru düğmesi kaybolacağı için odak mesaj kutusuna alınır. */
  const askSuggestion = (text: string) => {
    inputRef.current?.focus();
    void ask(text);
  };

  const startOver = () => {
    setTurns([]);
    setError(null);
    inputRef.current?.focus();
  };

  /** P2-1 "İnsana bağlan": metinden bağımsız, doğrudan insan kuyruğuna devir. */
  const connectHuman = () => void ask(t("humanMessage"), true);
  const handedOff = turns.some((turn) => turn.ticketId);
  const myTickets = tickets.data?.tickets ?? [];
  const remaining = MAX_MESSAGE - message.length;
  const limitNote =
    truncated && remaining <= 0
      ? t("truncated", { max: MAX_MESSAGE })
      : remaining <= LIMIT_WARNING_AT
        ? t("nearLimit", { max: MAX_MESSAGE })
        : "";

  return (
    <Card id="support-chat">
      <p
        className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"
        data-ai-disclosure="true"
      >
        {t("disclosure")}
      </p>
      {myTickets.length > 0 && (
        <section aria-labelledby={ticketsHeadingId} className="mb-4">
          <h2 id={ticketsHeadingId} className="text-sm font-semibold text-gray-900">
            {t("tickets")}
          </h2>
          <ul className="mt-1 space-y-1 break-words text-sm text-gray-700">
            {myTickets.map((ticket) => (
              <li key={ticket.id}>
                {t("ticketLine", {
                  id: ticket.id,
                  date: f.date(ticket.createdAt),
                  status: tStatus(ticket.status),
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t("log")}
        tabIndex={0}
        className={`mb-4 max-h-[50dvh] space-y-3 overflow-y-auto overscroll-contain rounded-md sm:max-h-96 ${focusRing}`}
      >
        {turns.length === 0 && <p className="text-sm text-gray-600">{t("empty")}</p>}
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={
              turn.role === "user"
                ? "ml-8 rounded-lg bg-gray-100 p-3 text-sm text-gray-900"
                : "mr-8 rounded-lg border border-gray-200 p-3 text-sm text-gray-900"
            }
          >
            <p className="mb-1 text-xs font-semibold text-gray-700">
              {turn.role === "user" ? t("you") : t("assistant")}{" "}
              {turn.role === "assistant" && <LlmBadge mode={turn.llmMode} />}
            </p>
            {turn.context && (
              <p className="mb-1 text-xs text-gray-700">
                {t("context", { booking: turn.context })}
              </p>
            )}
            <p className="whitespace-pre-line">{turn.text}</p>
            {turn.ticketId && (
              <p className="mt-2 text-xs font-medium text-amber-900">
                {t("handoff", { id: turn.ticketId })}
              </p>
            )}
            {turn.status === "failed" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-red-700">{t("failed")}</p>
                <Button type="button" variant="secondary" onClick={() => retry(turn)} busy={busy}>
                  {t("retry")}
                </Button>
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-gray-600">{t("thinking")}</p>}
      </div>
      {turns.length === 0 && (
        <div className="mb-4">
          <p id={suggestId} className="text-sm font-medium text-gray-900">
            {t("suggestTitle")}
          </p>
          <ul aria-labelledby={suggestId} className="mt-2 flex flex-wrap gap-2">
            {SUGGESTIONS.map((key) => (
              <li key={key}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => askSuggestion(t(`suggest.${key}`))}
                  disabled={busy}
                >
                  {t(`suggest.${key}`)}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={send} aria-busy={busy} className="space-y-2">
        {upcoming.length > 0 && (
          <div>
            <label htmlFor={bookingSelectId} className="block text-sm font-medium text-gray-900">
              {t("bookingLabel")}
            </label>
            <select
              id={bookingSelectId}
              className={inputClass}
              value={selectedBooking?.id ?? ""}
              onChange={(e) => setChosenBooking(e.target.value)}
            >
              {!selectedBooking && <option value="">{t("bookingNone")}</option>}
              {upcoming.map((b) => (
                <option key={b.id} value={b.id}>
                  {bookingLabel(b)}
                </option>
              ))}
            </select>
          </div>
        )}
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-900">
          {t("label")}
        </label>
        <textarea
          ref={inputRef}
          id={inputId}
          aria-describedby={`${hintId} ${counterId}`}
          className={inputClass}
          rows={3}
          maxLength={MAX_MESSAGE}
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (e.target.value.length < MAX_MESSAGE) setTruncated(false);
          }}
          onKeyDown={onMessageKeyDown}
          onPaste={onMessagePaste}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p id={hintId} className="text-xs text-gray-600">
              {t("standaloneHint")} {t("hint")} {t("shortcutHint")}
            </p>
            <p role="status" className="text-xs font-medium text-amber-900">
              {limitNote}
            </p>
          </div>
          <p id={counterId} className="shrink-0 text-xs tabular-nums text-gray-600">
            {t("counter", { count: message.length, max: MAX_MESSAGE })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || message.trim() === ""}>
            {busy ? t("sending") : t("send")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={connectHuman}
            disabled={busy || handedOff}
            data-testid="support-connect-human"
          >
            {t("connectHuman")}
          </Button>
          {turns.length > 0 && (
            <Button type="button" variant="secondary" onClick={startOver} disabled={busy}>
              {t("newConversation")}
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-600">{handedOff ? t("humanPending") : t("humanHint")}</p>
      </form>
      <Status error={error} />
    </Card>
  );
}

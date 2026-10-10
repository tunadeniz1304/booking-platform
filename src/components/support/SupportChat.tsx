"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  LlmBadge,
  Status,
  inputClass,
  useErrorText,
  useLoader,
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
  role: "user" | "assistant";
  text: string;
  llmMode?: string;
  ticketId?: string;
  /** Yanıtın ilgili olduğu rezervasyon (bağlam satırı). */
  context?: string;
}

interface MyBooking {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  property: { title: string };
}

/** `/support?bookingId=…` ile gelinirse o rezervasyon önceden seçilir. */
function initialBookingId(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("bookingId") ?? "";
}

const MAX_MESSAGE = 1000;

/**
 * v5 P1-4: misafir destek sohbeti. Üstte kalıcı "AI ile konuşuyorsunuz" bildirimi
 * (AI Act Md. 50); her asistan yanıtında "AI tarafından üretildi" rozeti; konuşma
 * `role="log"` + `aria-live` ile ekran okuyuculara duyurulur.
 */
export default function SupportChat() {
  const t = useTranslations("support.chat");
  const locale = useLocale();
  const inputId = useId();
  const hintId = useId();
  const bookingSelectId = useId();
  const f = useFormat();
  const errorText = useErrorText();
  const bookings = useLoader(() => apiFetch<MyBooking[]>("/api/bookings"));
  const [now] = useState(() => Date.now());
  const upcoming = (bookings.data ?? [])
    .filter((b) => b.status !== "CANCELLED" && new Date(b.checkOut).getTime() >= now)
    .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime());
  const [chosenBooking, setChosenBooking] = useState(initialBookingId);
  const selectedBooking =
    upcoming.find((b) => b.id === chosenBooking) ?? (chosenBooking ? undefined : upcoming[0]);
  const bookingLabel = (b: MyBooking) =>
    `${b.property.title} · ${f.date(b.checkIn)} – ${f.date(b.checkOut)}`;
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async (text: string, requestHuman = false) => {
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setTurns((prev) => [...prev, { role: "user", text }]);
    setMessage("");
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
        ...prev,
        {
          role: "assistant",
          text: res.reply,
          llmMode: res.llmMode,
          ticketId: res.handoff?.ticketId,
          context: booking ? bookingLabel(booking) : undefined,
        },
      ]);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    void ask(message.trim());
  };

  /** P2-1 "İnsana bağlan": metinden bağımsız, doğrudan insan kuyruğuna devir. */
  const connectHuman = () => void ask(t("humanMessage"), true);
  const handedOff = turns.some((turn) => turn.ticketId);

  return (
    <Card id="support-chat">
      <p
        className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"
        data-ai-disclosure="true"
      >
        {t("disclosure")}
      </p>
      <div
        role="log"
        aria-live="polite"
        aria-label={t("log")}
        className="mb-4 max-h-96 space-y-3 overflow-y-auto"
      >
        {turns.length === 0 && <p className="text-sm text-gray-600">{t("empty")}</p>}
        {turns.map((turn, i) => (
          <div
            key={i}
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
          </div>
        ))}
      </div>
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
          id={inputId}
          aria-describedby={hintId}
          className={inputClass}
          rows={3}
          maxLength={MAX_MESSAGE}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <p id={hintId} className="text-xs text-gray-600">
          {t("hint")}
        </p>
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
        </div>
        <p className="text-xs text-gray-600">{handedOff ? t("humanPending") : t("humanHint")}</p>
      </form>
      <Status error={error} />
    </Card>
  );
}

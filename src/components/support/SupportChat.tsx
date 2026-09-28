"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Button, Card, LlmBadge, Status, errorMessage, inputClass } from "@/components/ui/ui";

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
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setTurns((prev) => [...prev, { role: "user", text }]);
    setMessage("");
    try {
      const res = await apiFetch<ChatReply>("/api/support/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, locale: locale === "en" ? "en" : "tr" }),
      });
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.reply,
          llmMode: res.llmMode,
          ticketId: res.handoff?.ticketId,
        },
      ]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

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
            <p className="whitespace-pre-line">{turn.text}</p>
            {turn.ticketId && (
              <p className="mt-2 text-xs font-medium text-amber-900">
                {t("handoff", { id: turn.ticketId })}
              </p>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={send} className="space-y-2">
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
        <Button type="submit" disabled={busy || message.trim() === ""}>
          {busy ? t("sending") : t("send")}
        </Button>
      </form>
      <Status error={error} />
    </Card>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Field, Status, inputClass } from "@/components/ui/ui";
import { useClaimErrorText, type ClaimDetailResponse } from "./shared";

type Message = ClaimDetailResponse["messages"][number];

/** Sistem mesajları kod olarak saklanır ("SLA_BREACH", "PSP_DISPUTE_CREATED:needs_response"). */
function useMessageText() {
  const t = useTranslations("resolution.messages");
  return (m: Message): string => {
    if (m.role !== "SYSTEM") return m.body;
    if (m.body === "SLA_BREACH") return t("slaBreach");
    if (m.body.startsWith("PSP_")) {
      const [, status] = m.body.split(":");
      return t("psp", { status: status ?? m.body });
    }
    return m.body;
  };
}

/** Talep yazışması + yanıt kutusu (`canReply` false ise yalnızca okunur). */
export default function ClaimMessages({
  claimId,
  messages,
  canReply,
  onSent,
}: {
  claimId: string;
  messages: Message[];
  canReply: boolean;
  onSent: () => void;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const text = useMessageText();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const inputId = `claim-msg-${claimId}`;

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setFeedback({});
    try {
      await apiFetch(`/api/claims/${encodeURIComponent(claimId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: body.trim() }),
      });
      setBody("");
      setFeedback({ message: t("messages.sent") });
      onSent();
    } catch (err) {
      setFeedback({ error: claimError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900">{t("messages.title")}</h3>
      {messages.length === 0 ? (
        <p className="text-sm text-gray-700">{t("messages.empty")}</p>
      ) : (
        <ol className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-md p-3 text-sm ${
                m.role === "SYSTEM"
                  ? "bg-gray-100 italic text-gray-800"
                  : m.mine
                    ? "ml-6 bg-blue-50 text-gray-900"
                    : "mr-6 border border-gray-200 bg-white text-gray-900"
              }`}
            >
              <p className="text-xs text-gray-600">
                {m.mine ? t("messages.you") : t(`role.${m.role}`)} · {f.dateTime(m.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{text(m)}</p>
            </li>
          ))}
        </ol>
      )}
      {canReply && (
        <form onSubmit={send} className="space-y-2">
          <Field label={t("messages.label")} id={inputId}>
            <textarea
              id={inputId}
              rows={3}
              className={inputClass}
              value={body}
              maxLength={4000}
              required
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy || !body.trim()}>
            {busy ? t("messages.sending") : t("messages.send")}
          </Button>
        </form>
      )}
      <Status error={feedback.error} message={feedback.message} />
    </div>
  );
}

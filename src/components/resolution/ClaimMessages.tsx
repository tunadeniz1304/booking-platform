"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Field, Status, inputClass } from "@/components/ui/ui";
import { ResendVerificationButton } from "@/components/auth/AuthCard";
import {
  isEmailNotVerifiedError,
  useClaimErrorText,
  useDisputeText,
  usePartyLabel,
  type ClaimDetailResponse,
  type ClaimRole,
  type ClaimType,
} from "./shared";

type Message = ClaimDetailResponse["messages"][number];

/** Sunucu sınırı (claims.ts: trim sonrası en fazla 4000). */
const MESSAGE_MAX = 4000;
/** Bu uzunluktan sonra sınıra yaklaşıldığı (bir kez) duyurulur. */
const MESSAGE_WARN_AT = 3600;
/** Talep aktifken ve sekme görünürken yazışma bu aralıkla yenilenir. */
const POLL_MS = 30_000;

/** Sistem mesajları kod olarak saklanır ("SLA_BREACH", "PSP_DISPUTE_CREATED:needs_response"). */
function useMessageText() {
  const t = useTranslations("resolution.messages");
  const dispute = useDisputeText();
  return (m: Message): string => {
    if (m.role !== "SYSTEM") return m.body;
    if (m.body === "SLA_BREACH") return t("slaBreach");
    if (m.body.startsWith("PSP_")) return dispute.event(m.body);
    return m.body;
  };
}

/**
 * Talep yazışması + yanıt kutusu (`canReply` false ise yalnızca okunur). `live` iken
 * (varsayılan: `canReply`) sekme görünürken 30 sn'de bir `onRefresh` (varsayılan: `onSent`)
 * çağrılır; karşı taraftan gelen yeni mesajlar canlı bölgede duyurulur.
 */
export default function ClaimMessages({
  claimId,
  messages,
  canReply,
  onSent,
  viewerRole,
  live,
  onRefresh,
  refreshing = false,
  headingLevel = 2,
  claimType,
}: {
  claimId: string;
  messages: Message[];
  canReply: boolean;
  onSent: () => void;
  /** Görüntüleyenin rolü: yanıtlayan tarafın ilk mesajında düğme "Yanıtımı gönder" olur. */
  viewerRole?: ClaimRole;
  live?: boolean;
  onRefresh?: () => void;
  /** Üst bileşen yeniden yüklerken "Yenile" düğmesi meşgul gösterilir. */
  refreshing?: boolean;
  /** Başlık düzeyi; içinde bulunduğu kartın diğer kart başlıklarıyla aynı düzeyde olmalı. */
  headingLevel?: 2 | 3;
  /** Verilirse gönderen "Misafir" / "Ev sahibi" olarak gösterilir; yoksa genel rol adı. */
  claimType?: ClaimType;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const text = useMessageText();
  const partyLabel = usePartyLabel();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [seen, setSeen] = useState({ claimId, messages, newCount: 0 });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const checkedAtRef = useRef(checkedAt);
  const inputId = `claim-msg-${claimId}`;
  const polling = live ?? canReply;
  const refresh = onRefresh ?? onSent;
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Yenilemeyle gelen, başkasına ait yeni mesajlar sayılır (canlı bölgede duyurulur).
  if (seen.messages !== messages) {
    const known = new Set(seen.messages.map((m) => m.id));
    const newCount =
      seen.claimId === claimId ? messages.filter((m) => !m.mine && !known.has(m.id)).length : 0;
    setSeen({ claimId, messages, newCount });
  }

  useEffect(() => {
    if (!polling) return;
    const tick = () => {
      if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      const now = Date.now();
      checkedAtRef.current = now;
      setCheckedAt(now);
      refreshRef.current();
    };
    const timer = setInterval(tick, POLL_MS);
    // Sekmeye dönünce son kontrolün üzerinden yeterince zaman geçtiyse hemen yenile.
    const onVisible = () => {
      if (Date.now() - checkedAtRef.current >= POLL_MS) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [polling]);

  function markChecked() {
    const now = Date.now();
    checkedAtRef.current = now;
    setCheckedAt(now);
  }

  function refreshNow() {
    markChecked();
    refresh();
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = body.trim();
    setFeedback({});
    setNeedsVerify(false);
    const error = !trimmed
      ? t("messages.required")
      : trimmed.length > MESSAGE_MAX
        ? t("messages.tooLong", { max: MESSAGE_MAX, count: body.length })
        : null;
    setFieldError(error);
    if (error) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/claims/${encodeURIComponent(claimId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: trimmed }),
      });
      setBody("");
      setFeedback({ message: t("messages.sent") });
      markChecked();
      onSent();
      // Odak yeni mesaj için yanıt kutusuna döner.
      inputRef.current?.focus();
    } catch (err) {
      setFeedback({ error: claimError(err) });
      setNeedsVerify(isEmailNotVerifiedError(err));
    } finally {
      setBusy(false);
    }
  }

  const Heading = headingLevel === 3 ? "h3" : "h2";
  const isAdmin = viewerRole === "ADMIN";
  const countText = t("messages.count", { count: body.length, max: MESSAGE_MAX });
  const firstReply =
    viewerRole === "RESPONDENT" && !messages.some((m) => m.mine && m.role !== "SYSTEM");
  const limitNote =
    body.length > MESSAGE_MAX
      ? t("messages.overLimit", { max: MESSAGE_MAX, over: body.length - MESSAGE_MAX })
      : body.length >= MESSAGE_WARN_AT
        ? t("messages.nearLimit", { max: MESSAGE_MAX })
        : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Heading className="text-lg font-semibold text-gray-900">{t("messages.title")}</Heading>
        {polling && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs text-gray-600">
              {t("messages.lastChecked", { time: f.time(new Date(checkedAt)) })}
            </p>
            <Button variant="secondary" busy={refreshing} onClick={refreshNow}>
              {t("messages.refresh")}
            </Button>
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {seen.newCount > 0 ? t("messages.newCount", { count: seen.newCount }) : ""}
        </p>
      </div>
      {messages.length === 0 ? (
        <p className="text-sm text-gray-700">{t("messages.empty")}</p>
      ) : (
        <ol className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`min-w-0 rounded-md p-3 text-sm ${
                m.role === "SYSTEM"
                  ? "bg-gray-100 italic text-gray-800"
                  : m.mine
                    ? "ml-6 bg-blue-50 text-gray-900"
                    : "mr-6 border border-gray-200 bg-white text-gray-900"
              }`}
            >
              <p className="text-xs text-gray-600">
                {m.mine ? t("messages.you") : partyLabel(claimType, m.role)} ·{" "}
                {f.dateTime(m.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {text(m)}
              </p>
            </li>
          ))}
        </ol>
      )}
      {canReply && (
        <form onSubmit={send} noValidate className="space-y-2">
          <Field
            label={isAdmin ? t("messages.adminLabel") : t("messages.label")}
            id={inputId}
            hint={isAdmin ? `${t("messages.adminHint")} ${countText}` : countText}
            error={fieldError}
          >
            <textarea
              ref={inputRef}
              id={inputId}
              rows={3}
              className={inputClass}
              value={body}
              required
              onChange={(e) => {
                setBody(e.target.value);
                const trimmed = e.target.value.trim();
                if (fieldError && trimmed && trimmed.length <= MESSAGE_MAX) setFieldError(null);
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button type="submit" busy={busy}>
              {busy
                ? t("messages.sending")
                : firstReply
                  ? t("messages.sendFirstReply")
                  : t("messages.send")}
            </Button>
            <p aria-live="polite" className="text-xs text-gray-700">
              {limitNote}
            </p>
          </div>
        </form>
      )}
      <Status error={feedback.error} message={feedback.message} />
      {needsVerify && <ResendVerificationButton />}
    </div>
  );
}

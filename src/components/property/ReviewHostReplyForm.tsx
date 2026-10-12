"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Button, ErrorText, Field, focusRing, inputClass, useErrorText } from "@/components/ui/ui";

/** reply API sınırları (`/api/reviews/[id]/reply`: trim sonrası 2–1000 karakter). */
const REPLY_MIN = 2;
const REPLY_MAX = 1000;

/**
 * İlanın ev sahibi için yanıtsız yoruma yanıt formu (F942). Yayımlanınca `onReplied` yanıtı
 * listeye işler; form yerinde kalan onay metnine odak taşır.
 */
export default function ReviewHostReplyForm({
  reviewId,
  author,
  onReplied,
}: {
  reviewId: string;
  author: string;
  onReplied: (text: string, repliedAt: string | null) => void;
}) {
  const t = useTranslations("reviews.reply");
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const wasOpen = useRef(false);
  const panelId = `reply-panel-${reviewId}`;
  const fieldId = `reply-${reviewId}`;

  useEffect(() => {
    if (open) textRef.current?.focus();
    else if (wasOpen.current) (doneRef.current ?? triggerRef.current)?.focus();
    wasOpen.current = open;
  }, [open]);

  async function submit() {
    if (busy) return;
    const value = text.trim();
    if (value.length < REPLY_MIN) {
      setFieldError(t("tooShort", { min: REPLY_MIN }));
      textRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<{ hostReply?: string | null; hostRepliedAt?: string | null }>(
        `/api/reviews/${reviewId}/reply`,
        { method: "POST", body: JSON.stringify({ text: value }) }
      );
      onReplied(saved.hostReply ?? value, saved.hostRepliedAt ?? null);
      setDone(true);
      setOpen(false);
    } catch (e) {
      setError(errorText(e, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p ref={doneRef} tabIndex={-1} className={`mt-2 text-xs text-gray-700 ${focusRing}`}>
        <span aria-hidden="true">{"✓"} </span>
        {t("done")}
      </p>
    );
  }

  return (
    <div className="mt-3 text-sm">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex min-h-[44px] items-center font-semibold text-[#003580] underline sm:min-h-0 ${focusRing}`}
      >
        {t("open")}
        <span className="sr-only"> {t("openContext", { author })}</span>
      </button>
      {open && (
        <div
          id={panelId}
          className="mt-2 max-w-xl space-y-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <Field
            id={fieldId}
            label={t("label")}
            hint={t("hint", { min: REPLY_MIN, max: REPLY_MAX, count: text.length })}
            error={fieldError}
            required
          >
            <textarea
              ref={textRef}
              id={fieldId}
              rows={4}
              maxLength={REPLY_MAX}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (fieldError) setFieldError(null);
              }}
              className={inputClass}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button busy={busy} onClick={() => void submit()}>
              {busy ? t("sending") : t("submit")}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </div>
      )}
    </div>
  );
}

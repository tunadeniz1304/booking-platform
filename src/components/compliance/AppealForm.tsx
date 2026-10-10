"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, Field, Status, inputClass } from "@/components/ui/ui";

/** DSA md. 20 itiraz formu (P2-1a): gerekçe (≥20 karakter) + imzalı bağlantı belirteci. */
export default function AppealForm({
  noticeId,
  role,
  token,
}: {
  noticeId: string;
  role: "REPORTER" | "HOST";
  token: string;
}) {
  const t = useTranslations("compliance.appeal");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state !== "sent") return;
    doneRef.current?.scrollIntoView({ block: "start" });
    doneRef.current?.focus();
  }, [state]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending") return;
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
    if (reason.length < 20) {
      setFieldError(t("reasonTooShort"));
      // Odak alana taşınır: etiket, aria-invalid ve hata metni birlikte okunur.
      document.getElementById("appeal-reason")?.focus();
      return;
    }
    setFieldError(null);
    setState("sending");
    setError(null);
    const res = await fetch(`/api/notices/${encodeURIComponent(noticeId)}/appeals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, token, reason, locale: locale === "en" ? "en" : "tr" }),
    }).catch(() => null);
    if (res?.status === 201) {
      setReference(((await res.json()) as { id: string }).id);
      setState("sent");
      return;
    }
    setState("idle");
    const code = res ? ((await res.json().catch(() => ({}))) as { code?: string }).code : null;
    setError(
      res?.status === 429
        ? t("rateLimited")
        : code === "APPEAL_EXISTS"
          ? t("alreadySubmitted")
          : code === "APPEAL_WINDOW_CLOSED"
            ? t("windowClosed")
            : t("error")
    );
  };

  return (
    <Card title={t("formTitle")} id="appeal-form">
      <div aria-live="polite">
        {state === "sent" && (
          <>
            <h3
              ref={doneRef}
              tabIndex={-1}
              className="scroll-mt-24 text-base font-semibold text-gray-900"
            >
              {t("sentTitle")}
            </h3>
            <p className="mt-2 text-sm text-green-800">{t("sent", { reference })}</p>
          </>
        )}
      </div>
      {state !== "sent" && (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field id="appeal-reason" label={t("reason")} hint={t("reasonHint")} error={fieldError}>
            <textarea
              id="appeal-reason"
              name="reason"
              required
              minLength={20}
              maxLength={5000}
              rows={6}
              className={inputClass}
              onChange={(e) => {
                if (fieldError && e.currentTarget.value.trim().length >= 20) setFieldError(null);
              }}
            />
          </Field>
          <Button type="submit" busy={state === "sending"}>
            {state === "sending" ? t("sending") : t("submit")}
          </Button>
          <Status error={error} />
        </form>
      )}
    </Card>
  );
}

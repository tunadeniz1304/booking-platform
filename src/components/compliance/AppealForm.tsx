"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  ButtonLink,
  Card,
  Field,
  Status,
  focusFirstInvalid,
  inputClass,
} from "@/components/ui/ui";
import { AppealCharLimitStatus, useAppealCountHint } from "@/components/compliance/AppealCharLimit";

const REASON_MIN = 20;
const REASON_MAX = 5000;
const REQUEST_TIMEOUT_MS = 20_000;

/** Yavaş ağda istek süresiz beklemez; zaman aşımı ağ hatasından ayrı döner. */
async function postAppeal(noticeId: string, body: unknown): Promise<Response | "timeout" | null> {
  try {
    return await fetch(`/api/notices/${encodeURIComponent(noticeId)}/appeals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
        : {}),
    });
  } catch (err) {
    return err instanceof Error && err.name === "TimeoutError" ? "timeout" : null;
  }
}

/** Sunucu yanıtını (`compliance.appeal` içindeki) hata metni anahtarına çevirir. */
function appealErrorKey(status: number | undefined, code: string | undefined): string {
  if (status === 429) return "rateLimited";
  if (code === "APPEAL_EXISTS") return "alreadySubmitted";
  if (code === "APPEAL_WINDOW_CLOSED") return "windowClosed";
  if (code === "NOTICE_NOT_DECIDED") return "notDecided";
  if (code === "APPEAL_TOKEN_INVALID" || status === 403 || status === 404) return "invalidLink";
  return "error";
}

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
  const countHint = useAppealCountHint();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [length, setLength] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state !== "sent") return;
    doneRef.current?.scrollIntoView({ block: "start" });
    doneRef.current?.focus();
  }, [state]);

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(reference);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending") return;
    const form = e.currentTarget;
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    if (reason.length < REASON_MIN) {
      setFieldError(t("reasonTooShort"));
      // Odak, aria-invalid DOM'a yazıldıktan sonra taşınır: etiket ve hata birlikte okunur.
      focusFirstInvalid(form);
      return;
    }
    setFieldError(null);
    setState("sending");
    setError(null);
    const res = await postAppeal(noticeId, {
      role,
      token,
      reason,
      locale: locale === "en" ? "en" : "tr",
    });
    if (res === "timeout") {
      setState("idle");
      setError(t("timeout"));
      return;
    }
    if (res?.status === 201) {
      const created = (await res.json().catch(() => null)) as { id?: string } | null;
      setReference(created?.id ?? "");
      setState("sent");
      return;
    }
    setState("idle");
    const code = res ? ((await res.json().catch(() => ({}))) as { code?: string }).code : undefined;
    setError(t(appealErrorKey(res?.status, code)));
  };

  const copyMessage =
    copyState === "copied" ? t("copied") : copyState === "failed" ? t("copyFailed") : "";

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
            {reference && <p className="mt-2 text-sm text-green-800">{t("sent", { reference })}</p>}
          </>
        )}
      </div>
      {state === "sent" && (
        <>
          {reference && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={copyReference}>
                {t("copyReference")}
              </Button>
              <span role="status" className="text-sm text-gray-600">
                {copyMessage}
              </span>
            </div>
          )}
          <p className="mt-4 text-sm text-gray-800">{t("nextSteps")}</p>
          <div className="mt-5">
            <ButtonLink href="/">{t("home")}</ButtonLink>
          </div>
        </>
      )}
      {state !== "sent" && (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field
            id="appeal-reason"
            label={t("reason")}
            hint={countHint(t("reasonHint"), length, REASON_MAX)}
            error={fieldError}
          >
            <textarea
              id="appeal-reason"
              name="reason"
              required
              minLength={REASON_MIN}
              maxLength={REASON_MAX}
              rows={6}
              className={inputClass}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setLength(value.length);
                if (fieldError && value.trim().length >= REASON_MIN) setFieldError(null);
              }}
            />
          </Field>
          <AppealCharLimitStatus length={length} max={REASON_MAX} />
          <Button type="submit" busy={state === "sending"}>
            {state === "sending" ? t("sending") : t("submit")}
          </Button>
          <Status error={error} />
        </form>
      )}
    </Card>
  );
}

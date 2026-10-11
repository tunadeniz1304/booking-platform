"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, Field, Status } from "@/components/ui/ui";

const CATEGORIES = [
  "ILLEGAL_LISTING",
  "UNLICENSED",
  "FRAUD_SCAM",
  "IP_INFRINGEMENT",
  "DISCRIMINATION",
  "UNSAFE",
  "OTHER",
] as const;

/** Sunucunun (zod) kabul ettiği alanlar; hata sırası formdaki görsel sırayla aynı. */
const FIELDS = ["contentUrl", "category", "explanation", "reporterName", "reporterEmail"] as const;
type FieldName = (typeof FIELDS)[number];
type FieldErrors = Partial<Record<FieldName, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const input =
  "mt-1 w-full rounded-lg border border-gray-500 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]";

/** DSA md. 16 bildirim formu: içerik URL'si, kategori, gerekçe, ad/e-posta, iyi niyet beyanı. */
export default function NoticeForm({ propertyId }: { propertyId?: string }) {
  const t = useTranslations("compliance.report");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [reference, setReference] = useState<string | null>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const defaultUrl =
    propertyId && typeof window !== "undefined"
      ? `${window.location.origin}/property/${propertyId}`
      : "";

  useEffect(() => {
    if (state !== "sent") return;
    doneRef.current?.scrollIntoView({ block: "start" });
    doneRef.current?.focus();
  }, [state]);

  const showFieldErrors = (errors: FieldErrors) => {
    setFieldErrors(errors);
    const first = FIELDS.find((name) => errors[name]);
    if (first) document.getElementById(`notice-${first}`)?.focus();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending") return;
    const form = new FormData(e.currentTarget);
    const explanation = String(form.get("explanation") ?? "");
    const reporterEmail = String(form.get("reporterEmail") ?? "").trim();
    // Sunucu boşlukları kırpar; yalnız boşluktan oluşan metin native minLength'i geçse de reddedilir.
    const clientErrors: FieldErrors = {};
    if (explanation.trim().length < 20) clientErrors.explanation = t("errors.explanation");
    if (!EMAIL_RE.test(reporterEmail)) clientErrors.reporterEmail = t("errors.reporterEmail");
    if (Object.keys(clientErrors).length > 0) {
      setError(null);
      showFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});
    setState("sending");
    setError(null);
    const res = await fetch("/api/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: propertyId || undefined,
        contentUrl: String(form.get("contentUrl") ?? ""),
        category: String(form.get("category") ?? "OTHER"),
        explanation,
        reporterName: String(form.get("reporterName") ?? "") || undefined,
        reporterEmail,
        goodFaith: form.get("goodFaith") === "on",
        locale: locale === "en" ? "en" : "tr",
      }),
    }).catch(() => null);
    if (res?.status === 201) {
      setReference(((await res.json()) as { id: string }).id);
      setState("sent");
      return;
    }
    setState("idle");
    if (res?.status === 400) {
      const body = (await res.json().catch(() => ({}))) as {
        details?: { fieldErrors?: Record<string, string[] | undefined> };
      };
      const serverErrors: FieldErrors = {};
      for (const name of FIELDS) {
        if (body.details?.fieldErrors?.[name]?.length) serverErrors[name] = t(`errors.${name}`);
      }
      if (Object.keys(serverErrors).length > 0) showFieldErrors(serverErrors);
    }
    setError(
      res?.status === 429 ? t("rateLimited") : res?.status === 400 ? t("invalid") : t("error")
    );
  };

  return (
    <Card>
      <div aria-live="polite">
        {state === "sent" && (
          <>
            <h2
              ref={doneRef}
              tabIndex={-1}
              className="scroll-mt-24 text-lg font-semibold text-gray-900"
            >
              {t("sentTitle")}
            </h2>
            <p className="mt-2 text-sm text-green-800">
              {t("sent", { reference: reference ?? "" })}
            </p>
          </>
        )}
      </div>
      {state !== "sent" && (
        <form onSubmit={submit} className="space-y-4">
          <Field id="notice-contentUrl" label={t("contentUrl")} error={fieldErrors.contentUrl}>
            <input
              id="notice-contentUrl"
              name="contentUrl"
              type="url"
              required
              inputMode="url"
              defaultValue={defaultUrl}
              className={input}
            />
          </Field>
          <Field id="notice-category" label={t("category")} error={fieldErrors.category}>
            <select
              id="notice-category"
              name="category"
              required
              className={input}
              defaultValue="ILLEGAL_LISTING"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="notice-explanation" label={t("explanation")} error={fieldErrors.explanation}>
            <textarea
              id="notice-explanation"
              name="explanation"
              required
              minLength={20}
              maxLength={5000}
              rows={5}
              className={input}
              onChange={(e) => {
                if (fieldErrors.explanation && e.currentTarget.value.trim().length >= 20)
                  setFieldErrors((prev) => ({ ...prev, explanation: undefined }));
              }}
            />
          </Field>
          <Field
            id="notice-reporterName"
            label={t("reporterName")}
            error={fieldErrors.reporterName}
          >
            <input
              id="notice-reporterName"
              name="reporterName"
              autoComplete="name"
              maxLength={120}
              className={input}
            />
          </Field>
          <Field
            id="notice-reporterEmail"
            label={t("reporterEmail")}
            error={fieldErrors.reporterEmail}
          >
            <input
              id="notice-reporterEmail"
              name="reporterEmail"
              type="email"
              required
              autoComplete="email"
              className={input}
              onChange={(e) => {
                if (fieldErrors.reporterEmail && EMAIL_RE.test(e.currentTarget.value.trim()))
                  setFieldErrors((prev) => ({ ...prev, reporterEmail: undefined }));
              }}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm text-gray-800">
            <input name="goodFaith" type="checkbox" required className="mt-1" />
            <span>{t("goodFaith")}</span>
          </label>
          <Button type="submit" busy={state === "sending"}>
            {state === "sending" ? t("sending") : t("submit")}
          </Button>
          <Status error={error} />
        </form>
      )}
    </Card>
  );
}

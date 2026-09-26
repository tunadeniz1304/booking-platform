"use client";

import { useState, type FormEvent } from "react";
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

const input =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]";

/** DSA md. 16 bildirim formu: içerik URL'si, kategori, gerekçe, ad/e-posta, iyi niyet beyanı. */
export default function NoticeForm({ propertyId }: { propertyId?: string }) {
  const t = useTranslations("compliance.report");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const defaultUrl =
    propertyId && typeof window !== "undefined"
      ? `${window.location.origin}/property/${propertyId}`
      : "";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState("sending");
    setError(null);
    const res = await fetch("/api/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: propertyId || undefined,
        contentUrl: String(form.get("contentUrl") ?? ""),
        category: String(form.get("category") ?? "OTHER"),
        explanation: String(form.get("explanation") ?? ""),
        reporterName: String(form.get("reporterName") ?? "") || undefined,
        reporterEmail: String(form.get("reporterEmail") ?? ""),
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
    setError(
      res?.status === 429 ? t("rateLimited") : res?.status === 400 ? t("invalid") : t("error")
    );
  };

  if (state === "sent") {
    return (
      <Card>
        <Status message={t("sent", { reference: reference ?? "" })} />
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <Field id="notice-contentUrl" label={t("contentUrl")}>
          <input
            id="notice-contentUrl"
            name="contentUrl"
            type="url"
            required
            defaultValue={defaultUrl}
            className={input}
          />
        </Field>
        <Field id="notice-category" label={t("category")}>
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
        <Field id="notice-explanation" label={t("explanation")}>
          <textarea
            id="notice-explanation"
            name="explanation"
            required
            minLength={20}
            maxLength={5000}
            rows={5}
            className={input}
          />
        </Field>
        <Field id="notice-reporterName" label={t("reporterName")}>
          <input
            id="notice-reporterName"
            name="reporterName"
            autoComplete="name"
            maxLength={120}
            className={input}
          />
        </Field>
        <Field id="notice-reporterEmail" label={t("reporterEmail")}>
          <input
            id="notice-reporterEmail"
            name="reporterEmail"
            type="email"
            required
            autoComplete="email"
            className={input}
          />
        </Field>
        <label className="flex items-start gap-2 text-sm text-gray-800">
          <input name="goodFaith" type="checkbox" required className="mt-1" />
          <span>{t("goodFaith")}</span>
        </label>
        <Button type="submit" disabled={state === "sending"}>
          {state === "sending" ? t("sending") : t("submit")}
        </Button>
        <Status error={error} />
      </form>
    </Card>
  );
}

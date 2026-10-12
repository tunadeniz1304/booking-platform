"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  Button,
  ButtonLink,
  Card,
  Field,
  RequiredLegend,
  Status,
  focusRing,
  inputClass,
  useSession,
} from "@/components/ui/ui";

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
const FIELDS = [
  "contentUrl",
  "category",
  "explanation",
  "reporterName",
  "reporterEmail",
  "goodFaith",
] as const;
type FieldName = (typeof FIELDS)[number];
type FieldErrors = Partial<Record<FieldName, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ERROR_ICON = "⚠︎";

const LINK_CLASS = `font-semibold text-[#003580] underline ${focusRing}`;

const REQUEST_TIMEOUT_MS = 20_000;

/** Yavaş ağda istek süresiz beklemez; zaman aşımı ağ hatasından ayrı döner (metin korunur). */
async function postNotice(body: unknown): Promise<Response | "timeout" | null> {
  try {
    return await fetch("/api/notices", {
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

/** Şemasız adrese (`www.ornek.com/ilan/1`) `https://` eklenir; sunucu tam URL bekler. */
function normalizeUrl(raw: string): string {
  const value = raw.trim();
  if (!value || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

function isWebUrl(value: string): boolean {
  if (value.length > 2000) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** Sunucu şemasının (`noticeInputSchema`) istemci eşi; tüm alanlar tek seferde denetlenir. */
const VALIDATORS: Record<FieldName, (value: string) => boolean> = {
  contentUrl: (v) => isWebUrl(normalizeUrl(v)),
  category: (v) => (CATEGORIES as readonly string[]).includes(v),
  explanation: (v) => v.trim().length >= 20,
  reporterName: (v) => v.trim().length <= 120,
  reporterEmail: (v) => v.trim().length <= 254 && EMAIL_RE.test(v.trim()),
  goodFaith: (v) => v === "on",
};

/** Referans okunur 5'li gruplarla gösterilir; kopyalanan değer gruplanmamış hâlidir. */
const referenceGroups = (reference: string) => reference.match(/.{1,5}/g) ?? [];

const subscribeNever = () => () => {};
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

/** DSA md. 16 bildirim formu: içerik URL'si, kategori, gerekçe, ad/e-posta, iyi niyet beyanı. */
export default function NoticeForm({
  propertyId,
  contentUrl,
  property,
}: {
  propertyId?: string;
  /** Sunucuda (`NEXT_PUBLIC_APP_URL`) kurulmuş ilan adresi; yoksa istemcide türetilir. */
  contentUrl?: string;
  /** Bildirilen ilanın özeti; formun üstündeki salt okunur kartta gösterilir. */
  property?: { title: string; city?: string | null; imageUrl?: string | null };
}) {
  const t = useTranslations("compliance.report");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [reference, setReference] = useState<string | null>(null);
  const [sentEmail, setSentEmail] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // Bildirilen ilan; "Başka bir içerik bildir" seçilince ya da ilan bulunamayınca düşer.
  const [linkedId, setLinkedId] = useState<string | null>(propertyId || null);
  const [url, setUrl] = useState("");
  // Oturum açıksa ad ve e-posta önceden dolar, alanlar düzenlenebilir kalır. Oturum ilk
  // render'dan sonra gelir: kullanıcı alana yazmadıysa yeni `defaultValue` değere yansır.
  const session = useSession();
  const sessionUser = session.status === "ready" ? session.user : null;
  const sessionName = sessionUser
    ? `${sessionUser.firstName} ${sessionUser.lastName}`.trim() || undefined
    : undefined;
  const doneRef = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef<string | null>(null);
  // Sunucu ve ilk istemci render'ı aynı (boş) origin'i görür: hydration uyumsuzluğu olmaz.
  const origin = useSyncExternalStore(subscribeNever, clientOrigin, serverOrigin);
  const linkedPath = linkedId ? `/property/${encodeURIComponent(linkedId)}` : "";
  const linkedUrl = linkedId ? contentUrl || (origin ? `${origin}${linkedPath}` : "") : "";

  useEffect(() => {
    if (state !== "sent") return;
    doneRef.current?.scrollIntoView({ block: "start" });
    doneRef.current?.focus();
  }, [state]);

  // Odak, hedef alan (ör. yeni açılan URL alanı) DOM'a yazıldıktan sonra taşınır.
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    document.getElementById(id)?.focus();
  });

  const showFieldErrors = (errors: FieldErrors) => {
    setFieldErrors(errors);
    const first = FIELDS.find((name) => errors[name]);
    if (first) focusNext.current = `notice-${first}`;
  };

  /** Düzeltilen alanın hatası yazarken kalkar; yeni hata yalnız gönderimde eklenir. */
  const clearFixedError = (e: FormEvent<HTMLFormElement>) => {
    const el = e.target as HTMLInputElement;
    const name = el.name as FieldName;
    if (!fieldErrors[name]) return;
    const value = el.type === "checkbox" ? (el.checked ? "on" : "") : el.value;
    if (VALIDATORS[name](value)) setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const unlinkProperty = () => {
    setLinkedId(null);
    setUrl("");
    setFieldErrors((prev) => ({ ...prev, contentUrl: undefined }));
    focusNext.current = "notice-contentUrl";
  };

  const reportAnother = () => {
    unlinkProperty();
    setFieldErrors({});
    setError(null);
    setReference(null);
    setCopyState("idle");
    setState("idle");
  };

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(reference ?? "");
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state === "sending") return;
    const form = new FormData(e.currentTarget);
    const sentPropertyId = linkedId;
    const values: Record<FieldName, string> = {
      contentUrl: sentPropertyId ? linkedUrl : normalizeUrl(url),
      category: String(form.get("category") ?? ""),
      explanation: String(form.get("explanation") ?? ""),
      reporterName: String(form.get("reporterName") ?? "").trim(),
      reporterEmail: String(form.get("reporterEmail") ?? "").trim(),
      goodFaith: form.get("goodFaith") === "on" ? "on" : "",
    };
    if (!sentPropertyId) setUrl(values.contentUrl);
    const clientErrors: FieldErrors = {};
    for (const name of FIELDS) {
      if (!VALIDATORS[name](values[name])) clientErrors[name] = t(`errors.${name}`);
    }
    if (Object.keys(clientErrors).length > 0) {
      setError(null);
      showFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});
    setState("sending");
    setError(null);
    const res = await postNotice({
      propertyId: sentPropertyId ?? undefined,
      contentUrl: values.contentUrl,
      category: values.category,
      explanation: values.explanation,
      reporterName: values.reporterName || undefined,
      reporterEmail: values.reporterEmail,
      goodFaith: true,
      locale: locale === "en" ? "en" : "tr",
    });
    if (res === "timeout") {
      setState("idle");
      setError(t("timeout"));
      return;
    }
    if (res?.status === 201) {
      const created = (await res.json().catch(() => null)) as { id?: string } | null;
      setReference(created?.id ?? null);
      setSentEmail(values.reporterEmail);
      setState("sent");
      return;
    }
    setState("idle");
    if (res?.status === 400) {
      const body = (await res.json().catch(() => ({}))) as {
        details?: { fieldErrors?: Record<string, string[] | undefined> };
      };
      const reported = body.details?.fieldErrors ?? {};
      const serverErrors: FieldErrors = {};
      for (const name of FIELDS) {
        if (reported[name]?.length) serverErrors[name] = t(`errors.${name}`);
      }
      // Alan hatası yoksa 400 = bağlı ilan bulunamadı: bağ düşer, adres düzenlenebilir kalır.
      if (sentPropertyId && (reported.propertyId?.length || Object.keys(reported).length === 0)) {
        setLinkedId(null);
        setUrl(values.contentUrl);
        serverErrors.contentUrl = t("errors.propertyNotFound");
      }
      if (Object.keys(serverErrors).length > 0) {
        setError(null);
        showFieldErrors(serverErrors);
        return;
      }
    }
    setError(
      res?.status === 429 ? t("rateLimited") : res?.status === 400 ? t("invalid") : t("error")
    );
  };

  const invalidFields = FIELDS.filter((name) => fieldErrors[name]);
  const copyMessage =
    copyState === "copied" ? t("copied") : copyState === "failed" ? t("copyFailed") : "";

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
            <p className="mt-2 text-sm text-green-800">{t("sentEmail", { email: sentEmail })}</p>
          </>
        )}
      </div>
      {state === "sent" && (
        <>
          {reference && (
            <div className="mt-4">
              <p className="text-sm font-medium text-gray-800">{t("referenceLabel")}</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <code className="rounded-md border border-gray-200 px-2 py-1 font-mono text-base text-gray-900">
                  {referenceGroups(reference).map((part, i) => (
                    <span key={i} className="mr-1.5 last:mr-0">
                      {part}
                    </span>
                  ))}
                </code>
                <Button variant="secondary" onClick={copyReference}>
                  {t("copyReference")}
                </Button>
                <span role="status" className="text-sm text-gray-600">
                  {copyMessage}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-600">{t("referenceHint")}</p>
            </div>
          )}
          <h3 className="mt-5 text-base font-semibold text-gray-900">{t("nextTitle")}</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-800">
            <li>{t("next.review")}</li>
            <li>{t("next.decision")}</li>
            <li>{t("next.appeal")}</li>
          </ol>
          <div className="mt-5 flex flex-wrap gap-3">
            {linkedId && <ButtonLink href={linkedPath}>{t("backToListing")}</ButtonLink>}
            <ButtonLink href="/" variant={linkedId ? "secondary" : "primary"}>
              {t("home")}
            </ButtonLink>
            <Button variant="secondary" onClick={reportAnother}>
              {t("reportAnother")}
            </Button>
          </div>
        </>
      )}
      {state !== "sent" && (
        <form onSubmit={submit} onChange={clearFixedError} className="space-y-4" noValidate>
          {invalidFields.length > 0 && (
            <div className="rounded-lg border border-red-700 p-3 text-sm text-red-700">
              <p className="font-semibold">{t("errorSummary", { count: invalidFields.length })}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {invalidFields.map((name) => (
                  <li key={name}>
                    <a
                      href={`#notice-${name}`}
                      className="underline"
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(`notice-${name}`)?.focus();
                      }}
                    >
                      {fieldErrors[name]}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <RequiredLegend />
          {linkedId ? (
            <div
              role="group"
              aria-labelledby="notice-linked-title"
              className="rounded-lg border border-gray-200 p-3"
            >
              <p id="notice-linked-title" className="text-sm font-medium text-gray-800">
                {t("linkedTitle")}
              </p>
              <div className="mt-2 flex items-center gap-3">
                {property?.imageUrl && (
                  <Image
                    src={property.imageUrl}
                    alt=""
                    width={64}
                    height={48}
                    className="h-12 w-16 shrink-0 rounded object-cover"
                  />
                )}
                <div className="min-w-0 text-sm">
                  {property?.title && (
                    <p className="font-semibold text-gray-900">{property.title}</p>
                  )}
                  {property?.city && <p className="text-gray-600">{property.city}</p>}
                  <p className="break-all text-xs text-gray-600">{linkedUrl || linkedPath}</p>
                </div>
              </div>
              <Button variant="secondary" className="mt-3" onClick={unlinkProperty}>
                {t("reportAnother")}
              </Button>
            </div>
          ) : (
            <Field
              id="notice-contentUrl"
              label={t("contentUrl")}
              hint={t("contentUrlHint")}
              error={fieldErrors.contentUrl}
              required
            >
              <input
                id="notice-contentUrl"
                name="contentUrl"
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.currentTarget.value)}
                onBlur={(e) => setUrl(normalizeUrl(e.currentTarget.value))}
                className={inputClass}
              />
            </Field>
          )}
          <Field id="notice-category" label={t("category")} error={fieldErrors.category} required>
            <select id="notice-category" name="category" className={inputClass} defaultValue="">
              <option value="">{t("categoryPlaceholder")}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            id="notice-explanation"
            label={t("explanation")}
            error={fieldErrors.explanation}
            required
          >
            <textarea
              id="notice-explanation"
              name="explanation"
              minLength={20}
              maxLength={5000}
              rows={5}
              className={inputClass}
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
              defaultValue={sessionName}
              className={inputClass}
            />
          </Field>
          <Field
            id="notice-reporterEmail"
            label={t("reporterEmail")}
            hint={t("reporterEmailHint")}
            error={fieldErrors.reporterEmail}
            required
          >
            <input
              id="notice-reporterEmail"
              name="reporterEmail"
              type="email"
              autoComplete="email"
              defaultValue={sessionUser?.email}
              className={inputClass}
            />
          </Field>
          <p className="text-xs text-gray-600">
            {t.rich("privacyNote", {
              link: (c) => (
                <Link href="/privacy" className={LINK_CLASS}>
                  {c}
                </Link>
              ),
            })}
          </p>
          <div>
            <label className="flex items-start gap-2 py-2 text-sm text-gray-800">
              <input
                id="notice-goodFaith"
                name="goodFaith"
                type="checkbox"
                required
                aria-invalid={fieldErrors.goodFaith ? true : undefined}
                aria-describedby={fieldErrors.goodFaith ? "notice-goodFaith-error" : undefined}
                className="h-5 w-5 shrink-0"
              />
              <span>
                {t("goodFaith")}
                <span aria-hidden="true"> *</span>
              </span>
            </label>
            {fieldErrors.goodFaith && (
              <p id="notice-goodFaith-error" className="mt-1 text-xs font-medium text-red-700">
                <span aria-hidden="true">{ERROR_ICON} </span>
                <span className="sr-only">{tc("errorPrefix")} </span>
                {fieldErrors.goodFaith}
              </p>
            )}
          </div>
          <Button type="submit" busy={state === "sending"}>
            {state === "sending" ? t("sending") : t("submit")}
          </Button>
          <Status error={error} />
        </form>
      )}
    </Card>
  );
}

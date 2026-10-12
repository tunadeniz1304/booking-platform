"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import {
  Button,
  Card,
  Field,
  LoadError,
  Status,
  focusFirstInvalid,
  focusRing,
  inputClass,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ReauthCancelledError, useAccountErrorText, useReauth } from "./ReauthDialog";

/**
 * P2-1a / P1-11: yapay zekâ ajanına ödeme yetkisi (AP2 intent mandate) — tutar limiti, süre,
 * isteğe bağlı ilan kısıtı. Verme recent-auth ister (`useReauth`); imzalı belirteç yalnız bir
 * kez gösterilir. Liste denetim kaydından gelir; iptal edilen mandate checkout'ta reddedilir.
 */

interface MandateSummary {
  nonce: string;
  maxAmountMinor: number;
  currency: string;
  expiresAt: string;
  propertyId: string[] | null;
  issuedAt: string;
  status: "active" | "expired" | "revoked";
  used: boolean | null;
}

/** Yetkinin sınırlanabileceği ilan (favori, rezervasyon ya da yapıştırılan bağlantıdan). */
interface PropertyOption {
  id: string;
  title: string;
  city: string | null;
  currency: string | null;
}

interface PropertyRow {
  id: string;
  title: string;
  currency?: string;
  location?: { city: string } | null;
}

const CURRENCIES = ["TRY", "EUR", "USD", "GBP"] as const;
const DURATIONS = [
  { minutes: 60, key: "1h" },
  { minutes: 24 * 60, key: "1d" },
  { minutes: 7 * 24 * 60, key: "7d" },
] as const;
/** Sunucu şemasıyla aynı üst sınır (`issueMandateSchema.propertyIds.max`). */
const MAX_PROPERTIES = 20;

function toOption(p: PropertyRow): PropertyOption {
  return {
    id: p.id,
    title: p.title,
    city: p.location?.city ?? null,
    currency: p.currency ?? null,
  };
}

/** İlan sayfası bağlantısından (…/property/{id}) ya da çıplak kimlikten ilan kimliği. */
function propertyIdFromInput(raw: string): string | null {
  const text = raw.trim();
  const id = /\/property\/([^/?#\s]+)/.exec(text)?.[1] ?? text;
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export default function AgentMandates() {
  const t = useTranslations("account.mandates");
  const tc = useTranslations("common");
  const f = useFormat();
  const reauth = useReauth();
  const { confirm, confirmDialog } = useConfirm();
  const errorText = useAccountErrorText();
  const list = useLoader(() =>
    apiFetch<{ mandates: MandateSummary[] }>("/api/account/agent-mandates").then((r) => r.mandates)
  );
  // F458/F614: ilan kimliği ezberletilmez; favorilerdeki ve rezervasyonlardaki ilanlar seçilir.
  const known = useLoader(async () => {
    const results = await Promise.allSettled([
      apiFetch<{ property?: PropertyRow | null }[]>("/api/favorites"),
      apiFetch<{ property?: PropertyRow | null }[]>("/api/bookings"),
    ]);
    const byId = new Map<string, PropertyOption>();
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const row of r.value) {
        if (row.property && !byId.has(row.property.id)) {
          byId.set(row.property.id, toOption(row.property));
        }
      }
    }
    return [...byId.values()];
  });
  // F1084: `info` kullanıcının kendi vazgeçmesi gibi nötr bilgi (hata ya da başarı değil).
  const [status, setStatus] = useState<{ error?: string; message?: string; info?: string }>({});
  const [amountError, setAmountError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [currency, setCurrency] = useState<string>("TRY");
  const [duration, setDuration] = useState<number>(DURATIONS[0].minutes);
  const [extraOptions, setExtraOptions] = useState<PropertyOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // F617: belge en az bir kez panoya kopyalandı mı (düğme etiketinden bağımsız, kalıcı).
  const [tokenCopied, setTokenCopied] = useState(false);
  const tokenInput = useRef<HTMLTextAreaElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // F188: TR/EN binlik ve ondalık ayırıcıları doğru çözülür ("1.500" = bin beş yüz).
  const previewMinor = amountText.trim() ? parseAmountToMinor(amountText) : null;
  const validMinor = previewMinor !== null && previewMinor > 0 ? previewMinor : null;

  useEffect(() => {
    const timer = copyTimer;
    return () => clearTimeout(timer.current);
  }, []);

  // F617: yeni belge görününce odak (değer seçili) ve görünüm belgeye taşınır.
  useEffect(() => {
    const el = tokenInput.current;
    if (!issued || !el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center" });
  }, [issued]);

  // F617: tek seferlik belge kopyalanmadan sayfadan ayrılırken tarayıcı uyarısı.
  useEffect(() => {
    if (!issued || tokenCopied) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [issued, tokenCopied]);

  // F619: hesap kartlarında tarih + saat orta biçimde ("11 Eki 2026 14:30" / "Oct 11, 2026").
  const dateTimeFormat = useMemo(
    () => new Intl.DateTimeFormat(f.locale, { dateStyle: "medium", timeStyle: "short" }),
    [f.locale]
  );
  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : dateTimeFormat.format(d);
  }

  const knownOptions = known.data ?? [];
  const options = [
    ...knownOptions,
    ...extraOptions.filter((o) => !knownOptions.some((k) => k.id === o.id)),
  ];
  // F613: yetkinin para birimi ilanın fiyat para birimiyle aynı olmalı (MANDATE_CURRENCY_MISMATCH).
  const mismatched = [
    ...new Set(
      options
        .filter((o) => selected.includes(o.id) && o.currency && o.currency !== currency)
        .map((o) => o.currency as string)
    ),
  ];
  const currencyError =
    mismatched.length > 0 ? t("currencyMismatch", { currencies: mismatched.join(", ") }) : null;
  const durationKey = DURATIONS.find((d) => d.minutes === duration)?.key ?? DURATIONS[0].key;
  // F616: gönderilmeden önce neyin verileceği tek cümlede görülür.
  const summary =
    validMinor !== null
      ? t("summary", {
          amount: f.money(validMinor, currency),
          duration: t(`durations.${durationKey}`),
          scope:
            selected.length > 0
              ? t("summaryScopeSome", { count: selected.length })
              : t("summaryScopeAll"),
        })
      : t("summaryEmpty");

  function toggleProperty(id: string, on: boolean) {
    setSelected((prev) => {
      if (!on) return prev.filter((x) => x !== id);
      return prev.includes(id) || prev.length >= MAX_PROPERTIES ? prev : [...prev, id];
    });
  }

  async function addByLink() {
    if (linkBusy) return;
    const id = propertyIdFromInput(linkText);
    if (!id) {
      setLinkError(t("propertyLinkInvalid"));
      return;
    }
    if (!selected.includes(id) && selected.length >= MAX_PROPERTIES) {
      setLinkError(t("propertiesMax", { max: MAX_PROPERTIES }));
      return;
    }
    setLinkError(null);
    setLinkBusy(true);
    try {
      // F614: bilinmeyen kimlik yetkiye girmeden önce ilan uç noktasıyla doğrulanır.
      const option =
        options.find((o) => o.id === id) ??
        toOption(await apiFetch<PropertyRow>(`/api/properties/${encodeURIComponent(id)}`));
      setExtraOptions((prev) => (prev.some((o) => o.id === option.id) ? prev : [...prev, option]));
      setSelected((prev) => (prev.includes(option.id) ? prev : [...prev, option.id]));
      setLinkText("");
      setStatus({ message: t("propertyAdded", { title: option.title }) });
    } catch (err) {
      setLinkError(
        err instanceof ApiError && err.status === 404
          ? t("propertyNotFound")
          : errorText(err, t("propertyLookupFailed"))
      );
    } finally {
      setLinkBusy(false);
    }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const maxAmountMinor = parseAmountToMinor(String(form.get("amount") ?? ""));
    if (maxAmountMinor === null || maxAmountMinor <= 0) {
      setAmountError(maxAmountMinor === null ? t("amountFormat") : t("amountInvalid"));
      // F427: odak aria-invalid DOM'a yazıldıktan sonra taşınır; etiket ve hata birlikte okunur.
      focusFirstInvalid(e.currentTarget);
      return;
    }
    setAmountError(null);
    if (currencyError) {
      focusFirstInvalid(e.currentTarget);
      return;
    }
    // F617: kopyalanmamış belge yeni yetkiyle sessizce ekrandan kalkmasın.
    if (issued && !tokenCopied) {
      const ok = await confirm({
        title: t("replaceTokenTitle"),
        body: t("replaceTokenBody"),
        confirmLabel: t("replaceTokenConfirm"),
        tone: "danger",
      });
      if (!ok) return;
    }
    const propertyIds = selected.slice(0, MAX_PROPERTIES);
    setStatus({});
    setBusy(true);
    try {
      const out = await reauth.run(() =>
        apiFetch<{ mandate: string }>("/api/account/agent-mandates", {
          method: "POST",
          body: JSON.stringify({
            maxAmountMinor,
            currency,
            expiresInMinutes: duration,
            ...(propertyIds.length > 0 ? { propertyIds } : {}),
          }),
        })
      );
      setIssued(out.mandate);
      setCopied(false);
      setTokenCopied(false);
      setStatus({ message: t("created") });
      // F616: aynı düğmeye yeniden basmak ikinci bir yetki üretmesin; form varsayılana döner.
      setAmountText("");
      setSelected([]);
      setDuration(DURATIONS[0].minutes);
      list.reload();
    } catch (err) {
      if (err instanceof ReauthCancelledError) {
        // F1084: vazgeçmek hata değildir; nötr bilgi verilir, odak kaybolduysa düğmeye döner.
        setStatus({ info: t("createCancelled") });
        requestAnimationFrame(() => {
          if (document.activeElement === document.body) submitButton.current?.focus();
        });
      } else {
        setStatus({ error: errorText(err, t("createFailed")) });
      }
    } finally {
      setBusy(false);
    }
  }

  // F583: pano sonucu bildirilir; pano yoksa/izin reddedilirse metin seçilip elle kopyalatılır.
  async function copyToken() {
    if (!issued) return;
    clearTimeout(copyTimer.current);
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(issued);
      setCopied(true);
      setTokenCopied(true);
      setStatus({ message: t("copied") });
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setStatus({ error: t("copyFailed") });
      tokenInput.current?.focus();
      tokenInput.current?.select();
    }
  }

  // F617: kullanıcı belgeyi kaydettiğini onaylayınca kutu kapanır; odak "Yetki ver"e döner.
  function dismissToken() {
    clearTimeout(copyTimer.current);
    setIssued(null);
    setCopied(false);
    setTokenCopied(false);
    setStatus({});
    submitButton.current?.focus();
  }

  async function revoke(m: MandateSummary) {
    if (revoking) return;
    // F189: iptal geri alınamaz — önce hangi yetkinin iptal edileceğini söyleyen onay.
    const ok = await confirm({
      title: t("revokeConfirmTitle"),
      body: t("revokeConfirmBody", {
        amount: f.money(m.maxAmountMinor, m.currency),
        date: when(m.expiresAt),
      }),
      confirmLabel: t("revokeConfirm"),
      tone: "danger",
    });
    if (!ok) return;
    setRevoking(m.nonce);
    setStatus({});
    try {
      await apiFetch(`/api/account/agent-mandates/${encodeURIComponent(m.nonce)}`, {
        method: "DELETE",
      });
      setStatus({ message: t("revoked") });
      list.reload();
    } catch (err) {
      setStatus({ error: errorText(err, t("revokeFailed")) });
    } finally {
      setRevoking(null);
    }
  }

  /** F614: kısıtlı yetkide sayı yerine ilan adları (bilinmeyen kimlik varsa sayı). */
  function scopeText(ids: string[]): string {
    const names = ids.flatMap((id) => options.find((o) => o.id === id)?.title ?? []);
    return names.length === ids.length
      ? t("scopedTo", { names: new Intl.ListFormat(f.locale).format(names) })
      : t("scoped", { count: ids.length });
  }

  const statusClass = {
    active: "bg-green-100 text-green-900",
    expired: "bg-gray-200 text-gray-900",
    revoked: "bg-red-100 text-red-900",
    used: "bg-blue-100 text-blue-900",
  } as const;

  return (
    <div className="mt-6">
      <Card title={t("title")} id="agent-mandates">
        <p className="mb-3 text-sm text-gray-700">{t("intro")}</p>
        {/* F613: tek kullanımlık, ödeme başına üst sınır ve para birimi kuralı açıkça yazılır. */}
        <h3 className="text-sm font-semibold text-gray-900">{t("rulesTitle")}</h3>
        <ul className="mb-3 mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
          <li>{t("rules.singleUse")}</li>
          <li>{t("rules.perBooking")}</li>
          <li>{t("rules.currency")}</li>
        </ul>
        {/* F457: düz dille 3 adımlı kullanım yardımı. */}
        <details className="mb-4">
          <summary
            className={`min-h-[44px] cursor-pointer rounded-md py-2 text-sm font-semibold text-gray-900 ${focusRing}`}
          >
            {t("howTitle")}
          </summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-gray-700">
            <li>{t("howSteps.choose")}</li>
            <li>{t("howSteps.copy")}</li>
            <li>{t("howSteps.share")}</li>
          </ol>
        </details>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-3" noValidate>
          <div>
            <Field
              id="mandate-amount"
              label={t("amount")}
              hint={t("amountHint")}
              error={amountError}
            >
              <input
                id="mandate-amount"
                name="amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                required
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className={inputClass}
              />
            </Field>
            <p aria-live="polite" className="mt-1 min-h-[1rem] text-xs text-gray-700">
              {validMinor !== null
                ? t("amountPreview", { amount: f.money(validMinor, currency) })
                : ""}
            </p>
          </div>
          <Field
            id="mandate-currency"
            label={t("currency")}
            hint={t("currencyHint")}
            error={currencyError}
          >
            <select
              id="mandate-currency"
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={inputClass}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field id="mandate-duration" label={t("duration")}>
            <select
              id="mandate-duration"
              name="duration"
              value={String(duration)}
              onChange={(e) => setDuration(Number(e.target.value))}
              className={inputClass}
            >
              {DURATIONS.map((d) => (
                <option key={d.key} value={d.minutes}>
                  {t(`durations.${d.key}`)}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="sm:col-span-3" aria-describedby="mandate-properties-hint">
            <legend className="text-sm font-medium text-gray-800">{t("properties")}</legend>
            <p id="mandate-properties-hint" className="mt-1 text-xs text-gray-600">
              {t("propertiesHint", { max: MAX_PROPERTIES })}
            </p>
            {options.length > 0 ? (
              <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-gray-200 px-3 py-1">
                {options.map((p) => {
                  const checked = selected.includes(p.id);
                  const meta = [p.city, p.currency].filter(Boolean).join(" · ");
                  return (
                    <li key={p.id}>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-gray-900">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && selected.length >= MAX_PROPERTIES}
                          onChange={(e) => toggleProperty(p.id, e.target.checked)}
                          className={`h-4 w-4 shrink-0 ${focusRing}`}
                        />
                        <span className="min-w-0">
                          {p.title}
                          {meta && <span className="text-gray-600"> · {meta}</span>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              known.data && <p className="mt-2 text-sm text-gray-700">{t("propertiesNone")}</p>
            )}
            <div className="mt-2 flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <Field
                  id="mandate-property-link"
                  label={t("propertyLink")}
                  hint={t("propertyLinkHint")}
                  error={linkError}
                >
                  <input
                    id="mandate-property-link"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    value={linkText}
                    onChange={(e) => setLinkText(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter formu (yetkiyi) göndermesin; yalnız ilanı ekler.
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      void addByLink();
                    }}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Button
                variant="secondary"
                busy={linkBusy}
                className="mt-6"
                onClick={() => void addByLink()}
              >
                {t("propertyAdd")}
              </Button>
            </div>
          </fieldset>
          <div className="sm:col-span-3">
            <p
              id="mandate-summary"
              className="mb-3 rounded-md border border-gray-200 p-3 text-sm text-gray-900"
            >
              {summary}
            </p>
            <Button ref={submitButton} type="submit" busy={busy} aria-describedby="mandate-summary">
              {busy
                ? t("creating")
                : validMinor !== null
                  ? t("createWithAmount", { amount: f.money(validMinor, currency) })
                  : t("create")}
            </Button>
          </div>
        </form>
        {issued && (
          <div className="mt-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
            <p id="mandate-token-note" className="font-semibold">
              {t("tokenOnce")}
            </p>
            <label htmlFor="mandate-token" className="sr-only">
              {t("tokenLabel")}
            </label>
            <textarea
              ref={tokenInput}
              id="mandate-token"
              readOnly
              value={issued}
              rows={3}
              aria-describedby="mandate-token-note"
              className={`${inputClass} font-mono text-xs`}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void copyToken()}>
                {copied ? t("copiedButton") : t("copy")}
              </Button>
              <Button variant="secondary" onClick={dismissToken}>
                {t("tokenDismiss")}
              </Button>
            </div>
          </div>
        )}
        <Status error={status.error} message={status.message} />
        <p role="status" className="text-sm text-gray-700">
          {status.info}
        </p>

        <h3 className="mt-4 text-base font-semibold text-gray-900">{t("listTitle")}</h3>
        {/* F636: liste hatası formun başarı mesajını gizlemez; kendi başlığı altında yenilenir. */}
        {list.error && (
          <div className="mt-2">
            <LoadError error={list.error} onRetry={list.reload} busy={list.loading} />
          </div>
        )}
        {list.data === null && !list.error && (
          <p className="text-sm text-gray-700">{tc("loading")}</p>
        )}
        {list.data?.length === 0 && <p className="text-sm text-gray-700">{t("empty")}</p>}
        <ul className="mt-2 divide-y divide-gray-200">
          {list.data?.map((m) => {
            // F618: kullanılmış etkin yetki yeni ödemede geçmez; tek birleşik durum gösterilir.
            const usedActive = m.status === "active" && m.used === true;
            const expiry = when(m.expiresAt);
            const ends =
              m.status === "expired"
                ? t("expiredOn", { date: expiry })
                : m.status === "active" && !usedActive
                  ? t("validUntil", { date: expiry })
                  : null;
            return (
              <li key={m.nonce} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900">
                    {t("limit", { amount: f.money(m.maxAmountMinor, m.currency) })}
                    <span
                      className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass[usedActive ? "used" : m.status]}`}
                    >
                      {usedActive ? t("statusUsed") : t(`status.${m.status}`)}
                    </span>
                    {m.used && !usedActive && (
                      <span
                        className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass.used}`}
                      >
                        {t("used")}
                      </span>
                    )}
                  </p>
                  {/* F619/F1178: veriliş zamanı görünür; bitiş metni duruma göre ayrılır. */}
                  <p className="text-gray-700">
                    {t("issuedOn", { date: when(m.issuedAt) })}
                    {ends && ` · ${ends}`}
                    {m.propertyId && ` · ${scopeText(m.propertyId)}`}
                  </p>
                </div>
                {m.status === "active" && !usedActive && (
                  <Button
                    variant="danger"
                    busy={revoking === m.nonce}
                    className="min-h-[44px] sm:min-h-0"
                    onClick={() => void revoke(m)}
                    aria-label={t("revokeLabel", {
                      amount: f.money(m.maxAmountMinor, m.currency),
                      date: expiry,
                    })}
                  >
                    {t("revoke")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {reauth.dialog}
      {confirmDialog}
    </div>
  );
}

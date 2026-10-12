"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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
  useErrorText,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/** Bu oranın üstündeki indirimler gönderimden önce onay ister (yanlışlıkla %100). */
const HIGH_DISCOUNT_PERCENT = 50;
/** İndirim önizlemesindeki örnek gecelik fiyat (para birimsiz). */
const EXAMPLE_PRICE = 1000;

/** P1-8: ev sahibi promosyon listesi + oluşturma/düzenleme formu (yüzde ya da sabit tutar). */

const TYPES = ["EARLY_BIRD", "LAST_MINUTE", "LONG_STAY", "MOBILE_RATE", "COUPON"] as const;
type PromotionType = (typeof TYPES)[number];
type ConditionField = "minDaysBefore" | "maxDaysBefore" | "minNights";

interface Promotion {
  id: string;
  propertyId: string | null;
  propertyTitle: string | null;
  name: string;
  type: PromotionType;
  discountBps: number | null;
  discountMinor: number | null;
  currency: string | null;
  minDaysBefore: number | null;
  maxDaysBefore: number | null;
  minNights: number | null;
  couponCode: string | null;
  usageLimit: number | null;
  usageCount: number;
  startsAt?: string | null;
  endsAt?: string | null;
  priority: number;
  stackable: boolean;
  active: boolean;
}

/** Türün koşul alanı (EARLY_BIRD → minDaysBefore …); mobil ve kuponda yok. */
const CONDITION: Partial<Record<PromotionType, ConditionField>> = {
  EARLY_BIRD: "minDaysBefore",
  LAST_MINUTE: "maxDaysBefore",
  LONG_STAY: "minNights",
};

/** Tür değişince koşul bu varsayılana döner; önceki türün değeri taşınmaz (F861). */
const CONDITION_DEFAULT: Partial<Record<PromotionType, string>> = {
  EARLY_BIRD: "30",
  LAST_MINUTE: "3",
  LONG_STAY: "7",
};

/** Sunucu şemasıyla aynı sınırlar (promotion-service.ts). */
const CONDITION_RANGE: Record<ConditionField, { min: number; max: number }> = {
  minDaysBefore: { min: 0, max: 730 },
  maxDaysBefore: { min: 0, max: 730 },
  minNights: { min: 1, max: 365 },
};

/** Öncelik düzeyleri (F863); listede olmayan eski değerler "özel" seçenek olarak kalır. */
const PRIORITY_LEVELS = [
  { key: "priorityLow", value: "-10" },
  { key: "priorityNormal", value: "0" },
  { key: "priorityHigh", value: "10" },
] as const;

const DISCOUNT_KINDS = ["percent", "fixed"] as const;
const KIND_LABEL = { percent: "kindPercent", fixed: "kindFixed" } as const;

type FormField = "name" | "pct" | "amount" | "cond" | "code" | "limit" | "scope" | "prio";
type DateField = "start" | "end";
type FieldErrors = Partial<Record<FormField | DateField, string>>;

/** Sunucu doğrulama hatasındaki alan adı → form alanı (F531). */
const SERVER_FIELD: Record<string, FormField | DateField> = {
  name: "name",
  discountBps: "pct",
  discountMinor: "amount",
  currency: "amount",
  minDaysBefore: "cond",
  maxDaysBefore: "cond",
  minNights: "cond",
  couponCode: "code",
  usageLimit: "limit",
  propertyId: "scope",
  priority: "prio",
  startsAt: "start",
  endsAt: "end",
};

interface FormState {
  name: string;
  type: PromotionType;
  discountKind: (typeof DISCOUNT_KINDS)[number];
  percent: string;
  amount: string;
  condition: string;
  couponCode: string;
  usageLimit: string;
  propertyId: string;
  priority: string;
  stackable: boolean;
  startDate: string;
  endDate: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  type: "EARLY_BIRD",
  discountKind: "percent",
  percent: "10",
  amount: "",
  condition: CONDITION_DEFAULT.EARLY_BIRD ?? "",
  couponCode: "",
  usageLimit: "",
  propertyId: "",
  priority: "0",
  stackable: false,
  startDate: "",
  endDate: "",
};

/** Para birimi için ondalık basamak sayısı (JPY=0, TRY=2 …). */
function fractionDigitsOf(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Yerel takvim günü ("2026-06-01"). */
function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Günün yerel başlangıcı; `addDays` ile sonraki günler (bitiş günü dahil olsun diye +1). */
function startOfLocalDay(day: string, addDays = 0): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + addDays);
  return d.toISOString();
}

/** Bitiş anı hariçtir (`now >= endsAt` → bitti); formda ve listede son geçerli gün gösterilir. */
function lastValidDay(endsAt: string): string {
  return localDay(new Date(new Date(endsAt).getTime() - 1));
}

/** Satır düğmesine odaklanır; dar ekran kartı ile tablodan görünür olan seçilir (F524). */
function focusVisibleAction(refs: Map<string, HTMLButtonElement>, key: string): boolean {
  const el = [key, `${key}:card`]
    .map((k) => refs.get(k))
    .find((button) => button !== undefined && button.getClientRects().length > 0);
  el?.focus();
  return el !== undefined;
}

export default function PromotionsPanel({
  properties,
}: {
  properties: ReadonlyArray<{ id: string; title: string; currency?: string }>;
}) {
  const t = useTranslations("host");
  const f = useFormat();
  const errorText = useErrorText();
  const { data, error, loading, reload } = useLoader(() =>
    apiFetch<{ promotions: Promotion[] }>("/api/host/promotions")
  );
  const promotions = data?.promotions ?? null;
  // Liste eylemlerinin sonucu tablonun üstünde, form sonucu gönder düğmesinin yanında.
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [formStatus, setFormStatus] = useState<{ error?: string; message?: string }>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const advancedRef = useRef<HTMLDetailsElement>(null);
  const actionRefs = useRef(new Map<string, HTMLButtonElement>());
  // Liste yenilenince odaklanacak satır düğmesi ("id:eylem") ya da liste ("list") (F864).
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || data === null) return;
    pendingFocus.current = null;
    if (!focusVisibleAction(actionRefs.current, target)) listRef.current?.focus();
  }, [data]);

  const actionRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) actionRefs.current.set(key, el);
    else actionRefs.current.delete(key);
  };

  /** Alanı günceller; düzeltilen alanların hatası kalkar. */
  function change(patch: Partial<FormState>, ...fields: Array<FormField | DateField>) {
    setForm((prev) => ({ ...prev, ...patch }));
    if (fields.some((field) => fieldErrors[field])) {
      const cleared = Object.fromEntries(fields.map((field) => [field, undefined]));
      setFieldErrors((prev) => ({ ...prev, ...cleared }));
    }
  }

  const discountText = (p: Promotion) =>
    p.discountBps !== null
      ? t("promotions.percentOff", {
          percent: f.number(p.discountBps / 100, { maximumFractionDigits: 2 }),
        })
      : f.money(p.discountMinor ?? 0, p.currency ?? "TRY");

  const conditionText = (p: Promotion) => {
    const key = CONDITION[p.type];
    const value = key ? p[key] : null;
    if (p.type === "COUPON") return p.couponCode ?? "";
    return value !== null ? t(`promotions.condition.${p.type}`, { count: value }) : "";
  };

  const validityText = (p: Promotion) => {
    const start = p.startsAt ? f.date(localDay(new Date(p.startsAt)), "medium") : null;
    const end = p.endsAt ? f.date(lastValidDay(p.endsAt), "medium") : null;
    if (start && end) return t("promotions.validity.range", { start, end });
    if (start) return t("promotions.validity.from", { start });
    if (end) return t("promotions.validity.until", { end });
    return t("promotions.validity.always");
  };

  // Sabit tutarın para birimi ilandan gelir; "tüm ilanlar"da yalnız tek para birimi varsa.
  const currencies = new Set(properties.map((p) => p.currency).filter(Boolean));
  const scopeCurrency = form.propertyId
    ? (properties.find((p) => p.id === form.propertyId)?.currency ?? null)
    : currencies.size === 1
      ? ([...currencies][0] ?? null)
      : null;
  // Düzenlenen sabit tutarlı kayıt, kapsamı değişmedikçe kendi para birimini korur.
  const editCurrency =
    editing?.discountMinor != null && (editing.propertyId ?? "") === form.propertyId
      ? editing.currency
      : null;
  const fixedCurrency = scopeCurrency ?? editCurrency;
  const limitMin = Math.max(1, editing?.usageCount ?? 1);

  /** Sunucunun alan bazlı doğrulama hatalarını form alanlarına eşler (yoksa null). */
  function serverFieldErrors(err: unknown): FieldErrors | null {
    if (!(err instanceof ApiError)) return null;
    if (err.code === "COUPON_CODE_TAKEN") return { code: t("promotions.form.couponTaken") };
    if (err.code !== "VALIDATION_ERROR") return null;
    const details = err.details as { fieldErrors?: Record<string, unknown> } | undefined;
    const errors: FieldErrors = {};
    for (const key of Object.keys(details?.fieldErrors ?? {})) {
      let field = SERVER_FIELD[key];
      if (!field) continue;
      if (field === "pct" && form.discountKind === "fixed") field = "amount";
      if (field === "cond" && !CONDITION[form.type]) continue;
      errors[field] = fieldRejectedText(field);
    }
    return Object.keys(errors).length > 0 ? errors : null;
  }

  /** Reddedilen alan için yerelleştirilmiş, düzeltmeyi anlatan metin (sunucu metni değil). */
  function fieldRejectedText(field: FormField | DateField): string {
    const hint = fieldHint(field);
    return hint ? t("promotions.form.fieldRejected", { hint }) : t("promotions.form.valueRejected");
  }

  function fieldHint(field: FormField | DateField): string | null {
    const condition = CONDITION[form.type];
    switch (field) {
      case "name":
        return t("promotions.form.nameHint", { min: 2, max: 80 });
      case "pct":
        return t("promotions.form.percentHint");
      case "amount":
        return t("promotions.form.amountInvalid");
      case "cond":
        return condition ? t("promotions.form.rangeHint", CONDITION_RANGE[condition]) : null;
      case "code":
        return t("promotions.form.couponHint", { min: 4, max: 40 });
      case "limit":
        return t("promotions.form.rangeHint", { min: limitMin, max: 1_000_000 });
      case "start":
        return t("promotions.form.dateInvalid");
      case "end":
        return t("promotions.form.endBeforeStart");
      default:
        return null;
    }
  }

  /** Gelişmiş ayarları açar; içindeki alan odaklanabilsin/görünsün diye. */
  function openAdvanced() {
    if (advancedRef.current) advancedRef.current.open = true;
  }

  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    setFormStatus({ error: t("promotions.form.fixFields") });
    if (errors.prio) openAdvanced();
    focusFirstInvalid(formRef.current);
  }

  function startEdit(p: Promotion) {
    const key = CONDITION[p.type];
    const value = key ? p[key] : null;
    const digits = p.currency ? fractionDigitsOf(p.currency) : 2;
    setEditing(p);
    setFieldErrors({});
    setFormStatus({});
    setForm({
      name: p.name,
      type: p.type,
      discountKind: p.discountMinor !== null ? "fixed" : "percent",
      percent: p.discountBps !== null ? String(p.discountBps / 100) : EMPTY_FORM.percent,
      amount:
        p.discountMinor !== null
          ? f.number(p.discountMinor / 10 ** digits, {
              minimumFractionDigits: digits,
              maximumFractionDigits: digits,
              useGrouping: false,
            })
          : "",
      condition: value !== null ? String(value) : (CONDITION_DEFAULT[p.type] ?? ""),
      couponCode: p.couponCode ?? "",
      usageLimit: p.usageLimit !== null ? String(p.usageLimit) : "",
      propertyId: p.propertyId ?? "",
      priority: String(p.priority),
      stackable: p.stackable,
      startDate: p.startsAt ? localDay(new Date(p.startsAt)) : "",
      endDate: p.endsAt ? lastValidDay(p.endsAt) : "",
    });
    // Varsayılandan farklı öncelik/birleşme kapalı bölümde gözden kaçmasın.
    if (String(p.priority) !== EMPTY_FORM.priority || p.stackable) openAdvanced();
    nameRef.current?.focus();
  }

  function cancelEdit() {
    const id = editing?.id;
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormStatus({});
    if (id) focusVisibleAction(actionRefs.current, `${id}:edit`);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormStatus({});
    setFieldErrors({});
    const condition = CONDITION[form.type];
    const fixed = form.discountKind === "fixed";
    const percent = Number(form.percent);
    const amountMinor =
      fixed && fixedCurrency
        ? parseAmountToMinor(form.amount.trim(), fractionDigitsOf(fixedCurrency))
        : null;
    const errors: FieldErrors = {};
    if (fixed && !fixedCurrency) {
      errors.scope = t("promotions.form.fixedNeedsListing");
    } else if (fixed && (amountMinor === null || amountMinor <= 0)) {
      errors.amount = t("promotions.form.amountInvalid");
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      errors.end = t("promotions.form.endBeforeStart");
    }
    if (Object.keys(errors).length > 0) {
      showFieldErrors(errors);
      return;
    }
    if (
      !fixed &&
      percent > HIGH_DISCOUNT_PERCENT &&
      !(await confirm({
        title: t("promotions.form.highConfirmTitle", { percent: form.percent }),
        body: t("promotions.form.highConfirmBody", { percent: form.percent }),
        confirmLabel: t("promotions.form.highConfirm"),
        tone: "danger",
      }))
    )
      return;
    const editingId = editing?.id ?? null;
    setSubmitting(true);
    try {
      // Tüm alanlar açıkça gönderilir: düzenlemede türü/indirim biçimi değişen kayıtta eski
      // koşul, kupon ve tutar alanları temizlenir.
      await apiFetch(editingId ? `/api/host/promotions/${editingId}` : "/api/host/promotions", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          discountBps: fixed ? null : Math.round(percent * 100),
          discountMinor: fixed ? amountMinor : null,
          currency: fixed ? fixedCurrency : null,
          minDaysBefore: condition === "minDaysBefore" ? Number(form.condition) : null,
          maxDaysBefore: condition === "maxDaysBefore" ? Number(form.condition) : null,
          minNights: condition === "minNights" ? Number(form.condition) : null,
          couponCode: form.type === "COUPON" ? form.couponCode : null,
          usageLimit: form.type === "COUPON" && form.usageLimit ? Number(form.usageLimit) : null,
          startsAt: form.startDate ? startOfLocalDay(form.startDate) : null,
          endsAt: form.endDate ? startOfLocalDay(form.endDate, 1) : null,
          propertyId: form.propertyId || null,
          priority: Number(form.priority),
          stackable: form.stackable,
        }),
      });
      if (editingId) {
        // Düzenleme bitince odak ve sonuç satırın "Düzenle" düğmesinde.
        setEditing(null);
        setForm(EMPTY_FORM);
        setStatus({ message: t("promotions.updated") });
        pendingFocus.current = `${editingId}:edit`;
      } else {
        setFormStatus({ message: t("promotions.created") });
        setForm((prev) => ({ ...prev, name: "", couponCode: "" }));
      }
      reload();
    } catch (err) {
      const errors = serverFieldErrors(err);
      if (errors) showFieldErrors(errors);
      else setFormStatus({ error: errorText(err) });
    } finally {
      setSubmitting(false);
    }
  }

  function retryLoad() {
    // Başarılı yüklemede "Yeniden dene" kalkar: odak listeye geçer.
    pendingFocus.current = "list";
    reload();
  }

  async function toggle(p: Promotion) {
    if (rowBusy) return;
    setStatus({});
    setRowBusy(p.id);
    try {
      await apiFetch(`/api/host/promotions/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !p.active }),
      });
      setStatus({
        message: t(p.active ? "promotions.pausedNamed" : "promotions.activatedNamed", {
          name: p.name,
        }),
      });
      // Liste aktifliğe göre sıralı: satır yer değiştirse de odak aynı düğmeye döner.
      pendingFocus.current = `${p.id}:toggle`;
      reload();
    } catch (err) {
      setStatus({ error: errorText(err) });
    } finally {
      setRowBusy(null);
    }
  }

  async function remove(p: Promotion) {
    if (rowBusy) return;
    setStatus({});
    const used = p.usageCount > 0;
    if (used && !p.active) {
      setStatus({ error: t("promotions.cannotDelete", { name: p.name }) });
      return;
    }
    // Kullanılmış promosyon silinmez, durdurulur: onay metni sonucu önceden söyler (F863).
    const ok = await confirm({
      title: t(used ? "promotions.deleteConfirm.usedTitle" : "promotions.deleteConfirm.title", {
        name: p.name,
      }),
      body: used
        ? t("promotions.deleteConfirm.usedBody", { count: p.usageCount })
        : t("promotions.deleteConfirm.body"),
      confirmLabel: used
        ? t("promotions.deleteConfirm.usedConfirm")
        : t("promotions.deleteConfirm.confirm"),
      tone: "danger",
    });
    if (!ok) return;
    const list = promotions ?? [];
    const index = list.findIndex((x) => x.id === p.id);
    const neighbour = list[index + 1] ?? list[index - 1];
    setRowBusy(p.id);
    try {
      const res = await apiFetch<{ deleted: boolean }>(`/api/host/promotions/${p.id}`, {
        method: "DELETE",
      });
      setStatus({ message: res.deleted ? t("promotions.deleted") : t("promotions.deactivated") });
      if (editing?.id === p.id && res.deleted) {
        setEditing(null);
        setForm(EMPTY_FORM);
      }
      // Silinen satırın düğmesi DOM'dan kalkar: odak komşu satıra, yoksa listeye (F864).
      pendingFocus.current = !res.deleted
        ? `${p.id}:delete`
        : neighbour
          ? `${neighbour.id}:edit`
          : "list";
      reload();
    } catch (err) {
      setStatus({ error: errorText(err) });
    } finally {
      setRowBusy(null);
    }
  }

  const condition = CONDITION[form.type];
  const conditionRange = condition ? CONDITION_RANGE[condition] : null;
  const id = "promo-form";
  const fixed = form.discountKind === "fixed";
  const percentValue = Number(form.percent);
  const percentValid = form.percent !== "" && percentValue > 0 && percentValue <= 100;
  const priorityLevel = PRIORITY_LEVELS.find((level) => level.value === form.priority);
  const priorityIsLevel = priorityLevel !== undefined;
  const priorityLabel = priorityLevel
    ? t(`promotions.form.${priorityLevel.key}`)
    : t("promotions.form.priorityCustom", { value: form.priority });
  const rowAction = [
    "py-1 font-semibold hover:underline",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    focusRing,
  ].join(" ");
  const statusText = (p: Promotion) =>
    p.active ? t("promotions.active") : t("promotions.inactive");

  /** Düzenle / Durdur-Etkinleştir / Sil; kartta dokunma hedefi 44px (F524). */
  const rowActions = (p: Promotion, variant: "table" | "card") => {
    const suffix = variant === "card" ? ":card" : "";
    const action =
      variant === "card" ? `${rowAction} inline-flex min-h-[44px] items-center` : rowAction;
    return (
      // Sil, geri alınabilir eylemlerden ayrık durur (F446).
      <div
        className={
          variant === "card"
            ? "flex flex-wrap items-center gap-x-4"
            : "flex items-center gap-x-4 whitespace-nowrap"
        }
      >
        <button
          type="button"
          ref={actionRef(`${p.id}:edit${suffix}`)}
          onClick={() => startEdit(p)}
          className={`${action} text-[#003580]`}
        >
          {t("promotions.edit")}
          <span className="sr-only">: {p.name}</span>
        </button>
        <button
          type="button"
          ref={actionRef(`${p.id}:toggle${suffix}`)}
          onClick={() => toggle(p)}
          aria-disabled={rowBusy === p.id || undefined}
          aria-busy={rowBusy === p.id || undefined}
          className={`${action} text-[#003580]`}
        >
          {p.active ? t("promotions.deactivate") : t("promotions.activate")}
          <span className="sr-only">: {p.name}</span>
        </button>
        <button
          type="button"
          ref={actionRef(`${p.id}:delete${suffix}`)}
          onClick={() => remove(p)}
          aria-disabled={rowBusy === p.id || undefined}
          aria-busy={rowBusy === p.id || undefined}
          className={`${action} ml-4 text-red-700`}
        >
          {t("promotions.delete")}
          <span className="sr-only">: {p.name}</span>
        </button>
      </div>
    );
  };

  return (
    <Card title={t("promotions.title")} id="host-promotions">
      <p className="mb-3 text-sm text-gray-600">{t("promotions.intro")}</p>
      <div ref={listRef} tabIndex={-1} className={`rounded-md ${focusRing}`}>
        {/* Yükleme hatası ile işlem sonucu ayrı satırlarda: biri diğerini gizlemez (F865). */}
        {error && <LoadError error={error} onRetry={retryLoad} busy={loading} />}
        <Status error={status.error} message={status.message} />
        {promotions === null ? (
          !error && <p className="text-sm text-gray-600">{t("promotions.loading")}</p>
        ) : promotions.length === 0 ? (
          <p className="text-sm text-gray-700">{t("promotions.empty")}</p>
        ) : (
          <>
            {/* Dar ekranda kart: durum ve işlemler üstte, yatay kaydırma yok (F524). */}
            <ul className="space-y-3 md:hidden" aria-label={t("promotions.caption")}>
              {promotions.map((p) => (
                <li
                  key={p.id}
                  className="rounded-lg border border-gray-200 p-3 text-sm"
                  data-testid="promotion-card"
                >
                  <p className="font-medium text-gray-900">{p.name}</p>
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-gray-600">{t("promotions.columns.status")}</dt>
                    <dd className="font-medium">{statusText(p)}</dd>
                  </dl>
                  {rowActions(p, "card")}
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-gray-600">{t("promotions.columns.type")}</dt>
                    <dd>
                      {t(`promotions.types.${p.type}`)}
                      <span className="block text-xs text-gray-600">{conditionText(p)}</span>
                    </dd>
                    <dt className="text-gray-600">{t("promotions.columns.discount")}</dt>
                    <dd>{discountText(p)}</dd>
                    <dt className="text-gray-600">{t("promotions.columns.scope")}</dt>
                    <dd>{p.propertyTitle ?? t("promotions.allListings")}</dd>
                    <dt className="text-gray-600">{t("promotions.columns.validity")}</dt>
                    <dd>{validityText(p)}</dd>
                    <dt className="text-gray-600">{t("promotions.columns.usage")}</dt>
                    <dd>
                      {p.usageLimit !== null ? `${p.usageCount} / ${p.usageLimit}` : p.usageCount}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
            <div
              className="relative hidden max-w-full overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 md:block"
              role="region"
              aria-label={t("promotions.caption")}
              tabIndex={0}
            >
              <table className="min-w-full text-left text-sm">
                <caption className="sr-only">{t("promotions.caption")}</caption>
                <thead className="border-b text-gray-700">
                  <tr>
                    <th scope="col" className="py-2 pr-4">
                      {t("promotions.columns.name")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("promotions.columns.type")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("promotions.columns.discount")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("promotions.columns.scope")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("promotions.columns.validity")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("promotions.columns.usage")}
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      {t("promotions.columns.status")}
                    </th>
                    <th scope="col" className="py-2">
                      <span className="sr-only">{t("promotions.columns.actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {promotions.map((p) => (
                    <tr key={p.id} className="border-b last:border-0" data-testid="promotion-row">
                      <td className="py-2 pr-4 font-medium">{p.name}</td>
                      <td className="py-2 pr-4">
                        {t(`promotions.types.${p.type}`)}
                        <span className="block text-xs text-gray-600">{conditionText(p)}</span>
                      </td>
                      <td className="py-2 pr-4">{discountText(p)}</td>
                      <td className="py-2 pr-4">
                        {p.propertyTitle ?? t("promotions.allListings")}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-4">{validityText(p)}</td>
                      <td className="py-2 pr-4">
                        {p.usageLimit !== null ? `${p.usageCount} / ${p.usageLimit}` : p.usageCount}
                      </td>
                      <td className="py-2 pr-4">{statusText(p)}</td>
                      <td className="py-2">{rowActions(p, "table")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <h3 id={`${id}-title`} className="mt-6 text-base font-semibold text-gray-900">
        {editing
          ? t("promotions.form.editTitle", { name: editing.name })
          : t("promotions.form.ariaLabel")}
      </h3>
      <form
        ref={formRef}
        onSubmit={submit}
        className="mt-2 grid gap-3 md:grid-cols-4"
        aria-labelledby={`${id}-title`}
      >
        <Field
          label={t("promotions.form.name")}
          id={`${id}-name`}
          hint={t("promotions.form.nameFieldHint", { min: 2, max: 80 })}
          error={fieldErrors.name}
        >
          <input
            ref={nameRef}
            id={`${id}-name`}
            className={inputClass}
            value={form.name}
            required
            minLength={2}
            maxLength={80}
            onChange={(e) => change({ name: e.target.value }, "name")}
          />
        </Field>
        <Field
          label={t("promotions.form.type")}
          id={`${id}-type`}
          hint={t(`promotions.typeHelp.${form.type}`)}
        >
          <select
            id={`${id}-type`}
            className={inputClass}
            value={form.type}
            onChange={(e) => {
              const type = e.target.value as PromotionType;
              change({ type, condition: CONDITION_DEFAULT[type] ?? "" }, "cond");
            }}
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`promotions.types.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="min-w-0">
          <legend className="block text-sm font-medium text-gray-800">
            {t("promotions.form.discountKind")}
          </legend>
          <div className="mt-1 flex min-h-[44px] flex-wrap items-center gap-x-4">
            {DISCOUNT_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name={`${id}-kind`}
                  value={kind}
                  checked={form.discountKind === kind}
                  onChange={() => change({ discountKind: kind }, "amount", "pct", "scope")}
                  className={focusRing}
                />
                {t(`promotions.form.${KIND_LABEL[kind]}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {fixed ? (
          <Field
            label={t("promotions.form.amount")}
            id={`${id}-amount`}
            hint={
              fixedCurrency
                ? t("promotions.form.amountHint", { currency: fixedCurrency })
                : t("promotions.form.fixedNeedsListing")
            }
            error={fieldErrors.amount}
          >
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              autoComplete="off"
              className={inputClass}
              value={form.amount}
              required
              onChange={(e) => change({ amount: e.target.value }, "amount")}
            />
          </Field>
        ) : (
          <Field
            label={t("promotions.form.percent")}
            id={`${id}-pct`}
            hint={t("promotions.form.percentHint")}
            error={fieldErrors.pct}
          >
            <input
              id={`${id}-pct`}
              type="number"
              min={0.01}
              max={100}
              step="0.01"
              className={inputClass}
              value={form.percent}
              required
              onChange={(e) => change({ percent: e.target.value }, "pct")}
            />
          </Field>
        )}
        <div aria-live="polite" className="text-xs text-gray-700 md:col-span-4">
          {!fixed && percentValid && (
            <p>
              {t("promotions.form.preview", {
                before: f.number(EXAMPLE_PRICE),
                after: f.number(EXAMPLE_PRICE * (1 - percentValue / 100), {
                  maximumFractionDigits: 2,
                }),
                percent: form.percent,
              })}
            </p>
          )}
          {!fixed && percentValid && percentValue > HIGH_DISCOUNT_PERCENT && (
            <p className="font-semibold">
              {t("promotions.form.highWarning", { percent: form.percent })}
            </p>
          )}
          {form.stackable && <p>{t("promotions.form.stackableWarning")}</p>}
        </div>
        {condition && conditionRange && (
          <Field
            label={t(`promotions.form.${condition}`)}
            id={`${id}-cond`}
            hint={t("promotions.form.rangeHint", conditionRange)}
            error={fieldErrors.cond}
          >
            <input
              id={`${id}-cond`}
              type="number"
              min={conditionRange.min}
              max={conditionRange.max}
              className={inputClass}
              value={form.condition}
              required
              onChange={(e) => change({ condition: e.target.value }, "cond")}
            />
          </Field>
        )}
        {form.type === "COUPON" && (
          <>
            <Field
              label={t("promotions.form.couponCode")}
              id={`${id}-code`}
              hint={t("promotions.form.couponHint", { min: 4, max: 40 })}
              error={fieldErrors.code}
            >
              <input
                id={`${id}-code`}
                className={inputClass}
                value={form.couponCode}
                required
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                pattern="[A-Za-z0-9_\-]{4,40}"
                onChange={(e) => change({ couponCode: e.target.value }, "code")}
              />
            </Field>
            <Field
              label={t("promotions.form.usageLimit")}
              id={`${id}-limit`}
              hint={
                editing && editing.usageCount > 0
                  ? t("promotions.form.usageLimitHint", { count: editing.usageCount })
                  : undefined
              }
              error={fieldErrors.limit}
            >
              <input
                id={`${id}-limit`}
                type="number"
                min={limitMin}
                max={1_000_000}
                className={inputClass}
                value={form.usageLimit}
                onChange={(e) => change({ usageLimit: e.target.value }, "limit")}
              />
            </Field>
          </>
        )}
        <Field label={t("promotions.form.scope")} id={`${id}-scope`} error={fieldErrors.scope}>
          <select
            id={`${id}-scope`}
            className={inputClass}
            value={form.propertyId}
            onChange={(e) => change({ propertyId: e.target.value }, "scope")}
          >
            <option value="">{t("promotions.allListings")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("promotions.form.startDate")}
          id={`${id}-start`}
          hint={t("promotions.form.startHint")}
          error={fieldErrors.start}
        >
          <input
            id={`${id}-start`}
            type="date"
            className={inputClass}
            value={form.startDate}
            onChange={(e) => change({ startDate: e.target.value }, "start")}
          />
        </Field>
        <Field
          label={t("promotions.form.endDate")}
          id={`${id}-end`}
          hint={t("promotions.form.endHint")}
          error={fieldErrors.end}
        >
          <input
            id={`${id}-end`}
            type="date"
            min={form.startDate || undefined}
            className={inputClass}
            value={form.endDate}
            onChange={(e) => change({ endDate: e.target.value }, "end")}
          />
        </Field>
        {/* Öncelik ve birleşme yalnız birden çok promosyon çakışınca önemli: varsayılan kapalı. */}
        <details ref={advancedRef} className="rounded-md border border-gray-200 px-3 md:col-span-4">
          <summary
            className={`cursor-pointer rounded-md py-3 text-sm font-medium text-gray-800 ${focusRing}`}
          >
            {t("promotions.form.advanced")}
            <span className="font-normal text-gray-600">
              {" "}
              {t("promotions.form.advancedSummary", {
                priority: priorityLabel,
                stackable: String(form.stackable),
              })}
            </span>
          </summary>
          <div className="grid gap-3 pb-3 md:grid-cols-2">
            <Field
              label={t("promotions.form.priority")}
              id={`${id}-prio`}
              hint={t("promotions.form.priorityHint")}
              error={fieldErrors.prio}
            >
              <select
                id={`${id}-prio`}
                className={inputClass}
                value={form.priority}
                onChange={(e) => change({ priority: e.target.value }, "prio")}
              >
                {PRIORITY_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {t(`promotions.form.${level.key}`)}
                  </option>
                ))}
                {!priorityIsLevel && <option value={form.priority}>{priorityLabel}</option>}
              </select>
            </Field>
            <div>
              <div className="flex min-h-[44px] items-center gap-2 md:mt-5">
                <input
                  id={`${id}-stack`}
                  type="checkbox"
                  checked={form.stackable}
                  aria-describedby={`${id}-stack-hint`}
                  onChange={(e) => change({ stackable: e.target.checked })}
                  className={`h-5 w-5 ${focusRing}`}
                />
                <label htmlFor={`${id}-stack`} className="text-sm text-gray-800">
                  {t("promotions.form.stackable")}
                </label>
              </div>
              <p id={`${id}-stack-hint`} className="text-xs text-gray-600">
                {t("promotions.form.stackableHint")}
              </p>
            </div>
          </div>
        </details>
        <div className="flex items-end gap-2">
          <Button
            type="submit"
            variant="secondary"
            className="min-h-[44px] w-full"
            busy={submitting}
          >
            {editing ? t("promotions.form.save") : t("promotions.form.submit")}
          </Button>
          {editing && (
            <button
              type="button"
              onClick={cancelEdit}
              className={`min-h-[44px] px-3 text-sm font-semibold text-[#003580] hover:underline ${focusRing}`}
            >
              {t("promotions.form.cancelEdit")}
            </button>
          )}
        </div>
        <div className="md:col-span-4">
          <Status error={formStatus.error} message={formStatus.message} />
        </div>
      </form>
      {confirmDialog}
    </Card>
  );
}

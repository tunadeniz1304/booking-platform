"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  Status,
  errorMessage,
  focusRing,
  inputClass,
  useLoader,
} from "@/components/ui/ui";

/** P1-8: ev sahibi promosyon listesi + basit oluşturma formu (yüzde indirim). */

const TYPES = ["EARLY_BIRD", "LAST_MINUTE", "LONG_STAY", "MOBILE_RATE", "COUPON"] as const;
type PromotionType = (typeof TYPES)[number];

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
  priority: number;
  stackable: boolean;
  active: boolean;
}

/** Türün koşul alanı (EARLY_BIRD → minDaysBefore …); mobil ve kuponda yok. */
const CONDITION: Partial<Record<PromotionType, "minDaysBefore" | "maxDaysBefore" | "minNights">> = {
  EARLY_BIRD: "minDaysBefore",
  LAST_MINUTE: "maxDaysBefore",
  LONG_STAY: "minNights",
};

export default function PromotionsPanel({
  properties,
}: {
  properties: ReadonlyArray<{ id: string; title: string }>;
}) {
  const t = useTranslations("host");
  const f = useFormat();
  const { data, error, reload } = useLoader(() =>
    apiFetch<{ promotions: Promotion[] }>("/api/host/promotions")
  );
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [form, setForm] = useState({
    name: "",
    type: "EARLY_BIRD" as PromotionType,
    percent: "10",
    condition: "30",
    couponCode: "",
    usageLimit: "",
    propertyId: "",
    priority: "0",
    stackable: false,
  });

  const discountText = (p: Promotion) =>
    p.discountBps !== null
      ? t("promotions.percentOff", { percent: String(p.discountBps / 100) })
      : f.money(p.discountMinor ?? 0, p.currency ?? "TRY");

  const conditionText = (p: Promotion) => {
    const key = CONDITION[p.type];
    const value = key ? p[key] : null;
    if (p.type === "COUPON") return p.couponCode ?? "";
    return value !== null ? t(`promotions.condition.${p.type}`, { count: value }) : "";
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus({});
    const condition = CONDITION[form.type];
    try {
      await apiFetch("/api/host/promotions", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          discountBps: Math.round(Number(form.percent) * 100),
          ...(condition ? { [condition]: Number(form.condition) } : {}),
          ...(form.type === "COUPON"
            ? {
                couponCode: form.couponCode,
                ...(form.usageLimit ? { usageLimit: Number(form.usageLimit) } : {}),
              }
            : {}),
          propertyId: form.propertyId || null,
          priority: Number(form.priority),
          stackable: form.stackable,
        }),
      });
      setStatus({ message: t("promotions.created") });
      setForm({ ...form, name: "", couponCode: "" });
      reload();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    }
  }

  async function toggle(p: Promotion) {
    setStatus({});
    try {
      await apiFetch(`/api/host/promotions/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !p.active }),
      });
      reload();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    }
  }

  async function remove(p: Promotion) {
    setStatus({});
    try {
      const res = await apiFetch<{ deleted: boolean }>(`/api/host/promotions/${p.id}`, {
        method: "DELETE",
      });
      setStatus({ message: res.deleted ? t("promotions.deleted") : t("promotions.deactivated") });
      reload();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
    }
  }

  const promotions = data?.promotions ?? null;
  const condition = CONDITION[form.type];
  const id = "promo-form";

  return (
    <Card title={t("promotions.title")} id="host-promotions">
      <p className="mb-3 text-sm text-gray-600">{t("promotions.intro")}</p>
      <Status error={error ?? status.error} message={status.message} />
      {promotions === null ? (
        !error && <p className="text-sm text-gray-600">{t("promotions.loading")}</p>
      ) : promotions.length === 0 ? (
        <p className="text-sm text-gray-700">{t("promotions.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
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
                  <td className="py-2 pr-4">{p.propertyTitle ?? t("promotions.allListings")}</td>
                  <td className="py-2 pr-4">
                    {p.usageLimit !== null ? `${p.usageCount} / ${p.usageLimit}` : p.usageCount}
                  </td>
                  <td className="py-2 pr-4">
                    {p.active ? t("promotions.active") : t("promotions.inactive")}
                  </td>
                  <td className="space-x-3 whitespace-nowrap py-2">
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      className={`font-semibold text-[#003580] hover:underline ${focusRing}`}
                    >
                      {p.active ? t("promotions.deactivate") : t("promotions.activate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      className={`font-semibold text-red-700 hover:underline ${focusRing}`}
                    >
                      {t("promotions.delete")}
                      <span className="sr-only">: {p.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        onSubmit={submit}
        className="mt-4 grid gap-3 md:grid-cols-4"
        aria-label={t("promotions.form.ariaLabel")}
      >
        <Field label={t("promotions.form.name")} id={`${id}-name`}>
          <input
            id={`${id}-name`}
            className={inputClass}
            value={form.name}
            required
            minLength={2}
            maxLength={80}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label={t("promotions.form.type")} id={`${id}-type`}>
          <select
            id={`${id}-type`}
            className={inputClass}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as PromotionType })}
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`promotions.types.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("promotions.form.percent")} id={`${id}-pct`}>
          <input
            id={`${id}-pct`}
            type="number"
            min={0.01}
            max={100}
            step="0.01"
            className={inputClass}
            value={form.percent}
            required
            onChange={(e) => setForm({ ...form, percent: e.target.value })}
          />
        </Field>
        {condition && (
          <Field label={t(`promotions.form.${condition}`)} id={`${id}-cond`}>
            <input
              id={`${id}-cond`}
              type="number"
              min={condition === "minNights" ? 1 : 0}
              max={730}
              className={inputClass}
              value={form.condition}
              required
              onChange={(e) => setForm({ ...form, condition: e.target.value })}
            />
          </Field>
        )}
        {form.type === "COUPON" && (
          <>
            <Field label={t("promotions.form.couponCode")} id={`${id}-code`}>
              <input
                id={`${id}-code`}
                className={inputClass}
                value={form.couponCode}
                required
                pattern="[A-Za-z0-9_\-]{4,40}"
                onChange={(e) => setForm({ ...form, couponCode: e.target.value })}
              />
            </Field>
            <Field label={t("promotions.form.usageLimit")} id={`${id}-limit`}>
              <input
                id={`${id}-limit`}
                type="number"
                min={1}
                className={inputClass}
                value={form.usageLimit}
                onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
              />
            </Field>
          </>
        )}
        <Field label={t("promotions.form.scope")} id={`${id}-scope`}>
          <select
            id={`${id}-scope`}
            className={inputClass}
            value={form.propertyId}
            onChange={(e) => setForm({ ...form, propertyId: e.target.value })}
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
          label={t("promotions.form.priority")}
          id={`${id}-prio`}
          hint={t("promotions.form.priorityHint")}
        >
          <input
            id={`${id}-prio`}
            type="number"
            min={-1000}
            max={1000}
            className={inputClass}
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          />
        </Field>
        <div className="flex items-end gap-2 pb-2">
          <input
            id={`${id}-stack`}
            type="checkbox"
            checked={form.stackable}
            onChange={(e) => setForm({ ...form, stackable: e.target.checked })}
            className={focusRing}
          />
          <label htmlFor={`${id}-stack`} className="text-sm text-gray-800">
            {t("promotions.form.stackable")}
          </label>
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" className="w-full">
            {t("promotions.form.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

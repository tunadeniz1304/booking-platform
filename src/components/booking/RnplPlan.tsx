"use client";

import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";

/** `GET /api/bookings/{id}` → `paymentPlan` (src/lib/payment/rnpl.ts `RnplPlanView`). */
export interface RnplPlan {
  status: "SCHEDULED" | "RETRYING" | "CAPTURED" | "CANCELLED" | "DEFAULTED";
  paidTodayMinor: number;
  amountMinor: number;
  currency: string;
  dueAt: string;
  freeCancellationUntil: string;
  nextAttemptAt?: string | null;
  capturedAt?: string | null;
}

const STATUS_TONE: Record<RnplPlan["status"], string> = {
  SCHEDULED: "bg-blue-100 text-blue-900",
  RETRYING: "bg-amber-100 text-amber-900",
  CAPTURED: "bg-green-100 text-green-900",
  CANCELLED: "bg-gray-200 text-gray-900",
  DEFAULTED: "bg-red-100 text-red-900",
};

/**
 * P2-1: rezervasyon detayında planlı RNPL tahsilatı — "bugün 0 ₺, <tarih>'te X ₺" özeti,
 * plan durumu ve iptal zaman çizelgesi. Plan yoksa (şimdi ödenmiş rezervasyon) hiçbir şey.
 */
export default function RnplPlanCard({ plan }: { plan: RnplPlan | null | undefined }) {
  const t = useTranslations("payment.rnpl");
  const f = useFormat();
  if (!plan) return null;
  const amount = f.money(plan.amountMinor, plan.currency);
  const today = f.money(plan.paidTodayMinor, plan.currency);
  const due = f.date(plan.dueAt, "long");
  const freeUntil = f.date(plan.freeCancellationUntil, "long");

  return (
    <section
      aria-labelledby="rnpl-plan-title"
      className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-gray-900"
      data-testid="rnpl-plan"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rnpl-plan-title" className="text-base font-semibold text-gray-900">
          {t("plan.title")}
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[plan.status]}`}
        >
          {t(`plan.status.${plan.status}`)}
        </span>
      </div>
      <p className="mt-2 font-medium">{t("plan.summary", { today, amount, date: due })}</p>
      {plan.status === "RETRYING" && plan.nextAttemptAt && (
        <p className="mt-1 text-amber-900">
          {t("plan.retry", { date: f.date(plan.nextAttemptAt, "long") })}
        </p>
      )}
      {plan.status === "CAPTURED" && plan.capturedAt && (
        <p className="mt-1 text-green-900">
          {t("plan.captured", { amount, date: f.date(plan.capturedAt, "long") })}
        </p>
      )}
      <ol
        className="ml-5 mt-3 list-decimal space-y-1 text-xs text-gray-700"
        aria-label={t("timeline")}
        data-testid="rnpl-plan-timeline"
      >
        <li>{t("stepToday", { today })}</li>
        <li>{t("stepCharge", { date: due, amount })}</li>
        <li>{t("stepFreeCancel", { date: freeUntil })}</li>
        <li>{t("stepFailure")}</li>
      </ol>
    </section>
  );
}

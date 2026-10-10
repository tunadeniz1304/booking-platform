"use client";

import { useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Field, Status, errorMessage, inputClass, useLoader } from "@/components/ui/ui";
import { minorToInput } from "@/components/resolution/shared";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { parseAmountToMinor } from "@/lib/ui/amount-input";

/** Para biriminin ondalık basamak sayısı (TRY/EUR 2, JPY 0). */
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

interface DepositSettingRow {
  roomTypeId: string | null;
  roomName: string | null;
  amountMinor: number | null;
}

interface DepositSettingsResponse {
  currency: string;
  maxMinor: number;
  settings: DepositSettingRow[];
}

/**
 * Ev sahibi hasar depozitosu ayarı (P1-5): ilk satır ilan geneli (roomTypeId null),
 * diğerleri oda tipine özel tutarlardır. Tutarlar ana birimde girilir.
 */
export default function DepositSettings({ propertyId }: { propertyId: string }) {
  const t = useTranslations("resolution.host");
  const f = useFormat();
  const { data, error, reload } = useLoader(
    () =>
      apiFetch<DepositSettingsResponse>(
        `/api/host/properties/${encodeURIComponent(propertyId)}/deposit`
      ),
    [propertyId]
  );

  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-base font-semibold text-gray-900">{t("title")}</h3>
      <p className="mt-1 text-sm text-gray-700">{t("intro")}</p>
      <Status error={error} />
      <div role="status" aria-live="polite">
        {!data && !error && <p className="text-sm text-gray-600">{t("loading")}</p>}
      </div>
      {data && (
        <>
          <p className="mt-1 text-xs text-gray-600">
            {t("max", { amount: f.money(data.maxMinor, data.currency) })}
          </p>
          <ul className="mt-3 space-y-3">
            {data.settings.map((row) => (
              <li key={row.roomTypeId ?? "listing"}>
                <DepositRow
                  propertyId={propertyId}
                  row={row}
                  currency={data.currency}
                  maxMinor={data.maxMinor}
                  onSaved={reload}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DepositRow({
  propertyId,
  row,
  currency,
  maxMinor,
  onSaved,
}: {
  propertyId: string;
  row: DepositSettingRow;
  currency: string;
  maxMinor: number;
  onSaved: () => void;
}) {
  const t = useTranslations("resolution.host");
  const f = useFormat();
  const fid = `deposit-${propertyId}-${row.roomTypeId ?? "listing"}`;
  const scope = row.roomTypeId
    ? t("roomLabel", { room: row.roomName ?? row.roomTypeId })
    : t("listingWide");
  const [value, setValue] = useState(
    row.amountMinor === null ? "" : minorToInput(row.amountMinor, currency)
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [fieldError, setFieldError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialog } = useConfirm();
  const digits = fractionDigitsOf(currency);
  const preview = value.trim() ? parseAmountToMinor(value, digits) : null;

  async function put(amountMinor: number | null) {
    if (busy) return;
    setBusy(true);
    setFeedback({});
    try {
      await apiFetch(`/api/host/properties/${encodeURIComponent(propertyId)}/deposit`, {
        method: "PUT",
        body: JSON.stringify({ amountMinor, roomTypeId: row.roomTypeId }),
      });
      if (amountMinor === null) setValue("");
      setFeedback({
        message:
          amountMinor === null
            ? t("removedAmount", {
                scope,
                amount: row.amountMinor === null ? t("none") : f.money(row.amountMinor, currency),
              })
            : t("savedAmount", { scope, amount: f.money(amountMinor, currency) }),
      });
      onSaved();
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    setFeedback({});
    const amountMinor = parseAmountToMinor(value, digits);
    if (amountMinor === null || amountMinor <= 0) {
      setFieldError(t("invalidAmountFormat"));
      inputRef.current?.focus();
      return;
    }
    if (amountMinor > maxMinor) {
      setFieldError(t("tooHigh", { amount: f.money(maxMinor, currency) }));
      inputRef.current?.focus();
      return;
    }
    setFieldError(null);
    void put(amountMinor);
  }

  async function remove() {
    if (row.amountMinor === null) return;
    const ok = await confirm({
      title: t("removeConfirmTitle", { scope }),
      body: t("removeConfirmBody", { scope, amount: f.money(row.amountMinor, currency) }),
      confirmLabel: t("removeConfirm"),
      tone: "danger",
    });
    if (ok) void put(null);
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] flex-1">
        <Field
          label={t("amount", { scope, currency })}
          id={fid}
          hint={`${t("current", {
            amount: row.amountMinor === null ? t("none") : f.money(row.amountMinor, currency),
          })} ${t("formatHint")}`}
          error={fieldError}
        >
          <input
            ref={inputRef}
            id={fid}
            inputMode="decimal"
            autoComplete="off"
            className={inputClass}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setFieldError(null);
            }}
          />
        </Field>
        <p aria-live="polite" className="mt-1 min-h-[1rem] text-xs text-gray-600">
          {preview !== null && preview > 0
            ? t("preview", { amount: f.money(preview, currency) })
            : ""}
        </p>
      </div>
      <Button type="submit" className="min-h-[44px]" disabled={!value.trim()} busy={busy}>
        {t("save")}
      </Button>
      {row.amountMinor !== null && (
        <Button
          variant="secondary"
          className="min-h-[44px]"
          busy={busy}
          onClick={() => void remove()}
          aria-label={t("removeLabel", { scope })}
        >
          {t("remove")}
        </Button>
      )}
      <div className="w-full">
        <Status error={feedback.error} message={feedback.message} />
      </div>
      {confirmDialog}
    </form>
  );
}

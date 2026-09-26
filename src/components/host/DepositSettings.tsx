"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Field, Status, errorMessage, inputClass, useLoader } from "@/components/ui/ui";
import { minorToInput, parseMajorInput } from "@/components/resolution/shared";

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
      {!data && !error && (
        <p aria-live="polite" className="text-sm text-gray-600">
          {t("loading")}
        </p>
      )}
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

  async function put(amountMinor: number | null) {
    setBusy(true);
    setFeedback({});
    try {
      await apiFetch(`/api/host/properties/${encodeURIComponent(propertyId)}/deposit`, {
        method: "PUT",
        body: JSON.stringify({ amountMinor, roomTypeId: row.roomTypeId }),
      });
      if (amountMinor === null) setValue("");
      setFeedback({ message: amountMinor === null ? t("removed") : t("saved") });
      onSaved();
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    const amountMinor = parseMajorInput(value, currency);
    if (amountMinor === null) {
      setFeedback({ error: t("invalidAmount") });
      return;
    }
    if (amountMinor > maxMinor) {
      setFeedback({ error: t("tooHigh", { amount: f.money(maxMinor, currency) }) });
      return;
    }
    void put(amountMinor);
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[12rem] flex-1">
        <Field
          label={t("amount", { scope, currency })}
          id={fid}
          hint={t("current", {
            amount: row.amountMinor === null ? t("none") : f.money(row.amountMinor, currency),
          })}
        >
          <input
            id={fid}
            inputMode="decimal"
            className={inputClass}
            value={value}
            pattern="\d+([.,]\d{1,3})?"
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
      </div>
      <Button type="submit" disabled={busy || !value.trim()}>
        {t("save")}
      </Button>
      {row.amountMinor !== null && (
        <Button variant="secondary" disabled={busy} onClick={() => void put(null)}>
          {t("remove")}
        </Button>
      )}
      <div className="w-full">
        <Status error={feedback.error} message={feedback.message} />
      </div>
    </form>
  );
}

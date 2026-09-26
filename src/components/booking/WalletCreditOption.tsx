"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";

interface CreditOptions {
  currency: string;
  availableMinor: number;
  maxUsableMinor: number;
  reservedMinor: number;
}

interface Props {
  bookingId: string;
  /** Rezervasyon toplamı (minor-unit): kartla ödenecek kalanı göstermek için. */
  totalMinor?: number;
  currency?: string;
  disabled?: boolean;
  /** Seçilen kredi (minor-unit; 0 = kullanma). */
  onChange: (creditMinor: number) => void;
}

/**
 * Checkout ▸ "Krediyi kullan" (P1-7). Kredi yoksa ya da bu rezervasyonda kullanılamıyorsa
 * (sepet kalemi) hiç görünmez. Tutar sunucuda yeniden doğrulanır (asgari kart tutarı, bakiye).
 */
export default function WalletCreditOption({
  bookingId,
  totalMinor,
  currency,
  disabled,
  onChange,
}: Props) {
  const t = useTranslations("wallet.checkout");
  const fmt = useFormat();
  const [opts, setOpts] = useState<CreditOptions | null>(null);
  const [use, setUse] = useState(false);
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    let active = true;
    apiFetch<CreditOptions>(`/api/bookings/${bookingId}/credit`)
      .then((o) => {
        if (!active) return;
        setOpts(o);
        setAmount(o.reservedMinor > 0 ? o.reservedMinor : o.maxUsableMinor);
      })
      .catch(() => undefined); // Kredi seçeneği okunamazsa yalnız kart.
    return () => {
      active = false;
    };
  }, [bookingId]);

  if (!opts || opts.maxUsableMinor <= 0) return null;
  const cur = currency ?? opts.currency;
  const valid = Number.isInteger(amount) && amount >= 0 && amount <= opts.maxUsableMinor;

  const update = (nextUse: boolean, nextAmount: number) => {
    setUse(nextUse);
    setAmount(nextAmount);
    const ok = Number.isInteger(nextAmount) && nextAmount >= 0 && nextAmount <= opts.maxUsableMinor;
    onChange(nextUse && ok ? nextAmount : 0);
  };

  return (
    <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-gray-900">{t("title")}</legend>
      <label className="flex items-center gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={use}
          onChange={(e) => update(e.target.checked, amount)}
          className="h-4 w-4"
        />
        {t("use")}
        <span className="text-gray-500">
          {t("available", { amount: fmt.money(opts.availableMinor, cur) })}
        </span>
      </label>
      {use && (
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700">
            {t("amount")}
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={opts.maxUsableMinor / 100}
              step="0.01"
              value={amount / 100}
              onChange={(e) => update(true, Math.round(Number(e.target.value) * 100))}
              aria-invalid={!valid}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <p className="text-xs text-gray-500">
            {t("max", { amount: fmt.money(opts.maxUsableMinor, cur) })}
          </p>
          {!valid && (
            <p role="alert" className="text-xs text-red-700">
              {t("invalid", { max: fmt.money(opts.maxUsableMinor, cur) })}
            </p>
          )}
          {valid && totalMinor !== undefined && (
            <p className="text-sm font-medium text-gray-900">
              {t("cardRemainder", { amount: fmt.money(totalMinor - amount, cur) })}
            </p>
          )}
          <p className="text-xs text-gray-500">{t("notice")}</p>
        </div>
      )}
    </fieldset>
  );
}

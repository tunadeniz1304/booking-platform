"use client";

import { useFormat } from "@/i18n/use-format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";

/**
 * Yazılan tutarın çözülmüş önizlemesi (F2-33): "1.250" bin iki yüz elli, "1.25" bir virgül
 * yirmi beş okunur; kullanıcı ne gireceğini görür. aria-live="polite"; geçersiz/boş ya da
 * sıfır tutarda boş kalır. `format` verilmezse "= {tutar}" gösterilir.
 */
export function AmountPreview({
  value,
  currency,
  fractionDigits = 2,
  format,
  id,
  className = "mt-1 min-h-[1rem] text-xs text-gray-700",
}: {
  value: string;
  currency: string;
  fractionDigits?: number;
  format?: (money: string) => string;
  id?: string;
  className?: string;
}) {
  const f = useFormat();
  const parsed = value.trim() ? parseAmountToMinor(value, fractionDigits) : null;
  const money = parsed !== null && parsed > 0 ? f.money(parsed, currency) : null;
  return (
    <p id={id} aria-live="polite" className={className} data-testid="amount-preview">
      {money === null ? "" : format ? format(money) : `= ${money}`}
    </p>
  );
}

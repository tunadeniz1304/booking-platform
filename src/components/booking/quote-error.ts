"use client";

import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/use-format";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Arayüz dilinde gösterilen teklif hata kodları (sunucu metni yalnız bilinmeyen kodda). */
export const QUOTE_ERROR_CODES = new Set(["SOLD_OUT", "RESTRICTED", "NOT_FOUND", "OVER_CAPACITY"]);
/** Belirli bir geceye bağlı kısıtlar (mesajda tarih gösterilir). */
const DATE_RESTRICTIONS = new Set(["STOP_SELL", "CLOSED_TO_ARRIVAL", "CLOSED_TO_DEPARTURE"]);
/** Tarih değiştirerek çözülen teklif hataları ("Başka tarih seç"). */
const DATE_ERROR_CODES = new Set(["SOLD_OUT", "RESTRICTED"]);

export type QuoteErrorAction = "dates" | "retry" | null;

/**
 * Teklif hatasının arayüz dilindeki metni ve önerilen eylemi (widget ve checkout ortak, F2-16).
 * "retry" yalnız kodsuz (ağ) ya da bilinmeyen kodlu hatada döner; kısıtlar yeniden denenmez.
 */
export function useQuoteError(
  error: string | null,
  code: string | null,
  details: Record<string, unknown> | null
): { text: string | null; action: QuoteErrorAction } {
  const t = useTranslations("booking");
  const f = useFormat();
  if (error === null) return { text: null, action: null };

  // Kısıt ihlalinde sunucunun ayrıntısıyla (en az/en çok gece, kapalı gün) somut mesaj.
  let restrictionText: string | null = null;
  if (code === "RESTRICTED" && details) {
    const { restriction, minStay, maxStay, date } = details;
    if (restriction === "MIN_STAY" && typeof minStay === "number") {
      restrictionText = t("widget.errors.RESTRICTED_MIN_STAY", { minStay });
    } else if (restriction === "MAX_STAY" && typeof maxStay === "number") {
      restrictionText = t("widget.errors.RESTRICTED_MAX_STAY", { maxStay });
    } else if (
      typeof restriction === "string" &&
      DATE_RESTRICTIONS.has(restriction) &&
      typeof date === "string" &&
      ISO_DAY.test(date)
    ) {
      restrictionText = t(`widget.errors.RESTRICTED_${restriction}`, {
        date: f.date(date, "medium"),
      });
    }
  }
  const known = code !== null && QUOTE_ERROR_CODES.has(code);
  const text = restrictionText ?? (known ? t(`widget.errors.${code}`) : error);
  const action: QuoteErrorAction =
    code !== null && DATE_ERROR_CODES.has(code) ? "dates" : known ? null : "retry";
  return { text, action };
}

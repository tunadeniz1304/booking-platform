"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, LlmBadge, focusRing, inputClass } from "@/components/ui/ui";

export interface SmartFilters {
  city?: string;
  query?: string;
  guests?: number;
  minPrice?: number;
  maxPrice?: number;
  amenities: string[];
  propertyType?: string;
  checkIn?: string;
  checkOut?: string;
  sort?: string;
}

// Arayüz etiketleri "search" ad alanındaki anahtarlardan gelir.
const TYPE_KEYS: Record<string, string> = {
  HOTEL: "hotel",
  APARTMENT: "apartment",
  VILLA: "villa",
  HOSTEL: "hostel",
  BED_AND_BREAKFAST: "bedAndBreakfast",
};

const SORT_KEYS: Record<string, string> = {
  recommended: "recommended",
  price_asc: "priceAsc",
  price_desc: "priceDesc",
  rating: "rating",
};

/** "search" ad alanına bağlı çevirici. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Bir çip: filtre anahtarı + (olanaklar için) değer. */
export interface Chip {
  key: keyof SmartFilters;
  value?: string;
  label: string;
}

export function filtersToChips(f: SmartFilters, t: Translate): Chip[] {
  const chips: Chip[] = [];
  if (f.city) chips.push({ key: "city", label: t("smart.chips.city", { value: f.city }) });
  if (f.query) chips.push({ key: "query", label: t("smart.chips.query", { value: f.query }) });
  if (f.guests) chips.push({ key: "guests", label: t("smart.chips.guests", { count: f.guests }) });
  if (f.minPrice !== undefined)
    chips.push({ key: "minPrice", label: t("smart.chips.minPrice", { value: f.minPrice }) });
  if (f.maxPrice !== undefined)
    chips.push({ key: "maxPrice", label: t("smart.chips.maxPrice", { value: f.maxPrice }) });
  if (f.propertyType) {
    const typeKey = TYPE_KEYS[f.propertyType];
    chips.push({ key: "propertyType", label: typeKey ? t(`types.${typeKey}`) : f.propertyType });
  }
  if (f.checkIn)
    chips.push({ key: "checkIn", label: t("smart.chips.checkIn", { value: f.checkIn }) });
  if (f.checkOut)
    chips.push({ key: "checkOut", label: t("smart.chips.checkOut", { value: f.checkOut }) });
  if (f.sort) {
    const sortKey = SORT_KEYS[f.sort];
    const sortLabel = sortKey ? t(`smart.sort.${sortKey}`) : f.sort;
    chips.push({ key: "sort", label: t("smart.chips.sort", { value: sortLabel }) });
  }
  for (const a of f.amenities ?? []) chips.push({ key: "amenities", value: a, label: a });
  return chips;
}

export function removeChip(f: SmartFilters, chip: Chip): SmartFilters {
  if (chip.key === "amenities") {
    return { ...f, amenities: f.amenities.filter((a) => a !== chip.value) };
  }
  const next = { ...f };
  delete next[chip.key];
  return { ...next, amenities: next.amenities ?? [] };
}

/** Doğal dil arama kutusu + çıkarılan filtrelerin kaldırılabilir çipleri (P1-1). */
export default function SmartFilter({
  filters,
  llmMode,
  busy,
  onSubmit,
  onChange,
  onClear,
}: {
  filters: SmartFilters | null;
  llmMode: string | null;
  busy: boolean;
  onSubmit: (text: string) => void;
  onChange: (next: SmartFilters) => void;
  onClear: () => void;
}) {
  const t = useTranslations("search");
  const [text, setText] = useState("");
  const chips = filters ? filtersToChips(filters, t) : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length >= 3) onSubmit(text.trim());
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="smart-filter" className="block text-sm font-medium text-gray-800">
            {t("smart.label")}
          </label>
          <input
            id="smart-filter"
            className={inputClass}
            value={text}
            minLength={3}
            maxLength={300}
            placeholder={t("smart.placeholder")}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? t("smart.interpreting") : t("smart.submit")}
        </Button>
      </form>
      <div aria-live="polite" className="mt-3">
        {filters && (
          <div className="flex flex-wrap items-center gap-2">
            <LlmBadge mode={llmMode} />
            {chips.length === 0 && (
              <span className="text-sm text-gray-700">{t("smart.noFilters")}</span>
            )}
            <ul className="flex flex-wrap gap-2" aria-label={t("smart.extracted")}>
              {chips.map((chip) => (
                <li key={`${chip.key}-${chip.value ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => onChange(removeChip(filters, chip))}
                    className={`inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-[#003580] hover:bg-blue-200 ${focusRing}`}
                    aria-label={t("smart.remove", { label: chip.label })}
                  >
                    {chip.label} <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setText("");
                onClear();
              }}
              className={`text-xs font-semibold text-[#003580] underline ${focusRing}`}
            >
              {t("smart.clear")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

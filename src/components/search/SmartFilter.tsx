"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, LlmBadge, focusRing, inputClass } from "@/components/ui/ui";
import { useFormat } from "@/i18n/use-format";
import { amenityNameKey } from "@/lib/i18n/amenity-display-names";
import { propertyTypeKey } from "@/lib/i18n/property-type";

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

/** Sunucunun kabul ettiği en kısa metin (/api/search/smart). */
const SMART_MIN_LENGTH = 3;

// Arayüz etiketleri "search" ad alanındaki anahtarlardan gelir.
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

/** Çip değerlerinin biçimlendiricileri; verilmeyen alan ham değerle gösterilir. */
export interface ChipFormatters {
  /** ISO tarih (YYYY-AA-GG) → arayüz dilinde tarih. */
  date?: (iso: string) => string;
  /** Fiyat sınırı (ana birim) → para birimi ve gecelik/toplam ibaresiyle tutar. */
  price?: (value: number) => string;
  /** Veritabanındaki olanak adı → arayüz dilindeki ad. */
  amenity?: (name: string) => string;
}

export function filtersToChips(f: SmartFilters, t: Translate, fmt: ChipFormatters = {}): Chip[] {
  const chips: Chip[] = [];
  const date = fmt.date ?? ((iso: string) => iso);
  const price = fmt.price ?? ((value: number) => value);
  if (f.city) chips.push({ key: "city", label: t("smart.chips.city", { value: f.city }) });
  if (f.query) chips.push({ key: "query", label: t("smart.chips.query", { value: f.query }) });
  if (f.guests) chips.push({ key: "guests", label: t("smart.chips.guests", { count: f.guests }) });
  if (f.minPrice !== undefined)
    chips.push({ key: "minPrice", label: t("smart.chips.minPrice", { value: price(f.minPrice) }) });
  if (f.maxPrice !== undefined)
    chips.push({ key: "maxPrice", label: t("smart.chips.maxPrice", { value: price(f.maxPrice) }) });
  if (f.propertyType) {
    const typeKey = propertyTypeKey(f.propertyType);
    chips.push({ key: "propertyType", label: typeKey ? t(`types.${typeKey}`) : f.propertyType });
  }
  if (f.checkIn)
    chips.push({ key: "checkIn", label: t("smart.chips.checkIn", { value: date(f.checkIn) }) });
  if (f.checkOut)
    chips.push({ key: "checkOut", label: t("smart.chips.checkOut", { value: date(f.checkOut) }) });
  if (f.sort) {
    const sortKey = SORT_KEYS[f.sort];
    const sortLabel = sortKey ? t(`smart.sort.${sortKey}`) : f.sort;
    chips.push({ key: "sort", label: t("smart.chips.sort", { value: sortLabel }) });
  }
  for (const a of f.amenities ?? []) {
    const value = fmt.amenity ? fmt.amenity(a) : a;
    chips.push({ key: "amenities", value: a, label: t("smart.chips.amenity", { value }) });
  }
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
  priceCurrency,
  pricesAreTotal,
  errorId,
}: {
  filters: SmartFilters | null;
  llmMode: string | null;
  busy: boolean;
  onSubmit: (text: string) => void;
  onChange: (next: SmartFilters) => void;
  onClear: () => void;
  /** Fiyat sınırlarının para birimi (sonuçlar tek para birimindeyse); yoksa yalnızca sayı. */
  priceCurrency?: string | null;
  /** Fiyat süzgeci konaklama toplamına mı (tarih var) gecelik fiyata mı uygulanıyor. */
  pricesAreTotal?: boolean;
  /** Sayfanın gösterdiği yorumlama hatasının id'si; verilirse giriş geçersiz işaretlenir (F971). */
  errorId?: string;
}) {
  const t = useTranslations("search");
  const tProperty = useTranslations("property");
  const tCommon = useTranslations("common");
  const fmt = useFormat();
  const [text, setText] = useState("");
  /** Gönderilen metin en kısa sınırın altında: görünür hata + aria-invalid (F1141). */
  const [tooShort, setTooShort] = useState(false);
  /** Kullanıcının çip kaldırarak ürettiği son filtre; tümü kaldırıldıysa ayrı mesaj (F980). */
  const [userFilters, setUserFilters] = useState<SmartFilters | null>(null);
  const chips = filters
    ? filtersToChips(filters, t, {
        date: (iso) => fmt.date(iso, "medium"),
        price: (value) => {
          const amount = priceCurrency ? fmt.decimal(value, priceCurrency) : fmt.number(value);
          // Toplam fiyatta gece sayısı burada bilinmediğinden yalnız tutar gösterilir.
          return pricesAreTotal === false ? t("mapPrice.perNight", { price: amount }) : amount;
        },
        amenity: (name) => {
          const key = amenityNameKey(name);
          return key ? tProperty(`amenityNames.${key}`) : name;
        },
      })
    : [];
  const removedAll = chips.length === 0 && filters !== null && filters === userFilters;
  const describedBy =
    "smart-filter-hint" + (tooShort ? " smart-filter-short" : "") + (errorId ? ` ${errorId}` : "");
  const inputRef = useRef<HTMLInputElement>(null);
  const chipListRef = useRef<HTMLUListElement>(null);
  // Kaldırılan çipin sırası: filtreler güncellenince odak bir sonraki çipe (yoksa
  // öncekine, hiç çip kalmadıysa girişe) taşınır; aksi halde odak body'ye düşer (WCAG 2.4.3).
  const pendingFocusIndex = useRef<number | null>(null);

  useEffect(() => {
    const idx = pendingFocusIndex.current;
    if (idx === null) return;
    pendingFocusIndex.current = null;
    const buttons = chipListRef.current?.querySelectorAll<HTMLButtonElement>("button");
    if (buttons && buttons.length > 0) {
      buttons[Math.min(idx, buttons.length - 1)].focus();
    } else {
      inputRef.current?.focus();
    }
  }, [filters]);

  function removeAt(chip: Chip, index: number) {
    if (!filters) return;
    pendingFocusIndex.current = index;
    const next = removeChip(filters, chip);
    setUserFilters(next);
    onChange(next);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const value = text.trim();
    if (value.length < SMART_MIN_LENGTH) {
      setTooShort(true);
      inputRef.current?.focus();
      return;
    }
    setTooShort(false);
    onSubmit(value);
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      {/* noValidate: kısa metin uyarısı tarayıcı balonu yerine arayüz dilinde gösterilir. */}
      <form onSubmit={submit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="smart-filter" className="block text-sm font-medium text-gray-800">
            {t("smart.label")}
          </label>
          <p id="smart-filter-hint" className="mt-1 text-xs text-gray-600">
            {t("smart.hint", { min: SMART_MIN_LENGTH })}
          </p>
          {/* Kısa metin hatası ve yorumlama süreci ekran okuyucuya duyurulur (F980, F1141). */}
          <div role="status">
            {tooShort && (
              <p id="smart-filter-short" className="mt-1 text-xs font-medium text-red-700">
                <span aria-hidden="true">{"\u26A0\uFE0E"} </span>
                <span className="sr-only">{tCommon("errorPrefix")} </span>
                {t("smart.tooShort", { min: SMART_MIN_LENGTH })}
              </p>
            )}
            {busy && <span className="sr-only">{t("smart.interpreting")}</span>}
          </div>
          <input
            id="smart-filter"
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            className={inputClass}
            value={text}
            required
            minLength={SMART_MIN_LENGTH}
            maxLength={300}
            aria-invalid={tooShort || errorId ? true : undefined}
            aria-describedby={describedBy}
            placeholder={t("smart.placeholder")}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim().length >= SMART_MIN_LENGTH) setTooShort(false);
            }}
          />
        </div>
        <Button type="submit" busy={busy}>
          {busy ? t("smart.interpreting") : t("smart.submit")}
        </Button>
      </form>
      <div aria-live="polite" aria-busy={busy || undefined} className="mt-3">
        {filters && (
          <div className="flex flex-wrap items-center gap-2">
            <LlmBadge mode={llmMode} />
            {chips.length === 0 && (
              <span className="text-sm text-gray-700">
                {removedAll ? t("smart.allRemoved") : t("smart.noFilters")}
              </span>
            )}
            <ul
              ref={chipListRef}
              className="flex flex-wrap gap-2"
              aria-label={t("smart.extracted")}
            >
              {chips.map((chip, index) => (
                <li key={`${chip.key}-${chip.value ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => removeAt(chip, index)}
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
                setTooShort(false);
                onClear();
                inputRef.current?.focus();
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

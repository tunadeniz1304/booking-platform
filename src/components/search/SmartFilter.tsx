"use client";

import { useState, type FormEvent } from "react";
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

const TYPE_LABELS: Record<string, string> = {
  HOTEL: "Otel",
  APARTMENT: "Apart",
  VILLA: "Villa",
  HOSTEL: "Hostel",
  BED_AND_BREAKFAST: "Pansiyon",
};

const SORT_LABELS: Record<string, string> = {
  recommended: "Önerilen",
  price_asc: "Fiyat artan",
  price_desc: "Fiyat azalan",
  rating: "Puan",
};

/** Bir çip: filtre anahtarı + (olanaklar için) değer. */
export interface Chip {
  key: keyof SmartFilters;
  value?: string;
  label: string;
}

export function filtersToChips(f: SmartFilters): Chip[] {
  const chips: Chip[] = [];
  if (f.city) chips.push({ key: "city", label: `Şehir: ${f.city}` });
  if (f.query) chips.push({ key: "query", label: `Metin: ${f.query}` });
  if (f.guests) chips.push({ key: "guests", label: `${f.guests} misafir` });
  if (f.minPrice !== undefined) chips.push({ key: "minPrice", label: `En az ${f.minPrice}` });
  if (f.maxPrice !== undefined) chips.push({ key: "maxPrice", label: `En çok ${f.maxPrice}` });
  if (f.propertyType)
    chips.push({ key: "propertyType", label: TYPE_LABELS[f.propertyType] ?? f.propertyType });
  if (f.checkIn) chips.push({ key: "checkIn", label: `Giriş: ${f.checkIn}` });
  if (f.checkOut) chips.push({ key: "checkOut", label: `Çıkış: ${f.checkOut}` });
  if (f.sort) chips.push({ key: "sort", label: `Sıralama: ${SORT_LABELS[f.sort] ?? f.sort}` });
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
  const [text, setText] = useState("");
  const chips = filters ? filtersToChips(filters) : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length >= 3) onSubmit(text.trim());
  }

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="smart-filter" className="block text-sm font-medium text-gray-800">
            Akıllı filtre — ne aradığınızı yazın
          </label>
          <input
            id="smart-filter"
            className={inputClass}
            value={text}
            minLength={3}
            maxLength={300}
            placeholder="ör. Antalya'da havuzlu, 4 kişilik, gecelik 3000 TL altı villa"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "Yorumlanıyor…" : "Filtrele"}
        </Button>
      </form>
      <div aria-live="polite" className="mt-3">
        {filters && (
          <div className="flex flex-wrap items-center gap-2">
            <LlmBadge mode={llmMode} />
            {chips.length === 0 && (
              <span className="text-sm text-gray-700">Metinden filtre çıkarılamadı.</span>
            )}
            <ul className="flex flex-wrap gap-2" aria-label="Çıkarılan filtreler">
              {chips.map((chip) => (
                <li key={`${chip.key}-${chip.value ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => onChange(removeChip(filters, chip))}
                    className={`inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-[#003580] hover:bg-blue-200 ${focusRing}`}
                    aria-label={`${chip.label} filtresini kaldır`}
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
              Akıllı filtreyi temizle
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Nereye?" alanı için otomatik tamamlama. Gerçek lokasyon verisini
 * /api/locations?q= ucu üzerinden çeker (şehir + ülke). Boş sorguda
 * popüler destinasyonlar gösterilir.
 */

interface LocationOption {
  city: string;
  country: string;
}

const POPULAR_FALLBACK: LocationOption[] = [
  { city: "İstanbul", country: "Türkiye" },
  { city: "Antalya", country: "Türkiye" },
  { city: "Bodrum", country: "Türkiye" },
  { city: "Kapadokya", country: "Türkiye" },
  { city: "Paris", country: "Fransa" },
  { city: "Roma", country: "İtalya" },
  { city: "Barselona", country: "İspanya" },
  { city: "Dubai", country: "BAE" },
];

interface DestinationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
}

export default function DestinationAutocomplete({
  value,
  onChange,
}: DestinationAutocompleteProps) {
  const [options, setOptions] = useState<LocationOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Dış tıklamada kapat
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const query = value.trim();
    if (!open) return;

    let cancelled = false;
    // 250 ms debounce
    const timer = setTimeout(async () => {
      try {
        if (query.length === 0) {
          setLoading(false);
          setOptions(POPULAR_FALLBACK);
          return;
        }
        setLoading(true);
        const res = await fetch(`/api/locations?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as LocationOption[];
        setOptions(data.length > 0 ? data.slice(0, 8) : POPULAR_FALLBACK.filter((p) =>
          p.city.toLowerCase().includes(query.toLowerCase()) || p.country.toLowerCase().includes(query.toLowerCase())
        ));
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setOptions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, open]);

  const selectOption = (opt: LocationOption) => {
    onChange(opt.city);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <input
          id="destination"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? "destination-listbox" : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Şehir, otel veya bölge"
          className="w-full rounded-sm border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        />
      </div>

      {open && (
        <ul
          id="destination-listbox"
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
        >
          <li className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {value.trim().length === 0 ? "Popüler destinasyonlar" : loading ? "Aranıyor..." : "Öneriler"}
          </li>
          {options.length === 0 && !loading && (
            <li className="px-4 py-3 text-sm text-gray-500">Sonuç bulunamadı</li>
          )}
          {options.map((opt, idx) => (
            <li key={`${opt.city}-${opt.country}-${idx}`}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => selectOption(opt)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-800 transition hover:bg-blue-50"
              >
                <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="font-medium">{opt.city}</span>
                <span className="text-gray-500">{opt.country}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * "Nereye?" alanı için otomatik tamamlama. Gerçek lokasyon verisini
 * /api/locations?q= ucu üzerinden çeker (şehir + ülke). Boş sorguda
 * popüler destinasyonlar gösterilir.
 *
 * WAI-ARIA "combobox + listbox popup" deseni: odak her zaman input'ta kalır,
 * ok tuşları aria-activedescendant ile öneriler arasında gezinir, Enter
 * etkin öneriyi seçer, Escape listeyi kapatır (ikinci Escape değeri temizler).
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

const LISTBOX_ID = "destination-listbox";
const HEADING_ID = "destination-listbox-heading";
const OPTION_ID_PREFIX = "destination-opt-";

interface DestinationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
}

export default function DestinationAutocomplete({ value, onChange }: DestinationAutocompleteProps) {
  const t = useTranslations("search");
  const [options, setOptions] = useState<LocationOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // Klavyeyle vurgulanan öneri (aria-activedescendant); -1 = yok.
  const [activeIndex, setActiveIndex] = useState(-1);
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

    const updateOptions = (next: LocationOption[]) => {
      setOptions(next);
      setActiveIndex(-1);
    };

    let cancelled = false;
    // 250 ms debounce
    const timer = setTimeout(async () => {
      try {
        if (query.length === 0) {
          setLoading(false);
          updateOptions(POPULAR_FALLBACK);
          return;
        }
        setLoading(true);
        const res = await fetch(`/api/locations?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          // Önceki sorgunun önerileri güncelmiş gibi ekranda kalmasın.
          updateOptions([]);
          return;
        }
        const data = (await res.json()) as LocationOption[];
        updateOptions(
          data.length > 0
            ? data.slice(0, 8)
            : POPULAR_FALLBACK.filter(
                (p) =>
                  p.city.toLowerCase().includes(query.toLowerCase()) ||
                  p.country.toLowerCase().includes(query.toLowerCase())
              )
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        updateOptions([]);
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

  // Etkin öneriyi kaydırılabilir listede görünür tut.
  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${OPTION_ID_PREFIX}${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  // Odak input'ta kalır (öneriye tıklarken mousedown engellenir), böylece
  // seçimden sonra klavye kullanıcısı formdaki yerini kaybetmez.
  const selectOption = (opt: LocationOption) => {
    onChange(opt.city);
    setOpen(false);
    setActiveIndex(-1);
  };

  const showList = open && options.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (options.length === 0) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((i) => {
          if (i < 0) return step === 1 ? 0 : options.length - 1;
          return (i + step + options.length) % options.length;
        });
        return;
      }
      case "Enter":
        // Etkin öneri yoksa form normal şekilde gönderilir.
        if (showList && activeIndex >= 0 && options[activeIndex]) {
          e.preventDefault();
          selectOption(options[activeIndex]);
        }
        return;
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        } else if (value) {
          e.preventDefault();
          onChange("");
        }
        return;
      case "Tab":
        setOpen(false);
        return;
    }
  };

  const heading =
    value.trim().length === 0
      ? t("autocomplete.popular")
      : loading
        ? t("autocomplete.searching")
        : t("autocomplete.suggestions");

  // Ekran okuyucu duyurusu: yükleniyor / öneri sayısı / sonuç yok.
  const statusText = !open
    ? ""
    : loading
      ? t("autocomplete.searching")
      : options.length > 0
        ? t("autocomplete.count", { count: options.length })
        : t("autocomplete.noResults");

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
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
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
        <input
          id="destination"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? LISTBOX_ID : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && activeIndex >= 0 ? `${OPTION_ID_PREFIX}${activeIndex}` : undefined
          }
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t("autocomplete.placeholder")}
          className="w-full rounded-sm border border-gray-500 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-900 placeholder-gray-500 focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        />
      </div>

      <p role="status" className="sr-only">
        {statusText}
      </p>

      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <p
            id={HEADING_ID}
            className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-600"
          >
            {heading}
          </p>
          {options.length === 0 && !loading && (
            // Görsel boş durum; ekran okuyucuya role=status bölgesi duyurur.
            <p className="px-4 py-3 text-sm text-gray-500" aria-hidden="true">
              {t("autocomplete.noResults")}
            </p>
          )}
          {options.length > 0 && (
            <ul id={LISTBOX_ID} role="listbox" aria-labelledby={HEADING_ID}>
              {options.map((opt, idx) => (
                <li
                  key={`${opt.city}-${opt.country}-${idx}`}
                  id={`${OPTION_ID_PREFIX}${idx}`}
                  role="option"
                  aria-selected={idx === activeIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectOption(opt)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-800 transition hover:bg-blue-50 ${
                    idx === activeIndex ? "bg-blue-50" : ""
                  }`}
                >
                  <svg
                    className="h-4 w-4 shrink-0 text-gray-400"
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                  <span className="font-medium">{opt.city}</span>
                  <span className="text-gray-500">{opt.country}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

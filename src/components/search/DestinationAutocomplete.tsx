"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { localizeCountryName, placeCityKey } from "@/lib/i18n/place-display-names";
import { POPULAR_DESTINATIONS } from "@/lib/popular-destinations";
import { normalizePlace } from "@/lib/search/normalize-place";

/**
 * "Nereye?" alanı için otomatik tamamlama. Gerçek lokasyon verisini
 * /api/locations?q= ucu üzerinden çeker (şehir + ülke). Boş sorguda
 * popüler destinasyonlar, tek harflik sorguda bu harfle başlayan popüler
 * destinasyonlar gösterilir (sunucu çağrılmaz). Değer veritabanındaki adla
 * gönderilir; ekranda şehir/ülke adı arayüz diline çevrilir.
 *
 * WAI-ARIA "combobox + listbox popup" deseni: odak her zaman input'ta kalır,
 * ok tuşları aria-activedescendant ile öneriler arasında gezinir, Enter
 * etkin öneriyi seçer, Escape listeyi kapatır (ikinci Escape değeri temizler).
 * Öneri yoksa ya da yüklenemezse "“…” için ara" seçeneği formu gönderir.
 */

interface LocationOption {
  city: string;
  country: string;
}

/** Sunucu yanıtı ve ait olduğu sorgu; `items: null` = istek başarısız. */
interface RemoteResult {
  query: string;
  items: LocationOption[] | null;
}

/** Sunucu araması bu uzunluktan itibaren yapılır. */
const MIN_REMOTE_QUERY = 2;
const MAX_OPTIONS = 8;

const LISTBOX_ID = "destination-listbox";
const HEADING_ID = "destination-listbox-heading";
const OPTION_ID_PREFIX = "destination-opt-";

interface DestinationAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
}

export default function DestinationAutocomplete({ value, onChange }: DestinationAutocompleteProps) {
  const t = useTranslations("search");
  const tHome = useTranslations("home");
  const locale = useLocale();
  const [remote, setRemote] = useState<RemoteResult | null>(null);
  const [open, setOpen] = useState(false);
  // Klavyeyle vurgulanan öneri (aria-activedescendant); -1 = yok.
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = value.trim();
  const remoteQuery = query.length >= MIN_REMOTE_QUERY;

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
    if (!open || !remoteQuery) return;
    const controller = new AbortController();
    // 250 ms debounce
    const timer = setTimeout(async () => {
      let items: LocationOption[] | null = null;
      try {
        const res = await fetch(`/api/locations?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data: unknown = await res.json();
          if (Array.isArray(data)) items = data as LocationOption[];
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
      if (controller.signal.aborted) return;
      setRemote({ query, items });
      setActiveIndex(-1);
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, remoteQuery]);

  // Etkin öneriyi kaydırılabilir listede görünür tut.
  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${OPTION_ID_PREFIX}${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const cityName = (city: string) => {
    const key = placeCityKey(city);
    return key ? tHome(`places.${key}`) : city;
  };
  const countryName = (country: string) => localizeCountryName(country, locale);

  // Yerel eşleştirme: veritabanı adı, çevrilmiş şehir adı ya da ülke adı; aksan ve İ/ı duyarsız.
  const needle = normalizePlace(query);
  const placeNames = (p: LocationOption) => [p.city, cityName(p.city), countryName(p.country)];
  const popularMatching = (match: (name: string) => boolean) =>
    POPULAR_DESTINATIONS.filter((p) => placeNames(p).some((n) => match(normalizePlace(n))));

  // Yanıt yazılan sorguya ait değilse eski öneriler gösterilmez; "Aranıyor…" görünür.
  const pending = remoteQuery && remote?.query !== query;
  const loading = open && pending;
  const failed = remoteQuery && !pending && remote?.items === null;

  let items: readonly LocationOption[];
  if (query.length === 0) {
    items = POPULAR_DESTINATIONS;
  } else if (!remoteQuery) {
    items = popularMatching((name) => name.startsWith(needle));
  } else if (pending) {
    items = [];
  } else {
    // Sunucu sonuçları önce; "Rome", "Cesme" gibi yazımlar için popüler eşleşmeler eklenir.
    const seen = new Set<string>();
    const merged: LocationOption[] = [];
    for (const o of [...(remote?.items ?? []), ...popularMatching((n) => n.includes(needle))]) {
      const key = `${o.city}\u0000${o.country}`;
      if (seen.has(key) || merged.length >= MAX_OPTIONS) continue;
      seen.add(key);
      merged.push(o);
    }
    items = merged;
  }

  // Öneri yoksa (ya da yüklenemediyse) yazılan metinle arama seçeneği sunulur.
  const searchOption = query.length > 0 && !pending && items.length === 0;
  const optionCount = items.length + (searchOption ? 1 : 0);
  const showList = open && optionCount > 0;

  const changeValue = (next: string) => {
    onChange(next);
    setOpen(true);
    setActiveIndex(-1);
  };

  // Odak input'ta kalır (öneriye tıklarken mousedown engellenir), böylece
  // seçimden sonra klavye kullanıcısı formdaki yerini kaybetmez.
  const selectOption = (opt: LocationOption) => {
    onChange(opt.city);
    setOpen(false);
    setActiveIndex(-1);
  };

  const submitQuery = () => {
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.form?.requestSubmit();
  };

  const choose = (idx: number) => {
    if (idx < items.length) selectOption(items[idx]);
    else if (searchOption) submitQuery();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (optionCount === 0) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((i) => {
          if (i < 0) return step === 1 ? 0 : optionCount - 1;
          return (i + step + optionCount) % optionCount;
        });
        return;
      }
      case "Enter":
        // Etkin öneri yoksa form normal şekilde gönderilir.
        if (showList && activeIndex >= 0 && activeIndex < optionCount) {
          e.preventDefault();
          choose(activeIndex);
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

  const heading = loading
    ? t("autocomplete.searching")
    : !remoteQuery && items.length > 0
      ? t("autocomplete.popular")
      : t("autocomplete.suggestions");

  const emptyText = failed
    ? t("autocomplete.error")
    : query.length > 0 && !pending && items.length === 0
      ? t("autocomplete.noResults")
      : "";

  // Ekran okuyucu duyurusu: yükleniyor / hata / öneri sayısı / sonuç yok.
  const statusText = !open
    ? ""
    : loading
      ? t("autocomplete.searching")
      : emptyText || t("autocomplete.count", { count: items.length });

  const optionClass = (idx: number) =>
    `flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-800 transition hover:bg-blue-50 ${
      idx === activeIndex ? "bg-blue-50" : ""
    }`;

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
          ref={inputRef}
          id="destination"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? LISTBOX_ID : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            showList && activeIndex >= 0 && activeIndex < optionCount
              ? `${OPTION_ID_PREFIX}${activeIndex}`
              : undefined
          }
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="search"
          value={value}
          onChange={(e) => changeValue(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t("autocomplete.placeholder")}
          className="w-full rounded-sm border border-gray-500 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 placeholder-gray-500 focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
        />
        {value && (
          <button
            type="button"
            aria-label={t("autocomplete.clear")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              changeValue("");
              inputRef.current?.focus();
            }}
            className={`absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-sm text-gray-500 hover:text-gray-800 ${focusRing}`}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
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
          {emptyText && (
            // Görsel boş/hata durumu; ekran okuyucuya role=status bölgesi duyurur.
            <p className="px-4 py-3 text-sm text-gray-500" aria-hidden="true">
              {emptyText}
            </p>
          )}
          {showList && (
            <ul id={LISTBOX_ID} role="listbox" aria-labelledby={HEADING_ID}>
              {items.map((opt, idx) => (
                <li
                  key={`${opt.city}-${opt.country}-${idx}`}
                  id={`${OPTION_ID_PREFIX}${idx}`}
                  role="option"
                  aria-selected={idx === activeIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectOption(opt)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={optionClass(idx)}
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
                  <span className="font-medium">{cityName(opt.city)}</span>
                  <span className="text-gray-500">{countryName(opt.country)}</span>
                </li>
              ))}
              {searchOption && (
                <li
                  id={`${OPTION_ID_PREFIX}${items.length}`}
                  role="option"
                  aria-selected={activeIndex === items.length}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={submitQuery}
                  onMouseEnter={() => setActiveIndex(items.length)}
                  className={optionClass(items.length)}
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
                      d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z"
                    />
                  </svg>
                  <span className="font-medium">{t("autocomplete.searchFor", { query })}</span>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

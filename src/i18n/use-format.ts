"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import { createFormatter, type Formatter } from "@/lib/i18n/format";

/** İstemci bileşenlerinde etkin dile göre para/tarih biçimlendirici. */
export function useFormat(): Formatter {
  const locale = useLocale();
  return useMemo(() => createFormatter(locale), [locale]);
}

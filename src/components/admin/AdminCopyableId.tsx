"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { focusRing } from "@/components/ui/ui";
import { shortRef } from "@/lib/ui/short-ref";

/**
 * Uzun kimlik: kısaltılmış görünür, tam değer `title`da; düğme tam değeri panoya kopyalar.
 * Kısa biçim tüm ekranlarda ortak `shortRef` (F2-41).
 */
export function AdminCopyableId({ id, label }: { id: string; label: (short: string) => string }) {
  const t = useTranslations("admin");
  const [copied, setCopied] = useState(false);
  const short = shortRef(id);
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Pano erişimi yok: tam değer `title` ipucunda duruyor.
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span title={id}>{label(short)}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={t("ids.copyLabel", { name: label(short) })}
        className={`rounded text-xs font-semibold text-[#003580] underline ${focusRing}`}
      >
        {copied ? t("ids.copied") : t("ids.copy")}
      </button>
      <span role="status" className="sr-only">
        {copied ? t("ids.copied") : ""}
      </span>
    </span>
  );
}

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { searchHrefWithDraft, useSearchDraft } from "@/components/search/useSearchDraft";

export interface HomeDestinationLinkProps {
  /** Veritabanındaki (Türkçe) şehir adı; arama sorgusunda aynen kullanılır. */
  destination: string;
  "aria-label"?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Popüler destinasyon kartı bağlantısı: arama formunda seçili tarih ve kişi sayısını sorguya
 * ekler (F1282). Form ölçüt yayınlamadıysa yalnızca destinasyonla arar.
 */
export default function HomeDestinationLink({
  destination,
  "aria-label": ariaLabel,
  className,
  children,
}: HomeDestinationLinkProps) {
  const draft = useSearchDraft();
  return (
    <Link
      href={searchHrefWithDraft(destination, draft)}
      aria-label={ariaLabel}
      className={className}
    >
      {children}
    </Link>
  );
}

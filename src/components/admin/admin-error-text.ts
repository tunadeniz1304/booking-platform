"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-client";
import { useErrorText } from "@/components/ui/ui";

/** Kayıt başka bir yönetici tarafından işlenmiş ya da kaldırılmış mı (404 / geçersiz durum)? */
export function isStaleRecord(err: unknown): boolean {
  return err instanceof ApiError && (err.code === "NOT_FOUND" || err.code === "INVALID_STATE");
}

/**
 * Yönetici işlemlerinin hata metni: bilinen API kodları `admin.errors.*` ile arayüz dilinde
 * (sunucunun ham iletisi yerine); `overrides` bağlama özgü metni verir; diğerleri (ağ kesintisi,
 * genel kodlar) `useErrorText` ile. Satır eyleminde `isStaleRecord` ise `admin.staleRecord`
 * gösterip listeyi yeniden yükleyin.
 */
export function useAdminErrorText(): (err: unknown, overrides?: Record<string, string>) => string {
  const t = useTranslations("admin");
  const errorText = useErrorText();
  return useCallback(
    (err: unknown, overrides: Record<string, string> = {}): string => {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code && overrides[code]) return overrides[code];
      if (code && t.has(`errors.${code}`)) return t(`errors.${code}`);
      return errorText(err);
    },
    [t, errorText]
  );
}

"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/** Kaydedilmemiş değişikliği olan formlar (modül kapsamı; panel bileşenleri kaydolur). */
const dirtyForms = new Set<symbol>();

/** Ev sahibi panelinde kaydedilmemiş değişiklik var mı (sayfa içi gezinme uyarısı için). */
export function hasHostUnsavedChanges(): boolean {
  return dirtyForms.size > 0;
}

/**
 * Form `dirty` iken sekme kapatma/yenileme/tam sayfa geçişinde tarayıcı uyarısı gösterir ve
 * formu `hasHostUnsavedChanges()` kaydına ekler (F838/F839).
 */
export function useHostUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const token = Symbol("dirty-form");
    dirtyForms.add(token);
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      dirtyForms.delete(token);
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty]);
}

/** Ev sahibi panelinin sekme oturumundaki metin taslakları (HostDashboard, F402). */
export const HOST_DRAFT_PREFIX = "host-draft:";

/** "Kaydetmeden ayrıl" onayından sonra taslaklar geri getirilmez. */
export function clearHostDrafts(): void {
  try {
    const store = window.sessionStorage;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
    for (const key of keys) {
      if (key?.startsWith(HOST_DRAFT_PREFIX)) store.removeItem(key);
    }
  } catch {
    /* yok say */
  }
}

/**
 * Sayfa içi gezinme `beforeunload` tetiklemez: kaydedilmemiş değişiklikte `Link onNavigate`
 * onay ister (F839, F2-23). Dönen `confirmDialog` bileşende render edilmelidir.
 */
export function useHostLeaveGuard(): {
  guardLeave: (href: string) => (e: { preventDefault: () => void }) => void;
  confirmDialog: ReactNode;
} {
  const t = useTranslations("host");
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const guardLeave = (href: string) => (e: { preventDefault: () => void }) => {
    if (!hasHostUnsavedChanges()) return;
    e.preventDefault();
    void confirm({
      title: t("unsaved.leaveConfirm.title"),
      body: t("unsaved.leaveConfirm.body"),
      confirmLabel: t("unsaved.leaveConfirm.confirm"),
      cancelLabel: t("unsaved.leaveConfirm.cancel"),
      tone: "danger",
    }).then((ok) => {
      if (!ok) return;
      clearHostDrafts();
      router.push(href);
    });
  };
  return { guardLeave, confirmDialog };
}

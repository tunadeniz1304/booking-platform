"use client";

import { useEffect } from "react";

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

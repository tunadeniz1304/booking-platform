"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/ui";

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

/**
 * Onay diyaloğu (native `<dialog>` + `showModal()`): odak kapanı ve arka planın
 * etkisizleşmesi tarayıcıdan gelir. Escape ve "Vazgeç" `false`, onay `true` döndürür;
 * kapanınca odak açılıştan önceki öğeye döner. Aynı anda tek diyalog açık olur.
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm();
 * if (await confirm({ title, confirmLabel, tone: "danger" })) remove();
 * return <>{...}{confirmDialog}</>;
 * ```
 */
export function useConfirm(): {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const t = useTranslations("common.confirm");
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const settle = useCallback((value: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    dialogRef.current?.close();
    setPending(null);
    current.resolve(value);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && target.isConnected) target.focus();
  }, []);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // Tek diyalog: açık olan varsa vazgeçilmiş sayılır.
        if (pendingRef.current) {
          const previous = pendingRef.current;
          pendingRef.current = null;
          previous.resolve(false);
        } else {
          const active = document.activeElement;
          returnFocusRef.current = active instanceof HTMLElement ? active : null;
        }
        const next = { ...o, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    []
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!pending || !dialog) return;
    if (!dialog.open) dialog.showModal();
    (pending.tone === "danger" ? cancelRef : confirmRef).current?.focus();
  }, [pending]);

  // Bileşen kalkarken açık bir söz kalmasın.
  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    []
  );

  const confirmDialog = pending ? (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={pending.body ? bodyId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        settle(false);
      }}
      onClose={() => settle(false)}
      className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-5 shadow-sm backdrop:bg-black/40"
    >
      <h2 id={titleId} className="text-lg font-semibold text-gray-900">
        {pending.title}
      </h2>
      {pending.body && (
        <div id={bodyId} className="mt-2 text-sm text-gray-700">
          {pending.body}
        </div>
      )}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          ref={cancelRef}
          variant="secondary"
          className="min-h-[44px] sm:min-h-0"
          onClick={() => settle(false)}
        >
          {pending.cancelLabel ?? t("cancel")}
        </Button>
        <Button
          ref={confirmRef}
          variant={pending.tone === "danger" ? "danger" : "primary"}
          className="min-h-[44px] sm:min-h-0"
          onClick={() => settle(true)}
        >
          {pending.confirmLabel}
        </Button>
      </div>
    </dialog>
  ) : null;

  return { confirm, confirmDialog };
}

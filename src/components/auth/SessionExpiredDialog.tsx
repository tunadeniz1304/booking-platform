"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink, loginHref } from "@/components/ui/ui";
import { setSessionUserCache } from "@/components/layout/useSessionUserCache";
import { SESSION_EXPIRED_EVENT } from "@/lib/api-client";

/**
 * Oturum süresi dolunca (apiFetch: 401 + yenileme başarısız) tek, genel uyarı (F402). Giriş
 * bağlantısı geçerli sayfaya döner; "Bu sayfada kal" yazılanları kopyalamaya fırsat verir.
 * `NextIntlClientProvider` içinde bir kez (kök layout) render edilir.
 */
export default function SessionExpiredDialog() {
  const t = useTranslations("common.sessionExpired");
  const [href, setHref] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const loginRef = useRef<HTMLAnchorElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const onExpired = () => {
      if (dialogRef.current?.open) return;
      // Başlık "Giriş yap"a dönsün; rol menüleri artık geçerli değil.
      setSessionUserCache(null);
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
      setHref(loginHref());
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!href || !dialog) return;
    if (!dialog.open) dialog.showModal();
    loginRef.current?.focus();
  }, [href]);

  const close = (restoreFocus: boolean) => {
    dialogRef.current?.close();
    setHref(null);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (restoreFocus && target && target.isConnected) target.focus();
  };

  if (!href) return null;
  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        e.preventDefault();
        close(true);
      }}
      className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-5 shadow-sm backdrop:bg-black/40"
    >
      <h2 id={titleId} className="text-lg font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p id={bodyId} className="mt-2 text-sm text-gray-700">
        {t("body")}
      </p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" className="min-h-[44px] sm:min-h-0" onClick={() => close(true)}>
          {t("stay")}
        </Button>
        {/* Diyalog kök layout'ta kalıcı: giriş sayfasına geçerken kapanmalı. */}
        <ButtonLink
          ref={loginRef}
          href={href}
          className="min-h-[44px] sm:min-h-0"
          onClick={() => close(false)}
        >
          {t("login")}
        </ButtonLink>
      </div>
    </dialog>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import AuthCard, { Notice, ResendVerificationButton } from "@/components/auth/AuthCard";
import { useSession } from "@/components/ui/ui";

/** E-posta doğrulama bağlantısının açıldığı sayfa (token tek kullanımlık). */
export default function VerifyEmailPage() {
  const t = useTranslations("auth");
  const session = useSession();
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    // Token yoksa sunucuya gitmeden doğrudan "geçersiz bağlantı" + yeniden gönder.
    const request: Promise<Response | null> = token
      ? fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })
      : Promise.resolve(null);
    request.then((res) => setState(res?.ok ? "ok" : "error")).catch(() => setState("error"));
  }, []);

  return (
    <AuthCard title={t("verify.title")}>
      {state === "pending" && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          {t("verify.pending")}
        </p>
      )}
      {state === "ok" && <Notice kind="success">{t("verify.ok")}</Notice>}
      {state === "error" && (
        <>
          <Notice kind="error">{t("verify.error")}</Notice>
          {session.status === "ready" && session.user && (
            <ResendVerificationButton className="mt-4" />
          )}
          {session.status === "ready" && !session.user && (
            <Link
              href="/login?redirect=%2Fverify-email"
              className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66]"
            >
              {t("verify.loginToResendLink")}
            </Link>
          )}
        </>
      )}
      <p className="mt-6 text-center text-sm">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
        >
          {t("verify.home")}
        </Link>
      </p>
    </AuthCard>
  );
}

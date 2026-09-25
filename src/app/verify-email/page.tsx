"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import AuthCard, { Notice } from "@/components/auth/AuthCard";

/** E-posta doğrulama bağlantısının açıldığı sayfa (token tek kullanımlık). */
export default function VerifyEmailPage() {
  const t = useTranslations("auth");
  const [state, setState] = useState<"pending" | "ok" | "error">("pending");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => setState(res.ok ? "ok" : "error"))
      .catch(() => setState("error"));
  }, []);

  return (
    <AuthCard title={t("verify.title")}>
      {state === "pending" && (
        <p role="status" className="mt-4 text-sm text-gray-600">
          {t("verify.pending")}
        </p>
      )}
      {state === "ok" && <Notice kind="success">{t("verify.ok")}</Notice>}
      {state === "error" && <Notice kind="error">{t("verify.error")}</Notice>}
      <p className="mt-6 text-center text-sm">
        <Link href="/" className="font-semibold text-[#003580] hover:underline">
          {t("verify.home")}
        </Link>
      </p>
    </AuthCard>
  );
}

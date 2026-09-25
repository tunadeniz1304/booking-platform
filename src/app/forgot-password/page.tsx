"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import AuthCard, { Notice } from "@/components/auth/AuthCard";

/** Şifre sıfırlama isteği — yanıt hesabın varlığını ele vermez (daima aynı mesaj). */
export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/auth/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setState(res && res.status === 202 ? "sent" : "error");
  };

  return (
    <AuthCard title={t("forgot.title")} subtitle={t("forgot.subtitle")}>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700">
            {t("email")}
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
          />
        </div>
        <button
          type="submit"
          disabled={state === "sending"}
          className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
        >
          {state === "sending" ? t("forgot.sending") : t("forgot.submit")}
        </button>
      </form>
      {state === "sent" && <Notice kind="success">{t("forgot.sent")}</Notice>}
      {state === "error" && <Notice kind="error">{t("forgot.error")}</Notice>}
      <p className="mt-6 text-center text-sm text-gray-600">
        <Link href="/login" className="font-semibold text-[#003580] hover:underline">
          {t("backToLogin")}
        </Link>
      </p>
    </AuthCard>
  );
}
